import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"
import { Duration, Effect, Layer, Option } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { WorkspaceRouteContext } from "./workspace-routing"

export class InstanceContextMiddleware extends HttpApiMiddleware.Service<
  InstanceContextMiddleware,
  {
    requires: WorkspaceRouteContext | InstanceStore.Service
  }
>()("@opencode/ExperimentalHttpApiInstanceContext") {}

function decode(input: string): string {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function provideInstanceContext<E>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E>,
  store: InstanceStore.Interface,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, WorkspaceRouteContext> {
  return Effect.gen(function* () {
    const route = yield* WorkspaceRouteContext
    console.log("DEBUG middleware: loading store for", route.directory)
    const ctx = yield* store.load({ directory: decode(route.directory) }).pipe(
      Effect.timeoutOption(Duration.seconds(120)),
    )
    console.log("DEBUG middleware: store loaded", Option.isSome(ctx))
    if (Option.isNone(ctx)) {
      return HttpServerResponse.empty({ status: 503 })
    }
    const result = yield* effect.pipe(
      Effect.provideService(InstanceRef, ctx.value),
      Effect.provideService(WorkspaceRef, route.workspaceID),
    )
    console.log("DEBUG middleware: effect completed, status:", result.status)
    return result
  })
}

export const instanceContextLayer = Layer.effect(
  InstanceContextMiddleware,
  Effect.gen(function* () {
    const store = yield* InstanceStore.Service
    return InstanceContextMiddleware.of((effect) =>
      provideInstanceContext(effect, store).pipe(Effect.provideService(InstanceStore.Service, store)),
    )
  }),
)
