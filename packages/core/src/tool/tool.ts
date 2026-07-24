export * as Tool from "./tool"

import { ToolDefinition, ToolFailure, ToolOutput, type ToolCall } from "@opencode-ai/llm"
import { Effect, JsonSchema, Schema } from "effect"
import { Guardrail } from "../guardrail"
import type { AgentV2 } from "../agent"
import type { SessionMessage } from "../session/message"
import type { SessionSchema } from "../session/schema"

export interface Context {
  readonly sessionID: SessionSchema.ID
  readonly agent: AgentV2.ID
  readonly assistantMessageID: SessionMessage.ID
  readonly toolCallID: string
  readonly abortSignal?: AbortSignal
}

export type SchemaType<A> = Schema.Codec<A, any>

declare const TypeId: unique symbol

export interface Definition<Input extends SchemaType<any>, Output extends SchemaType<any>> {
  readonly [TypeId]: {
    readonly _Input: Input
    readonly _Output: Output
  }
}

export type AnyTool = Definition<any, any>
export const Failure = ToolFailure
export type Failure = ToolFailure

export class RegistrationError extends Schema.TaggedErrorClass<RegistrationError>()("Tool.RegistrationError", {
  name: Schema.String,
  message: Schema.String,
}) {}

export type Content =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "file"; readonly data: string; readonly mime: string; readonly name?: string }

export function extractFilePaths(call: ToolCall, output: unknown): readonly string[] {
  const paths = new Set<string>()
  if (typeof call.input === "object" && call.input !== null && !Array.isArray(call.input)) {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion — guarded by typeof checks above
    const input = call.input as Record<string, unknown>
    if (typeof input.path === "string") paths.add(input.path)
  }
  if (typeof output === "object" && output !== null) {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion — guarded by typeof checks above
    const structured = output as Record<string, unknown>
    if (typeof structured.resource === "string") paths.add(structured.resource)
    if (typeof structured.target === "string") paths.add(structured.target)
    if (Array.isArray(structured.applied)) {
      for (const item of structured.applied) {
        if (typeof item === "object" && item !== null) {
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion — guarded by typeof checks
          const obj = item as Record<string, unknown>
          if (typeof obj.resource === "string") paths.add(obj.resource)
          if (typeof obj.target === "string") paths.add(obj.target)
        }
      }
    }
  }
  return Array.from(paths)
}

type Config<Input extends SchemaType<any>, Output extends SchemaType<any>> = {
  readonly description: string
  readonly input: Input
  readonly output: Output
  readonly execute: (
    input: Schema.Schema.Type<Input>,
    context: Context,
  ) => Effect.Effect<Schema.Schema.Type<Output>, ToolFailure>
  readonly toModelOutput?: (input: {
    readonly input: Schema.Schema.Type<Input>
    readonly output: Output["Encoded"]
  }) => ReadonlyArray<Content>
}

type Runtime = {
  readonly permission?: string
  readonly definition: (name: string) => ToolDefinition
  readonly settle: (call: ToolCall, context: Context) => Effect.Effect<ToolOutput, ToolFailure>
}

const runtimes = new WeakMap<AnyTool, Runtime>()

export function make<Input extends SchemaType<any>, Output extends SchemaType<any>>(
  config: Config<Input, Output>,
): Definition<Input, Output> {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- tool is decorated with runtime behavior via WeakMap
  const tool = Object.freeze({}) as Definition<Input, Output>
  const definitions = new Map<string, ToolDefinition>()
  runtimes.set(tool, {
    definition: (name) => {
      const cached = definitions.get(name)
      if (cached) return cached
      const definition = new ToolDefinition({
        name,
        description: config.description,
        inputSchema: toJsonSchema(config.input),
        outputSchema: toJsonSchema(config.output),
      })
      definitions.set(name, definition)
      return definition
    },
    settle: (call, context) =>
      Schema.decodeUnknownEffect(config.input)(call.input).pipe(
        Effect.mapError((error) => new ToolFailure({ message: `Invalid tool input: ${error.message}` })),
        Effect.flatMap((input) =>
          config.execute(input, context).pipe(
            Effect.flatMap((output) =>
              Schema.encodeEffect(config.output)(output).pipe(
                Effect.mapError(
                  (error) =>
                    new ToolFailure({
                      message: `Tool returned an invalid value for its output schema: ${error.message}`,
                    }),
                ),
              ),
            ),
            Effect.flatMap((output) => {
              const toOutput = () => ({
                structured: output,
                content:
                  config.toModelOutput?.({ input, output }).map((part) =>
                    part.type === "text"
                      ? { type: "text" as const, text: part.text }
                      : {
                          type: "file" as const,
                          uri: `data:${part.mime};base64,${part.data}`,
                          mime: part.mime,
                          name: part.name,
                        },
                  ) ?? (typeof output === "string" ? [{ type: "text" as const, text: output }] : []),
              })
              const files = extractFilePaths(call, output)
              if (files.length === 0) return Effect.succeed(toOutput())
              return Effect.serviceOption(Guardrail.Service).pipe(
                Effect.flatMap((option) => {
                  if (option._tag === "None") return Effect.succeed(toOutput())
                  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- verifyProject returns VerificationResult[]
                  return (option.value.verifyProject(files) as Effect.Effect<readonly Guardrail.VerificationResult[]>).pipe(
                    Effect.flatMap((results) => {
                      const failed = results.filter((r) => !r.passed)
                      if (failed.length === 0) return Effect.succeed(toOutput())
                      const details = failed
                        .flatMap((r) => r.diagnostics.map((d) => `${d.file}:${d.line}:${d.column}: ${d.severity}: ${d.message}`))
                        .join("\n")
                      return Effect.fail(new ToolFailure({ message: `Auto-verification failed:\n${details}` }))
                    }),
                    Effect.catchCause(() => Effect.succeed(toOutput())),
                  )
                }),
              )
            }),
          ),
        ),
      ),
  })
  return tool
}

export const validateName = (name: string) =>
  /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)
    ? Effect.void
    : Effect.fail(new RegistrationError({ name, message: `Invalid tool name: ${name}` }))

export const withPermission = <Input extends SchemaType<any>, Output extends SchemaType<any>>(
  tool: Definition<Input, Output>,
  permission: string,
) => {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion — same pattern as make()
  const decorated = Object.freeze({}) as Definition<Input, Output>
  runtimes.set(decorated, { ...runtimeOf(tool), permission })
  return decorated
}

export const permission = (tool: AnyTool, name: string) => runtimeOf(tool).permission ?? name
export const definition = (name: string, tool: AnyTool) => runtimeOf(tool).definition(name)
export const settle = (tool: AnyTool, call: ToolCall, context: Context) => runtimeOf(tool).settle(call, context)

function runtimeOf(tool: AnyTool) {
  const runtime = runtimes.get(tool)
  if (!runtime) throw new TypeError("Invalid Core Tool value")
  return runtime
}

function toJsonSchema(schema: Schema.Top): JsonSchema.JsonSchema {
  const document = Schema.toJsonSchemaDocument(schema)
  if (Object.keys(document.definitions).length === 0) return document.schema
  return { ...document.schema, $defs: document.definitions }
}
