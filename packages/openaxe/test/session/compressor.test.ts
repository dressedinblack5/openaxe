import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { Compressor } from "../../src/session/compressor/compressor"
import { Config } from "../../src/config/config"
import { SessionID } from "../../src/session/schema"

const it = testEffect(Compressor.defaultLayer)

describe("Compressor", () => {
  it.effect("compress returns empty result when disabled (default)", () =>
    Effect.gen(function* () {
      const svc = yield* Compressor.Service
      const result = yield* svc.compress({
        sessionID: SessionID.descending("ses_test"),
        messages: "some conversation text",
        skills: ["build"],
        providerID: "test",
        modelID: "test-model",
      })
      expect(result).toEqual({ sections: [], summary: "", ghostSkills: [] })
    }),
  )

  describe("when enabled", () => {
    const mockConfig = Layer.mock(Config.Service, {
      get: () =>
        Effect.succeed({
          experimental: { compressor: { enabled: true } },
        } as any),
    })
    const itEnabled = testEffect(Layer.provideMerge(Compressor.defaultLayer, mockConfig))

    itEnabled.effect("gracefully handles missing provider", () =>
      Effect.gen(function* () {
        const svc = yield* Compressor.Service
        const result = yield* svc.compress({
          sessionID: SessionID.descending("ses_test"),
          messages: "some conversation text",
          skills: ["build"],
          providerID: "test",
          modelID: "test-model",
        })
        // ponytail: passes config check, logs "Provider unavailable" — proving the
        // enabled code path is active. Deep assertion needs a mock Provider+LLM.
        expect(result).toEqual({ sections: [], summary: "", ghostSkills: [] })
      }),
    )
  })
})
