import { Memory } from "@opencode-ai/core/memory"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const memoryHandlers = HttpApiBuilder.group(InstanceHttpApi, "memory", (handlers) =>
  Effect.gen(function* () {
    const memory = yield* Memory.Service

    const list = Effect.fn("MemoryHttpApi.list")(function* () {
      return yield* memory.list()
    })

    const set = Effect.fn("MemoryHttpApi.set")(function* (ctx: {
      payload: { key: string; value: unknown; scope?: string; source?: string }
    }) {
      yield* memory.set(ctx.payload.key, ctx.payload.value, ctx.payload.scope, ctx.payload.source)
      const value = yield* memory.get(ctx.payload.key)
      const entries = yield* memory.list()
      const entry = entries.find((e) => e.key === ctx.payload.key)
      return {
        key: ctx.payload.key,
        value,
        kind: entry?.kind ?? "general",
        scope: entry?.scope ?? "session",
        source: entry?.source ?? "agent",
      }
    })

    const get = Effect.fn("MemoryHttpApi.get")(function* (ctx: { params: { key: string } }) {
      return yield* memory.get(ctx.params.key)
    })

    const remove = Effect.fn("MemoryHttpApi.remove")(function* (ctx: { params: { key: string } }) {
      yield* memory.remove(ctx.params.key)
      return { removed: true }
    })

    return handlers.handle("list", list).handle("set", set).handle("get", get).handle("remove", remove)
  }),
)
