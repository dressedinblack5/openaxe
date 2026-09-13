import { describe, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { DateTime, Effect, Layer, Schema, Scope } from "effect"
import { Database } from "../database/database"
import { ModelV2 } from "../model"
import { ProjectV2 } from "../project"
import { ProjectTable } from "../project/sql"
import { ProviderV2 } from "../provider"
import { SessionMessage } from "../session/message"
import { SessionMessageTable, SessionTable } from "../session/sql"
import { SessionSchema } from "../session/schema"
import { AbsolutePath } from "../schema"
import { testEffect } from "../../test/lib/effect"
import { tmpdir } from "../../test/fixture/tmpdir"
import { SkillGenerator } from "./skill-generator"

const encode = Schema.encodeSync(SessionMessage.Message)
type MessageData = Omit<(typeof SessionMessage.Message)["Encoded"], "id" | "type">
const dataOf = (message: SessionMessage.Message): MessageData => {
  const { id: _id, type: _type, ...data } = encode(message)
  return data
}

const assistant = (id: string, content: SessionMessage.AssistantContent[]): SessionMessage.Message => ({
  id: SessionMessage.ID.make(id),
  type: "assistant",
  agent: "build",
  model: { id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make("provider") },
  content,
  time: { created: DateTime.makeUnsafe(1_000) },
})

/** Tool part with an object input so argument keys are mineable. */
const tool = (id: string, name: string, input: Record<string, unknown> = {}): SessionMessage.AssistantTool => ({
  type: "tool",
  id,
  name,
  state: { status: "completed", input, content: [], structured: {}, result: "ok" },
  time: { created: DateTime.makeUnsafe(1_000) },
})

const seed = (
  db: Database.Interface["db"],
  projectID: ProjectV2.ID,
  sessionID: SessionSchema.ID,
  directory: string,
  messages: SessionMessage.Message[],
  model: { id: string; providerID: string } = { id: "model", providerID: "provider" },
) =>
  Effect.gen(function* () {
    yield* db
      .insert(ProjectTable)
      .values({ id: projectID, worktree: AbsolutePath.make(directory), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: projectID,
        slug: "gen",
        directory: AbsolutePath.make(directory),
        title: "generator",
        version: "test",
        model,
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    for (const [i, message] of messages.entries()) {
      yield* db
        .insert(SessionMessageTable)
        .values({ id: message.id, session_id: sessionID, type: message.type, seq: i + 1, data: dataOf(message) })
        .run()
        .pipe(Effect.orDie)
    }
  })

// Fresh temp DB per test; the body gets the service, a direct db handle for
// seeding/asserting, and the temp dir path (session directory) for file asserts.
const withGenerator = <A, E>(
  body: (
    service: SkillGenerator.Interface,
    db: Database.Interface["db"],
    dir: string,
  ) => Effect.Effect<A, E, Scope.Scope>,
) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const dir = await tmpdir()
      return { file: path.join(dir.path, "generator.sqlite"), dir }
    }),
    ({ dir }) => Effect.promise(() => dir[Symbol.asyncDispose]()),
  ).pipe(
    Effect.flatMap(({ file, dir }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { db } = yield* Database.Service
          const service = yield* SkillGenerator.Service
          return yield* body(service, db, dir.path)
        }).pipe(Effect.provide(SkillGenerator.layer), Effect.provide(Database.layerFromPath(file))),
      ),
    ),
  )

const it = testEffect(Layer.empty)

const exists = (filepath: string) => fs.existsSync(filepath)
const readText = (filepath: string) => fs.readFileSync(filepath, "utf8")

describe("SkillGenerator", () => {
  it.effect("analyzeSession emits a draft for a repeated bash+edit sequence and writes files", () =>
    withGenerator((service, db, dir) =>
      Effect.gen(function* () {
        const projectID = ProjectV2.ID.make("proj_gen_happy")
        const sessionID = SessionSchema.ID.descending("ses_gen_happy")
        const sequence = [
          tool("p1", "bash", { command: "bun test" }),
          tool("p2", "edit", { filePath: "a.ts", content: "x" }),
          tool("p3", "read", { filePath: "a.ts" }),
        ]
        yield* seed(db, projectID, sessionID, dir, [
          assistant("msg_1", sequence),
          assistant("msg_2", [
            tool("p4", "bash", { command: "bun typecheck" }),
            tool("p5", "edit", { filePath: "b.ts", content: "y" }),
            tool("p6", "read", { filePath: "b.ts" }),
          ]),
          assistant("msg_3", [
            tool("p7", "bash", { command: "bun test" }),
            tool("p8", "edit", { filePath: "c.ts", content: "z" }),
            tool("p9", "read", { filePath: "c.ts" }),
          ]),
        ])

        const drafts = yield* service.analyzeSession(sessionID)

        const bashEdit = drafts.find((draft) => draft.name === "auto-bash-edit")
        expect(bashEdit).toBeDefined()
        expect(bashEdit?.tools).toEqual(["bash", "edit"])
        expect(bashEdit?.params.bash).toEqual(["command"])
        expect(bashEdit?.params.edit).toEqual(["content", "filePath"])

        const skillPath = path.join(dir, ".openaxe", "skills", "auto-bash-edit", "SKILL.md")
        expect(exists(skillPath)).toBe(true)
        const skillText = readText(skillPath)
        expect(skillText).toContain("name: auto-bash-edit")
        expect(skillText).toContain("## Workflow")
        expect(skillText).toContain("1. bash")

        const agentPath = path.join(dir, ".openaxe", "agents", "auto-bash-edit.json")
        expect(exists(agentPath)).toBe(true)
        const agent = JSON.parse(readText(agentPath))
        expect(agent.skills).toEqual(["auto-bash-edit"])
        expect(agent.model).toEqual({ id: "model", providerID: "provider" })
      }),
    ),
  )

  it.effect("generateFromHistory aggregates patterns across sessions", () =>
    withGenerator((service, db, dir) =>
      Effect.gen(function* () {
        const projectID = ProjectV2.ID.make("proj_gen_history")
        const sequence = [tool("p1", "bash"), tool("p2", "edit")]
        yield* seed(db, projectID, SessionSchema.ID.descending("ses_gen_1"), dir, [
          assistant("msg_1", sequence),
          assistant("msg_2", sequence),
          assistant("msg_3", sequence),
        ])
        yield* seed(db, projectID, SessionSchema.ID.descending("ses_gen_2"), dir, [
          assistant("msg_4", sequence),
          assistant("msg_5", sequence),
          assistant("msg_6", sequence),
        ])

        const drafts = yield* service.generateFromHistory(projectID)

        const bashEdit = drafts.find((draft) => draft.name === "auto-bash-edit")
        expect(bashEdit).toBeDefined()
        expect(bashEdit?.description).toContain("6 similar tool sequences")
      }),
    ),
  )

  it.effect("no repeated patterns returns empty and writes nothing", () =>
    withGenerator((service, db, dir) =>
      Effect.gen(function* () {
        const projectID = ProjectV2.ID.make("proj_gen_empty")
        const sessionID = SessionSchema.ID.descending("ses_gen_empty")
        yield* seed(db, projectID, sessionID, dir, [
          assistant("msg_1", [tool("p1", "bash"), tool("p2", "read")]),
          assistant("msg_2", [tool("p3", "grep")]),
        ])

        const drafts = yield* service.analyzeSession(sessionID)

        expect(drafts).toEqual([])
        expect(exists(path.join(dir, ".openaxe"))).toBe(false)
      }),
    ),
  )

  it.effect("invalid tool names are filtered from detection", () =>
    withGenerator((service, db, dir) =>
      Effect.gen(function* () {
        const projectID = ProjectV2.ID.make("proj_gen_invalid")
        const sessionID = SessionSchema.ID.descending("ses_gen_invalid")
        // "bad name" and "../x" are invalid skill-name segments; bash appears 3x.
        const dirty = [tool("p1", "bash", { command: "a" }), tool("p2", "bad name"), tool("p3", "../x")]
        yield* seed(db, projectID, sessionID, dir, [
          assistant("msg_1", dirty),
          assistant("msg_2", dirty),
          assistant("msg_3", dirty),
        ])

        const drafts = yield* service.analyzeSession(sessionID)

        const names = drafts.map((draft) => draft.name)
        expect(names).toContain("auto-bash")
        expect(names.some((name) => name.includes("bad") || name.includes(".."))).toBe(false)
      }),
    ),
  )
})
