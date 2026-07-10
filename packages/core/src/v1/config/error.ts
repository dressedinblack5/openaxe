export * as ConfigErrorV1 from "./error"

import { Schema } from "effect"

const Issue = Schema.StructWithRest(
  Schema.Struct({
    message: Schema.String,
    path: Schema.Array(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

export class JsonError extends Schema.TaggedErrorClass<JsonError>()("ConfigJsonError", {
  path: Schema.String,
  message: Schema.optional(Schema.String),
}) {}

export class InvalidError extends Schema.TaggedErrorClass<InvalidError>()("ConfigInvalidError", {
  path: Schema.String,
  issues: Schema.optional(Schema.Array(Issue)),
  message: Schema.optional(Schema.String),
}) {}

export class FrontmatterError extends Schema.TaggedErrorClass<FrontmatterError>()("ConfigFrontmatterError", {
  path: Schema.String,
  message: Schema.String,
}) {}

export class DirectoryTypoError extends Schema.TaggedErrorClass<DirectoryTypoError>()("ConfigDirectoryTypoError", {
  path: Schema.String,
  dir: Schema.String,
  suggestion: Schema.String,
}) {}

export class RemoteAuthError extends Schema.TaggedErrorClass<RemoteAuthError>()("ConfigRemoteAuthError", {
  url: Schema.String,
  remote: Schema.String,
}) {}
