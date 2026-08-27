import { Context, Effect, Layer, Option } from "effect"
import type { ContextService, ContextSnapshot, ContextBudget, ContextEpoch } from "../context"

// ponytail: local stubs — @openaxe/context must not import @opencode-ai/core or openaxe/effect/instance-ref
export type WorkspaceID = string
export const WorkspaceRef = Context.Reference<WorkspaceID | undefined>("~openaxe/WorkspaceRef", {
  defaultValue: () => undefined
})

/**
 * WorkspaceContext Adapter - Minimal
 */
export interface WorkspaceContext {
  workspaceID: WorkspaceID | undefined
}

export const toWorkspaceScope = (workspaceID: WorkspaceID): import("../context").ContextScope => ({
  _tag: "WorkspaceScope",
  workspaceId: workspaceID
})

export interface WorkspaceContextAdapterInterface {
  provide: <R, E, A>(input: { workspaceID?: WorkspaceID; fn: Effect.Effect<A, E, R> }) => Effect.Effect<A, E, R>
  restore: (workspaceID: WorkspaceID, fn: Effect.Effect<unknown>) => Effect.Effect<unknown>
  getWorkspaceID: () => Effect.Effect<WorkspaceID | undefined, unknown, unknown>
  get: (workspaceID: WorkspaceID, key: string) => Effect.Effect<Option.Option<unknown>, unknown, unknown>
  set: (workspaceID: WorkspaceID, key: string, value: unknown) => Effect.Effect<void, unknown, unknown>
  delete: (workspaceID: WorkspaceID, key: string) => Effect.Effect<boolean, unknown, unknown>
  has: (workspaceID: WorkspaceID, key: string) => Effect.Effect<boolean, unknown, unknown>
  snapshot: (workspaceID: WorkspaceID) => Effect.Effect<unknown, unknown, unknown>
  restoreSnapshot: (workspaceID: WorkspaceID, snapshot: unknown) => Effect.Effect<void, unknown, unknown>
  initializeEpoch: (workspaceID: WorkspaceID, baseline: unknown, budget?: unknown) => Effect.Effect<unknown, unknown, unknown>
  getEpoch: (workspaceID: WorkspaceID) => Effect.Effect<Option.Option<unknown>, unknown, unknown>
  replaceEpoch: (workspaceID: WorkspaceID, epoch: unknown) => Effect.Effect<void, unknown, unknown>
  getBudget: (workspaceID: WorkspaceID) => Effect.Effect<unknown, unknown, unknown>
  setBudget: (workspaceID: WorkspaceID, budget: unknown) => Effect.Effect<void, unknown, unknown>
  compact: (workspaceID: WorkspaceID, strategy?: "auto" | "explicit" | "hybrid") => Effect.Effect<unknown, unknown, unknown>
  release: (workspaceID: WorkspaceID) => Effect.Effect<void, unknown, unknown>
  getOrLoad: (workspaceID: WorkspaceID, key: string, loader: () => Effect.Effect<unknown>) => Effect.Effect<unknown, unknown, unknown>
}

const getWorkspaceID = (): Effect.Effect<WorkspaceID | undefined, unknown, unknown> =>
  Effect.gen(function* () {
    try {
      const ref = yield* WorkspaceRef
      return ref ?? undefined
    } catch {
      return undefined
    }
  })

export const makeWorkspaceContextAdapter = (unified: ContextService) => {
  const adapter = {
    provide: <R, E, A>(input: { workspaceID?: WorkspaceID; fn: Effect.Effect<A, E, R> }): Effect.Effect<A, E, R> => input.fn,

    restore: (_workspaceID: WorkspaceID, fn: Effect.Effect<unknown>): Effect.Effect<unknown> => fn,

    getWorkspaceID,

    get: (workspaceID: WorkspaceID, key: string) =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        return yield* unified.get(scope, key)
      }),

    set: (workspaceID: WorkspaceID, key: string, value: unknown) =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        yield* unified.set(scope, key, value)
      }),

    delete: (workspaceID: WorkspaceID, key: string) =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        return yield* unified.delete(scope, key)
      }),

    has: (workspaceID: WorkspaceID, key: string) =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        const result = yield* unified.get(scope, key)
        return Option.isSome(result)
      }),

    snapshot: (workspaceID: WorkspaceID) =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        return yield* unified.snapshot(scope)
      }),

    restoreSnapshot: (workspaceID: WorkspaceID, snapshot: unknown) =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter boundary narrows unknown to ContextSnapshot
        yield* unified.restore(scope, snapshot as ContextSnapshot)
      }),

    initializeEpoch: (workspaceID: WorkspaceID, baseline: unknown, budget?: unknown) =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter boundary narrows unknown to ContextBudget
        return yield* unified.initializeEpoch(scope, baseline, budget as ContextBudget | undefined)
      }),

    getEpoch: (workspaceID: WorkspaceID) =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        return yield* unified.getEpoch(scope)
      }),

    replaceEpoch: (workspaceID: WorkspaceID, epoch: unknown) =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter boundary narrows unknown to ContextEpoch
        yield* unified.replaceEpoch(scope, epoch as ContextEpoch)
      }),

    getBudget: (workspaceID: WorkspaceID) =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        return yield* unified.getBudget(scope)
      }),

    setBudget: (workspaceID: WorkspaceID, budget: unknown) =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter boundary narrows unknown to ContextBudget
        yield* unified.setBudget(scope, budget as ContextBudget)
      }),

    compact: (workspaceID: WorkspaceID, strategy?: "auto" | "explicit" | "hybrid") =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        return yield* unified.compact(scope, strategy)
      }),

    release: (workspaceID: WorkspaceID) =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        yield* unified.releaseScope(scope)
      }),

    getOrLoad: <A>(workspaceID: WorkspaceID, key: string, loader: () => Effect.Effect<A>) =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        return yield* unified.getOrLoad(scope, key, loader)
      })
  }
  return adapter
}

/**
 * WorkspaceContext Adapter Service
 */
export class WorkspaceContextAdapter extends Context.Service<WorkspaceContextAdapter, WorkspaceContextAdapterInterface>()(
  "@openaxe/WorkspaceContextAdapter"
) {}

/**
 * Layer that provides the WorkspaceContext adapter
 */
export const WorkspaceContextAdapterLayer = (unified: ContextService) =>
  Layer.succeed(WorkspaceContextAdapter, makeWorkspaceContextAdapter(unified))

export * as WorkspaceContext from "./workspace-context"
