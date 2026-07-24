import { Effect, Layer, Context, Schema, Option } from "effect"
import { Config } from "@/config/config"
import { SessionID } from "@/session/schema"

// ponytail: structured compressor stub — full LLM-driven compression with ghost-skill re-injection

export type Section = {
  readonly title: string
  readonly content: string
}

export const CompressInput = Schema.Struct({
  sessionID: SessionID,
  messages: Schema.String,
  skills: Schema.Array(Schema.String),
  providerID: Schema.String,
  modelID: Schema.String,
})
export type CompressInput = Schema.Schema.Type<typeof CompressInput>

export type CompressResult = {
  readonly sections: Section[]
  readonly summary: string
  readonly ghostSkills: string[]
}

export interface Interface {
  readonly compress: (input: CompressInput) => Effect.Effect<CompressResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Compressor") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    // ponytail: all optional deps resolved inside compress(), not here,
    // so the layer has no requirements — easier to test and compose.

    const compress = Effect.fn("Compressor.compress")(function* (input: CompressInput) {
      const config = yield* Effect.serviceOption(Config.Service)
      const cfg = Option.isSome(config) ? yield* config.value.get() : ({ experimental: undefined } as any)
      if (!cfg.experimental?.compressor?.enabled) {
        return { sections: [], summary: "", ghostSkills: [] } satisfies CompressResult
      }

      yield* Effect.logInfo("compressor triggered", {
        sessionID: input.sessionID,
        skillCount: input.skills.length,
      })

      // ponytail: call LLM with structured output schema here
      return {
        sections: [] as Section[],
        summary: "",
        ghostSkills: [] as string[],
      } satisfies CompressResult
    })

    return Service.of({ compress })
  }),
)

import { LayerNode } from "@opencode-ai/core/effect/layer-node"

export const defaultLayer = layer

export const node = LayerNode.make(layer, [])

export * as Compressor from "./compressor"
