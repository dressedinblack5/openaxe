import { Effect, Layer, Context, Schema, Option } from "effect"
import { Config } from "@/config/config"
import { SessionID } from "@/session/schema"
import { Provider } from "@/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import fs from "fs"
import path from "path"
import { Global } from "@opencode-ai/core/global"

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

export type ReviewEntry = {
  readonly time: number
  readonly sessionID: string
  readonly trigger: ReviewTrigger
  readonly agent: string
  readonly skills: Array<{ name: string; description: string; reasoning: string; content: string }>
  readonly observations: Array<{ key: string; value: string }>
}

export interface Interface {
  readonly review: (input: ReviewInput) => Effect.Effect<void>
  readonly read: () => Effect.Effect<readonly ReviewEntry[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LearningReview") {}

function chatCompletionsURL(url: string): string {
  const base = (url || "").replace(/\/+$/, "")
  if (base.includes("/chat/completions")) return base
  return `${base.replace(/\/v1\/?$/i, "")}/v1/chat/completions`
}

function getApiKey(info: Provider.Info): string | undefined {
  return typeof info.options.apiKey === "string" ? info.options.apiKey : info.key
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const review = Effect.fn("LearningReview.review")(function* (input: ReviewInput) {
      const config = yield* Effect.serviceOption(Config.Service)
      const cfg = Option.isSome(config) ? yield* config.value.get() : ({ experimental: undefined } as any)
      const learning = cfg.experimental?.learning
      if (!learning?.review) return

      const providerOpt = yield* Effect.serviceOption(Provider.Service)
      if (Option.isNone(providerOpt)) {
        yield* Effect.logInfo("learning: Provider unavailable")
        return
      }
      const provider = providerOpt.value

      const model = yield* provider.getModel(ProviderV2.ID.make(input.providerID), ModelV2.ID.make(input.modelID)).pipe(
        Effect.tapError(() => Effect.logWarning("learning: model not found", { providerID: input.providerID, modelID: input.modelID })),
        Effect.catch(() => Effect.succeed(undefined as any)),
      )
      if (!model) return

      const info = yield* provider.getProvider(ProviderV2.ID.make(input.providerID)).pipe(
        Effect.tapError(() => Effect.logWarning("learning: provider not found", { providerID: input.providerID })),
        Effect.catch(() => Effect.succeed(undefined as any)),
      )
      if (!info) return

      const key = getApiKey(info)
      if (!key) {
        yield* Effect.logWarning("learning: no API key for provider", { providerID: input.providerID })
        return
      }

      const url = chatCompletionsURL(model.api.url)
      const modelID = learning.model ?? model.api.id

      const systemPrompt = `You are a learning agent. Analyze the conversation turn below and identify if anything should be remembered for future interactions.

Determine if:
1. The assistant made mistakes that should be noted or corrected
2. The user revealed preferences, workflows, or patterns worth remembering
3. New skills should be created or existing ones updated based on this turn

Output ONLY valid JSON:
{
  "skillUpdates": [{ "name": "skill_name", "description": "What this skill does", "reasoning": "Why this was learned", "content": "The skill content/instructions" }],
  "observations": [{ "key": "observation_key", "value": "observation_value" }]
}

If nothing worth learning, return empty arrays.`

      const body = JSON.stringify({
        model: modelID,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `User:\n${input.userMessage}\n\nAssistant:\n${input.assistantMessage}` },
        ],
        temperature: 0.1,
      })

      const response = yield* Effect.tryPromise<Response>(() =>
        fetch(url, {
          method: "POST",
          headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
          body,
        }),
      ).pipe(Effect.catch(() => Effect.succeed(undefined as any)))

      if (!response) return

      const data = yield* Effect.tryPromise<any>(() => response.json()).pipe(
        Effect.catch(() => Effect.succeed(undefined as any)),
      )
      if (!data) return

      const text: string | undefined = data.choices?.[0]?.message?.content ?? data.content
      if (!text) {
        yield* Effect.logInfo("learning: unexpected response format")
        return
      }

      let parsed: any
      try {
        parsed = JSON.parse(text)
      } catch {
        yield* Effect.logInfo("learning: response not valid JSON, nothing learned")
        return
      }

      const updates = Array.isArray(parsed.skillUpdates) ? parsed.skillUpdates : []
      const observations = Array.isArray(parsed.observations) ? parsed.observations : []

      // ponytail: persist to JSONL, add read API when consumed
      if (updates.length > 0 || observations.length > 0) {
        yield* Effect.logInfo("learning: review found new items", {
          sessionID: input.sessionID,
          skillUpdateCount: updates.length,
          observationCount: observations.length,
          skillNames: updates.map((u: any) => u.name),
        })

        yield* Effect.try({
          try: () => {
            const dir = path.join(Global.Path.data, "learning")
            fs.mkdirSync(dir, { recursive: true })
            fs.appendFileSync(
              path.join(dir, "reviews.jsonl"),
              JSON.stringify({
                time: Date.now(),
                sessionID: input.sessionID,
                trigger: input.trigger,
                agent: input.agent,
                skills: updates,
                observations,
              }) + "\n",
            )
          },
          catch: (err: unknown) => err,
        }).pipe(Effect.catch((err) => Effect.logWarning("learning: failed to write review", { error: String(err) })))
      }
    })

    const read = Effect.fn("LearningReview.read")(function* () {
      const dir = path.join(Global.Path.data, "learning")
      const file = path.join(dir, "reviews.jsonl")
      if (!fs.existsSync(file)) return []
      let content: string
      try { content = fs.readFileSync(file, "utf-8") } catch { return [] }
      if (!content) return []
      const entries: ReviewEntry[] = []
      for (const line of content.split("\n").filter(Boolean)) {
        try { entries.push(JSON.parse(line)) } catch { continue }
      }
      return entries
    })

    return Service.of({ review, read })
  }),
)

import { LayerNode } from "@opencode-ai/core/effect/layer-node"

export const defaultLayer = layer

export const node = LayerNode.make(layer, [])

export * as Learning from "./learning"
