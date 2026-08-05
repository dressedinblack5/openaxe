import { describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { Cause, Effect, Exit, Layer } from "effect"
import path from "node:path"
import { ConfigEmbedding } from "../config/embedding"
import { Database } from "../database/database"
import { Embedding } from "../embedding/embedding"
import { WorkspaceMemory } from "../memory/workspace-memory"
import { tmpdir } from "../../test/fixture/tmpdir"
import { Vector } from "./vector"

/** Unit vector at angle θ in the e0/e1 plane (embedded in 768 dims). Cosine is
 * scale-invariant, so distances between distinct angles are cos(Δθ)-dependent. */
const unit = (theta: number) => {
  const values = Array.from({ length: 768 }, () => 0)
  values[0] = Math.cos(theta)
  values[1] = Math.sin(theta)
  return values
}

const e0 = () => unit(0)

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
  test("insert 100 vectors, search returns top-5 ordered by cosine distance", async () => {
    await run(
      withVector((service) =>
        Effect.gen(function* () {
          // Angles increase monotonically, so cosine distance from e0 (1 - cos θ) does too.
          for (let i = 0; i < 100; i++) {
            yield* service.insert("session_message", `m${i}`, unit(i * (Math.PI / 200)))
          }
          const results = yield* service.search("session_message", e0(), 5)
          expect(results.map((hit) => hit.id)).toEqual(["m0", "m1", "m2", "m3", "m4"])
          expect(results[0].score).toBeCloseTo(0, 5)
          for (let i = 1; i < results.length; i++) {
            expect(results[i].score).toBeGreaterThan(results[i - 1].score)
          }
          expect(results[1].score).toBeCloseTo(1 - Math.cos(Math.PI / 200), 4)
        }),
      ),
    )
  })

  test("search filter scopes results by project_id and session_id", async () => {
    await run(
      withVector((service) =>
        Effect.gen(function* () {
          for (let i = 0; i < 20; i++) {
            yield* service.insert("session_message", `m${i}`, unit(i * (Math.PI / 200)), {
              projectId: i % 2 === 0 ? "p0" : "p1",
              sessionId: `s${i}`,
            })
          }
          const p0 = yield* service.search("session_message", e0(), 10, sql`project_id = ${"p0"}`)
          const byIndex = (a: string, b: string) => Number(a.slice(1)) - Number(b.slice(1))
          expect(p0.map((hit) => hit.id).sort(byIndex)).toEqual(Array.from({ length: 10 }, (_, i) => `m${i * 2}`))
          expect(p0[0].id).toBe("m0")
          expect(p0[0].score).toBeCloseTo(0, 5)

          const s3 = yield* service.search("session_message", e0(), 5, sql`session_id = ${"s3"}`)
          expect(s3.map((hit) => hit.id)).toEqual(["m3"])

          const none = yield* service.search("session_message", e0(), 5, sql`project_id = ${"p9"}`)
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
          expect(yield* service.search("session_message", e0(), 5)).toEqual([])
          expect(yield* service.search("workspace_memory", e0(), 5)).toEqual([])
        }),
      ),
    )
  })

  test("delete removes a vector from search results", async () => {
    await run(
      withVector((service) =>
        Effect.gen(function* () {
          yield* service.insert("session_message", "m0", e0())
          yield* service.insert("session_message", "m1", unit(Math.PI / 2))
          yield* service.delete("session_message", "m0")
          const results = yield* service.search("session_message", e0(), 5)
          expect(results.map((hit) => hit.id)).toEqual(["m1"])
        }),
      ),
    )
  })

  test("workspace_memory uses key ids and the T8-contracted table shape", async () => {
    await run(
      withVector((service) =>
        Effect.gen(function* () {
          yield* service.insert("workspace_memory", "key-a", e0(), { projectId: "proj-1" })
          yield* service.insert("workspace_memory", "key-b", unit(Math.PI / 2), { projectId: "proj-1" })
          const results = yield* service.search("workspace_memory", e0(), 5)
          expect(results.map((hit) => hit.id)).toEqual(["key-a", "key-b"])
          expect(results[0].score).toBeCloseTo(0, 5)
          const filtered = yield* service.search("workspace_memory", e0(), 5, sql`project_id = ${"proj-1"}`)
          expect(filtered.map((hit) => hit.id)).toEqual(["key-a", "key-b"])
          yield* service.delete("workspace_memory", "key-a")
          const after = yield* service.search("workspace_memory", e0(), 5)
          expect(after.map((hit) => hit.id)).toEqual(["key-b"])
        }),
      ),
    )
  })

  test("VectorService and WorkspaceMemory coexist on the shared workspace_memory_vec table", async () => {
    // Deterministic 768-dim bag-of-words embedding: similar texts share letters,
    // so cosine distance ranks them — same shape WorkspaceMemory uses internally.
    const alphabet = "abcdefghijklmnopqrstuvwxyz"
    const bagOfWords = (text: string) => {
      const dims = Array.from({ length: 768 }, () => 0)
      for (const ch of text.toLowerCase()) {
        const index = alphabet.indexOf(ch)
        if (index >= 0) dims[index] += 1
      }
      return dims
    }
    const embed: Embedding.Interface["embed"] = (texts) =>
      Effect.sync(() => ({
        vectors: [...texts].map((text) => bagOfWords(text)),
        dimension: 768,
        model: "fake",
      }))
    const embedding = Layer.succeed(
      Embedding.Service,
      Embedding.Service.of({ provider: { model: "fake", dimension: 768, embed }, embed }),
    )

    const dir = await tmpdir()
    const file = path.join(dir.path, "cross-service.sqlite")
    const layer = Layer.mergeAll(
      WorkspaceMemory.layer.pipe(Layer.provide(Database.layerFromPath(file)), Layer.provide(embedding)),
      Vector.layer.pipe(
        Layer.provide(Database.layerFromPath(file)),
        Layer.provide(
          Layer.succeed(ConfigEmbedding.ConfigService, ConfigEmbedding.ConfigService.of({ model: "nomic-embed-text" })),
        ),
      ),
    )

    await run(
      Effect.gen(function* () {
        const memory = yield* WorkspaceMemory.Service
        const vector = yield* Vector.Service
        // WorkspaceMemory writes a row + blob vector, VectorService finds it (with filter).
        yield* memory.set("banana", "banana is the yellow fruit")
        const viaVector = yield* vector.search("workspace_memory", bagOfWords("yellow fruit"), 5, sql`project_id = ${"default"}`)
        expect(viaVector[0]?.id).toBe("banana")
        expect(viaVector[0]?.score).toBeGreaterThan(0)
        expect(viaVector[0]?.score).toBeLessThan(1)
        // VectorService writes a blob row into the memory-created table; both are searchable.
        yield* vector.insert("workspace_memory", "key-cars", bagOfWords("car engines burn gasoline"), {
          projectId: "default",
        })
        const both = yield* vector.search("workspace_memory", bagOfWords("yellow fruit"), 5)
        expect(both.map((hit) => hit.id).sort()).toEqual(["banana", "key-cars"])
        // WorkspaceMemory.search is unchanged: it joins its durable table for values,
        // so vec-only rows written by VectorService are not returned.
        const viaMemory = yield* memory.search("yellow fruit", 5)
        expect(viaMemory.map((hit) => hit.key)).toEqual(["banana"])
      })
        .pipe(Effect.provide(Database.layerFromPath(file)))
        .pipe(Effect.provide(layer)),
    )
    await dir[Symbol.asyncDispose]()
  })
})
