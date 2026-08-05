import type { Argv } from "yargs"
import { Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd } from "../effect-cmd"
import { Reflection } from "@opencode-ai/core/reflection/reflection"
import { ProjectV2 } from "@opencode-ai/core/project"
import { InstanceState } from "@/effect/instance-state"
import { Project } from "@/project/project"
import { UI } from "../ui"

export const ReflectionCommand = cmd({
  command: "reflection",
  describe: "reflect on tool-error patterns and tune retry policies",
  builder: (yargs: Argv) => yargs.command(ReflectionRunCommand).demandCommand(),
  async handler() {},
})

export const ReflectionRunCommand = effectCmd({
  command: "run",
  describe: "scan tool-error history and update retry_policy_overrides",
  builder: (yargs) =>
    yargs.option("project", {
      describe: "project ID to scan (default: current project)",
      type: "string",
    }),
  handler: Effect.fn("Cli.reflection.run")(function* (args) {
    const ctx = yield* InstanceState.context
    const projectId = yield* resolveProjectId(ctx.directory, args.project)
    yield* Reflection.run(projectId)
    UI.println(
      UI.Style.TEXT_SUCCESS_BOLD + `Reflection complete for project ${projectId}` + UI.Style.TEXT_NORMAL +
        " — retry_policy_overrides updated from tool-error history",
    )
  }),
})

const resolveProjectId = (directory: string, explicit: string | undefined): Effect.Effect<ProjectV2.ID, never, Project.Service> =>
  explicit !== undefined
    ? Effect.succeed(ProjectV2.ID.make(explicit))
    : Effect.gen(function* () {
        const project = yield* Project.Service
        const info = yield* project.fromDirectory(directory)
        return info.project.id
      })
