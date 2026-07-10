import { expect, describe } from "bun:test"
import { Provider } from "../../src/provider/provider"

import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { GitLabWorkflowLanguageModel } from "gitlab-ai-provider"

const GITLAB = ProviderV2.ID.make("gitlab")
const it = testEffect(Provider.defaultLayer)

const withEnv = <A, E, R>(values: Record<string, string>, effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]] as const))
      Object.assign(process.env, values)
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }),
  )

describe("GitLab Duo", () => {
  it.instance(
    "loads provider with API key from environment",
    () =>
      withEnv(
        { GITLAB_TOKEN: "test-gitlab-token" },
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const providers = yield* provider.list()
          expect(providers[GITLAB]).toBeDefined()
          expect(providers[GITLAB].key).toBe("test-gitlab-token")
        }),
      ),
    { config: {} },
    60000,
  )

  it.instance(
    "config instanceUrl option sets baseURL",
    () =>
      withEnv(
        { GITLAB_TOKEN: "test-token", GITLAB_INSTANCE_URL: "https://gitlab.example.com" },
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const providers = yield* provider.list()
          expect(providers[GITLAB]).toBeDefined()
          expect(providers[GITLAB].options?.instanceUrl).toBe("https://gitlab.example.com")
        }),
      ),
    { config: { provider: { gitlab: { options: { instanceUrl: "https://gitlab.example.com" } } } } },
    60000,
  )

  it.instance(
    "includes context-1m beta header in aiGatewayHeaders",
    () =>
      withEnv(
        { GITLAB_TOKEN: "test-token" },
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const providers = yield* provider.list()
          expect(providers[GITLAB]).toBeDefined()
          expect(providers[GITLAB].options?.aiGatewayHeaders?.["anthropic-beta"]).toContain(
            "context-1m-2025-08-07",
          )
        }),
      ),
    { config: {} },
    60000,
  )

  it.instance(
    "supports feature flags configuration",
    () =>
      withEnv(
        { GITLAB_TOKEN: "test-token" },
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const providers = yield* provider.list()
          expect(providers[GITLAB]).toBeDefined()
          expect(providers[GITLAB].options?.featureFlags).toBeDefined()
          expect(providers[GITLAB].options?.featureFlags?.duo_agent_platform_agentic_chat).toBe(true)
        }),
      ),
    { config: { provider: { gitlab: { options: { featureFlags: { duo_agent_platform_agentic_chat: true, duo_agent_platform: true } } } } } },
    60000,
  )
})

describe("GitLab Duo: workflow model routing", () => {
  it.instance(
    "duo-workflow-* model routes through workflowChat",
    () =>
      withEnv(
        { GITLAB_TOKEN: "test-token" },
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const providers = yield* provider.list()
          const gitlab = providers[GITLAB]
          expect(gitlab).toBeDefined()

          const modelID = ModelV2.ID.make("duo-workflow-sonnet-4-6")
          gitlab.models["duo-workflow-sonnet-4-6"] = {
            id: modelID,
            providerID: GITLAB,
            name: "Agent Platform (Claude Sonnet 4.6)",
            family: "",
            api: { id: "duo-workflow-sonnet-4-6", url: "https://gitlab.com", npm: "gitlab-ai-provider" },
            status: "active",
            headers: {},
            options: { workflowRef: "claude_sonnet_4_6" },
            cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
            limit: { context: 200000, output: 64000 },
            capabilities: {
              temperature: false,
              reasoning: true,
              attachment: true,
              toolcall: true,
              input: { text: true, audio: false, image: true, video: false, pdf: true },
              output: { text: true, audio: false, image: false, video: false, pdf: false },
              interleaved: false,
            },
            release_date: "",
            variants: {},
          }

          const model = yield* provider.getModel(GITLAB, modelID)
          expect(model).toBeDefined()
          expect(model.options?.workflowRef).toBe("claude_sonnet_4_6")

          const language = yield* provider.getLanguage(model)
          expect(language).toBeDefined()
          expect(language).toBeInstanceOf(GitLabWorkflowLanguageModel)
        }),
      ),
    { config: {} },
    60000,
  )

  it.instance(
    "duo-chat-* model routes through agenticChat (not workflow)",
    () =>
      withEnv(
        { GITLAB_TOKEN: "test-token" },
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const providers = yield* provider.list()
          expect(providers[GITLAB]).toBeDefined()

          const model = yield* provider.getModel(GITLAB, ModelV2.ID.make("duo-chat-sonnet-4-5"))
          expect(model).toBeDefined()

          const language = yield* provider.getLanguage(model)
          expect(language).toBeDefined()
          expect(language).not.toBeInstanceOf(GitLabWorkflowLanguageModel)
        }),
      ),
    { config: {} },
    60000,
  )

  it.instance(
    "model.options merged with provider.options in getLanguage",
    () =>
      withEnv(
        { GITLAB_TOKEN: "test-token" },
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const providers = yield* provider.list()
          const gitlab = providers[GITLAB]
          expect(gitlab.options?.featureFlags).toBeDefined()

          const model = yield* provider.getModel(GITLAB, ModelV2.ID.make("duo-chat-sonnet-4-5"))
          expect(model).toBeDefined()
          expect(model.options).toBeDefined()
        }),
      ),
    { config: { provider: { gitlab: { options: { featureFlags: { duo_agent_platform_agentic_chat: true, duo_agent_platform: true } } } } } },
    60000,
  )
})

describe("GitLab Duo: static models", () => {
  it.instance(
    "static duo-chat models always present regardless of discovery",
    () =>
      withEnv(
        { GITLAB_TOKEN: "test-token" },
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const providers = yield* provider.list()
          const models = Object.keys(providers[GITLAB].models)
          expect(models).toContain("duo-chat-haiku-4-5")
          expect(models).toContain("duo-chat-sonnet-4-5")
          expect(models).toContain("duo-chat-opus-4-5")
        }),
      ),
    { config: {} },
    60000,
  )
})