import { and, asc, desc, eq, gt, gte, ne, or } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Database } from "../database/database"
import { MessageDecodeError } from "./error"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionContextEpochTable, SessionMessageTable } from "./sql"

type DatabaseService = Database.Interface["db"]

const decode = Schema.decodeUnknownEffect(SessionMessage.Message)

const latestCompaction = Effect.fnUntraced(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  return yield* db
    .select({ seq: SessionMessageTable.seq })
    .from(SessionMessageTable)
    .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "compaction")))
    .orderBy(desc(SessionMessageTable.seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
})

const epochQuery = (sessionID: SessionSchema.ID) =>
  (db: DatabaseService) =>
    db
      .select({ baselineSeq: SessionContextEpochTable.baseline_seq })
      .from(SessionContextEpochTable)
      .where(eq(SessionContextEpochTable.session_id, sessionID))
      .get()

const compactionQuery = (sessionID: SessionSchema.ID) =>
  (db: DatabaseService) =>
    db
      .select({ seq: SessionMessageTable.seq })
      .from(SessionMessageTable)
      .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "compaction")))
      .orderBy(desc(SessionMessageTable.seq))
      .limit(1)
      .get()

// Single query with subqueries to eliminate N+1 pattern
const messageRowsOptimized = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
) {
  const [epochResult, compactionResult] = yield* Effect.all([
    epochQuery(sessionID)(db),
    compactionQuery(sessionID)(db),
  ], { concurrency: "unbounded" })

  const baselineSeq = epochResult?.baselineSeq
  const compactionSeq = compactionResult?.seq

  const whereClause = and(
    eq(SessionMessageTable.session_id, sessionID),
    compactionSeq
      ? or(
          gte(SessionMessageTable.seq, compactionSeq),
          baselineSeq === undefined
            ? undefined
            : and(eq(SessionMessageTable.type, "system"), gt(SessionMessageTable.seq, baselineSeq)),
        )
      : undefined,
    baselineSeq === undefined
      ? undefined
      : or(ne(SessionMessageTable.type, "system"), gt(SessionMessageTable.seq, baselineSeq)),
  )

  const rows = yield* db
    .select()
    .from(SessionMessageTable)
    .where(whereClause)
    .orderBy(asc(SessionMessageTable.seq))
    .all()
    .pipe(Effect.orDie)
  return rows
})

const messageRows = Effect.fnUntraced(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  compaction: { readonly seq: number } | undefined,
  baselineSeq?: number,
) {
  const rows = yield* db
    .select()
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, sessionID),
        compaction
          ? or(
              gte(SessionMessageTable.seq, compaction.seq),
              baselineSeq === undefined
                ? undefined
                : and(eq(SessionMessageTable.type, "system"), gt(SessionMessageTable.seq, baselineSeq)),
            )
          : undefined,
        baselineSeq === undefined
          ? undefined
          : or(ne(SessionMessageTable.type, "system"), gt(SessionMessageTable.seq, baselineSeq)),
      ),
    )
    .orderBy(asc(SessionMessageTable.seq))
    .all()
    .pipe(Effect.orDie)
  return rows
})

const decodeMessageRow = (row: typeof SessionMessageTable.$inferSelect) =>
  decode({ ...row.data, id: row.id, type: row.type }).pipe(
    Effect.mapError(
      () =>
        new MessageDecodeError({
          sessionID: SessionSchema.ID.make(row.session_id),
          messageID: SessionMessage.ID.make(row.id),
        }),
    ),
  )

export const load = Effect.fn("SessionHistory.load")(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  const rows = yield* messageRowsOptimized(db, sessionID).pipe(Effect.orDie)
  const messages = yield* Effect.forEach(rows, decodeMessageRow, {
    concurrency: "unbounded",
  }).pipe(Effect.mapError(() => new MessageDecodeError({ sessionID, messageID: SessionMessage.ID.make("unknown") })))
  return messages
})

export const loadForRunner = Effect.fn("SessionHistory.loadForRunner")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  baselineSeq: number,
) {
  return (yield* entriesForRunner(db, sessionID, baselineSeq)).map((entry) => entry.message)
})

export const entriesForRunner = Effect.fn("SessionHistory.entriesForRunner")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  baselineSeq: number,
) {
  const rows = yield* messageRows(db, sessionID, yield* latestCompaction(db, sessionID), baselineSeq)
  return yield* Effect.forEach(
    rows,
    (row) => decodeMessageRow(row).pipe(Effect.map((message) => ({ seq: row.seq, message }))),
    { concurrency: "unbounded" },
  ).pipe(Effect.mapError(() => new MessageDecodeError({ sessionID, messageID: SessionMessage.ID.make("unknown") })))
})

// ponytail: bounded 1-row load for failInterruptedTools, avoids loading all messages
export const loadLatestAssistant = Effect.fn("SessionHistory.loadLatestAssistant")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
) {
  const row = yield* db
    .select()
    .from(SessionMessageTable)
    .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "assistant")))
    .orderBy(desc(SessionMessageTable.seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  if (!row) return undefined
  return yield* decodeMessageRow(row)
})

export { latestCompaction }
export * as SessionHistory from "./history"
