import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260711065920_fancy_sally_floyd",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`memory\` (
          \`key\` text PRIMARY KEY,
          \`value\` text,
          \`kind\` text DEFAULT 'general' NOT NULL,
          \`scope\` text DEFAULT 'session' NOT NULL,
          \`source\` text DEFAULT 'agent' NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
