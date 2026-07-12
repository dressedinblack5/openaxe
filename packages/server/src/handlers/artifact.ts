import { Artifact } from "@opencode-ai/core/artifact"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const ArtifactHandler = HttpApiBuilder.group(Api, "server.artifact", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Artifact.Service
    return handlers
      .handle("artifact.list", (ctx) => svc.list(ctx.query.keyPrefix))
      .handle("artifact.getLatest", (ctx) => svc.get(ctx.params.key).pipe(Effect.map((e) => e ?? undefined)))
      .handle("artifact.getVersion", (ctx) =>
        svc.get(ctx.params.key, ctx.params.version).pipe(Effect.map((e) => e ?? undefined)),
      )
      .handle("artifact.store", (ctx) =>
        svc.store(ctx.payload.key, ctx.payload.content),
      )
  }),
)
