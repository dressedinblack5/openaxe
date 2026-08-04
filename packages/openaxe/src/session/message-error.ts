import { Schema } from "effect"
import { NamedError } from "@opencode-ai/core/util/error"
import { NonNegativeInt } from "@opencode-ai/core/schema"

export const OutputLengthError = NamedError.create("MessageOutputLengthError", Schema.Struct({}))
export type OutputLengthError = InstanceType<typeof OutputLengthError>

export const AuthError = NamedError.create("ProviderAuthError", {
  providerID: Schema.String,
  message: Schema.String,
})
export type AuthError = InstanceType<typeof AuthError>

export const AbortedError = NamedError.create("MessageAbortedError", { message: Schema.String })
export type AbortedError = InstanceType<typeof AbortedError>

export const StructuredOutputError = NamedError.create("StructuredOutputError", {
  message: Schema.String,
  retries: NonNegativeInt,
})
export type StructuredOutputError = InstanceType<typeof StructuredOutputError>

export const APIError = NamedError.create("APIError", {
  message: Schema.String,
  statusCode: Schema.optional(NonNegativeInt),
  isRetryable: Schema.Boolean,
  responseHeaders: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  responseBody: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
export type APIError = InstanceType<typeof APIError>

export const ContextOverflowError = NamedError.create("ContextOverflowError", {
  message: Schema.String,
  responseBody: Schema.optional(Schema.String),
})
export type ContextOverflowError = InstanceType<typeof ContextOverflowError>

export const ContentFilterError = NamedError.create("ContentFilterError", { message: Schema.String })
export type ContentFilterError = InstanceType<typeof ContentFilterError>

// Backward compatibility aliases
export const ProviderAuthError = AuthError
export type ProviderAuthError = AuthError

export const SharedSchema = Schema.Union([
  OutputLengthError.Schema,
  AuthError.Schema,
  AbortedError.Schema,
  StructuredOutputError.Schema,
  APIError.Schema,
  ContextOverflowError.Schema,
  ContentFilterError.Schema,
])
export type Shared = Schema.Schema.Type<typeof SharedSchema>

// Type guards for narrowing
export const isOutputLengthError = (error: Shared): error is OutputLengthError => OutputLengthError.isInstance(error)
export const isAuthError = (error: Shared): error is AuthError => AuthError.isInstance(error)
export const isAbortedError = (error: Shared): error is AbortedError => AbortedError.isInstance(error)
export const isStructuredOutputError = (error: Shared): error is StructuredOutputError =>
  StructuredOutputError.isInstance(error)
export const isAPIError = (error: Shared): error is APIError => APIError.isInstance(error)
export const isContextOverflowError = (error: Shared): error is ContextOverflowError =>
  ContextOverflowError.isInstance(error)
export const isContentFilterError = (error: Shared): error is ContentFilterError => ContentFilterError.isInstance(error)

export * as MessageError from "./message-error"
