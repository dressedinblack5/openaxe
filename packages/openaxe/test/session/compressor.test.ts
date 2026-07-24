import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { Compressor } from "../../src/session/compressor/compressor"
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
})
