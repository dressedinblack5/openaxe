import { Database } from "@opencode-ai/core/database/database"
import { Embedding } from "@opencode-ai/core/embedding/embedding"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionMessageTable } from "@opencode-ai/core/session/sql"
import { Vector } from "@opencode-ai/core/vector/vector"
import { inArray, sql, type SQL } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { InvalidRequestError, ServiceUnavailableError } from "../errors"

const DefaultSearchLimit = 10

const unavailable = (service: string) => new ServiceUnavailableError({ message: `${service} unavailable`, service })

/**
 * Embed the query and run a vec0 k-NN search over session_message_vec with the
 * given SQL filter, joining back to the durable session_message rows for
 * content. Results are sorted by ascending cosine distance (lower = more
 * relevant) — VectorService already orders by distance.
 */
export const searchMessages: (
  query: string,
  k: number,
  filter: SQL | undefined,
) => Effect.Effect<
  Array<{ sessionId: string; messageId: string; content: string; score: number }>,
  ServiceUnavailableError,
  Database.Service
> = (query, k, filter) =>
  Effect.gen(function* () {
    const embedding = yield* Effect.serviceOption(Embedding.Service)
    const vector = yield* Effect.serviceOption(Vector.Service)
    if (Option.isNone(embedding) || Option.isNone(vector)) return yield* Effect.fail(unavailable("Embedding service"))
    const embedded = yield* embedding.value.embed([query]).pipe(Effect.mapError(() => unavailable("Embedding service")))
    const queryVector = embedded.vectors[0]
    if (queryVector === undefined) return yield* Effect.fail(unavailable("Embedding service"))
    const hits = yield* vector.value
      .search("session_message", queryVector, k, filter)
      .pipe(Effect.mapError(() => unavailable("Vector service")))
    if (hits.length === 0) return []
    const { db } = yield* Database.Service
    const rows = yield* db
      .select()
      .from(SessionMessageTable)
      .where(
        inArray(
          SessionMessageTable.id,
          hits.map((hit) => SessionMessage.ID.make(hit.id)),
        ),
      )
      .all()
      .pipe(Effect.orDie)
    const byId = new Map(rows.map((row) => [row.id, row]))
    return hits.flatMap((hit) => {
      const row = byId.get(SessionMessage.ID.make(hit.id))
      return row
        ? [
            {
              sessionId: row.session_id,
              messageId: row.id,
              content: contentOf(row.type, row.data, row.id),
              score: hit.score,
            },
          ]
        : []
    })
  })

/** Project a durable message row into the searchable content, mirroring FTSIndex.extractText. */
function contentOf(type: SessionMessage.Type, data: Record<string, unknown>, id: SessionMessage.ID): string {
  // The row's data is the encoded message minus type/id; reconstruct and decode
  // through the canonical schema so extraction is fully typed (no casts).
  const message = Schema.decodeUnknownSync(SessionMessage.Message)({ id, type, ...data })
  switch (message.type) {
    case "user":
      return [message.text, textOf((message.files ?? []).map((file) => file.source?.text ?? ""))]
        .filter(Boolean)
        .join("\n")
    case "system":
    case "synthetic":
      return message.text
    case "shell":
      return [message.command, message.output].filter(Boolean).join("\n")
    case "compaction":
      return [message.summary, message.recent].filter(Boolean).join("\n")
    case "assistant":
      return message.content
        .filter(
          (part): part is SessionMessage.AssistantText | SessionMessage.AssistantReasoning =>
            part.type === "text" || part.type === "reasoning",
        )
        .map((part) => part.text)
        .filter(Boolean)
        .join("\n")
    default:
      return ""
  }
}

const textOf = (values: ReadonlyArray<string>) => values.filter((value) => value.length > 0).join("\n")

const requireQuery = (q: string) =>
  q.trim().length === 0
    ? Effect.fail(new InvalidRequestError({ message: "Query is required", field: "q" }))
    : Effect.succeed(q.trim())

export const SearchHandler = HttpApiBuilder.group(Api, "server.search", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "session.search",
        Effect.fn(function* (ctx) {
          const query = yield* requireQuery(ctx.query.q)
          return {
            results: yield* searchMessages(
              query,
              ctx.query.k ?? DefaultSearchLimit,
              sql`session_id = ${ctx.params.sessionID}`,
            ),
          }
        }),
      )
      .handle(
        "search.global",
        Effect.fn(function* (ctx) {
          const query = yield* requireQuery(ctx.query.q)
          const location = yield* Effect.serviceOption(Location.Service)
          const projectId =
            ctx.query.projectId ??
            Option.getOrElse(
              Option.map(location, (loc) => loc.project.id),
              () => ProjectV2.ID.make("default"),
            )
          return {
            results: yield* searchMessages(query, ctx.query.k ?? DefaultSearchLimit, sql`project_id = ${projectId}`),
          }
        }),
      )
  }),
)
