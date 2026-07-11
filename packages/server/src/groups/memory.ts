import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export const MemoryEntry = Schema.Struct({
  key: Schema.String,
  value: Schema.Unknown,
  kind: Schema.String,
  scope: Schema.String,
  source: Schema.String,
}).annotate({ identifier: "MemoryEntry" })

export const MemoryListQuery = Schema.Struct({
  kind: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
}).annotate({ identifier: "MemoryListQuery" })

export const MemoryGroup = HttpApiGroup.make("server.memory")
  .add(
    HttpApiEndpoint.get("memory.list", "/api/memory", {
      query: MemoryListQuery,
      success: Schema.Array(MemoryEntry),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.memory.list",
        summary: "List memory entries",
        description: "List all memory entries, optionally filtered by kind, scope, or source.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("memory.get", "/api/memory/:key", {
      params: { key: Schema.String },
      success: Schema.Unknown,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.memory.get",
        summary: "Get memory value",
        description: "Get the value of a memory entry by key.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "memory",
      description: "Key-value memory store.",
    }),
  )
