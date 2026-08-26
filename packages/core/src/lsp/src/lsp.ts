import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { EventV2Bridge } from "@opencode-ai/openaxe/event-v2-bridge"
import { Config } from "@opencode-ai/openaxe/config/config"
import { Process } from "@opencode-ai/openaxe/util/process"
import { RuntimeFlags } from "@opencode-ai/openaxe/effect/runtime-flags"
import { InstanceState } from "@opencode-ai/openaxe/effect/instance-state"
import { containsPath } from "@opencode-ai/openaxe/project/instance-context"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { LspEvent } from "@opencode-ai/schema/lsp-event"

import {
  LSPClientFactory,
  makeLSPClient,
} from "./client"
import {
  makeBrokenServerTracker,
  BrokenServerTracker,
  makeDiagnosticStore,
  DiagnosticStore,
  makeServerRegistry,
  ServerRegistry,
  makeCapabilityRegistry,
  CapabilityRegistry,
  makePlatformResolver,
  PlatformResolver,
  makeServerDownloader,
  ServerDownloader,
  makeLSPClient,
  LSPClient,
  ClientInfo,
  ServerDefinition,
  Diagnostic,
  Position,
  Range,
  Status,
  ServerCapabilities,
  TextDocumentSyncKind,
  InitializeError,
  ServerSpawnError,
  ServerNotFoundError,
  ConnectionError,
  TimeoutError,
  DiagnosticError,
  DownloadError,
  PlatformError,
} from "./types"
import { DiagnosticStore as DiagnosticStoreModule } from "./diagnostics"
import { ServerRegistry as ServerRegistryModule } from "./registry"
import { CapabilityRegistry as CapabilityRegistryModule } from "./capabilities"
import { PlatformResolver as PlatformResolverModule } from "./platform"
import { ServerDownloader as ServerDownloaderModule } from "./downloader"
import { LSPLaunchService } from "./launch"
import { LSPClientFactory } from "./client"
import path from "path"
import { Effect, Layer, Context, Schema, Schedule, Duration, HashMap, Ref, Option } from "effect"

export const Event = LspEvent

const BROKEN_TTL = 300_000 // 5 minutes before retrying a failed LSP server
const IDLE_TTL = 15 * 60_000 // 15 minutes idle timeout

function clientKey(root: string, serverID: string): string {
  return `${root}#${serverID}`
}

function selectIdleKeys(
  clients: ClientInfo[],
  used: Map<string, number>,
  now: number,
  ttl: number,
): string[] {
  return clients
    .filter((c) => now - (used.get(clientKey(c.root, c.serverID)) ?? now) > ttl)
    .map((c) => clientKey(c.root, c.serverID))
}

interface State {
  clients: ClientInfo[]
  servers: HashMap.HashMap<string, ServerDefinition>
  brokenServerTracker: BrokenServerTracker
  diagnosticStore: DiagnosticStore
  serverRegistry: ServerRegistry
  capabilityRegistry: CapabilityRegistry
  platformResolver: PlatformResolver
  serverDownloader: ServerDownloader
  spawning: HashMap.HashMap<string, Promise<ClientInfo | undefined>>
  used: HashMap.HashMap<string, number>
}

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly status: () => Effect.Effect<Status[]>
  readonly hasClients: (file: string) => Effect.Effect<boolean>
  readonly touchFile: (input: string, diagnostics?: "document" | "full") => Effect.Effect<void>
  readonly diagnostics: () => Effect.Effect<Record<string, Diagnostic[]>>
  readonly hover: (input: { file: string; line: number; character: number }) => Effect.Effect<any>
  readonly definition: (input: { file: string; line: number; character: number }) => Effect.Effect<any[]>
  readonly references: (input: { file: string; line: number; character: number }) => Effect.Effect<any[]>
  readonly implementation: (input: { file: string; line: number; character: number }) => Effect.Effect<any[]>
  readonly documentSymbol: (uri: string) => Effect.Effect<any[]>
  readonly workspaceSymbol: (query: string) => Effect.Effect<any[]>
  readonly prepareCallHierarchy: (input: { file: string; line: number; character: number }) => Effect.Effect<any[]>
  readonly incomingCalls: (input: { file: string; line: number; character: number }) => Effect.Effect<any[]>
  readonly outgoingCalls: (input: { file: string; line: number; character: number }) => Effect.Effect<any[]>
  readonly codeAction: (input: { file: string; line: number; character: number; range?: Range }) => Effect.Effect<any[]>
  readonly rename: (input: { file: string; line: number; character: number; newName: string }) => Effect.Effect<any[]>
  readonly prepareRename: (input: { file: string; line: number; character: number }) => Effect.Effect<any>
  readonly typeDefinition: (input: { file: string; line: number; character: number }) => Effect.Effect<any[]>
  readonly signatureHelp: (input: { file: string; line: number; character: number }) => Effect.Effect<any>
  readonly completion: (input: { file: string; line: number; character: number }) => Effect.Effect<any[]>
  readonly formatting: (input: { file: string; tabSize?: number; insertSpaces?: boolean }) => Effect.Effect<any[]>
  readonly applyCodeAction: (input: { file: string; line: number; character: number; title: string; range?: Range }) => Effect.Effect<any[]>
  readonly removeClients: (root: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LSP") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const flags = yield* RuntimeFlags.Service
    const events = yield* EventV2Bridge.Service
    const launch = yield* LSPLaunchService
    const clientFactory = yield* LSPClientFactory

    const state = yield* InstanceState.make<State>(
      Effect.fn("LSP.state")(function* (_ctx) {
        const cfg = yield* config.get()

        const serverRegistry = makeServerRegistry()
        // Register built-in servers
        // (In real implementation, would import from registry.ts)

        const s: State = {
          clients: [],
          servers: HashMap.empty(),
          brokenServerTracker: makeBrokenServerTracker(),
          diagnosticStore: makeDiagnosticStore(""),
          serverRegistry,
          capabilityRegistry: makeCapabilityRegistry(),
          platformResolver: makePlatformResolver(),
          serverDownloader: makeServerDownloader(),
          spawning: HashMap.empty(),
          used: HashMap.empty(),
        }

        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            await Promise.all(s.clients.map((client) => client.shutdown()))
          }),
        )

        const prune = Effect.gen(function* () {
          const keys = selectIdleKeys(s.clients, s.used, Date.now(), IDLE_TTL)
          if (keys.length === 0) return
          const keySet = new Set(keys)
          yield* Effect.promise(() =>
            Promise.all(
              s.clients
                .filter((c) => keySet.has(clientKey(c.root, c.serverID)))
                .map((c) => c.shutdown().catch(() => {})),
            ),
          )
          s.clients = s.clients.filter((c) => !keySet.has(clientKey(c.root, c.serverID)))
          for (const key of keySet) {
            s.brokenServerTracker.markFixed(key.split("#")[0], key.split("#")[1])
            s.used = HashMap.remove(s.used, key)
          }
        })
        yield* prune.pipe(Effect.repeat(Schedule.spaced(Duration.minutes(1))), Effect.forkScoped)

        return s
      }),
    )

    const getClients = Effect.fnUntraced(function* (file: string) {
      const ctx = yield* InstanceState.context
      if (!containsPath(file, ctx)) return [] as ClientInfo[]
      const s = yield* InstanceState.get(state)
      const clients = yield* Effect.promise(async () => {
        const extension = path.parse(file).ext || file
        const result: ClientInfo[] = []

        for (const server of HashMap.values(s.servers)) {
          if (server.extensions.length && !server.extensions.includes(extension)) continue

          const root = await server.root(file, ctx)
          if (!root) continue
          if (s.brokenServerTracker.isBroken(root, server.id)) continue

          const match = s.clients.find((x) => x.root === root && x.serverID === server.id)
          if (match) {
            result.push(match)
            continue
          }

          const spawnKey = clientKey(root, server.id)
          let task = s.spawning.get(spawnKey)
          if (!task) {
            task = (async () => {
              const handle = await server.spawn(root, ctx, flags)
                .then((value) => {
                  if (!value) s.brokenServerTracker.markBroken(root, server.id)
                  return value
                })
                .catch(() => {
                  s.brokenServerTracker.markBroken(root, server.id)
                  return undefined
                })

              if (!handle) return undefined

              const client = await makeLSPClient(s.platformResolver)({
                serverID: server.id,
                server: handle,
                root,
                directory: ctx.directory,
                instance: ctx,
              }).catch(async () => {
                s.brokenServerTracker.markBroken(root, server.id)
                await Process.stop(handle.process)
                return undefined
              })

              if (!client) return undefined

              const existing = s.clients.find((x) => x.root === root && x.serverID === server.id)
              if (existing) {
                await Process.stop(handle.process)
                return existing
              }

              s.clients.push(client)
              return client
            })()
            s.spawning = HashMap.set(s.spawning, spawnKey, task)
            void task.finally(() => {
              if (s.spawning.get(spawnKey) === task) {
                s.spawning = HashMap.remove(s.spawning, spawnKey)
              }
            })
          }

          const client = await task
          if (!client) continue

          result.push(client)
        }

        return { result }
      })
      for (const client of clients.result) s.used = HashMap.set(s.used, clientKey(client.root, client.serverID), Date.now())
      return clients.result
    })

    const run = Effect.fnUntraced(function* <T>(file: string, fn: (client: ClientInfo) => Promise<T>) {
      const clients = yield* getClients(file)
      return yield* Effect.promise(() => Promise.all(clients.map((x) => fn(x))))
    })

    const runAll = Effect.fnUntraced(function* <T>(fn: (client: ClientInfo) => Promise<T>) {
      const s = yield* InstanceState.get(state)
      for (const client of s.clients) s.used = HashMap.set(s.used, clientKey(client.root, client.serverID), Date.now())
      return yield* Effect.promise(() => Promise.all(s.clients.map((x) => fn(x))))
    })

    const init = Effect.fn("LSP.init")(function* () {
      yield* InstanceState.get(state)
    })

    const status = Effect.fn("LSP.status")(function* () {
      const ctx = yield* InstanceState.context
      const s = yield* InstanceState.get(state)
      const result: Status[] = []
      for (const client of s.clients) {
        result.push({
          id: client.serverID,
          name: HashMap.get(s.servers, client.serverID)?.name ?? client.serverID,
          root: path.relative(ctx.directory, client.root),
          status: "connected",
        })
      }
      return result
    })

    const hasClients = Effect.fn("LSP.hasClients")(function* (file: string) {
      const ctx = yield* InstanceState.context
      const s = yield* InstanceState.get(state)
      return yield* Effect.promise(async () => {
        const extension = path.parse(file).ext || file
        for (const server of HashMap.values(s.servers)) {
          if (server.extensions.length && !server.extensions.includes(extension)) continue
          const root = await server.root(file, ctx)
          if (!root) continue
          if (s.brokenServerTracker.isBroken(root, server.id)) continue
          return true
        }
        return false
      })
    })

    const touchFile = Effect.fn("LSP.touchFile")(function* (input: string, diagnostics?: "document" | "full") {
      yield* Effect.logInfo("touching file", { file: input })
      const clients = yield* getClients(input)
      yield* Effect.promise(() =>
        Promise.all(
          clients.map(async (client) => {
            const after = Date.now()
            const version = await client.notify.open({ path: input })
            if (!diagnostics) return
            return client.waitForDiagnostics({
              path: input,
              version,
              mode: diagnostics,
              after,
            })
          }),
        ).catch(() => {}),
      )
    })

    const diagnostics = Effect.fn("LSP.diagnostics")(function* () {
      const s = yield* InstanceState.get(state)
      return s.diagnosticStore.getAllDiagnostics()
    })

    const makeRequest = <T>(method: string, params: Record<string, unknown>) =>
      Effect.fnUntraced(function* (file: string) {
        return yield* run(file, (client) =>
          client.connection
            .sendRequest<T>(method, params)
            .catch(() => null),
        )
      })

    const hover = Effect.fn("LSP.hover")(function* (input: { file: string; line: number; character: number }) {
      return yield* makeRequest<any>("textDocument/hover", {
        textDocument: { uri: pathToFileURL(input.file).href },
        position: { line: input.line, character: input.character },
      })(input.file)
    })

    const definition = Effect.fn("LSP.definition")(function* (input: { file: string; line: number; character: number }) {
      const results = yield* makeRequest<any>("textDocument/definition", {
        textDocument: { uri: pathToFileURL(input.file).href },
        position: { line: input.line, character: input.character },
      })(input.file)
      return results.flat().filter(Boolean)
    })

    const references = Effect.fn("LSP.references")(function* (input: { file: string; line: number; character: number }) {
      const results = yield* makeRequest<any>("textDocument/references", {
        textDocument: { uri: pathToFileURL(input.file).href },
        position: { line: input.line, character: input.character },
        context: { includeDeclaration: true },
      })(input.file)
      return results.flat().filter(Boolean)
    })

    const implementation = Effect.fn("LSP.implementation")(function* (input: { file: string; line: number; character: number }) {
      const results = yield* makeRequest<any>("textDocument/implementation", {
        textDocument: { uri: pathToFileURL(input.file).href },
        position: { line: input.line, character: input.character },
      })(input.file)
      return results.flat().filter(Boolean)
    })

    const documentSymbol = Effect.fn("LSP.documentSymbol")(function* (uri: string) {
      const file = fileURLToPath(uri)
      const results = yield* makeRequest<any>("textDocument/documentSymbol", { textDocument: { uri } })(file)
      return (results.flat() as any[]).filter(Boolean)
    })

    const workspaceSymbol = Effect.fn("LSP.workspaceSymbol")(function* (query: string) {
      const results = yield* runAll((client) =>
        client.connection
          .sendRequest<any[]>("workspace/symbol", { query })
          .then((result) => result.filter((x: any) => [5, 6, 7, 11, 13, 14, 23].includes(x.kind)).slice(0, 10))
          .catch(() => []),
      )
      return results.flat()
    })

    const prepareCallHierarchy = Effect.fn("LSP.prepareCallHierarchy")(function* (input: { file: string; line: number; character: number }) {
      const results = yield* makeRequest<any>("textDocument/prepareCallHierarchy", {
        textDocument: { uri: pathToFileURL(input.file).href },
        position: { line: input.line, character: input.character },
      })(input.file)
      return results.flat().filter(Boolean)
    })

    const callHierarchyRequest = Effect.fnUntraced(function* (
      input: { file: string; line: number; character: number },
      direction: "callHierarchy/incomingCalls" | "callHierarchy/outgoingCalls",
    ) {
      const results = yield* run(input.file, async (client) => {
        const items = await client.connection
          .sendRequest<any[] | null>("textDocument/prepareCallHierarchy", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => [])
        if (!items?.length) return []
        return client.connection.sendRequest(direction, { item: items[0] }).catch(() => [])
      })
      return results.flat().filter(Boolean)
    })

    const incomingCalls = Effect.fn("LSP.incomingCalls")(function* (input: { file: string; line: number; character: number }) {
      return yield* callHierarchyRequest(input, "callHierarchy/incomingCalls")
    })

    const outgoingCalls = Effect.fn("LSP.outgoingCalls")(function* (input: { file: string; line: number; character: number }) {
      return yield* callHierarchyRequest(input, "callHierarchy/outgoingCalls")
    })

    const codeAction = Effect.fn("LSP.codeAction")(function* (input: { file: string; line: number; character: number; range?: Range }) {
      const results = yield* makeRequest<any>("textDocument/codeAction", {
        textDocument: { uri: pathToFileURL(input.file).href },
        range: input.range ?? {
          start: { line: input.line, character: input.character },
          end: { line: input.line, character: input.character },
        },
        context: { diagnostics: [] },
      })(input.file)
      return results.flat().filter(Boolean)
    })

    const prepareRename = Effect.fn("LSP.prepareRename")(function* (input: { file: string; line: number; character: number }) {
      const results = yield* makeRequest<any>("textDocument/prepareRename", {
        textDocument: { uri: pathToFileURL(input.file).href },
        position: { line: input.line, character: input.character },
      })(input.file)
      return results.filter(Boolean)
    })

    const rename = Effect.fn("LSP.rename")(function* (input: { file: string; line: number; character: number; newName: string }) {
      const results = yield* makeRequest<any>("textDocument/rename", {
        textDocument: { uri: pathToFileURL(input.file).href },
        position: { line: input.line, character: input.character },
        newName: input.newName,
      })(input.file)
      return results.filter(Boolean)
    })

    const typeDefinition = Effect.fn("LSP.typeDefinition")(function* (input: { file: string; line: number; character: number }) {
      const results = yield* makeRequest<any>("textDocument/typeDefinition", {
        textDocument: { uri: pathToFileURL(input.file).href },
        position: { line: input.line, character: input.character },
      })(input.file)
      return results.flat().filter(Boolean)
    })

    const signatureHelp = Effect.fn("LSP.signatureHelp")(function* (input: { file: string; line: number; character: number }) {
      const results = yield* makeRequest<any>("textDocument/signatureHelp", {
        textDocument: { uri: pathToFileURL(input.file).href },
        position: { line: input.line, character: input.character },
      })(input.file)
      return results.filter(Boolean)
    })

    const completion = Effect.fn("LSP.completion")(function* (input: { file: string; line: number; character: number }) {
      const results = yield* makeRequest<any>("textDocument/completion", {
        textDocument: { uri: pathToFileURL(input.file).href },
        position: { line: input.line, character: input.character },
      })(input.file)
      return results.flat().filter(Boolean)
    })

    const formatting = Effect.fn("LSP.formatting")(function* (input: { file: string; tabSize?: number; insertSpaces?: boolean }) {
      const results = yield* makeRequest<any>("textDocument/formatting", {
        textDocument: { uri: pathToFileURL(input.file).href },
        options: {
          tabSize: input.tabSize ?? 2,
          insertSpaces: input.insertSpaces ?? true,
        },
      })(input.file)
      return results.flat().filter(Boolean)
    })

    const applyCodeAction = Effect.fn("LSP.applyCodeAction")(function* (
      input: { file: string; line: number; character: number; title: string; range?: Range },
    ) {
      const results = yield* run(input.file, async (client) => {
        const actions = await client.connection
          .sendRequest<any[]>("textDocument/codeAction", {
            textDocument: { uri: pathToFileURL(input.file).href },
            range: input.range ?? {
              start: { line: input.line, character: input.character },
              end: { line: input.line, character: input.character },
            },
            context: { diagnostics: [] },
          })
          .catch(() => [])
        return actions.find((a: any) => a.title === input.title) ?? null
      })
      return results.filter(Boolean)
    })

    const removeClients = Effect.fn("LSP.removeClients")(function* (root: string) {
      const s = yield* InstanceState.get(state)
      const toRemove = s.clients.filter((c) => c.root === root)
      for (const client of toRemove) {
        yield* Effect.promise(() => client.shutdown())
      }
      s.clients = s.clients.filter((c) => c.root !== root)
      s.brokenServerTracker.prune()
      for (const key of HashMap.keys(s.servers)) {
        if (!HashMap.has(s.servers, key)) HashMap.remove(s.servers, key)
      }
    })

    return Service.of({
      init,
      status,
      hasClients,
      touchFile,
      diagnostics,
      hover,
      definition,
      references,
      implementation,
      documentSymbol,
      workspaceSymbol,
      prepareCallHierarchy,
      incomingCalls,
      outgoingCalls,
      codeAction,
      rename,
      prepareRename,
      typeDefinition,
      signatureHelp,
      completion,
      formatting,
      applyCodeAction,
      removeClients,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(RuntimeFlags.defaultLayer),
  Layer.provide(EventV2Bridge.defaultLayer),
  Layer.provide(LSPClientFactoryLive),
  Layer.provide(LSPLaunchLive),
)

export const node = LayerNode.make(layer, [
  Config.node,
  RuntimeFlags.node,
  FSUtil.node,
  EventV2Bridge.node,
])

export * as LSP from "./lsp"