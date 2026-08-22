import { Effect, Layer, Context, Schema, Option } from "effect"
import { Config } from "@/config/config"
import { SessionID } from "@/session/schema"
import { Provider } from "@/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

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

export interface CompactionSummary {
  readonly intent: string
  readonly technicalDecisions: string[]
  readonly filesTouched: string[]
  readonly errorsAndFixes: string[]
  readonly pendingTasks: string[]
  readonly nextSteps: string[]
  readonly relevantContext: string[]
  readonly observations: string[]
  readonly summary: string
  readonly ghostSkills: string[]
}

export type CompressResult = {
  readonly sections: Section[]
  readonly summary: string
  readonly ghostSkills: string[]
  readonly structuredSummary?: CompactionSummary
}

export interface Interface {
  readonly compress: (input: CompressInput) => Effect.Effect<CompressResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Compressor") {}

const emptyResult: CompressResult = { sections: [], summary: "", ghostSkills: [] }

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
    const compress = Effect.fn("Compressor.compress")(function* (input: CompressInput) {
      const config = yield* Effect.serviceOption(Config.Service)
      const cfg = Option.isSome(config) ? yield* config.value.get() : { experimental: undefined }
      if (!cfg.experimental?.compressor?.enabled) return emptyResult

      const providerOpt = yield* Effect.serviceOption(Provider.Service)
      if (Option.isNone(providerOpt)) {
        yield* Effect.logInfo("compressor: Provider unavailable")
        return emptyResult
      }
      const provider = providerOpt.value

      const model = yield* provider.getModel(ProviderV2.ID.make(input.providerID), ModelV2.ID.make(input.modelID)).pipe(
        Effect.tapError(() =>
          Effect.logWarning("compressor: model not found", { providerID: input.providerID, modelID: input.modelID }),
        ),
        Effect.catch(() => Effect.void),
      )
      if (!model) return emptyResult

      const info = yield* provider.getProvider(ProviderV2.ID.make(input.providerID)).pipe(
        Effect.tapError(() => Effect.logWarning("compressor: provider not found", { providerID: input.providerID })),
        Effect.catch(() => Effect.void),
      )
      if (!info) return emptyResult

      const key = getApiKey(info)
      if (!key) {
        yield* Effect.logWarning("compressor: no API key for provider", { providerID: input.providerID })
        return emptyResult
      }

      const url = chatCompletionsURL(model.api.url)

      const systemPrompt = `You are a conversation compression expert. Analyze the conversation below and produce a structured JSON summary.

Rules:
- Focus on key decisions, code changes, and user preferences
- Identify implicit skill patterns from the conversation
- Each section should be a concise array of strings (under 200 words total per section)
- The summary field should be a 1-2 sentence overview
- Output valid JSON only

Output JSON:
{
  "intent": "What the user is trying to achieve",
  "technicalDecisions": ["Key architectural/technical choices made"],
  "filesTouched": ["Files created/modified/deleted"],
  "errorsAndFixes": ["Errors encountered and resolutions"],
  "pendingTasks": ["Incomplete work, blockers"],
  "nextSteps": ["Immediate next actions"],
  "relevantContext": ["Skills, patterns, constraints to preserve"],
  "observations": ["Notable patterns, gotchas, learnings"],
  "summary": "Brief overall summary",
  "ghostSkills": ["skill_name"]
}`

      const body = JSON.stringify({
        model: model.api.id,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Messages:\n${input.messages}\n\nSkills:\n${input.skills.join("\n")}` },
        ],
        temperature: 0,
      })

      const response = yield* Effect.tryPromise<Response>(() =>
        fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body,
        }),
      ).pipe(Effect.catch(() => Effect.void))

      if (!response) return emptyResult

      const data = yield* Effect.tryPromise<any>(() => response.json()).pipe(Effect.catch(() => Effect.void))
      if (!data) return emptyResult

      const text: string | undefined = data.choices?.[0]?.message?.content ?? data.content
      if (!text) {
        yield* Effect.logWarning("compressor: unexpected response format")
        return emptyResult
      }

      let parsed: any
      try {
        parsed = JSON.parse(text)
      } catch {
        yield* Effect.logWarning("compressor: failed to parse LLM response as JSON")
        return emptyResult
      }

      const structuredSummary: CompactionSummary | undefined =
        parsed.intent && parsed.technicalDecisions
          ? {
              intent: parsed.intent || "",
              technicalDecisions: Array.isArray(parsed.technicalDecisions) ? parsed.technicalDecisions : [],
              filesTouched: Array.isArray(parsed.filesTouched) ? parsed.filesTouched : [],
              errorsAndFixes: Array.isArray(parsed.errorsAndFixes) ? parsed.errorsAndFixes : [],
              pendingTasks: Array.isArray(parsed.pendingTasks) ? parsed.pendingTasks : [],
              nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
              relevantContext: Array.isArray(parsed.relevantContext) ? parsed.relevantContext : [],
              observations: Array.isArray(parsed.observations) ? parsed.observations : [],
              summary: parsed.summary || "",
              ghostSkills: Array.isArray(parsed.ghostSkills) ? parsed.ghostSkills : [],
            }
          : undefined

      const result: CompressResult = {
        sections: Array.isArray(parsed.sections)
          ? parsed.sections
          : structuredSummary
            ? [
                { title: "Intent", content: structuredSummary.intent },
                { title: "Technical Decisions", content: structuredSummary.technicalDecisions.join("\n") },
                { title: "Files Touched", content: structuredSummary.filesTouched.join("\n") },
                { title: "Errors & Fixes", content: structuredSummary.errorsAndFixes.join("\n") },
                { title: "Pending Tasks", content: structuredSummary.pendingTasks.join("\n") },
                { title: "Next Steps", content: structuredSummary.nextSteps.join("\n") },
                { title: "Relevant Context", content: structuredSummary.relevantContext.join("\n") },
                { title: "Observations", content: structuredSummary.observations.join("\n") },
              ]
            : [],
        summary: typeof parsed.summary === "string" ? parsed.summary : structuredSummary?.summary || "",
        ghostSkills: Array.isArray(parsed.ghostSkills) ? parsed.ghostSkills : structuredSummary?.ghostSkills || [],
        structuredSummary,
      }

      yield* Effect.logInfo("compressor: completed", {
        sessionID: input.sessionID,
        sectionCount: result.sections.length,
        summaryLength: result.summary.length,
      })

      return result
    })

    return Service.of({ compress })
  }),
)

import { LayerNode } from "@opencode-ai/core/effect/layer-node"

export const defaultLayer = layer

export const node = LayerNode.make(layer, [])

export * as Compressor from "./compressor"
