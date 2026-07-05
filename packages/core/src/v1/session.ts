export * as SessionV1 from "./session"

import { Schema } from "effect"
import { NonNegativeInt } from "../schema"

export {
  AgentPart,
  AgentPartInput,
  Assistant,
  CompactionPart,
  Event,
  FilePart,
  FilePartInput,
  FilePartSource,
  FileSource,
  Format,
  Info,
  MessageID,
  OutputFormatJsonSchema,
  OutputFormatText,
  Part,
  PartID,
  PatchPart,
  Range,
  ReasoningPart,
  ResourceSource,
  RetryPart,
  SessionInfo,
  SnapshotPart,
  StepFinishPart,
  StepStartPart,
  SubtaskPart,
  SubtaskPartInput,
  SymbolSource,
  TextPart,
  TextPartInput,
  ToolPart,
  ToolState,
  ToolStateCompleted,
  ToolStateError,
  ToolStatePending,
  ToolStateRunning,
  User,
  WithParts,
} from "@opencode-ai/schema/session-v1"

export class OutputLengthError extends Schema.TaggedErrorClass<OutputLengthError>()("MessageOutputLengthError", {}) {
  static isInstance(input: unknown): input is OutputLengthError {
    return input instanceof OutputLengthError || (typeof input === "object" && input !== null && "name" in input && (input as { name: string }).name === "MessageOutputLengthError")
  }
  toObject(): { name: string; data: Record<string, unknown> } {
    return { name: this._tag, data: {} }
  }
}

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("ProviderAuthError", {
  providerID: Schema.String,
  message: Schema.String,
}) {
  static isInstance(input: unknown): input is AuthError {
    return input instanceof AuthError || (typeof input === "object" && input !== null && "name" in input && (input as { name: string }).name === "ProviderAuthError")
  }
  toObject(): { name: string; data: { providerID: string; message: string } } {
    return { name: this._tag, data: { providerID: this.providerID, message: this.message } }
  }
}

export class AbortedError extends Schema.TaggedErrorClass<AbortedError>()("MessageAbortedError", {
  message: Schema.String,
}) {
  static isInstance(input: unknown): input is AbortedError {
    return input instanceof AbortedError || (typeof input === "object" && input !== null && "name" in input && (input as { name: string }).name === "MessageAbortedError")
  }
  toObject(): { name: string; data: { message: string } } {
    return { name: this._tag, data: { message: this.message } }
  }
}

export class StructuredOutputError extends Schema.TaggedErrorClass<StructuredOutputError>()("StructuredOutputError", {
  message: Schema.String,
  retries: NonNegativeInt,
}) {
  static isInstance(input: unknown): input is StructuredOutputError {
    return input instanceof StructuredOutputError || (typeof input === "object" && input !== null && "name" in input && (input as { name: string }).name === "StructuredOutputError")
  }
  toObject(): { name: string; data: { message: string; retries: number } } {
    return { name: this._tag, data: { message: this.message, retries: this.retries } }
  }
}

export class APIError extends Schema.TaggedErrorClass<APIError>()("APIError", {
  message: Schema.String,
  statusCode: Schema.optional(NonNegativeInt),
  isRetryable: Schema.Boolean,
  responseHeaders: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  responseBody: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {
  static isInstance(input: unknown): input is APIError {
    return input instanceof APIError || (typeof input === "object" && input !== null && "name" in input && (input as { name: string }).name === "APIError")
  }
  toObject(): { name: string; data: Record<string, unknown> } {
    const data: Record<string, unknown> = { message: this.message, isRetryable: this.isRetryable }
    if (this.statusCode !== undefined) data.statusCode = this.statusCode
    if (this.responseHeaders !== undefined) data.responseHeaders = this.responseHeaders
    if (this.responseBody !== undefined) data.responseBody = this.responseBody
    if (this.metadata !== undefined) data.metadata = this.metadata
    return { name: this._tag, data }
  }
}

export class ContextOverflowError extends Schema.TaggedErrorClass<ContextOverflowError>()("ContextOverflowError", {
  message: Schema.String,
  responseBody: Schema.optional(Schema.String),
}) {
  static isInstance(input: unknown): input is ContextOverflowError {
    return input instanceof ContextOverflowError || (typeof input === "object" && input !== null && "name" in input && (input as { name: string }).name === "ContextOverflowError")
  }
  toObject(): { name: string; data: Record<string, unknown> } {
    const data: Record<string, unknown> = { message: this.message }
    if (this.responseBody !== undefined) data.responseBody = this.responseBody
    return { name: this._tag, data }
  }
}

export class ContentFilterError extends Schema.TaggedErrorClass<ContentFilterError>()("ContentFilterError", {
  message: Schema.String,
}) {
  static isInstance(input: unknown): input is ContentFilterError {
    return input instanceof ContentFilterError || (typeof input === "object" && input !== null && "name" in input && (input as { name: string }).name === "ContentFilterError")
  }
  toObject(): { name: string; data: { message: string } } {
    return { name: this._tag, data: { message: this.message } }
  }
}
