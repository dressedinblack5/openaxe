import { Memory } from "@opencode-ai/core/memory"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const MemoryHandler = HttpApiBuilder.group(Api, "server.memory", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Memory.Service
    return handlers
      .handle("memory.list", (ctx) => svc.list(ctx.query.kind, ctx.query.scope, ctx.query.source))
      .handle("memory.get", (ctx) => svc.get(ctx.params.key))
  }),
)
