import { Effect, Option } from "effect"
import { getLoadablePath } from "sqlite-vec"

/**
 * Path to the vec0 loadable binary (vec0.so/.dylib/.dll) for the current
 * platform/arch. sqlite-vec ships per-platform optional deps
 * (sqlite-vec-<os>-<arch>) and `getLoadablePath()` resolves the right one via
 * import.meta.resolve — no hardcoded paths. Requires SQLite >= 3.41;
 * bun:sqlite bundles 3.53.2 and node:sqlite (Node >= 22.5) ships recent
 * enough builds on supported platforms.
 */
export const vecLoadablePath = Effect.try({
  try: () => getLoadablePath(),
  catch: (cause) => new Error(`unable to resolve vec0 binary: ${describe(cause)}`),
})

const describe = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

/**
 * Loads vec0 on a native connection through its `loadExtension` function.
 * Never fails: a missing binary, unsupported platform, or load error logs a
 * warning and continues — the DB still opens, embedding features just become
 * unavailable.
 */
export const withVec0 = (loadExtension: (path: string) => unknown): Effect.Effect<void> =>
  vecLoadablePath.pipe(
    Effect.flatMap((path) =>
      Effect.try({
        try: () => loadExtension(path),
        catch: (cause) => new Error(`failed to load vec0 from ${path}: ${describe(cause)}`),
      }),
    ),
    Effect.catch((cause) =>
      Effect.logWarning(`sqlite-vec not loaded, embedding features unavailable: ${cause.message}`),
    ),
  )

const rowVersion = (row: unknown) =>
  typeof row === "object" && row !== null && "v" in row && typeof row.v === "string" ? row.v : undefined

/**
 * `select vec_version()` against a live connection. Returns `None` when the
 * extension is not loaded or the query fails for any reason.
 */
export const vecVersion = (run: (sql: string) => unknown): Effect.Effect<Option.Option<string>> =>
  Effect.try({
    try: () => {
      const version = rowVersion(run("select vec_version() as v"))
      return version === undefined ? Option.none() : Option.some(version)
    },
    catch: () => new Error("vec_version() unavailable"),
  }).pipe(Effect.catch(() => Effect.succeed(Option.none())))
