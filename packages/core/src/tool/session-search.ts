export * as SessionSearchTool from "./session-search"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { FTSIndex } from "../database/fts"
import { PermissionV2 } from "../permission"
import { PositiveInt } from "../schema"
import { SessionSchema } from "../session/schema"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "session_search"

export const Input = Schema.Struct({
  query: Schema.String.annotate({ description: "Search terms to match against past session messages" }),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(50))).annotate({
    description: "Maximum results to return (default 10)",
  }),
  sessionID: Schema.optional(SessionSchema.ID).annotate({
    description: "Restrict the search to a single session",
  }),
})

export const Output = Schema.Array(
  Schema.Struct({
    sessionID: Schema.String,
    sessionTitle: Schema.String,
    snippet: Schema.String,
  }),
)

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const fts = yield* FTSIndex.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Search past session messages across the workspace by full-text query. Returns the matching message with its session title and a snippet of surrounding text. Use this to recall prior decisions, implementations, and conversations before starting new work.",
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: [input.query],
                save: ["*"],
                metadata: { query: input.query, limit: input.limit, sessionID: input.sessionID },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              const results = yield* fts.search(input.query, {
                limit: input.limit ?? 10,
                sessionID: input.sessionID,
              })
              return results.map((result) => ({
                sessionID: result.sessionID,
                sessionTitle: result.sessionTitle,
                snippet: result.snippet,
              }))
            }).pipe(
              Effect.mapError(() => new ToolFailure({ message: `Unable to search sessions for ${input.query}` })),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
