import { Context, Effect, Layer, Option, Schema } from "effect"
import type { ContextService } from "../context"

/**
 * SystemContext Adapter - Minimal compatibility layer
 */

// Re-export key types from the old SystemContext for compatibility
export interface Source<A> {
  readonly key: Key
  readonly codec: Schema.Schema<A>
  readonly load: Effect.Effect<A | Unavailable>
  readonly baseline: (value: A) => string
  readonly update: (old: A, newValue: A) => string
  readonly removed?: (value: A) => string
}

export interface Key {
  readonly _tag: "Key"
  readonly value: string
}

export namespace Key {
  export const make = (value: string): Key => ({ _tag: "Key", value })
  export const equals = (a: Key, b: Key): boolean => a.value === b.value
  export const toString = (key: Key): string => key.value
}

const unavailable = Symbol("unavailable")
export type Unavailable = typeof unavailable

export function isUnavailable(value: unknown): value is Unavailable {
  return value === unavailable
}

interface Generation {
  readonly baseline: string
  readonly snapshot: Snapshot
}

export interface SourceSnapshot {
  readonly value: Schema.Json
  readonly removed?: string
}

export type Snapshot = Record<string, SourceSnapshot>

export type Rendered = {
  readonly text: string
  readonly snapshot: SourceSnapshot
}

export type Compared =
  | { readonly _tag: "Incompatible" }
  | { readonly _tag: "Unchanged" }
  | { readonly _tag: "Updated"; readonly render: () => Rendered }

export type ReconcileResult =
  | { readonly _tag: "Unchanged" }
  | { readonly _tag: "Updated"; readonly text: string; readonly snapshot: Snapshot }
  | { readonly _tag: "ReplacementReady"; readonly generation: Generation }
  | { readonly _tag: "ReplacementBlocked" }

export type ReplacementResult =
  | { readonly _tag: "ReplacementReady"; readonly generation: Generation }
  | { readonly _tag: "ReplacementBlocked" }

export class InitializationBlocked extends Schema.TaggedErrorClass<InitializationBlocked>()(
  "SystemContext.InitializationBlocked",
  { keys: Schema.Array(Schema.String) }
) {
  override get message() {
    return `System context initialization blocked by unavailable sources: ${this.keys.join(", ")}`
  }
}

export class DuplicateKeyError extends Schema.TaggedErrorClass<DuplicateKeyError>()(
  "SystemContext.DuplicateKeyError",
  { key: Schema.String }
) {
  override get message() {
    return `Duplicate system context key: ${this.key}`
  }
}

const ContextTypeId = Symbol.for("@opencode/SystemContext")

export interface SystemContext {
  readonly [ContextTypeId]: ReadonlyArray<PackedSource>
}

interface PackedSource {
  readonly key: Key
  readonly load: Effect.Effect<Loaded | Unavailable>
}

interface Loaded {
  readonly baseline: () => Rendered
  readonly compare: (previous: Schema.Json) => Compared
}

type Entry =
  | { readonly _tag: "Available"; readonly key: Key; readonly baseline: () => Rendered; readonly compare: (previous: Schema.Json) => Compared }
  | { readonly _tag: "Unavailable"; readonly key: Key }

function context(sources: ReadonlyArray<PackedSource>): SystemContext {
  return { [ContextTypeId]: sources }
}

export interface SystemContextAdapterInterface {
  make: <A>(source: Source<A>) => SystemContext
  combine: (values: ReadonlyArray<SystemContext>) => SystemContext
  initialize: (value: SystemContext) => Effect.Effect<Generation, InitializationBlocked>
  reconcile: (value: SystemContext, previous: Snapshot) => Effect.Effect<ReconcileResult>
  replace: (value: SystemContext, previous: Snapshot) => Effect.Effect<ReplacementResult>
  empty: SystemContext
}

export const makeSystemContextAdapter = (_unified: ContextService): SystemContextAdapterInterface => {
  const observe = (value: SystemContext) =>
    Effect.forEach(
      value[ContextTypeId],
      (source) =>
        source.load.pipe(
          Effect.map(
            (result): Entry =>
              result === unavailable
                ? { _tag: "Unavailable", key: source.key }
                : { _tag: "Available", key: source.key, ...result },
          ),
        ),
      { concurrency: "unbounded" },
    )

  const initializeObservation = (entries: ReadonlyArray<Entry>): Generation => {
    const available = entries.filter((entry): entry is Entry & { _tag: "Available" } => entry._tag === "Available")
    const rendered = available.map((entry) => [entry.key, entry.baseline()] as const)
    return {
      baseline: render(rendered.map(([, result]) => result.text)),
      snapshot: Object.fromEntries(rendered.map(([key, result]) => [Key.toString(key), result.snapshot])),
    }
  }

  const reconcileObservation = (
    entries: ReadonlyArray<Entry>,
    previous: Snapshot,
  ): { readonly _tag: "Unchanged" } | { readonly _tag: "Updated"; readonly text: string; readonly snapshot: Snapshot } | { readonly _tag: "Replace" } => {
    const keys = new Set(entries.map((entry) => Key.toString(entry.key)))
    const comparisons = new Map<string, Compared>()

    for (const entry of entries) {
      if (entry._tag === "Unavailable") continue
      const stored = previous[Key.toString(entry.key)]
      if (!stored) continue
      const compared = entry.compare(stored.value)
      if (compared._tag === "Incompatible") return { _tag: "Replace" }
      comparisons.set(Key.toString(entry.key), compared)
    }

    for (const key of Object.keys(previous).sort()) {
      if (keys.has(key)) continue
      if (previous[key]?.removed === undefined) return { _tag: "Replace" }
    }

    const snapshot: Snapshot = {}
    const updates: string[] = []

    for (const entry of entries) {
      const stored = previous[Key.toString(entry.key)]
      if (entry._tag === "Unavailable") {
        if (stored) snapshot[Key.toString(entry.key)] = stored
        continue
      }
      if (!stored) {
        const rendered = entry.baseline()
        updates.push(rendered.text)
        snapshot[Key.toString(entry.key)] = rendered.snapshot
        continue
      }
      const compared = comparisons.get(Key.toString(entry.key))
      if (!compared || compared._tag === "Incompatible")
        throw new Error(`Missing comparison for system context source ${Key.toString(entry.key)}`)
      if (compared._tag === "Unchanged") {
        snapshot[Key.toString(entry.key)] = stored
        continue
      }
      const rendered = compared.render()
      updates.push(rendered.text)
      snapshot[Key.toString(entry.key)] = rendered.snapshot
    }

    for (const key of Object.keys(previous).sort()) {
      if (keys.has(key)) continue
      const removed = previous[key]?.removed
      if (removed === undefined) throw new Error(`Missing removal rendering for system context source ${key}`)
      updates.push(removed)
    }

    if (updates.length === 0) return { _tag: "Unchanged" }
    return { _tag: "Updated", text: render(updates), snapshot }
  }

  const replaceObservation = (entries: ReadonlyArray<Entry>, previous: Snapshot): ReplacementResult => {
    if (entries.some((entry) => entry._tag === "Unavailable" && previous[Key.toString(entry.key)] !== undefined))
      return { _tag: "ReplacementBlocked" }
    return { _tag: "ReplacementReady", generation: initializeObservation(entries) }
  }

  const render = (parts: ReadonlyArray<string>) => parts.join("\n\n")

  function requireText(key: Key, kind: string, text: string): string {
    if (text.length === 0) throw new Error(`System context source ${Key.toString(key)} rendered an empty ${kind}`)
    return text
  }

  function assertUniqueKeys(sources: ReadonlyArray<PackedSource>) {
    const keys = new Set<string>()
    for (const source of sources) {
      const keyStr = Key.toString(source.key)
      if (keys.has(keyStr)) throw new DuplicateKeyError({ key: source.key.value })
      keys.add(keyStr)
    }
  }

  return {
    make: <A>(source: Source<A>): SystemContext => {
      const codec = source.codec
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Effect beta Schema variance requires cast
      const decode = Schema.decodeUnknownOption(codec as unknown as never)
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Effect beta Schema variance requires cast
      const encode = Schema.encodeSync(codec as unknown as never)
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Effect beta Schema variance requires cast
      const equivalent = Schema.toEquivalence(codec as unknown as never)

      return context([
        {
          key: source.key,
          load: source.load.pipe(
            Effect.map((value: A | Unavailable) => {
              if (isUnavailable(value)) return value
              const snapshot = (): SourceSnapshot => ({
                // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- encode returns Json-compatible value
                value: (encode as unknown as (a: A) => Schema.Json)(value),
                ...(source.removed ? { removed: requireText(source.key, "removal", source.removed(value)) } : {}),
              })
              return {
                baseline: (): Rendered => ({
                  text: requireText(source.key, "baseline", source.baseline(value)),
                  snapshot: snapshot(),
                }),
                compare: (previous: Schema.Json): Compared =>
                  Option.match(decode(previous) as Option.Option<A>, {
                    onNone: (): Compared => ({ _tag: "Incompatible" }),
                    onSome: (decoded: A): Compared =>
                      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Effect beta Schema equivalence variance
                      (equivalent as unknown as (a: A, b: A) => boolean)(decoded, value)
                        ? { _tag: "Unchanged" }
                        : {
                            _tag: "Updated",
                            render: () => ({
                              text: requireText(source.key, "update", source.update(decoded, value)),
                              snapshot: snapshot(),
                            }),
                          },
                  }),
              }
            }),
          ),
        },
      ])
    },

    combine: (values: ReadonlyArray<SystemContext>): SystemContext => {
      const sources = values.flatMap((value) => value[ContextTypeId])
      assertUniqueKeys(sources)
      return context(sources)
    },

    initialize: (value: SystemContext): Effect.Effect<Generation, InitializationBlocked> =>
      observe(value).pipe(
        Effect.flatMap((entries) => {
          const unavailableEntries = entries.flatMap((entry) => (entry._tag === "Unavailable" ? [entry.key.value] : []))
          if (unavailableEntries.length > 0) return Effect.fail(new InitializationBlocked({ keys: unavailableEntries }))
          return Effect.succeed(initializeObservation(entries))
        }),
      ),

    reconcile: (value: SystemContext, previous: Snapshot): Effect.Effect<ReconcileResult> =>
      observe(value).pipe(
        Effect.map((entries): ReconcileResult => {
          const result = reconcileObservation(entries, previous)
          if (result._tag === "Unchanged" || result._tag === "Updated") return result
          return replaceObservation(entries, previous)
        }),
      ),

    replace: (value: SystemContext, previous: Snapshot): Effect.Effect<ReplacementResult> =>
      observe(value).pipe(Effect.map((entries) => replaceObservation(entries, previous))),

    empty: context([]),
  }
}

/**
 * SystemContext Adapter Service
 */
export class SystemContextAdapter extends Context.Service<SystemContextAdapter, SystemContextAdapterInterface>()("@openaxe/SystemContextAdapter") {}

/**
 * Layer that provides the SystemContext adapter
 */
export const SystemContextAdapterLayer = (unified: ContextService) =>
  Layer.succeed(SystemContextAdapter, makeSystemContextAdapter(unified))

export * as SystemContext from "./system-context"