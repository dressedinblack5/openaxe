import { describe, expect } from "bun:test"
import path from "node:path"
import { DateTime, Effect, Layer, Schema, Scope } from "effect"
import { Database } from "../database/database"
import { ModelV2 } from "../model"
import { ProjectV2 } from "../project"
import { ProjectTable } from "../project/sql"
import { ProviderV2 } from "../provider"
import { SessionMessage } from "../session/message"
import { RetryPolicyOverridesTable } from "../session/retry-policy.sql"
import { SessionMessageTable, SessionTable } from "../session/sql"
import { SessionSchema } from "../session/schema"
import { AbsolutePath } from "../schema"
import { testEffect } from "../../test/lib/effect"
import { tmpdir } from "../../test/fixture/tmpdir"
import { Reflection } from "./reflection"

const encode = Schema.encodeSync(SessionMessage.Message)
type MessageData = Omit<(typeof SessionMessage.Message)["Encoded"], "id" | "type">
const dataOf = (message: SessionMessage.Message): MessageData => {
  const { id: _id, type: _type, ...data } = encode(message)
  return data
}

const assistant = (id: string, content: SessionMessage.AssistantContent[], created: number): SessionMessage.Message => ({
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

const seed = (db: Database.Interface["db"], projectID: ProjectV2.ID, sessionID: SessionSchema.ID, messages: SessionMessage.Message[]) =>
  Effect.gen(function* () {
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
        slug: "reflect",
        directory: AbsolutePath.make("/project"),
        title: "reflection",
        version: "test",
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

// Fresh temp DB per test; body gets the service (under Reflection.layer) plus a
// direct db handle for seeding/asserting (same WAL file, separate connection).
const withReflection = <A, E>(
  body: (service: Reflection.Interface, db: Database.Interface["db"]) => Effect.Effect<A, E, Scope.Scope>,
) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const dir = await tmpdir()
      return { file: path.join(dir.path, "reflection.sqlite"), dir }
    }),
    ({ dir }) => Effect.promise(() => dir[Symbol.asyncDispose]()),
  ).pipe(
    Effect.flatMap(({ file }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { db } = yield* Database.Service
          const service = yield* Reflection.Service
          return yield* body(service, db)
        }).pipe(Effect.provide(Reflection.layer), Effect.provide(Database.layerFromPath(file))),
      ),
    ),
  )

const it = testEffect(Layer.empty)

describe("Reflection", () => {
  it.effect("analyze writes overrides for frequent error reasons and skips rare ones", () =>
    withReflection((service, db) =>
      Effect.gen(function* () {
        const projectID = ProjectV2.ID.make("proj_reflect_happy")
        const sessionID = SessionSchema.ID.descending("ses_reflect_happy")
        yield* seed(
          db,
          projectID,
          sessionID,
          [
            assistant("msg_1", [okTool("p1", "bash"), errorTool("p2", "bash", "rate limit exceeded: too many requests"), okTool("p3", "read")], 1_000),
            assistant("msg_2", [errorTool("p4", "bash", "429 Too Many Requests - slow down"), okTool("p5", "grep"), errorTool("p6", "bash", "rate limit reached")], 2_000),
            assistant("msg_3", [okTool("p7", "read"), errorTool("p8", "bash", "input exceeds context window"), okTool("p9", "grep"), okTool("p10", "bash")], 3_000),
          ],
        )

        yield* service.analyze(projectID)

        const overrides = yield* db.select().from(RetryPolicyOverridesTable).all()
        // rate_limit: 3/10 failures -> written. context_length: 1/10 -> below threshold, skipped.
        expect(overrides).toHaveLength(1)
        expect(overrides[0]).toMatchObject({
          retry_reason: "rate_limit",
          max_attempts: 5,
          base_delay_ms: 60_000,
          max_delay_ms: 300_000,
          backoff_multiplier: 2,
          jitter: 0.1,
        })
        expect(overrides[0].updated_at).toBeGreaterThan(0)

        // Idempotent: re-running upserts, never duplicates.
        yield* service.analyze(projectID)
        const again = yield* db.select().from(RetryPolicyOverridesTable).all()
        expect(again).toHaveLength(1)
      }),
    ),
  )

  it.effect("analyze with no tool errors is a no-op", () =>
    withReflection((service, db) =>
      Effect.gen(function* () {
        const projectID = ProjectV2.ID.make("proj_reflect_clean")
        const sessionID = SessionSchema.ID.descending("ses_reflect_clean")
        yield* seed(
          db,
          projectID,
          sessionID,
          [assistant("msg_1", [okTool("p1", "bash"), okTool("p2", "read")], 1_000)],
        )

        yield* service.analyze(projectID)

        const overrides = yield* db.select().from(RetryPolicyOverridesTable).all()
        expect(overrides).toHaveLength(0)
      }),
    ),
  )

  it.effect("classify maps error text/status to reasons and never crashes", () =>
    Effect.sync(() => {
      expect(Reflection.classify({ type: "unknown", message: "rate limit exceeded" })).toBe("rate_limit")
    expect(Reflection.classify({ type: "unknown", message: "Input exceeds context window" })).toBe("context_length")
    expect(Reflection.classify({ type: "unknown", message: "The request timed out" })).toBe("timeout")
    expect(Reflection.classify({ type: "unknown", message: "response was filtered by safety" })).toBe("refusal")
    expect(Reflection.classify({ type: "unknown", message: "Unauthorized: invalid api key" })).toBe("auth")
    expect(Reflection.classify({ type: "unknown", message: "invalid request body" })).toBe("invalid_request")
    expect(Reflection.classify({ type: "unknown", message: "provider is overloaded" })).toBe("server")
    expect(Reflection.classify({ type: "unknown", message: "something entirely unexpected" })).toBe("unclassified")
    expect(Reflection.classify(42)).toBe("unclassified")
    expect(Reflection.classify(undefined)).toBe("unclassified")
    // ApiError-shaped objects from the provider SDK.
    expect(
      Reflection.classify({ name: "APIError", data: { statusCode: 429, message: "Too Many Requests" } }),
    ).toBe("rate_limit")
    expect(Reflection.classify({ name: "APIError", data: { statusCode: 500, message: "Internal Server Error" } })).toBe(
      "server",
    )
    expect(Reflection.classify({ name: "APIError", data: { statusCode: 401, message: "Invalid API key" } })).toBe("auth")
    })
  )
})
