import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Memory } from "@opencode-ai/core/memory"
import { testEffect } from "../lib/effect"

const it = testEffect(Memory.defaultLayer)

describe("MemoryStore", () => {
  it.effect("stores and retrieves a value by key", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      yield* memory.set("greeting", "hello world")
      expect(yield* memory.get("greeting")).toBe("hello world")
    }),
  )

  it.effect("returns null for a missing key", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      expect(yield* memory.get("nonexistent")).toBeNull()
    }),
  )

  it.effect("overwrites an existing key on set", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      yield* memory.set("key", "first")
      yield* memory.set("key", "second")
      expect(yield* memory.get("key")).toBe("second")
    }),
  )

  it.effect("removes a stored key", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      yield* memory.set("temp", "value")
      yield* memory.remove("temp")
      expect(yield* memory.get("temp")).toBeNull()
    }),
  )

  it.effect("stores and retrieves complex objects", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      const obj = { foo: [1, 2, 3], bar: { nested: true } }
      yield* memory.set("complex", obj)
      expect(yield* memory.get("complex")).toEqual(obj)
    }),
  )

  it.effect("lists all entries", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      yield* memory.set("a", 1)
      yield* memory.set("b", 2)
      const entries = yield* memory.list()
      expect(entries).toHaveLength(2)
      expect(entries.find((e) => e.key === "a")?.value).toBe(1)
      expect(entries.find((e) => e.key === "b")?.value).toBe(2)
    }),
  )

  it.effect("lists entries filtered by kind", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      // Default kind is "general"
      yield* memory.set("note1", "hello")
      yield* memory.set("note2", "world")
      const general = yield* memory.list("general")
      expect(general).toHaveLength(2)
      const other = yield* memory.list("other")
      expect(other).toHaveLength(0)
    }),
  )
})
