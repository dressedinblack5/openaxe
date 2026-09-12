import { describe, expect, mock } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { Config } from "../../src/config/config"
import { SessionID } from "../../src/session/schema"
import { Provider } from "@/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import fs from "fs"
import path from "path"
import { Global } from "@opencode-ai/core/global"

let llmCalls = 0
void mock.module("ai", () => ({
  generateText: async (_args: {
    model: unknown
    system: string
    prompt: string
    temperature: number
  }) => {
    llmCalls++
    return {
      text: JSON.stringify({
        skillUpdates: [
          {
            name: "gate-skill",
            description: "Gate test skill",
            reasoning: "Gate test reasoning",
            content: "Gate test content",
          },
        ],
        observations: [{ key: "gate-key", value: "gate-value" }],
      }),
      finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 10 },
    }
  },
}))

// Import AFTER the mock so the learning module picks up the stubbed generateText.
const { Learning } = await import("../../src/session/learning/learning")
const { GateService, decideLearnable, resetGateCache } = await import("../../src/session/learning/gate")

const mockConfigGate = (gate: unknown) =>
  Layer.mock(Config.Service, {
    get: () =>
      Effect.succeed({
        experimental: { learning: { review: true, gate } },
      } as any),
  })

const mockProvider = Layer.mock(Provider.Service, {
  getModel: () =>
    Effect.succeed({
      id: ModelV2.ID.make("test-model"),
      providerID: ProviderV2.ID.make("test"),
    } as any),
  getLanguage: () =>
    Effect.succeed({
      specificationVersion: "v3.1" as const,
      provider: "test",
      modelId: "test-model",
      async doGenerate() {
        return {
          text: JSON.stringify({ skillUpdates: [], observations: [] }),
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 10 },
        }
      },
    } as any),
})

const jsonlPath = () => path.join(Global.Path.data, "learning", "reviews.jsonl")
const cleanJsonl = () => {
  if (fs.existsSync(jsonlPath())) fs.unlinkSync(jsonlPath())
}

describe("LearningGate", () => {
  describe("loadGateModel cache", () => {
    let loads = 0
    const countingGate = Layer.succeed(GateService, {
      load: () => {
        loads++
        return Effect.succeed({
          predict: () => Effect.succeed({ learnable: true, confidence: 0.9 }),
        })
      },
    })
    const itCache = testEffect(countingGate)

    itCache.effect("loads the model once across repeated decisions", () =>
      Effect.gen(function* () {
        resetGateCache()
        loads = 0
        yield* decideLearnable("hello", "hi there", "model/cache-test.tflite")
        yield* decideLearnable("hello again", "hi again", "model/cache-test.tflite")
        expect(loads).toBe(1)
        resetGateCache()
      }),
    )
  })

  describe("low confidence skips LLM", () => {
    const lowGate = Layer.succeed(GateService, {
      load: () =>
        Effect.succeed({
          predict: () => Effect.succeed({ learnable: false, confidence: 0 }),
        }),
    })
    const itLow = testEffect(
      Layer.mergeAll(Learning.layer, mockProvider, lowGate, mockConfigGate({ enabled: true, threshold: 0.5 })),
    )

    itLow.effect("skips the LLM review when confidence is below threshold", () =>
      Effect.gen(function* () {
        resetGateCache()
        cleanJsonl()
        llmCalls = 0
        const svc = yield* Learning.Service
        const result = yield* svc.review({
          sessionID: SessionID.descending("ses_gate_low"),
          trigger: "turn_complete",
          userMessage: "hello",
          assistantMessage: "hi there",
          agent: "build",
          providerID: "test",
          modelID: "test-model",
        })
        expect(result).toBeUndefined()
        expect(llmCalls).toBe(0)
        expect(fs.existsSync(jsonlPath())).toBe(false)
        resetGateCache()
      }),
    )
  })

  describe("high confidence proceeds to LLM", () => {
    const highGate = Layer.succeed(GateService, {
      load: () =>
        Effect.succeed({
          predict: () => Effect.succeed({ learnable: true, confidence: 0.9 }),
        }),
    })
    const itHigh = testEffect(
      Layer.mergeAll(Learning.layer, mockProvider, highGate, mockConfigGate({ enabled: true, threshold: 0.5 })),
    )

    itHigh.effect("falls through to the LLM review when confidence meets threshold", () =>
      Effect.gen(function* () {
        resetGateCache()
        cleanJsonl()
        llmCalls = 0
        const svc = yield* Learning.Service
        const result = yield* svc.review({
          sessionID: SessionID.descending("ses_gate_high"),
          trigger: "turn_complete",
          userMessage: "I need to learn X",
          assistantMessage: "Here is how to do X",
          agent: "build",
          providerID: "test",
          modelID: "test-model",
        })
        expect(result).toBeUndefined()
        expect(llmCalls).toBe(1)
        const entries = yield* svc.read()
        expect(entries).toHaveLength(1)
        expect(entries[0].sessionID).toBe("ses_gate_high")
        cleanJsonl()
        resetGateCache()
      }),
    )
  })
})
