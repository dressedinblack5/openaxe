export * as ToolSearchTool from "./tool-search"

import { Effect, Layer, Schema } from "effect"
import { PermissionV2 } from "../permission"
import { PositiveInt } from "../schema"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "tool_search"

export const Input = Schema.Struct({
  query: Schema.String.annotate({ description: "Search terms to match against tool names and descriptions" }),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(50))).annotate({
    description: "Maximum results to return (default 10)",
  }),
})

export const Output = Schema.Array(
  Schema.Struct({
    name: Schema.String,
    description: Schema.String,
  }),
)

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const registry = yield* ToolRegistry.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Search the available tools by name or description. Use this to discover which tool handles a task before calling it.",
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: [input.query],
                save: ["*"],
                metadata: { query: input.query, limit: input.limit },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              const definitions = yield* registry.search(input.query, input.limit ?? 10)
              return definitions.map((definition) => ({
                name: definition.name,
                description: definition.description,
              }))
            }).pipe(Effect.orDie),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
