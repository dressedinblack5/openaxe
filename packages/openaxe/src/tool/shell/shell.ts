import path from "path"
import { Duration, Effect, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { InstanceState } from "@/effect/instance-state"
import { AppProcess } from "@opencode-ai/core/process"
import type { Context } from "../tool"
import { define } from "../tool"
import DESCRIPTION from "./shell.txt"

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000
const MAX_CAPTURE_BYTES = 1024 * 1024

export const Parameters = Schema.Struct({
  command: Schema.String.annotate({ description: "Shell command string to execute" }),
  workdir: Schema.optional(Schema.String).annotate({
    description: "Working directory. Defaults to the active project directory; relative paths resolve from there.",
  }),
  timeout: Schema.optional(Schema.Number).annotate({
    description: `Timeout in milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS} and may not exceed ${MAX_TIMEOUT_MS}.`,
  }),
})

export const ShellTool = define(
  "bash",
  Effect.gen(function* () {
    const appProcess = yield* AppProcess.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { command: string; workdir?: string; timeout?: number }, ctx: Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const cwd = params.workdir
            ? path.isAbsolute(params.workdir)
              ? params.workdir
              : path.join(ins.directory, params.workdir)
            : ins.directory

          yield* ctx.ask({
            permission: "bash",
            patterns: [params.command],
            always: ["*"],
            metadata: { command: params.command, cwd },
          })

          const command = ChildProcess.make(params.command, [], {
            cwd,
            shell: process.platform === "win32" ? (process.env.COMSPEC ?? "cmd.exe") : "/bin/sh",
            stdin: "ignore",
            detached: process.platform !== "win32",
            forceKillAfter: Duration.seconds(3),
          })

          const timeout = params.timeout ?? DEFAULT_TIMEOUT_MS
          const result = yield* appProcess
            .run(command, {
              timeout: Duration.millis(timeout),
              maxOutputBytes: MAX_CAPTURE_BYTES,
              maxErrorBytes: MAX_CAPTURE_BYTES,
            })
            .pipe(
              Effect.catchTag("AppProcessError", (error) =>
                error.cause instanceof Error && error.cause.message === "Timed out" ? Effect.void : Effect.fail(error),
              ),
            )

          if (!result) {
            return {
              title: params.command,
              metadata: { timedOut: true, exitCode: -1, truncated: false },
              output: `Command exceeded timeout of ${timeout} ms. Retry with a larger timeout if the command is expected to take longer.`,
            }
          }

          const stdout = result.stdout.toString("utf8")
          const stderr = result.stderr.toString("utf8")
          const compact =
            stdout && stderr
              ? `${stdout}\n\nstderr:\n${stderr}`
              : stderr
                ? `stderr:\n${stderr}`
                : stdout || "(no output)"
          const truncationNotice =
            result.stdoutTruncated && result.stderrTruncated
              ? "\n\n[stdout and stderr capture truncated at the in-memory safety limit]"
              : result.stdoutTruncated
                ? "\n\n[stdout capture truncated at the in-memory safety limit]"
                : result.stderrTruncated
                  ? "\n\n[stderr capture truncated at the in-memory safety limit]"
                  : ""

          return {
            title: params.command,
            metadata: {
              timedOut: false,
              exitCode: result.exitCode,
              truncated: result.stdoutTruncated || result.stderrTruncated,
            },
            output: `${compact}${truncationNotice}\n\nCommand exited with code ${result.exitCode}.`,
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export * as Shell from "./shell"
