import { Schema } from "effect"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { ModelNotFoundError as ProviderModelNotFoundError } from "@/provider/provider"
import type { Agent } from "@/agent/agent"

const UnknownErrorSchema = Schema.Struct({
  name: Schema.Literal("UnknownError"),
  data: Schema.Struct({
    message: Schema.String,
    ref: Schema.optional(Schema.String),
  }),
}).annotate({ identifier: "UnknownError" })

export function unknown(message: string, ref?: string) {
  return UnknownErrorSchema.make({ name: "UnknownError", data: { message, ...(ref ? { ref } : {}) } })
}

const AgentNotFoundErrorSchema = Schema.Struct({
  name: Schema.Literal("AgentNotFoundError"),
  data: Schema.Struct({
    agent: Schema.String,
    available: Schema.Array(Schema.String),
  }),
}).annotate({ identifier: "AgentNotFoundError" })

export function agentNotFound(agent: string, available: ReadonlyArray<string>) {
  return AgentNotFoundErrorSchema.make({ name: "AgentNotFoundError", data: { agent, available: [...available] } })
}

const CommandNotFoundErrorSchema = Schema.Struct({
  name: Schema.Literal("CommandNotFoundError"),
  data: Schema.Struct({
    command: Schema.String,
    available: Schema.Array(Schema.String),
  }),
}).annotate({ identifier: "CommandNotFoundError" })

export function commandNotFound(command: string, available: ReadonlyArray<string>) {
  return CommandNotFoundErrorSchema.make({ name: "CommandNotFoundError", data: { command, available: [...available] } })
}

const ModelNotFoundErrorSchema = Schema.Struct({
  name: Schema.Literal("ModelNotFoundError"),
  data: Schema.Struct({
    providerID: Schema.String,
    modelID: Schema.String,
    suggestions: Schema.Array(Schema.String),
  }),
}).annotate({ identifier: "ModelNotFoundError" })

export function modelNotFound(error: ProviderModelNotFoundError) {
  return ModelNotFoundErrorSchema.make({
    name: "ModelNotFoundError",
    data: { providerID: error.providerID, modelID: error.modelID, suggestions: error.suggestions ?? [] },
  })
}

export * as EventError from "./event-error"