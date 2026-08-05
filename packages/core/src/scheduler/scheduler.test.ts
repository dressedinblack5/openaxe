import { describe, expect } from "bun:test"
import path from "node:path"
import { Effect, Layer, Scope } from "effect"
import { Database } from "../database/database"
import { SessionExecution } from "../session/execution"
import { SessionSchema } from "../session/schema"
import { testEffect } from "../../test/lib/effect"
import { tmpdir } from "../../test/fixture/tmpdir"
import { Scheduler } from "./scheduler"

const sessionID = SessionSchema.ID.descending("ses_scheduler_test")

// Stub SessionExecution: records every wake instead of touching the real runner.
const makeWakeLog = () => {
  const wakes: string[] = []
  const execution = Layer.succeed(
    SessionExecution.Service,
    SessionExecution.Service.of({
      resume: () => Effect.void,
      wake: (id: SessionSchema.ID) =>
        Effect.sync(() => {
          wakes.push(id)
        }),
      interrupt: () => Effect.void,
    }),
  )
  return { wakes, execution }
}

// Fresh temp DB + wake stub + scope per test, so rows and fibers never leak.
const withScheduler = <A, E>(
  body: (service: Scheduler.Interface, wakes: string[]) => Effect.Effect<A, E, Scope.Scope>,
) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const dir = await tmpdir()
      const { wakes, execution } = makeWakeLog()
      const layer = Scheduler.layer
        .pipe(
          Layer.provide(Database.layerFromPath(path.join(dir.path, "scheduler.sqlite"))),
          Layer.provide(execution),
        )
      return { dir, wakes, layer }
    }),
    ({ dir }) => Effect.promise(() => dir[Symbol.asyncDispose]()),
  ).pipe(
    Effect.flatMap(({ wakes, layer }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const service = yield* Scheduler.Service
          return yield* body(service, wakes)
        }).pipe(Effect.provide(layer)),
      ),
    ),
  )

const it = testEffect(Layer.empty)

describe("Scheduler", () => {
  it.effect("scheduleSession persists a row and list returns it", () =>
    withScheduler((service) =>
      Effect.gen(function* () {
        yield* service.scheduleSession(sessionID, "0 9 * * *")

        const schedules = yield* service.list()
        expect(schedules).toHaveLength(1)
        expect(schedules[0]).toMatchObject({
          sessionID,
          cron: "0 9 * * *",
          enabled: true,
        })
        expect(schedules[0].nextRun).toBeGreaterThan(Date.now())
        expect(schedules[0].createdAt).toBeGreaterThan(0)
      }),
    ),
  )

  it.effect("re-scheduling the same session replaces the cron", () =>
    withScheduler((service) =>
      Effect.gen(function* () {
        yield* service.scheduleSession(sessionID, "0 9 * * *")
        yield* service.scheduleSession(sessionID, "0 18 * * *")

        const schedules = yield* service.list()
        expect(schedules).toHaveLength(1)
        expect(schedules[0].cron).toBe("0 18 * * *")
      }),
    ),
  )

  it.effect("unschedule removes the row", () =>
    withScheduler((service) =>
      Effect.gen(function* () {
        yield* service.scheduleSession(sessionID, "0 9 * * *")
        yield* service.unschedule(sessionID)

        expect(yield* service.list()).toHaveLength(0)
      }),
    ),
  )

  it.effect("invalid cron is rejected with a typed error and persists nothing", () =>
    withScheduler((service) =>
      Effect.gen(function* () {
        const outcome = yield* service.scheduleSession(sessionID, "not a cron").pipe(Effect.result)

        expect(outcome._tag).toBe("Failure")
        if (outcome._tag === "Success") return
        expect(outcome.failure).toBeInstanceOf(Scheduler.InvalidCronError)
        expect(yield* service.list()).toHaveLength(0)
      }),
    ),
  )

  it.live("fires SessionExecution.wake on cron ticks and stops after unschedule", () =>
    withScheduler((service, wakes) =>
      Effect.gen(function* () {
        yield* service.scheduleSession(sessionID, "* * * * * *") // per-second cron

        const before = wakes.length
        yield* Effect.sleep(2500) // immediate run + per-second ticks
        expect(wakes.length).toBeGreaterThan(before)

        const atUnschedule = wakes.length
        yield* service.unschedule(sessionID)
        yield* Effect.sleep(1200)
        expect(wakes.length).toBe(atUnschedule)
      }),
    ),
  )
})
