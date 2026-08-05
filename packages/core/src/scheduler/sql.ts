import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const SessionScheduleTable = sqliteTable("session_schedule", {
  session_id: text().primaryKey(),
  cron: text().notNull(),
  next_run: integer(),
  enabled: integer()
    .notNull()
    .$default(() => 1),
  created_at: integer().notNull(),
  updated_at: integer().notNull(),
})

export * as SchedulerSql from "./sql"
