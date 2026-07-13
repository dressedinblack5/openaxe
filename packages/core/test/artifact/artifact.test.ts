import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { Artifact } from "@opencode-ai/core/artifact"
import { testEffect } from "../lib/effect"
import { tmpdir } from "../fixture/tmpdir"

const withStore = <A, E>(
  body: (store: Artifact.Interface) => Effect.Effect<A, E>,
) =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => {
      const baseDir = path.join(tmp.path, "artifacts")
      const artifactLayer = Artifact.layer(baseDir).pipe(
        Layer.provide(NodeFileSystem.layer),
      )
      return Effect.gen(function* () {
        return yield* body(yield* Artifact.Service)
      }).pipe(Effect.provide(artifactLayer))
    },
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

const it = testEffect(Layer.empty)

describe("Artifact", () => {
  it.live("stores and retrieves an artifact", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const entry = yield* store.store("test-key", "hello world")
        expect(entry.key).toBe("test-key")
        expect(entry.version).toBe(1)
        expect(entry.content).toBe("hello world")
        expect(entry.size).toBe(11)
        expect(entry.truncated).toBe(false)

        const retrieved = yield* store.get("test-key")
        expect(retrieved).not.toBeNull()
        expect(retrieved!.content).toBe("hello world")
        expect(retrieved!.version).toBe(1)
      }),
    ),
  )

  it.live("creates incrementing versions for the same key", () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.store("multi", "v1")
        const v2 = yield* store.store("multi", "v2")
        expect(v2.version).toBe(2)

        const v1 = yield* store.get("multi", 1)
        expect(v1?.content).toBe("v1")

        const latest = yield* store.get("multi")
        expect(latest?.version).toBe(2)
      }),
    ),
  )

  it.live("truncates oversized content and writes overflow", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const big = "x".repeat(Artifact.DEFAULT_TRUNCATION_THRESHOLD + 100)
        const entry = yield* store.store("big", big)
        expect(entry.truncated).toBe(true)
        expect(entry.content).toHaveLength(Artifact.DEFAULT_TRUNCATION_THRESHOLD)
        expect(entry.overflowPath).toBeDefined()

        const retrieved = yield* store.get("big")
        expect(retrieved!.content).toBe(big)
        expect(retrieved!.truncated).toBe(true)
        expect(retrieved!.size).toBe(big.length)
      }),
    ),
  )

  it.live("preserves full content when under threshold", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const small = "small content"
        const entry = yield* store.store("small", small)
        expect(entry.truncated).toBe(false)
        expect(entry.content).toBe(small)

        const retrieved = yield* store.get("small")
        expect(retrieved!.content).toBe(small)
      }),
    ),
  )

  it.live("lists artifacts and filters by prefix", () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.store("alpha", "a")
        yield* store.store("beta", "b")
        yield* store.store("alpha-extra", "a2")

        expect((yield* store.list())).toHaveLength(3)
        expect((yield* store.list("alpha"))).toHaveLength(2)
        expect((yield* store.list("gamma"))).toHaveLength(0)
      }),
    ),
  )

  it.live("returns null for missing keys", () =>
    withStore((store) =>
      Effect.gen(function* () {
        expect(yield* store.get("nonexistent")).toBeNull()
      }),
    ),
  )

  it.live("returns null for missing version", () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.store("key", "hello")
        expect(yield* store.get("key", 99)).toBeNull()
      }),
    ),
  )

  it.live("handles empty content", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const entry = yield* store.store("empty", "")
        expect(entry.size).toBe(0)
        expect(entry.truncated).toBe(false)
        expect(entry.content).toBe("")

        const retrieved = yield* store.get("empty")
        expect(retrieved?.content).toBe("")
      }),
    ),
  )

  it.live("stores overflow to disk and reconstructs on get", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const big = "x".repeat(Artifact.DEFAULT_TRUNCATION_THRESHOLD + 50)
        yield* store.store("overflow-test", big)

        const retrieved = yield* store.get("overflow-test")
        expect(retrieved).not.toBeNull()
        expect(retrieved!.content).toBe(big)
      }),
    ),
  )

  it.live("respects custom truncation threshold", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        const tinyThreshold = 5
        const baseDir = path.join(tmp.path, "custom-threshold")
        const artifactLayer = Artifact.layer(baseDir, tinyThreshold).pipe(
          Layer.provide(NodeFileSystem.layer),
        )
        return Effect.gen(function* () {
          const store = yield* Artifact.Service
          const entry = yield* store.store("tiny", "hello world")
          expect(entry.truncated).toBe(true)
          expect(entry.content).toBe("hello")

          const retrieved = yield* store.get("tiny")
          expect(retrieved!.content).toBe("hello world")
        }).pipe(Effect.provide(artifactLayer))
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})
