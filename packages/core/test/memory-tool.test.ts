import { describe, expect } from "bun:test"
import path from "node:path"
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { Embedding } from "@opencode-ai/core/embedding/embedding"
import { Memory } from "@opencode-ai/core/memory"
import { WorkspaceMemory } from "@opencode-ai/core/memory/workspace-memory"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { MemoryTool } from "@opencode-ai/core/tool/memory"
import { testEffect } from "./lib/effect"
import { settleTool, toolDefinitions, toolIdentity } from "./lib/tool"
import { tmpdir } from "./fixture/tmpdir"

const alphabet = "abcdefghijklmnopqrstuvwxyz"
const bagOfWords = (text: string) => {
  const dims = Array.from({ length: alphabet.length }, () => 0)
  for (const ch of text.toLowerCase()) {
    const index = alphabet.indexOf(ch)
    if (index >= 0) dims[index] += 1
  }
  return dims
}

const fakeEmbedding = Layer.succeed(
  Embedding.Service,
  Embedding.Service.of({
    provider: { model: "fake", dimension: alphabet.length, embed: () => Effect.succeed({ vectors: [], dimension: alphabet.length, model: "fake" }) },
    embed: (texts) =>
      Effect.sync(() => ({
        vectors: [...texts].map((text) => bagOfWords(text)),
        dimension: alphabet.length,
        model: "fake",
      })),
  }),
)

const sessionID = SessionV2.ID.make("ses_memory_tool_test")
const assertions: PermissionV2.AssertInput[] = []

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) => Effect.sync(() => assertions.push(input)),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const withTool = <A, E, R>(body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const dir = await tmpdir()
      const file = path.join(dir.path, "memory-tool.sqlite")
      const db = Database.layerFromPath(file)
      const registry = ToolRegistry.defaultLayer.pipe(Layer.provide(permission))
      const memoryTool = MemoryTool.layer.pipe(
        Layer.provide(registry),
        Layer.provide(permission),
        Layer.provide(Memory.defaultLayer),
        Layer.provide(WorkspaceMemory.layer.pipe(Layer.provide(db), Layer.provide(fakeEmbedding))),
      )
      return { dir, registry, layer: Layer.mergeAll(registry, memoryTool) }
    }),
    ({ dir }) => Effect.promise(() => dir[Symbol.asyncDispose]()),
  ).pipe(
    Effect.flatMap(({ layer }) =>
      Effect.gen(function* () {
        return yield* body(yield* ToolRegistry.Service)
      }).pipe(Effect.provide(layer)),
    ),
  )

const call = (input: typeof MemoryTool.Input.Type, id = "call-memory") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "memory", input },
})

/** Safely read a field off an unknown structured tool result without type assertions. */
const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined

const it = testEffect(Layer.empty)

describe("MemoryTool", () => {
  it.effect("registers memory as a canonical tool", () =>
    withTool((registry) =>
      Effect.gen(function* () {
        expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toContain("memory")
      }),
    ),
  )

  it.effect("workspace set → get → search → list → delete roundtrip and asserts permission", () =>
    withTool((registry) =>
      Effect.gen(function* () {
        const set = yield* settleTool(
          registry,
          call({ operation: "set", namespace: "workspace", key: "foo", value: "bar" }),
        )
        expect(set.result.type).toBe("json")
        expect(field(set.result.value, "ok")).toBe(true)

        const got = yield* settleTool(registry, call({ operation: "get", namespace: "workspace", key: "foo" }))
        expect(got.result.type).toBe("json")
        expect(field(got.result.value, "value")).toBe("bar")

        const search = yield* settleTool(
          registry,
          call({ operation: "search", namespace: "workspace", query: "bar", limit: 5 }),
        )
        expect(search.result.type).toBe("json")
        const results = field(search.result.value, "results")
        expect(Array.isArray(results)).toBe(true)
        expect(results).toEqual([expect.objectContaining({ key: "foo", value: "bar" })])

        const list = yield* settleTool(registry, call({ operation: "list", namespace: "workspace" }))
        expect(list.result.type).toBe("json")
        expect(field(list.result.value, "keys")).toEqual(["foo"])

        const deleted = yield* settleTool(registry, call({ operation: "delete", namespace: "workspace", key: "foo" }))
        expect(deleted.result.type).toBe("json")
        expect(field(deleted.result.value, "ok")).toBe(true)

        const missing = yield* settleTool(registry, call({ operation: "get", namespace: "workspace", key: "foo" }))
        expect(missing.result.type).toBe("json")
        expect(field(missing.result.value, "value")).toBeNull()

        expect(assertions[0]).toMatchObject({ sessionID, action: "memory", resources: [], save: ["*"] })
        expect(assertions.map((assertion) => assertion.metadata)).toEqual([
          { operation: "set", namespace: "workspace" },
          { operation: "get", namespace: "workspace" },
          { operation: "search", namespace: "workspace" },
          { operation: "list", namespace: "workspace" },
          { operation: "delete", namespace: "workspace" },
          { operation: "get", namespace: "workspace" },
        ])
      }),
    ),
  )

  it.effect("workspace search ranks the most relevant entry first", () =>
    withTool((registry) =>
      Effect.gen(function* () {
        yield* settleTool(
          registry,
          call({ operation: "set", namespace: "workspace", key: "banana", value: "memory about banana smoothies" }),
        )
        yield* settleTool(
          registry,
          call({ operation: "set", namespace: "workspace", key: "cars", value: "totally unrelated car engine facts" }),
        )
        const search = yield* settleTool(
          registry,
          call({ operation: "search", namespace: "workspace", query: "banana", limit: 5 }),
        )
        const results = field(search.result.value, "results") as Array<{ key: string; value: string; score: number }>
        expect(results[0]?.key).toBe("banana")
        expect(results[0]?.value).toBe("memory about banana smoothies")
      }),
    ),
  )

  it.effect("rejects an invalid namespace with a typed error", () =>
    withTool((registry) =>
      Effect.gen(function* () {
        const settled = yield* settleTool(
          registry,
          call({ operation: "set", namespace: "bogus", key: "foo", value: "bar" } as unknown as typeof MemoryTool.Input.Type),
        )
        expect(settled.result.type).toBe("error")
        expect(settled.result.value).toContain("Invalid tool input")
      }),
    ),
  )

  it.effect("workspace get for a missing key returns null, not an error", () =>
    withTool((registry) =>
      Effect.gen(function* () {
        const settled = yield* settleTool(registry, call({ operation: "get", namespace: "workspace", key: "nope" }))
        expect(settled.result.type).toBe("json")
        expect(field(settled.result.value, "value")).toBeNull()
      }),
    ),
  )

  it.effect("assistant namespace keeps working via the global memory store", () =>
    withTool((registry) =>
      Effect.gen(function* () {
        const set = yield* settleTool(
          registry,
          call({ operation: "set", namespace: "assistant", key: "note", value: "remember this" }),
        )
        expect(field(set.result.value, "ok")).toBe(true)
        const got = yield* settleTool(registry, call({ operation: "get", namespace: "assistant", key: "note" }))
        expect(field(got.result.value, "value")).toBe("remember this")
        const list = yield* settleTool(registry, call({ operation: "list", namespace: "assistant" }))
        expect(field(list.result.value, "keys")).toEqual(["note"])
      }),
    ),
  )
})
