import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Kanban } from "@opencode-ai/core/kanban/kanban"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { KanbanTool } from "@opencode-ai/core/tool/kanban"
import { testEffect } from "./lib/effect"
import { settleTool, toolDefinitions, toolIdentity } from "./lib/tool"

const serviceIt = testEffect(Kanban.defaultLayer)

describe("KanbanService", () => {
  serviceIt.effect("creates a board and card, moves status, lists filtered cards, and round-trips verification", () =>
    Effect.gen(function* () {
      const kanban = yield* Kanban.Service

      const board = yield* kanban.createBoard({ rootSessionId: "ses_root", title: "Feature 2" })
      expect(board).toMatchObject({ rootSessionId: "ses_root", title: "Feature 2", status: "active" })

      const card = yield* kanban.createCard({
        boardId: board.id,
        rootSessionId: "ses_root",
        title: "task A",
        priority: 1,
      })
      expect(card).toMatchObject({
        boardId: board.id,
        title: "task A",
        status: "backlog",
        priority: 1,
        position: 0,
      })

      const moved = yield* kanban.updateCard(card.id, { status: "in_progress", workerSessionId: "ses_worker" })
      expect(moved?.status).toBe("in_progress")
      expect(moved?.workerSessionId).toBe("ses_worker")

      const verified = yield* kanban.updateCard(card.id, { status: "done", verification: { passed: true, notes: "all green" } })
      expect(verified?.verification).toEqual({ passed: true, notes: "all green" })

      const done = yield* kanban.listCards({ boardId: board.id, status: "done" })
      expect(done.map((card) => card.id)).toEqual([card.id])

      const all = yield* kanban.listCards({ boardId: board.id })
      expect(all).toHaveLength(1)
      expect(all[0]?.verification).toEqual({ passed: true, notes: "all green" })

      expect(yield* kanban.getBoard(board.id)).toMatchObject({ id: board.id, title: "Feature 2" })
    }),
  )

  serviceIt.effect("returns undefined for a missing board and a missing card update", () =>
    Effect.gen(function* () {
      const kanban = yield* Kanban.Service
      expect(yield* kanban.getBoard("kbd_missing")).toBeUndefined()
      expect(yield* kanban.updateCard("card_missing", { status: "done" })).toBeUndefined()
    }),
  )

  serviceIt.effect("orders multiple cards by their explicit positions", () =>
    Effect.gen(function* () {
      const kanban = yield* Kanban.Service
      const board = yield* kanban.createBoard({ rootSessionId: "ses_root", title: "Ordering" })
      yield* kanban.createCard({ boardId: board.id, rootSessionId: "ses_root", title: "first", position: 0 })
      yield* kanban.createCard({ boardId: board.id, rootSessionId: "ses_root", title: "second", position: 1 })
      const cards = yield* kanban.listCards({ boardId: board.id })
      expect(cards.map((card) => card.title)).toEqual(["first", "second"])
    }),
  )
})

const sessionID = SessionV2.ID.make("ses_kanban_tool_test")
const assertions: PermissionV2.AssertInput[] = []

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) => Effect.sync(() => assertions.push(input)),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const withTool = <A, E, R>(body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>) => {
  const registry = ToolRegistry.defaultLayer.pipe(Layer.provide(permission))
  const kanbanTool = KanbanTool.layer.pipe(
    Layer.provide(registry),
    Layer.provide(permission),
    Layer.provide(Kanban.defaultLayer),
  )
  return Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(Effect.provide(Layer.mergeAll(registry, kanbanTool)))
}

const call = (input: typeof KanbanTool.Input.Type, id = "call-kanban") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "kanban", input },
})

/** Safely read a field off an unknown structured tool result without type assertions. */
const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined

const it = testEffect(Layer.empty)

describe("KanbanTool", () => {
  it.effect("registers kanban as a canonical tool", () =>
    withTool((registry) =>
      Effect.gen(function* () {
        expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual(["kanban"])
      }),
    ),
  )

  it.effect("settles create_board → create_card → update_card → list_cards and asserts permission", () =>
    withTool((registry) =>
      Effect.gen(function* () {
        const board = yield* settleTool(registry, call({ operation: "create_board", title: "Board" }))
        expect(board.result.type).toBe("json")
        const boardId = String(field(board.result.value, "id"))
        expect(field(board.result.value, "rootSessionId")).toBe(sessionID)

        const card = yield* settleTool(registry, call({ operation: "create_card", boardId, title: "task", priority: 2 }))
        expect(card.result.type).toBe("json")
        const cardId = String(field(card.result.value, "id"))
        expect(field(card.result.value, "status")).toBe("backlog")
        expect(field(card.result.value, "priority")).toBe(2)

        const moved = yield* settleTool(
          registry,
          call({ operation: "update_card", cardId, status: "in_progress", workerSessionId: "ses_worker" }),
        )
        expect(moved.result.type).toBe("json")
        expect(field(moved.result.value, "status")).toBe("in_progress")
        expect(field(moved.result.value, "workerSessionId")).toBe("ses_worker")

        const listed = yield* settleTool(registry, call({ operation: "list_cards", boardId, status: "in_progress" }))
        expect(listed.result.type).toBe("json")
        expect(listed.result.value).toEqual({ cards: [expect.objectContaining({ id: cardId })] })

        const fetched = yield* settleTool(registry, call({ operation: "get_board", boardId }))
        expect(fetched.result.type).toBe("json")
        expect(field(fetched.result.value, "title")).toBe("Board")

        expect(assertions[0]).toMatchObject({ sessionID, action: "kanban", resources: [], save: ["*"] })
        expect(assertions.map((assertion) => assertion.metadata)).toEqual([
          { operation: "create_board" },
          { operation: "create_card" },
          { operation: "update_card" },
          { operation: "list_cards" },
          { operation: "get_board" },
        ])
      }),
    ),
  )

  it.effect("fails create_board when title is missing", () =>
    withTool((registry) =>
      Effect.gen(function* () {
        const settled = yield* settleTool(registry, call({ operation: "create_board" }))
        expect(settled.result).toMatchObject({ type: "error", value: "kanban create_board requires a title" })
      }),
    ),
  )
})
