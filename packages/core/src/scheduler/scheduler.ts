export * as Scheduler from "./scheduler"

import { eq } from "drizzle-orm"
import { Context, Cron, Effect, Fiber, Layer, Schedule, Schema, Scope } from "effect"
import { Database } from "../database/database"
import { SessionExecution } from "../session/execution"
import { SessionSchema } from "../session/schema"
import { SessionScheduleTable } from "./sql"

export interface ScheduledSession {
  readonly sessionID: string
  readonly cron: string
  readonly nextRun: number | null
  readonly enabled: boolean
  readonly createdAt: number
  readonly updatedAt: number
}

export class InvalidCronError extends Schema.TaggedErrorClass<InvalidCronError>()("Scheduler.InvalidCronError", {
  cron: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `Invalid cron expression "${this.cron}": ${this.reason}`
  }
}

export interface Interface {
  /** Persists a cron schedule for a session and (re)starts its tick fiber. */
  readonly scheduleSession: (
    sessionID: SessionSchema.ID,
    cron: string,
  ) => Effect.Effect<void, InvalidCronError, Scope.Scope>
  /** Removes the schedule and interrupts its tick fiber. */
  readonly unschedule: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** Returns all enabled schedules. */
  readonly list: () => Effect.Effect<ReadonlyArray<ScheduledSession>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Scheduler") {}

type ScheduleRow = typeof SessionScheduleTable.$inferSelect

const toScheduled = (row: ScheduleRow): ScheduledSession => ({
  sessionID: row.session_id,
  cron: row.cron,
  nextRun: row.next_run,
  enabled: row.enabled === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const execution = yield* SessionExecution.Service
    const fibers = new Map<string, Fiber.Fiber<unknown, unknown>>()

    const fork = (
      sessionID: SessionSchema.ID,
      cron: string,
      parsed: Cron.Cron,
    ): Effect.Effect<Fiber.Fiber<unknown, unknown>, never, Scope.Scope> => {
      const tick = Effect.gen(function* () {
        // Wake is advisory: idle or missing sessions make it a no-op per V2 semantics.
        yield* execution.wake(sessionID).pipe(Effect.ignore)
        const now = Date.now()
        yield* db
          .update(SessionScheduleTable)
          .set({ next_run: Cron.next(parsed, new Date(now)).getTime(), updated_at: now })
          .where(eq(SessionScheduleTable.session_id, sessionID))
          .run()
          .pipe(Effect.orDie)
      })
      // Cron is validated before fork, so a Schedule failure is an internal bug, not a call failure.
      return tick.pipe(Effect.repeat(Schedule.cron(cron)), Effect.orDie, Effect.forkScoped)
    }

    // Resume persisted schedules when the layer starts.
    const rows = yield* db
      .select()
      .from(SessionScheduleTable)
      .where(eq(SessionScheduleTable.enabled, 1))
      .all()
      .pipe(Effect.orDie)
    for (const row of rows) {
      const parsed = Cron.parse(row.cron)
      if (parsed._tag === "Failure") {
        yield* Effect.logWarning(`Scheduler: skipping schedule for ${row.session_id}: ${parsed.failure.message}`)
        continue
      }
      fibers.set(row.session_id, yield* fork(SessionSchema.ID.descending(row.session_id), row.cron, parsed.success))
    }

    const scheduleSession: Interface["scheduleSession"] = (sessionID, cron) =>
      Effect.gen(function* () {
        const parsed = Cron.parse(cron)
        if (parsed._tag === "Failure") {
          yield* new InvalidCronError({ cron, reason: parsed.failure.message })
          return
        }

        const now = Date.now()
        const nextRun = Cron.next(parsed.success, new Date(now)).getTime()
        yield* db
          .insert(SessionScheduleTable)
          .values({
            session_id: sessionID,
            cron,
            next_run: nextRun,
            created_at: now,
            updated_at: now,
          })
          .onConflictDoUpdate({
            target: SessionScheduleTable.session_id,
            set: { cron, next_run: nextRun, enabled: 1, updated_at: now },
          })
          .run()
          .pipe(Effect.orDie)

        const existing = fibers.get(sessionID)
        if (existing) {
          yield* Fiber.interrupt(existing).pipe(Effect.ignore)
          fibers.delete(sessionID)
        }
        fibers.set(sessionID, yield* fork(sessionID, cron, parsed.success))
      })

    const unschedule: Interface["unschedule"] = (sessionID) =>
      Effect.gen(function* () {
        const fiber = fibers.get(sessionID)
        if (fiber) {
          yield* Fiber.interrupt(fiber).pipe(Effect.ignore)
          fibers.delete(sessionID)
        }
        yield* db
          .delete(SessionScheduleTable)
          .where(eq(SessionScheduleTable.session_id, sessionID))
          .run()
          .pipe(Effect.orDie)
      })

    const list: Interface["list"] = () =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(SessionScheduleTable)
          .where(eq(SessionScheduleTable.enabled, 1))
          .all()
          .pipe(Effect.orDie)
        return rows.map(toScheduled)
      })

    return Service.of({ scheduleSession, unschedule, list })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))
