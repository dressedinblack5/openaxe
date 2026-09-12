/**
 * Pure regex redaction for tool args.
 *
 * Dependency-free and side-effect-free: safe to run on every
 * `tool.execute.before` trigger. Placeholders contain none of the matchable
 * patterns, so redaction is idempotent (`redact(redact(x)) === redact(x)`).
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const AWS_KEY_RE = /\bAKIA[0-9A-Z]{16}\b/g
const GITHUB_TOKEN_RE = /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g
const API_KEY_RE = /\bsk-[A-Za-z0-9]{20,}\b/g

/** Redact PII/secrets in a single string. Pure and idempotent. */
export function redactText(text: string): string {
  return text
    .replace(EMAIL_RE, "[REDACTED_EMAIL]")
    .replace(AWS_KEY_RE, "[REDACTED_AWS_KEY]")
    .replace(GITHUB_TOKEN_RE, "[REDACTED_GITHUB_TOKEN]")
    .replace(SSN_RE, "[REDACTED_SSN]")
    .replace(API_KEY_RE, "[REDACTED_API_KEY]")
}

/**
 * Deep-redact PII/secrets in tool args. Pure (returns a redacted copy,
 * never mutates the input) and idempotent.
 */
export function redactArgs(args: string): string
export function redactArgs<T>(args: T): T
export function redactArgs(args: unknown): unknown {
  if (typeof args === "string") return redactText(args)
  if (Array.isArray(args)) return args.map(redactArgs)
  if (args !== null && typeof args === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(args)) out[key] = redactArgs(value)
    return out
  }
  return args
}
