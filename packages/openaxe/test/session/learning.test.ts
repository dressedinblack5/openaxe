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

// learning.ts calls generateText from "ai" directly (provider.getLanguage only
// resolves the model handle), so fenced responses are simulated here.
let fencedResponse = false
void mock.module("ai", () => ({
  generateText: async (_args: {
    model: unknown
    system: string
    prompt: string
    temperature: number
  }) => {
    const payload = JSON.stringify({
      skillUpdates: [
        {
          name: "test-skill",
          description: "Test skill",
          reasoning: "Test reasoning",
          content: "Test content",
        },
      ],
      observations: [{ key: "test-key", value: "test-value" }],
    })
    return {
      text: fencedResponse ? "```json\n" + payload + "\n```" : payload,
      finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 10 },
    }
  },
}))

// Import Learning AFTER the mock so the learning module picks up the stubbed generateText.
const { Learning, extractJsonPayload } = await import("../../src/session/learning/learning")

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

  describe("when enabled", () => {
    const mockConfig = Layer.mock(Config.Service, {
      get: () =>
        Effect.succeed({
          experimental: { learning: { review: true } },
        } as any),
    })
    const itEnabled = testEffect(Layer.provideMerge(Learning.defaultLayer, mockConfig))

    itEnabled.effect("gracefully handles missing provider", () =>
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
              text: JSON.stringify({
                skillUpdates: [
                  {
                    name: "test-skill",
                    description: "Test skill",
                    reasoning: "Test reasoning",
                    content: "Test content",
                  },
                ],
                observations: [{ key: "test-key", value: "test-value" }],
              }),
              finishReason: "stop",
              usage: { promptTokens: 10, completionTokens: 10 },
            }
          },
        } as any),
    })

    const itPipeline = testEffect(
      Layer.provideMerge(Learning.defaultLayer, Layer.mergeAll(mockConfig, mockProvider)),
    )

    itPipeline.effect("parses markdown-fenced JSON responses", () =>
      Effect.gen(function* () {
        expect(extractJsonPayload('{"a":1}')).toBe('{"a":1}')
        expect(extractJsonPayload('```json\n{"a":1}\n```')).toBe('{"a":1}')
        expect(extractJsonPayload('```\n{"a":1}\n```')).toBe('{"a":1}')
        expect(extractJsonPayload('  ```json\n{"a":1}\n```  ')).toBe('{"a":1}')
      }),
    )

    const itFenced = testEffect(
      Layer.provideMerge(Learning.defaultLayer, Layer.mergeAll(mockConfig, mockProvider)),
    )

    itFenced.effect("persists reviews from fenced LLM responses", () =>
      Effect.gen(function* () {
        const jsonlPath = path.join(Global.Path.data, "learning", "reviews.jsonl")
        if (fs.existsSync(jsonlPath)) fs.unlinkSync(jsonlPath)

        fencedResponse = true
        try {
          const svc = yield* Learning.Service
          const result = yield* svc.review({
            sessionID: SessionID.descending("ses_fenced"),
            trigger: "turn_complete",
            userMessage: "I need to learn Y",
            assistantMessage: "Here is how to do Y",
            agent: "build",
            providerID: "test",
            modelID: "test-model",
          })
          expect(result).toBeUndefined()

          const entries = yield* svc.read()
          expect(entries).toHaveLength(1)
          expect(entries[0].sessionID).toBe("ses_fenced")
          expect(entries[0].skills[0].name).toBe("test-skill")
        } finally {
          fencedResponse = false
          if (fs.existsSync(jsonlPath)) fs.unlinkSync(jsonlPath)
        }
      }),
    )

    itPipeline.effect("calls LLM and persists skill updates and observations", () =>
      Effect.gen(function* () {
        const jsonlPath = path.join(Global.Path.data, "learning", "reviews.jsonl")
        if (fs.existsSync(jsonlPath)) fs.unlinkSync(jsonlPath)

        const svc = yield* Learning.Service
        const result = yield* svc.review({
          sessionID: SessionID.descending("ses_pipeline"),
          trigger: "turn_complete",
          userMessage: "I need to learn X",
          assistantMessage: "Here is how to do X",
          agent: "build",
          providerID: "test",
          modelID: "test-model",
        })
        expect(result).toBeUndefined()

        const entries = yield* svc.read()
        expect(entries).toHaveLength(1)
        expect(entries[0].sessionID).toBe("ses_pipeline")
        expect(entries[0].trigger).toBe("turn_complete")
        expect(entries[0].skills).toHaveLength(1)
        expect(entries[0].skills[0].name).toBe("test-skill")
        expect(entries[0].observations).toHaveLength(1)
        expect(entries[0].observations[0].key).toBe("test-key")
      }),
    )
  })

  describe("read", () => {
    const mockConfig = Layer.mock(Config.Service, {
      get: () =>
        Effect.succeed({
          experimental: { learning: { review: true } },
        } as any),
    })
    const itRead = testEffect(Layer.provideMerge(Learning.defaultLayer, mockConfig))

    itRead.effect("returns persisted entries", () =>
      Effect.gen(function* () {
        const jsonlPath = path.join(Global.Path.data, "learning", "reviews.jsonl")
        const testEntries = [
          {
            time: Date.now(),
            sessionID: "ses_read_test",
            trigger: "turn_complete" as const,
            agent: "build",
            skills: [{ name: "read-skill", description: "Read test", reasoning: "Test", content: "Content" }],
            observations: [{ key: "read-key", value: "read-value" }],
          },
        ]
        fs.mkdirSync(path.join(Global.Path.data, "learning"), { recursive: true })
        fs.writeFileSync(jsonlPath, testEntries.map((e) => JSON.stringify(e) + "\n").join(""))

        const svc = yield* Learning.Service
        const entries = yield* svc.read()
        expect(entries).toHaveLength(1)
        expect(entries[0].sessionID).toBe("ses_read_test")
        expect(entries[0].skills[0].name).toBe("read-skill")

        fs.unlinkSync(jsonlPath)
      }),
    )

    itRead.effect("returns empty array when no file exists", () =>
      Effect.gen(function* () {
        const jsonlPath = path.join(Global.Path.data, "learning", "reviews.jsonl")
        if (fs.existsSync(jsonlPath)) fs.unlinkSync(jsonlPath)

        const svc = yield* Learning.Service
        const entries = yield* svc.read()
        expect(entries).toEqual([])
      }),
    )
  })
})
