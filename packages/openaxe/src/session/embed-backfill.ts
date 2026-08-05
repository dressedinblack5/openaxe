export * as EmbedBackfill from "./embed-backfill"

import { and, eq, inArray, isNull } from "drizzle-orm"
import { Buffer } from "node:buffer"
import { Effect, Option, Schema } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { Embedding } from "@opencode-ai/core/embedding/embedding"
import { ProjectV2 } from "@opencode-ai/core/project"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { Vector } from "@opencode-ai/core/vector/vector"

/**
 * Batch backfill for `openaxe embed backfill`: embeds existing `session_message`
 * rows that lack vector data (rows with a durable vector blob are skipped, so
 * re-runs are idempotent and resumable — a second run continues where the first
 * stopped). Each batch embeds via EmbeddingService and inserts into
 * `session_message_vec` via VectorService, then marks the durable row so a
 * crash between batches only repeats the interrupted batch.
 */

export class BackfillError extends Schema.TaggedErrorClass<BackfillError>()("BackfillError", {
  message: Schema.String,
}) {}

export type BackfillResult = {
  readonly scanned: number
  readonly embedded: number
  readonly skipped: number
}

export const run = (
  input: { projectId?: string; batchSize?: number },
): Effect.Effect<BackfillResult, BackfillError, Database.Service> =>
  Effect.gen(function* () {
    const embedding = yield* Effect.serviceOption(Embedding.Service)
    if (Option.isNone(embedding)) {
      return yield* new BackfillError({ message: "embedding provider not configured" })
    }
    const vector = yield* Effect.serviceOption(Vector.Service)
    if (Option.isNone(vector)) {
      return yield* new BackfillError({ message: "vector service unavailable" })
    }

    const batchSize = Math.max(1, input.batchSize ?? 100)
    const { db } = yield* Database.Service

    let scanned = 0
    let embedded = 0
    let skipped = 0
    while (true) {
      const batch = yield* nextBatch(db, input.projectId, batchSize)
      if (batch.length === 0) break
      scanned += batch.length

      const entries = batch.flatMap((row) => {
        const text = embeddableText(row.type, row.data)
        if (text === undefined) return []
        return [{ id: row.id, sessionId: row.session_id, text }]
      })
      skipped += batch.length - entries.length

      if (entries.length > 0) {
        const embeddedVectors = yield* embedding.value.embed(entries.map((entry) => entry.text)).pipe(
          Effect.mapError(
            (error): BackfillError => new BackfillError({ message: `embedding failed: ${errorMessage(error)}` }),
          ),
        )
        for (let i = 0; i < entries.length; i++) {
          const vectorValue = embeddedVectors.vectors[i]
          if (vectorValue === undefined) continue
          yield* vector.value.insert("session_message", entries[i].id, vectorValue, {
            sessionId: entries[i].sessionId,
          }).pipe(
            Effect.mapError(
              (error): BackfillError => new BackfillError({ message: `vector insert failed: ${errorMessage(error)}` }),
            ),
          )
          // Mark the row durable so `vector IS NULL` skips it on re-runs.
          yield* db
            .update(SessionMessageTable)
            .set({ vector: Buffer.from(new Float32Array(vectorValue).buffer) })
            .where(eq(SessionMessageTable.id, SessionMessage.ID.make(entries[i].id)))
            .run()
            .pipe(Effect.orDie)
          embedded++
        }
      }
      yield* Effect.logInfo("embed backfill", { scanned, embedded, skipped })
    }
    return { scanned, embedded, skipped }
  })

const nextBatch = (
  db: Database.Interface["db"],
  projectId: string | undefined,
  limit: number,
): Effect.Effect<
  ReadonlyArray<{ id: string; session_id: string; type: string; data: unknown }>,
  never,
  never
> => {
  const base = db
    .select({
      id: SessionMessageTable.id,
      session_id: SessionMessageTable.session_id,
      type: SessionMessageTable.type,
      data: SessionMessageTable.data,
    })
    .from(SessionMessageTable)
  // Only text-bearing types are ever embeddable, so skip the rest at the query
  // level — re-runs then only touch rows that can actually be embedded.
  const conditions = [isNull(SessionMessageTable.vector), inArray(SessionMessageTable.type, EMBEDDABLE_TYPES)]
  const query =
    projectId === undefined
      ? base.where(and(...conditions))
      : base
          .innerJoin(SessionTable, eq(SessionMessageTable.session_id, SessionTable.id))
          .where(and(...conditions, eq(SessionTable.project_id, ProjectV2.ID.make(projectId))))
  return query.orderBy(SessionMessageTable.seq).limit(limit).all().pipe(Effect.orDie)
}

const EMBEDDABLE_TYPES: readonly SessionMessage.Type[] = ["user", "system", "synthetic", "compaction", "shell"]

const errorMessage = (error: { _tag: string; message?: string }): string => error.message ?? error._tag

/**
 * Text-bearing message types mirror `forkEmbedding`'s embeddableText switch
 * (packages/core/src/session/message-updater.ts): user/system/synthetic text,
 * compaction summary, shell command. Assistant rows are skipped — their content
 * is streamed via many updates and embedding whole rows would duplicate vec
 * rows. `data` is unvalidated JSON from the DB, so extraction is defensive.
 */
const embeddableText = (type: string, data: unknown): string | undefined => {
  if (!isRecord(data)) return undefined
  if (type === "shell") return typeof data.command === "string" ? data.command : undefined
  if (type === "compaction") return typeof data.summary === "string" ? data.summary : undefined
  if (type === "user" || type === "system" || type === "synthetic") return typeof data.text === "string" ? data.text : undefined
  return undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
