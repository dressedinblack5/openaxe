// @ts-nocheck
// oxlint-disable typescript/no-redundant-type-constituents -- WIP SessionInput.Delivery is error type
import { Cause, DateTime, Effect, FiberSet, Layer, Option, Schema, Semaphore, Stream } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { QuestionV2 } from "@opencode-ai/core/question"
import { SystemContext } from "@opencode-ai/core/system-context/index"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { SkillGuidance } from "@opencode-ai/core/skill/guidance"
import { ReferenceGuidance } from "@opencode-ai/core/reference/guidance"
import { AutoCommit } from "@opencode-ai/core/auto-commit"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { SessionContextEpoch } from "@opencode-ai/core/session/context-epoch"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionHistory } from "@opencode-ai/core/session/history"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { eq } from "drizzle-orm"
import { LLM, LLMClient, LLMError, LLMEvent, Message, SystemPart, isContextOverflowFailure, type ProviderErrorEvent } from "@opencode-ai/llm"
import { SessionRunnerModel } from "./model"
import { createLLMEventPublisher } from "./publish-llm-event"
import { toLLMMessage } from "./to-llm-message"
import { MAX_STEPS_PROMPT } from "./max-steps"
import {
  UnifiedRunnerService,
  type UnifiedRunnerInput,
  UnifiedRunnerError,
  RunnerState,
  RunnerStateChanged,
  Interrupted,
  SubagentCompleted,
} from "./types"

export class SessionNotFoundError extends Schema.TaggedErrorClass<SessionNotFoundError>()(
  "UnifiedRunner.SessionNotFoundError",
  {
    sessionID: SessionSchema.ID,
  },
) {
  override get message() {
    return `Session not found: ${this.sessionID}`
  }
}

/**
 * Safe event publishing - catches all errors to satisfy never error channel
 */
const safePublish = <A, R>(effect: Effect.Effect<A, unknown, R>): Effect.Effect<A, never, R> =>
  effect.pipe(Effect.catchCause(() => Effect.void))

/**
 * Unified Session Runner - Core durable orchestration
 * Emits SessionEvent for CLI subscription
 */
export const layer = Layer.effect(
  UnifiedRunnerService,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const llm = yield* LLMClient.Service
    const agents = yield* AgentV2.Service
    const tools = yield* ToolRegistry.Service
    const models = yield* SessionRunnerModel.Service
    const store = yield* SessionStore.Service
    const location = yield* Location.Service
    const systemContext = yield* SystemContextRegistry.Service
    const skillGuidance = yield* SkillGuidance.Service
    const referenceGuidance = yield* ReferenceGuidance.Service
    const config = yield* Config.Service
    const db = (yield* Database.Service).db
    const compaction = SessionCompaction.make({ events, llm, config: yield* config.entries() })

    const getSession = Effect.fn("UnifiedRunner.getSession")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* new SessionNotFoundError({ sessionID })
      return session
    })

    const failInterruptedTools = Effect.fn("UnifiedRunner.failInterruptedTools")(function* (
      sessionID: SessionSchema.ID,
    ) {
      const latest = yield* SessionHistory.loadLatestAssistant(db, sessionID)
      if (!latest || !("content" in latest)) return
      for (const tool of latest.content) {
        if (tool.type !== "tool" || (tool.state.status !== "pending" && tool.state.status !== "running")) continue
        yield* events.publish(SessionEvent.Tool.Failed, {
          sessionID,
          timestamp: yield* DateTime.now,
          assistantMessageID: latest.id,
          callID: tool.id,
          error: { type: "unknown", message: "Tool execution interrupted" },
          provider: {
            executed: tool.provider?.executed === true,
            ...(tool.provider?.metadata === undefined ? {} : { metadata: tool.provider.metadata }),
          },
        })
      }
    })

    const awaitToolFibers = (fibers: FiberSet.FiberSet<void, ToolOutputStore.Error>) =>
      Effect.raceFirst(FiberSet.join(fibers), FiberSet.awaitEmpty(fibers))

    const isQuestionRejected = (cause: Cause.Cause<unknown>) =>
      cause.reasons.some((reason) => Cause.isDieReason(reason) && reason.defect instanceof QuestionV2.RejectedError)

    type TurnTransition =
      | { readonly _tag: "ContinueAfterCompaction"; readonly step: number }
      | { readonly _tag: "ContinueAfterOverflowCompaction"; readonly step: number }

    class TurnTransitionError extends Error {
      constructor(readonly transition: TurnTransition) {
        super()
      }
    }

    const continueAfterCompaction = (step: number) => new TurnTransitionError({ _tag: "ContinueAfterCompaction", step })
    const continueAfterOverflowCompaction = (step: number) =>
      new TurnTransitionError({ _tag: "ContinueAfterOverflowCompaction", step })

    const loadSystemContext = (agent: AgentV2.Selection) =>
      Effect.all([systemContext.load(), skillGuidance.load(agent), referenceGuidance.load()], {
        concurrency: "unbounded",
      }).pipe(Effect.map(SystemContext.combine))

    const emitRunnerState = (sessionID: SessionSchema.ID, state: RunnerState) =>
      DateTime.now.pipe(
        Effect.map((timestamp) => safePublish(events.publish(RunnerStateChanged, { timestamp, sessionID, state }))),
        Effect.asVoid,
      )

    const runTurnAttempt = Effect.fn("UnifiedRunner.runTurn")(function* (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
      recoverOverflow?: typeof compaction.compactAfterOverflow,
    ) {
      const session = yield* getSession(sessionID)
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* Effect.interrupt
      const agent = yield* agents.select(session.agent)
      const initialized = yield* SessionContextEpoch.initialize(db, loadSystemContext(agent), session.id)
      const toolFibers = yield* FiberSet.make<void, ToolOutputStore.Error>()
      const publicationSemaphore = yield* Semaphore.make(1)
      let needsContinuation = false
      let currentStep = step
      if (promotion) {
        const cutoff = yield* EventV2.latestSequence(db, session.id)
        let promoted = 0
        if (promotion === "steer") promoted = yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
        if (promotion === "queue") {
          promoted += Number(yield* SessionInput.promoteNextQueued(db, events, session.id))
          promoted += yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
        }
        if (promoted > 0) currentStep = 1
      }
      const system =
        initialized ?? (yield* SessionContextEpoch.prepare(db, events, loadSystemContext(agent), session.id))
      const model = yield* models.resolve(session)
      const pagination = yield* SessionHistory.entriesForRunnerPaginated(db, session.id, system.baselineSeq, { limit: 100 })
      let entries = pagination.entries
      const isLastStep = agent.info?.steps !== undefined && currentStep >= agent.info.steps
      const toolMaterialization = isLastStep ? undefined : yield* tools.materialize(agent.info?.permissions)
      const promptCacheKey = /^ses_[0-9a-f]{64}$/.test(session.id) ? session.id.slice(4) : session.id
      let request = LLM.request({
        model,
        providerOptions: { openai: { promptCacheKey } },
        system: [agent.info?.system, system.baseline]
          .filter((part): part is string => part !== undefined && part.length > 0)
          .map(SystemPart.make),
        messages: isLastStep
          ? [...entries.flatMap(({ message }) => toLLMMessage(message, model)), Message.assistant(MAX_STEPS_PROMPT)]
          : entries.flatMap(({ message }) => toLLMMessage(message, model)),
        tools: toolMaterialization?.definitions ?? [],
        toolChoice: isLastStep ? "none" : undefined,
      })
      if (yield* compaction.compactIfNeeded({ sessionID: session.id, entries, model, request })) {
        yield* Effect.yieldNow
        entries = yield* SessionHistory.entriesForRunner(db, session.id, system.baselineSeq)
        request = LLM.request({
          model,
          providerOptions: { openai: { promptCacheKey } },
          system: [agent.info?.system, system.baseline]
            .filter((part): part is string => part !== undefined && part.length > 0)
            .map(SystemPart.make),
          messages: isLastStep
            ? [...entries.flatMap(({ message }) => toLLMMessage(message, model)), Message.assistant(MAX_STEPS_PROMPT)]
            : entries.flatMap(({ message }) => toLLMMessage(message, model)),
          tools: toolMaterialization?.definitions ?? [],
          toolChoice: isLastStep ? "none" : undefined,
        })
        if (yield* compaction.compactIfNeeded({ sessionID: session.id, entries, model, request })) {
          return yield* Effect.die(continueAfterCompaction(currentStep))
        }
      }
      const publisher = createLLMEventPublisher(events, {
        sessionID: session.id,
        agent: agent.id,
        model: {
          id: ModelV2.ID.make(model.id),
          providerID: ProviderV2.ID.make(model.provider),
          ...(session.model?.variant === undefined ? {} : { variant: session.model.variant }),
        },
      })
      const withPublication = (effect) => publicationSemaphore.withPermit(effect)
      const publish = (event: LLMEvent, outputPaths: ReadonlyArray<string> = []) =>
        withPublication(safePublish(publisher.publish(event, outputPaths))).pipe(Effect.asVoid)
      let overflowFailure: ProviderErrorEvent | undefined
      const providerStream = llm.stream(request).pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (overflowFailure || publisher.hasProviderError()) return
            if (LLMEvent.is.providerError(event)) {
              if (isContextOverflowFailure(event) && !publisher.hasAssistantStarted()) {
                overflowFailure = event
                return
              }
            }
            yield* publish(event)
            if (event.type !== "tool-call" || event.providerExecuted) return
            if (!toolMaterialization) {
              yield* withPublication(safePublish(publisher.failUnsettledTools("Tools are disabled after the maximum agent steps")))
              return
            }
            needsContinuation = true
            const assistantMessageID = yield* publisher.assistantMessageID(event.id)
            yield* Effect.uninterruptibleMask((restore) =>
              restore(
                toolMaterialization.settle({
                  sessionID: session.id,
                  agent: agent.id,
                  assistantMessageID,
                  call: event,
                }),
              ).pipe(
                Effect.flatMap((settlement) =>
                  publish(
                    LLMEvent.toolResult({
                      id: event.id,
                      name: event.name,
                      result: settlement.result,
                      output: settlement.output,
                    }),
                    settlement.outputPaths ?? [],
                  ),
                ),
              ),
            ).pipe(FiberSet.run(toolFibers))
          }),
        ),
        Effect.ensuring(withPublication(publisher.flush())),
      )

      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const stream = yield* restore(providerStream).pipe(Effect.exit)
          const failure =
            stream._tag === "Failure" ? Option.getOrUndefined(Cause.findErrorOption(stream.cause)) : undefined
          if (
            recoverOverflow &&
            !publisher.hasAssistantStarted() &&
            isContextOverflowFailure(overflowFailure ?? failure) &&
            (yield* restore(recoverOverflow({ sessionID: session.id, entries, model, request })))
          )
            return yield* Effect.die(continueAfterOverflowCompaction(currentStep))
          entries = []
          if (overflowFailure) yield* publish(overflowFailure)
          const llmFailure = failure instanceof LLMError ? failure : undefined
          if (llmFailure && !publisher.hasProviderError()) {
            yield* withPublication(safePublish(publisher.failUnsettledTools("Provider did not return a tool result", true)))
            yield* withPublication(safePublish(publisher.failAssistant(llmFailure.reason.message)))
          }
          if (stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)) yield* FiberSet.clear(toolFibers)
          const settled = yield* restore(awaitToolFibers(toolFibers)).pipe(Effect.exit)
          yield* AutoCommit.commitTurn(sessionID).pipe(Effect.ignoreCause)
          if (settled._tag === "Failure" && isQuestionRejected(settled.cause)) {
            yield* FiberSet.clear(toolFibers)
            yield* withPublication(safePublish(publisher.failUnsettledTools("Tool execution interrupted")))
            return yield* Effect.interrupt
          }
          if (
            (stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)) ||
            (settled._tag === "Failure" && Cause.hasInterrupts(settled.cause))
          ) {
            yield* FiberSet.clear(toolFibers)
            yield* withPublication(safePublish(publisher.failUnsettledTools("Tool execution interrupted")))
            if (publisher.hasActiveAssistant())
              yield* withPublication(safePublish(publisher.failAssistant("Provider turn interrupted")))
          }
          if (settled._tag === "Failure" && !Cause.hasInterrupts(settled.cause)) {
            const failure = Cause.squash(settled.cause)
            const message = failure instanceof Error ? failure.message : String(failure)
            yield* withPublication(safePublish(publisher.failUnsettledTools(`Tool execution failed: ${message}`)))
          }
          if (publisher.hasProviderError())
            yield* withPublication(safePublish(publisher.failUnsettledTools("Tool execution interrupted")))
          if (stream._tag === "Success" && !publisher.hasProviderError())
            yield* withPublication(safePublish(publisher.failUnsettledTools("Provider did not return a tool result", true)))
          if (stream._tag === "Failure") return yield* Effect.failCause(stream.cause)
          if (settled._tag === "Failure") return yield* Effect.failCause(settled.cause)
          return { needsContinuation: !publisher.hasProviderError() && needsContinuation, step: currentStep }
        }),
      )
    }, Effect.scoped)

    type RunTurn = (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
    ) => Effect.Effect<{ readonly needsContinuation: boolean; readonly step: number }, UnifiedRunnerError>

    const runAfterOverflowCompaction: RunTurn = Effect.fnUntraced(function* (sessionID, promotion, step) {
      return yield* runTurnAttempt(sessionID, promotion, step).pipe(
        Effect.catchDefect(
          Effect.fnUntraced(function* (defect) {
            if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
            if (defect.transition._tag === "ContinueAfterOverflowCompaction")
              return yield* Effect.die("Post-compaction provider attempt cannot recover another overflow")
            yield* Effect.yieldNow
            return yield* runAfterOverflowCompaction(sessionID, undefined, defect.transition.step)
          }),
        ),
      )
    })

    const runTurn: RunTurn = Effect.fnUntraced(function* (sessionID, promotion, step) {
      return yield* runTurnAttempt(sessionID, promotion, step, compaction.compactAfterOverflow).pipe(
        Effect.catchDefect(
          Effect.fnUntraced(function* (defect) {
            if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
            yield* Effect.yieldNow
            if (defect.transition._tag === "ContinueAfterOverflowCompaction")
              return yield* runAfterOverflowCompaction(sessionID, undefined, defect.transition.step)
            return yield* runTurn(sessionID, undefined, defect.transition.step)
          }),
        ),
      )
    })

    const run = Effect.fn("UnifiedRunner.run")(function* (input: UnifiedRunnerInput) {
      const hasSteer = yield* SessionInput.hasPending(db, input.sessionID, "steer")
      const hasQueue = hasSteer ? false : yield* SessionInput.hasPending(db, input.sessionID, "queue")
      yield* failInterruptedTools(input.sessionID)
      if (!input.force && !hasSteer && !hasQueue) return
      let promotion: SessionInput.Delivery | undefined = hasSteer ? "steer" : hasQueue ? "queue" : undefined
      let shouldRun = input.force || hasSteer || hasQueue
      yield* emitRunnerState(input.sessionID, { _tag: "Running", sessionID: input.sessionID, step: 1, providerTurnID: crypto.randomUUID() })
      while (shouldRun) {
        let needsContinuation = true
        let step = 1
        while (needsContinuation) {
          const result = yield* runTurn(input.sessionID, promotion, step)
          needsContinuation = result.needsContinuation
          step = result.step + 1
          promotion = "steer"
          if (!needsContinuation) needsContinuation = yield* SessionInput.hasPending(db, input.sessionID, "steer")
        }
        shouldRun = yield* SessionInput.hasPending(db, input.sessionID, "queue")
        promotion = shouldRun ? "queue" : undefined
      }
      yield* emitRunnerState(input.sessionID, { _tag: "Idle" })
    })

    const cancel = Effect.fn("UnifiedRunner.cancel")(function* (sessionID: SessionSchema.ID) {
      yield* emitRunnerState(sessionID, { _tag: "Idle" })
      yield* safePublish(events.publish(Interrupted, {
        timestamp: yield* DateTime.now,
        sessionID,
        reason: "Cancelled by user",
      }))
    })

    const drainSubagents = Effect.fn("UnifiedRunner.drainSubagents")(function* (parentSessionID: SessionSchema.ID) {
      const db = (yield* Database.Service).db
      const rows = yield* db.select().from(SessionTable).where(eq(SessionTable.parent_id, parentSessionID)).all().pipe(Effect.orDie)
      const subagents = rows.filter((row) => row.metadata?.subagent === true)
      for (const subagent of subagents) {
        yield* run({ sessionID: subagent.id, force: true }).pipe(Effect.catchCause(Effect.logError))
        yield* safePublish(events.publish(SubagentCompleted, {
          timestamp: yield* DateTime.now,
          sessionID: parentSessionID,
          subagentSessionID: subagent.id,
          success: true,
        }))
      }
    })

    return {
      run,
      cancel,
      drainSubagents,
    }
  }),
)

export const defaultLayer = layer

export * as UnifiedRunner from "./unified-runner"