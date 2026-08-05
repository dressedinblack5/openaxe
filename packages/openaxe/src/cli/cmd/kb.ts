import type { Argv } from "yargs"
import { Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd } from "../effect-cmd"
import { KB } from "@opencode-ai/core/kb/kb-builder"
import { ProjectV2 } from "@opencode-ai/core/project"
import { InstanceState } from "@/effect/instance-state"
import { Project } from "@/project/project"
import { UI } from "../ui"
import { kbDir } from "@opencode-ai/core/kb/kb-builder"

export const KbCommand = cmd({
  command: "kb",
  describe: "build and manage the project knowledge base",
  builder: (yargs: Argv) => yargs.command(KbBuildCommand).demandCommand(),
  async handler() {},
})

export const KbBuildCommand = effectCmd({
  command: "build",
  describe: "generate .openaxe/kb/{architecture,patterns,decisions,errors}.md from session history",
  builder: (yargs) =>
    yargs.option("project", {
      describe: "project ID to build from (default: current project)",
      type: "string",
    }),
  handler: Effect.fn("Cli.kb.build")(function* (args) {
    const ctx = yield* InstanceState.context
    const projectId = yield* resolveProjectId(ctx.directory, args.project)
    yield* KB.run(projectId)
    UI.println(
      UI.Style.TEXT_SUCCESS_BOLD + `KB built for project ${projectId}` + UI.Style.TEXT_NORMAL +
        ` — ${kbDir(ctx.directory)}`,
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
