import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite"
import { drizzle } from "drizzle-orm/node-sqlite"
import { get, getUnsafe } from "effect/Context"
import { Effect, Scope, Semaphore } from "effect"
import { getCurrent } from "effect/Fiber"
import { identity } from "effect/Function"
import { effect, merge, provide } from "effect/Layer"
import { die } from "effect/Stream"
import { layer as reactivityLayer } from "effect/unstable/reactivity/Reactivity"
import { SqlClient, SafeIntegers, make as makeClient } from "effect/unstable/sql/SqlClient"
import type { Connection } from "effect/unstable/sql/SqlConnection"
import { classifySqliteError, SqlError } from "effect/unstable/sql/SqlError"
import { defaultTransforms, makeCompilerSqlite } from "effect/unstable/sql/Statement"
import { Sqlite } from "./sqlite"
import { withVec0 } from "./vec"

const ATTR_DB_SYSTEM_NAME = "db.system.name"

const TypeId = "~@opencode-ai/core/database/SqliteNode" as const
type TypeId = typeof TypeId

interface SqliteClient extends SqlClient {
  readonly [TypeId]: TypeId
  readonly config: Config
  readonly loadExtension: (path: string) => Effect.Effect<void, SqlError>
  readonly updateValues: never
}

interface Config {
  readonly filename: string
  readonly readonly?: boolean
  readonly create?: boolean
  readonly readwrite?: boolean
  readonly disableWAL?: boolean
  readonly timeout?: number
  readonly allowExtension?: boolean
  readonly spanAttributes?: Record<string, unknown>
  readonly transformResultNames?: (str: string) => string
  readonly transformQueryNames?: (str: string) => string
}

interface SqliteConnection extends Connection {
  readonly loadExtension: (path: string) => Effect.Effect<void, SqlError>
}

const make = (options: Config) =>
  Effect.gen(function* () {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Sqlite.Native is shared unknown across backends; the native layer guarantees a node DatabaseSync.
    const native = (yield* Sqlite.Native) as DatabaseSync

    const compiler = makeCompilerSqlite(options.transformQueryNames)
    const transformRows = options.transformResultNames
      ? defaultTransforms(options.transformResultNames).array
      : undefined

    // Reuse compiled statements per query string — node:sqlite recompiles on
    // every prepare(), and the session hot loop executes a bounded set of
    // queries thousands of times. Statements are safe to re-bind + re-execute;
    // per-call flags are reset below exactly as before.
    const prepared = new Map<string, StatementSync>()
    const prepare = (query: string) => {
      let statement = prepared.get(query)
      if (!statement) {
        statement = native.prepare(query)
        // ponytail: cap cache, clear-all on overflow — distinct queries are bounded in practice
        if (prepared.size >= 500) prepared.clear()
        prepared.set(query, statement)
      }
      return statement
    }

    const run = (query: string, params: ReadonlyArray<unknown> = []) =>
      Effect.withFiber<Array<Record<string, unknown>>, SqlError>((fiber) => {
        const statement = prepare(query)
        statement.setReadBigInts(get(fiber.context, SafeIntegers))
        statement.setReturnArrays(false)
        try {
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- node:sqlite bindings are driver-typed; Effect passes ReadonlyArray<unknown>.
          return Effect.succeed(statement.all(...(params as SQLInputValue[])) as Array<Record<string, unknown>>)
        } catch (cause) {
          return Effect.fail(
            new SqlError({
              reason: classifySqliteError(cause, { message: "Failed to execute statement", operation: "execute" }),
            }),
          )
        }
      })

    const runValues = (query: string, params: ReadonlyArray<unknown> = []) =>
      Effect.withFiber<ReadonlyArray<ReadonlyArray<unknown>>, SqlError>((fiber) => {
        const statement = prepare(query)
        statement.setReadBigInts(get(fiber.context, SafeIntegers))
        statement.setReturnArrays(true)
        try {
          return Effect.succeed(
            // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- node:sqlite bindings are driver-typed; Effect passes ReadonlyArray<unknown>.
            statement.all(...(params as SQLInputValue[])) as unknown as ReadonlyArray<ReadonlyArray<unknown>>,
          )
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
        loadExtension: (path: string) => Effect.flatMap(acquirer, (_) => _.loadExtension(path)),
      },
    )

    return client
  })

const nativeLayer = (config: Config) =>
  effect(
    Sqlite.Native,
    Effect.gen(function* () {
      const native = new DatabaseSync(config.filename, {
        readOnly: config.readonly,
        timeout: config.timeout,
        allowExtension: true,
        enableForeignKeyConstraints: true,
        open: true,
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => native.close()))
      if (config.disableWAL !== true && config.readonly !== true) native.exec("PRAGMA journal_mode = WAL;")
      yield* withVec0((path) => native.loadExtension(path))
      return native
    }),
  )

const sqliteLayer = (config: Config) => effect(SqlClient, make(config))

const drizzleLayer = effect(
  Sqlite.Drizzle,
  Effect.gen(function* () {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Sqlite.Native is shared unknown across backends; the native layer guarantees a node DatabaseSync.
    return drizzle({ client: (yield* Sqlite.Native) as DatabaseSync }) as unknown as Sqlite.DrizzleClient
  }),
)

export const layer = (config: Config) => {
  const native = nativeLayer(config)
  return merge(native, merge(sqliteLayer(config), drizzleLayer).pipe(provide(native))).pipe(provide(reactivityLayer))
}
