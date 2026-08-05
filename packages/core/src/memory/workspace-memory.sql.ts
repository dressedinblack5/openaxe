import { sqliteTable, text, integer, blob, primaryKey } from "drizzle-orm/sqlite-core"

export const WorkspaceMemoryTable = sqliteTable(
  "workspace_memory",
  {
    project_id: text().notNull(),
    key: text().notNull(),
    value: text({ mode: "json" }).notNull(),
    vector: blob({ mode: "buffer" }),
    created_at: integer().notNull(),
    updated_at: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.project_id, table.key] })],
)

export * as WorkspaceMemorySql from "./workspace-memory.sql"
