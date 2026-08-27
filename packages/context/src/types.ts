import { Schema } from "effect"

/**
 * Discriminated union for context scope keys.
 * ProjectScope: per-directory project state (keyed by absolute path)
 * WorkspaceScope: workspace-scoped state (keyed by workspace ID)
 * PluginScope: plugin runtime context (keyed by plugin ID)
 */
export interface ProjectScope {
  readonly _tag: "ProjectScope"
  readonly dir: string
}

export interface WorkspaceScope {
  readonly _tag: "WorkspaceScope"
  readonly workspaceId: string
}

export interface PluginScope {
  readonly _tag: "PluginScope"
  readonly pluginId: string
}

export type ContextScope = ProjectScope | WorkspaceScope | PluginScope

export const ContextScope = {
  project: (dir: string): ProjectScope => ({ _tag: "ProjectScope", dir }),
  workspace: (workspaceId: string): WorkspaceScope => ({ _tag: "WorkspaceScope", workspaceId }),
  plugin: (pluginId: string): PluginScope => ({ _tag: "PluginScope", pluginId }),

  equals: (a: ContextScope, b: ContextScope): boolean => {
    if (a._tag !== b._tag) return false
    // ponytail: hash equality avoids narrowing b by a._tag
    return ContextScope.hash(a) === ContextScope.hash(b)
  },

  hash: (scope: ContextScope): string => {
    switch (scope._tag) {
      case "ProjectScope":
        return `project:${scope.dir}`
      case "WorkspaceScope":
        return `workspace:${scope.workspaceId}`
      case "PluginScope":
        return `plugin:${scope.pluginId}`
      default:
        return "unknown"
    }
  },

  toString: (scope: ContextScope): string => ContextScope.hash(scope)
} as const

/**
 * Token budget for a scope.
 * limit: maximum tokens allowed
 * used: tokens currently consumed
 * reserved: tokens reserved for upcoming operations
 */
export interface ContextBudget {
  readonly limit: number
  readonly used: number
  readonly reserved: number
}

export const ContextBudget = {
  make: (limit: number, used = 0, reserved = 0): ContextBudget => ({
    limit,
    used,
    reserved
  }),

  available: (budget: ContextBudget): number =>
    Math.max(0, budget.limit - budget.used - budget.reserved),

  isOverBudget: (budget: ContextBudget): boolean =>
    budget.used + budget.reserved > budget.limit,

  reserve: (budget: ContextBudget, tokens: number): ContextBudget => ({
    ...budget,
    reserved: budget.reserved + tokens
  }),

  release: (budget: ContextBudget, tokens: number): ContextBudget => ({
    ...budget,
    reserved: Math.max(0, budget.reserved - tokens)
  }),

  consume: (budget: ContextBudget, tokens: number): ContextBudget => ({
    ...budget,
    used: budget.used + tokens,
    reserved: Math.max(0, budget.reserved - tokens)
  })
} as const

/**
 * Immutable snapshot of context state at a provider-turn boundary.
 * Contains the generation, baseline system context, and budget.
 */
export interface ContextEpoch {
  readonly generation: Generation
  readonly baseline: unknown // BaselineSystemContext - opaque, rendered text
  readonly budget: ContextBudget
  readonly timestamp: number
}

export const ContextEpoch = {
  make: (
    generation: Generation,
    baseline: unknown,
    budget: ContextBudget
  ): ContextEpoch => ({
    generation,
    baseline,
    budget,
    timestamp: Date.now()
  }),

  isStale: (epoch: ContextEpoch, maxAgeMs: number): boolean =>
    Date.now() - epoch.timestamp > maxAgeMs
} as const

/**
 * Serializable representation of a scope's full state at a point in time.
 * Produced by snapshot, consumed by restore.
 */
export interface ContextSnapshot {
  readonly scope: ContextScope
  readonly data: ReadonlyMap<string, unknown>
  readonly epoch: ContextEpoch | null
  readonly version: number
}

export const ContextSnapshot = {
  make: (
    scope: ContextScope,
    data: ReadonlyMap<string, unknown>,
    epoch: ContextEpoch | null,
    version: number
  ): ContextSnapshot => ({
    scope,
    data,
    epoch,
    version
  }),

  empty: (scope: ContextScope): ContextSnapshot => ({
    scope,
    data: new Map(),
    epoch: null,
    version: 0
  })
} as const

/**
 * Compaction strategy options.
 * auto: trigger when budget decreases
 * explicit: trigger at safe provider-turn boundaries
 * hybrid: both (default per Q18)
 */
export type CompactionStrategy = "auto" | "explicit" | "hybrid"

/**
 * Generation type (matches core/system-context)
 */
export interface Generation {
  readonly baseline: string
  readonly snapshot: Record<string, { readonly value: unknown; readonly removed?: string }>
}

/**
 * Errors
 */
export class ScopeNotFoundError extends Schema.TaggedErrorClass<ScopeNotFoundError>()(
  "ScopeNotFoundError",
  { scope: Schema.Unknown }
) {}

export class ContextError extends Schema.TaggedErrorClass<ContextError>()(
  "ContextError",
  { message: Schema.String }
) {}

/**
 * Internal state per scope (not exported)
 */
export interface ScopeState {
  readonly data: Map<string, unknown>
  readonly epoch: ContextEpoch | null
  readonly budget: ContextBudget
  readonly version: number
  readonly dirtyKeys: Set<string>
}

export const ScopeState = {
  empty: (budget: ContextBudget): ScopeState => ({
    data: new Map(),
    epoch: null,
    budget,
    version: 0,
    dirtyKeys: new Set()
  })
} as const