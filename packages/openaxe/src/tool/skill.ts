import path from "path"
import { Effect, Schema } from "effect"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Skill } from "../skill"
import type { Context, ExecuteResult } from "./tool"
import { define } from "./tool"
import DESCRIPTION from "./skill.txt"

export const Parameters = Schema.Struct({
  name: Schema.String.annotate({ description: "The name of the skill from available_skills" }),
})

export const SkillTool = define(
  "skill",
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const ripgrep = yield* Ripgrep.Service

    const execute = (params: Schema.Schema.Type<typeof Parameters>, ctx: Context) =>
      Effect.gen(function* () {
        const info = yield* skill.require(params.name)

        yield* ctx.ask({
          permission: "skill",
          patterns: [params.name],
          always: [params.name],
          metadata: {},
        })

        const dir = path.dirname(info.location)
        const base = dir
        const files = yield* ripgrep.find({
          cwd: dir,
          pattern: "!**/SKILL.md",
          hidden: true,
          follow: false,
          signal: ctx.abort,
          limit: 10,
        })

        return {
          title: `Loaded skill: ${info.name}`,
          output: [
            `<skill_content name="${info.name}">`,
            `# Skill: ${info.name}`,
            "",
            info.content.trim(),
            "",
            `Base directory for this skill: ${base}`,
            "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
            "Note: file list is sampled.",
            "",
            "<skill_files>",
            files.map((file) => `<file>${path.resolve(dir, file.path)}</file>`).join("\n"),
            "</skill_files>",
            "</skill_content>",
          ].join("\n"),
          metadata: {
            name: info.name,
            dir,
          },
        }
      }) as Effect.Effect<ExecuteResult<{ name: string; dir: string }>>

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute,
    }
  }),
)
