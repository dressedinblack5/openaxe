export * as ConfigCompaction from "./compaction"

import { Schema } from "effect"
import { NonNegativeInt } from "../schema"

export class Keep extends Schema.Class<Keep>("ConfigV2.Compaction.Keep")({
  tokens: NonNegativeInt.pipe(Schema.optional),
}) {}

export class Info extends Schema.Class<Info>("ConfigV2.Compaction")({
  auto: Schema.Boolean.pipe(Schema.optional),
  prune: Schema.Boolean.pipe(Schema.optional),
  keep: Keep.pipe(Schema.optional),
  buffer: NonNegativeInt.pipe(Schema.optional),
  structuredSummary: Schema.Boolean.pipe(Schema.optional),
  breadcrumb: Schema.Boolean.pipe(Schema.optional),
  threshold: Schema.String.pipe(Schema.optional),
  toolBudgeting: Schema.Struct({
    enabled: Schema.Boolean.pipe(Schema.optional),
    protectChars: NonNegativeInt.pipe(Schema.optional),
    previewChars: NonNegativeInt.pipe(Schema.optional),
  }).pipe(Schema.optional),
  cacheAware: Schema.Struct({
    enabled: Schema.Boolean.pipe(Schema.optional),
    reanchorOnResponse: Schema.Boolean.pipe(Schema.optional),
  }).pipe(Schema.optional),
  background: Schema.Struct({
    enabled: Schema.Boolean.pipe(Schema.optional),
    checkpointThreshold: Schema.Number.pipe(Schema.optional),
    swapThreshold: Schema.Number.pipe(Schema.optional),
  }).pipe(Schema.optional),
}) {}
