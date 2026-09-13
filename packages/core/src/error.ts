/**
 * AppError - Single error class with _tag discriminant
 * Replaces Schema.TaggedErrorClass to avoid TypeScript `any` inference in unions
 */
export abstract class AppError extends Error {
  _tag: string
  readonly _message: string

  constructor(message: string, tag: string) {
    super(message)
    this._message = message
    this._tag = tag
    Object.setPrototypeOf(this, new.target.prototype)
  }

  override get message(): string {
    return this._message
  }

  static isAppError(error: unknown): error is AppError {
    return error instanceof AppError
  }
}

/**
 * Create a typed error class with discriminant
 */
export function createErrorClass(tag: string, _fields: Record<string, unknown>) {
  class TypedError extends AppError {
    declare _tag: string
    readonly _fields: Record<string, unknown>

    constructor(message: string, fields: Record<string, unknown>) {
      super(message, tag)
      this._fields = fields
      Object.assign(this, fields)
    }
  }
  TypedError.prototype._tag = tag
  Object.defineProperty(TypedError, "name", { value: tag.replace(".", "") })
  return TypedError
}

/**
 * Create a tagged error class with a .make() method (replaces Schema.TaggedErrorClass)
 */
export function makeTaggedError<Tag extends string, Fields extends Record<string, unknown>>(tag: Tag, _fields: Fields) {
  const ErrorClass = class TaggedError {
    readonly _tag: Tag

    constructor(fields: Fields) {
      this._tag = tag
      Object.assign(this, fields)
    }

    static make(fields: Fields): TaggedError {
      return new TaggedError(fields)
    }
  }
  Object.defineProperty(ErrorClass, "name", { value: tag.replace(".", "") })
  return ErrorClass
}

/**
 * Integration errors - using plain discriminated union to avoid `any` in unions
 */
export const IntegrationError = {
  CodeRequired: (attemptID: string): IntegrationError => ({
    _tag: "Integration.CodeRequired",
    attemptID,
  }),
  Authorization: (cause: unknown): IntegrationError => ({
    _tag: "Integration.Authorization",
    cause,
  }),
}

export type IntegrationError =
  | { readonly _tag: "Integration.CodeRequired"; readonly attemptID: string }
  | { readonly _tag: "Integration.Authorization"; readonly cause: unknown }

/**
 * Model errors
 */
export const ModelError = {
  VariantNotFound: (variantID: string): ModelError => ({
    _tag: "Model.VariantNotFound",
    variantID,
  }),
  ProviderError: (providerID: string, message: string): ModelError => ({
    _tag: "Model.ProviderError",
    providerID,
    message,
  }),
}

export type ModelError =
  | { readonly _tag: "Model.VariantNotFound"; readonly variantID: string }
  | { readonly _tag: "Model.ProviderError"; readonly providerID: string; readonly message: string }

/**
 * Session errors
 */
export const SessionError = {
  NotFound: (sessionID: string): SessionError => ({
    _tag: "Session.NotFound",
    sessionID,
  }),
  InvalidState: (sessionID: string, expected: string, actual: string): SessionError => ({
    _tag: "Session.InvalidState",
    sessionID,
    expected,
    actual,
  }),
}

export type SessionError =
  | { readonly _tag: "Session.NotFound"; readonly sessionID: string }
  | {
      readonly _tag: "Session.InvalidState"
      readonly sessionID: string
      readonly expected: string
      readonly actual: string
    }

/**
 * SessionEvent errors
 */
export const SessionEventError = {
  FooterOutput: (message: string): SessionEventError => ({
    _tag: "SessionEvent.FooterOutput",
    message,
  }),
}

export type SessionEventError = { readonly _tag: "SessionEvent.FooterOutput"; readonly message: string }

/**
 * LSP errors
 */
export const LSPError = {
  TextDocumentSyncKind: (kind: number): LSPError => ({
    _tag: "LSP.TextDocumentSyncKind",
    kind,
  }),
  ServerSpawn: (serverID: string, reason: string): LSPError => ({
    _tag: "LSP.ServerSpawn",
    serverID,
    reason,
  }),
  Connection: (serverID: string, message: string): LSPError => ({
    _tag: "LSP.Connection",
    serverID,
    message,
  }),
  Timeout: (operation: string, timeoutMs: number, serverID?: string): LSPError => ({
    _tag: "LSP.Timeout",
    operation,
    timeoutMs,
    serverID,
  }),
  Diagnostic: (file: string, serverID: string, message: string): LSPError => ({
    _tag: "LSP.Diagnostic",
    file,
    serverID,
    message,
  }),
  Download: (serverID: string, url: string, message: string): LSPError => ({
    _tag: "LSP.Download",
    serverID,
    url,
    message,
  }),
  Platform: (platform: string, arch: string, message: string): LSPError => ({
    _tag: "LSP.Platform",
    platform,
    arch,
    message,
  }),
  ProcessOptions: (options: unknown): LSPError => ({
    _tag: "LSP.ProcessOptions",
    options,
  }),
}

export type LSPError =
  | { readonly _tag: "LSP.TextDocumentSyncKind"; readonly kind: number }
  | { readonly _tag: "LSP.ServerSpawn"; readonly serverID: string; readonly reason: string }
  | { readonly _tag: "LSP.Connection"; readonly serverID: string; readonly message: string }
  | { readonly _tag: "LSP.Timeout"; readonly operation: string; readonly timeoutMs: number; readonly serverID?: string }
  | { readonly _tag: "LSP.Diagnostic"; readonly file: string; readonly serverID: string; readonly message: string }
  | { readonly _tag: "LSP.Download"; readonly serverID: string; readonly url: string; readonly message: string }
  | { readonly _tag: "LSP.Platform"; readonly platform: string; readonly arch: string; readonly message: string }
  | { readonly _tag: "LSP.ProcessOptions"; readonly options: unknown }

/**
 * Tool errors
 */
export const ToolError = {
  Definition: (toolID: string, message: string): ToolError => ({
    _tag: "Tool.Definition",
    toolID,
    message,
  }),
  Execution: (toolID: string, message: string): ToolError => ({
    _tag: "Tool.Execution",
    toolID,
    message,
  }),
  Registry: (toolID: string, message: string): ToolError => ({
    _tag: "Tool.Registry",
    toolID,
    message,
  }),
  ExternalLoader: (message: string): ToolError => ({
    _tag: "Tool.ExternalLoader",
    message,
  }),
}

export type ToolError =
  | { readonly _tag: "Tool.Definition"; readonly toolID: string; readonly message: string }
  | { readonly _tag: "Tool.Execution"; readonly toolID: string; readonly message: string }
  | { readonly _tag: "Tool.Registry"; readonly toolID: string; readonly message: string }
  | { readonly _tag: "Tool.ExternalLoader"; readonly message: string }

/**
 * Context errors
 */
export const ContextError = {
  ProjectScope: (dir: string): ContextError => ({
    _tag: "Context.ProjectScope",
    dir,
  }),
  WorkspaceScope: (workspaceId: string): ContextError => ({
    _tag: "Context.WorkspaceScope",
    workspaceId,
  }),
  PluginScope: (pluginId: string): ContextError => ({
    _tag: "Context.PluginScope",
    pluginId,
  }),
  ScopeNotFound: (scope: string): ContextError => ({
    _tag: "Context.ScopeNotFound",
    scope,
  }),
  Json: (value: unknown): ContextError => ({
    _tag: "Context.Json",
    value,
  }),
}

export type ContextError =
  | { readonly _tag: "Context.ProjectScope"; readonly dir: string }
  | { readonly _tag: "Context.WorkspaceScope"; readonly workspaceId: string }
  | { readonly _tag: "Context.PluginScope"; readonly pluginId: string }
  | { readonly _tag: "Context.ScopeNotFound"; readonly scope: string }
  | { readonly _tag: "Context.Json"; readonly value: unknown }

/**
 * Union of all error types - using discriminated unions to avoid `any` inference
 */
export type AnyError =
  IntegrationError | ModelError | SessionError | SessionEventError | LSPError | ToolError | ContextError

export * as Error from "./error"
