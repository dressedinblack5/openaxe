# ADR-0001: Unified Context Module

**Status**: Accepted
**Date**: 2026-08-24
**Deciders**: Architecture review (improve-codebase-architecture skill), grilling rounds 1-5

## Context

The codebase contained four context abstractions with nearly identical responsibilities:

| Module             | Location                                                  | Responsibility                                                   |
| ------------------ | --------------------------------------------------------- | ---------------------------------------------------------------- |
| `SystemContext`    | `packages/core/src/system-context/`                       | Budget, selection, registry, epoch management for provider turns |
| `InstanceContext`  | `packages/openaxe/src/effect/instance-state.ts`           | Per-directory project state via `InstanceState`, scoped cache    |
| `WorkspaceContext` | `packages/openaxe/src/control-plane/workspace-context.ts` | Workspace-scoped state for multi-project coordination            |
| `PluginContext`    | `packages/plugin/src/v2/effect                            | promise/context.ts`                                              | Plugin runtime context (defined identically in both) |

Each exported a similar interface: `get`, `set`, `with`, `snapshot`, `restore`. The **deletion test** confirmed shallowness: deleting any one would concentrate complexity into the others, not eliminate it. Callers imported from multiple context modules depending on their layer, creating a seam that leaked implementation details.

## Decision

Create a new top-level package `packages/context` with a unified `Context.Service` that:

1. **Unifies all four context systems** under one implementation
2. **Uses `InstanceState` internally** (wraps `ScopedCache`, adds domain semantics)
3. **Exposes three explicit scope types**: `ProjectScope(dir)`, `WorkspaceScope(id)`, `PluginScope(id)` (discriminated union `ContextScope`)
4. **Owns epoch, budget, compaction** as domain methods on the service:
   - `initializeEpoch(scope, baseline)`, `getEpoch(scope)`, `replaceEpoch(scope, epoch)`
   - `getBudget(scope)`, `setBudget(scope, budget)`, `compact(scope, strategy?)`
5. **Provides adapters** for old modules (`SystemContext`, `InstanceContext`, `WorkspaceContext`) and plugin v2 (effect/promise) — thin wrappers delegating to `Context.Service`
6. **Migrates via strangler fig** with per-module feature flags (`USE_UNIFIED_CONTEXT=system|instance|workspace|plugin`)

## Consequences

### Positive

- **Locality**: Context budget logic lives in one place; callers don't choose which context to use
- **Leverage**: Compaction, epoch management, snapshot/restore become reusable across all consumers
- **Testability**: Single interface to mock; tests verify budget/compaction once, not per-context
- **AI-navigability**: One `Context` module to understand instead of four
- **Domain alignment**: Directly expresses `CONTEXT.md` vocabulary (`ContextEpoch`, `ContextBudget`, `ContextSnapshot`, `BaselineSystemContext`, `UnavailableContext`)

### Negative

- **Migration effort**: ~3-4 weeks to create package, write adapters, migrate consumers, remove old modules
- **Risk of behavioral drift**: Mitigated by adapter test harness (old test suites run against new impl)

### Neutral

- `SystemContextRegistry` stays in `core`, uses `Context.Service` for storage
- Cross-scope operations (copy, merge) deferred to future `ContextTransforms` module
- `PluginContext` adapters are factory functions: `makePluginContext(unifiedContext, pluginId)`

## Implementation Plan

1. Create `packages/context` with `Context.Service`, `ContextEpoch`, `ContextBudget`, `Compaction`, tests
2. Write `SystemContext` adapter → `Context.Service` (flag: `USE_UNIFIED_CONTEXT=system`)
3. Run `SystemContext` test suite via adapter harness; flip consumers
4. Repeat for `InstanceContext` (flag: `USE_UNIFIED_CONTEXT=instance`)
5. Repeat for `WorkspaceContext` (flag: `USE_UNIFIED_CONTEXT=workspace`)
6. Write `PluginContext` adapters for effect/promise (flag: `USE_UNIFIED_CONTEXT=plugin`)
7. Remove old modules, remove flags

## Performance Decisions (from grilling Round 4)

- `Effect.cached` per scope key for memoization
- Incremental compaction with dirty entry tracking + periodic full compaction
- JSON via `Schema.encode` for snapshot serialization
- Keep `ScopedCache` capacity=10, add explicit `releaseScope` for non-project scopes
- Per-scope `Effect.Latch` for read concurrency + write serialization
- Internal batching only, public API stays single-entry
- Structured log annotations for metrics (latency, scope count, cache hit rate)
- Hybrid loading: baseline eager, optional lazy with `getOrLoad`

## Alternatives Considered

| Alternative                                    | Rejected Because                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Keep separate modules, add facade              | Doesn't solve deletion test; still four implementations                                           |
| Merge only `SystemContext` + `InstanceContext` | Leaves `WorkspaceContext` and `PluginContext` as outliers                                         |
| Put cross-scope ops in service                 | Bloats interface; cross-scope logic varies by caller (violates "one adapter = hypothetical seam") |

## Related

- `CONTEXT.md` updated with new terms: `Context`, `ContextScope`, `ContextEpoch`, `ContextBudget`, `ContextSnapshot`, `ContextTransforms`
- Follows vocabulary from `codebase-design` skill: module, interface, depth, seam, adapter, leverage, locality
