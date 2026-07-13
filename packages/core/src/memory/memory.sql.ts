import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"

export const MemoryTable = sqliteTable("memory", {
  key: text().primaryKey(),
  value: text({ mode: "json" }),
  kind: text().notNull().default("general"),
  scope: text().notNull().default("session"),
  source: text().notNull().default("agent"),
  ...Timestamps,
})
