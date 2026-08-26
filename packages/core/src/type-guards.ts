/**
 * Central type guard utilities for discriminated union errors
 * Replaces 48+ unsafe `as` casts throughout the codebase
 */

import type { AnyError, IntegrationError, ModelError, SessionError, SessionEventError, LSPError, ToolError, ContextError } from "./error"

/**
 * Type guard for checking if a value is a discriminated error with _tag
 */
export function isTaggedError<TTag extends string>(
  tag: TTag,
): (value: unknown) => value is { readonly _tag: TTag } & Record<string, unknown> {
  return (value): value is { readonly _tag: TTag } & Record<string, unknown> =>
    typeof value === "object" && value !== null && "_tag" in value && (value as Record<string, unknown>)._tag === tag
}

/**
 * Check if value is an error with a specific tag
 */
export function hasErrorTag<TTag extends string>(value: unknown, tag: TTag): value is { readonly _tag: TTag } {
  return typeof value === "object" && value !== null && "_tag" in value && (value as Record<string, unknown>)._tag === tag
}

/**
 * Narrow a discriminated union error by tag
 */
export function narrowError<T extends { readonly _tag: string }>(
  error: T,
  tag: T["_tag"],
): Extract<T, { readonly _tag: typeof tag }> | undefined {
  return error._tag === tag ? error : undefined
}

/**
 * Type guards for IntegrationError
 */
export const isIntegrationError = {
  codeRequired: isTaggedError("Integration.CodeRequired"),
  authorization: isTaggedError("Integration.Authorization"),
  any: (error: AnyError): error is IntegrationError =>
    error._tag.startsWith("Integration."),
}

/**
 * Type guards for ModelError
 */
export const isModelError = {
  variantNotFound: isTaggedError("Model.VariantNotFound"),
  providerError: isTaggedError("Model.ProviderError"),
  any: (error: AnyError): error is ModelError =>
    error._tag.startsWith("Model."),
}

/**
 * Type guards for SessionError
 */
export const isSessionError = {
  notFound: isTaggedError("Session.NotFound"),
  invalidState: isTaggedError("Session.InvalidState"),
  any: (error: AnyError): error is SessionError =>
    error._tag.startsWith("Session."),
}

/**
 * Type guards for SessionEventError
 */
export const isSessionEventError = {
  footerOutput: isTaggedError("SessionEvent.FooterOutput"),
  any: (error: AnyError): error is SessionEventError =>
    error._tag.startsWith("SessionEvent."),
}

/**
 * Type guards for LSPError
 */
export const isLSPError = {
  textDocumentSyncKind: isTaggedError("LSP.TextDocumentSyncKind"),
  serverSpawn: isTaggedError("LSP.ServerSpawn"),
  connection: isTaggedError("LSP.Connection"),
  timeout: isTaggedError("LSP.Timeout"),
  diagnostic: isTaggedError("LSP.Diagnostic"),
  download: isTaggedError("LSP.Download"),
  platform: isTaggedError("LSP.Platform"),
  processOptions: isTaggedError("LSP.ProcessOptions"),
  any: (error: AnyError): error is LSPError =>
    error._tag.startsWith("LSP."),
}

/**
 * Type guards for ToolError
 */
export const isToolError = {
  definition: isTaggedError("Tool.Definition"),
  execution: isTaggedError("Tool.Execution"),
  registry: isTaggedError("Tool.Registry"),
  externalLoader: isTaggedError("Tool.ExternalLoader"),
  any: (error: AnyError): error is ToolError =>
    error._tag.startsWith("Tool."),
}

/**
 * Type guards for ContextError
 */
export const isContextError = {
  projectScope: isTaggedError("Context.ProjectScope"),
  workspaceScope: isTaggedError("Context.WorkspaceScope"),
  pluginScope: isTaggedError("Context.PluginScope"),
  scopeNotFound: isTaggedError("Context.ScopeNotFound"),
  json: isTaggedError("Context.Json"),
  any: (error: AnyError): error is ContextError =>
    error._tag.startsWith("Context."),
}

/**
 * Generic type guard for AppError class instances
 */
export function isAppErrorInstance(error: unknown): error is { readonly _tag: string; readonly _message: string; readonly message: string } {
  return error instanceof Error && "_tag" in error
}

/**
 * Exhaustiveness check for discriminated unions
 * Use this in switch statements to ensure all cases are handled
 */
export function assertNever(value: never): never {
  throw new Error(`Unexpected error type: ${JSON.stringify(value)}`)
}

/**
 * Match an error against a map of handlers
 * Returns the result of the matching handler, or calls default handler
 */
export function matchError<T, R>(
  error: T,
  handlers: {
    [K in T["_tag"]]?: (error: Extract<T, { readonly _tag: K }>) => R
  },
  defaultHandler: (error: T) => R,
): R {
   // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- handler lookup by _tag is safe
   const handler = handlers[error._tag as keyof typeof handlers]
   if (handler) {
     return handler(error as unknown)
   }
   return defaultHandler(error)
}

/**
 * Match an error with a default return value
 */
export function matchErrorOr<T, R>(
  error: T,
  handlers: {
    [K in T["_tag"]]?: (error: Extract<T, { readonly _tag: K }>) => R
  },
  defaultValue: R,
): R {
   // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- handler lookup by _tag is safe
   const handler = handlers[error._tag as keyof typeof handlers]
   if (handler) {
     return handler(error as unknown)
   }
   return defaultValue
}

/**
 * Check if error matches any of the given tags
 */
export function isAnyErrorType<T extends { readonly _tag: string }>(
  error: T,
  tags: readonly T["_tag"][],
): boolean {
  return tags.includes(error._tag)
}

/**
 * Utility to safely extract a field from an error if it matches the tag
 */
export function getErrorField<T extends { readonly _tag: string }, K extends keyof T>(
  error: T,
  tag: T["_tag"],
  field: K,
): T[K] | undefined {
  return error._tag === tag ? error[field] : undefined
}

export * as TypeGuards from "./type-guards"