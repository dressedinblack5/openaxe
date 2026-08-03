import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"

export const KanbanBoardTable = sqliteTable("kanban_board", {
  id: text().primaryKey(),
  root_session_id: text().notNull(),
  title: text().notNull(),
  status: text().notNull().default("active"),
  ...Timestamps,
})

export const KanbanCardTable = sqliteTable("kanban_card", {
  id: text().primaryKey(),
  board_id: text().notNull(),
  root_session_id: text().notNull(),
  title: text().notNull(),
  description: text(),
  status: text().notNull().default("backlog"),
  priority: integer().notNull().default(0),
  position: integer().notNull().default(0),
  worker_session_id: text(),
  parent_id: text(),
  verification: text({ mode: "json" }),
  ...Timestamps,
})
