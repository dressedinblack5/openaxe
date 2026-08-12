import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Effect, Layer, Option } from "effect"
import { Database } from "../database/database"
import { Embedding } from "../embedding/embedding"
import { Location } from "../location"
import { Project } from "../project"
import { AbsolutePath } from "../schema"
import { tmpdir } from "../../test/fixture/tmpdir"
import { WorkspaceMemory } from "./workspace-memory"
import { WorkspaceMemoryTable } from "./workspace-memory.sql"
import { eq } from "drizzle-orm"

// Deterministic bag-of-words embedding: 26 dims, one per lowercase letter.
// Similar texts share letters → small cosine distance under vec0's default metric.
const alphabet = "abcdefghijklmnopqrstuvwxyz"
const bagOfWords = (text: string) => {
  const dims = Array.from({ length: alphabet.length }, () => 0)
  for (const ch of text.toLowerCase()) {
    const index = alphabet.indexOf(ch)
    if (index >= 0) dims[index] += 1
  }
  return dims
}

const makeEmbedding = (embed: Embedding.Interface["embed"]) =>
  Layer.succeed(
    Embedding.Service,
    Embedding.Service.of({
      provider: { model: "fake", dimension: alphabet.length, embed },
      embed,
    }),
  )

const fakeEmbedding = makeEmbedding((texts) =>
  Effect.sync(() => ({
    vectors: [...texts].map((text) => bagOfWords(text)),
    dimension: alphabet.length,
    model: "fake",
  })),
)

const failingEmbedding = makeEmbedding(() =>
  Effect.fail<Embedding.EmbeddingError>({ _tag: "ProviderUnreachable", message: "provider down" }),
)

const makeLayer = (file: string, embedding = fakeEmbedding) =>
  WorkspaceMemory.layer.pipe(
    Layer.provide(Database.layerFromPath(file)),
    Layer.provide(embedding),
  )

const run = <A, E>(effect: Effect.Effect<A, E, WorkspaceMemory.Service>) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.acquireRelease(
        Effect.promise(async () => {
          const dir = await tmpdir()
          const layer = makeLayer(path.join(dir.path, "workspace-memory.sqlite"))
          return { dir, layer }
        }),
        ({ dir }) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      ).pipe(
        Effect.flatMap(({ layer }) => effect.pipe(Effect.provide(layer))),
      ),
    ),
  )

const withLocation = (projectID: string) =>
  Layer.succeed(
    Location.Service,
    Location.Service.of({
      directory: AbsolutePath.make("/tmp"),
      project: { id: Project.ID.make(projectID), directory: AbsolutePath.make("/tmp") },
    }),
  )

describe("WorkspaceMemory", () => {
  test("set/get/delete/list roundtrip", async () => {
    const keys = await run(
      Effect.gen(function* () {
        const service = yield* WorkspaceMemory.Service
        yield* service.set("alpha", "first value")
        yield* service.set("beta", "second value")
        const missing = yield* service.get("nope")
        const alpha = yield* service.get("alpha")
        yield* service.delete("alpha")
        return { missing, alpha, keys: yield* service.list() }
      }),
    )
    expect(Option.isNone(keys.missing)).toBe(true)
    expect(Option.getOrNull(keys.alpha)).toBe("first value")
    expect(keys.keys).toEqual(["beta"])
  })

  test("list returns keys sorted", async () => {
    const keys = await run(
      Effect.gen(function* () {
        const service = yield* WorkspaceMemory.Service
        yield* service.set("zebra", "1")
        yield* service.set("apple", "2")
        yield* service.set("mango", "3")
        return yield* service.list()
      }),
    )
    expect(keys).toEqual(["apple", "mango", "zebra"])
  })

  test("listEntries returns entries ordered by updated_at desc with values", async () => {
    const dir = await tmpdir()
    const file = path.join(dir.path, "workspace-memory.sqlite")
    for (const [key, value] of [
      ["older", "old value"],
      ["newer", "new value"],
      ["newest", "newest value"],
    ]) {
      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* WorkspaceMemory.Service
          yield* service.set(key, value)
        }).pipe(Effect.provide(makeLayer(file))),
      )
      await Bun.sleep(2)
    }
    const entries = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* WorkspaceMemory.Service
        return yield* service.listEntries(10)
      }).pipe(Effect.provide(makeLayer(file))),
    )
    expect(entries.map((e) => e.key)).toEqual(["newest", "newer", "older"])
    expect(entries[0]?.value).toBe("newest value")
    expect(entries.every((e, i) => i === 0 || entries[i - 1].updatedAt >= e.updatedAt)).toBe(true)
    await dir[Symbol.asyncDispose]()
  })

  test("listEntries respects the limit", async () => {
    const entries = await run(
      Effect.gen(function* () {
        const service = yield* WorkspaceMemory.Service
        yield* service.set("a", "1")
        yield* service.set("b", "2")
        yield* service.set("c", "3")
        return yield* service.listEntries(2)
      }),
    )
    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.key).sort()).toEqual(["b", "c"])
  })

  test("set with an existing key overwrites the value", async () => {
    const result = await run(
      Effect.gen(function* () {
        const service = yield* WorkspaceMemory.Service
        yield* service.set("key", "first")
        yield* service.set("key", "second")
        return { value: yield* service.get("key"), keys: yield* service.list() }
      }),
    )
    expect(Option.getOrNull(result.value)).toBe("second")
    expect(result.keys).toEqual(["key"])
  })

  test("persists across layer instantiations (same DB file = across sessions)", async () => {
    const dir = await tmpdir()
    const file = path.join(dir.path, "workspace-memory.sqlite")
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* WorkspaceMemory.Service
        yield* service.set("greeting", "hello from session one")
      }).pipe(Effect.provide(makeLayer(file))),
    )
    const value = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* WorkspaceMemory.Service
        return yield* service.get("greeting")
      }).pipe(Effect.provide(makeLayer(file))),
    )
    expect(Option.getOrNull(value)).toBe("hello from session one")
    await dir[Symbol.asyncDispose]()
  })

  test("search finds entries after a layer restart (index rebuilt from blobs)", async () => {
    const dir = await tmpdir()
    const file = path.join(dir.path, "workspace-memory.sqlite")
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* WorkspaceMemory.Service
        yield* service.set("banana", "banana is the yellow fruit")
        yield* service.set("cars", "car engines burn gasoline")
      }).pipe(Effect.provide(makeLayer(file))),
    )
    const hits = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* WorkspaceMemory.Service
        return yield* service.search("yellow fruit", 3)
      }).pipe(Effect.provide(makeLayer(file))),
    )
    expect(hits[0]?.key).toBe("banana")
    expect(hits[0]?.value).toBe("banana is the yellow fruit")
    await dir[Symbol.asyncDispose]()
  })

  test("scopes entries to the caller's project_id", async () => {
    const dir = await tmpdir()
    const file = path.join(dir.path, "workspace-memory.sqlite")
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* WorkspaceMemory.Service
        yield* service.set("secret", "project A only")
      }).pipe(
        Effect.provide(withLocation("project-a")),
        Effect.provide(makeLayer(file)),
      ),
    )
    const fromOther = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* WorkspaceMemory.Service
        return { value: yield* service.get("secret"), keys: yield* service.list() }
      }).pipe(
        Effect.provide(withLocation("project-b")),
        Effect.provide(makeLayer(file)),
      ),
    )
    expect(Option.isNone(fromOther.value)).toBe(true)
    expect(fromOther.keys).toEqual([])
    await dir[Symbol.asyncDispose]()
  })

  test("search returns relevant keys ranked by similarity", async () => {
    const hits = await run(
      Effect.gen(function* () {
        const service = yield* WorkspaceMemory.Service
        yield* service.set("banana", "memory about banana smoothies")
        yield* service.set("apple", "memory about apple pies")
        yield* service.set("cars", "totally unrelated car engine facts")
        return yield* service.search("banana", 3)
      }),
    )
    expect(hits).toHaveLength(3)
    expect(hits[0]?.key).toBe("banana")
    expect(hits[0]?.value).toBe("memory about banana smoothies")
    const scores = hits.map((hit) => hit.score)
    expect(scores[0]).toBeLessThan(scores[1])
  })

  test("search respects the k limit", async () => {
    const hits = await run(
      Effect.gen(function* () {
        const service = yield* WorkspaceMemory.Service
        yield* service.set("banana", "memory about banana smoothies")
        yield* service.set("apple", "memory about apple pies")
        return yield* service.search("banana", 1)
      }),
    )
    expect(hits).toHaveLength(1)
    expect(hits[0]?.key).toBe("banana")
  })

  test("embedding failure persists the row without a vector", async () => {
    const dir = await tmpdir()
    const file = path.join(dir.path, "workspace-memory.sqlite")
    const { value, vector } = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* WorkspaceMemory.Service
        yield* service.set("durable", "survives provider outage")
        const { db } = yield* Database.Service
        const row = yield* db
          .select()
          .from(WorkspaceMemoryTable)
          .where(eq(WorkspaceMemoryTable.key, "durable"))
          .get()
          .pipe(Effect.orDie)
        return { value: yield* service.get("durable"), vector: row?.vector ?? null }
      }).pipe(
        // The body reads Database.Service directly, so it gets its own connection to
        // the same file (WAL allows it); the service layer resolves its own internally.
        Effect.provide(Database.layerFromPath(file)),
        Effect.provide(makeLayer(file, failingEmbedding)),
      ),
    )
    expect(Option.getOrNull(value)).toBe("survives provider outage")
    expect(vector).toBeNull()
    await dir[Symbol.asyncDispose]()
  })
})
