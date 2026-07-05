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
    return input instanceof OutputLengthError
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
    return input instanceof AuthError
  }
  toObject(): { name: string; data: { providerID: string; message: string } } {
    return { name: this._tag, data: { providerID: this.providerID, message: this.message } }
  }
}

export class AbortedError extends Schema.TaggedErrorClass<AbortedError>()("MessageAbortedError", {
  message: Schema.String,
}) {
  static isInstance(input: unknown): input is AbortedError {
    return input instanceof AbortedError
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
    return input instanceof StructuredOutputError
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
    return input instanceof APIError
  }
  toObject(): { name: string; data: { message: string; statusCode?: number; isRetryable: boolean; responseHeaders?: Record<string, string>; responseBody?: string; metadata?: Record<string, string> } } {
    return { name: this._tag, data: { message: this.message, statusCode: this.statusCode, isRetryable: this.isRetryable, responseHeaders: this.responseHeaders, responseBody: this.responseBody, metadata: this.metadata } }
  }
}

export class ContextOverflowError extends Schema.TaggedErrorClass<ContextOverflowError>()("ContextOverflowError", {
  message: Schema.String,
  responseBody: Schema.optional(Schema.String),
}) {
  static isInstance(input: unknown): input is ContextOverflowError {
    return input instanceof ContextOverflowError
  }
  toObject(): { name: string; data: { message: string; responseBody?: string } } {
    return { name: this._tag, data: { message: this.message, responseBody: this.responseBody } }
  }
}

export class ContentFilterError extends Schema.TaggedErrorClass<ContentFilterError>()("ContentFilterError", {
  message: Schema.String,
}) {
  static isInstance(input: unknown): input is ContentFilterError {
    return input instanceof ContentFilterError
  }
  toObject(): { name: string; data: { message: string } } {
    return { name: this._tag, data: { message: this.message } }
  }
}
