export * as Token from "./token"

/**
 * Rough token-count estimator for text strings.
 *
 * Uses an empirical per-character ratio that varies by content type:
 * - Alphabetic text: ~1 token per 4 chars (standard heuristic).
 * - Non-alphabetic chars (code, punctuation, numbers) are ~2× more token-dense,
 *   so we count them at ~1 token per 2 chars.
 *
 * This is a heuristic, not a true tokenizer. Accurate enough for compaction
 * decisions and context-window gating. Add a real tokenizer (tiktoken, etc.)
 * when per-model exact counts are required.
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
