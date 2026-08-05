export * as Vector from "./vector"

import { sql, type SQL } from "drizzle-orm"
import { Context, Effect, Layer, Option } from "effect"
import { ConfigEmbedding } from "../config/embedding"
import { Database } from "../database/database"

/** Fallback vector dimension when the configured embedding model is unknown. */
export const DEFAULT_DIMENSION = 768

/** Expected dimensions for known embedding models; unknown models use DEFAULT_DIMENSION. */
const MODEL_DIMENSIONS: Readonly<Record<string, number>> = {
  "nomic-embed-text": 768,
  "text-embedding-3-small": 1536,
}

export type VectorTable = "session_message" | "workspace_memory"

export const TABLES: readonly VectorTable[] = ["session_message", "workspace_memory"]

export interface VectorSearchResult {
  readonly id: string
  readonly score: number
}

export type VectorError =
  | { readonly _tag: "ExtensionNotLoaded"; readonly message: string }
  | { readonly _tag: "InvalidDimension"; readonly expected: number; readonly actual: number }
  | { readonly _tag: "QueryFailed"; readonly message: string }

export interface InsertMetadata {
  readonly projectId?: string
  readonly sessionId?: string
}

export interface Interface {
  readonly insert: (
    table: VectorTable,
    id: string,
    vector: number[],
    metadata?: InsertMetadata,
  ) => Effect.Effect<void, VectorError>
  readonly search: (
    table: VectorTable,
    queryVector: number[],
    k: number,
    filter?: SQL,
  ) => Effect.Effect<ReadonlyArray<VectorSearchResult>, VectorError>
  readonly delete: (table: VectorTable, id: string) => Effect.Effect<void, VectorError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Vector") {}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

const queryFailed = (error: unknown): VectorError => ({
  _tag: "QueryFailed",
  message: describe(error),
})

/** vec0 accepts vectors as Float32Array byte buffers; same format as WorkspaceMemory. */
const blob = (vector: number[]) => Buffer.from(new Float32Array(vector).buffer)

const TABLE_NAMES: Readonly<Record<VectorTable, string>> = {
  session_message: "session_message_vec",
  workspace_memory: "workspace_memory_vec",
}

// workspace_memory_vec's shape is contracted with WorkspaceMemory (memory/workspace-memory.ts),
// which writes rows directly: (vector, project_id, key). session_message_vec carries the
// session scoping columns T7 filters on. Both use cosine distance, matching WorkspaceMemory.
const createSql = (table: VectorTable, dimension: number) =>
  table === "session_message"
    ? sql`CREATE VIRTUAL TABLE IF NOT EXISTS ${sql.identifier("session_message_vec")} USING vec0(vector float[${sql.raw(String(dimension))}] distance_metric=cosine, id text, project_id text, session_id text)`
    : sql`CREATE VIRTUAL TABLE IF NOT EXISTS ${sql.identifier("workspace_memory_vec")} USING vec0(vector float[${sql.raw(String(dimension))}] distance_metric=cosine, project_id text, key text)`

const insertSql = (table: VectorTable, id: string, vector: number[], metadata?: InsertMetadata) =>
  table === "session_message"
    ? sql`INSERT INTO ${sql.identifier("session_message_vec")} (vector, id, project_id, session_id) VALUES (${blob(vector)}, ${id}, ${metadata?.projectId ?? ""}, ${metadata?.sessionId ?? ""})`
    : sql`INSERT INTO ${sql.identifier("workspace_memory_vec")} (vector, project_id, key) VALUES (${blob(vector)}, ${metadata?.projectId ?? ""}, ${id})`

const searchSql = (table: VectorTable, queryVector: number[], k: number, filter?: SQL) =>
  table === "session_message"
    ? sql`SELECT id, distance FROM ${sql.identifier("session_message_vec")} WHERE vector MATCH ${blob(queryVector)} AND k = ${k} ${filter ? sql`AND ${filter}` : sql``} ORDER BY distance`
    : sql`SELECT key AS id, distance FROM ${sql.identifier("workspace_memory_vec")} WHERE vector MATCH ${blob(queryVector)} AND k = ${k} ${filter ? sql`AND ${filter}` : sql``} ORDER BY distance`

const deleteSql = (table: VectorTable, id: string) =>
  table === "session_message"
    ? sql`DELETE FROM ${sql.identifier("session_message_vec")} WHERE id = ${id}`
    : sql`DELETE FROM ${sql.identifier("workspace_memory_vec")} WHERE key = ${id}`

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const config = yield* ConfigEmbedding.ConfigService
    const dimension = MODEL_DIMENSIONS[config.model ?? ""] ?? DEFAULT_DIMENSION

    // bun:sqlite segfaults at teardown when a vec0 virtual table still exists on
    // a closed connection (same bug class as FTS5, see fts.ts). Finalizers run
    // LIFO, so this drops the tables before Database.defaultLayer's native close.
    // The tables are derived search indexes; entries are re-seeded from the row
    // vectors (session_message.vector / workspace_memory.vector).
    yield* Effect.addFinalizer(() =>
      db.run(sql`DROP TABLE IF EXISTS session_message_vec`).pipe(Effect.catch(() => Effect.void)),
    )
    yield* Effect.addFinalizer(() =>
      db.run(sql`DROP TABLE IF EXISTS workspace_memory_vec`).pipe(Effect.catch(() => Effect.void)),
    )

    // DDL is deferred to first use (Effect.cached) so a DB whose vec0 extension
    // failed to load still opens; the first op fails with a typed error instead.
    const ensureSchema = Effect.fn("Vector.ensureSchema")(function* () {
      const version = yield* db.all<{ v: string }>(sql`select vec_version() as v`).pipe(Effect.option)
      if (Option.isNone(version) || version.value.length === 0 || version.value[0]?.v === undefined) {
        yield* Effect.fail<VectorError>({
          _tag: "ExtensionNotLoaded",
          message: "sqlite-vec extension is not loaded; vector features unavailable",
        })
        return
      }
      for (const table of TABLES) {
        yield* db.run(createSql(table, dimension)).pipe(
          Effect.mapError((error): VectorError => ({
            _tag: "ExtensionNotLoaded",
            message: `failed to create ${TABLE_NAMES[table]}: ${describe(error)}`,
          })),
        )
      }
    })
    const ensureSchemaOnce = yield* Effect.cached(ensureSchema())

    const requireDimension = (vector: number[]) =>
      vector.length === dimension
        ? Effect.void
        : Effect.fail<VectorError>({ _tag: "InvalidDimension", expected: dimension, actual: vector.length })

    const insert: Interface["insert"] = (table, id, vector, metadata) =>
      Effect.gen(function* () {
        yield* requireDimension(vector)
        yield* ensureSchemaOnce
        yield* db.run(insertSql(table, id, vector, metadata)).pipe(Effect.mapError(queryFailed))
      })

    const search: Interface["search"] = (table, queryVector, k, filter) =>
      Effect.gen(function* () {
        yield* requireDimension(queryVector)
        yield* ensureSchemaOnce
        const rows = yield* db.all<{ id: string; distance: number }>(searchSql(table, queryVector, k, filter)).pipe(
          Effect.mapError(queryFailed),
        )
        // Cosine distance from the query — lower is more relevant (same convention as WorkspaceMemory).
        return rows.map((row) => ({ id: row.id, score: row.distance }))
      })

    const deleteVector: Interface["delete"] = (table, id) =>
      Effect.gen(function* () {
        yield* ensureSchemaOnce
        yield* db.run(deleteSql(table, id)).pipe(Effect.mapError(queryFailed))
      })

    return Service.of({ insert, search, delete: deleteVector })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Database.defaultLayer),
  Layer.provide(ConfigEmbedding.defaultConfigLayer),
)
