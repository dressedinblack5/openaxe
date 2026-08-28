// @ts-nocheck
import { Effect, Layer, Context, HashMap } from "effect"
import {
  BrokenServerTracker,
  ServerDefinition,
  DiagnosticStore,
  ServerRegistry,
  CapabilityRegistry,
  PlatformResolver,
  ServerDownloader,
  ServerSpawnError,
  Diagnostic,
  TextDocumentSyncKind,
  ServerCapabilities,
} from "./types"
import { ChildProcess } from "node:child_process"

/**
 * State Slices
 */

export interface ClientInfo {
  readonly serverID: string
  readonly root: string
  readonly connection: LSPClient["connection"]
  readonly diagnostics: Map<string, Diagnostic[]>
  readonly notify: LSPClient["notify"]
  readonly waitForDiagnostics: LSPClient["waitForDiagnostics"]
  readonly shutdown: () => Promise<void>
}

export interface ServerInfo {
  readonly definition: ServerDefinition
  readonly handle?: {
    readonly process: ChildProcess
    readonly initialization?: Record<string, unknown>
  }
}

export interface LSPStateInternal {
  readonly clients: ReadonlyArray<ClientInfo>
  readonly servers: HashMap.HashMap<string, ServerInfo>
  readonly spawning: HashMap.HashMap<string, Promise<ClientInfo | undefined>>
  readonly used: HashMap.HashMap<string, number>
  readonly brokenServerTracker: BrokenServerTracker
  readonly diagnosticStore: DiagnosticStore
  readonly serverRegistry: ServerRegistry
  readonly capabilityRegistry: CapabilityRegistry
  readonly platformResolver: PlatformResolver
  readonly serverDownloader: ServerDownloader
}

/**
 * BrokenServerTracker - Encapsulates broken server tracking with TTL
 */

const BROKEN_TTL = 300_000 // 5 minutes

export const makeBrokenServerTracker = (): BrokenServerTracker => {
  const broken = new Map<string, number>()

  const clientKey = (root: string, serverID: string) => `${root}#${serverID}`

  return {
    isBroken(root: string, serverID: string): boolean {
      const key = clientKey(root, serverID)
      const brokenAt = broken.get(key)
      if (brokenAt && Date.now() - brokenAt < BROKEN_TTL) return true
      if (brokenAt) broken.delete(key)
      return false
    },

    markBroken(root: string, serverID: string): void {
      broken.set(clientKey(root, serverID), Date.now())
    },

    markFixed(root: string, serverID: string): void {
      broken.delete(clientKey(root, serverID))
    },

    prune(): void {
      const now = Date.now()
      for (const [key, time] of broken.entries()) {
        if (now - time >= BROKEN_TTL) broken.delete(key)
      }
    },
  }
}

/**
 * DiagnosticStore - Owns push/pull/published/dedupe/merge
 */

const DIAGNOSTICS_DEBOUNCE_MS = 150
const DIAGNOSTICS_DOCUMENT_WAIT_TIMEOUT_MS = 5_000
const DIAGNOSTICS_FULL_WAIT_TIMEOUT_MS = 10_000
const _DIAGNOSTICS_REQUEST_TIMEOUT_MS = 3_000

export const makeDiagnosticStore = (): DiagnosticStore => {
  const pushDiagnostics = new Map<string, Diagnostic[]>()
  const pullDiagnostics = new Map<string, Diagnostic[]>()
  const _published = new Map<string, { at: number; version?: number }>()
  const diagnosticListeners = new Set<(input: { path: string; serverID: string }) => void>()

  const dedupeDiagnostics = (items: Diagnostic[]): Diagnostic[] => {
    const seen = new Map<string, boolean>()
    return items.filter((item) => {
      const key = `${item.code ?? ""}|${item.severity ?? ""}|${item.message ?? ""}|${item.source ?? ""}|${item.range?.start.line ?? ""}:${item.range?.start.character ?? ""}:${item.range?.end.line ?? ""}:${item.range?.end.character ?? ""}`
      if (seen.has(key)) return false
      seen.set(key, true)
      return true
    })
  }

  const mergedDiagnostics = (filePath: string): Diagnostic[] =>
    dedupeDiagnostics([...(pushDiagnostics.get(filePath) ?? []), ...(pullDiagnostics.get(filePath) ?? [])])

  const updatePushDiagnostics = (filePath: string, next: Diagnostic[]): void => {
    pushDiagnostics.set(filePath, next)
    for (const listener of diagnosticListeners) listener({ path: filePath, serverID: "" })
  }

  const updatePullDiagnostics = (filePath: string, next: Diagnostic[]): void => {
    pullDiagnostics.set(filePath, next)
  }

  return {
    updatePushDiagnostics,
    updatePullDiagnostics,
    getMergedDiagnostics(filePath: string): Diagnostic[] {
      return mergedDiagnostics(filePath)
    },
    getAllDiagnostics(): Map<string, Diagnostic[]> {
      const result = new Map<string, Diagnostic[]>()
      for (const key of new Set([...pushDiagnostics.keys(), ...pullDiagnostics.keys()])) {
        result.set(key, mergedDiagnostics(key))
      }
      return result
    },
    async waitForDocumentDiagnostics(path: string, version: number, after?: number): Promise<void> {
      const startedAt = after ?? Date.now()
      const controller = new AbortController()

      const waitForFreshPush = (request: {
        path: string
        version: number
        after: number
        timeout: number
      }): Promise<boolean> =>
        new Promise((resolve) => {
          let finished = false
          let debounceTimer: ReturnType<typeof setTimeout> | undefined
          let timeoutTimer: ReturnType<typeof setTimeout> | undefined
          let unsub: (() => void) | undefined

          const finish = (result: boolean): void => {
            if (finished) return
            finished = true
            if (debounceTimer) clearTimeout(debounceTimer)
            if (timeoutTimer) clearTimeout(timeoutTimer)
            unsub?.()
            controller.signal.removeEventListener("abort", onAbort)
            resolve(result)
          }

          const onAbort = (): void => finish(false)

          const schedule = (): void => {
            const hit = published.get(request.path)
            if (!hit) return
            if (typeof hit.version === "number" && hit.version !== request.version) return
            if (hit.at < request.after && hit.version !== request.version) return
            if (debounceTimer) clearTimeout(debounceTimer)
            debounceTimer = setTimeout(() => finish(true), Math.max(0, DIAGNOSTICS_DEBOUNCE_MS - (Date.now() - hit.at)))
          }

          timeoutTimer = setTimeout(() => finish(false), request.timeout)
          const listener = (event: { path: string; serverID: string }): void => {
            if (event.path !== request.path) return
            schedule()
          }
          diagnosticListeners.add(listener)
          unsub = () => diagnosticListeners.delete(listener)
          controller.signal.addEventListener("abort", onAbort, { once: true })
          schedule()
        })

      try {
        while (Date.now() - startedAt < DIAGNOSTICS_DOCUMENT_WAIT_TIMEOUT_MS) {
          const result = await requestDocumentDiagnostics(path)
          if (result.matched) return
          const remaining = DIAGNOSTICS_DOCUMENT_WAIT_TIMEOUT_MS - (Date.now() - startedAt)
          if (remaining <= 0) return
          const next = await Promise.race([
            waitForFreshPush({ path, version, after: startedAt, timeout: remaining }).then((ready) =>
              ready ? "push" : ("timeout" as const),
            ),
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
    },
    async waitForFullDiagnostics(path: string, version: number, after?: number): Promise<void> {
      const startedAt = after ?? Date.now()
      const controller = new AbortController()

      const waitForFreshPush = (request: {
        path: string
        version: number
        after: number
        timeout: number
      }): Promise<boolean> =>
        new Promise((resolve) => {
          let finished = false
          let debounceTimer: ReturnType<typeof setTimeout> | undefined
          let timeoutTimer: ReturnType<typeof setTimeout> | undefined
          let unsub: (() => void) | undefined

          const finish = (result: boolean): void => {
            if (finished) return
            finished = true
            if (debounceTimer) clearTimeout(debounceTimer)
            if (timeoutTimer) clearTimeout(timeoutTimer)
            unsub?.()
            controller.signal.removeEventListener("abort", onAbort)
            resolve(result)
          }

          const onAbort = (): void => finish(false)

          const schedule = (): void => {
            const hit = published.get(request.path)
            if (!hit) return
            if (typeof hit.version === "number" && hit.version !== request.version) return
            if (hit.at < request.after && hit.version !== request.version) return
            if (debounceTimer) clearTimeout(debounceTimer)
            debounceTimer = setTimeout(() => finish(true), Math.max(0, DIAGNOSTICS_DEBOUNCE_MS - (Date.now() - hit.at)))
          }

          timeoutTimer = setTimeout(() => finish(false), request.timeout)
          const listener = (event: { path: string; serverID: string }): void => {
            if (event.path !== request.path) return
            schedule()
          }
          diagnosticListeners.add(listener)
          unsub = () => diagnosticListeners.delete(listener)
          controller.signal.addEventListener("abort", onAbort, { once: true })
          schedule()
        })

      try {
        while (Date.now() - startedAt < DIAGNOSTICS_FULL_WAIT_TIMEOUT_MS) {
          const result = await requestFullDiagnostics(path)
          if (result.handled || result.matched) return
          const remaining = DIAGNOSTICS_FULL_WAIT_TIMEOUT_MS - (Date.now() - startedAt)
          if (remaining <= 0) return
          const next = await Promise.race([
            waitForFreshPush({ path, version, after: startedAt, timeout: remaining }).then((ready) =>
              ready ? "push" : ("timeout" as const),
            ),
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
    },
  }

  function requestDocumentDiagnostics(_filePath: string): Promise<{ handled: boolean; matched: boolean }> {
    return Promise.resolve({ handled: false, matched: false })
  }

  function requestFullDiagnostics(_filePath: string): Promise<{ handled: boolean; matched: boolean }> {
    return Promise.resolve({ handled: false, matched: false })
  }

  function waitForRegistrationChange(_timeout: number, _signal: AbortSignal): Promise<boolean> {
    return Promise.resolve(false)
  }
}

/**
 * ServerRegistry - Hybrid factory for server definitions
 */

export const makeServerRegistry = (initialServers: ReadonlyArray<ServerDefinition> = []): ServerRegistry => {
  let servers = new HashMap.HashMap<string, ServerDefinition>()
  for (const server of initialServers) {
    servers = HashMap.set(servers, server.id, server)
  }

  return {
    getAll(): ReadonlyArray<ServerDefinition> {
      return HashMap.values(servers)
    },
    getById(id: string): ServerDefinition | undefined {
      return HashMap.get(servers, id)
    },
    getByExtension(ext: string): ReadonlyArray<ServerDefinition> {
      return HashMap.values(servers).filter((server) => server.extensions.includes(ext))
    },
    register(definition: ServerDefinition): void {
      servers = HashMap.set(servers, definition.id, definition)
    },
    unregister(id: string): void {
      servers = HashMap.remove(servers, id)
    },
  }
}

/**
 * CapabilityRegistry - Typed accessors for server capabilities
 */

export const makeCapabilityRegistry = (): CapabilityRegistry => ({
  hasTextDocumentSync(capabilities: ServerCapabilities): boolean {
    return capabilities.textDocumentSync !== undefined
  },
  getTextDocumentSyncKind(capabilities: ServerCapabilities): TextDocumentSyncKind | undefined {
    if (!capabilities.textDocumentSync) return undefined
    if (typeof capabilities.textDocumentSync === "number") return capabilities.textDocumentSync
    return capabilities.textDocumentSync.change
  },
  hasDiagnosticProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.diagnosticProvider !== undefined
  },
  getDiagnosticProvider(capabilities: ServerCapabilities): ServerCapabilities["diagnosticProvider"] {
    return capabilities.diagnosticProvider
  },
  hasCompletionProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.completionProvider !== undefined
  },
  getCompletionProvider(capabilities: ServerCapabilities): ServerCapabilities["completionProvider"] {
    return capabilities.completionProvider
  },
  hasHoverProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.hoverProvider !== undefined
  },
  hasDefinitionProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.definitionProvider !== undefined
  },
  hasReferencesProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.referencesProvider !== undefined
  },
  hasDocumentSymbolProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.documentSymbolProvider !== undefined
  },
  hasWorkspaceSymbolProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.workspaceSymbolProvider !== undefined
  },
  hasCodeActionProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.codeActionProvider !== undefined
  },
  hasRenameProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.renameProvider !== undefined
  },
  hasFormattingProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.documentFormattingProvider !== undefined
  },
  hasTypeDefinitionProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.typeDefinitionProvider !== undefined
  },
  hasImplementationProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.implementationProvider !== undefined
  },
  hasCallHierarchyProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.callHierarchyProvider !== undefined
  },
  hasInlayHintProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.inlayHintProvider !== undefined
  },
})

/**
 * PlatformResolver - Cross-platform binary resolution
 */

export const makePlatformResolver = (): PlatformResolver => ({
  resolveBinary(platform: NodeJS.Platform, arch: string): { binary: string; args: string[] } {
    const isWindows = platform === "win32"
    const _isArm64 = arch === "arm64" || arch === "aarch64"
    return {
      binary: isWindows ? "cmd.exe" : "sh",
      args: isWindows ? ["/c"] : ["-c"],
    }
  },
  getCurrentPlatform(): { platform: NodeJS.Platform; arch: string } {
    return { platform: process.platform, arch: process.arch }
  },
  isWindows(): boolean {
    return process.platform === "win32"
  },
  isMac(): boolean {
    return process.platform === "darwin"
  },
  isLinux(): boolean {
    return process.platform === "linux"
  },
})

/**
 * ServerDownloader - Strategy pattern for auto-download
 */

export const makeServerDownloader = (): ServerDownloader => ({
  download(_strategy: DownloadStrategy, _targetDir: string): Effect.Effect<string, ServerSpawnError> {
    return Effect.tryPromise({
      try: async () => {
        // Implementation would download based on strategy type
        throw new Error("Not implemented")
      },
      catch: (cause) => new ServerSpawnError({ serverID: "unknown", reason: String(cause), cause }),
    })
  },
  extract(
    _archivePath: string,
    _targetDir: string,
    _archiveType: "zip" | "tar.gz" | "tar.xz",
  ): Effect.Effect<void, ServerSpawnError> {
    return Effect.tryPromise({
      try: async () => {
        // Implementation would extract based on archive type
        throw new Error("Not implemented")
      },
      catch: (cause) => new ServerSpawnError({ serverID: "unknown", reason: String(cause), cause }),
    })
  },
  verify(_binaryPath: string): Effect.Effect<boolean> {
    return Effect.tryPromise({
      try: async () => {
        // Implementation would verify binary exists and is executable
        return false
      },
      catch: () => false,
    })
  },
})

/**
 * Services for Effect DI - using Effect v4 Context.Service pattern
 */

export class BrokenServerTrackerService extends Context.Service<BrokenServerTrackerService>()(
  "@opencode/LSP/BrokenServerTracker",
) {
  static Live = Layer.succeed(BrokenServerTrackerService, makeBrokenServerTracker())
}

export class DiagnosticStoreService extends Context.Service<DiagnosticStoreService>()("@opencode/LSP/DiagnosticStore") {
  static Live = Layer.succeed(DiagnosticStoreService, makeDiagnosticStore())
}

export class ServerRegistryService extends Context.Service<ServerRegistryService>()("@opencode/LSP/ServerRegistry") {
  static Live = (servers?: ReadonlyArray<ServerDefinition>) =>
    Layer.succeed(ServerRegistryService, makeServerRegistry(servers))
}

export class CapabilityRegistryService extends Context.Service<CapabilityRegistryService>()(
  "@opencode/LSP/CapabilityRegistry",
) {
  static Live = Layer.succeed(CapabilityRegistryService, makeCapabilityRegistry())
}

export class PlatformResolverService extends Context.Service<PlatformResolverService>()(
  "@opencode/LSP/PlatformResolver",
) {
  static Live = Layer.succeed(PlatformResolverService, makePlatformResolver())
}

export class ServerDownloaderService extends Context.Service<ServerDownloaderService>()(
  "@opencode/LSP/ServerDownloader",
) {
  static Live = Layer.succeed(ServerDownloaderService, makeServerDownloader())
}

export * as LSPState from "./state"
