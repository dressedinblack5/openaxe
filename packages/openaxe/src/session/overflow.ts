import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { RuntimeFlags } from "@/effect/runtime-flags"

const COMPACTION_BUFFER = 20_000

export function usable(input: { cfg: ConfigV1.Info; model: Provider.Model; outputTokenMax?: number }) {
  const context = input.model.limit.context
  if (context === 0) return 0

  const reserved =
    input.cfg.compaction?.reserved ??
    Math.min(COMPACTION_BUFFER, ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
  return input.model.limit.input
    ? Math.max(0, input.model.limit.input - reserved)
    : Math.max(0, context - ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
}

/**
 * Unified Context Budget predicate.
 * Returns true when the conversation has exceeded the compaction threshold.
 * This replaces both the raw overflow check and the cache-aware wrapper.
 */
export function isOverBudget(input: {
  cfg: ConfigV1.Info
  tokens: SessionV1.Assistant["tokens"]
  model: Provider.Model
  outputTokenMax?: number
}): boolean {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false

  const usableTokens = usable(input)

  // Parse threshold (absolute, percentage, or "remaining:N")
  const threshold = input.cfg.compaction?.threshold
    ? parseThreshold(input.cfg.compaction.threshold, usableTokens)
    : usableTokens

  const count =
    input.tokens.total || input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write

  return count >= threshold
}

function parseThreshold(threshold: string, usableTokens: number): number {
  if (threshold.endsWith("%")) {
    const pct = parseFloat(threshold.slice(0, -1)) / 100
    return Math.floor(usableTokens * pct)
  }
  if (threshold.startsWith("remaining:")) {
    const remaining = parseInt(threshold.slice(10), 10)
    return Math.max(0, usableTokens - remaining)
  }
  const absolute = parseInt(threshold, 10)
  return isNaN(absolute) ? usableTokens : absolute
}

/** @deprecated use isOverBudget instead */
export function isOverflow(input: {
  cfg: ConfigV1.Info
  tokens: SessionV1.Assistant["tokens"]
  model: Provider.Model
  outputTokenMax?: number
}) {
  return isOverBudget(input)
}

export * as SessionOverflow from "./overflow"
