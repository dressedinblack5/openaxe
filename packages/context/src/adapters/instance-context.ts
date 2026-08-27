import { Context, Effect, Layer, Option } from "effect"
import type { ContextService, ContextSnapshot, ContextBudget, ContextEpoch } from "../context"

/**
 * InstanceContext Adapter - Minimal
 */
export interface InstanceContext {
  readonly directory: string
  readonly worktree: string | undefined
}

// ponytail: local stub — @openaxe/context must not import openaxe/effect/instance-ref (workspace:* cycle)
export const InstanceRef = Context.Reference<InstanceContext | undefined>("~openaxe/InstanceRef", {
  defaultValue: () => undefined
})

export const toProjectScope = (ctx: InstanceContext): import("../context").ContextScope => ({
  _tag: "ProjectScope",
  dir: ctx.directory
})

export interface InstanceContextAdapterInterface {
  getContext: () => Effect.Effect<InstanceContext, unknown, unknown>
  getDirectory: () => Effect.Effect<string, unknown, unknown>
  get: (key: string) => Effect.Effect<Option.Option<unknown>, unknown, unknown>
  set: (key: string, value: unknown) => Effect.Effect<void, unknown, unknown>
  delete: (key: string) => Effect.Effect<boolean, unknown, unknown>
  has: (key: string) => Effect.Effect<boolean, unknown, unknown>
  snapshot: () => Effect.Effect<unknown, unknown, unknown>
  restore: (snapshot: unknown) => Effect.Effect<void, unknown, unknown>
  initializeEpoch: (baseline: unknown, budget?: unknown) => Effect.Effect<unknown, unknown, unknown>
  getEpoch: () => Effect.Effect<Option.Option<unknown>, unknown, unknown>
  replaceEpoch: (epoch: unknown) => Effect.Effect<void, unknown, unknown>
  getBudget: () => Effect.Effect<unknown, unknown, unknown>
  setBudget: (budget: unknown) => Effect.Effect<void, unknown, unknown>
  compact: (strategy?: "auto" | "explicit" | "hybrid") => Effect.Effect<unknown, unknown, unknown>
  release: () => Effect.Effect<void, unknown, unknown>
  getOrLoad: (key: string, loader: () => Effect.Effect<unknown>) => Effect.Effect<unknown, unknown, unknown>
}

const getContext = (): Effect.Effect<InstanceContext, unknown, unknown> =>
  Effect.gen(function* () {
    const ctx = yield* InstanceRef
    if (!ctx) return yield* Effect.die(new Error("InstanceRef not provided"))
    return ctx
  })

const getDirectory = (): Effect.Effect<string, unknown, unknown> =>
  Effect.gen(function* () {
    const ctx = yield* InstanceRef
    if (!ctx) return yield* Effect.die(new Error("InstanceRef not provided"))
    return ctx.directory
  })

export const makeInstanceContextAdapter = (unified: ContextService): InstanceContextAdapterInterface => ({
  getContext,
  getDirectory,
  get: (key: string) => getContext().pipe(Effect.flatMap((ctx) => unified.get(toProjectScope(ctx), key))),
  set: (key: string, value: unknown) => getContext().pipe(Effect.flatMap((ctx) => unified.set(toProjectScope(ctx), key, value))),
  delete: (key: string) => getContext().pipe(Effect.flatMap((ctx) => unified.delete(toProjectScope(ctx), key))),
  has: (key: string) =>
    getContext().pipe(Effect.flatMap((ctx) => unified.get(toProjectScope(ctx), key).pipe(Effect.map(Option.isSome)))),
  snapshot: () => getContext().pipe(Effect.flatMap((ctx) => unified.snapshot(toProjectScope(ctx)))),
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter boundary narrows unknown to ContextSnapshot
  restore: (snapshot: unknown) => getContext().pipe(Effect.flatMap((ctx) => unified.restore(toProjectScope(ctx), snapshot as ContextSnapshot))),
  initializeEpoch: (baseline: unknown, budget?: unknown) =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter boundary narrows unknown to ContextBudget
    getContext().pipe(Effect.flatMap((ctx) => unified.initializeEpoch(toProjectScope(ctx), baseline, budget as ContextBudget | undefined))),
  getEpoch: () => getContext().pipe(Effect.flatMap((ctx) => unified.getEpoch(toProjectScope(ctx)))),
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter boundary narrows unknown to ContextEpoch
  replaceEpoch: (epoch: unknown) => getContext().pipe(Effect.flatMap((ctx) => unified.replaceEpoch(toProjectScope(ctx), epoch as ContextEpoch))),
  getBudget: () => getContext().pipe(Effect.flatMap((ctx) => unified.getBudget(toProjectScope(ctx)))),
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- adapter boundary narrows unknown to ContextBudget
  setBudget: (budget: unknown) => getContext().pipe(Effect.flatMap((ctx) => unified.setBudget(toProjectScope(ctx), budget as ContextBudget))),
  compact: (strategy?: "auto" | "explicit" | "hybrid") =>
    getContext().pipe(Effect.flatMap((ctx) => unified.compact(toProjectScope(ctx), strategy))),
  release: () => getContext().pipe(Effect.flatMap((ctx) => unified.releaseScope(toProjectScope(ctx)))),
  getOrLoad: (key: string, loader: () => Effect.Effect<unknown>) =>
    getContext().pipe(Effect.flatMap((ctx) => unified.getOrLoad(toProjectScope(ctx), key, loader)))
})

/**
 * InstanceContext Adapter Service
 */
export class InstanceContextAdapter extends Context.Service<InstanceContextAdapter, InstanceContextAdapterInterface>()(
  "@openaxe/InstanceContextAdapter"
) {}

/**
 * Layer that provides the InstanceContext adapter
 */
export const InstanceContextAdapterLayer = (unified: ContextService) =>
  Layer.succeed(InstanceContextAdapter, makeInstanceContextAdapter(unified))

export * as InstanceContext from "./instance-context"
