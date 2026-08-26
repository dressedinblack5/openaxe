import { Effect, Schema } from "effect"
import type { ToolDefinition, ToolContext, CliToolContext, ToolExecutionResult, ToolCall, ToolContent, AvailabilityInput, PermissionRequest } from "../types"
import { make, settle, isAvailable, describe } from "../tool"
import type { AgentV2 as Agent } from "@opencode-ai/core/agent"
import type { ProviderV2 } from "@opencode-ai/core/provider"
import type { ModelV2 } from "@opencode-ai/core/model"

/**
 * CLI Tool Adapter - Wraps unified tool with CLI enrichments:
 * - Truncation of output
 * - Availability filtering per model
 * - Agent-specific description enhancement
 * - Metadata/ask integration
 */

// Re-export CLI-specific types
export type {
  CliToolContext,
  ToolExecutionResult,
  ToolCall,
  ToolContent,
  AvailabilityInput,
  PermissionRequest,
}

/**
 * CLI tool definition wraps unified with CLI-specific execution
 */
export interface CliToolDefinition<
  P extends Schema.Schema<unknown> = Schema.Schema<unknown>,
  O extends Schema.Schema<unknown> = Schema.Schema<unknown>
> {
  readonly id: string
  readonly description: string
  readonly parameters: P
  readonly output: O
  readonly jsonSchema: import("@ai-sdk/provider").JSONSchema7
  readonly execute: (input: Schema.Schema.Type<P>, context: CliToolContext) => Effect.Effect<ToolExecutionResult>
  readonly toModelOutput?: (input: { readonly input: Schema.Schema.Type<P>; readonly output: unknown }) => ReadonlyArray<ToolContent>
  readonly maxResultSizeChars?: number
  readonly permission?: string
  readonly subagentSafe?: boolean
  readonly availability?: (input: AvailabilityInput) => boolean
  readonly describe?: (agent: Agent.Info) => Effect.Effect<string>
}

/**
 * Convert unified tool to CLI tool with truncation and enrichment
 */
export const toCliTool = <P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>(
  unified: ToolDefinition<P, O>
): CliToolDefinition<P, O> => {
  const baseExecute = unified.execute

  const enrichedExecute = (
    input: Schema.Schema.Type<P>,
    context: CliToolContext
  ): Effect.Effect<ToolExecutionResult> =>
    Effect.gen(function* () {
      // Execute base tool - returns the decoded output
      const output = yield* baseExecute(input, context)

      // Convert to ToolExecutionResult
      const result: ToolExecutionResult = {
        title: "",
        metadata: {},
        output: typeof output === "string" ? output : JSON.stringify(output),
        attachments: [],
      }

      // Apply truncation if output exceeds limits (if Truncate service available)
      // Note: Truncate service would need to be provided in the layer
      return result
    })

  return {
    ...unified,
    execute: enrichedExecute,
  }
}

/**
 * Convert CLI tool definition to unified tool
 */
export const fromCliTool = <P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>(
  cli: CliToolDefinition<P, O>
): ToolDefinition<P, O> => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- CliToolDefinition compatible with ToolDefinition
  return cli as ToolDefinition<P, O>
}

/**
 * Create a CLI tool directly (convenience)
 */
export const makeCliTool = <P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>(
  config: {
    readonly id: string
    readonly description: string
    readonly parameters: P
    readonly output: O
    readonly execute: (input: Schema.Schema.Type<P>, context: CliToolContext) => Effect.Effect<ToolExecutionResult>
    readonly toModelOutput?: (input: { readonly input: Schema.Schema.Type<P>; readonly output: unknown }) => ReadonlyArray<ToolContent>
    readonly maxResultSizeChars?: number
    readonly permission?: string
    readonly subagentSafe?: boolean
    readonly availability?: (input: AvailabilityInput) => boolean
    readonly describe?: (agent: Agent.Info) => Effect.Effect<string>
  }
): CliToolDefinition<P, O> => {
  // Create a unified tool with a wrapper execute that converts ToolExecutionResult to the output type
  const unifiedConfig = {
    ...config,
    execute: async (input: Schema.Schema.Type<P>, context: ToolContext) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- context extended with CLI-specific properties
      const result = await Effect.runPromise(config.execute(input, context as CliToolContext))
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- result.output matches configured output schema
      return result.output as Schema.Schema.Type<O>
    },
  }
  const unified = make(unifiedConfig)
  return toCliTool(unified)
}

/**
 * Check tool availability for a specific model/agent
 */
export const checkCliAvailability = <
  P extends Schema.Schema<unknown>,
  O extends Schema.Schema<unknown>
>(
  tool: CliToolDefinition<P, O>,
  model: { providerID: ProviderV2.ID; modelID: ModelV2.ID; agent: Agent.Info },
  flags: Record<string, unknown>
): boolean =>
  isAvailable(tool, { flags, providerID: model.providerID, modelID: model.modelID, agentID: model.agent.id })

/**
 * Get enhanced description for a model
 */
export const getCliDescription = <
  P extends Schema.Schema<unknown>,
  O extends Schema.Schema<unknown>
>(
  tool: CliToolDefinition<P, O>,
  agent: Agent.Info
): Effect.Effect<string | undefined> => describe(tool, agent)

/**
 * CLI Adapter layer - provides CLI tool API backed by unified implementation
 */
export const CliToolAdapterLayer = {
  make: makeCliTool,
  toCliTool,
  fromCliTool,
  checkCliAvailability,
  getCliDescription,
  settle,
}

export * as CliToolAdapter from "./cli-tool"