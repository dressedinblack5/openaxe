import { Effect, Schema } from "effect"
import { ToolRegistry } from "./registry"
import type { Context, ExecuteResult } from "./tool"
import { define } from "./tool"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Search terms to match against tool names and descriptions" }),
  limit: Schema.optional(Schema.Int).annotate({ description: "Maximum results to return (default 10)" }),
})

export const ToolSearchTool = define<typeof Parameters, { query: string; count: number }, never>(
  "tool_search",
  Effect.gen(function* () {
    const execute = (params: Schema.Schema.Type<typeof Parameters>, ctx: Context<{ query: string; count: number }>) =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "tool_search",
          patterns: [params.query],
          always: ["*"],
          metadata: { query: params.query, limit: params.limit },
        })
        const registry = yield* ToolRegistry.Service
        const limit = Math.min(Math.max(params.limit ?? 10, 1), 50)
        const query = params.query.trim().toLowerCase()
        const tools = yield* registry.all()
        const scored = tools
          .map((tool) => {
            const name = tool.id.toLowerCase()
            const description = tool.description.toLowerCase()
            let score = 0
            if (name.includes(query)) score += 2
            if (description.includes(query)) score += 1
            return { tool, score }
          })
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score || a.tool.id.localeCompare(b.tool.id))
          .slice(0, limit)
        if (scored.length === 0) {
          return {
            title: "No matching tools",
            output: `No tools match "${params.query}".`,
            metadata: { query: params.query, count: 0 },
          }
        }
        const output = scored.map(({ tool }) => `${tool.id}: ${tool.description}`).join("\n")
        return {
          title: `${scored.length} matching tool${scored.length === 1 ? "" : "s"}`,
          output,
          metadata: { query: params.query, count: scored.length },
        }
      }) as Effect.Effect<ExecuteResult<{ query: string; count: number }>>
    return {
      description:
        "Search the available tools by name or description. Use this to discover which tool handles a task before calling it.",
      parameters: Parameters,
      execute,
    }
  }),
)
