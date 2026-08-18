import { Effect, Layer, Context, Ref } from "effect"
import { Config } from "@/config/config"
import { SessionID } from "./schema"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

export interface TokenEstimate {
  readonly serverReported: number
  readonly estimatedDelta: number
  readonly confidence: number
  readonly lastAnchor: number
}

export interface Interface {
  readonly getEstimate: (sessionID: SessionID) => Effect.Effect<TokenEstimate>
  readonly anchor: (sessionID: SessionID, tokens: number) => Effect.Effect<void>
  readonly recordUsage: (
    sessionID: SessionID,
    usage: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number },
  ) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/TokenEstimator") {}

const makeState = (_sessionID: SessionID) => ({
  serverReported: 0,
  estimatedDelta: 0,
  lastAnchor: 0,
  messageCountSinceAnchor: 0,
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const stateRef = yield* Ref.make<Map<string, ReturnType<typeof makeState>>>(new Map())

    const getOrCreateState = (sessionID: SessionID) =>
      Ref.modify(stateRef, (map) => {
        const existing = map.get(sessionID)
        if (existing) return [existing, map]
        const newState = makeState(sessionID)
        const next = new Map(map).set(sessionID, newState)
        return [newState, next]
      })

    const getEstimate = Effect.fn("TokenEstimator.getEstimate")(function* (sessionID: SessionID) {
      const cfg = yield* config.get()
      const enabled = cfg.compaction?.cacheAware?.enabled ?? true

      if (!enabled) {
        return { serverReported: 0, estimatedDelta: 0, confidence: 0, lastAnchor: 0 }
      }

      const state = yield* getOrCreateState(sessionID)
      const confidence = Math.max(0, 1 - state.messageCountSinceAnchor * 0.1)

      return {
        serverReported: state.serverReported,
        estimatedDelta: state.estimatedDelta,
        confidence,
        lastAnchor: state.lastAnchor,
      }
    })

    const anchor = Effect.fn("TokenEstimator.anchor")(function* (sessionID: SessionID, tokens: number) {
      const cfg = yield* config.get()
      const enabled = cfg.compaction?.cacheAware?.enabled ?? true

      if (!enabled) return

      yield* Ref.update(stateRef, (map) => {
        const next = new Map(map)
        const state = next.get(sessionID) ?? makeState(sessionID)
        state.serverReported = tokens
        state.estimatedDelta = 0
        state.lastAnchor = Date.now()
        state.messageCountSinceAnchor = 0
        next.set(sessionID, state)
        return next
      })
    })

    const recordUsage = Effect.fn("TokenEstimator.recordUsage")(function* (
      sessionID: SessionID,
      usage: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number },
    ) {
      const cfg = yield* config.get()
      const enabled = cfg.compaction?.cacheAware?.enabled ?? true

      if (!enabled) return

      const total = (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)

      yield* Ref.update(stateRef, (map) => {
        const next = new Map(map)
        const state = next.get(sessionID) ?? makeState(sessionID)
        state.serverReported = total
        state.estimatedDelta = 0
        state.lastAnchor = Date.now()
        state.messageCountSinceAnchor = 0
        next.set(sessionID, state)
        return next
      })
    })

    return Service.of({ getEstimate, anchor, recordUsage })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))

export const node = LayerNode.make(layer, [Config.node])

export * as TokenEstimator from "./token-estimator"
