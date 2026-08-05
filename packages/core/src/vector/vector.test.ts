import { describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { Cause, Effect, Exit, Layer } from "effect"
import path from "node:path"
import { ConfigEmbedding } from "../config/embedding"
import { Database } from "../database/database"
import { tmpdir } from "../../test/fixture/tmpdir"
import { Vector } from "./vector"

/** One-hot vector in DEFAULT_DIMENSION=768 with an optional scale on the hot index. */
const vector = (index: number, scale = 1) => {
  const values = Array.from({ length: 768 }, () => 0)
  values[index] = scale
  return values
}

const makeLayer = async () => {
  const dir = await tmpdir()
  const layer = Vector.layer.pipe(
    Layer.provide(Database.layerFromPath(path.join(dir.path, "vector.sqlite"))),
    Layer.provide(Layer.succeed(ConfigEmbedding.ConfigService, ConfigEmbedding.ConfigService.of({}))),
  )
  return { dir, layer }
}

const withVector = <A, E>(body: (service: Vector.Interface) => Effect.Effect<A, E>) =>
  Effect.scoped(
    Effect.acquireRelease(
      Effect.promise(makeLayer),
      ({ dir }) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap(({ layer }) =>
        Effect.gen(function* () {
          const service = yield* Vector.Service
          return yield* body(service)
        }).pipe(Effect.provide(layer)),
      ),
    ),
  )

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

const failureOf = async (effect: Effect.Effect<unknown, Vector.VectorError>) => {
  const exit = await Effect.runPromise(effect.pipe(Effect.exit))
  if (!Exit.isFailure(exit)) throw new Error("expected failure")
  return Cause.squash(exit.cause) as Vector.VectorError
}

describe("VectorService", () => {
  test("insert 100 vectors, search returns top-5 ordered by score", async () => {
    await run(
      withVector((service) =>
        Effect.gen(function* () {
          yield* service.insert("session_message", "m0", vector(0))
          // Scales make every L2 distance from e_0 unique, so the top-5 is deterministic.
          for (let i = 1; i < 100; i++) {
            yield* service.insert("session_message", `m${i}`, vector(i, 1 + 0.001 * i))
          }
          const results = yield* service.search("session_message", vector(0), 5)
          expect(results.map((hit) => hit.id)).toEqual(["m0", "m1", "m2", "m3", "m4"])
          expect(results[0].score).toBeCloseTo(1, 5)
          for (let i = 1; i < results.length; i++) {
            expect(results[i].score).toBeLessThan(results[i - 1].score)
          }
          // m1 distance = sqrt(1 + 1.001^2); score = 1 - distance
          expect(results[1].score).toBeCloseTo(1 - Math.sqrt(1 + 1.001 ** 2), 4)
        }),
      ),
    )
  })

  test("search filter scopes results by project_id and session_id", async () => {
    await run(
      withVector((service) =>
        Effect.gen(function* () {
          for (let i = 0; i < 20; i++) {
            yield* service.insert("session_message", `m${i}`, vector(i), {
              projectId: i % 2 === 0 ? "p0" : "p1",
              sessionId: `s${i}`,
            })
          }
          const p0 = yield* service.search("session_message", vector(0), 10, sql`project_id = ${"p0"}`)
          const byIndex = (a: string, b: string) => Number(a.slice(1)) - Number(b.slice(1))
          expect(p0.map((hit) => hit.id).sort(byIndex)).toEqual(Array.from({ length: 10 }, (_, i) => `m${i * 2}`))
          expect(p0[0].id).toBe("m0")
          expect(p0[0].score).toBeCloseTo(1, 5)

          const s3 = yield* service.search("session_message", vector(0), 5, sql`session_id = ${"s3"}`)
          expect(s3.map((hit) => hit.id)).toEqual(["m3"])

          const none = yield* service.search("session_message", vector(0), 5, sql`project_id = ${"p9"}`)
          expect(none).toEqual([])
        }),
      ),
    )
  })

  test("insert with a wrong dimension fails with InvalidDimension", async () => {
    const error = await failureOf(withVector((service) => service.insert("session_message", "bad", [1, 2, 3])))
    expect(error).toEqual({ _tag: "InvalidDimension", expected: 768, actual: 3 })
  })

  test("search with a wrong dimension fails with InvalidDimension", async () => {
    const error = await failureOf(withVector((service) => service.search("session_message", [1, 2, 3], 5)))
    expect(error).toEqual({ _tag: "InvalidDimension", expected: 768, actual: 3 })
  })

  test("search on an empty table returns an empty array", async () => {
    await run(
      withVector((service) =>
        Effect.gen(function* () {
          expect(yield* service.search("session_message", vector(0), 5)).toEqual([])
          expect(yield* service.search("workspace_memory", vector(0), 5)).toEqual([])
        }),
      ),
    )
  })

  test("delete removes a vector from search results", async () => {
    await run(
      withVector((service) =>
        Effect.gen(function* () {
          yield* service.insert("session_message", "m0", vector(0))
          yield* service.insert("session_message", "m1", vector(1))
          yield* service.delete("session_message", "m0")
          const results = yield* service.search("session_message", vector(0), 5)
          expect(results.map((hit) => hit.id)).toEqual(["m1"])
        }),
      ),
    )
  })

  test("workspace_memory uses key ids and the T8-contracted table shape", async () => {
    await run(
      withVector((service) =>
        Effect.gen(function* () {
          yield* service.insert("workspace_memory", "key-a", vector(0), { projectId: "proj-1" })
          yield* service.insert("workspace_memory", "key-b", vector(1), { projectId: "proj-1" })
          const results = yield* service.search("workspace_memory", vector(0), 5)
          expect(results.map((hit) => hit.id)).toEqual(["key-a", "key-b"])
          expect(results[0].score).toBeCloseTo(1, 5)
          const filtered = yield* service.search("workspace_memory", vector(0), 5, sql`project_id = ${"proj-1"}`)
          expect(filtered.map((hit) => hit.id)).toEqual(["key-a", "key-b"])
          yield* service.delete("workspace_memory", "key-a")
          const after = yield* service.search("workspace_memory", vector(0), 5)
          expect(after.map((hit) => hit.id)).toEqual(["key-b"])
        }),
      ),
    )
  })
})
