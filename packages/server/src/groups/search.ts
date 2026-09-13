import { ProjectV2 } from "@opencode-ai/core/project"
import { PositiveInt } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError, ServiceUnavailableError, SessionNotFoundError } from "../errors"
import { SessionLocationMiddleware } from "../middleware/session-location"
import { LocationMiddleware } from "./location"
import { httpError } from "./util"

const SearchQueryFields = {
  q: Schema.String.annotate({ description: "Natural-language query to match against past session messages" }),
  k: Schema.NumberFromString.pipe(Schema.decodeTo(PositiveInt), Schema.optional).annotate({
    description: "Maximum results to return (default 10)",
  }),
}

export const SessionSearchQuery = Schema.Struct(SearchQueryFields).annotate({ identifier: "SessionSearchQuery" })

export const GlobalSearchQuery = Schema.Struct({
  ...SearchQueryFields,
  projectId: ProjectV2.ID.pipe(Schema.optional).annotate({
    description: "Project to search within. Defaults to the request location's project.",
  }),
}).annotate({ identifier: "GlobalSearchQuery" })

export const SearchHit = Schema.Struct({
  sessionId: Schema.String,
  messageId: Schema.String,
  content: Schema.String,
  score: Schema.Number,
}).annotate({ identifier: "SearchHit" })

export const SearchGroup = HttpApiGroup.make("server.search")
  .add(
    HttpApiEndpoint.get("session.search", "/api/session/:sessionID/search", {
      params: { sessionID: SessionV2.ID },
      query: SessionSearchQuery,
      success: Schema.Struct({ results: Schema.Array(SearchHit) }),
      error: httpError([InvalidRequestError, SessionNotFoundError, ServiceUnavailableError]),
    })
      .middleware(SessionLocationMiddleware)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.session.search",
          summary: "Semantic search within a session",
          description:
            "Embed the query and return the k most semantically relevant messages in the session, ordered by relevance (lower cosine distance first).",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("search.global", "/api/search", {
      query: GlobalSearchQuery,
      success: Schema.Struct({ results: Schema.Array(SearchHit) }),
      error: httpError([InvalidRequestError, ServiceUnavailableError]),
    })
      .middleware(LocationMiddleware)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.search.global",
          summary: "Semantic search across a project",
          description:
            "Embed the query and return the k most semantically relevant messages across all sessions in the project, ordered by relevance.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "search",
      description: "Experimental semantic search routes.",
    }),
  )
