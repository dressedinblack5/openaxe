import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { Tool } from "@opencode-ai/core/public"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolSearchTool } from "@opencode-ai/core/tool/tool-search"
import { testEffect } from "./lib/effect"
import { toolIdentity, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_tool_search_test")

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.void,
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const withTool = <A, E, R>(body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>) => {
  const registry = ToolRegistry.defaultLayer
  const toolSearch = ToolSearchTool.layer.pipe(Layer.provide(registry), Layer.provide(permission))
  return Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(Effect.provide(Layer.mergeAll(registry, toolSearch, permission)))
}

const call = (input: typeof ToolSearchTool.Input.Type, id = "call-tool-search") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "tool_search", input },
})

const it = testEffect(Layer.empty)

const stubTool = (name: string, description: string) =>
  Tool.make({
    description,
    input: Schema.Struct({}),
    output: Schema.Struct({}),
    execute: () => Effect.succeed({}),
  })

describe("ToolSearchTool", () => {
  it.effect("registers tool_search as a canonical tool", () =>
    withTool((registry) =>
      Effect.gen(function* () {
        expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual(["tool_search"])
      }),
    ),
  )

  it.effect("finds a tool by name substring", () =>
    withTool((registry) =>
      Effect.gen(function* () {
        yield* registry.register({ read_file: stubTool("read_file", "Read a file from the project") })
        const found = yield* registry.search("read", 10)
        expect(found.map((tool) => tool.name)).toContain("read_file")
      }),
    ),
  )

  it.effect("scores name matches above description matches", () =>
    withTool((registry) =>
      Effect.gen(function* () {
        yield* registry.register({
          file_writer: stubTool("file_writer", "Write bytes to disk"),
        })
        const found = yield* registry.search("file", 10)
        expect(found[0]?.name).toBe("file_writer")
      }),
    ),
  )

  it.effect("returns an empty list for an unmatched query", () =>
    withTool((registry) =>
      Effect.gen(function* () {
        const found = yield* registry.search("zzz_no_such_tool", 10)
        expect(found).toEqual([])
      }),
    ),
  )

  it.effect("respects the limit", () =>
    withTool((registry) =>
      Effect.gen(function* () {
        yield* registry.register({
          aaa: stubTool("aaa", "first tool"),
          bbb: stubTool("bbb", "second tool"),
        })
        const found = yield* registry.search("", 1)
        expect(found.length).toBe(1)
      }),
    ),
  )

  it.effect("settles an empty-query execution and returns tool names and descriptions", () =>
    withTool((registry) =>
      Effect.gen(function* () {
        yield* registry.register({ gizmo: stubTool("gizmo", "turns widgets into gizmos") })
        const settled = yield* registry
          .materialize()
          .pipe(
            Effect.flatMap((materialized) =>
              materialized.settle(call({ query: "gizmo", limit: 10 }, "call-tool-search-gizmo")),
            ),
          )
        expect(settled.result.type).toBe("json")
        expect(settled.result.value).toEqual([{ name: "gizmo", description: "turns widgets into gizmos" }])
      }),
    ),
  )
})
