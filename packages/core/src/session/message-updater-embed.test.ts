import { describe, expect, test } from "bun:test"
import path from "node:path"
import { DateTime, Effect, Layer } from "effect"
import { eq, sql } from "drizzle-orm"
import { ConfigEmbedding } from "../config/embedding"
import { Database } from "../database/database"
import { Embedding } from "../embedding/embedding"
import { EventV2 } from "../event"
import { Project } from "../project"
import { ProjectTable } from "../project/sql"
import { Vector } from "../vector/vector"
import { AbsolutePath } from "../schema"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { Prompt } from "./prompt"
import { SessionProjector } from "./projector"
import { SessionMessageTable, SessionTable } from "./sql"
import { SessionV2 } from "../session"
import { tmpdir } from "../../test/fixture/tmpdir"

// 768 dims matches the default embedding model (nomic-embed-text) that VectorService
// derives its vec0 dimension from — the fake must agree or inserts fail validation.
const DIMS = 768
const bagOfWords = (text: string) => {
  const dims = Array.from({ length: DIMS }, () => 0)
  for (const ch of text.toLowerCase()) {
    if (ch >= "a" && ch <= "z") dims[ch.charCodeAt(0) - 97] += 1
  }
  return dims
}

const makeEmbedding = (embed: Embedding.Interface["embed"]) =>
  Layer.succeed(Embedding.Service, Embedding.Service.of({ provider: { model: "fake", dimension: DIMS, embed }, embed }))

const fakeEmbedding = makeEmbedding((texts) =>
  Effect.sync(() => ({
    vectors: [...texts].map((text) => bagOfWords(text)),
    dimension: DIMS,
    model: "fake",
  })),
)

const failingEmbedding = makeEmbedding(() =>
  Effect.fail<Embedding.EmbeddingError>({ _tag: "ProviderUnreachable", message: "provider down" }),
)

const vectorLayer = (file: string) =>
  Vector.layer.pipe(
    Layer.provide(Database.layerFromPath(file)),
    Layer.provide(Layer.succeed(ConfigEmbedding.ConfigService, ConfigEmbedding.ConfigService.of({}))),
  )

const makeLayer = (file: string, embedding = fakeEmbedding) =>
  Layer.mergeAll(
    SessionProjector.layer.pipe(
      Layer.provide(EventV2.layer.pipe(Layer.provide(Database.layerFromPath(file)))),
      Layer.provide(Database.layerFromPath(file)),
    ),
    EventV2.layer.pipe(Layer.provide(Database.layerFromPath(file))),
    embedding,
    vectorLayer(file),
    Database.layerFromPath(file),
  )

const sessionID = SessionV2.ID.make("ses_embed_test")

const seed = (db: Database.Interface["db"]) =>
  Effect.gen(function* () {
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: "test",
        directory: "/project",
        title: "test",
        version: "test",
      })
      .run()
      .pipe(Effect.orDie)
  })

const run = <A, E>(effect: Effect.Effect<A, E, Database.Service | EventV2.Service>, embedding = fakeEmbedding) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.acquireRelease(
        Effect.promise(async () => {
          const dir = await tmpdir()
          const file = path.join(dir.path, "embed.sqlite")
          return { dir, layer: makeLayer(file, embedding) }
        }),
        ({ dir }) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      ).pipe(Effect.flatMap(({ layer }) => effect.pipe(Effect.provide(layer)))),
    ),
  )

const publishPrompted = (messageID: string, text: string) =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    yield* events.publish(SessionEvent.Prompted, {
      sessionID,
      messageID: SessionMessage.ID.make(messageID),
      timestamp: DateTime.makeUnsafe(0),
      prompt: Prompt.make({ text }),
      delivery: "steer",
    })
  })

// Reads vec rows for a message, treating a missing vec0 table as empty (the table
// self-creates on first VectorService use, which never happens in the failure path).
const vecRows = (db: Database.Interface["db"], messageID: string) =>
  Effect.gen(function* () {
    const tables = yield* db
      .all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE name = 'session_message_vec'`)
      .pipe(Effect.orDie)
    if (tables.length === 0) return []
    return yield* db
      .all<{ id: string }>(sql`SELECT id FROM session_message_vec WHERE id = ${messageID}`)
      .pipe(Effect.orDie)
  })

// Polls the vec table until the detached embed+insert fiber lands.
const waitForVecRow = (db: Database.Interface["db"], messageID: string, timeoutMs = 5000) =>
  Effect.gen(function* () {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const rows = yield* vecRows(db, messageID)
      if (rows.length > 0) return rows
      yield* Effect.sleep("20 millis")
    }
    return [] as { id: string }[]
  })

describe("SessionMessageUpdater auto-embed", () => {
  test("persists the message then inserts its vector row (async, non-blocking)", async () => {
    const result = await run(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        yield* seed(db)
        const messageID = "msg_embed_happy"
        yield* publishPrompted(messageID, "refactor the auth module")
        const rows = yield* waitForVecRow(db, messageID)
        const messageRow = yield* db
          .select()
          .from(SessionMessageTable)
          .where(eq(SessionMessageTable.id, SessionMessage.ID.make(messageID)))
          .get()
          .pipe(Effect.orDie)
        return { rows, messageRow }
      }),
    )
    expect(result.messageRow?.type).toBe("user")
    expect(result.rows.map((row) => row.id)).toEqual(["msg_embed_happy"])
  })

  test("keeps the message when embedding fails (failure logged, write unaffected)", async () => {
    const result = await run(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        yield* seed(db)
        const messageID = "msg_embed_fail"
        yield* publishPrompted(messageID, "hello world")
        yield* Effect.sleep("100 millis")
        const messageRow = yield* db
          .select()
          .from(SessionMessageTable)
          .where(eq(SessionMessageTable.id, SessionMessage.ID.make(messageID)))
          .get()
          .pipe(Effect.orDie)
        const rows = yield* vecRows(db, messageID)
        return { messageRow, vecCount: rows.length }
      }),
      failingEmbedding,
    )
    expect(result.messageRow?.type).toBe("user")
    expect(result.vecCount).toBe(0)
  })
})
