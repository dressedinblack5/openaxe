import { describe, expect } from "bun:test"
import matter from "gray-matter"
import path from "node:path"
import { readdir } from "node:fs/promises"
import { DateTime, Effect, Layer, Schema, Scope } from "effect"
import { Database } from "../database/database"
import { Embedding } from "../embedding/embedding"
import { FSUtil } from "../fs-util"
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
import { KB } from "./kb-builder"

const encode = Schema.encodeSync(SessionMessage.Message)
type MessageData = Omit<(typeof SessionMessage.Message)["Encoded"], "id" | "type">
const dataOf = (message: SessionMessage.Message): MessageData => {
  const { id: _id, type: _type, ...data } = encode(message)
  return data
}

const user = (id: string, text: string, created: number): SessionMessage.Message => ({
  id: SessionMessage.ID.make(id),
  type: "user",
  text,
  time: { created: DateTime.makeUnsafe(created) },
})

const assistant = (
  id: string,
  content: SessionMessage.AssistantContent[],
  created: number,
): SessionMessage.Message => ({
  id: SessionMessage.ID.make(id),
  type: "assistant",
  agent: "build",
  model: { id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make("provider") },
  content,
  time: { created: DateTime.makeUnsafe(created) },
})

const okTool = (id: string, name: string): SessionMessage.AssistantTool => ({
  type: "tool",
  id,
  name,
  state: { status: "completed", input: {}, content: [], structured: {}, result: "ok" },
  time: { created: DateTime.makeUnsafe(1_000) },
})

const errorTool = (id: string, name: string, message: string): SessionMessage.AssistantTool => ({
  type: "tool",
  id,
  name,
  state: { status: "error", input: {}, content: [], structured: {}, error: { type: "unknown", message } },
  time: { created: DateTime.makeUnsafe(1_000) },
})

const seedProject = (db: Database.Interface["db"], projectID: ProjectV2.ID, worktree: string) =>
  db
    .insert(ProjectTable)
    .values({ id: projectID, worktree: AbsolutePath.make(worktree), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)

const seedSession = (
  db: Database.Interface["db"],
  projectID: ProjectV2.ID,
  sessionID: SessionSchema.ID,
  title: string,
  directory: string,
) =>
  db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: projectID,
      slug: "kb",
      directory: AbsolutePath.make(directory),
      title,
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)

const seedMessage = (
  db: Database.Interface["db"],
  sessionID: SessionSchema.ID,
  message: SessionMessage.Message,
  seq: number,
) =>
  db
    .insert(SessionMessageTable)
    .values({ id: message.id, session_id: sessionID, type: message.type, seq, data: dataOf(message) })
    .run()
    .pipe(Effect.orDie)

// Fresh temp DB + project dir per test; body gets the service, a direct db
// handle for seeding, and the project directory the KB writes into.
const withKB = <A, E>(
  body: (service: KB.Interface, db: Database.Interface["db"], projectDir: string) => Effect.Effect<A, E, Scope.Scope>,
) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const dir = await tmpdir()
      return { file: path.join(dir.path, "kb.sqlite"), dir }
    }),
    ({ dir }) => Effect.promise(() => dir[Symbol.asyncDispose]()),
  ).pipe(
    Effect.flatMap(({ file, dir }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { db } = yield* Database.Service
          const service = yield* KB.Service
          return yield* body(service, db, dir.path)
        }).pipe(
          Effect.provide(KB.layer),
          Effect.provide(FSUtil.defaultLayer),
          Effect.provide(Database.layerFromPath(file)),
        ),
      ),
    ),
  )

const readFile = (file: string) =>
  Effect.promise(async () => {
    const { readFile } = await import("node:fs/promises")
    return await readFile(file, "utf8")
  })

const kbPath = (projectDir: string, name: string) => path.join(projectDir, ".openaxe", "kb", `${name}.md`)

const it = testEffect(Layer.empty)

describe("KBBuilder", () => {
  it.effect("build writes 4 files with frontmatter and session-derived content", () =>
    withKB((service, db, projectDir) =>
      Effect.gen(function* () {
        const projectID = ProjectV2.ID.make("proj_kb_content")
        yield* seedProject(db, projectID, projectDir)
        const archID = SessionSchema.ID.descending("ses_kb_arch")
        yield* seedSession(db, projectID, archID, "Architecture overhaul", projectDir)
        yield* seedMessage(
          db,
          archID,
          user("msg_1", "How is the package structured? We should refactor the module layout.", 1_000),
          1,
        )
        yield* seedMessage(db, archID, assistant("msg_2", [okTool("p1", "read"), okTool("p2", "grep")], 2_000), 2)

        const errID = SessionSchema.ID.descending("ses_kb_err")
        yield* seedSession(db, projectID, errID, "Fix rate limit errors", projectDir)
        yield* seedMessage(db, errID, user("msg_3", "Bash keeps failing with rate limit errors, fix it", 1_000), 1)
        yield* seedMessage(
          db,
          errID,
          assistant(
            "msg_4",
            [errorTool("p3", "bash", "rate limit exceeded: too many requests"), okTool("p4", "bash")],
            2_000,
          ),
          2,
        )

        const patID = SessionSchema.ID.descending("ses_kb_pat")
        yield* seedSession(db, projectID, patID, "Testing conventions", projectDir)
        yield* seedMessage(db, patID, user("msg_5", "Our workflow pattern: always run typecheck after edits", 1_000), 1)
        yield* seedMessage(
          db,
          patID,
          assistant("msg_6", [okTool("p5", "bash"), okTool("p6", "bash"), okTool("p7", "read")], 2_000),
          2,
        )

        yield* service.build(projectID)

        for (const name of KB.KB_FILES) {
          const content = yield* readFile(kbPath(projectDir, name))
          expect(content).toContain("title:")
          expect(content).toContain("generatedAt:")
          expect(content).toContain("sourceSessions:")
          expect(content).toContain(KB.USER_START)
          expect(content).toContain(KB.USER_END)
          const parsed = matter(content)
          expect(typeof parsed.data.title).toBe("string")
          expect(typeof parsed.data.generatedAt).toBe("string")
          expect(Array.isArray(parsed.data.sourceSessions)).toBe(true)
        }

        const architecture = yield* readFile(kbPath(projectDir, "architecture"))
        expect(architecture).toContain("Architecture overhaul")
        expect(architecture).toContain(String(archID))

        const patterns = yield* readFile(kbPath(projectDir, "patterns"))
        expect(patterns).toContain("Testing conventions")
        expect(patterns).toContain("Repeated tools: bash (2), read (1)")

        const errors = yield* readFile(kbPath(projectDir, "errors"))
        expect(errors).toContain("Fix rate limit errors")
        expect(errors).toContain("rate limit exceeded: too many requests")

        // decisions.md: no session matched decision keywords -> empty sections + no sources.
        const decisions = yield* readFile(kbPath(projectDir, "decisions"))
        expect(decisions).toContain("_Nothing extracted from recent sessions yet._")
        expect(matter(decisions).data.sourceSessions).toEqual([])
      }),
    ),
  )

  it.effect("re-build preserves user content between markers and regenerates the rest", () =>
    withKB((service, db, projectDir) =>
      Effect.gen(function* () {
        const projectID = ProjectV2.ID.make("proj_kb_preserve")
        yield* seedProject(db, projectID, projectDir)
        const sessionID = SessionSchema.ID.descending("ses_kb_preserve")
        yield* seedSession(db, projectID, sessionID, "Architecture notes", projectDir)
        yield* seedMessage(db, sessionID, user("msg_1", "How is the codebase structured?", 1_000), 1)

        yield* service.build(projectID)
        const file = kbPath(projectDir, "architecture")
        const first = yield* readFile(file)
        expect(first).toContain("Architecture notes")

        // User adds a manual note inside the marker block.
        const edited = first.replace(
          `${KB.USER_START}\n${KB.USER_END}`,
          `${KB.USER_START}\n\n## Hand-written note\n\nThe auth layer lives in src/auth.\n${KB.USER_END}`,
        )
        yield* Effect.promise(async () => {
          await Bun.write(file, edited)
        })

        yield* service.build(projectID)
        const second = yield* readFile(file)
        expect(second).toContain("## Hand-written note")
        expect(second).toContain("The auth layer lives in src/auth.")
        // Regenerated content still around the preserved block.
        expect(second).toContain("Architecture notes")
        expect(second).toContain("How is the codebase structured?")
        expect(matter(second).data.sourceSessions).toContain(String(sessionID))
        expect(matter(second).data.generatedAt).not.toBe(matter(first).data.generatedAt)
      }),
    ),
  )

  it.effect("build with no sessions creates empty KB files without crashing", () =>
    withKB((service, db, projectDir) =>
      Effect.gen(function* () {
        const projectID = ProjectV2.ID.make("proj_kb_empty")
        yield* seedProject(db, projectID, projectDir)
        yield* service.build(projectID)
        for (const name of KB.KB_FILES) {
          const content = yield* readFile(kbPath(projectDir, name))
          expect(matter(content).data.sourceSessions).toEqual([])
          expect(content).toContain(KB.USER_START)
          expect(content).toContain(KB.USER_END)
        }
      }),
    ),
  )

  it.effect("build with no project or session rows is a no-op", () =>
    withKB((service, db, projectDir) =>
      Effect.gen(function* () {
        const projectID = ProjectV2.ID.make("proj_kb_missing")
        yield* service.build(projectID)
        const entries = yield* Effect.promise(() => readdir(path.join(projectDir, ".openaxe", "kb"))).pipe(
          Effect.catchCause(() => Effect.succeed([] as string[])),
        )
        expect(entries).toEqual([])
      }),
    ),
  )

  it.effect("preserveUserSections splices the old marker block into new content", () =>
    Effect.sync(() => {
      const old = `${KB.USER_START}\n\nmy manual notes\n${KB.USER_END}`
      const generated = `# X\n\n${KB.USER_START}\n${KB.USER_END}`
      expect(KB.preserveUserSections(old, generated)).toBe(`# X\n\n${KB.USER_START}\n\nmy manual notes\n${KB.USER_END}`)
      // No old content or no markers -> generated is returned unchanged.
      expect(KB.preserveUserSections(undefined, generated)).toBe(generated)
      expect(KB.preserveUserSections("no markers here", generated)).toBe(generated)
    }),
  )

  it.effect("related sessions found via EmbeddingService extend sourceSessions", () =>
    withKB((service, db, projectDir) =>
      Effect.gen(function* () {
        const projectID = ProjectV2.ID.make("proj_kb_embed")
        yield* seedProject(db, projectID, projectDir)
        const archID = SessionSchema.ID.descending("ses_kb_embed_a")
        yield* seedSession(db, projectID, archID, "Refactor the module layout", projectDir)
        yield* seedMessage(db, archID, user("msg_1", "How is the package structured today?", 1_000), 1)
        const relatedID = SessionSchema.ID.descending("ses_kb_embed_b")
        yield* seedSession(db, projectID, relatedID, "General cleanup session", projectDir)
        yield* seedMessage(db, relatedID, user("msg_2", "Tidy up some loose ends", 1_000), 1)

        // archID summary ~ [1, 0]; relatedID ~ [cos(0.2), sin(0.2)] -> cosine ≈ 0.98 >= 0.9.
        const vectors: number[][] = [
          [1, 0],
          [Math.cos(0.2), Math.sin(0.2)],
        ]
        const fake = Embedding.Service.of({
          provider: {
            model: "fake",
            dimension: 2,
            embed: () => Effect.succeed({ vectors, dimension: 2, model: "fake" }),
          },
          embed: () => Effect.succeed({ vectors, dimension: 2, model: "fake" }),
        })

        yield* service.build(projectID).pipe(Effect.provide(Layer.succeed(Embedding.Service, fake)))

        const architecture = yield* readFile(kbPath(projectDir, "architecture"))
        const sourceSessions = matter(architecture).data.sourceSessions as string[]
        expect(sourceSessions).toContain(String(archID))
        expect(sourceSessions).toContain(String(relatedID))
      }),
    ),
  )
})
