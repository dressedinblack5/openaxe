import { Cause, Deferred, Effect, Exit, Fiber, Latch, Schema, Scope, SynchronizedRef } from "effect"
import { RunnerState } from "./types"

/**
 * SessionEffectRunner - Internal minimal executor
 * Manages Idle/Running/Shell states, emits RunnerStateChanged events
 * Used internally by UnifiedRunner for execution control
 */

export interface SessionEffectRunnerInterface<A, E = never> {
  readonly state: RunnerState
  readonly busy: boolean
  readonly run: (work: Effect.Effect<A, E>) => Effect.Effect<A, E>
  readonly startShell: (work: Effect.Effect<A, E>, ready?: Latch.Latch) => Effect.Effect<A, E>
  readonly cancel: Effect.Effect<void>
}

export class SessionRunnerCancelled extends Schema.TaggedErrorClass<SessionRunnerCancelled>()(
  "SessionEffectRunner.Cancelled",
  {},
) {}

export class SessionRunnerBusy extends Schema.TaggedErrorClass<SessionRunnerBusy>()(
  "SessionEffectRunner.Busy",
  {},
) {}

interface RunHandle<A, E> {
  id: number
  done: Deferred.Deferred<A, E | SessionRunnerCancelled>
  fiber: Fiber.Fiber<A, E>
}

interface ShellHandle<A, E> {
  id: number
  cancelled: Deferred.Deferred<void>
  ready?: Latch.Latch
  fiber: Fiber.Fiber<A, E>
}

interface PendingHandle<A, E> {
  id: number
  done: Deferred.Deferred<A, E | SessionRunnerCancelled>
  work: Effect.Effect<A, E>
}

type InternalState<A, E> =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Running"; readonly run: RunHandle<A, E> }
  | { readonly _tag: "Shell"; readonly shell: ShellHandle<A, E> }
  | { readonly _tag: "ShellThenRun"; readonly shell: ShellHandle<A, E>; readonly run: PendingHandle<A, E> }

/**
 * Creates a SessionEffectRunner scoped to the given scope
 */
export const makeSessionEffectRunner = <A, E = never>(
  scope: Scope.Scope,
  onStateChange: (state: RunnerState) => Effect.Effect<void>,
  opts?: {
    onIdle?: Effect.Effect<void>
    onBusy?: Effect.Effect<void>
    onInterrupt?: Effect.Effect<A, E>
  },
): SessionEffectRunnerInterface<A, E> => {
  const ref = SynchronizedRef.makeUnsafe<InternalState<A, E>>({ _tag: "Idle" })
  const idle = opts?.onIdle ?? Effect.void
  const onBusy = opts?.onBusy ?? Effect.void
  const onInterrupt = opts?.onInterrupt
  let ids = 0

  const getState = () => SynchronizedRef.getUnsafe(ref)
  const next = () => { ids += 1; return ids }

  const toRunnerState = (internal: InternalState<A, E>): RunnerState => {
    switch (internal._tag) {
      case "Idle":
        return { _tag: "Idle" }
      case "Running":
        return {
          _tag: "Running",
          sessionID: "" as any, // Will be set by caller
          step: 1,
          providerTurnID: internal.run.id.toString(),
        }
      case "Shell":
        return {
          _tag: "Shell",
          sessionID: "" as any,
          shellID: internal.shell.id.toString(),
          command: undefined,
        }
      case "ShellThenRun":
        return {
          _tag: "ShellThenRun",
          sessionID: "" as any,
          shellID: internal.shell.id.toString(),
          pendingStep: 1,
        }
    }
  }

  const notifyStateChange = (internal: InternalState<A, E>) =>
    onStateChange(toRunnerState(internal))

  const complete = (done: Deferred.Deferred<A, E | SessionRunnerCancelled>, exit: Exit.Exit<A, E>) =>
    Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
      ? Deferred.fail(done, new SessionRunnerCancelled()).pipe(Effect.asVoid)
      : Deferred.done(done, exit).pipe(Effect.asVoid)

  const awaitDone = (done: Deferred.Deferred<A, E | SessionRunnerCancelled>) =>
    Deferred.await(done).pipe(Effect.catchTag("SessionEffectRunner.Cancelled", (e) => onInterrupt ?? Effect.die(e)))

  const finishRun = (id: number, done: Deferred.Deferred<A, E | SessionRunnerCancelled>, exit: Exit.Exit<A, E>) =>
    SynchronizedRef.modify(
      ref,
      (st) =>
        [
          Effect.gen(function* () {
            if (st._tag === "Running" && st.run.id === id) {
              yield* idle
              yield* notifyStateChange({ _tag: "Idle" })
            }
            yield* complete(done, exit)
          }),
          st._tag === "Running" && st.run.id === id ? ({ _tag: "Idle" } as const) : st,
        ] as const,
    ).pipe(Effect.flatten)

  const startRun = (work: Effect.Effect<A, E>, done: Deferred.Deferred<A, E | SessionRunnerCancelled>) =>
    Effect.gen(function* () {
      const id = next()
      const fiber = yield* work.pipe(
        Effect.onExit((exit) => finishRun(id, done, exit)),
        Effect.forkIn(scope),
      )
      yield* notifyStateChange({
        _tag: "Running",
        sessionID: "" as any,
        step: 1,
        providerTurnID: id.toString(),
      })
      return { id, done, fiber } satisfies RunHandle<A, E>
    })

  const finishShell = (id: number) =>
    SynchronizedRef.modifyEffect(
      ref,
      Effect.fnUntraced(function* (st) {
        if (st._tag === "Shell" && st.shell.id === id) {
          yield* notifyStateChange({ _tag: "Idle" })
          return [idle, { _tag: "Idle" }] as const
        }
        if (st._tag === "ShellThenRun" && st.shell.id === id) {
          const run = yield* startRun(st.run.work, st.run.done)
          yield* notifyStateChange({
            _tag: "Running",
            sessionID: "" as any,
            step: 1,
            providerTurnID: run.id.toString(),
          })
          return [Effect.void, { _tag: "Running", run }] as const
        }
        return [Effect.void, st] as const
      }),
    ).pipe(Effect.flatten)

  const stopShell = (shell: ShellHandle<A, E>) =>
    Effect.gen(function* () {
      if (shell.ready) yield* shell.ready.await.pipe(Effect.exit, Effect.asVoid)
      yield* Deferred.succeed(shell.cancelled, undefined).pipe(Effect.asVoid)
      yield* Fiber.interrupt(shell.fiber)
    })

  const run = (work: Effect.Effect<A, E>) =>
    SynchronizedRef.modifyEffect(
      ref,
      Effect.fnUntraced(function* (st) {
        switch (st._tag) {
          case "Running":
          case "ShellThenRun":
            return [awaitDone(st.run.done), st] as const
          case "Shell": {
            const run = {
              id: next(),
              done: yield* Deferred.make<A, E | SessionRunnerCancelled>(),
              work,
            } satisfies PendingHandle<A, E>
            return [awaitDone(run.done), { _tag: "ShellThenRun", shell: st.shell, run }] as const
          }
          case "Idle": {
            const done = yield* Deferred.make<A, E | SessionRunnerCancelled>()
            const run = yield* startRun(work, done)
            return [awaitDone(done), { _tag: "Running", run }] as const
          }
        }
      }),
    ).pipe(Effect.flatten)

  const startShell = (work: Effect.Effect<A, E>, ready?: Latch.Latch): Effect.Effect<A, E | SessionRunnerBusy> =>
    SynchronizedRef.modifyEffect(
      ref,
      Effect.fnUntraced(function* (st) {
        if (st._tag !== "Idle") {
          const reject: Effect.Effect<A, E | SessionRunnerBusy> = Effect.fail(new SessionRunnerBusy())
          return [reject, st] as const
        }
        yield* onBusy
        const id = next()
        const cancelled = yield* Deferred.make<void>()
        const fiber = yield* work.pipe(Effect.ensuring(finishShell(id)), Effect.forkChild)
        const shell = { id, cancelled, ready, fiber } satisfies ShellHandle<A, E>
        yield* notifyStateChange({
          _tag: "Shell",
          sessionID: "" as any,
          shellID: id.toString(),
          command: undefined,
        })
        return [
          Effect.gen(function* () {
            const exit = yield* Fiber.await(fiber)
            if (Exit.isSuccess(exit)) return exit.value
            if (
              Cause.hasInterruptsOnly(exit.cause) ||
              ((yield* Deferred.isDone(cancelled)) && Cause.hasInterrupts(exit.cause) && !Cause.hasDies(exit.cause))
            ) {
              if (onInterrupt) return yield* onInterrupt
              return yield* Effect.die(new SessionRunnerCancelled())
            }
            return yield* Effect.failCause(exit.cause)
          }),
          { _tag: "Shell", shell },
        ] as const
      }),
    ).pipe(Effect.flatten)

  const cancel = SynchronizedRef.modify(ref, (st) => {
    switch (st._tag) {
      case "Idle":
        return [Effect.void, st] as const
      case "Running":
        return [
          Effect.gen(function* () {
            yield* Fiber.interrupt(st.run.fiber)
            yield* Deferred.fail(st.run.done, new SessionRunnerCancelled()).pipe(Effect.asVoid)
          }),
          { _tag: "Idle" } as const,
        ] as const
      case "Shell":
        return [
          Effect.gen(function* () {
            yield* stopShell(st.shell)
          }),
          { _tag: "Idle" } as const,
        ] as const
      case "ShellThenRun":
        return [
          Effect.gen(function* () {
            yield* stopShell(st.shell)
            yield* Deferred.fail(st.run.done, new SessionRunnerCancelled()).pipe(Effect.asVoid)
          }),
          { _tag: "Idle" } as const,
        ] as const
    }
  }).pipe(Effect.flatten)

  return {
    get state() {
      return toRunnerState(getState())
    },
    get busy() {
      return getState()._tag !== "Idle"
    },
    run,
    startShell,
    cancel,
  }
}

export * as SessionEffectRunner from "./session-effect-runner"