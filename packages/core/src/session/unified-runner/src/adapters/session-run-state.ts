import { Effect, Layer, Context, Scope, Latch } from "effect"
import { SessionRunState, Session } from "@opencode-ai/openaxe/session"
import { SessionSchema, SessionID, SessionV1 } from "@opencode-ai/schema"
import { BackgroundJob } from "@opencode-ai/openaxe/background/job"
import { SessionStatus } from "@opencode-ai/openaxe/session/status"
import { UnifiedRunnerInterface, SessionEventSubscriberInterface, RunnerState } from "../types"
import { InstanceState } from "@opencode-ai/openaxe/effect/instance-state"
import { Runner } from "@opencode-ai/openaxe/effect/runner"

/**
 * CLI Adapter - Wraps UnifiedRunner + SessionEventSubscriber
 * Implements the original SessionRunState interface
 */
export const layer = Layer.effect(
  SessionRunState,
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service
    const status = yield* SessionStatus.Service
    const unifiedRunner = yield* UnifiedRunnerInterface
    const eventSubscriber = yield* SessionEventSubscriberInterface

    const state = yield* InstanceState.make(
      Effect.fn("SessionRunStateAdapter.state")(function* () {
        const scope = yield* Scope.Scope
        const runners = new Map<SessionID, Runner.Runner<SessionV1.WithParts>>()
        yield* Effect.addFinalizer(
          Effect.fnUntraced(function* () {
            yield* Effect.forEach(runners.values(), (runner) => runner.cancel, {
              concurrency: "unbounded",
              discard: true,
            })
            runners.clear()
          }),
        )
        return { runners, scope }
      }),
    )

    const runner = Effect.fn("SessionRunStateAdapter.runner")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
    ) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (existing) return existing
      const next = Runner.make<SessionV1.WithParts>(data.scope, {
        onIdle: Effect.gen(function* () {
          data.runners.delete(sessionID)
          yield* status.set(sessionID, { type: "idle" })
        }),
        onBusy: status.set(sessionID, { type: "busy" }),
        onInterrupt,
      })
      data.runners.set(sessionID, next)
      return next
    })

    const assertNotBusy = Effect.fn("SessionRunStateAdapter.assertNotBusy")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (existing?.busy) yield* Effect.fail(new Session.BusyError({ sessionID }))
    })

    const cancel = Effect.fn("SessionRunStateAdapter.cancel")(function* (sessionID: SessionID) {
      yield* cancelBackgroundJobs(background, sessionID)
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (!existing) {
        yield* status.set(sessionID, { type: "idle" })
        return
      }
      yield* existing.cancel
      // Also cancel unified runner
      yield* unifiedRunner.cancel(sessionID)
    })

    const ensureRunning = Effect.fn("SessionRunStateAdapter.ensureRunning")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
      work: Effect.Effect<SessionV1.WithParts>,
    ) {
      // Start subscriber for this session
      yield* eventSubscriber.subscribe(sessionID)
      // Run unified runner
      yield* unifiedRunner.run({ sessionID, force: false })
      // Return result from local runner
      return yield* (yield* runner(sessionID, onInterrupt)).ensureRunning(work)
    })

    const startShell = Effect.fn("SessionRunStateAdapter.startShell")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<SessionV1.WithParts>,
      work: Effect.Effect<SessionV1.WithParts>,
      ready?: Latch.Latch,
    ) {
      yield* eventSubscriber.subscribe(sessionID)
      return yield* (yield* runner(sessionID, onInterrupt))
        .startShell(work, ready)
        .pipe(Effect.catchTag("RunnerBusy", () => Effect.fail(new Session.BusyError({ sessionID }))))
    })

    return { assertNotBusy, cancel, ensureRunning, startShell }
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(BackgroundJob.defaultLayer),
  Layer.provide(SessionStatus.defaultLayer),
)

const cancelBackgroundJobs = Effect.fn("SessionRunStateAdapter.cancelBackgroundJobs")(function* (
  background: BackgroundJob.Interface,
  sessionID: SessionID,
) {
  const jobs = yield* background.list()
  const pending = new Set<string>([sessionID])
  const cancelled = new Set<string>()
  const matches = (job: BackgroundJob.Info) => {
    if (job.status !== "running") return false
    if (cancelled.has(job.id)) return false
    if (pending.has(job.id)) return true
    if (typeof job.metadata?.sessionId === "string" && pending.has(job.metadata.sessionId)) return true
    return typeof job.metadata?.parentSessionId === "string" && pending.has(job.metadata.parentSessionId)
  }
  let batch = jobs.filter(matches)
  while (batch.length > 0) {
    yield* Effect.forEach(
      batch,
      (job) =>
        background.cancel(job.id).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              cancelled.add(job.id)
              pending.add(job.id)
              if (typeof job.metadata?.sessionId === "string") pending.add(job.metadata.sessionId)
            }),
          ),
        ),
      { concurrency: "unbounded", discard: true },
    )
    batch = jobs.filter(matches)
  }
})

export * as SessionRunStateAdapter from "./session-run-state"