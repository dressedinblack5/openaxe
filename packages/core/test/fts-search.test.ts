import { describe, expect } from "bun:test"
import { Database as BunDatabase } from "bun:sqlite"
import { DateTime, Effect, Layer, Schema, Semaphore, Stream } from "effect"
import { make as makeSqlClient } from "effect/unstable/sql/SqlClient"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { classifySqliteError, SqlError } from "effect/unstable/sql/SqlError"
import { makeCompilerSqlite } from "effect/unstable/sql/Statement"
import { layer as reactivityLayer } from "effect/unstable/reactivity/Reactivity"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import { FTSIndex } from "@opencode-ai/core/database/fts"
import { ModelV2 } from "@opencode-ai/core/model"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionSearchTool } from "@opencode-ai/core/tool/session-search"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { testEffect } from "./lib/effect"
import { settleTool, toolIdentity } from "./lib/tool"

/**
 * Test Database backed by a plain bun:sqlite connection instead of
 * `Database.defaultLayer`. bun 1.4.0-canary.1 segfaults when any FTS5
 * statement runs on a bun:sqlite Database whose `close()` is captured by an
 * Effect `addFinalizer` (exactly how the default driver's native layer is
 * wired); a connection without that finalizer has no such bug. The drizzle
 * session, schema, and every code path under test are otherwise identical.
 */
const makeDatabase = () =>
  Effect.gen(function* () {
    const native = new BunDatabase(":memory:", { readwrite: true, create: true })
    const run = (query: string, params: ReadonlyArray<unknown> = []) =>
      Effect.try({
        try: () => (native.query(query).all(...(params as never[])) ?? []) as Array<Record<string, unknown>>,
        catch: (cause) =>
          new SqlError({
            reason: classifySqliteError(cause, { message: "Failed to execute statement", operation: "execute" }),
          }),
      })
    const runValues = (query: string, params: ReadonlyArray<unknown> = []) =>
      Effect.try({
        try: () => (native.query(query).values(...(params as never[])) ?? []) as Array<unknown[]>,
        catch: (cause) =>
          new SqlError({
            reason: classifySqliteError(cause, { message: "Failed to execute statement", operation: "executeValues" }),
          }),
      })
    const connection = {
      execute: (query: string, params: ReadonlyArray<unknown>) => run(query, params),
      executeRaw: (query: string, params: ReadonlyArray<unknown>) => run(query, params),
      executeValues: (query: string, params: ReadonlyArray<unknown>) => runValues(query, params),
      executeUnprepared: (query: string, params: ReadonlyArray<unknown>) => run(query, params),
      executeStream: () =>
        Stream.fail(new SqlError({ reason: classifySqliteError(new Error("executeStream not implemented")) })),
    }
    const semaphore = yield* Semaphore.make(1)
    const acquirer = semaphore.withPermits(1)(Effect.succeed(connection))
    const client = yield* makeSqlClient({
      compiler: makeCompilerSqlite(undefined),
      acquirer,
      transactionAcquirer: acquirer,
      spanAttributes: [],
    })
    const db = yield* EffectDrizzleSqlite.makeWithDefaults().pipe(Effect.provide(Layer.succeed(SqlClient, client)))
    yield* DatabaseMigration.apply(db)
    return db
  })

const databaseLayer = Layer.effect(Database.Service, makeDatabase().pipe(Effect.map((db) => ({ db })))).pipe(
  Layer.provide(reactivityLayer),
)

const sessionID = SessionV2.ID.make("ses_fts_search_test")
const projectID = Project.ID.global

const encode = Schema.encodeSync(SessionMessage.Message)
type MessageData = Omit<(typeof SessionMessage.Message)["Encoded"], "id" | "type">
const dataOf = (message: SessionMessage.Message): MessageData => {
  const { id: _id, type: _type, ...data } = encode(message)
  return data
}

const userMessage = (id: string, text: string, created: number): SessionMessage.Message => ({
  id: SessionMessage.ID.make(id),
  type: "user",
  text,
  files: [],
  agents: [],
  time: { created: DateTime.makeUnsafe(created) },
})

const assistantMessage = (id: string, text: string, created: number): SessionMessage.Message => ({
  id: SessionMessage.ID.make(id),
  type: "assistant",
  agent: "build",
  model: { id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make("provider") },
  content: [{ type: "text", id: `${id}-part`, text }],
  time: { created: DateTime.makeUnsafe(created) },
})

const systemMessage = (id: string, text: string, created: number): SessionMessage.Message => ({
  id: SessionMessage.ID.make(id),
  type: "system",
  text,
  time: { created: DateTime.makeUnsafe(created) },
})

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: projectID, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: projectID,
      slug: "search",
      directory: "/project",
      title: "FTS search session",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

const seed = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const messages = [
    {
      seq: 1,
      message: userMessage("msg_fts_search_user", "How does the effect runtime schedule fiber work?", 1_000_000),
    },
    {
      seq: 2,
      message: systemMessage("msg_fts_search_system", "Session initialized for the search feature", 1_000_010),
    },
    {
      seq: 3,
      message: assistantMessage(
        "msg_fts_search_assistant",
        "The effect runtime schedules fibers on a work-stealing executor.",
        1_000_020,
      ),
    },
  ]
  for (const { seq, message } of messages) {
    yield* db
      .insert(SessionMessageTable)
      .values({
        id: message.id,
        session_id: sessionID,
        type: message.type,
        seq,
        data: dataOf(message),
      })
      .run()
      .pipe(Effect.orDie)
  }
})

const fts = FTSIndex.layer.pipe(Layer.provide(databaseLayer))
const ftsIt = testEffect(Layer.mergeAll(databaseLayer, fts))

const assertions: PermissionV2.AssertInput[] = []
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => {
        assertions.push(input)
      }),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const registry = ToolRegistry.defaultLayer.pipe(Layer.provide(permission))
const tool = SessionSearchTool.layer.pipe(Layer.provide(fts), Layer.provide(registry), Layer.provide(permission))
const toolIt = testEffect(Layer.mergeAll(databaseLayer, fts, permission, registry, tool))

describe("FTSIndex", () => {
  ftsIt.effect("lazily indexes session_message rows and finds a matching message", () =>
    Effect.gen(function* () {
      yield* setup
      yield* seed
      const fts = yield* FTSIndex.Service
      const results = yield* fts.search("fiber")
      expect(results).toHaveLength(2)
      const hit = results.find((result) => result.messageID === SessionMessage.ID.make("msg_fts_search_user"))
      expect(hit).toBeDefined()
      expect(hit).toMatchObject({
        sessionID,
        sessionTitle: "FTS search session",
        messageID: SessionMessage.ID.make("msg_fts_search_user"),
        type: "user",
      })
      expect(hit?.snippet.length).toBeGreaterThan(0)
      expect(hit?.rank).toBeTypeOf("number")
    }),
  )

  ftsIt.effect("extracts assistant text content for indexing", () =>
    Effect.gen(function* () {
      yield* setup
      yield* seed
      const fts = yield* FTSIndex.Service
      const results = yield* fts.search("stealing")
      expect(results).toHaveLength(1)
      expect(results[0]?.messageID).toBe(SessionMessage.ID.make("msg_fts_search_assistant"))
      expect(results[0]?.snippet).toContain("work-stealing")
    }),
  )

  ftsIt.effect("returns an empty list when nothing matches", () =>
    Effect.gen(function* () {
      yield* setup
      yield* seed
      const fts = yield* FTSIndex.Service
      expect(yield* fts.search("zzz_no_such_term")).toEqual([])
    }),
  )

  ftsIt.effect("sanitizes reserved FTS5 characters in the query", () =>
    Effect.gen(function* () {
      yield* setup
      yield* seed
      const fts = yield* FTSIndex.Service
      const matchesUser = (results: ReadonlyArray<FTSIndex.SearchResult>) =>
        results.some((result) => result.messageID === SessionMessage.ID.make("msg_fts_search_user"))
      expect(matchesUser(yield* fts.search("fiber * : ^ ( )"))).toBe(true)
      expect(matchesUser(yield* fts.search('"fiber"'))).toBe(true)
      expect(matchesUser(yield* fts.search('fiber "'))).toBe(true)
    }),
  )

  ftsIt.effect("returns empty results for empty or punctuation-only queries", () =>
    Effect.gen(function* () {
      yield* setup
      yield* seed
      const fts = yield* FTSIndex.Service
      expect(yield* fts.search("")).toEqual([])
      expect(yield* fts.search("   ")).toEqual([])
      expect(yield* fts.search("* : ^ ()")).toEqual([])
    }),
  )

  ftsIt.effect("does not duplicate rows across repeated searches", () =>
    Effect.gen(function* () {
      yield* setup
      yield* seed
      const fts = yield* FTSIndex.Service
      const first = yield* fts.search("effect")
      const second = yield* fts.search("effect")
      expect(first.length).toBeGreaterThan(0)
      expect(second.map((result) => result.messageID)).toEqual(first.map((result) => result.messageID))
    }),
  )

  ftsIt.effect("restricts results to a single session with the sessionID option", () =>
    Effect.gen(function* () {
      yield* setup
      yield* seed
      const fts = yield* FTSIndex.Service
      expect(yield* fts.search("fiber", { sessionID: SessionV2.ID.make("ses_fts_other") })).toEqual([])
      expect(yield* fts.search("fiber", { sessionID })).toHaveLength(2)
    }),
  )
})

describe("SessionSearchTool", () => {
  toolIt.effect("settles session_search and returns session metadata", () =>
    Effect.gen(function* () {
      yield* setup
      yield* seed
      assertions.length = 0
      const registry = yield* ToolRegistry.Service
      const settled = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-session-search",
          name: SessionSearchTool.name,
          input: { query: "fiber" },
        },
      })
      expect(assertions).toMatchObject([{ sessionID, action: "session_search", resources: ["fiber"], save: ["*"] }])
      expect(settled.result.type).toBe("json")
      expect(settled.result.value).toEqual([
        { sessionID: sessionID, sessionTitle: "FTS search session", snippet: expect.any(String) },
        { sessionID: sessionID, sessionTitle: "FTS search session", snippet: expect.any(String) },
      ])
    }),
  )

  toolIt.effect("settles an unmatched query with an empty result list", () =>
    Effect.gen(function* () {
      yield* setup
      yield* seed
      const registry = yield* ToolRegistry.Service
      const settled = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-session-search-miss",
          name: SessionSearchTool.name,
          input: { query: "zzz_none" },
        },
      })
      expect(settled.result).toEqual({ type: "json", value: [] })
    }),
  )
})
