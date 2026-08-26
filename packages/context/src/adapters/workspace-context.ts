import { Effect, Layer, Option } from "effect"
import type { ContextService } from "../context"
import type { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { WorkspaceRef } from "openaxe/effect/instance-ref"

/**
 * WorkspaceContext Adapter - Minimal
 */
export interface WorkspaceContext {
  workspaceID: WorkspaceV2.ID | undefined
}

export const toWorkspaceScope = (workspaceID: WorkspaceV2.ID): import("../context").ContextScope => ({
  _tag: "WorkspaceScope",
  workspaceId: workspaceID
})

export interface WorkspaceContextAdapterInterface {
  provide: <R, E, A>(input: { workspaceID?: WorkspaceV2.ID; fn: Effect.Effect<A, E, R> }) => Effect.Effect<A, E, R>
  restore: (workspaceID: WorkspaceV2.ID, fn: Effect.Effect<unknown>) => Effect.Effect<unknown>
  getWorkspaceID: () => Effect.Effect<WorkspaceV2.ID | undefined, unknown, unknown>
  get: (workspaceID: WorkspaceV2.ID, key: string) => Effect.Effect<Option.Option<unknown>, unknown, unknown>
  set: (workspaceID: WorkspaceV2.ID, key: string, value: unknown) => Effect.Effect<void, unknown, unknown>
  delete: (workspaceID: WorkspaceV2.ID, key: string) => Effect.Effect<boolean, unknown, unknown>
  has: (workspaceID: WorkspaceV2.ID, key: string) => Effect.Effect<boolean, unknown, unknown>
  snapshot: (workspaceID: WorkspaceV2.ID) => Effect.Effect<unknown, unknown, unknown>
  restoreSnapshot: (workspaceID: WorkspaceV2.ID, snapshot: unknown) => Effect.Effect<void, unknown, unknown>
  initializeEpoch: (workspaceID: WorkspaceV2.ID, baseline: unknown, budget?: unknown) => Effect.Effect<unknown, unknown, unknown>
  getEpoch: (workspaceID: WorkspaceV2.ID) => Effect.Effect<Option.Option<unknown>, unknown, unknown>
  replaceEpoch: (workspaceID: WorkspaceV2.ID, epoch: unknown) => Effect.Effect<void, unknown, unknown>
  getBudget: (workspaceID: WorkspaceV2.ID) => Effect.Effect<unknown, unknown, unknown>
  setBudget: (workspaceID: WorkspaceV2.ID, budget: unknown) => Effect.Effect<void, unknown, unknown>
  compact: (workspaceID: WorkspaceV2.ID, strategy?: "auto" | "explicit" | "hybrid") => Effect.Effect<unknown, unknown, unknown>
  release: (workspaceID: WorkspaceV2.ID) => Effect.Effect<void, unknown, unknown>
  getOrLoad: (workspaceID: WorkspaceV2.ID, key: string, loader: () => Effect.Effect<unknown>) => Effect.Effect<unknown, unknown, unknown>
}

const getWorkspaceID = (): Effect.Effect<WorkspaceV2.ID | undefined, unknown, unknown> =>
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
    provide: <R, E, A>(input: { workspaceID?: WorkspaceV2.ID; fn: Effect.Effect<A, E, R> }): Effect.Effect<A, E, R> =>
      input.fn,

    restore: (_workspaceID: WorkspaceV2.ID, fn: Effect.Effect<unknown>): Effect.Effect<unknown> =>
      fn,

    getWorkspaceID,

    get: (workspaceID: WorkspaceV2.ID, key: string) =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        return yield* unified.get(scope, key)
      }),

    set: (workspaceID: WorkspaceV2.ID, key: string, value: unknown) =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        yield* unified.set(scope, key, value)
      }),

    delete: (workspaceID: WorkspaceV2.ID, key: string) =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        return yield* unified.delete(scope, key)
      }),

    has: (workspaceID: WorkspaceV2.ID, key: string) =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        const result = yield* unified.get(scope, key)
        return Option.isSome(result)
      }),

    snapshot: (workspaceID: WorkspaceV2.ID) =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        return yield* unified.snapshot(scope)
      }),

    restoreSnapshot: (workspaceID: WorkspaceV2.ID, snapshot: unknown) =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        yield* unified.restore(scope, snapshot)
      }),

    initializeEpoch: (workspaceID: WorkspaceV2.ID, baseline: unknown, budget?: unknown) =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        return yield* unified.initializeEpoch(scope, baseline, budget)
      }),

    getEpoch: (workspaceID: WorkspaceV2.ID) =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        return yield* unified.getEpoch(scope)
      }),

    replaceEpoch: (workspaceID: WorkspaceV2.ID, epoch: unknown) =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        yield* unified.replaceEpoch(scope, epoch)
      }),

    getBudget: (workspaceID: WorkspaceV2.ID) =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        return yield* unified.getBudget(scope)
      }),

    setBudget: (workspaceID: WorkspaceV2.ID, budget: unknown) =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        yield* unified.setBudget(scope, budget)
      }),

    compact: (workspaceID: WorkspaceV2.ID, strategy?: "auto" | "explicit" | "hybrid") =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        return yield* unified.compact(scope, strategy)
      }),

    release: (workspaceID: WorkspaceV2.ID) =>
      Effect.gen(function* () {
        const scope = toWorkspaceScope(workspaceID)
        yield* unified.releaseScope(scope)
      }),

    getOrLoad: <A>(workspaceID: WorkspaceV2.ID, key: string, loader: () => Effect.Effect<A>) =>
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
export class WorkspaceContextAdapter extends Context.Service<WorkspaceContextAdapter, WorkspaceContextAdapterInterface>()("@openaxe/WorkspaceContextAdapter") {}

/**
 * Layer that provides the WorkspaceContext adapter
 */
export const WorkspaceContextAdapterLayer = (unified: ContextService) =>
  Layer.succeed(WorkspaceContextAdapter, makeWorkspaceContextAdapter(unified))

export * as WorkspaceContext from "./workspace-context"