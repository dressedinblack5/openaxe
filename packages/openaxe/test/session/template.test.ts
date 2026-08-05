import { describe, expect } from "bun:test"
import * as YAML from "yaml"
import { ConfigTemplate } from "@opencode-ai/core/config/template"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionInputTable } from "@opencode-ai/core/session/sql"
import { Database } from "@opencode-ai/core/database/database"
import { eq } from "drizzle-orm"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Cause, Effect, Layer, Schema } from "effect"
import { Session as SessionNs } from "@/session/session"
import { Template } from "../../src/session/template"
import { testInstanceStoreLayer, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Storage } from "@/storage/storage"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"

const it = testEffect(
  Layer.mergeAll(
    SessionNs.layer.pipe(
      Layer.provide(Storage.defaultLayer),
      Layer.provide(Database.defaultLayer),
      Layer.provideMerge(EventV2Bridge.defaultLayer),
      Layer.provide(SessionProjector.defaultLayer),
      Layer.provide(RuntimeFlags.layer({ experimentalWorkspaces: false })),
      Layer.provide(BackgroundJob.defaultLayer),
    ),
    SessionV2.defaultLayer,
    Database.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    testInstanceStoreLayer,
  ),
)

const validTemplate = {
  name: "refactor-sprint",
  description: "Kick off a refactor sprint",
  model: "anthropic/claude-sonnet-4",
  agent: "build",
  systemPrompt: "You are a refactoring specialist.",
  permissions: { bash: "allow" as const, edit: { "src/**": "deny" as const } },
  tools: ["bash", "edit"],
  steps: [
    { name: "scan", prompt: "Scan the codebase for tech debt." },
    { name: "plan", prompt: "Write a refactor plan.", model: "anthropic/claude-sonnet-4" },
  ],
}

describe("SessionTemplate schema", () => {
  it.effect("decodes a valid template", () =>
    Effect.gen(function* () {
      const decoded = Schema.decodeUnknownSync(ConfigTemplate.SessionTemplate)(validTemplate)
      expect(decoded.name).toBe("refactor-sprint")
      expect(decoded.model).toBe("anthropic/claude-sonnet-4")
      expect(decoded.agent).toBe("build")
      expect(decoded.steps).toHaveLength(2)
      expect(decoded.steps?.[1].model).toBe("anthropic/claude-sonnet-4")
      expect(decoded.permissions).toEqual({ bash: "allow", edit: { "src/**": "deny" } })
    }),
  )

  it.effect("rejects a template missing required name", () =>
    Effect.sync(() => {
      expect(() => Schema.decodeUnknownSync(ConfigTemplate.SessionTemplate)({ model: "x/y" })).toThrow()
    }),
  )

  it.effect("rejects an invalid permission action", () =>
    Effect.sync(() => {
      expect(() =>
        Schema.decodeUnknownSync(ConfigTemplate.SessionTemplate)({ name: "bad", permissions: { bash: "grant" } }),
      ).toThrow()
    }),
  )
})

describe("template YAML round-trip", () => {
  it.effect("parses YAML and decodes to the schema", () =>
    Effect.gen(function* () {
      const parsed = YAML.parse(YAML.stringify(validTemplate))
      const decoded = Schema.decodeUnknownSync(ConfigTemplate.SessionTemplate)(parsed)
      expect(decoded.name).toBe("refactor-sprint")
      expect(decoded.steps?.[0].prompt).toContain("tech debt")
    }),
  )
})

describe("loadTemplate", () => {
  it.instance("loads a template from .openaxe/templates/<name>.yaml", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(`${test.directory}/.openaxe/templates/my-template.yaml`, YAML.stringify(validTemplate)))
      const loaded = yield* Template.loadTemplate(test.directory, "my-template")
      expect(loaded.name).toBe("refactor-sprint")
      expect(loaded.steps).toHaveLength(2)
    }),
  )

  it.instance("fails with a typed error when the template is missing", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const exit = yield* Template.loadTemplate(test.directory, "nope").pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        expect(String(Cause.pretty(exit.cause))).toContain("Template not found: nope")
      }
    }),
  )

  it.instance("fails with a parse error on invalid YAML", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(`${test.directory}/.openaxe/templates/broken.yaml`, "name: [unclosed"))
      const exit = yield* Template.loadTemplate(test.directory, "broken").pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        expect(String(Cause.pretty(exit.cause))).toContain("Invalid YAML")
      }
    }),
  )
})

describe("createFromTemplate", () => {
  it.instance("creates a session with model/agent/permissions and admits steps", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const template = Schema.decodeUnknownSync(ConfigTemplate.SessionTemplate)(validTemplate)
      const info = yield* Template.createFromTemplate({ template, directory: test.directory })

      expect(info.title).toBe("refactor-sprint")
      expect(info.agent).toBe("build")
      expect(info.model && String(info.model.id)).toBe("claude-sonnet-4")
      expect(info.model && String(info.model.providerID)).toBe("anthropic")
      expect(info.permission).toEqual([
        { permission: "bash", action: "allow", pattern: "*" },
        { permission: "edit", action: "deny", pattern: "src/**" },
      ])
      expect(info.metadata).toMatchObject({ template: "refactor-sprint", systemPrompt: "You are a refactoring specialist." })

      const session = yield* SessionNs.Service
      const stored = yield* session.get(info.id)
      expect(stored.metadata?.systemPrompt).toBe("You are a refactoring specialist.")

      // steps admitted as durable inputs on the session (visible in session_input until promoted)
      const db = (yield* Database.Service).db
      const inputs = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.session_id, info.id))
        .all()
      const texts = inputs.map((row) => row.prompt.text)
      expect(texts).toContain("Scan the codebase for tech debt.")
      expect(texts).toContain("Write a refactor plan.")

      yield* session.remove(info.id)
    }),
  )
})
