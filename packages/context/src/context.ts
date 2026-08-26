import { Effect, Layer, Context, Ref, Duration, Option } from "effect"
import {
  ContextScope,
  ContextBudget,
  ContextEpoch,
  ContextSnapshot,
  ScopeState,
  type CompactionStrategy,
  ScopeNotFoundError,
  ContextScope as ContextScopeUtils,
  ContextBudget as ContextBudgetUtils,
  ContextEpoch as ContextEpochUtils,
  ContextSnapshot as ContextSnapshotUtils,
  ScopeState as ScopeStateUtils,
  type Generation
} from "./types"

/**
 * Default budget limit for new scopes (can be overridden)
 */
const DEFAULT_BUDGET_LIMIT = 100_000

/**
 * Periodic full compaction interval (5 minutes)
 */
const FULL_COMPACTION_INTERVAL = Duration.minutes(5)

/**
 * Context.Service - Unified context management with scoped key-value state,
 * epoch management, budget tracking, and compaction.
 */
export interface ContextService {
  readonly get: (scope: ContextScope, key: string) => Effect.Effect<Option.Option<unknown>, ScopeNotFoundError>
  readonly set: (scope: ContextScope, key: string, value: unknown) => Effect.Effect<void, ScopeNotFoundError>
  readonly delete: (scope: ContextScope, key: string) => Effect.Effect<boolean, ScopeNotFoundError>
  readonly snapshot: (scope: ContextScope) => Effect.Effect<ContextSnapshot, ScopeNotFoundError>
  readonly restore: (scope: ContextScope, snapshot: ContextSnapshot) => Effect.Effect<void, ScopeNotFoundError>
  readonly initializeEpoch: (scope: ContextScope, baseline: unknown, budget?: ContextBudget) => Effect.Effect<ContextEpoch, ScopeNotFoundError>
  readonly getEpoch: (scope: ContextScope) => Effect.Effect<Option.Option<ContextEpoch>, ScopeNotFoundError>
  readonly replaceEpoch: (scope: ContextScope, epoch: ContextEpoch) => Effect.Effect<void, ScopeNotFoundError>
  readonly getBudget: (scope: ContextScope) => Effect.Effect<ContextBudget, ScopeNotFoundError>
  readonly setBudget: (scope: ContextScope, budget: ContextBudget) => Effect.Effect<void, ScopeNotFoundError>
  readonly compact: (scope: ContextScope, strategy?: CompactionStrategy) => Effect.Effect<ContextBudget, ScopeNotFoundError>
  readonly releaseScope: (scope: ContextScope) => Effect.Effect<void>
  readonly getOrLoad: (
    scope: ContextScope,
    key: string,
    loader: () => Effect.Effect<unknown>
  ) => Effect.Effect<unknown, ScopeNotFoundError>
}

export class Service extends Context.Service<Service, ContextService>()("@openaxe/ContextService") {}

/**
 * Internal state holder for the Context.Service implementation
 */
interface ContextState {
  scopes: Map<string, ScopeState>
  latches: Map<string, number>
  compactionTimers: Map<string, ReturnType<typeof setTimeout>>
}

/**
 * Simple lock using a counter for write serialization per scope
 */
const acquireLock = (state: ContextState, scopeKey: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const count = (state.latches.get(scopeKey) ?? 0) + 1
    state.latches.set(scopeKey, count)
    if (count > 1) {
      // Wait for lock to be released
      yield* Effect.promise(() => new Promise<void>((resolve) => {
        const check = () => {
          const current = state.latches.get(scopeKey)
          if (current !== undefined && current <= 1) {
            resolve()
          } else {
            setTimeout(check, 1)
          }
        }
        check()
      }))
    }
  })

const releaseLock = (state: ContextState, scopeKey: string): void => {
  const count = state.latches.get(scopeKey)
  if (count !== undefined && count > 0) {
    state.latches.set(scopeKey, count - 1)
  }
}

/**
 * Get or initialize scope state
 */
const getOrInitScope = (
  state: ContextState,
  scope: ContextScope,
  initialBudget?: ContextBudget
): ScopeState => {
  const key = ContextScopeUtils.hash(scope)
  const existing = state.scopes.get(key)
  if (existing) return existing

  const budget = initialBudget ?? ContextBudgetUtils.make(DEFAULT_BUDGET_LIMIT)
  const newState = ScopeStateUtils.empty(budget)
  state.scopes.set(key, newState)
  return newState
}

/**
 * Perform incremental compaction on a scope
 */
const performIncrementalCompaction = (
  state: ContextState,
  scope: ContextScope
): Effect.Effect<ContextBudget, ScopeNotFoundError> =>
  Effect.gen(function* () {
    const key = ContextScopeUtils.hash(scope)
    const scopeState = state.scopes.get(key)
    if (!scopeState) {
      return yield* Effect.fail(new ScopeNotFoundError({ scope }))
    }

    const current = scopeState
    const available = ContextBudgetUtils.available(current.budget)

    if (available >= 0) {
      return current.budget
    }

    const sortedEntries = Array.from(current.data.entries())
      .filter(([k]) => current.dirtyKeys.has(k))
      .sort((a, b) => JSON.stringify(b[1]).length - JSON.stringify(a[1]).length)

    let newData = new Map(current.data)
    let freed = 0

    for (const [k, v] of sortedEntries) {
      if (freed >= Math.abs(available)) break
      const size = JSON.stringify(v).length
      newData = new Map(newData)
      newData.delete(k)
      freed += size
    }

    const newBudget = ContextBudgetUtils.make(
      current.budget.limit,
      Math.max(0, current.budget.used - freed),
      current.budget.reserved
    )

    const updated: ScopeState = {
      ...current,
      data: newData,
      budget: newBudget,
      version: current.version + 1,
      dirtyKeys: new Set()
    }

    state.scopes.set(key, updated)
    return newBudget
  })

/**
 * Perform full compaction on a scope
 */
const performFullCompaction = (
  state: ContextState,
  scope: ContextScope
): Effect.Effect<ContextBudget, ScopeNotFoundError> =>
  Effect.gen(function* () {
    const key = ContextScopeUtils.hash(scope)
    const scopeState = state.scopes.get(key)
    if (!scopeState) {
      return yield* Effect.fail(new ScopeNotFoundError({ scope }))
    }

    const current = scopeState
    const targetUsed = Math.floor(current.budget.limit * 0.7)
    let newData = new Map(current.data)
    let currentUsed = current.budget.used

    if (currentUsed <= targetUsed) {
      return current.budget
    }

    const entries = Array.from(current.data.entries())
      .sort((a, b) => JSON.stringify(b[1]).length - JSON.stringify(a[1]).length)

    for (const [k, v] of entries) {
      if (currentUsed <= targetUsed) break
      const size = JSON.stringify(v).length
      newData = new Map(newData)
      newData.delete(k)
      currentUsed -= size
    }

    const newBudget = ContextBudgetUtils.make(current.budget.limit, currentUsed, current.budget.reserved)
    const updated: ScopeState = {
      ...current,
      data: newData,
      budget: newBudget,
      version: current.version + 1,
      dirtyKeys: new Set()
    }

    state.scopes.set(key, updated)
    return newBudget
  })

/**
 * Schedule periodic full compaction for a scope
 */
const schedulePeriodicCompaction = (
  state: ContextState,
  scope: ContextScope
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const key = ContextScopeUtils.hash(scope)
    const existing = state.compactionTimers.get(key)
    if (existing) {
      clearTimeout(existing)
    }

    const timer = setTimeout(() => {
      Effect.runFork(performFullCompaction(state, scope).pipe(Effect.catchCause(Effect.logError)))
    }, Duration.toMillis(FULL_COMPACTION_INTERVAL))

    state.compactionTimers.set(key, timer)
  })

/**
 * Clear periodic compaction timer
 */
const clearPeriodicCompaction = (state: ContextState, scope: ContextScope): void => {
  const key = ContextScopeUtils.hash(scope)
  const existing = state.compactionTimers.get(key)
  if (existing) {
    clearTimeout(existing)
    state.compactionTimers.delete(key)
  }
}

const optionFromNullable = <A>(value: A | null | undefined): Option.Option<A> =>
  value === null || value === undefined ? Option.none() : Option.some(value as A)

/**
 * Create the Context.Service layer
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* Ref.make({
      scopes: new Map(),
      latches: new Map(),
      compactionTimers: new Map()
    })

    const getScopeState = (scope: ContextScope): Effect.Effect<ScopeState, ScopeNotFoundError> =>
      Effect.gen(function* () {
        const s = yield* Ref.get(state)
        const key = ContextScopeUtils.hash(scope)
        const existing = s.scopes.get(key)
        if (!existing) {
          return yield* Effect.fail(new ScopeNotFoundError({ scope }))
        }
        return existing
      })

    const withScopeLock = <A, E>(
      scope: ContextScope,
      effect: Effect.Effect<A, E>
    ): Effect.Effect<A, E | ScopeNotFoundError> =>
      Effect.gen(function* () {
        const s = yield* Ref.get(state)
        yield* acquireLock(s, ContextScopeUtils.hash(scope))
        try {
          return yield* effect
        } finally {
          releaseLock(s, ContextScopeUtils.hash(scope))
        }
      })

    const service: ContextService = {
      get: (scope: ContextScope, key: string) =>
        Effect.gen(function* () {
          const scopeState = yield* getScopeState(scope)
          const value = scopeState.data.get(key)
          return optionFromNullable(value)
        }),

      set: (scope: ContextScope, key: string, value: unknown) =>
        Effect.gen(function* () {
          yield* withScopeLock(scope, Effect.gen(function* () {
            const s = yield* Ref.get(state)
            const scopeState = getOrInitScope(s, scope)
            const prevValue = scopeState.data.get(key)
            const prevSize = prevValue ? JSON.stringify(prevValue).length : 0
            const newSize = JSON.stringify(value).length
            const sizeDiff = newSize - prevSize

            const newBudget = ContextBudgetUtils.make(
              scopeState.budget.limit,
              Math.max(0, scopeState.budget.used + sizeDiff),
              scopeState.budget.reserved
            )

            const newDirtyKeys = new Set(scopeState.dirtyKeys)
            newDirtyKeys.add(key)

            const updated: ScopeState = {
              ...scopeState,
              data: new Map(scopeState.data).set(key, value),
              budget: newBudget,
              version: scopeState.version + 1,
              dirtyKeys: newDirtyKeys
            }

            s.scopes.set(ContextScopeUtils.hash(scope), updated)

            if (ContextBudgetUtils.isOverBudget(newBudget)) {
              yield* performIncrementalCompaction(s, scope)
            }
          }))
        }),

      delete: (scope: ContextScope, key: string) =>
        Effect.gen(function* () {
          return yield* withScopeLock(scope, Effect.gen(function* () {
            const s = yield* Ref.get(state)
            const scopeState = yield* getScopeState(scope)
            const prevValue = scopeState.data.get(key)
            if (prevValue === undefined) return false

            const prevSize = JSON.stringify(prevValue).length
            const newBudget = ContextBudgetUtils.make(
              scopeState.budget.limit,
              Math.max(0, scopeState.budget.used - prevSize),
              scopeState.budget.reserved
            )

            const newData = new Map(scopeState.data)
            newData.delete(key)

            const updated: ScopeState = {
              ...scopeState,
              data: newData,
              budget: newBudget,
              version: scopeState.version + 1,
              dirtyKeys: new Set(scopeState.dirtyKeys).add(key)
            }

            s.scopes.set(ContextScopeUtils.hash(scope), updated)
            return true
          }))
        }),

      snapshot: (scope: ContextScope) =>
        Effect.gen(function* () {
          const scopeState = yield* getScopeState(scope)
          return ContextSnapshotUtils.make(
            scope,
            new Map(scopeState.data),
            scopeState.epoch,
            scopeState.version
          )
        }),

      restore: (scope: ContextScope, snapshot: ContextSnapshot) =>
        Effect.gen(function* () {
          if (!ContextScopeUtils.equals(scope, snapshot.scope)) {
            return yield* Effect.fail(new ScopeNotFoundError({ scope }))
          }

          yield* withScopeLock(scope, Effect.gen(function* () {
            const s = yield* Ref.get(state)
            let budget = ContextBudgetUtils.make(DEFAULT_BUDGET_LIMIT)
            for (const [, value] of snapshot.data) {
              budget = ContextBudgetUtils.consume(budget, JSON.stringify(value).length)
            }

            const updated: ScopeState = {
              data: new Map(snapshot.data),
              epoch: snapshot.epoch,
              budget,
              version: snapshot.version,
              dirtyKeys: new Set()
            }

            s.scopes.set(ContextScopeUtils.hash(scope), updated)
            return undefined
          }))
          return undefined
        }),

      initializeEpoch: (scope: ContextScope, baseline: unknown, budget?: ContextBudget) =>
        Effect.gen(function* () {
          return yield* withScopeLock(scope, Effect.gen(function* () {
            const s = yield* Ref.get(state)
            const scopeState = getOrInitScope(s, scope, budget)
            const initialBudget = budget ?? scopeState.budget
            const epoch = ContextEpochUtils.make(
              yield* Effect.gen(function* () {
                const gen: Generation = { baseline: String(baseline), snapshot: {} }
                return gen
              }),
              baseline,
              initialBudget
            )

            const updated: ScopeState = {
              ...scopeState,
              epoch,
              budget: initialBudget,
              version: scopeState.version + 1
            }

            s.scopes.set(ContextScopeUtils.hash(scope), updated)

            yield* schedulePeriodicCompaction(s, scope)
            return epoch
          }))
        }),

      getEpoch: (scope: ContextScope) =>
        Effect.gen(function* () {
          const scopeState = yield* getScopeState(scope)
          return optionFromNullable(scopeState.epoch)
        }),

      replaceEpoch: (scope: ContextScope, epoch: ContextEpoch) =>
        Effect.gen(function* () {
          yield* withScopeLock(scope, Effect.gen(function* () {
            const s = yield* Ref.get(state)
            const scopeState = yield* getScopeState(scope)
            const updated: ScopeState = {
              ...scopeState,
              epoch,
              version: scopeState.version + 1
            }
            s.scopes.set(ContextScopeUtils.hash(scope), updated)
          }))
        }),

      getBudget: (scope: ContextScope) =>
        Effect.gen(function* () {
          const scopeState = yield* getScopeState(scope)
          return scopeState.budget
        }),

      setBudget: (scope: ContextScope, budget: ContextBudget) =>
        Effect.gen(function* () {
          yield* withScopeLock(scope, Effect.gen(function* () {
            const s = yield* Ref.get(state)
            const scopeState = yield* getScopeState(scope)
            const updated: ScopeState = {
              ...scopeState,
              budget,
              version: scopeState.version + 1
            }
            s.scopes.set(ContextScopeUtils.hash(scope), updated)
          }))
        }),

      compact: (scope: ContextScope, strategy: CompactionStrategy = "hybrid") =>
        Effect.gen(function* () {
          const s = yield* Ref.get(state)
          const _scopeState = yield* getScopeState(scope)

          if (strategy === "explicit" || strategy === "hybrid") {
            return yield* performFullCompaction(s, scope)
          }
          return yield* performIncrementalCompaction(s, scope)
        }),

      releaseScope: (scope: ContextScope) =>
        Effect.gen(function* () {
          const key = ContextScopeUtils.hash(scope)
          const s = yield* Ref.get(state)
          s.scopes.delete(key)
          s.latches.delete(key)
          clearPeriodicCompaction(s, scope)
          yield* Ref.set(state, s)
        }),

      getOrLoad: (scope: ContextScope, key: string, loader: () => Effect.Effect<unknown>) =>
        Effect.gen(function* () {
          const cached = yield* service.get(scope, key)
          if (Option.isSome(cached)) return cached.value
          const loaded = yield* loader()
          yield* service.set(scope, key, loaded)
          return loaded
        })
    }

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const s = yield* Ref.get(state)
        for (const [, timer] of s.compactionTimers) {
          clearTimeout(timer)
        }
      }).pipe(Effect.asVoid)
    )

    return service
  })
)

export const defaultLayer = layer

export {
  ContextScope,
  ContextBudget,
  ContextEpoch,
  ContextSnapshot,
  ScopeState,
  type CompactionStrategy,
  ScopeNotFoundError,
  ContextError,
  type Generation
} from "./types"

export * as Context from "./context"