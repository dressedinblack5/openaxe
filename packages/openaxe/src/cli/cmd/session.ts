import type { Argv } from "yargs"
import { Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd, fail } from "../effect-cmd"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../../session/schema"
import { UI } from "../ui"
import { Locale } from "@/util/locale"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { NotFoundError } from "@/storage/storage"
import { EOL } from "os"
import path from "path"
import { which } from "@opencode-ai/core/util/which"
import { InstanceState } from "@/effect/instance-state"
import { Template } from "@/session/template"
import { ForkMerge } from "@/session/fork-merge"

function pagerCmd(): string[] {
  const lessOptions = ["-R", "-S"]
  if (process.platform !== "win32") {
    return ["less", ...lessOptions]
  }

  // user could have less installed via other options
  const lessOnPath = which("less")
  if (lessOnPath) {
    if (Filesystem.stat(lessOnPath)?.size) return [lessOnPath, ...lessOptions]
  }

  if (Flag.OPENCODE_GIT_BASH_PATH) {
    const less = path.join(Flag.OPENCODE_GIT_BASH_PATH, "..", "..", "usr", "bin", "less.exe")
    if (Filesystem.stat(less)?.size) return [less, ...lessOptions]
  }

  const git = which("git")
  if (git) {
    const less = path.join(git, "..", "..", "usr", "bin", "less.exe")
    if (Filesystem.stat(less)?.size) return [less, ...lessOptions]
  }

  // Fall back to Windows built-in more (via cmd.exe)
  return ["cmd", "/c", "more"]
}

export const SessionCommand = cmd({
  command: "session",
  describe: "manage sessions",
  builder: (yargs: Argv) =>
    yargs
      .command(SessionListCommand)
      .command(SessionDeleteCommand)
      .command(SessionCreateCommand)
      .command(SessionForkCommand)
      .command(SessionMergeCommand)
      .demandCommand(),
  async handler() {},
})

export const SessionCreateCommand = effectCmd({
  command: "create",
  describe: "create a session, optionally from a YAML template in .openaxe/templates",
  builder: (yargs) =>
    yargs
      .option("template", {
        alias: "t",
        describe: "create from .openaxe/templates/<name>.yaml",
        type: "string",
      })
      .option("list", {
        describe: "list available session templates",
        type: "boolean",
      }),
  handler: Effect.fn("Cli.session.create")(function* (args) {
    const ctx = yield* InstanceState.context
    const directory = ctx.directory

    if (args.list) {
      const names = yield* Template.listTemplates(directory)
      if (names.length === 0) {
        UI.println("No templates in " + Template.templatesDir(directory))
        return
      }
      UI.println(names.join(EOL))
      return
    }

    if (args.template) {
      const template = yield* Template.loadTemplate(directory, args.template).pipe(
        Effect.catchTag("SessionTemplateError", (error) => fail(error.message)),
      )
      const info = yield* Template.createFromTemplate({ template, directory }).pipe(
        Effect.catchTag("SessionTemplateError", (error) => fail(error.message)),
      )
      UI.println(
        UI.Style.TEXT_SUCCESS_BOLD +
          `Session ${info.id} created from template "${template.name}"` +
          UI.Style.TEXT_NORMAL +
          ` (agent: ${template.agent ?? "default"}, model: ${template.model ?? "default"}, steps: ${template.steps?.length ?? 0})`,
      )
      return
    }

    const session = yield* Session.Service
    const created = yield* session.create({})
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Session ${created.id} created` + UI.Style.TEXT_NORMAL)
  }),
})

export const SessionForkCommand = effectCmd({
  command: "fork <sessionID>",
  describe: "fork a session at a message: copies messages from the fork point onward into a new child session",
  builder: (yargs) =>
    yargs
      .positional("sessionID", {
        describe: "session ID to fork",
        type: "string",
        demandOption: true,
      })
      .option("at-message", {
        alias: "m",
        describe: "message ID to fork at (inclusive; messages from this point onward are copied)",
        type: "string",
        demandOption: true,
      })
      .option("name", {
        describe: "title for the new session",
        type: "string",
      }),
  handler: Effect.fn("Cli.session.fork")(function* (args) {
    const sessionID = SessionID.make(args.sessionID)
    let atMessage: MessageID
    try {
      atMessage = MessageID.make(args.atMessage)
    } catch {
      return yield* fail(`Message not found: ${args.atMessage} (must start with "msg")`)
    }
    const result = yield* ForkMerge.fork({
      sessionID,
      atMessage,
      ...(args.name ? { name: args.name } : {}),
    }).pipe(Effect.catchTag("ForkMergeError", (error) => fail(error.message)))
    UI.println(
      UI.Style.TEXT_SUCCESS_BOLD +
        `Session ${result.id} forked from ${args.sessionID} at ${args.atMessage}` +
        UI.Style.TEXT_NORMAL +
        ` (${result.copied} messages copied, parent: ${args.sessionID})`,
    )
  }),
})

export const SessionMergeCommand = effectCmd({
  command: "merge <sourceSessionID>",
  describe: "merge a source session into a target session (last-write-wins, conflict markers on overlap)",
  builder: (yargs) =>
    yargs
      .positional("sourceSessionID", {
        describe: "session ID to merge from",
        type: "string",
        demandOption: true,
      })
      .option("into", {
        alias: "t",
        describe: "session ID to merge into",
        type: "string",
        demandOption: true,
      })
      .option("strategy", {
        describe: "merge strategy (3way is an alias for lww)",
        type: "string",
        choices: ["lww", "3way"],
        default: "lww",
      }),
  handler: Effect.fn("Cli.session.merge")(function* (args) {
    const result = yield* ForkMerge.merge({
      sourceSessionID: SessionID.make(args.sourceSessionID),
      targetSessionID: SessionID.make(args.into),
      strategy: args.strategy,
    }).pipe(Effect.catchTag("ForkMergeError", (error) => fail(error.message)))
    UI.println(
      UI.Style.TEXT_SUCCESS_BOLD +
        `Merged ${args.sourceSessionID} into ${args.into}` +
        UI.Style.TEXT_NORMAL +
        ` (${result.appended} appended, ${result.conflicts} conflicts, ${result.identical} identical)`,
    )
  }),
})

export const SessionDeleteCommand = effectCmd({
  command: "delete <sessionID>",
  describe: "delete a session",
  builder: (yargs) =>
    yargs.positional("sessionID", {
      describe: "session ID to delete",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.session.delete")(function* (args) {
    const svc = yield* Session.Service
    const sessionID = SessionID.make(args.sessionID)
    yield* svc
      .remove(sessionID)
      // eslint-disable-next-line @typescript-eslint/unbound-method
      .pipe(Effect.catchIf(NotFoundError.isInstance, () => fail(`Session not found: ${args.sessionID}`)))
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Session ${args.sessionID} deleted` + UI.Style.TEXT_NORMAL)
  }),
})

export const SessionListCommand = effectCmd({
  command: "list",
  describe: "list sessions",
  builder: (yargs) =>
    yargs
      .option("max-count", {
        alias: "n",
        describe: "limit to N most recent sessions",
        type: "number",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      }),
  handler: Effect.fn("Cli.session.list")(function* (args) {
    const sessions = yield* Session.Service.use((svc) => svc.list({ roots: true, limit: args.maxCount }))

    if (sessions.length === 0) return

    const output = args.format === "json" ? formatSessionJSON(sessions) : formatSessionTable(sessions)

    const shouldPaginate = process.stdout.isTTY && !args.maxCount && args.format === "table"

    if (shouldPaginate) {
      yield* Effect.promise(async () => {
        const proc = Process.spawn(pagerCmd(), {
          stdin: "pipe",
          stdout: "inherit",
          stderr: "inherit",
        })

        if (!proc.stdin) {
          console.log(output)
          return
        }

        proc.stdin.write(output)
        proc.stdin.end()
        await proc.exited
      })
    } else {
      console.log(output)
    }
  }),
})

function formatSessionTable(sessions: Session.Info[]): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(20, ...sessions.map((s) => s.id.length))
  const maxTitleWidth = Math.max(25, ...sessions.map((s) => s.title.length))

  const header = `Session ID${" ".repeat(maxIdWidth - 10)}  Title${" ".repeat(maxTitleWidth - 5)}  Updated`
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const session of sessions) {
    const truncatedTitle = Locale.truncate(session.title, maxTitleWidth)
    const timeStr = Locale.todayTimeOrDateTime(session.time.updated)
    const line = `${session.id.padEnd(maxIdWidth)}  ${truncatedTitle.padEnd(maxTitleWidth)}  ${timeStr}`
    lines.push(line)
  }

  return lines.join(EOL)
}

function formatSessionJSON(sessions: Session.Info[]): string {
  const jsonData = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    updated: session.time.updated,
    created: session.time.created,
    projectId: session.projectID,
    directory: session.directory,
  }))
  return JSON.stringify(jsonData, null, 2)
}
