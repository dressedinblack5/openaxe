// @ts-nocheck
import { Schema } from "effect"
import { SessionEvent, SessionID, SessionMessageID } from "@opencode-ai/schema"

/**
 * Unified Session Runner types
 * Core = durable orchestration (EventV2, DB, compaction, provider turns)
 * CLI = ephemeral UI state (pure reducer over EventV2 stream)
 */

// ============================================================================
// Runner State - emitted as SessionEvent.RunnerStateChanged for CLI subscription
// ============================================================================

export const RunnerStateTag = Schema.Literals(["Idle", "Running", "Shell", "ShellThenRun"])
export type RunnerStateTag = typeof RunnerStateTag.Type

export interface RunnerStateRunning {
  readonly _tag: "Running"
  readonly sessionID: SessionID
  readonly step: number
  readonly assistantMessageID?: SessionMessageID
  readonly providerTurnID: string
}

export interface RunnerStateShell {
  readonly _tag: "Shell"
  readonly sessionID: SessionID
  readonly shellID: string
  readonly command?: string
}

export interface RunnerStateShellThenRun {
  readonly _tag: "ShellThenRun"
  readonly sessionID: SessionID
  readonly shellID: string
  readonly pendingStep: number
}

export interface RunnerStateIdle {
  readonly _tag: "Idle"
}

export type RunnerState = RunnerStateIdle | RunnerStateRunning | RunnerStateShell | RunnerStateShellThenRun

export const RunnerState = {
  idle: (): RunnerState => ({ _tag: "Idle" }),
  running: (input: RunnerStateRunning): RunnerState => input,
  shell: (input: RunnerStateShell): RunnerState => input,
  shellThenRun: (input: RunnerStateShellThenRun): RunnerState => input,
} as const

// ============================================================================
// SessionEvent extensions for Unified Runner
// ============================================================================

/**
 * Emitted when runner state changes - CLI subscribes to this
 */
export const RunnerStateChanged = SessionEvent.define({
  type: "session.runner.state.changed",
  durable: { aggregate: "sessionID", version: 1 },
  schema: {
    timestamp: SessionEvent.DateTimeUtcFromMillis,
    sessionID: SessionID,
    state: Schema.Union(
      Schema.Struct({ _tag: Schema.Literal("Idle") }),
      Schema.Struct({
        _tag: Schema.Literal("Running"),
        sessionID: SessionID,
        step: Schema.Finite,
        assistantMessageID: SessionMessageID.pipe(Schema.optional),
        providerTurnID: Schema.String,
      }),
      Schema.Struct({
        _tag: Schema.Literal("Shell"),
        sessionID: SessionID,
        shellID: Schema.String,
        command: Schema.String.pipe(Schema.optional),
      }),
      Schema.Struct({
        _tag: Schema.Literal("ShellThenRun"),
        sessionID: SessionID,
        shellID: Schema.String,
        pendingStep: Schema.Finite,
      }),
    ),
  },
})

/**
 * Single compaction event (replaces Compaction.Started/Delta/Ended for unified runner)
 */
export const Compacted = SessionEvent.define({
  type: "session.compacted",
  durable: { aggregate: "sessionID", version: 1 },
  schema: {
    timestamp: SessionEvent.DateTimeUtcFromMillis,
    sessionID: SessionID,
    trigger: Schema.Literals(["auto", "explicit", "overflow"]),
    newBaselineSeq: Schema.Finite,
    entriesCompacted: Schema.Finite,
    tokensFreed: Schema.Finite,
  },
})

/**
 * Emitted when session execution is interrupted
 */
export const Interrupted = SessionEvent.define({
  type: "session.interrupted",
  durable: { aggregate: "sessionID", version: 1 },
  schema: {
    timestamp: SessionEvent.DateTimeUtcFromMillis,
    sessionID: SessionID,
    reason: Schema.String,
  },
})

/**
 * Emitted when subagent session is forked
 */
export const SubagentForked = SessionEvent.define({
  type: "session.subagent.forked",
  durable: { aggregate: "sessionID", version: 1 },
  schema: {
    timestamp: SessionEvent.DateTimeUtcFromMillis,
    sessionID: SessionID, // parent session
    subagentSessionID: SessionID,
    parentMessageID: SessionMessageID.pipe(Schema.optional),
  },
})

/**
 * Emitted when subagent session completes
 */
export const SubagentCompleted = SessionEvent.define({
  type: "session.subagent.completed",
  durable: { aggregate: "sessionID", version: 1 },
  schema: {
    timestamp: SessionEvent.DateTimeUtcFromMillis,
    sessionID: SessionID, // parent session
    subagentSessionID: SessionID,
    success: Schema.Boolean,
    error: Schema.String.pipe(Schema.optional),
  },
})

// ============================================================================
// Unified Runner Interface
// ============================================================================

export interface UnifiedRunnerInput {
  readonly sessionID: SessionID
  readonly force: boolean
}

export interface UnifiedRunnerRunResult {
  readonly needsContinuation: boolean
  readonly step: number
}

export class UnifiedRunnerError extends Schema.TaggedErrorClass<UnifiedRunnerError>()("UnifiedRunnerError", {
  sessionID: SessionID,
  cause: Schema.Unknown.pipe(Schema.optional),
}) {
  override get message(): string {
    return `UnifiedRunner error for session ${this.sessionID}`
  }
}

export interface UnifiedRunnerInterface {
  /**
   * Runs one local continuation from already-recorded Session history.
   * Drains eligible durable work. Explicit runs perform one provider attempt
   * even when no work is eligible.
   */
  readonly run: (input: UnifiedRunnerInput) => Effect.Effect<void, UnifiedRunnerError>

  /**
   * Cancels the active run for a session
   */
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>

  /**
   * Drains subagent sessions for a parent session first
   */
  readonly drainSubagents: (parentSessionID: SessionID) => Effect.Effect<void>
}

export class UnifiedRunnerService extends Context.Service<UnifiedRunnerService, UnifiedRunnerInterface>()(
  "@opencode/UnifiedRunner",
) {}

// ============================================================================
// SessionEffectRunner - Internal minimal executor
// ============================================================================

export interface SessionEffectRunner<A, E = never> {
  readonly state: RunnerState
  readonly busy: boolean
  readonly run: (work: Effect.Effect<A, E>) => Effect.Effect<A, E>
  readonly startShell: (work: Effect.Effect<A, E>, ready?: Effect.Latch) => Effect.Effect<A, E>
  readonly cancel: Effect.Effect<void>
}

// ============================================================================
// SessionForkService
// ============================================================================

export interface SessionForkInput {
  readonly parentSessionID: SessionID
  readonly messageID?: SessionMessageID
  readonly subagent: boolean
}

export interface SessionForkResult {
  readonly sessionID: SessionID
  readonly subagent: boolean
}

export interface SessionForkServiceInterface {
  readonly fork: (input: SessionForkInput) => Effect.Effect<SessionForkResult, UnifiedRunnerError>
}

// ============================================================================
// SessionEventSubscriber (CLI) - Pure reducer over EventV2 stream
// ============================================================================

/**
 * SessionData from CLI session-data.ts - reduced from EventV2 stream
 */
export interface SessionData {
  readonly includeUserText: boolean
  readonly announced: boolean
  readonly ids: Set<string>
  readonly tools: Set<string>
  readonly call: Map<string, Record<string, unknown>>
  readonly shell: Map<string, { readonly source: "shell" | "tool"; readonly command?: string }>
  readonly permissions: SessionEvent.PermissionRequest[]
  readonly questions: SessionEvent.QuestionRequest[]
  readonly role: Map<string, "assistant" | "user">
  readonly msg: Map<string, string>
  readonly part: Map<string, "assistant" | "reasoning" | "user">
  readonly text: Map<string, string>
  readonly sent: Map<string, number>
  readonly visible: Map<string, string>
  readonly end: Set<string>
  readonly lastBashOutput?: string
}

export interface SessionDataOutput {
  readonly data: SessionData
  readonly commits: SessionEvent.StreamCommit[]
  readonly footer?: SessionEvent.FooterOutput
}

export type SessionDataReducer = (state: SessionData, event: SessionEvent.Event) => SessionDataOutput

// ============================================================================
// SessionEventSubscriber Service Interface
// ============================================================================

export interface SessionEventSubscriberInterface {
  /**
   * Subscribe to events for a session and reduce to SessionData
   * Publishes result to InstanceState for TUI consumption
   */
  readonly subscribe: (sessionID: SessionID) => Effect.Effect<void>

  /**
   * Unsubscribe from a session
   */
  readonly unsubscribe: (sessionID: SessionID) => Effect.Effect<void>

  /**
   * Get current SessionData for a session (from InstanceState cache)
   */
  readonly getData: (sessionID: SessionID) => Effect.Effect<SessionData | undefined>
}

// ============================================================================
// Effect imports (need to be imported from effect)
// ============================================================================
import { Effect } from "effect"

// Re-export Effect for internal use
export { Effect }

// ============================================================================
// Self-reexport
// ============================================================================
export * as UnifiedRunnerTypes from "./types"
