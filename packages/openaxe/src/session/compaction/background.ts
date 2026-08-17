import { Effect, Layer, Context, Ref, Deferred, Option } from "effect"
import { SessionID } from "@/session/schema"
import { Compressor } from "@/session/compressor/compressor"
import type { CompressInput, CompressResult } from "@/session/compressor/compressor"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

export type BuildResult = {
  readonly result: CompressResult
  readonly source: "checkpoint" | "fresh"
}

export interface Interface {
  readonly checkpoint: (input: CompressInput) => Effect.Effect<void>
  readonly getOrBuild: (input: CompressInput) => Effect.Effect<BuildResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/BackgroundCompaction") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const compressor = yield* Effect.serviceOption(Compressor.Service)
    const cache = yield* Ref.make(
      new Map<SessionID, { messages: string; deferred: Deferred.Deferred<CompressResult> }>(),
    )

    const build = Effect.fn("BackgroundCompaction.build")(function* (input: CompressInput) {
      if (Option.isSome(compressor)) return yield* compressor.value.compress(input)
      return { sections: [], summary: "", ghostSkills: [] }
    })

    const checkpoint = Effect.fn("BackgroundCompaction.checkpoint")(function* (input: CompressInput) {
      const existing = yield* Ref.get(cache).pipe(Effect.map((m) => m.get(input.sessionID)))
      if (existing?.messages === input.messages) return
      const deferred = yield* Deferred.make<CompressResult>()
      yield* Ref.update(cache, (m) => new Map(m).set(input.sessionID, { messages: input.messages, deferred }))
      const result = yield* build(input)
      yield* Deferred.succeed(deferred, result)
    })

    const getOrBuild = Effect.fn("BackgroundCompaction.getOrBuild")(function* (input: CompressInput) {
      const existing = yield* Ref.get(cache).pipe(Effect.map((m) => m.get(input.sessionID)))
      if (existing?.messages === input.messages) {
        return { result: yield* Deferred.await(existing.deferred), source: "checkpoint" as const }
      }
      const deferred = yield* Deferred.make<CompressResult>()
      yield* Ref.update(cache, (m) => new Map(m).set(input.sessionID, { messages: input.messages, deferred }))
      const result = yield* build(input)
      yield* Deferred.succeed(deferred, result)
      return { result, source: "fresh" as const }
    })

    return Service.of({ checkpoint, getOrBuild })
  }),
)

export const defaultLayer = layer

export const node = LayerNode.make(layer, [Compressor.node])

export * as BackgroundCompaction from "./background"
