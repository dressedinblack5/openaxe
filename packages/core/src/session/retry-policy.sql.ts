import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core"

export const RetryPolicyOverridesTable = sqliteTable("retry_policy_overrides", {
  retry_reason: text().primaryKey(),
  max_attempts: integer().notNull(),
  base_delay_ms: integer().notNull(),
  max_delay_ms: integer().notNull(),
  backoff_multiplier: real().notNull(),
  jitter: real().notNull(),
  updated_at: integer().notNull(),
})

export * as RetryPolicyOverridesSql from "./retry-policy.sql"
