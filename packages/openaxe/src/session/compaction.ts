import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Session } from "./session"
import { SessionID, MessageID, PartID } from "./schema"
import { Provider } from "@/provider/provider"
import { MessageV2 } from "./message-v2"
import { Token } from "@/util/token"
import { SessionProcessor } from "./processor"
import { Agent } from "@/agent/agent"
import { Skill } from "@/skill"
import { Plugin } from "@/plugin"
import { Compressor } from "./compressor/compressor"
import { BackgroundCompaction } from "./compaction/background"
import { Config } from "@/config/config"
import { NotFoundError } from "@/storage/storage"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { TokenEstimator } from "./token-estimator"

import { Effect, Layer, Context, Option } from "effect"
import { makeUnsafe } from "effect/DateTime"
import { InstanceState } from "@/effect/instance-state"
import { isOverflow as overflow, usable } from "./overflow"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { buildPrompt } from "@opencode-ai/core/session/compaction"
import { SessionCompactionEvent } from "@opencode-ai/schema/session-compaction-event"

export const Event = SessionCompactionEvent

export const PRUNE_MINIMUM = 20_000
export const PRUNE_PROTECT = 40_000
const TOOL_OUTPUT_MAX_CHARS = 2_000
const TOOL_OUTPUT_PROTECT = 50_000
const TOOL_OUTPUT_PREVIEW = 2_000
const PRUNE_PROTECTED_TOOLS = ["skill"]
const DEFAULT_TAIL_TURNS = 2
const MIN_PRESERVE_RECENT_TOKENS = 2_000
const MAX_PRESERVE_RECENT_TOKENS = 8_000

function parseThreshold(threshold: string, usableTokens: number): number {
  if (threshold.endsWith("%")) {
    const pct = parseFloat(threshold.slice(0, -1)) / 100
    return Math.floor(usableTokens * pct)
  }
  if (threshold.startsWith("remaining:")) {
    const remaining = parseInt(threshold.slice(10), 10)
    return Math.max(0, usableTokens - remaining)
  }
  const absolute = parseInt(threshold, 10)
  return isNaN(absolute) ? usableTokens : absolute
}

type Turn = {
  start: number
  end: number
  id: MessageID
}

type Tail = {
  start: number
  id: MessageID
}

type CompletedCompaction = {
  userIndex: number
  assistantIndex: number
  summary: string | undefined
}

function summaryText(message: SessionV1.WithParts) {
  const text = message.parts
    .filter((part): part is SessionV1.TextPart => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim()
  return text || undefined
}

function completedCompactions(messages: SessionV1.WithParts[]) {
  const users = new Map<MessageID, number>()
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    if (!msg.parts.some((part) => part.type === "compaction")) continue
    users.set(msg.info.id, i)
  }

  return messages.flatMap((msg, assistantIndex): CompletedCompaction[] => {
    if (msg.info.role !== "assistant") return []
    if (!msg.info.summary || !msg.info.finish || msg.info.error) return []
    const userIndex = users.get(msg.info.parentID)
    if (userIndex === undefined) return []
    return [{ userIndex, assistantIndex, summary: summaryText(msg) }]
  })
}

function preserveRecentBudget(input: { cfg: ConfigV1.Info; model: Provider.Model }) {
  return (
    input.cfg.compaction?.preserve_recent_tokens ??
    Math.min(MAX_PRESERVE_RECENT_TOKENS, Math.max(MIN_PRESERVE_RECENT_TOKENS, Math.floor(usable(input) * 0.25)))
  )
}

function turns(messages: SessionV1.WithParts[]) {
  const result: Turn[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    if (msg.parts.some((part) => part.type === "compaction")) continue
    result.push({
      start: i,
      end: messages.length,
      id: msg.info.id,
    })
  }
  for (let i = 0; i < result.length - 1; i++) {
    result[i].end = result[i + 1].start
  }
  return result
}

function splitTurn(input: {
  messages: SessionV1.WithParts[]
  turn: Turn
  model: Provider.Model
  budget: number
  estimate: (input: { messages: SessionV1.WithParts[]; model: Provider.Model }) => Effect.Effect<number>
}) {
  return Effect.gen(function* () {
    if (input.budget <= 0) return undefined
    if (input.turn.end - input.turn.start <= 1) return undefined
    for (let start = input.turn.start + 1; start < input.turn.end; start++) {
      const size = yield* input.estimate({
        messages: input.messages.slice(start, input.turn.end),
        model: input.model,
      })
      if (size > input.budget) continue
      return {
        start,
        id: input.messages[start].info.id,
      } satisfies Tail
    }
    return undefined
  })
}

export interface Interface {
  readonly isOverflow: (input: {
    tokens: SessionV1.Assistant["tokens"]
    model: Provider.Model
    sessionID?: SessionID
  }) => Effect.Effect<boolean>
  readonly prune: (input: { sessionID: SessionID }) => Effect.Effect<void>
  readonly process: (input: {
    parentID: MessageID
    messages: SessionV1.WithParts[]
    sessionID: SessionID
    auto: boolean
    overflow?: boolean
  }) => Effect.Effect<"continue" | "stop">
  readonly create: (input: {
    sessionID: SessionID
    agent: string
    model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
    auto: boolean
    overflow?: boolean
  }) => Effect.Effect<void>
  readonly checkpoint: (input: { sessionID: SessionID; messages: SessionV1.WithParts[] }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionCompaction") {}

export const use = serviceUse(Service)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const session = yield* Session.Service
    const agents = yield* Agent.Service
    const plugin = yield* Plugin.Service
    const processors = yield* SessionProcessor.Service
    const provider = yield* Provider.Service
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service
    const skill = yield* Skill.Service
    const tokenEstimator = yield* TokenEstimator.Service
    const fs = yield* FSUtil.Service
    const background = yield* BackgroundCompaction.Service

    const isOverflow = Effect.fn("SessionCompaction.isOverflow")(function* (input: {
      tokens: SessionV1.Assistant["tokens"]
      model: Provider.Model
      sessionID?: SessionID
    }) {
      const cfg = yield* config.get()

      if (input.sessionID && cfg.compaction?.cacheAware?.enabled) {
        const estimate = yield* tokenEstimator.getEstimate(input.sessionID)
        const totalTokens = estimate.serverReported + estimate.estimatedDelta

        const usableTokens = usable({ cfg, model: input.model, outputTokenMax: flags.outputTokenMax })
        const threshold = cfg.compaction?.threshold
          ? parseThreshold(cfg.compaction.threshold, usableTokens)
          : usableTokens

        return totalTokens >= threshold
      }

      return overflow({
        cfg,
        tokens: input.tokens,
        model: input.model,
        outputTokenMax: flags.outputTokenMax,
      })
    })

    const estimate = Effect.fn("SessionCompaction.estimate")(function* (input: {
      messages: SessionV1.WithParts[]
      model: Provider.Model
    }) {
      const msgs = yield* MessageV2.toModelMessagesEffect(input.messages, input.model)
      return Token.estimate(JSON.stringify(msgs))
    })

    const select = Effect.fn("SessionCompaction.select")(function* (input: {
      messages: SessionV1.WithParts[]
      cfg: ConfigV1.Info
      model: Provider.Model
    }) {
      const limit = input.cfg.compaction?.tail_turns ?? DEFAULT_TAIL_TURNS
      if (limit <= 0) return { head: input.messages, tail_start_id: undefined }
      const budget = preserveRecentBudget({ cfg: input.cfg, model: input.model })
      const all = turns(input.messages)
      if (!all.length) return { head: input.messages, tail_start_id: undefined }
      const recent = all.slice(-limit)
      const sizes = yield* Effect.forEach(
        recent,
        (turn) =>
          estimate({
            messages: input.messages.slice(turn.start, turn.end),
            model: input.model,
          }),
        { concurrency: "unbounded" },
      )

      let total = 0
      let keep: Tail | undefined
      for (let i = recent.length - 1; i >= 0; i--) {
        const turn = recent[i]
        const size = sizes[i]
        if (total + size <= budget) {
          total += size
          keep = { start: turn.start, id: turn.id }
          continue
        }
        const remaining = budget - total
        const split = yield* splitTurn({
          messages: input.messages,
          turn,
          model: input.model,
          budget: remaining,
          estimate,
        })
        if (split) keep = split
        else if (!keep) {
          yield* Effect.logInfo("tail fallback", { budget, size, total })
        }
        break
      }

      if (!keep || keep.start === 0) return { head: input.messages, tail_start_id: undefined }
      return {
        head: input.messages.slice(0, keep.start),
        tail_start_id: keep.id,
      }
    })

    // goes backwards through parts until there are PRUNE_PROTECT tokens worth of tool
    // calls, then erases output of older tool calls to free context space
    const prune = Effect.fn("SessionCompaction.prune")(function* (input: { sessionID: SessionID }) {
      const cfg = yield* config.get()
      if (!cfg.compaction?.prune) return
      yield* Effect.logInfo("pruning")

      const msgs = yield* session
        .messages({ sessionID: input.sessionID })
        // eslint-disable-next-line @typescript-eslint/unbound-method
        .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.void))
      if (!msgs) return

      let total = 0
      let pruned = 0
      const toPrune: SessionV1.ToolPart[] = []
      let turns = 0

      loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
        const msg = msgs[msgIndex]
        if (msg.info.role === "user") turns++
        if (turns < 2) continue
        if (msg.info.role === "assistant" && msg.info.summary) break loop
        for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
          const part = msg.parts[partIndex]
          if (part.type !== "tool") continue
          if (part.state.status !== "completed") continue
          if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue
          if (part.state.time.compacted) break loop
          const estimate = Token.estimate(part.state.output)
          total += estimate
          if (total <= PRUNE_PROTECT) continue
          pruned += estimate
          toPrune.push(part)
        }
      }

      yield* Effect.logInfo("found", { pruned, total })
      if (pruned > PRUNE_MINIMUM) {
        for (const part of toPrune) {
          if (part.state.status === "completed") {
            part.state.time.compacted = Date.now()
            yield* session.updatePart(part)
          }
        }
        yield* Effect.logInfo("pruned", { count: toPrune.length })
      }
    })

    // Tool output budgeting: persist large tool outputs to disk, keep preview in context
    const budgetToolOutputs = Effect.fn("SessionCompaction.budgetToolOutputs")(function* (input: {
      sessionID: SessionID
    }) {
      const cfg = yield* config.get()
      if (!cfg.compaction?.toolBudgeting?.enabled) return
      const msgs = yield* session
        .messages({ sessionID: input.sessionID })
        .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.void))
      if (!msgs) return

      const protectChars = cfg.compaction?.toolBudgeting?.protectChars ?? TOOL_OUTPUT_PROTECT
      const previewChars = cfg.compaction?.toolBudgeting?.previewChars ?? TOOL_OUTPUT_PREVIEW
      const outputDir = `${Global.Path.data}/compaction/tool-outputs/${input.sessionID}`

      yield* fs.makeDirectory(outputDir, { recursive: true })

      let processed = 0
      for (const msg of msgs) {
        if (msg.info.role !== "assistant") continue
        for (const part of msg.parts) {
          if (part.type !== "tool") continue
          if (part.state.status !== "completed") continue
          if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue
          if (part.state.time.compacted) continue

          const output = part.state.output
          if (typeof output !== "string") continue
          if (output.length <= protectChars) continue

          const filename = `${msg.info.id}_${part.id}.json`
          const filepath = `${outputDir}/${filename}`
          const data = JSON.stringify({
            messageID: msg.info.id,
            partID: part.id,
            tool: part.tool,
            output,
            timestamp: Date.now(),
          })

          yield* fs.writeFileString(filepath, data)

          part.state.output =
            output.slice(0, previewChars) + `\n... [output truncated, full output saved to ${filepath}]`
          yield* session.updatePart(part)
          processed++
        }
      }

      if (processed > 0) {
        yield* Effect.logInfo("budgeted tool outputs", { count: processed, outputDir })
      }
    })

    const processCompaction = Effect.fn("SessionCompaction.process")(function* (input: {
      parentID: MessageID
      messages: SessionV1.WithParts[]
      sessionID: SessionID
      auto: boolean
      overflow?: boolean
    }) {
      const parent = input.messages.findLast((m) => m.info.id === input.parentID)
      if (!parent || parent.info.role !== "user") {
        throw new Error(`Compaction parent must be a user message: ${input.parentID}`)
      }
      const userMessage = parent.info
      const compactionPart = parent.parts.find((part): part is SessionV1.CompactionPart => part.type === "compaction")

      let messages = input.messages
      let replay:
        | {
            info: SessionV1.User
            parts: SessionV1.Part[]
          }
        | undefined
      if (input.overflow) {
        const idx = input.messages.findIndex((m) => m.info.id === input.parentID)
        for (let i = idx - 1; i >= 0; i--) {
          const msg = input.messages[i]
          if (msg.info.role === "user" && !msg.parts.some((p) => p.type === "compaction")) {
            replay = { info: msg.info, parts: msg.parts }
            messages = input.messages.slice(0, i)
            break
          }
        }
        const hasContent =
          replay && messages.some((m) => m.info.role === "user" && !m.parts.some((p) => p.type === "compaction"))
        if (!hasContent) {
          replay = undefined
          messages = input.messages
        }
      }

      const compressor = yield* Effect.serviceOption(Compressor.Service)
      const agent = yield* agents.get("compaction")
      const model = agent.model
        ? yield* provider.getModel(agent.model.providerID, agent.model.modelID).pipe(Effect.orDie)
        : yield* provider.getModel(userMessage.model.providerID, userMessage.model.modelID).pipe(Effect.orDie)
      const cfg = yield* config.get()

      yield* budgetToolOutputs({ sessionID: input.sessionID }).pipe(Effect.catch(() => Effect.void))

      const history = compactionPart && messages.at(-1)?.info.id === input.parentID ? messages.slice(0, -1) : messages
      const prior = completedCompactions(history)
      const hidden = new Set(prior.flatMap((item) => [item.userIndex, item.assistantIndex]))
      const previousSummary = prior.at(-1)?.summary
      const selected = yield* select({
        messages: history.filter((_, index) => !hidden.has(index)),
        cfg,
        model,
      })
      // Allow plugins to inject context or replace compaction prompt.
      const compacting = yield* plugin.trigger(
        "experimental.session.compacting",
        { sessionID: input.sessionID },
        { context: [], prompt: undefined },
      )
      const nextPrompt = compacting.prompt ?? buildPrompt({ previousSummary, context: compacting.context })

      const allSkillNames = yield* skill.all().pipe(Effect.map((skills) => skills.map((s) => s.name)))
      const useStructuredSummary = cfg.compaction?.structuredSummary ?? true
      const useBreadcrumb = cfg.compaction?.breadcrumb ?? true

      const transcriptPath = `${Global.Path.data}/sessions/${input.sessionID}/transcript.jsonl`
      const breadcrumb = useBreadcrumb
        ? `\n---\n[Transcript archived at: ${transcriptPath}]\n[Use ReadFile tool to retrieve full history]\n---`
        : ""

      const compressInput = {
        sessionID: input.sessionID,
        messages: JSON.stringify(
          selected.head.map((m) => ({
            role: m.info.role,
            parts: m.parts.map((p) => (p.type === "text" ? p.text : `[${p.type}]`)),
          })),
        ),
        skills: allSkillNames,
        providerID: model.providerID,
        modelID: model.id,
      }
      const build = Option.isSome(compressor) ? yield* background.getOrBuild(compressInput) : undefined
      const source = build?.source ?? "fresh"
      const compressedPrompt = build
        ? (() => {
            const compressed = build.result
            const allSections = [...compressed.sections]
            if (compressed.ghostSkills.length > 0) {
              allSections.push({
                title: "Detected Skills",
                content: compressed.ghostSkills.map((s) => `- ${s}`).join("\n"),
              })
            }
            const basePrompt =
              allSections.length > 0
                ? `${nextPrompt}\n\n<structured_summary>\n${allSections.map((s) => `<section title="${s.title}">\n${s.content}\n</section>`).join("\n")}\n</structured_summary>`
                : nextPrompt
            return useStructuredSummary && compressed.structuredSummary
              ? `${basePrompt}\n\n<compaction_summary>\n${JSON.stringify(compressed.structuredSummary, null, 2)}\n</compaction_summary>${breadcrumb}`
              : `${basePrompt}${breadcrumb}`
          })()
        : `${nextPrompt}${breadcrumb}`

      const msgs = structuredClone(selected.head)
      yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
      const modelMessages = yield* MessageV2.toModelMessagesEffect(msgs, model, {
        stripMedia: true,
        toolOutputMaxChars: TOOL_OUTPUT_MAX_CHARS,
      })
      const tailIndex = selected.tail_start_id
        ? history.findIndex((message) => message.info.id === selected.tail_start_id)
        : -1
      const recent =
        tailIndex < 0
          ? ""
          : JSON.stringify(
              yield* MessageV2.toModelMessagesEffect(history.slice(tailIndex), model, {
                stripMedia: true,
                toolOutputMaxChars: TOOL_OUTPUT_MAX_CHARS,
              }),
            )
      const ctx = yield* InstanceState.context
      const msg: SessionV1.Assistant = {
        id: MessageID.ascending(),
        role: "assistant",
        parentID: input.parentID,
        sessionID: input.sessionID,
        mode: "compaction",
        agent: "compaction",
        variant: userMessage.model.variant,
        summary: true,
        path: {
          cwd: ctx.directory,
          root: ctx.worktree,
        },
        cost: 0,
        tokens: {
          output: 0,
          input: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        modelID: model.id,
        providerID: model.providerID,
        time: {
          created: Date.now(),
        },
      }
      yield* session.updateMessage(msg)
      const processor = yield* processors.create({
        assistantMessage: msg,
        sessionID: input.sessionID,
        model,
      })
      const result = yield* processor.process({
        user: userMessage,
        agent,
        sessionID: input.sessionID,
        tools: {},
        system: [],
        messages: [
          ...modelMessages,
          {
            role: "user",
            content: [{ type: "text", text: compressedPrompt }],
          },
        ],
        model,
      })

      if (result === "compact") {
        processor.message.error = new SessionV1.ContextOverflowError({
          message: replay
            ? "Conversation history too large to compact - exceeds model context limit"
            : "Session too large to compact - context exceeds model limit even after stripping media",
        }).toObject() as NonNullable<(typeof processor.message)["error"]>
        processor.message.finish = "error"
        yield* session.updateMessage(processor.message)
        return "stop"
      }

      if (compactionPart && selected.tail_start_id && compactionPart.tail_start_id !== selected.tail_start_id) {
        yield* session.updatePart({
          ...compactionPart,
          tail_start_id: selected.tail_start_id,
        })
      }

      if (result === "continue" && input.auto) {
        if (replay) {
          const original = replay.info
          const replayMsg = yield* session.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: input.sessionID,
            time: { created: Date.now() },
            agent: original.agent,
            model: original.model,
            format: original.format,
            tools: original.tools,
            system: original.system,
          })
          for (const part of replay.parts) {
            if (part.type === "compaction") continue
            const replayPart =
              part.type === "file" && MessageV2.isMedia(part.mime)
                ? { type: "text" as const, text: `[Attached ${part.mime}: ${part.filename ?? "file"}]` }
                : part
            yield* session.updatePart({
              ...replayPart,
              id: PartID.ascending(),
              messageID: replayMsg.id,
              sessionID: input.sessionID,
            })
          }
        }

        if (!replay) {
          const info = yield* provider.getProvider(userMessage.model.providerID)
          if (
            (yield* plugin.trigger(
              "experimental.compaction.autocontinue",
              {
                sessionID: input.sessionID,
                agent: userMessage.agent,
                model: yield* provider
                  .getModel(userMessage.model.providerID, userMessage.model.modelID)
                  .pipe(Effect.orDie),
                provider: {
                  source: info.source,
                  info,
                  options: info.options,
                },
                message: userMessage,
                overflow: input.overflow === true,
              },
              { enabled: true },
            )).enabled
          ) {
            const continueMsg = yield* session.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: input.sessionID,
              time: { created: Date.now() },
              agent: userMessage.agent,
              model: userMessage.model,
            })
            const text =
              (input.overflow
                ? "The previous request exceeded the provider's size limit due to large media attachments. The conversation was compacted and media files were removed from context. If the user was asking about attached images or files, explain that the attachments were too large to process and suggest they try again with smaller or fewer files.\n\n"
                : "") +
              "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed."
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: continueMsg.id,
              sessionID: input.sessionID,
              type: "text",
              // Internal marker for auto-compaction followups so provider plugins
              // can distinguish them from manual post-compaction user prompts.
              // This is not a stable plugin contract and may change or disappear.
              metadata: { compaction_continue: true },
              synthetic: true,
              text,
              time: {
                start: Date.now(),
                end: Date.now(),
              },
            })
          }
        }
      }

      if (processor.message.error) return "stop"
      if (result === "continue") {
        const summary = summaryText(
          (yield* session.messages({ sessionID: input.sessionID }).pipe(Effect.orDie)).find(
            (item) => item.info.id === msg.id,
          ) ?? {
            info: msg,
            parts: [],
          },
        )
        if (flags.experimentalEventSystem) {
          if (summary)
            yield* events.publish(SessionEvent.Compaction.Ended, {
              sessionID: input.sessionID,
              messageID: SessionMessage.ID.make(input.parentID),
              timestamp: makeUnsafe(Date.now()),
              reason: input.auto ? "auto" : "manual",
              text: summary ?? "",
              recent,
            })
        }
        yield* events.publish(Event.Compacted, {
          sessionID: input.sessionID,
          source,
          timestamp: Date.now(),
          tokensBefore: Token.estimate(compressInput.messages),
          tokensAfter: Token.estimate(recent || ""),
          summary: summary ?? "",
          transcriptPath,
        })
      }
      return result
    })

    const create = Effect.fn("SessionCompaction.create")(function* (input: {
      sessionID: SessionID
      agent: string
      model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
      auto: boolean
      overflow?: boolean
    }) {
      const cfg = yield* config.get()
      const useBreadcrumb = cfg.compaction?.breadcrumb ?? true

      const transcriptPath = `${Global.Path.data}/sessions/${input.sessionID}/transcript.jsonl`
      const breadcrumb = useBreadcrumb
        ? `\n---\n[Transcript archived at: ${transcriptPath}]\n[Use ReadFile tool to retrieve full history]\n---`
        : ""

      const msg = yield* session.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: { created: Date.now() },
      })
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
        overflow: input.overflow,
        text: breadcrumb,
      })
      if (flags.experimentalEventSystem) {
        yield* events.publish(SessionEvent.Compaction.Started, {
          sessionID: input.sessionID,
          messageID: SessionMessage.ID.make(msg.id),
          timestamp: makeUnsafe(Date.now()),
          reason: input.auto ? "auto" : "manual",
        })
      }
    })

    const checkpoint = Effect.fn("SessionCompaction.checkpoint")(function* (input: {
      sessionID: SessionID
      messages: SessionV1.WithParts[]
    }) {
      const cfg = yield* config.get()
      if (!cfg.compaction?.background?.enabled) return

      const agent = yield* agents.get("compaction")
      const fallback = input.messages.findLast((m) => m.info.role === "user")
      const fallbackModel = fallback && fallback.info.role === "user" ? fallback.info.model : undefined
      const model = agent.model
        ? yield* provider.getModel(agent.model.providerID, agent.model.modelID).pipe(Effect.orDie)
        : fallbackModel
          ? yield* provider.getModel(fallbackModel.providerID, fallbackModel.modelID).pipe(Effect.orDie)
          : null
      if (!model) return

      const current = yield* estimate({ messages: input.messages, model })
      const usableTokens = usable({ cfg, model, outputTokenMax: flags.outputTokenMax })
      const utilization = usableTokens > 0 ? current / usableTokens : 0
      const checkpointThreshold = cfg.compaction.background.checkpointThreshold ?? 0.6
      const swapThreshold = cfg.compaction.background.swapThreshold ?? 0.85

      // Precompute a checkpoint behind the trigger threshold, stop once compaction is imminent.
      if (utilization < checkpointThreshold || utilization >= swapThreshold) return

      const allSkillNames = yield* skill.all().pipe(Effect.map((skills) => skills.map((s) => s.name)))
      const selected = yield* select({ messages: input.messages, cfg, model })

      yield* background.checkpoint({
        sessionID: input.sessionID,
        messages: JSON.stringify(
          selected.head.map((m) => ({
            role: m.info.role,
            parts: m.parts.map((p) => (p.type === "text" ? p.text : `[${p.type}]`)),
          })),
        ),
        skills: allSkillNames,
        providerID: model.providerID,
        modelID: model.id,
      })
    })

    return Service.of({
      isOverflow,
      prune,
      process: processCompaction,
      create,
      checkpoint,
    })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(SessionProcessor.defaultLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(RuntimeFlags.defaultLayer),
    Layer.provide(EventV2Bridge.defaultLayer),
    Layer.provide(Compressor.defaultLayer),
    Layer.provide(Skill.defaultLayer),
    Layer.provide(TokenEstimator.defaultLayer),
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(BackgroundCompaction.defaultLayer),
  ),
)

export const node = LayerNode.make(layer, [
  Config.node,
  Session.node,
  Agent.node,
  Plugin.node,
  SessionProcessor.node,
  Provider.node,
  EventV2Bridge.node,
  RuntimeFlags.node,
  Compressor.node,
  Skill.node,
  TokenEstimator.node,
  FSUtil.node,
  BackgroundCompaction.node,
])

export * as SessionCompaction from "./compaction"
