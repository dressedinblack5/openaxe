export * as MemoryTool from "./memory"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Option, Schema } from "effect"
import { Memory } from "../memory"
import { WorkspaceMemory } from "../memory/workspace-memory"
import { PermissionV2 } from "../permission"
import { PositiveInt } from "../schema"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "memory"

export const Namespace = Schema.Literals(["assistant", "shell", "workspace"])
export const Operation = Schema.Literals(["set", "get", "delete", "search", "list"])

export const Input = Schema.Struct({
  operation: Operation,
  namespace: Namespace,
  key: Schema.optional(Schema.String),
  value: Schema.optional(Schema.String),
  query: Schema.optional(Schema.String),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(50))),
})

export const SearchHit = Schema.Struct({
  key: Schema.String,
  value: Schema.String,
  score: Schema.Number,
})

export const Output = Schema.Union([
  Schema.Struct({ ok: Schema.Boolean }),
  Schema.Struct({ value: Schema.NullOr(Schema.String) }),
  Schema.Struct({ results: Schema.Array(SearchHit) }),
  Schema.Struct({ keys: Schema.Array(Schema.String) }),
])

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const permission = yield* PermissionV2.Service
    const memory = yield* Memory.Service
    const workspaceMemory = yield* WorkspaceMemory.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Store and retrieve memory entries scoped by namespace. Namespaces: 'workspace' (persistent, project-scoped, supports semantic search — use for cross-session context), 'assistant' and 'shell' (ephemeral key-value memory for the current conversation). Operations: set (store key/value), get (read by key), delete (remove by key), search (query with optional limit; semantic for workspace, substring match for assistant/shell), list (all keys in the namespace).",
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: [],
                save: ["*"],
                metadata: { operation: input.operation, namespace: input.namespace },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })

              if (input.namespace === "workspace") {
                switch (input.operation) {
                  case "set": {
                    if (!input.key || input.value === undefined)
                      return yield* Effect.fail(new ToolFailure({ message: "memory set requires key and value" }))
                    yield* workspaceMemory.set(input.key, input.value)
                    return { ok: true }
                  }
                  case "get": {
                    if (!input.key) return yield* Effect.fail(new ToolFailure({ message: "memory get requires a key" }))
                    const value = yield* workspaceMemory.get(input.key)
                    return { value: Option.getOrNull(value) }
                  }
                  case "delete": {
                    if (!input.key)
                      return yield* Effect.fail(new ToolFailure({ message: "memory delete requires a key" }))
                    yield* workspaceMemory.delete(input.key)
                    return { ok: true }
                  }
                  case "search": {
                    if (!input.query)
                      return yield* Effect.fail(new ToolFailure({ message: "memory search requires a query" }))
                    const results = yield* workspaceMemory.search(input.query, input.limit ?? 10)
                    return { results }
                  }
                  case "list":
                    return { keys: yield* workspaceMemory.list() }
                }
              }

              // assistant | shell — existing global memory store, scoped by namespace
              switch (input.operation) {
                case "set": {
                  if (!input.key || input.value === undefined)
                    return yield* Effect.fail(new ToolFailure({ message: "memory set requires key and value" }))
                  yield* memory.set(input.key, input.value, undefined, input.namespace)
                  return { ok: true }
                }
                case "get": {
                  if (!input.key) return yield* Effect.fail(new ToolFailure({ message: "memory get requires a key" }))
                  const value = yield* memory.get(input.key)
                  return { value: value === null ? null : typeof value === "string" ? value : JSON.stringify(value) }
                }
                case "delete": {
                  if (!input.key)
                    return yield* Effect.fail(new ToolFailure({ message: "memory delete requires a key" }))
                  yield* memory.remove(input.key)
                  return { ok: true }
                }
                case "search": {
                  if (!input.query)
                    return yield* Effect.fail(new ToolFailure({ message: "memory search requires a query" }))
                  const query = input.query.toLowerCase()
                  const entries = yield* memory.list(undefined, input.namespace)
                  const results = entries
                    .filter(
                      (entry) =>
                        entry.key.toLowerCase().includes(query) || String(entry.value).toLowerCase().includes(query),
                    )
                    .slice(0, input.limit ?? 10)
                    .map((entry) => ({ key: entry.key, value: String(entry.value), score: 0 }))
                  return { results }
                }
                case "list": {
                  const entries = yield* memory.list(undefined, input.namespace)
                  return { keys: entries.map((entry) => entry.key) }
                }
                default:
                  return yield* Effect.fail(new ToolFailure({ message: "memory unknown operation" }))
              }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure ? error : new ToolFailure({ message: `memory ${input.operation} failed` }),
              ),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
