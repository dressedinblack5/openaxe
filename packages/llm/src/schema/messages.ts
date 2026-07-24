import { Schema } from "effect"
import { ToolContent, ToolFileContent, ToolTextContent } from "@opencode-ai/schema/llm"
import { JsonSchema, MessageRole, ProviderMetadata } from "./ids"
import { CacheHint, CachePolicy, GenerationOptions, HttpOptions, ModelSchema, ProviderOptions } from "./options"
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const systemPartSchema = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
  cache: Schema.optional(CacheHint),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "LLM.SystemPart" })
export type SystemPart = Schema.Schema.Type<typeof systemPartSchema>

const makeSystemPart = (text: string): SystemPart => ({ type: "text", text })

export const SystemPart = Object.assign(systemPartSchema, {
  make: makeSystemPart,
  content: (input?: string | SystemPart | ReadonlyArray<SystemPart>) => {
    if (input === undefined) return []
    return typeof input === "string" ? [makeSystemPart(input)] : Array.isArray(input) ? [...input] : [input]
  },
})

export const TextPart = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
  cache: Schema.optional(CacheHint),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Content.Text" })
export type TextPart = Schema.Schema.Type<typeof TextPart>

export const MediaPart = Schema.Struct({
  type: Schema.Literal("media"),
  mediaType: Schema.String,
  data: Schema.Union([Schema.String, Schema.Uint8Array]),
  filename: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "LLM.Content.Media" })
export type MediaPart = Schema.Schema.Type<typeof MediaPart>

export { ToolContent, ToolFileContent, ToolTextContent }

const isToolResultValue = (value: unknown): value is ToolResultValue =>
  isRecord(value) &&
  (value.type === "text" || value.type === "json" || value.type === "error" || value.type === "content") &&
  "value" in value

export const ToolResultValue = Object.assign(
  Schema.Union([
    Schema.Struct({
      type: Schema.Literal("json"),
      value: Schema.Unknown,
    }),
    Schema.Struct({
      type: Schema.Literal("text"),
      value: Schema.Unknown,
    }),
    Schema.Struct({
      type: Schema.Literal("error"),
      value: Schema.Unknown,
    }),
    Schema.Struct({
      type: Schema.Literal("content"),
      value: Schema.Array(ToolContent),
    }),
  ]).annotate({ identifier: "LLM.ToolResult" }),
  {
    is: isToolResultValue,
    make: (value: unknown, type: ToolResultValue["type"] = "json"): ToolResultValue => {
      if (isToolResultValue(value)) return value
      if (type === "content") return { type, value: Array.isArray(value) ? value : [] }
      return { type, value }
    },
  },
)
export type ToolResultValue = Schema.Schema.Type<typeof ToolResultValue>

export interface ToolOutput {
  readonly structured: unknown
  readonly content: ReadonlyArray<ToolContent>
}

export const ToolOutput = Object.assign(
  Schema.Struct({
    structured: Schema.Unknown,
    content: Schema.Array(ToolContent),
  }).annotate({ identifier: "LLM.ToolOutput" }),
  {
    make: (structured: unknown, content: ReadonlyArray<ToolContent> = []): ToolOutput => ({ structured, content }),
    fromResultValue: (result: ToolResultValue): ToolOutput | undefined => {
      switch (result.type) {
        case "json":
          return { structured: result.value, content: [] }
        case "text":
          return { structured: {}, content: [{ type: "text", text: toolResultText(result.value) }] }
        case "content":
          return { structured: {}, content: result.value }
        case "error":
          return undefined
        default:
          return undefined
      }
    },
    toResultValue: (output: ToolOutput): ToolResultValue => {
      if (output.content.length === 0) return { type: "json", value: output.structured }
      if (output.content.length === 1 && output.content[0]?.type === "text")
        return { type: "text", value: output.content[0].text }
      return { type: "content", value: output.content }
    },
  },
)

const toolResultText = (value: unknown) => {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

export const ToolCallPart = Object.assign(
  Schema.Struct({
    type: Schema.Literal("tool-call"),
    id: Schema.String,
    name: Schema.String,
    input: Schema.Unknown,
    providerExecuted: Schema.optional(Schema.Boolean),
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    providerMetadata: Schema.optional(ProviderMetadata),
  }).annotate({ identifier: "LLM.Content.ToolCall" }),
  {
    make: (input: Omit<ToolCallPart, "type">): ToolCallPart => ({ type: "tool-call", ...input }),
  },
)
export type ToolCallPart = Schema.Schema.Type<typeof ToolCallPart>

export const ToolResultPart = Object.assign(
  Schema.Struct({
    type: Schema.Literal("tool-result"),
    id: Schema.String,
    name: Schema.String,
    result: ToolResultValue,
    providerExecuted: Schema.optional(Schema.Boolean),
    cache: Schema.optional(CacheHint),
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    providerMetadata: Schema.optional(ProviderMetadata),
  }).annotate({ identifier: "LLM.Content.ToolResult" }),
  {
    make: (
      input: Omit<ToolResultPart, "type" | "result"> & {
        readonly result: unknown
        readonly resultType?: ToolResultValue["type"]
      },
    ): ToolResultPart => ({
      type: "tool-result",
      id: input.id,
      name: input.name,
      result: ToolResultValue.make(input.result, input.resultType),
      providerExecuted: input.providerExecuted,
      cache: input.cache,
      metadata: input.metadata,
      providerMetadata: input.providerMetadata,
    }),
  },
)
export type ToolResultPart = Schema.Schema.Type<typeof ToolResultPart>

export const ReasoningPart = Schema.Struct({
  type: Schema.Literal("reasoning"),
  text: Schema.String,
  encrypted: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "LLM.Content.Reasoning" })
export type ReasoningPart = Schema.Schema.Type<typeof ReasoningPart>

export const ContentPart = Schema.Union([TextPart, MediaPart, ToolCallPart, ToolResultPart, ReasoningPart]).pipe(
  Schema.toTaggedUnion("type"),
)
export type ContentPart = Schema.Schema.Type<typeof ContentPart>

export type MessageContentInput = string | ContentPart | ReadonlyArray<ContentPart>

export type MessageSystemContentInput = string | TextPart | ReadonlyArray<TextPart>

export type MessageInput = Omit<ConstructorParameters<typeof Message>[0], "content"> & {
  readonly content: MessageContentInput
}

export class Message extends Schema.Class<Message>("LLM.Message")({
  id: Schema.optional(Schema.String),
  role: MessageRole,
  content: Schema.Array(ContentPart),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  native: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {
  static text(value: string): ContentPart {
    return { type: "text", text: value }
  }

  static content(input: MessageContentInput) {
    return typeof input === "string"
      ? [Message.text(input)]
      : Array.isArray(input)
        ? [...input]
        : [input]
  }

  static override make(input: Message | MessageInput) {
    if (input instanceof Message) return input
    return new Message({ ...input, content: Message.content(input.content) })
  }

  static user(content: MessageContentInput) {
    return Message.make({ role: "user", content })
  }

  static assistant(content: MessageContentInput) {
    return Message.make({ role: "assistant", content })
  }

  /**
   * Add an operator-authored instruction at this chronological point in the
   * conversation. This is distinct from the initial `LLMRequest.system`
   * prompt. Keep raw retrieved, tool, and web content out of privileged system
   * updates; pass that untrusted content through ordinary user/tool channels.
   */
  static system(content: MessageSystemContentInput) {
    return Message.make({ role: "system", content })
  }

  static tool(result: ToolResultPart | Parameters<typeof ToolResultPart.make>[0]) {
    return Message.make({
      role: "tool",
      content: ["type" in result ? result : ToolResultPart.make(result)],
    })
  }
}

export type ToolDefinitionInput = ToolDefinition | ConstructorParameters<typeof ToolDefinition>[0]

export class ToolDefinition extends Schema.Class<ToolDefinition>("LLM.ToolDefinition")({
  name: Schema.String,
  description: Schema.String,
  inputSchema: JsonSchema,
  outputSchema: Schema.optional(JsonSchema),
  cache: Schema.optional(CacheHint),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  native: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {
  /** Normalize tool definition input into the canonical `ToolDefinition` class. */
  static override make(input: ToolDefinitionInput) {
    return input instanceof ToolDefinition ? input : new ToolDefinition(input)
  }
}

export type ToolChoiceMode = Exclude<ToolChoice["type"], "tool">

export type ToolChoiceInput = ToolChoice | ConstructorParameters<typeof ToolChoice>[0] | ToolDefinition | string

const isMode = (value: string): value is ToolChoiceMode =>
  value === "auto" || value === "none" || value === "required"

export class ToolChoice extends Schema.Class<ToolChoice>("LLM.ToolChoice")({
  type: Schema.Literals(["auto", "none", "required", "tool"]),
  name: Schema.optional(Schema.String),
}) {
  /** Select a specific named tool. */
  static named(value: string) {
    return new ToolChoice({ type: "tool", name: value })
  }

  /** Normalize ergonomic tool-choice inputs into the canonical `ToolChoice` class. */
  static override make(input: ToolChoiceInput) {
    if (input instanceof ToolChoice) return input
    if (input instanceof ToolDefinition) return ToolChoice.named(input.name)
    if (typeof input === "string") return isMode(input) ? new ToolChoice({ type: input }) : ToolChoice.named(input)
    return new ToolChoice(input)
  }
}

export const ResponseFormat = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text") }),
  Schema.Struct({ type: Schema.Literal("json"), schema: JsonSchema }),
  Schema.Struct({ type: Schema.Literal("tool"), tool: ToolDefinition }),
]).pipe(Schema.toTaggedUnion("type"))
export type ResponseFormat = Schema.Schema.Type<typeof ResponseFormat>

export type LLMRequestInput = ConstructorParameters<typeof LLMRequest>[0]

export class LLMRequest extends Schema.Class<LLMRequest>("LLM.Request")({
  id: Schema.optional(Schema.String),
  model: ModelSchema,
  system: Schema.Array(SystemPart),
  messages: Schema.Array(Message),
  tools: Schema.Array(ToolDefinition),
  toolChoice: Schema.optional(ToolChoice),
  generation: Schema.optional(GenerationOptions),
  providerOptions: Schema.optional(ProviderOptions),
  http: Schema.optional(HttpOptions),
  responseFormat: Schema.optional(ResponseFormat),
  cache: Schema.optional(CachePolicy),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {
  static input(request: LLMRequest): LLMRequestInput {
    return {
      id: request.id,
      model: request.model,
      system: request.system,
      messages: request.messages,
      tools: request.tools,
      toolChoice: request.toolChoice,
      generation: request.generation,
      providerOptions: request.providerOptions,
      http: request.http,
      responseFormat: request.responseFormat,
      cache: request.cache,
      metadata: request.metadata,
    }
  }

  static update(request: LLMRequest, patch: Partial<LLMRequestInput>) {
    if (Object.keys(patch).length === 0) return request
    return new LLMRequest({
      ...LLMRequest.input(request),
      ...patch,
      model: patch.model ?? request.model,
    })
  }
}
