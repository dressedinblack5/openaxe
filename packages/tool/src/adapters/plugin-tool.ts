import { Effect, Schema } from "effect"
import type { ToolDefinition, PluginToolContext, ToolExecutionResult, ToolCall, BaseToolContext } from "../types"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { make, settle, isAvailable } from "../tool"
import z from "zod"
import { zodToJsonSchema } from "zod-to-json-schema"

/**
 * Plugin Tool Adapter - Zod compatibility layer for existing plugins
 * New plugins should use Effect Schema natively
 */

// Re-export plugin types
export type {
  PluginToolContext,
  ToolExecutionResult,
  ToolCall,
}

/**
 * Zod-based tool definition (legacy plugin format)
 */
export interface ZodToolDefinition<Args extends z.ZodRawShape = z.ZodRawShape> {
  readonly id: string
  readonly description: string
  readonly args: Args
  readonly execute: (
    args: z.infer<z.ZodObject<Args>>,
    context: PluginToolContext
  ) => Promise<ToolExecutionResult | string>
}

/**
 * Convert Zod tool definition to unified Effect Schema tool
 */
export const fromZodTool = <Args extends z.ZodRawShape>(
  zodTool: ZodToolDefinition<Args>
): ToolDefinition => {
  const zodSchema = z.object(zodTool.args)
  const jsonSchema = zodJsonSchema(zodSchema)

  // Create Effect Schema from Zod
  const parameters = Schema.declare<unknown>(
    (u): u is unknown => zodSchema.safeParse(u).success
  ) as Schema.Schema<unknown>

  const output = Schema.String // Default output schema

  return make({
    id: zodTool.id,
    description: zodTool.description,
    parameters,
    output,
    jsonSchema,
    execute: (args, context) =>
      Effect.gen(function* () {
        // Bridge Effect context to Promise-based plugin context
        // Need to extract base context and add plugin-specific fields
        const baseContext = context as BaseToolContext & { directory?: string; worktree?: string }
        const pluginContext: PluginToolContext = {
          ...baseContext,
          directory: baseContext.directory ?? process.cwd(),
          worktree: baseContext.worktree ?? process.cwd(),
          ask: (req) => Promise.resolve(
            // This would need the actual ask implementation from CLI context
            // For now, we'll use a no-op that logs
            console.log("[plugin] ask called:", req)
          ),
        }

        const result = yield* Effect.promise(() =>
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- args validated by Zod schema at runtime
          zodTool.execute(args as z.infer<z.ZodObject<Args>>, pluginContext)
        )

        return typeof result === "string" ? result : JSON.stringify(result)
      }),
    permission: undefined,
    subagentSafe: true,
  })
}

/**
 * Convert unified tool to Zod-compatible definition (for plugin consumption)
 */
export const toZodTool = <P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>(
  unified: ToolDefinition<P, O>
): ZodToolDefinition => {
  // This is lossy - we can't fully reconstruct Zod schema from Effect Schema
  // But we provide the JSON Schema for plugin consumption
  return {
    id: unified.id,
    description: unified.description,
    args: {} as z.ZodRawShape, // Cannot reconstruct Zod from Effect Schema
    execute: async (args, context) => {
      const result = await Effect.runPromise(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- args match unified tool input schema
        unified.execute(args as Schema.Schema.Type<P>, context)
      )
      // Convert to string or ToolExecutionResult
      return typeof result === "string" ? result : JSON.stringify(result)
    },
  }
}

/**
 * Zod to JSON Schema conversion using zod-to-json-schema (v3 compatible)
 */
function zodJsonSchema(schema: z.ZodType): JSONSchema7 {
  // zod-to-json-schema produces v3 compatible JSON Schema
  const result = zodToJsonSchema(schema, { target: "jsonSchema7" })
  return normalizeZodJsonSchema(result)
}

function normalizeZodJsonSchema(value: unknown): JSONSchema7 {
  if (Array.isArray(value)) return value.map((item) => normalizeZodJsonSchema(item))
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "exclusiveMaximum" && key !== "exclusiveMinimum")
      .map(([key, item]) => [key, normalizeZodJsonSchema(item)]),
  )
}

/**
 * Plugin Adapter layer - provides Zod compatibility
 */
export const PluginToolAdapterLayer = {
  fromZodTool,
  toZodTool,
  settle,
  isAvailable,
}

export * as PluginToolAdapter from "./plugin-tool"