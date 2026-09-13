import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260805093009_nasty_onslaught",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`workspace_memory\` (
          \`project_id\` text NOT NULL,
          \`key\` text NOT NULL,
          \`value\` text NOT NULL,
          \`vector\` blob,
          \`created_at\` integer NOT NULL,
          \`updated_at\` integer NOT NULL,
          CONSTRAINT \`workspace_memory_pk\` PRIMARY KEY(\`project_id\`, \`key\`)
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`retry_policy_overrides\` (
          \`retry_reason\` text PRIMARY KEY,
          \`max_attempts\` integer NOT NULL,
          \`base_delay_ms\` integer NOT NULL,
          \`max_delay_ms\` integer NOT NULL,
          \`backoff_multiplier\` real NOT NULL,
          \`jitter\` real NOT NULL,
          \`updated_at\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_schedule\` (
          \`session_id\` text PRIMARY KEY,
          \`cron\` text NOT NULL,
          \`next_run\` integer,
          \`enabled\` integer NOT NULL,
          \`created_at\` integer NOT NULL,
          \`updated_at\` integer NOT NULL
        );
      `)
      yield* tx.run(`ALTER TABLE \`session_message\` ADD \`vector\` blob;`)
      yield* tx.run(`ALTER TABLE \`session\` ADD \`fork_point_message_id\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
