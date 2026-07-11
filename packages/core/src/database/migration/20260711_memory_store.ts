import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260711_memory_store",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`memory\` (
          \`key\` text PRIMARY KEY,
          \`value\` text,
          \`kind\` text NOT NULL DEFAULT 'general',
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
