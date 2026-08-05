import type { Argv } from "yargs"
import { Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd, fail } from "../effect-cmd"
import { Scheduler } from "@opencode-ai/core/scheduler/scheduler"
import { SessionID } from "@/session/schema"
import { UI } from "../ui"

export const ScheduleCommand = cmd({
  command: "schedule",
  describe: "schedule autonomous session runs on cron expressions",
  builder: (yargs: Argv) =>
    yargs
      .command(ScheduleAddCommand)
      .command(ScheduleListCommand)
      .command(ScheduleRemoveCommand)
      .demandCommand(),
  async handler() {},
})

export const ScheduleAddCommand = effectCmd({
  command: "add <sessionID> <cron>",
  describe: "schedule a session to wake on a cron expression (persisted; resumes when openaxe runs)",
  builder: (yargs) =>
    yargs
      .positional("sessionID", {
        describe: "session ID to schedule",
        type: "string",
        demandOption: true,
      })
      .positional("cron", {
        describe: "cron expression, e.g. '0 * * * *' for hourly",
        type: "string",
        demandOption: true,
      }),
  instance: false,
  handler: Effect.fn("Cli.schedule.add")(function* (args) {
    const scheduler = yield* Scheduler.Service
    // scheduleSession forks a tick fiber into its Scope; the DB row is what
    // persists — the fiber is resumed on next openaxe run via the layer.
    yield* Effect.scoped(scheduler.scheduleSession(SessionID.make(args.sessionID), args.cron)).pipe(
      Effect.catchTag("Scheduler.InvalidCronError", (error) => fail(error.message)),
    )
    UI.println(
      UI.Style.TEXT_SUCCESS_BOLD + `Scheduled ${args.sessionID} on "${args.cron}"` + UI.Style.TEXT_NORMAL,
    )
  }),
})

export const ScheduleListCommand = effectCmd({
  command: "list",
  describe: "list scheduled sessions",
  instance: false,
  handler: Effect.fn("Cli.schedule.list")(function* () {
    const scheduler = yield* Scheduler.Service
    const schedules = yield* scheduler.list()
    if (schedules.length === 0) {
      UI.println("No schedules")
      return
    }
    for (const schedule of schedules) {
      const next = schedule.nextRun === null ? "-" : new Date(schedule.nextRun).toISOString()
      UI.println(`${schedule.sessionID}\t${schedule.cron}\tnext: ${next}${schedule.enabled ? "" : " (disabled)"}`)
    }
  }),
})

export const ScheduleRemoveCommand = effectCmd({
  command: "remove <sessionID>",
  describe: "remove a session's schedule",
  builder: (yargs) =>
    yargs.positional("sessionID", {
      describe: "session ID to unschedule",
      type: "string",
      demandOption: true,
    }),
  instance: false,
  handler: Effect.fn("Cli.schedule.remove")(function* (args) {
    const scheduler = yield* Scheduler.Service
    yield* scheduler.unschedule(SessionID.make(args.sessionID))
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Unscheduled ${args.sessionID}` + UI.Style.TEXT_NORMAL)
  }),
})
