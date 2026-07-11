import { Artifact } from "@opencode-ai/core/artifact"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export const ArtifactEntry = Schema.Struct({
  key: Schema.String,
  version: Schema.Number,
  content: Schema.String,
  size: Schema.Number,
  truncated: Schema.Boolean,
  timeCreated: Schema.Number,
  overflowPath: Schema.optional(Schema.String),
}).annotate({ identifier: "ArtifactEntry" })

export const ArtifactSummary = Schema.Struct({
  key: Schema.String,
  version: Schema.Number,
  size: Schema.Number,
  truncated: Schema.Boolean,
  timeCreated: Schema.Number,
  overflowPath: Schema.optional(Schema.String),
}).annotate({ identifier: "ArtifactSummary" })

export const ArtifactStoreInput = Schema.Struct({
  key: Schema.String,
  content: Schema.String,
}).annotate({ identifier: "ArtifactStoreInput" })

export const ArtifactListQuery = Schema.Struct({
  keyPrefix: Schema.optional(Schema.String),
}).annotate({ identifier: "ArtifactListQuery" })

export const ArtifactGroup = HttpApiGroup.make("server.artifact")
  .add(
    HttpApiEndpoint.get("artifact.list", "/api/artifact", {
      query: ArtifactListQuery,
      success: Schema.Array(ArtifactSummary),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.artifact.list",
        summary: "List artifacts",
        description: "List all artifact versions, optionally filtered by key prefix.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("artifact.getLatest", "/api/artifact/:key", {
      params: { key: Schema.String },
      success: Schema.UndefinedOr(ArtifactEntry),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.artifact.getLatest",
        summary: "Get latest artifact",
        description: "Get the latest version of an artifact by key.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("artifact.getVersion", "/api/artifact/:key/:version", {
      params: { key: Schema.String, version: Schema.NumberFromString },
      success: Schema.UndefinedOr(ArtifactEntry),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.artifact.getVersion",
        summary: "Get artifact version",
        description: "Get a specific version of an artifact.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("artifact.store", "/api/artifact", {
      payload: ArtifactStoreInput,
      success: ArtifactEntry,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.artifact.store",
        summary: "Store artifact",
        description: "Store content as a new version of an artifact key.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "artifact",
      description: "Versioned artifact storage.",
    }),
  )
