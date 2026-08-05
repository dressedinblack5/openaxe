import type { Argv } from "yargs"
import { Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd, fail } from "../effect-cmd"
import { EmbedBackfill } from "@/session/embed-backfill"
import { UI } from "../ui"

export const EmbedCommand = cmd({
  command: "embed",
  describe: "embedding tools",
  builder: (yargs: Argv) => yargs.command(EmbedBackfillCommand).demandCommand(),
  async handler() {},
})

export const EmbedBackfillCommand = effectCmd({
  command: "backfill",
  describe: "embed existing session messages that lack vector data (idempotent, batch-wise)",
  builder: (yargs) =>
    yargs
      .option("project", {
        describe: "project ID to scope to (default: all sessions)",
        type: "string",
      })
      .option("batch-size", {
        describe: "rows per batch",
        type: "number",
        default: 100,
      }),
  handler: Effect.fn("Cli.embed.backfill")(function* (args) {
    const result = yield* EmbedBackfill.run({
      projectId: args.project,
      batchSize: args.batchSize,
    }).pipe(Effect.catchTag("BackfillError", (error) => fail(error.message)))
    UI.println(
      UI.Style.TEXT_SUCCESS_BOLD +
        `Backfill complete: ${result.embedded} embedded, ${result.skipped} skipped, ${result.scanned} scanned` +
        UI.Style.TEXT_NORMAL,
    )
  }),
})
