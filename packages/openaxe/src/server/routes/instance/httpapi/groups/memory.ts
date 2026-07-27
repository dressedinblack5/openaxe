import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

export const MemoryEntry = Schema.Struct({
  key: Schema.String,
  value: Schema.Unknown,
  kind: Schema.String,
  scope: Schema.String,
  source: Schema.String,
}).annotate({ identifier: "MemoryEntry" })

export const MemoryList = Schema.Array(MemoryEntry)

export const SetPayload = Schema.Struct({
  key: Schema.String,
  value: Schema.Unknown,
  scope: Schema.optional(Schema.String),
  source: Schema.optional(Schema.String),
})

export const MemoryApi = HttpApi.make("memory").add(
  HttpApiGroup.make("memory")
    .add(
      HttpApiEndpoint.get("list", "/memory", {
        query: WorkspaceRoutingQuery,
        success: described(MemoryList, "All memory entries"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "memory.list",
          summary: "List memory entries",
        }),
      ),
      HttpApiEndpoint.post("set", "/memory", {
        query: WorkspaceRoutingQuery,
        payload: SetPayload,
        success: described(MemoryEntry, "Memory entry set"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "memory.set",
          summary: "Set memory entry",
        }),
      ),
      HttpApiEndpoint.get("get", "/memory/:key", {
        query: WorkspaceRoutingQuery,
        params: { key: Schema.String },
        success: described(MemoryEntry, "Memory entry"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "memory.get",
          summary: "Get memory entry",
        }),
      ),
      HttpApiEndpoint.delete("remove", "/memory/:key", {
        query: WorkspaceRoutingQuery,
        params: { key: Schema.String },
        success: described(Schema.Struct({ removed: Schema.Boolean }), "Memory entry removed"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "memory.remove",
          summary: "Remove memory entry",
        }),
      ),
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "memory",
        description: "Memory key-value store.",
      }),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
