export * as WorkspaceMemory from "./workspace-memory"

import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Result } from "effect"
import { Database } from "../database/database"
import { Embedding } from "../embedding/embedding"
import { Location } from "../location"
import { Project } from "../project"
import { WorkspaceMemoryTable } from "./workspace-memory.sql"

// ponytail: single shared scope when no Location is in context (direct/standalone use).
// The real scope always comes from Location.Service.project.id inside LocationServiceMap.
const DEFAULT_PROJECT = Project.ID.make("default")

/** Name of the vec0 virtual table backing semantic search. Contracted with the
 * vector layer (T5); kept in sync here because entries are written by this service. */
export const VEC_TABLE = "workspace_memory_vec"

export interface SearchHit {
  readonly key: string
  readonly value: string
  /** Cosine distance from the query — lower is more relevant. */
  readonly score: number
}

export interface Interface {
  readonly get: (key: string) => Effect.Effect<Option.Option<string>>
  readonly set: (key: string, value: string) => Effect.Effect<void>
  readonly delete: (key: string) => Effect.Effect<void>
  readonly search: (query: string, k: number) => Effect.Effect<ReadonlyArray<SearchHit>>
  readonly list: () => Effect.Effect<ReadonlyArray<string>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/WorkspaceMemory") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const embedding = yield* Embedding.Service

    // bun:sqlite segfaults at process teardown when a vec0 virtual table still
    // exists on a closed connection (same class of bug as FTS5, see fts.ts).
    // Finalizers run LIFO, so this drops the table before Database.defaultLayer's
    // native close finalizer. workspace_memory rows are untouched — the derived
    // index is recreated lazily on the next set()/search() from stored blobs.
    yield* Effect.addFinalizer(() =>
      db.run(`DROP TABLE IF EXISTS ${VEC_TABLE}`).pipe(Effect.catchCause(() => Effect.void)),
    )

    const projectID = (): Effect.Effect<Project.ID> =>
      Effect.map(
        Effect.serviceOption(Location.Service),
        (location) =>
          Option.getOrElse(Option.map(location, (loc) => loc.project.id), () => DEFAULT_PROJECT),
      )

    const ensureVecTable = (dimension: number): Effect.Effect<void, unknown> =>
      db.run(sql`CREATE VIRTUAL TABLE IF NOT EXISTS ${sql.raw(VEC_TABLE)} USING vec0(
        vector float[${sql.raw(String(dimension))}] distance_metric=cosine, project_id text, key text
      )`).pipe(Effect.map(() => undefined))

    const upsertVecRow = (pid: Project.ID, key: string, vector: Buffer): Effect.Effect<void, unknown> =>
      Effect.gen(function* () {
        yield* db.run(sql`DELETE FROM ${sql.raw(VEC_TABLE)} WHERE project_id = ${pid} AND key = ${key}`)
        yield* db.run(sql`INSERT INTO ${sql.raw(VEC_TABLE)} (vector, project_id, key) VALUES (${vector}, ${pid}, ${key})`)
      })

    // Rebuild the search index from the durable blobs (idempotent) — covers the
    // dropped-at-teardown table and rows whose vec write failed at set time.
    const backfillVecTable = (): Effect.Effect<void, unknown> =>
      db.run(sql`
        INSERT INTO ${sql.raw(VEC_TABLE)} (vector, project_id, key)
        SELECT vector, project_id, key FROM ${sql.identifier("workspace_memory")}
        WHERE vector IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM ${sql.raw(VEC_TABLE)} v
            WHERE v.key = workspace_memory.key AND v.project_id = workspace_memory.project_id
          )
      `).pipe(Effect.map(() => undefined))

    // Embedding is an enhancement: a failure (provider down, dimension mismatch,
    // vec0 unavailable) never blocks the durable key-value write.
    const vectorFor = (value: string): Effect.Effect<Buffer | undefined> =>
      Effect.gen(function* () {
        const result = yield* embedding.embed([value]).pipe(Effect.result)
        if (Result.isFailure(result)) {
          const failure = result.failure
          const detail = "message" in failure ? `: ${failure.message}` : ""
          yield* Effect.logWarning(`WorkspaceMemory: embedding failed, persisting without vector (${failure._tag}${detail})`)
          return undefined
        }
        const vector = result.success.vectors[0]
        if (!vector || vector.length === 0) return undefined
        return Buffer.from(new Float32Array(vector).buffer)
      })

    const get = (key: string): Effect.Effect<Option.Option<string>> =>
      Effect.gen(function* () {
        const pid = yield* projectID()
        const row = yield* db
          .select()
          .from(WorkspaceMemoryTable)
          .where(and(eq(WorkspaceMemoryTable.project_id, pid), eq(WorkspaceMemoryTable.key, key)))
          .get()
          .pipe(Effect.orDie)
        return row ? Option.some(String(row.value)) : Option.none()
      })

    const set = (key: string, value: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        const pid = yield* projectID()
        const now = Date.now()
        const vector = yield* vectorFor(value)
        const existing = yield* db
          .select()
          .from(WorkspaceMemoryTable)
          .where(and(eq(WorkspaceMemoryTable.project_id, pid), eq(WorkspaceMemoryTable.key, key)))
          .get()
          .pipe(Effect.orDie)
        if (existing) {
          yield* db
            .update(WorkspaceMemoryTable)
            .set({ value, vector, updated_at: now })
            .where(and(eq(WorkspaceMemoryTable.project_id, pid), eq(WorkspaceMemoryTable.key, key)))
            .run()
            .pipe(Effect.orDie)
        } else {
          yield* db
            .insert(WorkspaceMemoryTable)
            .values({ project_id: pid, key, value, vector, created_at: now, updated_at: now })
            .run()
            .pipe(Effect.orDie)
        }
        if (vector) {
          const dimension = vector.byteLength / 4
          yield* ensureVecTable(dimension)
            .pipe(Effect.flatMap(() => upsertVecRow(pid, key, vector)))
            .pipe(Effect.catchCause(() => Effect.void)) // ponytail: vec index is best-effort; row is already durable
        }
      })

    const remove = (key: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        const pid = yield* projectID()
        yield* db
          .run(sql`DELETE FROM ${sql.raw(VEC_TABLE)} WHERE project_id = ${pid} AND key = ${key}`)
          .pipe(Effect.catch(() => Effect.void))
        yield* db
          .delete(WorkspaceMemoryTable)
          .where(and(eq(WorkspaceMemoryTable.project_id, pid), eq(WorkspaceMemoryTable.key, key)))
          .run()
          .pipe(Effect.orDie)
      })

    const list = (): Effect.Effect<ReadonlyArray<string>> =>
      Effect.gen(function* () {
        const pid = yield* projectID()
        const rows = yield* db
          .select({ key: WorkspaceMemoryTable.key })
          .from(WorkspaceMemoryTable)
          .where(eq(WorkspaceMemoryTable.project_id, pid))
          .orderBy(asc(WorkspaceMemoryTable.key))
          .all()
          .pipe(Effect.orDie)
        return rows.map((row) => row.key)
      })

    const search = (query: string, k: number): Effect.Effect<ReadonlyArray<SearchHit>> =>
      Effect.gen(function* () {
        const pid = yield* projectID()
        const result = yield* embedding.embed([query]).pipe(Effect.result)
        if (Result.isFailure(result)) return []
        const vector = result.success.vectors[0]
        if (!vector || vector.length === 0) return []
        // Index may have been dropped at last teardown — recreate + backfill from blobs.
        yield* ensureVecTable(vector.length)
          .pipe(Effect.flatMap(() => backfillVecTable()))
          .pipe(Effect.catchCause(() => Effect.void))
        const matches = yield* db
          .all<{ key: string; distance: number }>(sql`
            SELECT key, distance FROM ${sql.raw(VEC_TABLE)}
            WHERE vector MATCH ${Buffer.from(new Float32Array(vector).buffer)} AND project_id = ${pid}
            ORDER BY distance LIMIT ${k}
          `)
          .pipe(Effect.catchCause(() => Effect.succeed([] as Array<{ key: string; distance: number }>))) // ponytail: vec unavailable / dim mismatch → no hits, not an error
        if (matches.length === 0) return []
        const keys = [...new Set(matches.map((match) => match.key))]
        const rows = yield* db
          .select()
          .from(WorkspaceMemoryTable)
          .where(and(eq(WorkspaceMemoryTable.project_id, pid), inArray(WorkspaceMemoryTable.key, keys)))
          .all()
          .pipe(Effect.orDie)
        const byKey = new Map(rows.map((row) => [row.key, row]))
        return matches.flatMap((match) => {
          const row = byKey.get(match.key)
          return row ? [{ key: match.key, value: String(row.value), score: match.distance }] : []
        })
      })

    return Service.of({ get, set, delete: remove, search, list })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Database.defaultLayer),
  Layer.provide(Embedding.defaultLayer),
)
