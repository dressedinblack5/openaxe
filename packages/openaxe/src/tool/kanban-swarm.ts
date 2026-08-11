import { Effect, Schema, Scope, Exit } from "effect"
import { Kanban } from "@opencode-ai/core/kanban/kanban"
import type { Context, DefWithoutID, ExecuteResult } from "./tool"
import { define } from "./tool"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "@/session/schema"
import { SessionPrompt } from "@/session/prompt"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Agent } from "@/agent/agent"
import { deriveSubagentSessionPermission } from "@/agent/subagent-permissions"
import { Config } from "@/config/config"
import { parseModel } from "@/provider/provider"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Database } from "@opencode-ai/core/database/database"
import { BackgroundJob } from "@/background/job"
import { MessageV2 } from "@/session/message-v2"
import { Wildcard } from "@opencode-ai/core/util/wildcard"

export interface KanbanSwarmPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<SessionV1.WithParts>
}

const Status = Schema.Literals(["backlog", "todo", "in_progress", "done", "blocked"])

export const Parameters = Schema.Struct({
  operation: Schema.Literals([
    "create_worker",
    "create_verifier",
    "complete_worker",
    "complete_verifier",
  ]).annotate({ description: "The kanban swarm operation to perform" }),
  boardId: Schema.optional(Schema.String).annotate({ description: "Board id (required for all operations)" }),
  cardId: Schema.optional(Schema.String).annotate({ description: "Card id (required for complete_worker, complete_verifier)" }),
  title: Schema.optional(Schema.String).annotate({ description: "Worker/verifier card title (required for create_worker, create_verifier)" }),
  description: Schema.optional(Schema.String).annotate({ description: "Task description for the worker/verifier" }),
  prompt: Schema.optional(Schema.String).annotate({ description: "The task prompt for the agent to perform" }),
  subagent_type: Schema.optional(Schema.String).annotate({ description: "The type of specialized agent to use (required for create_worker, create_verifier)" }),
  status: Schema.optional(Status).annotate({ description: "Card status" }),
  priority: Schema.optional(Schema.Int).annotate({ description: "Card priority" }),
  position: Schema.optional(Schema.Int).annotate({ description: "Card ordering position" }),
  workerSessionId: Schema.optional(Schema.String).annotate({ description: "Session id of the subagent working on the card" }),
  parentId: Schema.optional(Schema.String).annotate({ description: "Parent card id (root -> worker -> verifier hierarchies)" }),
  verification: Schema.optional(Schema.Json).annotate({ description: "Verification result attached to the card" }),
  rootSessionId: Schema.optional(Schema.String).annotate({ description: "Root session id. Defaults to the current session." }),
  background: Schema.optional(Schema.Boolean).annotate({ description: "Run the subagent in the background" }),
})

type Metadata = {
  operation: string
  sessionId?: string
  background?: boolean
  jobId?: string
  cardId?: string
  parentCardId?: string
  model?: { modelID: string; providerID: string }
  parentSessionId?: string
}

function renderCard(card: Kanban.Card): string {
  const lines = [
    `Card ${card.id}`,
    `  board: ${card.boardId}`,
    `  title: ${card.title}`,
    `  status: ${card.status}`,
    `  priority: ${card.priority}`,
    `  position: ${card.position}`,
  ]
  if (card.description) lines.push(`  description: ${card.description}`)
  if (card.workerSessionId) lines.push(`  worker session: ${card.workerSessionId}`)
  if (card.parentId) lines.push(`  parent: ${card.parentId}`)
  if (card.verification !== null && card.verification !== undefined)
    lines.push(`  verification: ${JSON.stringify(card.verification)}`)
  return lines.join("\n")
}

export const KanbanSwarmTool = define(
  "kanban-swarm",
  Effect.gen(function* () {
    const kanban = yield* Kanban.Service
    const sessions = yield* Session.Service
    const agent = yield* Agent.Service
    const background = yield* BackgroundJob.Service
    const config = yield* Config.Service
    const scope = yield* Scope.Scope
    const flags = yield* RuntimeFlags.Service
    const database = yield* Database.Service

    const execute = (params: Schema.Schema.Type<typeof Parameters>, ctx: Context<Metadata>) => {
      return Effect.gen(function* () {
        const cfg = yield* config.get()
        const runInBackground = params.background === true
        if (runInBackground && !flags.experimentalBackgroundSubagents) {
          return yield* Effect.fail(
            new Error("Background subagents require OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true"),
          )
        }

        yield* ctx.ask({
          permission: "kanban",
          patterns: [params.operation],
          always: ["*"],
          metadata: { operation: params.operation },
        })

        switch (params.operation) {
        case "create_worker": {
          if (!params.boardId || !params.title || !params.prompt || !params.subagent_type) {
            return yield* Effect.fail(new Error("kanban-swarm create_worker requires boardId, title, prompt, and subagent_type"))
          }

          const next = yield* agent.get(params.subagent_type)
          if (!next) {
            return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
          }

          const parentSession = yield* sessions.get(ctx.sessionID)
          const childPermission = deriveSubagentSessionPermission({
            parentSessionPermission: parentSession.permission ?? [],
            subagent: next,
          })
          const childToolDenies = [
            ...(next.permission.some((rule) => Wildcard.match("todowrite", rule.permission))
              ? []
              : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
            ...(next.permission.some((rule) => Wildcard.match("task", rule.permission))
              ? []
              : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
            ...(cfg.experimental?.primary_tools?.map((permission: string) => ({
              permission,
              pattern: "*" as const,
              action: "deny" as const,
            })) ?? []),
          ]

            const workerSession = yield* sessions.create({
              parentID: ctx.sessionID,
              title: params.title + ` (@${next.name} worker)`,
              agent: next.name,
              permission: [
                ...childPermission,
                ...childToolDenies.filter(
                  (deny) =>
                    !childPermission.some(
                      (rule) =>
                        rule.permission === deny.permission && rule.pattern === deny.pattern && rule.action === deny.action,
                    ),
                ),
              ],
            })

            const card = yield* kanban.createCard({
              boardId: params.boardId,
              rootSessionId: params.rootSessionId ?? ctx.sessionID,
              title: params.title,
              description: params.description,
              status: "todo",
              priority: params.priority ?? 0,
              position: params.position ?? 0,
              workerSessionId: workerSession.id,
              parentId: params.parentId,
              verification: params.verification,
            })

            const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
              Effect.provideService(Database.Service, database),
              Effect.orDie,
            )
            if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))
            const variant = msg.info.variant

            const model = next.model ??
              (cfg.model ? parseModel(cfg.model) : null) ?? {
                modelID: msg.info.modelID,
                providerID: msg.info.providerID,
              }

            const metadata = {
              operation: params.operation,
              parentSessionId: ctx.sessionID,
              sessionId: workerSession.id,
              model,
              ...(runInBackground ? { background: true } : {}),
              cardId: card.id,
            }

            yield* ctx.metadata({
              title: params.title,
              metadata,
            })

            const ops = ctx.extra?.promptOps as KanbanSwarmPromptOps
            if (!ops) return yield* Effect.fail(new Error("KanbanSwarmTool requires promptOps in ctx.extra"))

            const runTask = Effect.fn("KanbanSwarmTool.runTask")(function* () {
              const parts = yield* ops.resolvePromptParts(params.prompt!)
              const result = yield* ops.prompt({
                messageID: MessageID.ascending(),
                sessionID: workerSession.id,
                model: {
                  modelID: model.modelID,
                  providerID: model.providerID,
                },
                variant: next.model || cfg.model ? undefined : variant,
                agent: next.name,
                parts,
              })
              return result.parts.findLast((item) => item.type === "text")?.text ?? ""
            })

            const inject = Effect.fn("KanbanSwarmTool.injectBackgroundResult")(function* (
              state: "completed" | "error",
              text: string,
            ) {
              const currentParent = yield* sessions.get(ctx.sessionID)
              yield* ops
                .prompt({
                  sessionID: ctx.sessionID,
                  agent: currentParent.agent ?? ctx.agent,
                  variant,
                  parts: [
                    {
                      type: "text",
                      synthetic: true,
                      text: [
                        `<task id="${workerSession.id}" state="${state}">`,
                        state === "completed"
                          ? `<summary>Worker completed: ${params.title}</summary>`
                          : `<summary>Worker failed: ${params.title}</summary>`,
                        state === "completed" ? "<task_result>" : "<task_error>",
                        text,
                        state === "completed" ? "</task_result>" : "</task_error>",
                        "</task>",
                      ].join("\n"),
                    },
                  ],
                })
                .pipe(Effect.ignore, Effect.forkIn(scope, { startImmediately: true }))
            })

            const notify = Effect.fn("KanbanSwarmTool.notifyBackgroundResult")(function* (jobID: string) {
              yield* background.wait({ id: jobID }).pipe(
                Effect.flatMap((result) => {
                  if (result.info?.status === "completed") return inject("completed", result.info.output ?? "")
                  if (result.info?.status === "error") return inject("error", result.info.error ?? "")
                  return Effect.void
                }),
                Effect.forkIn(scope, { startImmediately: true }),
              )
            })

            const updateCardOnComplete = Effect.fn("KanbanSwarmTool.updateCardOnComplete")(function* (
              state: "completed" | "error",
              text: string,
            ) {
              const verification = state === "completed" ? { result: text, timestamp: Date.now() } : { error: text, timestamp: Date.now() }
              yield* kanban.updateCard(card.id, {
                status: state === "completed" ? "done" : "blocked",
                verification,
              })
            })

            if (yield* background.extend({ id: workerSession.id, run: runTask() })) {
              yield* kanban.updateCard(card.id, { status: "in_progress" })
              return {
                title: params.title,
                metadata: { ...metadata, background: true, jobId: workerSession.id },
                output: [
                  `Worker started (background): ${params.title}`,
                  `Card: ${card.id}`,
                  `Worker session: ${workerSession.id}`,
                  "You will be notified when it completes.",
                ].join("\n"),
              }
            }

            const info = yield* background.start({
              id: workerSession.id,
              type: "kanban-swarm-worker",
              title: params.title,
              metadata,
              onPromote: Effect.all([
                ctx.metadata({
                  title: params.title,
                  metadata: { ...metadata, background: true, jobId: workerSession.id },
                }),
                notify(workerSession.id),
                updateCardOnComplete("completed", ""),
              ]).pipe(Effect.asVoid),
              run: runTask().pipe(
                Effect.tap((result) => updateCardOnComplete("completed", result)),
                Effect.onInterrupt(() =>
                  Effect.all([
                    ops.cancel(workerSession.id),
                    updateCardOnComplete("error", "Worker cancelled"),
                  ], { discard: true }),
                ),
              ),
            })

            function backgroundResult() {
              return {
                title: params.title!,
                metadata: {
                  ...metadata,
                  background: true,
                  jobId: info.id,
                },
                output: [
                  `Worker started (background): ${params.title}`,
                  `Card: ${card.id}`,
                  `Worker session: ${workerSession.id}`,
                  "You will be notified when it completes.",
                ].join("\n"),
              }
            }

            if (runInBackground) {
              yield* notify(info.id)
              return backgroundResult()
            }

            const runCancel = yield* EffectBridge.make()
            const cancel = ops.cancel(workerSession.id)

            function onAbort() {
              runCancel.fork(cancel)
            }

            return yield* Effect.acquireUseRelease(
              Effect.sync(() => {
                ctx.abort.addEventListener("abort", onAbort)
              }),
              () =>
                Effect.gen(function* () {
                  yield* kanban.updateCard(card.id, { status: "in_progress" })
                  const result = yield* Effect.raceFirst(
                    background.wait({ id: workerSession.id }).pipe(Effect.map((waited) => waited.info)),
                    background.waitForPromotion(workerSession.id),
                  )
                  if (result?.metadata?.background === true) return backgroundResult()
                  if (result?.status === "error") return yield* Effect.fail(new Error(result.error ?? "Worker failed"))
                  if (result?.status === "cancelled") return yield* Effect.fail(new Error("Worker cancelled"))
                  yield* kanban.updateCard(card.id, { status: "done" })
                  return {
                    title: params.title!,
                    metadata,
                    output: [
                      `Worker completed: ${params.title}`,
                      `Card: ${card.id}`,
                      `Worker session: ${workerSession.id}`,
                      result?.output ?? "",
                    ].join("\n"),
                  }
                }),
              (_, exit) =>
                Effect.gen(function* () {
                  if (Exit.hasInterrupts(exit))
                    yield* Effect.all([cancel, background.cancel(workerSession.id)], { discard: true })
                }).pipe(
                  Effect.ensuring(
                    Effect.sync(() => {
                      ctx.abort.removeEventListener("abort", onAbort)
                    }),
                  ),
                ),
            )
          }
          case "create_verifier": {
            if (!params.boardId || !params.title || !params.prompt || !params.subagent_type || !params.parentId) {
              return yield* Effect.fail(new Error("kanban-swarm create_verifier requires boardId, title, prompt, subagent_type, and parentId"))
            }

            const _parentCard = yield* kanban.getBoard(params.boardId).pipe(
              Effect.flatMap((_board) => kanban.listCards({ boardId: params.boardId })),
              Effect.map((cards) => cards.find((c) => c.id === params.parentId)),
              Effect.flatMap((card) =>
                card
                  ? Effect.succeed(card)
                  : Effect.fail(new Error(`Parent card not found: ${params.parentId}`)),
              ),
            )

            const next = yield* agent.get(params.subagent_type)
            if (!next) {
              return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
            }

            const parentSession = yield* sessions.get(ctx.sessionID)
            const childPermission = deriveSubagentSessionPermission({
              parentSessionPermission: parentSession.permission ?? [],
              subagent: next,
            })
            const childToolDenies = [
              ...(next.permission.some((rule) => Wildcard.match("todowrite", rule.permission))
                ? []
                : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
              ...(next.permission.some((rule) => Wildcard.match("task", rule.permission))
                ? []
                : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
              ...(cfg.experimental?.primary_tools?.map((permission: string) => ({
                permission,
                pattern: "*" as const,
                action: "deny" as const,
              })) ?? []),
            ]

            const verifierSession = yield* sessions.create({
              parentID: ctx.sessionID,
              title: params.title + ` (@${next.name} verifier)`,
              agent: next.name,
              permission: [
                ...childPermission,
                ...childToolDenies.filter(
                  (deny) =>
                    !childPermission.some(
                      (rule) =>
                        rule.permission === deny.permission && rule.pattern === deny.pattern && rule.action === deny.action,
                    ),
                ),
              ],
            })

            const card = yield* kanban.createCard({
              boardId: params.boardId,
              rootSessionId: params.rootSessionId ?? ctx.sessionID,
              title: params.title,
              description: params.description,
              status: "todo",
              priority: params.priority ?? 0,
              position: (params.position ?? 0) + 1,
              workerSessionId: verifierSession.id,
              parentId: params.parentId,
              verification: params.verification,
            })

            const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
              Effect.provideService(Database.Service, database),
              Effect.orDie,
            )
            if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))
            const variant = msg.info.variant

            const model = next.model ??
              (cfg.model ? parseModel(cfg.model) : null) ?? {
                modelID: msg.info.modelID,
                providerID: msg.info.providerID,
              }

            const metadata = {
              operation: params.operation,
              parentSessionId: ctx.sessionID,
              sessionId: verifierSession.id,
              model,
              ...(runInBackground ? { background: true } : {}),
              cardId: card.id,
              parentCardId: params.parentId,
            }

            yield* ctx.metadata({
              title: params.title,
              metadata,
            })

            const ops = ctx.extra?.promptOps as KanbanSwarmPromptOps
            if (!ops) return yield* Effect.fail(new Error("KanbanSwarmTool requires promptOps in ctx.extra"))

            const runTask = Effect.fn("KanbanSwarmTool.runVerifier")(function* () {
              const parts = yield* ops.resolvePromptParts(params.prompt!)
              const result = yield* ops.prompt({
                messageID: MessageID.ascending(),
                sessionID: verifierSession.id,
                model: {
                  modelID: model.modelID,
                  providerID: model.providerID,
                },
                variant: next.model || cfg.model ? undefined : variant,
                agent: next.name,
                parts,
              })
              return result.parts.findLast((item) => item.type === "text")?.text ?? ""
            })

            const inject = Effect.fn("KanbanSwarmTool.injectVerifierBackgroundResult")(function* (
              state: "completed" | "error",
              text: string,
            ) {
              const currentParent = yield* sessions.get(ctx.sessionID)
              yield* ops
                .prompt({
                  sessionID: ctx.sessionID,
                  agent: currentParent.agent ?? ctx.agent,
                  variant,
                  parts: [
                    {
                      type: "text",
                      synthetic: true,
                      text: [
                        `<task id="${verifierSession.id}" state="${state}">`,
                        state === "completed"
                          ? `<summary>Verifier completed: ${params.title}</summary>`
                          : `<summary>Verifier failed: ${params.title}</summary>`,
                        state === "completed" ? "<task_result>" : "<task_error>",
                        text,
                        state === "completed" ? "</task_result>" : "</task_error>",
                        "</task>",
                      ].join("\n"),
                    },
                  ],
                })
                .pipe(Effect.ignore, Effect.forkIn(scope, { startImmediately: true }))
            })

            const notify = Effect.fn("KanbanSwarmTool.notifyVerifierBackgroundResult")(function* (jobID: string) {
              yield* background.wait({ id: jobID }).pipe(
                Effect.flatMap((result) => {
                  if (result.info?.status === "completed") return inject("completed", result.info.output ?? "")
                  if (result.info?.status === "error") return inject("error", result.info.error ?? "")
                  return Effect.void
                }),
                Effect.forkIn(scope, { startImmediately: true }),
              )
            })

            const updateCardOnComplete = Effect.fn("KanbanSwarmTool.updateVerifierCardOnComplete")(function* (
              state: "completed" | "error",
              text: string,
            ) {
              const verification = state === "completed" ? { result: text, timestamp: Date.now() } : { error: text, timestamp: Date.now() }
              yield* kanban.updateCard(card.id, {
                status: state === "completed" ? "done" : "blocked",
                verification,
              })
            })

            if (yield* background.extend({ id: verifierSession.id, run: runTask() })) {
              yield* kanban.updateCard(card.id, { status: "in_progress" })
              return {
                title: params.title,
                metadata: { ...metadata, background: true, jobId: verifierSession.id },
                output: [
                  `Verifier started (background): ${params.title}`,
                  `Card: ${card.id}`,
                  `Verifier session: ${verifierSession.id}`,
                  `Parent card: ${params.parentId}`,
                  "You will be notified when it completes.",
                ].join("\n"),
              }
            }

            const info = yield* background.start({
              id: verifierSession.id,
              type: "kanban-swarm-verifier",
              title: params.title,
              metadata,
              onPromote: Effect.all([
                ctx.metadata({
                  title: params.title,
                  metadata: { ...metadata, background: true, jobId: verifierSession.id },
                }),
                notify(verifierSession.id),
                updateCardOnComplete("completed", ""),
              ]).pipe(Effect.asVoid),
              run: runTask().pipe(
                Effect.tap((result) => updateCardOnComplete("completed", result)),
                Effect.onInterrupt(() =>
                  Effect.all([
                    ops.cancel(verifierSession.id),
                    updateCardOnComplete("error", "Verifier cancelled"),
                  ], { discard: true }),
                ),
              ),
            })

            function backgroundResult() {
              return {
                title: params.title!,
                metadata: {
                  ...metadata,
                  background: true,
                  jobId: info.id,
                },
                output: [
                  `Verifier started (background): ${params.title}`,
                  `Card: ${card.id}`,
                  `Verifier session: ${verifierSession.id}`,
                  `Parent card: ${params.parentId}`,
                  "You will be notified when it completes.",
                ].join("\n"),
              }
            }

            if (runInBackground) {
              yield* notify(info.id)
              return backgroundResult()
            }

            const runCancel = yield* EffectBridge.make()
            const cancel = ops.cancel(verifierSession.id)

            function onAbort() {
              runCancel.fork(cancel)
            }

            return yield* Effect.acquireUseRelease(
              Effect.sync(() => {
                ctx.abort.addEventListener("abort", onAbort)
              }),
              () =>
                Effect.gen(function* () {
                  yield* kanban.updateCard(card.id, { status: "in_progress" })
                  const result = yield* Effect.raceFirst(
                    background.wait({ id: verifierSession.id }).pipe(Effect.map((waited) => waited.info)),
                    background.waitForPromotion(verifierSession.id),
                  )
                  if (result?.metadata?.background === true) return backgroundResult()
                  if (result?.status === "error") return yield* Effect.fail(new Error(result.error ?? "Verifier failed"))
                  if (result?.status === "cancelled") return yield* Effect.fail(new Error("Verifier cancelled"))
                  yield* kanban.updateCard(card.id, { status: "done" })
                  return {
                    title: params.title!,
                    metadata,
                    output: [
                      `Verifier completed: ${params.title}`,
                      `Card: ${card.id}`,
                      `Verifier session: ${verifierSession.id}`,
                      `Parent card: ${params.parentId}`,
                      result?.output ?? "",
                    ].join("\n"),
                  }
                }),
              (_, exit) =>
                Effect.gen(function* () {
                  if (Exit.hasInterrupts(exit))
                    yield* Effect.all([cancel, background.cancel(verifierSession.id)], { discard: true })
                }).pipe(
                  Effect.ensuring(
                    Effect.sync(() => {
                      ctx.abort.removeEventListener("abort", onAbort)
                    }),
                  ),
                ),
            )
          }
          case "complete_worker": {
            if (!params.cardId) {
              return yield* Effect.fail(new Error("kanban-swarm complete_worker requires cardId"))
            }
            const card = yield* kanban.updateCard(params.cardId, {
              status: "done",
              verification: params.verification,
            })
            if (!card) return yield* Effect.fail(new Error(`Card not found: ${params.cardId}`))
            return {
              title: `Completed worker: ${card.title}`,
              output: renderCard(card),
              metadata: { operation: params.operation },
            }
          }
          case "complete_verifier": {
            if (!params.cardId) {
              return yield* Effect.fail(new Error("kanban-swarm complete_verifier requires cardId"))
            }
            const card = yield* kanban.updateCard(params.cardId, {
              status: "done",
              verification: params.verification,
            })
            if (!card) return yield* Effect.fail(new Error(`Card not found: ${params.cardId}`))
            return {
              title: `Completed verifier: ${card.title}`,
              output: renderCard(card),
              metadata: { operation: params.operation },
            }
}
        }

      }) as Effect.Effect<ExecuteResult<Metadata>>
    }

    return {
      description:
        "Manage a kanban swarm board for coordinating worker/verifier subagents. Operations: create_worker (spawn worker subagent, create card with worker_session_id), create_verifier (spawn verifier subagent linked to parent worker card), complete_worker (mark worker card done with verification), complete_verifier (mark verifier card done with verification). Supports background mode with automatic card status updates.",
      parameters: Parameters,
      execute,
    } satisfies DefWithoutID<typeof Parameters, Metadata>
  }),
)

export * as KanbanSwarm from "./kanban-swarm"