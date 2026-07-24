export * as Token from "./token"

import { countTokens as gptCountTokens } from "gpt-tokenizer"
import { countTokens as anthropicCountTokens } from "@anthropic-ai/tokenizer"

type ModelFamily = "anthropic" | "openai" | "unknown"

const detectModelFamily = (modelId: string | undefined): ModelFamily => {
  if (!modelId) return "unknown"
  // Anthropic Claude models
  if (/^(claude|anthropic\.claude)/i.test(modelId)) return "anthropic"
  // OpenAI models: gpt-*, o1*, o3*, o4*, text-davinci-*
  if (/^(gpt|o[1349]|text-davinci)/i.test(modelId)) return "openai"
  return "unknown"
}

/**
 * Count tokens in a string using the appropriate tokenizer for the given model.
 *
 * Dispatches to the correct tokenizer based on model family:
 * - Anthropic Claude → @anthropic-ai/tokenizer
 * - OpenAI models → gpt-tokenizer (o200k_base encoding)
 * - Unknown → falls back to heuristic `estimate()`
 *
 * @param input - text to count tokens for
 * @param modelId - optional model identifier for tokenizer selection (e.g. `"claude-sonnet-4-20250514"`, `"gpt-4o"`)
 */
export const countTokens = (input: string, modelId?: string): number => {
  if (!input) return 0

  const family = detectModelFamily(modelId)
  try {
    switch (family) {
      case "anthropic":
        return anthropicCountTokens(input)
      case "openai":
        return gptCountTokens(input)
      default:
        return estimate(input)
    }
  } catch {
    // If the native tokenizer throws (e.g. unsupported encoding), fall back
    return estimate(input)
  }
}

/**
 * Rough token-count estimator for text strings.
 *
 * Uses an empirical per-character ratio that varies by content type:
 * - Alphabetic text: ~1 token per 4 chars (standard heuristic).
 * - Non-alphabetic chars (code, punctuation, numbers) are ~2× more token-dense,
 *   so we count them at ~1 token per 2 chars.
 *
 * This is a heuristic, not a true tokenizer. Accurate enough for compaction
 * decisions and context-window gating. Prefer `countTokens()` with a model id
 * for accurate per-model counts.
 *
 * @param input — string to estimate
 * @param ratio — chars per token for alphabetic content (default 4)
 */
export const estimate = (input: string, ratio = 4) => {
  if (!input) return 0
  const alpha = input.replace(/[^a-zA-Z\s]/g, "").length
  const nonAlpha = input.length - alpha
  // ponytail: non-alphabetic chars (code, punctuation, numbers) are ~2× more token-dense
  return Math.max(0, Math.round(alpha / ratio + nonAlpha / (ratio / 2)))
}
