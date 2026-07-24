import { Effect, Layer, Context, Schema, Option } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Config } from "@/config/config"
import { SessionID } from "@/session/schema"

// ponytail: learning review stub — full impl with LLM eval for skill/memory updates

export type ReviewTrigger = "turn_complete" | "tool_complete" | "error_recovery"

export const ReviewInput = Schema.Struct({
  sessionID: SessionID,
  trigger: Schema.Literals(["turn_complete", "tool_complete", "error_recovery"]),
  userMessage: Schema.String,
  assistantMessage: Schema.String,
  agent: Schema.String,
  providerID: Schema.String,
  modelID: Schema.String,
})
export type ReviewInput = Schema.Schema.Type<typeof ReviewInput>

export type ReviewResult = {
  readonly skillUpdates: Array<{ name: string; description: string; reasoning: string; content: string }>
  readonly observations: Array<{ key: string; value: string }>
}

export interface Interface {
  readonly review: (input: ReviewInput) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LearningReview") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    // ponytail: all optional deps resolved inside review(), not here,
    // so the layer has no requirements — easier to test and compose.

    const review = Effect.fn("LearningReview.review")(function* (input: ReviewInput) {
      const config = yield* Effect.serviceOption(Config.Service)
      const cfg = Option.isSome(config) ? yield* config.value.get() : ({ experimental: undefined } as any)
      const learning = cfg.experimental?.learning
      if (!learning?.review) return

      // ponytail: placeholder — post-turn learning review.
      // Read user + assistant messages from the session, call an LLM (optionally
      // separate model via learning.model config) to determine if skill updates or
      // observations should be persisted, then apply them via Skill service.
      //
      // Future: auto-patch skills on user corrections (Hermes background_review.py pattern)
      yield* Effect.logInfo("learning review", {
        sessionID: input.sessionID,
        agent: input.agent,
        trigger: input.trigger,
      })
    })

    return Service.of({ review })
  }),
)

export const defaultLayer = layer

export const node = LayerNode.make(layer, [])

export * as Learning from "./learning"
