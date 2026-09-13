import { Schema } from "effect"

/**
 * PII gate schemas (offline PII detector seam).
 *
 * Effect Schemas only, no TF imports. The real `.tflite` PII artifact lands
 * later; the stub abstains until then.
 */

export const DEFAULT_PII_MODEL_PATH = "model/pii.tflite"

/** Confidence at or above which the gate denies instead of falling through. */
export const PII_DENY_CONFIDENCE = 0.8

export const PiiInput = Schema.Struct({
  text: Schema.String,
})
export type PiiInput = Schema.Schema.Type<typeof PiiInput>

export const PiiOutput = Schema.Struct({
  hit: Schema.Boolean,
  confidence: Schema.Number,
  kinds: Schema.optional(Schema.Array(Schema.String)),
})
export type PiiOutput = Schema.Schema.Type<typeof PiiOutput>
