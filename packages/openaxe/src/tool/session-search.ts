import { Effect, Schema } from "effect"
import { FTSIndex } from "@opencode-ai/core/database/fts"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import type { Context, ExecuteResult } from "./tool"
import { define } from "./tool"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Search terms to match against past session messages" }),
  limit: Schema.optional(Schema.Int).annotate({ description: "Maximum results to return (default 10)" }),
  sessionID: Schema.optional(Schema.String).annotate({ description: "Restrict the search to a single session" }),
})

export const SessionSearchTool = define<typeof Parameters, { query: string; count: number }, FTSIndex.Service>(
  "session_search",
  Effect.gen(function* () {
    const fts = yield* FTSIndex.Service
    const execute = (params: Schema.Schema.Type<typeof Parameters>, ctx: Context<{ query: string; count: number }>) =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "session_search",
          patterns: [params.query],
          always: ["*"],
          metadata: { query: params.query, limit: params.limit, sessionID: params.sessionID },
        })
        const results = yield* fts.search(params.query, {
          limit: params.limit ?? 10,
          sessionID: params.sessionID ? SessionSchema.ID.make(params.sessionID) : undefined,
        })
        if (results.length === 0) {
          return {
            title: "No matching sessions",
            output: "No past session messages match the query.",
            metadata: { query: params.query, count: 0 },
          }
        }
        const output = results
          .map(
            (result) =>
              `[${result.sessionTitle ?? result.sessionID}]\n  ${result.snippet}\n  (session ${result.sessionID})`,
          )
          .join("\n\n")
        return {
          title: `${results.length} matching session message${results.length === 1 ? "" : "s"}`,
          output,
          metadata: { query: params.query, count: results.length },
        }
      }) as Effect.Effect<ExecuteResult<{ query: string; count: number }>>
    return {
      description:
        "Search past session messages across the workspace by full-text query. Returns the matching message with its session title and a snippet of surrounding text. Use this to recall prior decisions, implementations, and conversations before starting new work.",
      parameters: Parameters,
      execute,
    }
  }),
)
