import { Effect, Layer, Context } from "effect"
import type {
  BaseToolContext,
  CliToolContext,
  PluginToolContext,
  PermissionRequest,
  AskInput,
  SessionMessage,
  SessionID,
  MessageID,
} from "./types"

/**
 * Context services for dependency injection (Effect v4 style)
 */

export class BaseContextService extends Context.Service<BaseContextService, BaseToolContext>()(
  "@openaxe/BaseToolContext",
) {}
export class CliContextService extends Context.Service<CliContextService, CliToolContext>()(
  "@openaxe/CliToolContext",
) {}
export class PluginContextService extends Context.Service<PluginContextService, PluginToolContext>()(
  "@openaxe/PluginToolContext",
) {}

/**
 * Create a base tool context
 */
export const makeBaseContext = (input: {
  sessionID: SessionID
  messageID: MessageID
  agent: string
  abort: AbortSignal
  callID?: string
  extra?: Record<string, unknown>
}): BaseToolContext => ({
  sessionID: input.sessionID,
  messageID: input.messageID,
  agent: input.agent,
  abort: input.abort,
  callID: input.callID,
  extra: input.extra,
})

/**
 * Create a CLI tool context from base context
 */
export const makeCliContext = (
  base: BaseToolContext,
  messages: ReadonlyArray<SessionMessage>,
  metadataService: { metadata: (input: { title?: string; metadata?: Record<string, unknown> }) => Effect.Effect<void> },
  askService: { ask: (input: Omit<PermissionRequest, "id" | "sessionID" | "tool">) => Effect.Effect<void> },
): CliToolContext => ({
  ...base,
  messages,
  metadata: metadataService.metadata,
  ask: askService.ask,
})

/**
 * Create a plugin tool context from base context
 */
export const makePluginContext = (
  base: BaseToolContext,
  directory: string,
  worktree: string,
  askFn: (input: AskInput) => Promise<void>,
): PluginToolContext => ({
  ...base,
  directory,
  worktree,
  ask: askFn,
})

/**
 * Layer that provides a base context
 */
export const BaseContextLayer = (ctx: BaseToolContext) => Layer.succeed(BaseContextService, ctx)

/**
 * Layer that provides a CLI context
 */
export const CliContextLayer = (ctx: CliToolContext) => Layer.succeed(CliContextService, ctx)

/**
 * Layer that provides a plugin context
 */
export const PluginContextLayer = (ctx: PluginToolContext) => Layer.succeed(PluginContextService, ctx)

/**
 * Get base context from environment
 */
export const getBaseContext = (): Effect.Effect<BaseToolContext, never, BaseContextService> =>
  Effect.service(BaseContextService)

/**
 * Get CLI context from environment
 */
export const getCliContext = (): Effect.Effect<CliToolContext, never, CliContextService> =>
  Effect.service(CliContextService)

/**
 * Get plugin context from environment
 */
export const getPluginContext = (): Effect.Effect<PluginToolContext, never, PluginContextService> =>
  Effect.service(PluginContextService)

/**
 * Permission request helper for CLI context
 */
export const createPermissionRequest = (input: {
  sessionID: SessionID
  tool: string
  permission: string
  patterns: ReadonlyArray<string>
  always: ReadonlyArray<string>
  metadata: Record<string, unknown>
}): PermissionRequest => ({
  id: crypto.randomUUID(),
  ...input,
})

export * as ToolContext from "./context"
