export * as Reflection from "./reflection"

import { eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { ProjectV2 } from "../project"
import { RetryPolicyOverridesTable } from "../session/retry-policy.sql"
import { SessionMessageTable, SessionTable } from "../session/sql"

/**
 * Error classes observed on tool parts. openaxe's `RetryReason` is an open
 * string union, so these values are drop-in compatible with the
 * `retry_policy_overrides` table the runner consults.
 */
export type RetryReason =
  | "rate_limit"
  | "context_length"
  | "timeout"
  | "refusal"
  | "auth"
  | "invalid_request"
  | "server"
  | "unclassified"

interface Policy {
  readonly maxAttempts: number
  readonly baseDelayMs: number
  readonly maxDelayMs: number
  readonly backoffMultiplier: number
  readonly jitter: number
}

// Adjusted retry policy per reason. rate_limit/context_length are tuned to the
// plan; the rest get modest bumps over the baseline (3 attempts, 1s base delay).
const POLICIES: Record<RetryReason, Policy> = {
  rate_limit: { maxAttempts: 5, baseDelayMs: 60_000, maxDelayMs: 300_000, backoffMultiplier: 2, jitter: 0.1 },
  context_length: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, backoffMultiplier: 2, jitter: 0.1 },
  timeout: { maxAttempts: 4, baseDelayMs: 2_000, maxDelayMs: 120_000, backoffMultiplier: 2, jitter: 0.1 },
  server: { maxAttempts: 4, baseDelayMs: 1_000, maxDelayMs: 60_000, backoffMultiplier: 2, jitter: 0.1 },
  refusal: { maxAttempts: 3, baseDelayMs: 2_000, maxDelayMs: 60_000, backoffMultiplier: 2, jitter: 0.1 },
  auth: { maxAttempts: 3, baseDelayMs: 2_000, maxDelayMs: 60_000, backoffMultiplier: 2, jitter: 0.1 },
  invalid_request: { maxAttempts: 3, baseDelayMs: 2_000, maxDelayMs: 60_000, backoffMultiplier: 2, jitter: 0.1 },
  unclassified: { maxAttempts: 3, baseDelayMs: 2_000, maxDelayMs: 60_000, backoffMultiplier: 2, jitter: 0.1 },
}

// A reason only earns an override once it accounts for a meaningful share of
// tool calls (>= 30%) or has happened at least 3 times.
const FAILURE_RATE_THRESHOLD = 0.3
const MIN_FAILURES = 3

export interface Interface {
  /** Scans a project's tool-error history and upserts retry_policy_overrides. No errors -> no changes. */
  readonly analyze: (projectId: ProjectV2.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Reflection") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return { analyze: (projectId) => analyzeProject(db, projectId) }
  }),
)

/** Convenience for callers that provide Reflection.layer (e.g. `openaxe reflection run`). */
export const run = (projectId: ProjectV2.ID): Effect.Effect<void, never, Service> =>
  Effect.gen(function* () {
    yield* (yield* Service).analyze(projectId)
  })

const analyzeProject = (db: Database.Interface["db"], projectId: ProjectV2.ID): Effect.Effect<void> =>
  Effect.gen(function* () {
    const rows = yield* db
      .select({ type: SessionMessageTable.type, data: SessionMessageTable.data })
      .from(SessionMessageTable)
      .innerJoin(SessionTable, eq(SessionMessageTable.session_id, SessionTable.id))
      .where(eq(SessionTable.project_id, projectId))
      .all()
      .pipe(Effect.orDie)

    const failures = new Map<RetryReason, number>()
    let toolCalls = 0
    for (const row of rows) {
      // data stores the message sans type/id (SessionMessageData); the type lives in its own column.
      if (row.type !== "assistant") continue
      for (const part of toolParts(row.data as unknown)) {
        toolCalls++
        const error = toolError(part)
        if (error !== undefined) {
          const reason = classify(error)
          failures.set(reason, (failures.get(reason) ?? 0) + 1)
        }
      }
    }

    if (toolCalls === 0 || failures.size === 0) return

    const now = Date.now()
    for (const [reason, count] of failures) {
      if (count / toolCalls < FAILURE_RATE_THRESHOLD && count < MIN_FAILURES) continue
      const policy = policyRow(POLICIES[reason])
      yield* db
        .insert(RetryPolicyOverridesTable)
        .values({ retry_reason: reason, ...policy, updated_at: now })
        .onConflictDoUpdate({
          target: RetryPolicyOverridesTable.retry_reason,
          set: { ...policy, updated_at: now },
        })
        .run()
        .pipe(Effect.orDie)
    }
  })

const policyRow = (policy: Policy) => ({
  max_attempts: policy.maxAttempts,
  base_delay_ms: policy.baseDelayMs,
  max_delay_ms: policy.maxDelayMs,
  backoff_multiplier: policy.backoffMultiplier,
  jitter: policy.jitter,
})

/** Tool parts of an assistant message's content (defensive: data is unvalidated JSON from the DB). */
const toolParts = (data: unknown): readonly unknown[] => {
  if (!isRecord(data) || !Array.isArray(data.content)) return []
  return data.content.filter((part) => isRecord(part) && part.type === "tool")
}

const toolError = (part: unknown): unknown => {
  if (!isRecord(part) || !isRecord(part.state)) return undefined
  const state = part.state
  return state.status === "error" || state.error !== undefined ? state.error : undefined
}

/**
 * Maps an observed tool error to a retry reason. Mirrors the heuristics of
 * openaxe's `retryable()` (status codes first, then message/body text) without
 * importing it — core cannot depend on openaxe.
 */
export function classify(error: unknown): RetryReason {
  if (!isRecord(error)) return "unclassified"
  const status = errorStatus(error)
  const haystack = [errorText(error), errorBody(error)].join("\n").toLowerCase()

  if (status === 429 || /rate limit|too many requests|rate_limit|throttl|request limit reached/.test(haystack))
    return "rate_limit"
  if (status === 413 || /context length|context window|context_length|maximum context|too long/.test(haystack))
    return "context_length"
  if (status === 401 || status === 403 || /unauthorized|invalid api key|authentication|forbidden|permission denied/.test(haystack))
    return "auth"
  if (status === 408 || /timed out|timeout|etimedout/.test(haystack)) return "timeout"
  if (/refus|content filter|content_filter|moderation|safety|filtered/.test(haystack)) return "refusal"
  if (status === 400 || status === 422 || /invalid request|invalid_request|bad request|invalid input/.test(haystack))
    return "invalid_request"
  if ((status !== undefined && status >= 500) || /server error|internal error|unavailable|overloaded/.test(haystack))
    return "server"
  return "unclassified"
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const errorText = (error: Record<string, unknown>): string => {
  if (typeof error.message === "string") return error.message
  const data = error.data
  if (isRecord(data) && typeof data.message === "string") return data.message
  return ""
}

const errorStatus = (error: Record<string, unknown>): number | undefined => {
  const data = error.data
  const status = isRecord(data) ? data.statusCode : error.statusCode
  return typeof status === "number" ? status : undefined
}

const errorBody = (error: Record<string, unknown>): string | undefined => {
  const data = error.data
  const body = isRecord(data) ? data.responseBody : error.responseBody
  return typeof body === "string" ? body : undefined
}
