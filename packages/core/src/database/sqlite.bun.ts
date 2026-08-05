import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { getUnsafe } from "effect/Context";
import { Effect, Scope, Semaphore } from "effect"
import { getCurrent } from "effect/Fiber";
import { identity } from "effect/Function"
import { effect, merge, provide } from "effect/Layer";
import { die } from "effect/Stream";
import { layer as reactivityLayer } from "effect/unstable/reactivity/Reactivity"
import { SqlClient, make as makeClient } from "effect/unstable/sql/SqlClient"
import type { Connection } from "effect/unstable/sql/SqlConnection"
import { classifySqliteError, SqlError } from "effect/unstable/sql/SqlError"
import { defaultTransforms, makeCompilerSqlite } from "effect/unstable/sql/Statement";
import { Sqlite } from "./sqlite"
import { withVec0 } from "./vec"

const ATTR_DB_SYSTEM_NAME = "db.system.name"

const TypeId = "~@opencode-ai/core/database/SqliteBun" as const
type TypeId = typeof TypeId

interface SqliteClient extends SqlClient {
  readonly [TypeId]: TypeId
  readonly config: Config
  readonly export: Effect.Effect<Uint8Array, SqlError>
  readonly loadExtension: (path: string) => Effect.Effect<void, SqlError>
  readonly updateValues: never
}

interface Config {
  readonly filename: string
  readonly readonly?: boolean
  readonly create?: boolean
  readonly readwrite?: boolean
  readonly disableWAL?: boolean
  readonly spanAttributes?: Record<string, unknown>
  readonly transformResultNames?: (str: string) => string
  readonly transformQueryNames?: (str: string) => string
}

interface SqliteConnection extends Connection {
  readonly export: Effect.Effect<Uint8Array, SqlError>
  readonly loadExtension: (path: string) => Effect.Effect<void, SqlError>
}

const make = (options: Config) =>
  Effect.gen(function* () {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Sqlite.Native is shared unknown across backends; the native layer guarantees a bun Database.
    const native = (yield* Sqlite.Native) as Database
    const compiler = makeCompilerSqlite(options.transformQueryNames)
    const transformRows = options.transformResultNames
      ? defaultTransforms(options.transformResultNames).array
      : undefined

    const run = (query: string, params: ReadonlyArray<unknown> = []) =>
      Effect.withFiber<Array<Record<string, unknown>>, SqlError>((_fiber) => {
        const statement = native.query(query)
        try {
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- bun:sqlite rows and SQL bindings are driver-typed; Effect passes ReadonlyArray<unknown>.
          return Effect.succeed((statement.all(...(params as never[])) ?? []) as Array<Record<string, unknown>>)
        } catch (cause) {
          return Effect.fail(
            new SqlError({
              reason: classifySqliteError(cause, { message: "Failed to execute statement", operation: "execute" }),
            }),
          )
        }
      })

    const runValues = (query: string, params: ReadonlyArray<unknown> = []) =>
      Effect.withFiber<Array<unknown[]>, SqlError>((_fiber) => {
        const statement = native.query(query)
        try {
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- bun:sqlite rows and SQL bindings are driver-typed; Effect passes ReadonlyArray<unknown>.
          return Effect.succeed((statement.values(...(params as never[])) ?? []) as Array<unknown[]>)
        } catch (cause) {
          return Effect.fail(
            new SqlError({
              reason: classifySqliteError(cause, { message: "Failed to execute statement", operation: "execute" }),
            }),
          )
        }
      })

    const connection = identity<SqliteConnection>({
      execute(query, params, transformRows) {
        return transformRows ? Effect.map(run(query, params), transformRows) : run(query, params)
      },
      executeRaw(query, params) {
        return run(query, params)
      },
      executeValues(query, params) {
        return runValues(query, params)
      },
      executeUnprepared(query, params, transformRows) {
        return this.execute(query, params, transformRows)
      },
      executeStream() {
        return die("executeStream not implemented")
      },
      export: Effect.try({
        try: () => native.serialize(),
        catch: (cause) =>
          new SqlError({
            reason: classifySqliteError(cause, { message: "Failed to export database", operation: "export" }),
          }),
      }),
      loadExtension: (path) =>
        Effect.try({
          try: () => native.loadExtension(path),
          catch: (cause) =>
            new SqlError({
              reason: classifySqliteError(cause, { message: "Failed to load extension", operation: "loadExtension" }),
            }),
        }),
    })

    const semaphore = yield* Semaphore.make(1)
    const acquirer = semaphore.withPermits(1)(Effect.succeed(connection))
    const transactionAcquirer = Effect.uninterruptibleMask((restore) => {
      const fiber = getCurrent()
      if (!fiber) return Effect.die("Missing current fiber in transaction acquirer")
      const scope = getUnsafe(fiber.context, Scope.Scope)
      return Effect.as(
        Effect.tap(restore(semaphore.take(1)), () => Scope.addFinalizer(scope, semaphore.release(1))),
        connection,
      )
    })

    const client = Object.assign(
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- SqlClient.make returns the base SqlClient; Object.assign below augments it with the SqliteClient-specific members.
      (yield* makeClient({
        acquirer,
        compiler,
        transactionAcquirer,
        spanAttributes: [
          ...(options.spanAttributes ? Object.entries(options.spanAttributes) : []),
          [ATTR_DB_SYSTEM_NAME, "sqlite"],
        ],
        transformRows,
      })) as SqliteClient,
      {
        [TypeId]: TypeId,
        config: options,
        export: Effect.flatMap(acquirer, (_) => _.export),
        loadExtension: (path: string) => Effect.flatMap(acquirer, (_) => _.loadExtension(path)),
      },
    )

    return client
  })

const nativeLayer = (config: Config) =>
  effect(
    Sqlite.Native,
    Effect.gen(function* () {
      const native = new Database(config.filename, {
        readonly: config.readonly,
        readwrite: config.readwrite ?? true,
        create: config.create ?? true,
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => native.close()))
      if (config.disableWAL !== true) native.run("PRAGMA journal_mode = WAL;")
      yield* withVec0((path) => native.loadExtension(path))
      return native
    }),
  )

const sqliteLayer = (config: Config) => effect(SqlClient, make(config))

const drizzleLayer = effect(
  Sqlite.Drizzle,
  Effect.gen(function* () {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Sqlite.Native is shared unknown across backends; the native layer guarantees a bun Database.
    return drizzle({ client: (yield* Sqlite.Native) as Database })
  }),
)

export const layer = (config: Config) => {
  const native = nativeLayer(config)
  return merge(native, merge(sqliteLayer(config), drizzleLayer).pipe(provide(native))).pipe(
    provide(reactivityLayer),
  )
}
