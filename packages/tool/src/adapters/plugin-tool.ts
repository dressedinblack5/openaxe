import { Effect, Schema } from "effect"
import type { ToolDefinition, PluginToolContext, ToolExecutionResult, ToolCall, BaseToolContext } from "../types"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { make, settle, isAvailable } from "../tool"
import z from "zod"

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
    jsonSchema: jsonSchema as any, // Type assertion for compatibility
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
    args: {} as any, // Cannot reconstruct Zod from Effect Schema
    execute: async (args, context) => {
      const result = await Effect.runPromise(
        unified.execute(args as any, context)
      )
      // Convert to string or ToolExecutionResult
      return typeof result === "string" ? result : JSON.stringify(result)
    },
  }
}

/**
 * Zod to JSON Schema conversion (copied from CLI registry)
 */
function zodJsonSchema(schema: z.ZodType): JSONSchema7 {
  const result = normalizeZodJsonSchema(z.toJSONSchema(schema, { io: "input", metadata: zodMetadataRegistry(schema) }))
  if (!isJsonSchemaObject(result)) throw new Error("Zod schema produced non-object JSON Schema")
  const { $defs, ...rest } = result
  return $defs && isJsonSchemaObject($defs)
    ? { ...rest, definitions: $defs as JSONSchema7["definitions"] }
    : rest
}

function zodMetadataRegistry(schema: z.ZodType) {
  const registry = z.registry<Record<string, unknown>>()
  const seen = new WeakSet<object>()
  const collect = (value: unknown) => {
    if (typeof value !== "object" || value === null) return
    if (seen.has(value)) return
    seen.add(value)

    if (isZodType(value)) {
      const metadata = typeof value.meta === "function" ? value.meta() : undefined
      const description = typeof value.description === "string" ? value.description : undefined
      const merged = { ...(metadata && typeof metadata === "object" ? metadata : {}), ...(description ? { description } : {}) }
      if (Object.keys(merged).length) registry.add(value, merged)
      collect(value._zod.def)
      return
    }
    for (const item of Object.values(value)) collect(item)
  }
  collect(schema)
  return registry
}

function isZodType(value: unknown): value is z.ZodType {
  return typeof value === "object" && value !== null && "_zod" in value
}

function isJsonSchemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeZodJsonSchema(value: unknown): unknown {
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