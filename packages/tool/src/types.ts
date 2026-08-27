import { Schema, Effect } from "effect"
import type { JSONSchema7 } from "@ai-sdk/provider"

export type { JSONSchema7, Schema }
import type { ProviderV2 } from "@opencode-ai/core/provider"
import type { ModelV2 } from "@opencode-ai/core/model"
import type { AgentV2 as Agent } from "@opencode-ai/core/agent"
import type { SessionID, MessageID } from "@opencode-ai/core/session/schema"
import type { ToolRegistrationError } from "./tool"

export type { SessionID, MessageID, ToolRegistrationError }

/**
 * ToolDefinition - Unified tool definition using Effect Schema internally,
 * JSON Schema for model output.
 */
export interface ToolDefinition<
  Parameters extends Schema.Schema<unknown> = Schema.Schema<unknown>,
  Output extends Schema.Schema<unknown> = Schema.Schema<unknown>
> {
  readonly id: string
  readonly description: string
  readonly parameters: Parameters
  readonly output: Output
  readonly jsonSchema: JSONSchema7
  readonly execute: (
    input: Schema.Schema.Type<Parameters>,
    context: ToolContext
  ) => Effect.Effect<ToolExecutionResult, ToolFailure>
  readonly toModelOutput?: (
    input: {
      readonly input: Schema.Schema.Type<Parameters>
      readonly output: unknown
    }
  ) => ReadonlyArray<ToolContent>
  readonly maxResultSizeChars?: number
  readonly permission?: string
  readonly subagentSafe?: boolean
  readonly availability?: ToolAvailability
  readonly describe?: (agent: Agent.Info) => Effect.Effect<string>
}

/**
 * ToolContext - Layered context system
 * BaseToolContext → CliToolContext → PluginToolContext
 */
export interface BaseToolContext {
  readonly sessionID: SessionID
  readonly messageID: MessageID
  readonly agent: string
  readonly abort: AbortSignal
  readonly callID?: string
  readonly extra?: Readonly<Record<string, unknown>>
}

export interface CliToolContext extends BaseToolContext {
  readonly messages: ReadonlyArray<SessionMessage>
  readonly metadata: (input: { title?: string; metadata?: Record<string, unknown> }) => Effect.Effect<void>
  readonly ask: (input: Omit<PermissionRequest, "id" | "sessionID" | "tool">) => Effect.Effect<void>
}

export interface PluginToolContext extends BaseToolContext {
  readonly directory: string
  readonly worktree: string
  readonly ask: (input: AskInput) => Promise<void>
}

export type ToolContext = BaseToolContext | CliToolContext | PluginToolContext

/**
 * ToolAvailability - Static + Dynamic with memoization
 */
export interface AvailabilityInput {
  readonly flags: RuntimeFlags.Info
  readonly providerID?: ProviderV2.ID
  readonly modelID?: ModelV2.ID
  readonly agentID?: Agent.ID
}

export type ToolAvailability = (input: AvailabilityInput) => boolean

export interface ToolAvailabilityCache {
  get(key: AvailabilityKey): boolean | undefined
  set(key: AvailabilityKey, value: boolean): void
}

export interface AvailabilityKey {
  readonly flagsHash: string
  readonly providerID?: string
  readonly modelID?: string
  readonly agentID?: string
}

/**
 * ToolPermission - Hybrid: static permission on Def + dynamic ctx.ask()
 */
export interface PermissionRequest {
  readonly id: string
  readonly sessionID: SessionID
  readonly tool: string
  readonly permission: string
  readonly patterns: ReadonlyArray<string>
  readonly always: ReadonlyArray<string>
  readonly metadata: Record<string, unknown>
}

export interface AskInput {
  readonly permission: string
  readonly patterns: ReadonlyArray<string>
  readonly always: ReadonlyArray<string>
  readonly metadata: Record<string, unknown>
}

/**
 * ToolExecution - Execution result with truncation applied post-execution
 */
export interface ToolContent {
  readonly type: "text" | "file"
  readonly text?: string
  readonly data?: string
  readonly mime?: string
  readonly name?: string
}

export interface ToolExecutionResult<M extends Record<string, unknown> = Record<string, unknown>> {
  readonly title: string
  readonly metadata: M
  readonly output: string
  readonly attachments?: ReadonlyArray<Omit<SessionFilePart, "id" | "sessionID" | "messageID">>
  readonly truncated?: boolean
  readonly outputPath?: string
}

export interface ToolFailure {
  readonly message: string
  readonly cause?: unknown
}

export class ToolFailureError extends Schema.TaggedErrorClass<ToolFailureError>()(
  "ToolFailure",
  { message: Schema.String, cause: Schema.Unknown }
) {}

/**
 * ExternalToolLoader - Separate service for external tool discovery
 */
export interface ExternalToolDefinition {
  readonly id: string
  readonly description: string
  readonly parameters: JSONSchema7
  readonly execute: (args: unknown, context: PluginToolContext) => Promise<ToolExecutionResult>
}

export interface ExternalToolLoader {
  readonly load: (directories: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<ExternalToolDefinition>, unknown>
  readonly watch: (directories: ReadonlyArray<string>) => Effect.Effect<void, unknown>
}

/**
 * ToolRegistry Interface
 */
export interface ToolRegistryInterface {
  readonly register: <P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>(
    def: ToolDefinition<P, O>
  ) => Effect.Effect<void>
  readonly get: <P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>(
    id: string
  ) => Effect.Effect<ToolDefinition<P, O> | undefined>
  readonly list: () => Effect.Effect<ReadonlyArray<ToolDefinition>>
  readonly tools: (model: { providerID: ProviderV2.ID; modelID: ModelV2.ID; agent: Agent.Info }) => Effect.Effect<ReadonlyArray<ToolDefinition>>
  readonly named: () => Effect.Effect<{ task: ToolDefinition; read: ToolDefinition }>
  readonly settle: <P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>(
    tool: ToolDefinition<P, O>,
    call: ToolCall,
    context: ToolContext
  ) => Effect.Effect<ToolExecutionResult, ToolFailure, P["DecodingServices"] | O["EncodingServices"]>
}

/**
 * ToolCall - LLM tool call representation
 */
export interface ToolCall {
  readonly id: string
  readonly name: string
  readonly input: unknown
}

/**
 * SessionMessage/SessionFilePart - Minimal types for context
 */
export interface SessionMessage {
  readonly id: MessageID
  readonly sessionID: SessionID
  readonly role: "user" | "assistant" | "system"
  readonly parts: ReadonlyArray<SessionPart>
}

export interface SessionPart {
  readonly type: string
}

export interface SessionFilePart {
  readonly id: string
  readonly sessionID: SessionID
  readonly messageID: MessageID
  readonly type: "file"
  readonly mime: string
  readonly data: string
  readonly name?: string
}

/**
 * RuntimeFlags - Minimal for availability
 */
export namespace RuntimeFlags {
  export interface Info {
    readonly [key: string]: boolean | string | number | undefined
  }
}

export * as ToolTypes from "./types"