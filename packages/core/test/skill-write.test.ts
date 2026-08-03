import fs from "node:fs/promises"
import path from "node:path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SkillV2 } from "@opencode-ai/core/skill"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { SkillWriteTool } from "@opencode-ai/core/tool/skill-write"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { executeTool, settleTool, toolDefinitions, toolIdentity } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_skill_write_test")
const assertions: PermissionV2.AssertInput[] = []

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) => Effect.sync(() => assertions.push(input)),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const reset = () => {
  assertions.length = 0
}

const skillV2 = Layer.succeed(
  SkillV2.Service,
  SkillV2.Service.of({
    transform: () => Effect.die("unused"),
    reload: () => Effect.die("unused"),
    sources: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
    invalidate: () => Effect.void,
  }),
)

const withTool = <A, E, R>(directory: string, body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>) => {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  const registry = ToolRegistry.defaultLayer.pipe(Layer.provide(permission))
  const skillWrite = SkillWriteTool.layer.pipe(
    Layer.provide(registry),
    Layer.provide(permission),
    Layer.provide(activeLocation),
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(skillV2),
  )
  return Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(Effect.provide(Layer.mergeAll(registry, skillWrite)))
}

const call = (input: typeof SkillWriteTool.Input.Type = {}, id = "call-skill-write") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "skill_write", input },
})

const skillsFile = (directory: string, name: string) =>
  path.join(directory, ".openaxe", "skills", name, "SKILL.md")

const it = testEffect(Layer.empty)

describe("SkillWriteTool", () => {
  it.effect("registers skill_write as a canonical tool", () =>
    withTool("/tmp/skill-write-unused", (registry) =>
      Effect.gen(function* () {
        expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual(["skill_write"])
        expect(yield* toolDefinitions(registry, [{ action: "skill_write", resource: "*", effect: "deny" }])).toEqual([])
      }),
    ),
  )

  it.live("creates a skill by writing SKILL.md and returns created", () =>
    Effect.acquireUseRelease(
      Effect.promise(async () => tmpdir()),
      (tmp) => {
        reset()
        const target = skillsFile(tmp.path, "my-skill")
        return withTool(tmp.path, (registry) =>
          Effect.gen(function* () {
            const settled = yield* settleTool(
              registry,
              call({ operation: "write", name: "my-skill", description: "A demo skill", content: "# My Skill\n\nBody" }),
            )
            expect(settled.output?.structured).toMatchObject({ operation: "write", name: "my-skill", action: "created" })
            expect(settled.output?.structured as { path: string; directory: string }).toMatchObject({
              path: target,
              directory: path.join(tmp.path, ".openaxe", "skills"),
            })
            expect(settled.result).toEqual({
              type: "text",
              value: `Skill created: my-skill\nPath: ${target}\nDirectory: ${path.join(tmp.path, ".openaxe", "skills")}`,
            })
            expect(yield* Effect.promise(async () => fs.readFile(target, "utf8"))).toContain("# My Skill")
            const written = yield* Effect.promise(async () => fs.readFile(target, "utf8"))
            expect(written).toContain("name: my-skill")
            expect(written).toContain("description: A demo skill")
            expect(assertions).toMatchObject([
              {
                sessionID,
                action: "skill_write",
                resources: [path.join(".openaxe", "skills", "my-skill", "SKILL.md")],
                save: ["my-skill"],
              },
            ])
          }),
        )
      },
      (tmp) => Effect.promise(async () => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("updates an existing skill and returns updated", () =>
    Effect.acquireUseRelease(
      Effect.promise(async () => tmpdir()),
      (tmp) => {
        reset()
        const target = skillsFile(tmp.path, "my-skill")
        return Effect.promise(async () => fs.mkdir(path.dirname(target), { recursive: true })).pipe(
          Effect.andThen(() => Effect.promise(async () => fs.writeFile(target, "old content"))),
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                const settled = yield* settleTool(
                  registry,
                  call({ operation: "write", name: "my-skill", content: "new content" }),
                )
                expect(settled.output?.structured).toMatchObject({ operation: "write", name: "my-skill", action: "updated" })
                const written = yield* Effect.promise(async () => fs.readFile(target, "utf8"))
                expect(written).toContain("name: my-skill")
                expect(written).toContain("new content")
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(async () => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("returns unchanged when the content is identical", () =>
    Effect.acquireUseRelease(
      Effect.promise(async () => tmpdir()),
      (tmp) => {
        reset()
        const input = { operation: "write" as const, name: "my-skill", content: "# My Skill\n\nBody" }
        return withTool(tmp.path, (registry) =>
          Effect.gen(function* () {
            const first = yield* settleTool(registry, call(input))
            expect(first.output?.structured).toMatchObject({ action: "created" })
            const second = yield* settleTool(registry, call(input))
            expect(second.output?.structured).toMatchObject({ operation: "write", name: "my-skill", action: "unchanged" })
          }),
        )
      },
      (tmp) => Effect.promise(async () => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("rejects invalid skill names without writing", () =>
    Effect.acquireUseRelease(
      Effect.promise(async () => tmpdir()),
      (tmp) => {
        reset()
        return withTool(tmp.path, (registry) =>
          Effect.gen(function* () {
            const badNames = ["../evil", "bad/name", ".", "..", "has space", "-lead", "x".repeat(65)]
            for (const bad of badNames) {
              const result = yield* executeTool(
                registry,
                call({ operation: "write", name: bad, content: "body" }),
              )
              expect(result).toEqual({
                type: "error",
                value: `Invalid skill name '${bad}'. Use 1-64 letters, digits, or hyphens starting with a letter or digit.`,
              })
            }
            expect(yield* Effect.promise(async () => fs.readdir(tmp.path))).toEqual([])
          }),
        )
      },
      (tmp) => Effect.promise(async () => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("rejects overwrite=false when the skill already exists", () =>
    Effect.acquireUseRelease(
      Effect.promise(async () => tmpdir()),
      (tmp) => {
        reset()
        const target = skillsFile(tmp.path, "my-skill")
        return Effect.promise(async () => fs.mkdir(path.dirname(target), { recursive: true })).pipe(
          Effect.andThen(() => Effect.promise(async () => fs.writeFile(target, "existing"))),
          Effect.andThen(
            withTool(tmp.path, (registry) =>
              Effect.gen(function* () {
                const result = yield* executeTool(
                  registry,
                  call({ operation: "write", name: "my-skill", content: "replacement", overwrite: false }),
                )
                expect(result).toEqual({
                  type: "error",
                  value: "Skill 'my-skill' already exists and overwrite is false.",
                })
                expect(yield* Effect.promise(async () => fs.readFile(target, "utf8"))).toBe("existing")
              }),
            ),
          ),
        )
      },
      (tmp) => Effect.promise(async () => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("rejects content over the size cap", () =>
    Effect.acquireUseRelease(
      Effect.promise(async () => tmpdir()),
      (tmp) => {
        reset()
        return withTool(tmp.path, (registry) =>
          Effect.gen(function* () {
            const result = yield* executeTool(
              registry,
              call({ operation: "write", name: "big", content: "x".repeat(100 * 1024 + 1) }),
            )
            expect(result).toEqual({ type: "error", value: "Skill content exceeds the 100KB limit." })
            expect(assertions).toEqual([])
          }),
        )
      },
      (tmp) => Effect.promise(async () => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("lists existing skills in the project skills directory", () =>
    Effect.acquireUseRelease(
      Effect.promise(async () => tmpdir()),
      (tmp) => {
        reset()
        return withTool(tmp.path, (registry) =>
          Effect.gen(function* () {
            yield* executeTool(registry, call({ operation: "write", name: "alpha", description: "first", content: "# Alpha" }))
            yield* executeTool(registry, call({ operation: "write", name: "beta", content: "# Beta" }))
            const settled = yield* settleTool(registry, call({ operation: "list" }))
            expect(settled.output?.structured).toMatchObject({
              operation: "list",
              directory: path.join(tmp.path, ".openaxe", "skills"),
            })
            const structured = settled.output?.structured as
              | { skills: { name: string; description?: string; path: string }[] }
              | undefined
            expect(structured?.skills.map((skill) => skill.name).sort()).toEqual(["alpha", "beta"])
            expect(structured?.skills.find((skill) => skill.name === "alpha")?.description).toBe("first")
            expect(structured?.skills.every((skill) => skill.path.endsWith("/SKILL.md"))).toBe(true)
          }),
        )
      },
      (tmp) => Effect.promise(async () => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("always writes to the project-local skills directory (no override)", () =>
    Effect.acquireUseRelease(
      Effect.promise(async () => tmpdir()),
      (tmp) => {
        reset()
        return withTool(tmp.path, (registry) =>
          Effect.gen(function* () {
            const settled = yield* settleTool(
              registry,
              call({ operation: "write", name: "my-skill", content: "body" }),
            )
            expect(settled.output?.structured).toMatchObject({ action: "created" })
            const target = path.join(tmp.path, ".openaxe", "skills", "my-skill", "SKILL.md")
            const structured = settled.output?.structured as { path: string; directory: string } | undefined
            expect(structured?.path).toBe(target)
            expect(yield* Effect.promise(async () => fs.readFile(target, "utf8"))).toContain("name: my-skill")
            expect(structured?.directory).toBe(
              path.join(tmp.path, ".openaxe", "skills"),
            )
          }),
        )
      },
      (tmp) => Effect.promise(async () => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("ignores an unknown directory input field and writes to the project-local skills directory", () =>
    Effect.acquireUseRelease(
      Effect.promise(async () => tmpdir()),
      (tmp) => {
        reset()
        return withTool(tmp.path, (registry) =>
          Effect.gen(function* () {
            const override = path.join(tmp.path, "custom", "skills")
            const settled = yield* settleTool(
              registry,
              call({
                operation: "write",
                name: "my-skill",
                content: "body",
                directory: override,
              } as never),
            )
            expect(settled.result.type).toBe("text")
            const target = path.join(tmp.path, ".openaxe", "skills", "my-skill", "SKILL.md")
            expect(yield* Effect.promise(async () => fs.readFile(target, "utf8"))).toContain("name: my-skill")
            const overrideTarget = path.join(override, "my-skill", "SKILL.md")
            expect(yield* Effect.promise(async () => fs.access(overrideTarget).then(() => true, () => false))).toBe(
              false,
            )
          }),
        )
      },
      (tmp) => Effect.promise(async () => tmp[Symbol.asyncDispose]()),
    ),
  )
})
