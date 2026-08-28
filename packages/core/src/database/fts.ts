export * as FTSIndex from "./fts"

import { and, asc, eq, gt, or, sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { SessionMessage } from "../session/message"
import { SessionSchema } from "../session/schema"
import { SessionMessageTable } from "../session/sql"
import { Database } from "./database"
import { LayerNode } from "../effect/layer-node"

export const MAX_RESULTS = 50
export const INDEX_BATCH = 500
export const MAX_QUERY_LENGTH = 200

const HIGH_WATER_KEY = "high_water"
const HIGH_ROWID_KEY = "high_rowid"
const RESERVED_MATCH = /["*:^()]/g

export interface SearchResult {
  readonly sessionID: SessionSchema.ID
  readonly sessionTitle: string
  readonly messageID: SessionMessage.ID
  readonly type: SessionMessage.Type
  readonly seq: number
  readonly snippet: string
  readonly rank: number
}

export interface SearchOptions {
  readonly limit?: number
  /** Restrict the search to a single session. */
  readonly sessionID?: SessionSchema.ID
}

export interface Interface {
  readonly search: (query: string, opts?: SearchOptions) => Effect.Effect<ReadonlyArray<SearchResult>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/FTSIndex") {}

const decode = Schema.decodeUnknownEffect(SessionMessage.Message)

const MESSAGE_TYPES: ReadonlySet<string> = new Set([
  "agent-switched",
  "model-switched",
  "user",
  "synthetic",
  "system",
  "shell",
  "assistant",
  "compaction",
])
const isMessageType = (value: string): value is SessionMessage.Type => MESSAGE_TYPES.has(value)

/**
 * Project a decoded session message into the searchable text that is indexed by
 * FTS5. Mirrors the serialization done by SessionHistory (decode the `data`
 * JSON blob through the SessionMessage schema) and then extracts the human
 * content per message type.
 */
const extractText = (message: SessionMessage.Message): string => {
  switch (message.type) {
    case "user": {
      const attachments = (message.files ?? [])
        .map((file) => file.source?.text ?? "")
        .filter((text) => text.length > 0)
        .join("\n")
      return [message.text, attachments].filter((text) => text.length > 0).join("\n")
    }
    case "system":
    case "synthetic":
      return message.text
    case "shell":
      return `${message.command}\n${message.output}`
    case "compaction":
      return `${message.summary}\n${message.recent}`
    case "assistant":
      return message.content
        .filter(
          (part): part is SessionMessage.AssistantText | SessionMessage.AssistantReasoning =>
            part.type === "text" || part.type === "reasoning",
        )
        .map((part) => part.text)
        .join("\n")
    case "agent-switched":
    case "model-switched":
      return ""
    default:
      return ""
  }
}

/**
 * Turn free-form user input into a safe FTS5 MATCH expression. Reserved
 * characters that change MATCH grammar would otherwise break or rewrite the
 * query, so every whitespace-delimited token is stripped of them and wrapped
 * as a literal phrase, then ANDed together. An unbalanced quote can never
 * terminate the expression because quotes are dropped first.
 */
const sanitizeQuery = (input: string): string => {
  const normalized = input.replace(/\s+/g, " ").trim()
  if (normalized.length === 0) return ""
  const truncated = normalized.length > MAX_QUERY_LENGTH ? normalized.slice(0, MAX_QUERY_LENGTH).trimEnd() : normalized
  const balanced = (truncated.match(/"/g)?.length ?? 0) % 2 === 0 ? truncated : truncated.replaceAll('"', "")
  const tokens = balanced
    .split(" ")
    .map((token) => token.replace(RESERVED_MATCH, ""))
    .filter((token) => token.length > 0)
  if (tokens.length === 0) return ""
  return tokens.map((token) => `"${token}"`).join(" AND ")
}

const firstChars = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max)}…`)

type SearchRow = {
  readonly session_id: string
  readonly session_title: string | null
  readonly message_id: string
  readonly type: string
  readonly seq: number
  readonly snippet: string | null
  readonly text_preview: string | null
  readonly rank: number
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    // FTS5 DDL is deferred to first search (via Effect.cached) rather than run
    // at layer construction: drizzle-orm 1.0.0-rc.2 has no FTS5 virtual-table
    // support, and concurrent CREATE VIRTUAL TABLE at construction races in
    // bun:sqlite when multiple locations build simultaneously. Effect.cached
    // also gives a perf win — locations that never search never pay DDL cost.
    const ensureSchema = Effect.fn("FTSIndex.ensureSchema")(function* () {
      yield* db
        .run(
          "CREATE VIRTUAL TABLE IF NOT EXISTS session_message_fts USING fts5(session_id UNINDEXED, type UNINDEXED, text, tokenize='trigram')",
        )
        .pipe(Effect.catch(() => Effect.void))
      yield* db
        .run("CREATE TABLE IF NOT EXISTS fts_meta (key TEXT PRIMARY KEY, value INTEGER)")
        .pipe(Effect.catch(() => Effect.void))
    })
    const ensureSchemaOnce = yield* Effect.cached(ensureSchema())

    // bun:sqlite segfaults at process teardown when an FTS5 virtual table still
    // exists on a closed connection. Finalizers run LIFO, so this runs before
    // Database.defaultLayer's native close finalizer, while the connection is
    // still open.
    yield* Effect.addFinalizer(() =>
      db.run("DROP TABLE IF EXISTS session_message_fts").pipe(Effect.catch(() => Effect.void)),
    )

    /**
     * Lazily index session_message rows not yet reflected in the FTS table.
     * Runs only when called (search triggers it), never on the insert path.
     * A high-water marker in fts_meta avoids re-scanning the whole table; rows
     * are keyed by FTS rowid = session_message rowid so re-indexing is
     * idempotent. `time_updated` advances on message updates (the projector
     * rewrites assistant/shell rows in place), so in-flight messages stay fresh.
     */
    const indexPending = Effect.fn("FTSIndex.indexPending")(function* () {
      yield* ensureSchemaOnce
      const meta = yield* db.get<{ value: number }>(sql`SELECT value FROM fts_meta WHERE key = ${HIGH_WATER_KEY}`)
      const highWater = meta?.value ?? 0
      const rowMeta = yield* db.get<{ value: number }>(sql`SELECT value FROM fts_meta WHERE key = ${HIGH_ROWID_KEY}`)
      const highRowid = rowMeta?.value ?? 0
      const rows = yield* db
        .select({
          rowid: sql<number>`rowid`,
          id: SessionMessageTable.id,
          session_id: SessionMessageTable.session_id,
          type: SessionMessageTable.type,
          time_updated: SessionMessageTable.time_updated,
          data: SessionMessageTable.data,
        })
        .from(SessionMessageTable)
        .where(
          // A (time_updated, rowid) cursor, not just a timestamp: rows sharing
          // the boundary timestamp are processed in rowid order, so a batch
          // cut mid-timestamp never strands the remaining rows forever.
          or(
            gt(SessionMessageTable.time_updated, highWater),
            and(eq(SessionMessageTable.time_updated, highWater), gt(sql`rowid`, highRowid)),
          ),
        )
        .orderBy(asc(SessionMessageTable.time_updated), asc(sql`rowid`))
        .limit(INDEX_BATCH)
        .all()
      if (rows.length === 0) return
      const entries: Array<{ rowid: number; session_id: string; type: string; text: string }> = []
      for (const row of rows) {
        const decoded = yield* decode({ ...row.data, id: row.id, type: row.type }).pipe(Effect.option)
        if (Option.isNone(decoded)) continue
        const text = extractText(decoded.value)
        if (text.length === 0) continue
        entries.push({ rowid: row.rowid, session_id: row.session_id, type: row.type, text })
      }
      if (entries.length > 0)
        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            for (const entry of entries) {
              yield* tx.run(sql`DELETE FROM session_message_fts WHERE rowid = ${entry.rowid}`)
              yield* tx.run(
                sql`INSERT INTO session_message_fts (rowid, session_id, type, text) VALUES (${entry.rowid}, ${entry.session_id}, ${entry.type}, ${entry.text})`,
              )
            }
          }),
        )
      // Rows arrive ordered by (time_updated, rowid), so the last row of the
      // batch is the new cursor position.
      const last = rows[rows.length - 1]
      if (last.time_updated > highWater || last.rowid > highRowid)
        yield* db.run(
          sql`INSERT INTO fts_meta (key, value) VALUES (${HIGH_WATER_KEY}, ${last.time_updated}) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
      if (last.rowid > highRowid)
        yield* db.run(
          sql`INSERT INTO fts_meta (key, value) VALUES (${HIGH_ROWID_KEY}, ${last.rowid}) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
    })

    const search = Effect.fn("FTSIndex.search")(function* (query: string, opts?: SearchOptions) {
      const match = sanitizeQuery(query)
      if (match.length === 0) return []
      yield* indexPending().pipe(
        Effect.catch((error) => Effect.logWarning(`FTSIndex.indexPending failed, searching stale index`, error)),
      )
      const limit = Math.min(Math.max(opts?.limit ?? 10, 1), MAX_RESULTS)
      const sessionFilter = opts?.sessionID
      const rows = yield* db
        .all<SearchRow>(
          sql`
          SELECT
            f.session_id AS session_id,
            f.type AS type,
            s.title AS session_title,
            m.id AS message_id,
            m.seq AS seq,
            snippet(session_message_fts, 2, '', '', ' … ', 16) AS snippet,
            substr(f.text, 1, 400) AS text_preview,
            bm25(session_message_fts) AS rank
          FROM session_message_fts f
          JOIN session_message m ON m.rowid = f.rowid
          LEFT JOIN session s ON s.id = f.session_id
          WHERE session_message_fts MATCH ${match}
          ${sessionFilter ? sql`AND f.session_id = ${sessionFilter}` : sql``}
          ORDER BY rank ASC, m.seq DESC
          LIMIT ${limit}
        `,
        )
        .pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              yield* Effect.logWarning(`FTSIndex.search failed, returning no results`, error)
              return [] as SearchRow[]
            }),
          ),
        )
      const results: SearchResult[] = []
      for (const row of rows) {
        if (!isMessageType(row.type)) continue
        results.push({
          sessionID: SessionSchema.ID.make(row.session_id),
          sessionTitle: row.session_title ?? "",
          messageID: SessionMessage.ID.make(row.message_id),
          type: row.type,
          seq: row.seq,
          snippet: row.snippet && row.snippet.length > 0 ? row.snippet : firstChars(row.text_preview ?? "", 300),
          rank: row.rank,
        })
      }
      return results
    })

    return Service.of({ search })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))
export const node = LayerNode.make(layer, [Database.node])
