// @ts-nocheck
import { Effect, Layer, Context, FileSystem, ChildProcess, Duration, Timeout } from "effect"
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node"
import { Schema } from "effect"
import { LSPClient, Diagnostic } from "./types"
import { makePlatformResolver } from "./platform"
import path from "path"

const DIAGNOSTICS_DEBOUNCE_MS = 150
const DIAGNOSTICS_DOCUMENT_WAIT_TIMEOUT_MS = 5_000
const DIAGNOSTICS_FULL_WAIT_TIMEOUT_MS = 10_000
const DIAGNOSTICS_REQUEST_TIMEOUT_MS = 3_000

const INITIALIZE_TIMEOUT_MS = 45_000

const FILE_CHANGE_CREATED = 1
const FILE_CHANGE_CHANGED = 2
const TEXT_DOCUMENT_SYNC_INCREMENTAL = 2

export class InitializeError extends Schema.TaggedErrorClass<InitializeError>()("LSPInitializeError", {
  serverID: Schema.String,
  stderr: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {}

type DocumentDiagnosticReport = {
  items?: Diagnostic[]
  relatedDocuments?: Record<string, DocumentDiagnosticReport>
}

type WorkspaceDiagnosticReport = {
  items?: Array<{
    uri?: string
    items?: Diagnostic[]
  }>
}

type DiagnosticRequestResult = {
  handled: boolean
  matched: boolean
  byFile: Map<string, Diagnostic[]>
}

type CapabilityRegistration = {
  id: string
  method: string
  registerOptions?: {
    identifier?: string
    workspaceDiagnostics?: boolean
  }
}

type ServerCapabilitiesInternal = ServerCapabilities

function getFilePath(uri: string): string | undefined {
  if (!uri.startsWith("file://")) return undefined
  return path.normalize(new URL(uri).pathname)
}

// oxlint-disable-next-line typescript/no-redundant-type-constituents -- TextDocumentSyncKind from vscode-languageserver-protocol
function getSyncKind(capabilities?: ServerCapabilitiesInternal): TextDocumentSyncKind | undefined {
  if (!capabilities) return undefined
  const sync = capabilities.textDocumentSync
  if (typeof sync === "number") return sync
  return sync?.change
}

function endPosition(text: string): Position {
  const lines = text.split(/\r\n|\r|\n/)
  return {
    line: lines.length - 1,
    character: lines.at(-1)?.length ?? 0,
  }
}

function dedupeDiagnostics(items: Diagnostic[]): Diagnostic[] {
  const seen = new Map<string, boolean>()
  return items.filter((item) => {
    const key = `${item.code ?? ""}|${item.severity ?? ""}|${item.message ?? ""}|${item.source ?? ""}|${item.range?.start.line ?? ""}:${item.range?.start.character ?? ""}:${item.range?.end.line ?? ""}:${item.range?.end.character ?? ""}`
    if (seen.has(key)) return false
    seen.set(key, true)
    return true
  })
}

function configurationValue(settings: unknown, section?: string): unknown {
  if (!section) return settings ?? null
  return (
    section.split(".").reduce((acc, key) => {
      if (!acc || typeof acc !== "object" || !(key in acc)) return undefined
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- traversing unknown object by string key
      return (acc as Record<string, unknown>)[key]
    }, settings) ?? null
  )
}

function shouldSeedDiagnosticsOnFirstPush(serverID: string): boolean {
  return serverID === "typescript"
}

/**
 * LSP Client Factory - Creates LSP client with full protocol support
 */

export interface ClientHandle {
  process: ChildProcess.ChildProcess
  initialization?: Record<string, unknown>
}

export const makeLSPClient = () => {
  return async function create(input: {
    serverID: string
    server: ClientHandle
    root: string
    directory: string
    instance: InstanceContext
  }): Promise<LSPClient> {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- child process streams compatible with NodeJS streams
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- stdout/stderr from child process have error types
    const connection = createMessageConnection(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- stdout from child process has error type
      new StreamMessageReader(input.server.process.stdout as NodeJS.ReadableStream),
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- stdin from child process has error type
      new StreamMessageWriter(input.server.process.stdin as NodeJS.WritableStream),
    )

    const STDERR_BUFFER_LIMIT = 50
    const stderrBuffer: string[] = []
    input.server.process.stderr?.on("data", (chunk: Buffer | string) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (line) stderrBuffer.push(line)
      }
      if (stderrBuffer.length > STDERR_BUFFER_LIMIT) stderrBuffer.splice(0, stderrBuffer.length - STDERR_BUFFER_LIMIT)
    })

    const pushDiagnostics = new Map<string, Diagnostic[]>()
    const pullDiagnostics = new Map<string, Diagnostic[]>()
    const published = new Map<string, { at: number; version?: number }>()
    const diagnosticRegistrations = new Map<string, CapabilityRegistration>()
    const registrationListeners = new Set<() => void>()
    const diagnosticListeners = new Set<(input: { path: string; serverID: string }) => void>()

    const mergedDiagnostics = (filePath: string): Diagnostic[] =>
      dedupeDiagnostics([...(pushDiagnostics.get(filePath) ?? []), ...(pullDiagnostics.get(filePath) ?? [])])

    const updatePushDiagnostics = (filePath: string, next: Diagnostic[]): void => {
      pushDiagnostics.set(filePath, next)
      for (const listener of diagnosticListeners) listener({ path: filePath, serverID: input.serverID })
    }

    const updatePullDiagnostics = (filePath: string, next: Diagnostic[]): void => {
      pullDiagnostics.set(filePath, next)
    }

    const emitRegistrationChange = (): void => {
      for (const listener of registrationListeners) listener()
    }

    // Connection handlers
    connection.onNotification("textDocument/publishDiagnostics", (params) => {
      const filePath = getFilePath(params.uri)
      if (!filePath) return
      published.set(filePath, {
        at: Date.now(),
        version: typeof params.version === "number" ? params.version : undefined,
      })
      if (shouldSeedDiagnosticsOnFirstPush(input.serverID) && !pushDiagnostics.has(filePath)) {
        pushDiagnostics.set(filePath, params.diagnostics)
        return
      }
      updatePushDiagnostics(filePath, params.diagnostics)
    })

    connection.onRequest("window/workDoneProgress/create", () => null)

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- LSP protocol params shape known at runtime
    connection.onRequest("workspace/configuration", async (params) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- LSP protocol params shape known at runtime
      const items = (params as { items?: { section?: string }[] }).items ?? []
      return items.map((item) => configurationValue(input.server.initialization, item.section))
    })

    connection.onRequest("client/registerCapability", async (params) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- LSP protocol params shape known at runtime
      const registrations = (params as { registrations?: CapabilityRegistration[] }).registrations ?? []
      let changed = false
      for (const registration of registrations) {
        if (registration.method !== "textDocument/diagnostic") continue
        diagnosticRegistrations.set(registration.id, registration)
        changed = true
      }
      if (changed) emitRegistrationChange()
    })

    connection.onRequest("client/unregisterCapability", async (params) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- LSP protocol params shape known at runtime
      const registrations = (params as { unregisterations?: { id: string; method: string }[] }).unregisterations ?? []
      let changed = false
      for (const registration of registrations) {
        if (registration.method !== "textDocument/diagnostic") continue
        diagnosticRegistrations.delete(registration.id)
        changed = true
      }
      if (changed) emitRegistrationChange()
    })

    connection.onRequest("workspace/workspaceFolders", async () => [
      {
        name: "workspace",
        uri: new URL(`file://${input.root}`).href,
      },
    ])

    connection.onRequest("workspace/diagnostic/refresh", async () => null)

    connection.listen()

    // Initialize handshake
    const initialized = await Effect.runPromise(
      Timeout.timeout(
        Effect.tryPromise(() =>
          connection.sendRequest<{ capabilities?: ServerCapabilitiesInternal }>("initialize", {
            rootUri: new URL(`file://${input.root}`).href,
            processId: input.server.process.pid,
            workspaceFolders: [
              {
                name: "workspace",
                uri: new URL(`file://${input.root}`).href,
              },
            ],
            initializationOptions: {
              ...input.server.initialization,
            },
            capabilities: {
              window: { workDoneProgress: true },
              workspace: {
                configuration: true,
                didChangeWatchedFiles: { dynamicRegistration: true },
                diagnostics: { refreshSupport: false },
              },
              textDocument: {
                synchronization: { didOpen: true, didChange: true },
                diagnostic: { dynamicRegistration: true, relatedDocumentSupport: true },
                publishDiagnostics: { versionSupport: false },
              },
            },
          }),
        ),
        Duration.millis(INITIALIZE_TIMEOUT_MS),
      ).pipe(
        Effect.catchAll((err) =>
          Effect.fail(
            new InitializeError({
              serverID: input.serverID,
              cause: err,
              ...(stderrBuffer.length > 0 ? { stderr: stderrBuffer.join("\n") } : {}),
            }),
          ),
        ),
      ),
    )

    const syncKind = getSyncKind(initialized.capabilities)
    const hasStaticPullDiagnostics = Boolean(initialized.capabilities?.diagnosticProvider)

    await connection.sendNotification("initialized", {})

    if (input.server.initialization) {
      await connection.sendNotification("workspace/didChangeConfiguration", {
        settings: input.server.initialization,
      })
    }

    const FILES_MAX_SIZE = 100
    const files = new Map<string, { version: number; text: string }>()
    const setFile = (filePath: string, entry: { version: number; text: string }) => {
      files.delete(filePath)
      files.set(filePath, entry)
      while (files.size > FILES_MAX_SIZE) {
        const oldest = files.keys().next().value
        if (oldest === undefined) break
        files.delete(oldest)
      }
    }

    const mergeResults = (
      filePath: string,
      results: DiagnosticRequestResult[],
    ): { handled: boolean; matched: boolean } => {
      const handled = results.some((result) => result.handled)
      const matched = results.some((result) => result.matched)
      if (!handled) return { handled: false, matched: false }

      const merged = new Map<string, Diagnostic[]>()
      for (const result of results) {
        for (const [target, items] of result.byFile.entries()) {
          const existing = merged.get(target) ?? []
          merged.set(target, existing.concat(items))
        }
      }

      if (matched && !merged.has(filePath)) merged.set(filePath, [])
      for (const [target, items] of merged.entries()) {
        updatePullDiagnostics(target, dedupeDiagnostics(items))
      }

      return { handled, matched }
    }

    async function requestDiagnosticReport(filePath: string, identifier?: string): Promise<DiagnosticRequestResult> {
      const report = await Effect.runPromise(
        Timeout.timeout(
          Effect.tryPromise(() =>
            connection.sendRequest<DocumentDiagnosticReport | null>("textDocument/diagnostic", {
              ...(identifier ? { identifier } : {}),
              textDocument: { uri: new URL(`file://${filePath}`).href },
            }),
          ),
          Duration.millis(DIAGNOSTICS_REQUEST_TIMEOUT_MS),
        ).pipe(Effect.catchAll(() => Effect.succeed(null))),
      )
      if (!report) return { handled: false, matched: false, byFile: new Map() }

      const byFile = new Map<string, Diagnostic[]>()
      const push = (target: string, items: Diagnostic[]) => {
        const existing = byFile.get(target) ?? []
        byFile.set(target, existing.concat(items))
      }

      let handled = false
      let matched = false
      if (Array.isArray(report.items)) {
        push(filePath, report.items)
        handled = true
        matched = true
      }
      for (const [uri, related] of Object.entries(report.relatedDocuments ?? {})) {
        const relatedPath = getFilePath(uri)
        if (!relatedPath || !Array.isArray(related.items)) continue
        push(relatedPath, related.items)
        handled = true
        matched = matched || relatedPath === filePath
      }

      return { handled, matched, byFile }
    }

    async function requestWorkspaceDiagnosticReport(
      filePath: string,
      identifier?: string,
    ): Promise<DiagnosticRequestResult> {
      const report = await Effect.runPromise(
        Timeout.timeout(
          Effect.tryPromise(() =>
            connection.sendRequest<WorkspaceDiagnosticReport | null>("workspace/diagnostic", {
              ...(identifier ? { identifier } : {}),
              previousResultIds: [],
            }),
          ),
          Duration.millis(DIAGNOSTICS_REQUEST_TIMEOUT_MS),
        ).pipe(Effect.catchAll(() => Effect.succeed(null))),
      )
      if (!report) return { handled: false, matched: false, byFile: new Map() }

      const byFile = new Map<string, Diagnostic[]>()
      let matched = false
      for (const item of report.items ?? []) {
        const relatedPath = item.uri ? getFilePath(item.uri) : undefined
        if (!relatedPath || !Array.isArray(item.items)) continue
        const existing = byFile.get(relatedPath) ?? []
        byFile.set(relatedPath, existing.concat(item.items))
        matched = matched || relatedPath === filePath
      }

      return { handled: true, matched, byFile }
    }

    function documentPullState() {
      const documentRegistrations = [...diagnosticRegistrations.values()].filter(
        (registration) => registration.registerOptions?.workspaceDiagnostics !== true,
      )
      return {
        documentIdentifiers: [
          ...new Set(documentRegistrations.flatMap((registration) => registration.registerOptions?.identifier ?? [])),
        ],
        supported: hasStaticPullDiagnostics || documentRegistrations.length > 0,
      }
    }

    function workspacePullState() {
      const workspaceRegistrations = [...diagnosticRegistrations.values()].filter(
        (registration) => registration.registerOptions?.workspaceDiagnostics === true,
      )
      return {
        workspaceIdentifiers: [
          ...new Set(workspaceRegistrations.flatMap((registration) => registration.registerOptions?.identifier ?? [])),
        ],
        supported: workspaceRegistrations.length > 0,
      }
    }

    const hasCurrentFileDiagnostics = (filePath: string, results: DiagnosticRequestResult[]) =>
      results.some((result) => (result.byFile.get(filePath)?.length ?? 0) > 0)

    async function requestDiagnostics(
      filePath: string,
      requests: Promise<DiagnosticRequestResult>[],
      done: (results: DiagnosticRequestResult[]) => boolean,
    ) {
      if (!requests.length) return { handled: false, matched: false }

      const results: DiagnosticRequestResult[] = []
      return new Promise<{ handled: boolean; matched: boolean }>((resolve) => {
        let pending = requests.length
        let resolved = false
        const finish = (merged: { handled: boolean; matched: boolean }, force = false) => {
          if (resolved) return
          if (!force && !done(results)) return
          resolved = true
          resolve(merged)
        }

        for (const request of requests) {
          void request.then((result) => {
            results.push(result)
            pending -= 1
            const merged = mergeResults(filePath, results)
            finish(merged)
            if (pending === 0) finish(merged, true)
          })
        }
      })
    }

    async function requestDocumentDiagnostics(filePath: string): Promise<{ handled: boolean; matched: boolean }> {
      const state = documentPullState()
      if (!state.supported) return { handled: false, matched: false }
      return requestDiagnostics(
        filePath,
        [
          requestDiagnosticReport(filePath),
          ...state.documentIdentifiers.map((identifier) => requestDiagnosticReport(filePath, identifier)),
        ],
        (results) => hasCurrentFileDiagnostics(filePath, results),
      )
    }

    async function requestFullDiagnostics(filePath: string): Promise<{ handled: boolean; matched: boolean }> {
      const documentState = documentPullState()
      const workspaceState = workspacePullState()
      if (!documentState.supported && !workspaceState.supported) return { handled: false, matched: false }
      return mergeResults(
        filePath,
        await Promise.all([
          ...(documentState.supported ? [requestDiagnosticReport(filePath)] : []),
          ...documentState.documentIdentifiers.map((identifier) => requestDiagnosticReport(filePath, identifier)),
          ...(workspaceState.supported ? [requestWorkspaceDiagnosticReport(filePath)] : []),
          ...workspaceState.workspaceIdentifiers.map((identifier) =>
            requestWorkspaceDiagnosticReport(filePath, identifier),
          ),
        ]),
      )
    }

    function waitForRegistrationChange(timeout: number, signal?: AbortSignal): Promise<boolean> {
      if (timeout <= 0) return Promise.resolve(false)
      return new Promise<boolean>((resolve) => {
        let finished = false
        let timer: ReturnType<typeof setTimeout> | undefined
        const finish = (result: boolean) => {
          if (finished) return
          finished = true
          if (timer) clearTimeout(timer)
          registrationListeners.delete(listener)
          signal?.removeEventListener("abort", onAbort)
          resolve(result)
        }
        const onAbort = () => finish(false)
        const listener = () => finish(true)
        registrationListeners.add(listener)
        signal?.addEventListener("abort", onAbort, { once: true })
        timer = setTimeout(() => finish(false), timeout)
      })
    }

    function waitForFreshPush(
      request: { path: string; version: number; after: number; timeout: number },
      signal?: AbortSignal,
    ): Promise<boolean> {
      if (request.timeout <= 0) return Promise.resolve(false)
      return new Promise<boolean>((resolve) => {
        let finished = false
        let debounceTimer: ReturnType<typeof setTimeout> | undefined
        let timeoutTimer: ReturnType<typeof setTimeout> | undefined
        let unsub: (() => void) | undefined
        const finish = (result: boolean) => {
          if (finished) return
          finished = true
          if (debounceTimer) clearTimeout(debounceTimer)
          if (timeoutTimer) clearTimeout(timeoutTimer)
          unsub?.()
          signal?.removeEventListener("abort", onAbort)
          resolve(result)
        }
        const onAbort = () => finish(false)
        const schedule = () => {
          const hit = published.get(request.path)
          if (!hit) return
          if (typeof hit.version === "number" && hit.version !== request.version) return
          if (hit.at < request.after && hit.version !== request.version) return
          if (debounceTimer) clearTimeout(debounceTimer)
          debounceTimer = setTimeout(() => finish(true), Math.max(0, DIAGNOSTICS_DEBOUNCE_MS - (Date.now() - hit.at)))
        }

        timeoutTimer = setTimeout(() => finish(false), request.timeout)
        const listener = (event: { path: string; serverID: string }) => {
          if (event.path !== request.path || event.serverID !== input.serverID) return
          schedule()
        }
        diagnosticListeners.add(listener)
        unsub = () => diagnosticListeners.delete(listener)
        signal?.addEventListener("abort", onAbort, { once: true })
        schedule()
      })
    }

    async function waitForDocumentDiagnostics(request: {
      path: string
      version: number
      after?: number
    }): Promise<void> {
      const startedAt = request.after ?? Date.now()
      const controller = new AbortController()
      const pushWait = waitForFreshPush(
        {
          path: request.path,
          version: request.version,
          after: startedAt,
          timeout: DIAGNOSTICS_DOCUMENT_WAIT_TIMEOUT_MS,
        },
        controller.signal,
      )

      try {
        while (Date.now() - startedAt < DIAGNOSTICS_DOCUMENT_WAIT_TIMEOUT_MS) {
          const result = await requestDocumentDiagnostics(request.path)
          if (result.matched) return
          const remaining = DIAGNOSTICS_DOCUMENT_WAIT_TIMEOUT_MS - (Date.now() - startedAt)
          if (remaining <= 0) return
          const next = await Promise.race([
            pushWait.then((ready) => (ready ? "push" : ("timeout" as const))),
            waitForRegistrationChange(remaining, controller.signal).then((changed) =>
              changed ? "registration" : ("timeout" as const),
            ),
            new Promise<"delay">((resolve) => setTimeout(() => resolve("delay"), Math.min(50, remaining))),
          ])
          if (next !== "registration") return
        }
      } finally {
        controller.abort()
      }
    }

    async function waitForFullDiagnostics(request: { path: string; version: number; after?: number }): Promise<void> {
      const startedAt = request.after ?? Date.now()
      const controller = new AbortController()
      const pushWait = waitForFreshPush(
        {
          path: request.path,
          version: request.version,
          after: startedAt,
          timeout: DIAGNOSTICS_FULL_WAIT_TIMEOUT_MS,
        },
        controller.signal,
      )

      try {
        while (Date.now() - startedAt < DIAGNOSTICS_FULL_WAIT_TIMEOUT_MS) {
          const result = await requestFullDiagnostics(request.path)
          if (result.handled || result.matched) return
          const remaining = DIAGNOSTICS_FULL_WAIT_TIMEOUT_MS - (Date.now() - startedAt)
          if (remaining <= 0) return
          const next = await Promise.race([
            pushWait.then((ready) => (ready ? "push" : ("timeout" as const))),
            waitForRegistrationChange(remaining, controller.signal).then((changed) =>
              changed ? "registration" : ("timeout" as const),
            ),
            new Promise<"delay">((resolve) => setTimeout(() => resolve("delay"), Math.min(50, remaining))),
          ])
          if (next !== "registration") return
        }
      } finally {
        controller.abort()
      }
    }

    const notify = {
      async open(request: { path: string }): Promise<number> {
        const fileSystem = FileSystem.FileSystem
        request.path = path.normalize(
          path.isAbsolute(request.path) ? request.path : path.resolve(input.directory, request.path),
        )
        const text = await Effect.runPromise(fileSystem.readFileString(request.path))
        const extension = path.extname(request.path)
        const languageId = LANGUAGE_EXTENSIONS[extension] ?? "plaintext"

        const document = files.get(request.path)
        if (document !== undefined) {
          await connection.sendNotification("workspace/didChangeWatchedFiles", {
            changes: [
              {
                uri: new URL(`file://${request.path}`).href,
                type: FILE_CHANGE_CHANGED,
              },
            ],
          })

          const next = document.version + 1
          setFile(request.path, { version: next, text })
          await connection.sendNotification("textDocument/didChange", {
            textDocument: {
              uri: new URL(`file://${request.path}`).href,
              version: next,
            },
            contentChanges:
              syncKind === TEXT_DOCUMENT_SYNC_INCREMENTAL
                ? [
                    {
                      range: {
                        start: { line: 0, character: 0 },
                        end: endPosition(document.text),
                      },
                      text,
                    },
                  ]
                : [{ text }],
          })
          return next
        }

        await connection.sendNotification("workspace/didChangeWatchedFiles", {
          changes: [
            {
              uri: new URL(`file://${request.path}`).href,
              type: FILE_CHANGE_CREATED,
            },
          ],
        })

        pushDiagnostics.delete(request.path)
        pullDiagnostics.delete(request.path)
        await connection.sendNotification("textDocument/didOpen", {
          textDocument: {
            uri: new URL(`file://${request.path}`).href,
            languageId,
            version: 0,
            text,
          },
        })
        setFile(request.path, { version: 0, text })
        return 0
      },
    }

    const result: LSPClient = {
      root: input.root,
      get serverID() {
        return input.serverID
      },
      get connection() {
        return connection
      },
      notify,
      get diagnostics() {
        const resultMap = new Map<string, Diagnostic[]>()
        for (const key of new Set([...pushDiagnostics.keys(), ...pullDiagnostics.keys()])) {
          resultMap.set(key, mergedDiagnostics(key))
        }
        return resultMap
      },
      async waitForDiagnostics(request: { path: string; version: number; mode?: "document" | "full"; after?: number }) {
        const normalizedPath = path.normalize(
          path.isAbsolute(request.path) ? request.path : path.resolve(input.directory, request.path),
        )
        if (request.mode === "document") {
          await waitForDocumentDiagnostics({ path: normalizedPath, version: request.version, after: request.after })
          return
        }
        await waitForFullDiagnostics({ path: normalizedPath, version: request.version, after: request.after })
      },
      async shutdown() {
        connection.end()
        connection.dispose()
        input.server.process.kill()
      },
    }

    return result
  }
}

/**
 * Language extension mapping
 */

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".py": "python",
  ".pyi": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".kt": "kotlin",
  ".ktm": "kotlin",
  ".kts": "kotlin",
  ".swift": "swift",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".c": "c",
  ".h": "c",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".lua": "lua",
  ".pl": "perl",
  ".pm": "perl",
  ".sh": "shellscript",
  ".bash": "shellscript",
  ".zsh": "shellscript",
  ".fish": "fish",
  ".ps1": "powershell",
  ".json": "json",
  ".jsonc": "jsonc",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".xml": "xml",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".sass": "sass",
  ".less": "less",
  ".vue": "vue",
  ".svelte": "svelte",
  ".astro": "astro",
  ".md": "markdown",
  ".mdx": "markdown",
  ".tex": "latex",
  ".bib": "bibtex",
  ".sql": "sql",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".proto": "protobuf",
  ".dockerfile": "dockerfile",
  Dockerfile: "dockerfile",
  ".tf": "terraform",
  ".tfvars": "terraform",
  ".nix": "nix",
  ".zig": "zig",
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".hrl": "erlang",
  ".clj": "clojure",
  ".cljs": "clojure",
  ".cljc": "clojure",
  ".edn": "clojure",
  ".fs": "fsharp",
  ".fsi": "fsharp",
  ".fsx": "fsharp",
  ".ml": "ocaml",
  ".mli": "ocaml",
  ".dart": "dart",
  ".scala": "scala",
  ".sc": "scala",
  ".groovy": "groovy",
  ".gradle": "groovy",
  ".r": "r",
  ".R": "r",
  ".jl": "julia",
  ".nim": "nim",
  ".cr": "crystal",
  ".v": "vlang",
  ".cshtml": "razor",
  ".razor": "razor",
  ".prisma": "prisma",
  ".sol": "solidity",
  ".move": "move",
  ".cairo": "cairo",
  ".vyper": "vyper",
}

/**
 * Service
 */

export class LSPClientFactory extends Context.Service<LSPClientFactory>()("@opencode/LSP/ClientFactory") {
  static Live = Layer.succeed(LSPClientFactory, makeLSPClient(makePlatformResolver()))
}

export * as Client from "./client"
