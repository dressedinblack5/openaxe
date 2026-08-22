import { Effect, Schema } from "effect"
import { Kanban } from "@opencode-ai/core/kanban/kanban"
import type { Context, DefWithoutID } from "./tool"
import { define } from "./tool"

const Status = Schema.Literals(["backlog", "todo", "in_progress", "done", "blocked"])

export const Parameters = Schema.Struct({
  operation: Schema.Literals(["create_board", "create_card", "update_card", "list_cards", "get_board"]).annotate({
    description: "The kanban operation to perform",
  }),
  boardId: Schema.optional(Schema.String).annotate({
    description: "Board id (required for create_card, list_cards, get_board)",
  }),
  cardId: Schema.optional(Schema.String).annotate({ description: "Card id (required for update_card)" }),
  title: Schema.optional(Schema.String).annotate({
    description: "Board or card title (required for create_board, create_card)",
  }),
  description: Schema.optional(Schema.String).annotate({ description: "Card description" }),
  status: Schema.optional(Status).annotate({ description: "Card status" }),
  priority: Schema.optional(Schema.Int).annotate({ description: "Card priority" }),
  position: Schema.optional(Schema.Int).annotate({ description: "Card ordering position" }),
  workerSessionId: Schema.optional(Schema.String).annotate({
    description: "Session id of the subagent working on the card",
  }),
  parentId: Schema.optional(Schema.String).annotate({
    description: "Parent card id (root -> worker -> verifier hierarchies)",
  }),
  verification: Schema.optional(Schema.Json).annotate({ description: "Verification result attached to the card" }),
  rootSessionId: Schema.optional(Schema.String).annotate({
    description: "Root session id. Defaults to the current session.",
  }),
})

type Metadata = {
  operation: string
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

function renderBoard(board: Kanban.Board): string {
  return [
    `Board ${board.id}`,
    `  title: ${board.title}`,
    `  status: ${board.status}`,
    `  root session: ${board.rootSessionId}`,
  ].join("\n")
}

export const KanbanTool = define<typeof Parameters, Metadata, Kanban.Service>(
  "kanban",
  Effect.gen(function* () {
    const kanban = yield* Kanban.Service

    const execute = (params: Schema.Schema.Type<typeof Parameters>, ctx: Context<Metadata>) =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "kanban",
          patterns: [params.operation],
          always: ["*"],
          metadata: { operation: params.operation },
        })

        switch (params.operation) {
          case "create_board": {
            if (!params.title) return yield* Effect.fail(new Error("kanban create_board requires a title"))
            const board = yield* kanban.createBoard({
              rootSessionId: params.rootSessionId ?? ctx.sessionID,
              title: params.title,
            })
            return {
              title: `Created board: ${board.title}`,
              output: renderBoard(board),
              metadata: { operation: params.operation },
            }
          }
          case "get_board": {
            if (!params.boardId) return yield* Effect.fail(new Error("kanban get_board requires a boardId"))
            const board = yield* kanban.getBoard(params.boardId)
            if (!board) return yield* Effect.fail(new Error(`Board not found: ${params.boardId}`))
            return {
              title: `Board: ${board.title}`,
              output: renderBoard(board),
              metadata: { operation: params.operation },
            }
          }
          case "create_card": {
            if (!params.boardId || !params.title)
              return yield* Effect.fail(new Error("kanban create_card requires boardId and title"))
            const card = yield* kanban.createCard({
              boardId: params.boardId,
              rootSessionId: params.rootSessionId ?? ctx.sessionID,
              title: params.title,
              description: params.description,
              status: params.status,
              priority: params.priority,
              position: params.position,
              workerSessionId: params.workerSessionId,
              parentId: params.parentId,
              verification: params.verification,
            })
            return {
              title: `Created card: ${card.title}`,
              output: renderCard(card),
              metadata: { operation: params.operation },
            }
          }
          case "update_card": {
            if (!params.cardId) return yield* Effect.fail(new Error("kanban update_card requires a cardId"))
            const card = yield* kanban.updateCard(params.cardId, {
              title: params.title,
              description: params.description,
              status: params.status,
              priority: params.priority,
              position: params.position,
              workerSessionId: params.workerSessionId,
              parentId: params.parentId,
              verification: params.verification,
            })
            if (!card) return yield* Effect.fail(new Error(`Card not found: ${params.cardId}`))
            return {
              title: `Updated card: ${card.title}`,
              output: renderCard(card),
              metadata: { operation: params.operation },
            }
          }
          case "list_cards": {
            const cards = yield* kanban.listCards({ boardId: params.boardId, status: params.status })
            if (cards.length === 0) {
              return {
                title: "No cards",
                output: "No kanban cards match the given filter.",
                metadata: { operation: params.operation },
              }
            }
            return {
              title: `${cards.length} cards`,
              output: cards.map(renderCard).join("\n\n"),
              metadata: { operation: params.operation },
            }
          }
        }
      }) as Effect.Effect<{
        title: string
        output: string
        metadata: Metadata
      }>

    return {
      description:
        "Manage a kanban board for coordinating a multi-agent swarm. Boards group cards under a coordinator session. Cards track tasks with a status (backlog/todo/in_progress/done/blocked), priority, ordering position, an optional worker_session_id assigned to a subagent, an optional parent_id for root->worker->verifier hierarchies, and an optional verification result. Operations: create_board, create_card, update_card (move status, set worker_session_id, set verification), list_cards (filter by board or status), get_board.",
      parameters: Parameters,
      execute,
    } satisfies DefWithoutID<typeof Parameters, Metadata>
  }),
)
