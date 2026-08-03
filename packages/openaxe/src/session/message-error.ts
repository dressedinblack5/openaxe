import { Schema } from "effect"
import { NamedError } from "@opencode-ai/core/util/error"
import { OutputLengthError as OutputLengthErrorClass, AuthError as AuthErrorClass, AbortedError as AbortedErrorClass, StructuredOutputError as StructuredOutputErrorClass, APIError as APIErrorClass, ContextOverflowError as ContextOverflowErrorClass, ContentFilterError as ContentFilterErrorClass } from "@opencode-ai/schema/session-v1"

const OutputLengthErrorSchema_ = (OutputLengthErrorClass as any).Schema as any
const AuthErrorSchema_ = (AuthErrorClass as any).Schema as any
const AbortedErrorSchema_ = (AbortedErrorClass as any).Schema as any
const StructuredOutputErrorSchema_ = (StructuredOutputErrorClass as any).Schema as any
const APIErrorSchema_ = (APIErrorClass as any).Schema as any
const ContextOverflowErrorSchema_ = (ContextOverflowErrorClass as any).Schema as any
const ContentFilterErrorSchema_ = (ContentFilterErrorClass as any).Schema as any

export const OutputLengthError = NamedError.create("MessageOutputLengthError", OutputLengthErrorSchema_)
export type OutputLengthError = InstanceType<typeof OutputLengthError>

export const AuthError = NamedError.create("ProviderAuthError", AuthErrorSchema_)
export type AuthError = InstanceType<typeof AuthError>

export const AbortedError = NamedError.create("MessageAbortedError", AbortedErrorSchema_)
export type AbortedError = InstanceType<typeof AbortedError>

export const StructuredOutputError = NamedError.create("StructuredOutputError", StructuredOutputErrorSchema_)
export type StructuredOutputError = InstanceType<typeof StructuredOutputError>

export const APIError = NamedError.create("APIError", APIErrorSchema_)
export type APIError = InstanceType<typeof APIError>

export const ContextOverflowError = NamedError.create("ContextOverflowError", ContextOverflowErrorSchema_)
export type ContextOverflowError = InstanceType<typeof ContextOverflowError>

export const ContentFilterError = NamedError.create("ContentFilterError", ContentFilterErrorSchema_)
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