import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { Learning } from "../../src/session/learning/learning"
import { SessionID } from "../../src/session/schema"

const it = testEffect(Learning.defaultLayer)

describe("LearningReview", () => {
  it.effect("review returns void when disabled (default)", () =>
    Effect.gen(function* () {
      const svc = yield* Learning.Service
      const result = yield* svc.review({
        sessionID: SessionID.descending("ses_test"),
        trigger: "turn_complete",
        userMessage: "hello",
        assistantMessage: "hi there",
        agent: "build",
        providerID: "test",
        modelID: "test-model",
      })
      expect(result).toBeUndefined()
    }),
  )
})
