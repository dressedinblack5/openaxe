// @ts-nocheck
import { Schema, Effect } from "effect"
import { NonNegativeInt } from "../schema"

/**
 * LSP Protocol Types
 */

export const Position = Schema.Struct({
  line: NonNegativeInt,
  character: NonNegativeInt,
})

export type Position = typeof Position.Type

export const Range = Schema.Struct({
  start: Position,
  end: Position,
}).annotate({ identifier: "Range" })

export type Range = typeof Range.Type

export const Location = Schema.Struct({
  uri: Schema.String,
  range: Range,
}).annotate({ identifier: "Location" })

export type Location = typeof Location.Type

export const DiagnosticSeverity = Schema.Literals([1, 2, 3, 4])
export type DiagnosticSeverity = typeof DiagnosticSeverity.Type

export const Diagnostic = Schema.Struct({
  range: Range,
  severity: Schema.optional(DiagnosticSeverity),
  code: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  codeDescription: Schema.optional(Schema.Struct({ href: Schema.String })),
  source: Schema.optional(Schema.String),
  message: Schema.String,
  relatedInformation: Schema.optional(Schema.Array(Schema.Struct({
    location: Location,
    message: Schema.String,
  }))),
  tags: Schema.optional(Schema.Array(Schema.Literals([1, 2]))),
  data: Schema.optional(Schema.Unknown),
}).annotate({ identifier: "Diagnostic" })

export type Diagnostic = typeof Diagnostic.Type

export const TextDocumentSyncKind = Schema.Literals([0, 1, 2])
export type TextDocumentSyncKind = typeof TextDocumentSyncKind.Type

export const Status = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  root: Schema.String,
  status: Schema.Literals(["connected", "error"]),
}).annotate({ identifier: "LSPStatus" })
export type Status = typeof Status.Type

export const Symbol = Schema.Struct({
  name: Schema.String,
  kind: NonNegativeInt,
  location: Schema.Struct({
    uri: Schema.String,
    range: Range,
  }),
}).annotate({ identifier: "Symbol" })
export type Symbol = typeof Symbol.Type

export const DocumentSymbol = Schema.Struct({
  name: Schema.String,
  detail: Schema.optional(Schema.String),
  kind: NonNegativeInt,
  range: Range,
  selectionRange: Range,
}).annotate({ identifier: "DocumentSymbol" })
export type DocumentSymbol = typeof DocumentSymbol.Type

export const ServerCapabilities = Schema.Struct({
  textDocumentSync: Schema.optional(Schema.Union([TextDocumentSyncKind, Schema.Struct({
    openClose: Schema.optional(Schema.Boolean),
    change: Schema.optional(TextDocumentSyncKind),
    willSave: Schema.optional(Schema.Boolean),
    willSaveWaitUntil: Schema.optional(Schema.Boolean),
    save: Schema.optional(Schema.Union([Schema.Boolean, Schema.Struct({
      includeText: Schema.optional(Schema.Boolean),
    })])),
  })])),
  hoverProvider: Schema.optional(Schema.Union([Schema.Boolean, Schema.Struct({})])),
  completionProvider: Schema.optional(Schema.Struct({
    resolveProvider: Schema.optional(Schema.Boolean),
    triggerCharacters: Schema.optional(Schema.Array(Schema.String)),
    allCommitCharacters: Schema.optional(Schema.Array(Schema.String)),
    workDoneProgress: Schema.optional(Schema.Boolean),
  })),
  signatureHelpProvider: Schema.optional(Schema.Struct({
    triggerCharacters: Schema.optional(Schema.Array(Schema.String)),
    retriggerCharacters: Schema.optional(Schema.Array(Schema.String)),
    workDoneProgress: Schema.optional(Schema.Boolean),
  })),
  definitionProvider: Schema.optional(Schema.Union([Schema.Boolean, Schema.Struct({})])),
  referencesProvider: Schema.optional(Schema.Union([Schema.Boolean, Schema.Struct({})])),
  documentHighlightProvider: Schema.optional(Schema.Union([Schema.Boolean, Schema.Struct({})])),
  documentSymbolProvider: Schema.optional(Schema.Union([Schema.Boolean, Schema.Struct({})])),
  workspaceSymbolProvider: Schema.optional(Schema.Union([Schema.Boolean, Schema.Struct({})])),
  codeActionProvider: Schema.optional(Schema.Union([Schema.Boolean, Schema.Struct({
    codeActionKinds: Schema.optional(Schema.Array(Schema.String)),
    resolveProvider: Schema.optional(Schema.Boolean),
    workDoneProgress: Schema.optional(Schema.Boolean),
  })])),
  codeLensProvider: Schema.optional(Schema.Struct({
    resolveProvider: Schema.optional(Schema.Boolean),
    workDoneProgress: Schema.optional(Schema.Boolean),
  })),
  documentFormattingProvider: Schema.optional(Schema.Union([Schema.Boolean, Schema.Struct({})])),
  documentRangeFormattingProvider: Schema.optional(Schema.Union([Schema.Boolean, Schema.Struct({})])),
  documentOnTypeFormattingProvider: Schema.optional(Schema.Struct({
    firstTriggerCharacter: Schema.String,
    moreTriggerCharacter: Schema.optional(Schema.Array(Schema.String)),
    workDoneProgress: Schema.optional(Schema.Boolean),
  })),
  renameProvider: Schema.optional(Schema.Union([Schema.Boolean, Schema.Struct({
    prepareProvider: Schema.optional(Schema.Boolean),
    workDoneProgress: Schema.optional(Schema.Boolean),
  })])),
  documentLinkProvider: Schema.optional(Schema.Struct({
    resolveProvider: Schema.optional(Schema.Boolean),
    workDoneProgress: Schema.optional(Schema.Boolean),
  })),
  colorProvider: Schema.optional(Schema.Union([Schema.Boolean, Schema.Struct({})])),
  foldingRangeProvider: Schema.optional(Schema.Union([Schema.Boolean, Schema.Struct({})])),
  diagnosticProvider: Schema.optional(Schema.Union([Schema.Boolean, Schema.Struct({
    identifier: Schema.optional(Schema.String),
    interFileDependencies: Schema.optional(Schema.Boolean),
    workspaceDiagnostics: Schema.optional(Schema.Boolean),
    workDoneProgress: Schema.optional(Schema.Boolean),
  })])),
  selectionRangeProvider: Schema.optional(Schema.Union([Schema.Boolean, Schema.Struct({})])),
  linkedEditingRangeProvider: Schema.optional(Schema.Union([Schema.Boolean, Schema.Struct({})])),
  callHierarchyProvider: Schema.optional(Schema.Union([Schema.Boolean, Schema.Struct({})])),
  semanticTokensProvider: Schema.optional(Schema.Struct({
    legend: Schema.Struct({
      tokenTypes: Schema.Array(Schema.String),
      tokenModifiers: Schema.Array(Schema.String),
    }),
    range: Schema.optional(Schema.Boolean),
    full: Schema.optional(Schema.Union([Schema.Boolean, Schema.Struct({ delta: Schema.optional(Schema.Boolean) })])),
    workDoneProgress: Schema.optional(Schema.Boolean),
  })),
  monikerProvider: Schema.optional(Schema.Union([Schema.Boolean, Schema.Struct({})])),
  typeDefinitionProvider: Schema.optional(Schema.Union([Schema.Boolean, Schema.Struct({})])),
  implementationProvider: Schema.optional(Schema.Union([Schema.Boolean, Schema.Struct({})])),
  inlayHintProvider: Schema.optional(Schema.Union([Schema.Boolean, Schema.Struct({
    resolveProvider: Schema.optional(Schema.Boolean),
    workDoneProgress: Schema.optional(Schema.Boolean),
  })])),
  inlineValueProvider: Schema.optional(Schema.Union([Schema.Boolean, Schema.Struct({})])),
  workspace: Schema.optional(Schema.Struct({
    workspaceFolders: Schema.optional(Schema.Union([Schema.Boolean, Schema.Struct({
      supported: Schema.Boolean,
      changeNotifications: Schema.optional(Schema.Union([Schema.Boolean, Schema.String])),
    })])),
    fileOperations: Schema.optional(Schema.Struct({
      didCreate: Schema.optional(Schema.Struct({ filters: Schema.Array(Schema.Unknown) })),
      willCreate: Schema.optional(Schema.Struct({ filters: Schema.Array(Schema.Unknown) })),
      didRename: Schema.optional(Schema.Struct({ filters: Schema.Array(Schema.Unknown) })),
      willRename: Schema.optional(Schema.Struct({ filters: Schema.Array(Schema.Unknown) })),
      didDelete: Schema.optional(Schema.Struct({ filters: Schema.Array(Schema.Unknown) })),
      willDelete: Schema.optional(Schema.Struct({ filters: Schema.Array(Schema.Unknown) })),
    })),
  })),
}).annotate({ identifier: "ServerCapabilities" })

export type ServerCapabilities = typeof ServerCapabilities.Type

export const InitializeParams = Schema.Struct({
  processId: Schema.optional(Schema.Union([Schema.Number, Schema.Null])),
  clientInfo: Schema.optional(Schema.Struct({
    name: Schema.String,
    version: Schema.optional(Schema.String),
  })),
  rootUri: Schema.optional(Schema.Union([Schema.String, Schema.Null])),
  rootPath: Schema.optional(Schema.Union([Schema.String, Schema.Null])),
  workspaceFolders: Schema.optional(Schema.Union([Schema.Null, Schema.Array(Schema.Struct({
    uri: Schema.String,
    name: Schema.String,
  }))])),
  capabilities: Schema.Unknown,
  initializationOptions: Schema.optional(Schema.Unknown),
  trace: Schema.optional(Schema.Literals(["off", "messages", "verbose"])),
}).annotate({ identifier: "InitializeParams" })

export type InitializeParams = typeof InitializeParams.Type

export const InitializeResult = Schema.Struct({
  capabilities: ServerCapabilities,
  serverInfo: Schema.optional(Schema.Struct({
    name: Schema.String,
    version: Schema.optional(Schema.String),
  })),
  offsetEncoding: Schema.optional(Schema.Literals(["utf-8", "utf-16"])),
}).annotate({ identifier: "InitializeResult" })

export type InitializeResult = typeof InitializeResult.Type

/**
 * LSP Error Hierarchy
 */

export class LSPError extends Schema.TaggedErrorClass<LSPError>()("LSPError", {
  message: Schema.String,
  serverID: Schema.optional(Schema.String),
}) {}



export class ServerSpawnError extends Schema.TaggedErrorClass<ServerSpawnError>()("LSPServerSpawnError", {
  serverID: Schema.String,
  reason: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export class ServerNotFoundError extends Schema.TaggedErrorClass<ServerNotFoundError>()("LSPServerNotFoundError", {
  serverID: Schema.String,
  file: Schema.optional(Schema.String),
}) {}

export class ConnectionError extends Schema.TaggedErrorClass<ConnectionError>()("LSPConnectionError", {
  serverID: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export class TimeoutError extends Schema.TaggedErrorClass<TimeoutError>()("LSPTimeoutError", {
  operation: Schema.String,
  timeoutMs: Schema.Number,
  serverID: Schema.optional(Schema.String),
}) {}

export class DiagnosticError extends Schema.TaggedErrorClass<DiagnosticError>()("LSPDiagnosticError", {
  file: Schema.String,
  serverID: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export class DownloadError extends Schema.TaggedErrorClass<DownloadError>()("LSPDownloadError", {
  serverID: Schema.String,
  url: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export class PlatformError extends Schema.TaggedErrorClass<PlatformError>()("LSPPlatformError", {
  platform: Schema.String,
  arch: Schema.String,
  message: Schema.String,
}) {}

/**
 * Server Definition Types
 */

export interface ServerDefinition {
  readonly id: string
  readonly name: string
  readonly extensions: ReadonlyArray<string>
  readonly rootPatterns?: ReadonlyArray<string>
  readonly excludePatterns?: ReadonlyArray<string>
  readonly spawn: (root: string, ctx: InstanceContext, flags: RuntimeFlags) => Effect.Effect<ServerHandle | undefined, ServerSpawnError>
  readonly initialization?: Record<string, unknown>
  readonly global?: boolean
  readonly downloadStrategy?: DownloadStrategy
}

export interface ServerHandle {
  readonly process: ChildProcess
  readonly initialization?: Record<string, unknown>
}

export interface ChildProcess {
  readonly pid: number
  readonly stdin: NodeJS.WritableStream | null
  readonly stdout: NodeJS.ReadableStream | null
  readonly stderr: NodeJS.ReadableStream | null
  readonly killed: boolean
  kill(signal?: string | number): boolean
  on(event: "exit", listener: (code: number | null, signal: string | null) => void): this
  on(event: "error", listener: (err: Error) => void): this
}

export type DownloadStrategy =
  | { readonly type: "npm"; readonly package: string; readonly binary?: string }
  | { readonly type: "go"; readonly module: string; readonly binary?: string }
  | { readonly type: "cargo"; readonly crate: string; readonly binary?: string }
  | { readonly type: "binary"; readonly url: string; readonly binary?: string; readonly archiveType?: "zip" | "tar.gz" | "tar.xz" }
  | { readonly type: "mason"; readonly package: string; readonly binary?: string }
  | { readonly type: "github"; readonly repo: string; readonly assetPattern: string; readonly binary?: string; readonly archiveType?: "zip" | "tar.gz" | "tar.xz" }

export interface InstanceContext {
  readonly directory: string
  readonly worktree: string
  readonly project: ProjectInfo
}

export interface ProjectInfo {
  readonly id: string
  readonly vcs?: boolean
}

export interface RuntimeFlags {
  readonly experimentalLspTy: boolean
  readonly disableLspDownload: boolean
}

/**
 * LSP Client Interface
 */

export interface ClientInfo {
  readonly serverID: string
  readonly root: string
  readonly connection: MessageConnection
  readonly diagnostics: Map<string, Diagnostic[]>
  readonly notify: {
    readonly open: (request: { path: string }) => Promise<number>
  }
  readonly waitForDiagnostics: (request: { path: string; version: number; mode?: "document" | "full"; after?: number }) => Promise<void>
  readonly shutdown: () => Promise<void>
}

export interface LSPClient {
  readonly serverID: string
  readonly root: string
  readonly connection: MessageConnection
  readonly notify: {
    readonly open: (request: { path: string }) => Promise<number>
  }
  readonly diagnostics: Map<string, Diagnostic[]>
  readonly waitForDiagnostics: (request: { path: string; version: number; mode?: "document" | "full"; after?: number }) => Promise<void>
  readonly shutdown: () => Promise<void>
}

export interface MessageConnection {
  sendRequest<R>(method: string, params?: unknown): Promise<R>
  sendNotification(method: string, params?: unknown): Promise<void>
  onNotification(method: string, handler: (params: unknown) => void): void
  // oxlint-disable-next-line typescript/no-redundant-type-constituents -- Promise<unknown> | unknown for backward compatibility
  onRequest(method: string, handler: (params: unknown) => Promise<unknown> | unknown): void
  listen(): void
  end(): void
  dispose(): void
}

/**
 * Service Interfaces
 */

export interface DiagnosticStore {
  updatePushDiagnostics(filePath: string, diagnostics: Diagnostic[]): void
  updatePullDiagnostics(filePath: string, diagnostics: Diagnostic[]): void
  getMergedDiagnostics(filePath: string): Diagnostic[]
  getAllDiagnostics(): Map<string, Diagnostic[]>
  waitForDocumentDiagnostics(path: string, version: number, after?: number): Promise<void>
  waitForFullDiagnostics(path: string, version: number, after?: number): Promise<void>
}

export interface BrokenServerTracker {
  isBroken(root: string, serverID: string): boolean
  markBroken(root: string, serverID: string): void
  markFixed(root: string, serverID: string): void
  prune(): void
}

export interface ServerRegistry {
  getAll(): ReadonlyArray<ServerDefinition>
  getById(id: string): ServerDefinition | undefined
  getByExtension(ext: string): ReadonlyArray<ServerDefinition>
  register(definition: ServerDefinition): void
  unregister(id: string): void
}

export interface CapabilityRegistry {
  hasTextDocumentSync(capabilities: ServerCapabilities): boolean
  getTextDocumentSyncKind(capabilities: ServerCapabilities): TextDocumentSyncKind | undefined
  hasDiagnosticProvider(capabilities: ServerCapabilities): boolean
  getDiagnosticProvider(capabilities: ServerCapabilities): ServerCapabilities["diagnosticProvider"]
  hasCompletionProvider(capabilities: ServerCapabilities): boolean
  getCompletionProvider(capabilities: ServerCapabilities): ServerCapabilities["completionProvider"]
  hasHoverProvider(capabilities: ServerCapabilities): boolean
  hasDefinitionProvider(capabilities: ServerCapabilities): boolean
  hasReferencesProvider(capabilities: ServerCapabilities): boolean
  hasDocumentSymbolProvider(capabilities: ServerCapabilities): boolean
  hasWorkspaceSymbolProvider(capabilities: ServerCapabilities): boolean
  hasCodeActionProvider(capabilities: ServerCapabilities): boolean
  hasRenameProvider(capabilities: ServerCapabilities): boolean
  hasFormattingProvider(capabilities: ServerCapabilities): boolean
  hasTypeDefinitionProvider(capabilities: ServerCapabilities): boolean
  hasImplementationProvider(capabilities: ServerCapabilities): boolean
  hasCallHierarchyProvider(capabilities: ServerCapabilities): boolean
  hasInlayHintProvider(capabilities: ServerCapabilities): boolean
}

export interface PlatformResolver {
  resolveBinary(platform: NodeJS.Platform, arch: string): { binary: string; args: string[] }
  getCurrentPlatform(): { platform: NodeJS.Platform; arch: string }
  isWindows(): boolean
  isMac(): boolean
  isLinux(): boolean
}

export interface ServerDownloader {
  download(strategy: DownloadStrategy, targetDir: string): Effect.Effect<string, DownloadError>
  extract(archivePath: string, targetDir: string, archiveType: "zip" | "tar.gz" | "tar.xz"): Effect.Effect<void, DownloadError>
  verify(binaryPath: string): Effect.Effect<boolean>
}

export interface LSPState {
  readonly clients: ReadonlyArray<LSPClient>
  readonly servers: Record<string, ServerDefinition>
  readonly brokenServerTracker: BrokenServerTracker
  readonly diagnosticStore: DiagnosticStore
  readonly serverRegistry: ServerRegistry
  readonly capabilityRegistry: CapabilityRegistry
  readonly platformResolver: PlatformResolver
  readonly serverDownloader: ServerDownloader
}

export * as LSPTypes from "./types"