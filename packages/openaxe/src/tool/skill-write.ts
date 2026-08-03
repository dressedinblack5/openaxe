import { Effect, Schema } from "effect"
import { join } from "path"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { SkillWriteTool } from "@opencode-ai/core/tool/skill-write"
import { InstanceState } from "@/effect/instance-state"
import type { Context, ExecuteResult } from "./tool"
import { define } from "./tool"

export const Parameters = Schema.Struct({
  operation: Schema.optional(Schema.Literals(["write", "list"])).annotate({
    description: "Whether to write a new skill or list existing skills (default: write)",
  }),
  name: Schema.optional(Schema.String).annotate({ description: "Skill name (directory-safe, max 64 chars)" }),
  description: Schema.optional(Schema.String).annotate({ description: "Short description of the skill" }),
  content: Schema.optional(Schema.String).annotate({ description: "Markdown content of the SKILL.md file" }),
  overwrite: Schema.optional(Schema.Boolean).annotate({
    description: "Overwrite an existing skill (default: false, fails if the skill already exists)",
  }),
})

export const SkillWriteV1Tool = define<typeof Parameters, { operation: string }, FSUtil.Service>(
  "skill_write",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    const execute = (params: Schema.Schema.Type<typeof Parameters>, ctx: Context<{ operation: string }>) =>
      Effect.gen(function* () {
        const instance = yield* InstanceState.context
        const skillsDir = join(instance.directory, ".openaxe", "skills")
        const operation = params.operation ?? "write"
        yield* ctx.ask({
          permission: "skill_write",
          patterns: [operation === "write" ? SkillWriteTool.skillRelativePath(params.name ?? "") : "list"],
          always: ["*"],
          metadata: { operation, directory: skillsDir },
        })

        if (operation === "list") {
          const skills = yield* SkillWriteTool.listSkills(fs, skillsDir)
          if (skills.length === 0) {
            return {
              title: "No skills",
              output: "No skills in the project skills directory.",
              metadata: { operation },
            }
          }
          const output = skills
            .map((skill) => `${skill.name}${skill.description ? `: ${skill.description}` : ""}`)
            .join("\n")
          return { title: `${skills.length} skill${skills.length === 1 ? "" : "s"}`, output, metadata: { operation } }
        }

        if (!params.name || !SkillWriteTool.validName(params.name)) {
          return yield* Effect.fail(
            new Error(
              `skill_write requires a valid name matching ${String(SkillWriteTool.NAME_PATTERN)} (directory-safe, max 64 characters)`,
            ),
          )
        }
        if (!params.content) {
          return yield* Effect.fail(new Error("skill_write requires a non-empty content string"))
        }
        const bytes = new TextEncoder().encode(params.content).length
        if (bytes > SkillWriteTool.CONTENT_LIMIT_BYTES) {
          return yield* Effect.fail(
            new Error(`Skill content exceeds the ${SkillWriteTool.CONTENT_LIMIT_BYTES}-byte limit (${bytes} bytes)`),
          )
        }

        const result = yield* SkillWriteTool.writeSkill(fs, skillsDir, {
          name: params.name,
          description: params.description,
          content: params.content,
          overwrite: params.overwrite,
        })
        const output = [
          `Skill ${result.action}: ${result.name}`,
          `Path: ${result.path}`,
          `Directory: ${result.directory}`,
        ].join("\n")
        return {
          title: `Skill ${result.action}: ${result.name}`,
          output,
          metadata: { operation },
        }
      }) as Effect.Effect<ExecuteResult<{ operation: string }>>
    return {
      description:
        "Create or list project-local skills in the .openaxe/skills directory. Write operations take a name, description, and markdown content and produce a SKILL.md file the assistant can load later. List operations enumerate existing skills with their descriptions.",
      parameters: Parameters,
      execute,
    }
  }),
)
