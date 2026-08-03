import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260803083446_youthful_captain_britain",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`kanban_board\` (
          \`id\` text PRIMARY KEY,
          \`root_session_id\` text NOT NULL,
          \`title\` text NOT NULL,
          \`status\` text DEFAULT 'active' NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`kanban_card\` (
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
    })
  },
} satisfies DatabaseMigration.Migration
