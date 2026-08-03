export * as Kanban from "./kanban"

import { and, eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { LayerNode } from "../effect/layer-node"
import { Identifier } from "../id/id"
import { KanbanBoardTable, KanbanCardTable } from "./kanban.sql"

export type CardStatus = "backlog" | "todo" | "in_progress" | "done" | "blocked"

export interface Board {
  readonly id: string
  readonly rootSessionId: string
  readonly title: string
  readonly status: string
  readonly timeCreated: number
  readonly timeUpdated: number
}

export interface Card {
  readonly id: string
  readonly boardId: string
  readonly rootSessionId: string
  readonly title: string
  readonly description: string | null
  readonly status: string
  readonly priority: number
  readonly position: number
  readonly workerSessionId: string | null
  readonly parentId: string | null
  readonly verification: unknown
  readonly timeCreated: number
  readonly timeUpdated: number
}

export interface CreateBoardInput {
  readonly rootSessionId: string
  readonly title: string
  readonly status?: string
}

export interface CreateCardInput {
  readonly boardId: string
  readonly rootSessionId: string
  readonly title: string
  readonly description?: string
  readonly status?: CardStatus
  readonly priority?: number
  readonly position?: number
  readonly workerSessionId?: string
  readonly parentId?: string
  readonly verification?: unknown
}

export interface UpdateCardPatch {
  readonly title?: string
  readonly description?: string
  readonly status?: CardStatus
  readonly priority?: number
  readonly position?: number
  readonly workerSessionId?: string | null
  readonly parentId?: string | null
  readonly verification?: unknown
}

export interface Interface {
  readonly createBoard: (input: CreateBoardInput) => Effect.Effect<Board>
  readonly getBoard: (boardId: string) => Effect.Effect<Board | undefined>
  readonly createCard: (input: CreateCardInput) => Effect.Effect<Card>
  readonly updateCard: (cardId: string, patch: UpdateCardPatch) => Effect.Effect<Card | undefined>
  readonly listCards: (filter?: { boardId?: string; status?: CardStatus }) => Effect.Effect<ReadonlyArray<Card>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Kanban") {}

type BoardRow = typeof KanbanBoardTable.$inferSelect
type CardRow = typeof KanbanCardTable.$inferSelect

const toBoard = (row: BoardRow): Board => ({
  id: row.id,
  rootSessionId: row.root_session_id,
  title: row.title,
  status: row.status,
  timeCreated: row.time_created,
  timeUpdated: row.time_updated,
})

const toCard = (row: CardRow): Card => ({
  id: row.id,
  boardId: row.board_id,
  rootSessionId: row.root_session_id,
  title: row.title,
  description: row.description,
  status: row.status,
  priority: row.priority,
  position: row.position,
  workerSessionId: row.worker_session_id,
  parentId: row.parent_id,
  verification: row.verification,
  timeCreated: row.time_created,
  timeUpdated: row.time_updated,
})

/**
 * Creates the kanban tables if the canonical migration has not run yet. The
 * statements are idempotent and no-ops once the migration is applied.
 */
const ensureSchema = (db: Database.Interface["db"]) =>
  Effect.gen(function* () {
    yield* db.run(`
      CREATE TABLE IF NOT EXISTS \`kanban_board\` (
        \`id\` text PRIMARY KEY,
        \`root_session_id\` text NOT NULL,
        \`title\` text NOT NULL,
        \`status\` text DEFAULT 'active' NOT NULL,
        \`time_created\` integer NOT NULL,
        \`time_updated\` integer NOT NULL
      );
    `)
    yield* db.run(`
      CREATE TABLE IF NOT EXISTS \`kanban_card\` (
        \`id\` text PRIMARY KEY,
        \`board_id\` text NOT NULL,
        \`root_session_id\` text NOT NULL,
        \`title\` text NOT NULL,
        \`description\` text,
        \`status\` text DEFAULT 'backlog' NOT NULL,
        \`priority\` integer DEFAULT 0 NOT NULL,
        \`position\` integer DEFAULT 0 NOT NULL,
        \`worker_session_id\` text,
        \`parent_id\` text,
        \`verification\` text,
        \`time_created\` integer NOT NULL,
        \`time_updated\` integer NOT NULL
      );
    `)
  }).pipe(Effect.orDie)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* ensureSchema(db)

    const createBoard = Effect.fn("Kanban.createBoard")(function* (input: CreateBoardInput) {
      const row = yield* db
        .insert(KanbanBoardTable)
        .values({
          id: Identifier.create("kbd", "ascending"),
          root_session_id: input.rootSessionId,
          title: input.title,
          status: input.status ?? "active",
        })
        .returning()
        .get()
        .pipe(Effect.orDie)
      return toBoard(row)
    })

    const getBoard = Effect.fn("Kanban.getBoard")(function* (boardId: string) {
      const row = yield* db
        .select()
        .from(KanbanBoardTable)
        .where(eq(KanbanBoardTable.id, boardId))
        .get()
        .pipe(Effect.orDie)
      return row ? toBoard(row) : undefined
    })

    const createCard = Effect.fn("Kanban.createCard")(function* (input: CreateCardInput) {
      const row = yield* db
        .insert(KanbanCardTable)
        .values({
          id: Identifier.create("card", "ascending"),
          board_id: input.boardId,
          root_session_id: input.rootSessionId,
          title: input.title,
          description: input.description ?? null,
          status: input.status ?? "backlog",
          priority: input.priority ?? 0,
          position: input.position ?? 0,
          worker_session_id: input.workerSessionId ?? null,
          parent_id: input.parentId ?? null,
          verification: input.verification ?? null,
        })
        .returning()
        .get()
        .pipe(Effect.orDie)
      return toCard(row)
    })

    const updateCard = Effect.fn("Kanban.updateCard")(function* (cardId: string, patch: UpdateCardPatch) {
      const row = yield* db
        .update(KanbanCardTable)
        .set({
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
          ...(patch.position !== undefined ? { position: patch.position } : {}),
          ...(patch.workerSessionId !== undefined ? { worker_session_id: patch.workerSessionId } : {}),
          ...(patch.parentId !== undefined ? { parent_id: patch.parentId } : {}),
          ...(patch.verification !== undefined ? { verification: patch.verification } : {}),
        })
        .where(eq(KanbanCardTable.id, cardId))
        .returning()
        .get()
        .pipe(Effect.orDie)
      return row ? toCard(row) : undefined
    })

    const listCards = Effect.fn("Kanban.listCards")(function* (filter?: { boardId?: string; status?: CardStatus }) {
      const conditions = []
      if (filter?.boardId) conditions.push(eq(KanbanCardTable.board_id, filter.boardId))
      if (filter?.status) conditions.push(eq(KanbanCardTable.status, filter.status))
      const query = db.select().from(KanbanCardTable)
      const rows = conditions.length
        ? yield* query.where(and(...conditions)).all().pipe(Effect.orDie)
        : yield* query.all().pipe(Effect.orDie)
      return rows.map(toCard)
    })

    return Service.of({ createBoard, getBoard, createCard, updateCard, listCards })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))
export const node = LayerNode.make(layer, [Database.node])
