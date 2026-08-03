import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260803093115_flaky_exodus",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`CREATE INDEX \`session_message_time_updated_idx\` ON \`session_message\` (\`time_updated\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
