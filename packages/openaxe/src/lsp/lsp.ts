import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceState } from "@/effect/instance-state"
import { containsPath } from "@/project/instance-context"
import { Process } from "@/util/process"
import { spawn } from "./launch"
import { Effect, Layer, Context, Schedule, Duration, Schema } from "effect"
import { LSPServer, type Info as ServerInfo } from "./server"
import { create, type Info as ClientInfo, type Diagnostic } from "./client"
import * as DiagnosticNS from "./diagnostic"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { LspEvent } from "@opencode-ai/schema/lsp-event"
import path from "path"
import { pathToFileURL, fileURLToPath } from "url"

const BROKEN_TTL = 300_000
const IDLE_TTL = 15 * 60_000

function clientKey(root: string, serverID: string): string {
  return `${root}#${serverID}`
}

function checkBroken(s: State, root: string, serverID: string): boolean {
  const key = clientKey(root, serverID)
  const brokenAt = s.broken.get(key)
  if (brokenAt && Date.now() - brokenAt < BROKEN_TTL) return true
  if (brokenAt) s.broken.delete(key)
  return false
}

function filterExperimentalServers(servers: Record<string, ServerInfo>, flags: RuntimeFlags.Info) {
  if (flags.experimentalLspTy) {
    if (servers["pyright"]) delete servers["pyright"]
  } else {
    if (servers["ty"]) delete servers["ty"]
  }
}

type LocInput = { file: string; line: number; character: number }

const Position = Schema.Struct({
  line: NonNegativeInt,
  character: NonNegativeInt,
})

const Range = Schema.Struct({
  start: Position,
  end: Position,
}).annotate({ identifier: "Range" })
export type Range = typeof Range.Type

const SymbolKind = Schema.Struct({
  name: Schema.String,
  kind: NonNegativeInt,
  location: Schema.Struct({
    uri: Schema.String,
    range: Range,
  }),
}).annotate({ identifier: "Symbol" })
export type Symbol = typeof SymbolKind.Type

const DocumentSymbolKind = Schema.Struct({
  name: Schema.String,
  detail: Schema.optional(Schema.String),
  kind: NonNegativeInt,
  range: Range,
  selectionRange: Range,
}).annotate({ identifier: "DocumentSymbol" })
export type DocumentSymbol = typeof DocumentSymbolKind.Type

const StatusKind = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  root: Schema.String,
  status: Schema.Literals(["connected", "error"]),
}).annotate({ identifier: "LSPStatus" })
export type Status = typeof StatusKind.Type

const LspSymbolKind = {
  File: 1,
  Module: 2,
  Namespace: 3,
  Package: 4,
  Class: 5,
  Method: 6,
  Property: 7,
  Field: 8,
  Constructor: 9,
  Enum: 10,
  Interface: 11,
  Function: 12,
  Variable: 13,
  Constant: 14,
  String: 15,
  Number: 16,
  Boolean: 17,
  Array: 18,
  Object: 19,
  Key: 20,
  Null: 21,
  EnumMember: 22,
  Struct: 23,
  Event: 24,
  Operator: 25,
  TypeParameter: 26,
} as const

const kinds = [
  LspSymbolKind.Class,
  LspSymbolKind.Function,
  LspSymbolKind.Method,
  LspSymbolKind.Interface,
  LspSymbolKind.Variable,
  LspSymbolKind.Constant,
  LspSymbolKind.Struct,
  LspSymbolKind.Enum,
]

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly status: () => Effect.Effect<Status[]>
  readonly hasClients: (file: string) => Effect.Effect<boolean>
  readonly touchFile: (input: string, diagnostics?: "document" | "full") => Effect.Effect<void>
  readonly diagnostics: () => Effect.Effect<Record<string, Diagnostic[]>>
  readonly hover: (input: LocInput) => Effect.Effect<any>
  readonly definition: (input: LocInput) => Effect.Effect<any[]>
  readonly references: (input: LocInput) => Effect.Effect<any[]>
  readonly implementation: (input: LocInput) => Effect.Effect<any[]>
  readonly documentSymbol: (uri: string) => Effect.Effect<(DocumentSymbol | Symbol)[]>
  readonly workspaceSymbol: (query: string) => Effect.Effect<Symbol[]>
  readonly prepareCallHierarchy: (input: LocInput) => Effect.Effect<any[]>
  readonly incomingCalls: (input: LocInput) => Effect.Effect<any[]>
  readonly outgoingCalls: (input: LocInput) => Effect.Effect<any[]>
  readonly codeAction: (input: LocInput & { range?: Range }) => Effect.Effect<any[]>
  readonly rename: (input: LocInput & { newName: string }) => Effect.Effect<any[]>
  readonly prepareRename: (input: LocInput) => Effect.Effect<any>
  readonly typeDefinition: (input: LocInput) => Effect.Effect<any[]>
  readonly signatureHelp: (input: LocInput) => Effect.Effect<any>
  readonly completion: (input: LocInput) => Effect.Effect<any[]>
  readonly formatting: (input: { file: string; tabSize?: number; insertSpaces?: boolean }) => Effect.Effect<any[]>
  readonly applyCodeAction: (input: LocInput & { title: string; range?: Range }) => Effect.Effect<any[]>
  readonly removeClients: (root: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LSP") {}

interface State {
  clients: ClientInfo[]
  servers: Record<string, ServerInfo>
  broken: Map<string, number>
  spawning: Map<string, Promise<ClientInfo | undefined>>
  used: Map<string, number>
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const flags = yield* RuntimeFlags.Service
    const events = yield* EventV2Bridge.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("LSP.state")(function* (_ctx) {
        const cfg = yield* config.get()

        const servers: Record<string, ServerInfo> = {}

        if (!cfg.lsp) {
          yield* Effect.logInfo("all LSPs are disabled")
        } else {
          for (const [key, server] of Object.entries(LSPServer))
            if (key !== "LSPServer") servers[(server as ServerInfo).id] = server as ServerInfo

          filterExperimentalServers(servers, flags)

          if (cfg.lsp !== true) {
            for (const [name, item] of Object.entries(cfg.lsp)) {
              const existing = servers[name]
              if (item.disabled) {
                yield* Effect.logInfo(`LSP server ${name} is disabled`)
                delete servers[name]
                continue
              }
              servers[name] = {
                ...existing,
                id: name,
                root: existing?.root ?? (async (_file: string, ctx: any) => ctx.directory),
                extensions: item.extensions ?? existing?.extensions ?? [],
                spawn: async (root: string) => ({
                  process: spawn(item.command[0], item.command.slice(1), {
                    cwd: root,
                    env: { ...process.env, ...item.env },
                  }),
                  initialization: item.initialization,
                }),
              }
            }
          }

          yield* Effect.logInfo("enabled LSP servers", {
            serverIds: Object.values(servers)
              .map((server) => server.id)
              .join(", "),
          })
        }

        const s: State = {
          clients: [],
          servers,
          broken: new Map(),
          spawning: new Map(),
          used: new Map(),
        }

        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            await Promise.all(s.clients.map((client) => client.shutdown()))
          }),
        )

        const prune = Effect.gen(function* () {
          const now = Date.now()
          const keys = s.clients
            .filter((c) => now - (s.used.get(clientKey(c.root, c.serverID)) ?? now) > IDLE_TTL)
            .map((c) => clientKey(c.root, c.serverID))
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
            s.broken.delete(key)
            s.used.delete(key)
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

      async function schedule(server: ServerInfo, root: string, key: string) {
        const handle = await server
          .spawn(root, ctx, flags)
          .then((value) => {
            if (!value) s.broken.set(key, Date.now())
            return value
          })
          .catch(() => {
            s.broken.set(key, Date.now())
            return undefined
          })

        if (!handle) return undefined
        const client = await create({
          serverID: server.id,
          server: handle,
          root,
          directory: ctx.directory,
          instance: ctx,
        }).catch(async () => {
          s.broken.set(key, Date.now())
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
      }

      const extension = path.parse(file).ext || file
      const servers = Object.values(s.servers).filter(
        (server) => !server.extensions.length || server.extensions.includes(extension),
      )
      // Servers spawn independently; the spawning map still dedupes concurrent
      // spawns for the same server+root pair. forEach preserves input order so
      // the returned client list stays deterministic.
      const settled = yield* Effect.forEach(
        servers,
        (server) =>
          Effect.promise(async () => {
            const root = await server.root(file, ctx)
            if (!root) return undefined
            if (checkBroken(s, root, server.id)) return undefined

            const match = s.clients.find((x) => x.root === root && x.serverID === server.id)
            if (match) return { client: match, fresh: false }

            const spawnKey = clientKey(root, server.id)
            let task = s.spawning.get(spawnKey)
            if (!task) {
              task = schedule(server, root, spawnKey)
              s.spawning.set(spawnKey, task)
              void task.finally(() => {
                if (s.spawning.get(spawnKey) === task) {
                  s.spawning.delete(spawnKey)
                }
              })
            }

            const client = await task
            if (!client) return undefined
            return { client, fresh: true }
          }),
        { concurrency: "unbounded" },
      )
      const clients = settled.filter((x) => x !== undefined)
      const fresh = clients.filter((x) => x.fresh)
      yield* Effect.forEach(Array.from({ length: fresh.length }), () => events.publish(LspEvent.Updated, {}), {
        discard: true,
      })
      for (const { client } of clients) s.used.set(clientKey(client.root, client.serverID), Date.now())
      return clients.map((x) => x.client)
    })

    const run = Effect.fnUntraced(function* <T>(file: string, fn: (client: ClientInfo) => Promise<T>) {
      const clients = yield* getClients(file)
      return yield* Effect.promise(() => Promise.all(clients.map((x) => fn(x))))
    })

    const runAll = Effect.fnUntraced(function* <T>(fn: (client: ClientInfo) => Promise<T>) {
      const s = yield* InstanceState.get(state)
      for (const client of s.clients) s.used.set(clientKey(client.root, client.serverID), Date.now())
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
          name: s.servers[client.serverID].id,
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
        for (const server of Object.values(s.servers)) {
          if (server.extensions.length && !server.extensions.includes(extension)) continue
          const root = await server.root(file, ctx)
          if (!root) continue
          if (checkBroken(s, root, server.id)) continue
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
      const results: Record<string, Diagnostic[]> = {}
      const all = yield* runAll(async (client) => client.diagnostics)
      for (const result of all) {
        for (const [p, diags] of result.entries()) {
          const arr = results[p] || []
          arr.push(...diags)
          results[p] = arr
        }
      }
      return results
    })

    const hover = Effect.fn("LSP.hover")(function* (input: LocInput) {
      return yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/hover", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => null),
      )
    })

    const definition = Effect.fn("LSP.definition")(function* (input: LocInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/definition", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => null),
      )
      return results.flat().filter(Boolean)
    })

    const references = Effect.fn("LSP.references")(function* (input: LocInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/references", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
            context: { includeDeclaration: true },
          })
          .catch(() => []),
      )
      return results.flat().filter(Boolean)
    })

    const implementation = Effect.fn("LSP.implementation")(function* (input: LocInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/implementation", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => null),
      )
      return results.flat().filter(Boolean)
    })

    const documentSymbol = Effect.fn("LSP.documentSymbol")(function* (uri: string) {
      const file = fileURLToPath(uri)
      const results = yield* run(file, (client) =>
        client.connection.sendRequest("textDocument/documentSymbol", { textDocument: { uri } }).catch(() => []),
      )
      return (results.flat() as (DocumentSymbol | Symbol)[]).filter(Boolean)
    })

    const workspaceSymbol = Effect.fn("LSP.workspaceSymbol")(function* (query: string) {
      const results = yield* runAll((client) =>
        client.connection
          .sendRequest<Symbol[]>("workspace/symbol", { query })
          .then((result) => result.filter((x) => (kinds as number[]).includes(x.kind)).slice(0, 10))
          .catch(() => [] as Symbol[]),
      )
      return results.flat()
    })

    const prepareCallHierarchy = Effect.fn("LSP.prepareCallHierarchy")(function* (input: LocInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/prepareCallHierarchy", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => []),
      )
      return results.flat().filter(Boolean)
    })

    const callHierarchyRequest = Effect.fnUntraced(function* (
      input: LocInput,
      direction: "callHierarchy/incomingCalls" | "callHierarchy/outgoingCalls",
    ) {
      const results = yield* run(input.file, async (client) => {
        const items = await client.connection
          .sendRequest<unknown[] | null>("textDocument/prepareCallHierarchy", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => [] as unknown[])
        if (!items?.length) return []
        return client.connection.sendRequest(direction, { item: items[0] }).catch(() => [])
      })
      return results.flat().filter(Boolean)
    })

    const incomingCalls = Effect.fn("LSP.incomingCalls")(function* (input: LocInput) {
      return yield* callHierarchyRequest(input, "callHierarchy/incomingCalls")
    })

    const outgoingCalls = Effect.fn("LSP.outgoingCalls")(function* (input: LocInput) {
      return yield* callHierarchyRequest(input, "callHierarchy/outgoingCalls")
    })

    const codeAction = Effect.fn("LSP.codeAction")(function* (input: LocInput & { range?: Range }) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/codeAction", {
            textDocument: { uri: pathToFileURL(input.file).href },
            range: input.range ?? {
              start: { line: input.line, character: input.character },
              end: { line: input.line, character: input.character },
            },
            context: { diagnostics: [] },
          })
          .catch(() => []),
      )
      return results.flat().filter(Boolean)
    })

    const prepareRename = Effect.fn("LSP.prepareRename")(function* (input: LocInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/prepareRename", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => null),
      )
      return results.filter(Boolean)
    })

    const rename = Effect.fn("LSP.rename")(function* (input: LocInput & { newName: string }) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/rename", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
            newName: input.newName,
          })
          .catch(() => null),
      )
      return results.filter(Boolean)
    })

    const typeDefinition = Effect.fn("LSP.typeDefinition")(function* (input: LocInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/typeDefinition", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => null),
      )
      return results.flat().filter(Boolean)
    })

    const signatureHelp = Effect.fn("LSP.signatureHelp")(function* (input: LocInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/signatureHelp", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => null),
      )
      return results.filter(Boolean)
    })

    const completion = Effect.fn("LSP.completion")(function* (input: LocInput) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/completion", {
            textDocument: { uri: pathToFileURL(input.file).href },
            position: { line: input.line, character: input.character },
          })
          .catch(() => []),
      )
      return results.flat().filter(Boolean)
    })

    const formatting = Effect.fn("LSP.formatting")(function* (input: {
      file: string
      tabSize?: number
      insertSpaces?: boolean
    }) {
      const results = yield* run(input.file, (client) =>
        client.connection
          .sendRequest("textDocument/formatting", {
            textDocument: { uri: pathToFileURL(input.file).href },
            options: {
              tabSize: input.tabSize ?? 2,
              insertSpaces: input.insertSpaces ?? true,
            },
          })
          .catch(() => []),
      )
      return results.flat().filter(Boolean)
    })

    const applyCodeAction = Effect.fn("LSP.applyCodeAction")(function* (
      input: LocInput & { title: string; range?: Range },
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
      s.broken.clear()
      for (const key of Object.keys(s.servers)) {
        if (!s.servers[key]) delete s.servers[key]
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
)

export const node = LayerNode.make(layer, [Config.node, RuntimeFlags.node, EventV2Bridge.node])

export { LspEvent as Event }
export type { Diagnostic } from "./client"

export function selectIdleKeys(
  clients: { root: string; serverID: string }[],
  used: Map<string, number>,
  now: number,
  ttl: number,
) {
  return clients
    .filter((c) => now - (used.get(clientKey(c.root, c.serverID)) ?? now) > ttl)
    .map((c) => clientKey(c.root, c.serverID))
}

export const LSP = {
  Service,
  layer,
  defaultLayer,
  node,
  selectIdleKeys,
  Event: LspEvent,
  Symbol: SymbolKind,
  Status: StatusKind,
  Range,
  DocumentSymbol: DocumentSymbolKind,
  Diagnostic: DiagnosticNS,
}

export type LSPService = typeof Service
