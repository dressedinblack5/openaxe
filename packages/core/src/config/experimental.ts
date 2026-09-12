export * as ConfigExperimental from "./experimental"

import { Schema } from "effect"
import { Catalog } from "../catalog"
import { Policy as PolicyV2 } from "../policy"

// Each core domain exports the policy actions it supports. Adding an action to
// this union makes it valid in authored config while keeping Policy generic.
export const PolicyAction = Schema.Union([Catalog.PolicyActions])

export class Policy extends Schema.Class<Policy>("ConfigV2.Experimental.Policy")({
  ...PolicyV2.Info.fields,
  action: PolicyAction,
}) {}

export const LearningFallback = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
})

export const LearningGateConfig = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.optional),
  threshold: Schema.Number.pipe(Schema.optional),
  modelPath: Schema.String.pipe(Schema.optional),
})

export const TriageConfig = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.optional),
  modelPath: Schema.String.pipe(Schema.optional),
  threshold: Schema.Number.pipe(Schema.optional),
})

export const PIIConfig = Schema.Struct({
  denyConfidence: Schema.Number.pipe(Schema.optional),
})

export const TFConfig = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.optional),
  triage: TriageConfig.pipe(Schema.optional),
  gate: LearningGateConfig.pipe(Schema.optional),
  pii: PIIConfig.pipe(Schema.optional),
})

export const LearningConfig = Schema.Struct({
  review: Schema.Boolean.pipe(Schema.optional),
  model: Schema.String.pipe(Schema.optional),
  provider: Schema.String.pipe(Schema.optional),
  fallback: LearningFallback.pipe(Schema.Array, Schema.optional),
  gate: LearningGateConfig.pipe(Schema.optional),
})

export class Experimental extends Schema.Class<Experimental>("ConfigV2.Experimental")({
  policies: Policy.pipe(Schema.Array, Schema.optional),
  validate_patch_ts: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Validate patched .ts/.tsx files for syntax errors before writing (default: true)",
  }),
  learning: LearningConfig.pipe(Schema.optional),
  tf: TFConfig.pipe(Schema.optional),
}) {}
