import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260716015517_hot_romulus",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(
        `CREATE INDEX \`session_workspace_time_created_idx\` ON \`session\` (\`workspace_id\`,\`time_created\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
