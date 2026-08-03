export * as SkillWriteTool from "./skill-write"

import matter from "gray-matter"
import path from "node:path"
import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { ConfigMarkdown } from "../config/markdown"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { SkillV2 } from "../skill"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "skill_write"

export const CONTENT_LIMIT_BYTES = 100 * 1024
export const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/

/** Same shape as the segment guard used by SkillDiscovery for remote skill names. */
const isSafeSegment = (value: string) =>
  value.length > 0 &&
  value !== "." &&
  value !== ".." &&
  !value.includes("/") &&
  !value.includes("\\") &&
  !value.includes("\0")

export const validName = (value: string) => NAME_PATTERN.test(value) && isSafeSegment(value)
export const Input = Schema.Struct({
  operation: Schema.optional(Schema.Literals(["write", "list"])).annotate({
    description: "Operation to perform. 'write' creates or updates a skill, 'list' returns existing skills (default write).",
  }),
  name: Schema.optional(Schema.String).annotate({
    description:
      "Skill name. Used as the directory name under the project skills directory. Must be 1-64 letters, digits, or hyphens, starting with a letter or digit.",
  }),
  description: Schema.optional(Schema.String).annotate({
    description: "Short description of what the skill does. Written into the skill frontmatter.",
  }),
  content: Schema.optional(Schema.String).annotate({
    description: "SKILL.md body (markdown with optional YAML frontmatter). Must be under 100KB.",
  }),
  overwrite: Schema.optional(Schema.Boolean).annotate({
    description: "Overwrite an existing skill with the same name (default true). Set false to reject updates.",
  }),
})

export const Output = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("write"),
    name: Schema.String,
    directory: Schema.String,
    path: Schema.String,
    action: Schema.Literals(["created", "updated", "unchanged"]),
  }),
  Schema.Struct({
    operation: Schema.Literal("list"),
    directory: Schema.String,
    skills: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        description: Schema.String.pipe(Schema.optional),
        path: Schema.String,
      }),
    ),
  }),
])
export type Output = typeof Output.Type
type ModelOutput = typeof Output.Encoded
const Frontmatter = Schema.Struct({
  name: Schema.String.pipe(Schema.optional),
  description: Schema.String.pipe(Schema.optional),
})
const decodeFrontmatter = Schema.decodeUnknownOption(Frontmatter)
const unableTo = (message: string) => new ToolFailure({ message })
export const skillRelativePath = (name: string) => path.join(".openaxe", "skills", name, "SKILL.md")

const render = (output: ModelOutput) => {
  if (output.operation === "list") {
    if (output.skills.length === 0) return "No skills in the project skills directory."
    return output.skills.map((skill) => `${skill.name}${skill.description ? `: ${skill.description}` : ""}`).join("\n")
  }
  return [`Skill ${output.action}: ${output.name}`, `Path: ${output.path}`, `Directory: ${output.directory}`].join("\n")
}

/**
 * Ensure a written skill declares a frontmatter `name` so the project-local
 * directory source (SkillV2) can load it: nested SKILL.md files are only
 * discoverable when their frontmatter carries a name. Content that already
 * declares a frontmatter name is written verbatim.
 */
const withSkillFrontmatter = (content: string, name: string, description: string | undefined) => {
  const parsed = ConfigMarkdown.parseOption(content)
  const data = parsed?.data
  if (data && typeof data === "object" && typeof (data as { name?: unknown }).name === "string") return content
  const merged: Record<string, string> = { name }
  if (description !== undefined) merged.description = description
  const combined =
    data && typeof data === "object" && Object.keys(data).length > 0 ? { ...data, ...merged } : merged
  return matter.stringify(parsed?.content ?? content, combined)
}

export type ListedSkill = { name: string; description: string | undefined; path: string }
export const listSkills = Effect.fn("SkillWriteTool.list")(function* (fs: FSUtil.Interface, skillsDir: string) {
  const entries = yield* fs
    .glob("**/SKILL.md", { cwd: skillsDir, absolute: true, include: "file", dot: true })
    .pipe(Effect.catch(() => Effect.succeed([] as string[])))
  return yield* Effect.forEach(
    entries,
    (filepath) =>
      Effect.gen(function* () {
        const content = yield* fs.readFileStringSafe(filepath)
        if (content === undefined) return undefined
        const markdown = ConfigMarkdown.parseOption(content)
        const frontmatter = markdown ? decodeFrontmatter(markdown.data).valueOrUndefined : undefined
        const skillName = frontmatter?.name ?? path.basename(path.dirname(filepath))
        if (!validName(skillName)) return undefined
        return {
          name: skillName,
          description: frontmatter?.description,
          path: filepath,
        }
      }),
  ).pipe(Effect.map((items) => items.filter((item): item is ListedSkill => item !== undefined)))
})

export type WriteResult = {
  operation: "write"
  name: string
  directory: string
  path: string
  action: "created" | "updated" | "unchanged"
}
export const writeSkill = Effect.fn("SkillWriteTool.write")(function* (
  fs: FSUtil.Interface,
  skillsDir: string,
  input: { name: string; description?: string; content: string; overwrite?: boolean },
) {
  const target = path.join(skillsDir, input.name, "SKILL.md")
  if (!FSUtil.contains(skillsDir, target)) return yield* unableTo("Skill name resolves outside the skills directory.")
  const existing = yield* fs.exists(target)
  if (existing && input.overwrite === false)
    return yield* unableTo(`Skill '${input.name}' already exists and overwrite is false.`)
  const normalized = withSkillFrontmatter(input.content, input.name, input.description)
  if (existing) {
    const current = yield* fs.readFileStringSafe(target)
    if (current === normalized) {
      const result: WriteResult = { operation: "write", name: input.name, directory: skillsDir, path: target, action: "unchanged" }
      return result
    }
  }
  yield* fs.writeWithDirs(target, normalized)
  const result: WriteResult = {
    operation: "write",
    name: input.name,
    directory: skillsDir,
    path: target,
    action: existing ? "updated" : "created",
  }
  return result
})

export const description = [
  "Create, update, or list project-local skills. Skills are stored as SKILL.md files in the project .openaxe/skills directory and are automatically available to the skill loader.",
  "",
  "Use 'write' to create a new skill or update an existing one, and 'list' to see what already exists in the project.",
].join("\n")

const errorMessage = (error: unknown) =>
  typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
    ? error.message
    : String(error)

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const permission = yield* PermissionV2.Service
    const skills = yield* SkillV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: render(output) }],
          execute: (input, context) =>
            Effect.gen(function* () {
              const operation = input.operation ?? "write"
              const skillsDir = path.join(location.project.directory, ".openaxe", "skills")
              const skillName = input.name ?? ""
              const content = input.content ?? ""

              if (operation === "write") {
                if (!validName(skillName)) {
                  return yield* unableTo(
                    `Invalid skill name '${skillName}'. Use 1-64 letters, digits, or hyphens starting with a letter or digit.`,
                  )
                }
                if (content.length === 0) return yield* unableTo("Skill content must not be empty.")
                if (new TextEncoder().encode(content).length > CONTENT_LIMIT_BYTES)
                  return yield* unableTo(`Skill content exceeds the ${CONTENT_LIMIT_BYTES / 1024}KB limit.`)
              }

              yield* permission.assert({
                action: name,
                resources: operation === "write" ? [skillRelativePath(skillName)] : [],
                save: operation === "write" ? [skillName] : [],
                metadata: { operation, directory: skillsDir },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })

              if (operation === "list") {
                return { operation: "list" as const, directory: skillsDir, skills: yield* listSkills(fs, skillsDir) }
              }

              const result = yield* writeSkill(fs, skillsDir, {
                name: skillName,
                description: input.description,
                content,
                overwrite: input.overwrite,
              })
              // Drop the SkillV2 per-source discovery cache so a freshly
              // written skill is visible to loaders without a reload.
              if (result.action !== "unchanged") yield* skills.invalidate()
              return result
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({ message: `Unable to ${operationLabel(input.operation)} skill: ${errorMessage(error)}` }),
              ),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

const operationLabel = (operation: string | undefined) => (operation === "list" ? "list" : "write")
