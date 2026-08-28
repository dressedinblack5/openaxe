export * as KanbanTool from "./kanban"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { Kanban } from "../kanban/kanban"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "kanban"

export const Operation = Schema.Literals(["create_board", "create_card", "update_card", "list_cards", "get_board"])

export const Input = Schema.Struct({
  operation: Operation,
  boardId: Schema.optional(Schema.String),
  cardId: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  status: Schema.optional(Schema.Literals(["backlog", "todo", "in_progress", "done", "blocked"])),
  priority: Schema.optional(Schema.Int),
  position: Schema.optional(Schema.Int),
  workerSessionId: Schema.optional(Schema.String),
  parentId: Schema.optional(Schema.String),
  verification: Schema.optional(Schema.Json),
  rootSessionId: Schema.optional(Schema.String),
})

export const BoardOutput = Schema.Struct({
  id: Schema.String,
  rootSessionId: Schema.String,
  title: Schema.String,
  status: Schema.String,
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
})

export const CardOutput = Schema.Struct({
  id: Schema.String,
  boardId: Schema.String,
  rootSessionId: Schema.String,
  title: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.String,
  priority: Schema.Number,
  position: Schema.Number,
  workerSessionId: Schema.optional(Schema.NullOr(Schema.String)),
  parentId: Schema.optional(Schema.NullOr(Schema.String)),
  verification: Schema.optional(Schema.Unknown),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
})

export const Output = Schema.Union([CardOutput, BoardOutput, Schema.Struct({ cards: Schema.Array(CardOutput) })])

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const permission = yield* PermissionV2.Service
    const kanban = yield* Kanban.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Manage a kanban board for coordinating a multi-agent swarm. Boards group cards under a coordinator session. Cards track tasks with a status (backlog/todo/in_progress/done/blocked), priority, ordering position, an optional worker_session_id assigned to a subagent, an optional parent_id for root→worker→verifier hierarchies, and an optional verification result. Operations: create_board, create_card, update_card (move status, set worker_session_id, set verification), list_cards (filter by board or status), get_board.",
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: [],
                save: ["*"],
                metadata: { operation: input.operation },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })

              switch (input.operation) {
                case "create_board": {
                  if (!input.title)
                    return yield* Effect.fail(new ToolFailure({ message: "kanban create_board requires a title" }))
                  return yield* kanban.createBoard({
                    rootSessionId: input.rootSessionId ?? context.sessionID,
                    title: input.title,
                  })
                }
                case "get_board": {
                  if (!input.boardId)
                    return yield* Effect.fail(new ToolFailure({ message: "kanban get_board requires a boardId" }))
                  const board = yield* kanban.getBoard(input.boardId)
                  if (!board)
                    return yield* Effect.fail(new ToolFailure({ message: `Board not found: ${input.boardId}` }))
                  return board
                }
                case "create_card": {
                  if (!input.boardId || !input.title)
                    return yield* Effect.fail(
                      new ToolFailure({ message: "kanban create_card requires boardId and title" }),
                    )
                  return yield* kanban.createCard({
                    boardId: input.boardId,
                    rootSessionId: input.rootSessionId ?? context.sessionID,
                    title: input.title,
                    description: input.description,
                    status: input.status,
                    priority: input.priority,
                    position: input.position,
                    workerSessionId: input.workerSessionId,
                    parentId: input.parentId,
                    verification: input.verification,
                  })
                }
                case "update_card": {
                  if (!input.cardId)
                    return yield* Effect.fail(new ToolFailure({ message: "kanban update_card requires a cardId" }))
                  const card = yield* kanban.updateCard(input.cardId, {
                    title: input.title,
                    description: input.description,
                    status: input.status,
                    priority: input.priority,
                    position: input.position,
                    workerSessionId: input.workerSessionId,
                    parentId: input.parentId,
                    verification: input.verification,
                  })
                  if (!card) return yield* Effect.fail(new ToolFailure({ message: `Card not found: ${input.cardId}` }))
                  return card
                }
                case "list_cards": {
                  const cards = yield* kanban.listCards({ boardId: input.boardId, status: input.status })
                  return { cards }
                }
                default:
                  return yield* Effect.fail(new ToolFailure({ message: "kanban unknown operation" }))
              }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure ? error : new ToolFailure({ message: `kanban ${input.operation} failed` }),
              ),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
