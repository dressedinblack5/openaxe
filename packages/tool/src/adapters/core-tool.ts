import { Effect } from "effect"
import type { ToolDefinition, ToolContext, ToolExecutionResult, ToolFailure, ToolCall, AvailabilityInput, ToolContent } from "../types"
import { make, validateName, withPermission, definition, settle, permission, maxResultSizeChars, subagentSafe, isAvailable, describe } from "../tool"
import type { Schema } from "effect"
import type { AgentV2 as Agent } from "@opencode-ai/core/agent"

/**
 * Core Tool Adapter - Thin re-export of unified tool API
 * Maps unified ToolDefinition to core tool interface
 */

// Re-export core types from unified module
export type {
  ToolDefinition,
  ToolContext,
  ToolExecutionResult,
  ToolFailure,
  ToolCall,
  AvailabilityInput,
  ToolContent,
}

// Re-export core functions
export { make, validateName, withPermission, definition, settle, permission, maxResultSizeChars, subagentSafe, isAvailable, describe }

/**
 * Convert unified ToolDefinition to core tool Definition format
 * Core tools use: Definition<InputSchema, OutputSchema> with settle(call, context)
 */
export interface CoreToolDefinition<
  Input extends Schema.Schema<unknown> = Schema.Schema<unknown>,
  Output extends Schema.Schema<unknown> = Schema.Schema<unknown>
> {
  readonly id: string
  readonly description: string
  readonly parameters: Input
  readonly output: Output
  readonly execute: (input: Schema.Schema.Type<Input>, context: ToolContext) => Effect.Effect<Schema.Schema.Type<Output>, ToolFailure>
  readonly toModelOutput?: (input: { readonly input: Schema.Schema.Type<Input>; readonly output: unknown }) => ReadonlyArray<ToolContent>
  readonly maxResultSizeChars?: number
  readonly permission?: string
  readonly subagentSafe?: boolean
  readonly availability?: (input: AvailabilityInput) => boolean
  readonly describe?: (agent: Agent.Info) => Effect.Effect<string>
}

/**
 * Convert unified tool to core tool definition
 * The unified tool IS the core tool - no conversion needed
 */
export const toCoreTool = <P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>(
  unified: ToolDefinition<P, O>
): CoreToolDefinition<P, O> => unified as CoreToolDefinition<P, O>

/**
 * Convert core tool definition to unified tool
 */
export const fromCoreTool = <P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>(
  core: CoreToolDefinition<P, O>
): ToolDefinition<P, O> => core as ToolDefinition<P, O>

/**
 * Adapter layer - provides core tool API backed by unified implementation
 */
export const CoreToolAdapterLayer = {
  make,
  validateName,
  withPermission,
  definition,
  settle,
  permission,
  maxResultSizeChars,
  subagentSafe,
  isAvailable,
  describe,
  toCoreTool,
  fromCoreTool,
}

export * as CoreToolAdapter from "./core-tool"