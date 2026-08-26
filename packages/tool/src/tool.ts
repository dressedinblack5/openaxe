import { Effect, Schema } from "effect"
import type { ToolDefinition, ToolContext, ToolExecutionResult, ToolFailure, ToolCall, ToolContent, AvailabilityInput, ToolAvailability, JSONSchema7 } from "./types"
import type { AgentV2 as Agent } from "@opencode-ai/core/agent"

/**
 * Internal runtime state for a tool (not exposed publicly)
 */
interface ToolRuntime {
  readonly definition: (name: string) => ToolDefinition
  readonly settle: (call: ToolCall, context: ToolContext) => Effect.Effect<ToolExecutionResult, ToolFailure>
  readonly maxResultSizeChars?: number
  readonly permission?: string
  readonly subagentSafe: boolean
  readonly availability?: ToolAvailability
  readonly describe?: (agent: Agent.Info) => Effect.Effect<string>
}

const runtimes = new WeakMap<ToolDefinition, ToolRuntime>()

/**
 * Convert Effect Schema to JSON Schema for model consumption
 */
function toJsonSchema(schema: Schema.Schema<unknown>): JSONSchema7 {
  const document = Schema.toJsonSchemaDocument(schema)
  if (Object.keys(document.definitions).length === 0) return document.schema
  return { ...document.schema, $defs: document.definitions }
}

/**
 * Validate tool name format
 */
export const validateName = (name: string): Effect.Effect<void, ToolRegistrationError> =>
  /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)
    ? Effect.void
    : Effect.fail(new ToolRegistrationError({ name, message: `Invalid tool name: ${name}` }))

export class ToolRegistrationError extends Schema.TaggedErrorClass<ToolRegistrationError>()(
  "Tool.RegistrationError",
  { name: Schema.String, message: Schema.String }
) {}

/**
 * Create a tool definition from configuration
 */
export function make<P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>(
  config: {
    readonly id: string
    readonly description: string
    readonly parameters: P
    readonly output: O
    readonly execute: (
      input: Schema.Schema.Type<P>,
      context: ToolContext
    ) => Effect.Effect<Schema.Schema.Type<O>, ToolFailure>
    readonly toModelOutput?: (
      input: {
        readonly input: Schema.Schema.Type<P>
        readonly output: unknown
      }
    ) => ReadonlyArray<ToolContent>
    readonly maxResultSizeChars?: number
    readonly permission?: string
    readonly subagentSafe?: boolean
    readonly availability?: ToolAvailability
    readonly describe?: (agent: Agent.Info) => Effect.Effect<string>
  }
): ToolDefinition<P, O> {
  const tool = Object.freeze({}) as ToolDefinition<P, O>
  const definitions = new Map<string, ToolDefinition>()

  const runtime: ToolRuntime<P, O> = {
    definition: (name) => {
      const cached = definitions.get(name)
      if (cached) return cached
      const def = {
        id: config.id,
        description: config.description,
        parameters: config.parameters,
        output: config.output,
        jsonSchema: toJsonSchema(config.parameters),
        execute: config.execute,
        toModelOutput: config.toModelOutput,
        maxResultSizeChars: config.maxResultSizeChars,
        permission: config.permission,
        subagentSafe: config.subagentSafe ?? true,
        availability: config.availability,
        describe: config.describe,
      } as ToolDefinition
      definitions.set(name, def)
      return def
    },
    settle: (call, context) =>
      Effect.gen(function* () {
        // Decode input
        const decoded = yield* Schema.decodeUnknownEffect(config.parameters)(call.input).pipe(
          Effect.mapError(
            (error) =>
              new ToolFailure({
                message: `Invalid tool input: ${error.message}`,
                cause: error,
              }),
          ),
        )

        // Execute
        const output = yield* config.execute(decoded, context).pipe(
          Effect.mapError(
            (error) =>
              new ToolFailure({
                message: error.message,
                cause: error,
              }),
          ),
        )

        // Encode output
        const encoded = yield* Schema.encodeEffect(config.output)(output).pipe(
          Effect.mapError(
            (error) =>
              new ToolFailure({
                message: `Tool returned invalid output: ${error.message}`,
                cause: error,
              }),
          ),
        )

        // Build result
        const toModelOutput = config.toModelOutput?.({ input: decoded, output: encoded }) ?? []
        const result: ToolExecutionResult = {
          title: "",
          metadata: {},
          output: typeof output === "string" ? output : JSON.stringify(output),
          attachments: [],
          ...(toModelOutput.length > 0 && { metadata: { modelOutput: toModelOutput } }),
        }
        return result
      }),
    maxResultSizeChars: config.maxResultSizeChars,
    permission: config.permission,
    subagentSafe: config.subagentSafe ?? true,
    availability: config.availability,
    describe: config.describe,
  }

  runtimes.set(tool, runtime)
  return tool
}

/**
 * Add permission requirement to a tool (decorator pattern)
 */
export const withPermission = <P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>(
  tool: ToolDefinition<P, O>,
  permission: string
): ToolDefinition<P, O> => {
  const runtime = runtimes.get(tool)
  if (!runtime) throw new TypeError("Invalid tool: not created by make()")

  const decorated = Object.freeze({}) as ToolDefinition<P, O>
  runtimes.set(decorated, { ...runtime, permission })
  return decorated
}

/**
 * Get tool runtime (internal)
 */
function getRuntime<P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>(
  tool: ToolDefinition<P, O>
): ToolRuntime {
  const runtime = runtimes.get(tool)
  if (!runtime) throw new TypeError("Invalid tool: not created by make()")
  return runtime
}

/**
 * Get tool definition for a model
 */
export const definition = <P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>(
  name: string,
  tool: ToolDefinition<P, O>
): ToolDefinition => getRuntime(tool).definition(name)

/**
 * Settle a tool call (execute with validation, encoding, etc.)
 */
export const settle = <P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>(
  tool: ToolDefinition<P, O>,
  call: ToolCall,
  context: ToolContext
): Effect.Effect<ToolExecutionResult, ToolFailure> => getRuntime(tool).settle(call, context)

/**
 * Get tool permission
 */
export const permission = <P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>(
  tool: ToolDefinition<P, O>,
  name: string
): string | undefined => getRuntime(tool).permission ?? name

/**
 * Get max result size
 */
export const maxResultSizeChars = <P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>(
  tool: ToolDefinition<P, O>
): number | undefined => getRuntime(tool).maxResultSizeChars

/**
 * Check if tool is subagent-safe
 */
export const subagentSafe = <P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>(
  tool: ToolDefinition<P, O>
): boolean => getRuntime(tool).subagentSafe

/**
 * Check tool availability for a model
 */
export const isAvailable = <P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>(
  tool: ToolDefinition<P, O>,
  input: AvailabilityInput
): boolean => getRuntime(tool).availability?.(input) ?? true

/**
 * Get tool description enhancer
 */
export const describe = <P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>(
  tool: ToolDefinition<P, O>,
  agent: Agent.Info
): Effect.Effect<string | undefined> => {
  const runtime = getRuntime(tool)
  return runtime.describe ? runtime.describe(agent) : Effect.succeed(undefined)
}

export * as Tool from "./tool"