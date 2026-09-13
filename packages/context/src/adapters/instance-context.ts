import { Context, Effect, Layer, Option } from "effect"
import type { ContextService, ContextSnapshot, ContextBudget, ContextEpoch, ContextScope } from "../context"

/**
 * InstanceContext Adapter - Minimal
 */
export interface InstanceContext {
  readonly directory: string
  readonly worktree: string | undefined
}

// ponytail: local stub — @openaxe/context must not import openaxe/effect/instance-ref (workspace:* cycle)
export const InstanceRef = Context.Reference<InstanceContext | undefined>("~openaxe/InstanceRef", {
  defaultValue: () => undefined,
})

export const toProjectScope = (ctx: InstanceContext): ContextScope => ({
  _tag: "ProjectScope",
  dir: ctx.directory,
})

export interface InstanceContextAdapterInterface {
  getContext: () => Effect.Effect<InstanceContext, unknown, unknown>
  getDirectory: () => Effect.Effect<string, unknown, unknown>
  get: (key: string) => Effect.Effect<Option.Option<unknown>, unknown, unknown>
  set: (key: string, value: unknown) => Effect.Effect<void, unknown, unknown>
  delete: (key: string) => Effect.Effect<boolean, unknown, unknown>
  has: (key: string) => Effect.Effect<boolean, unknown, unknown>
  snapshot: () => Effect.Effect<ContextSnapshot, unknown, unknown>
  restore: (snapshot: ContextSnapshot) => Effect.Effect<void, unknown, unknown>
  initializeEpoch: (baseline: unknown, budget?: ContextBudget) => Effect.Effect<ContextEpoch, unknown, unknown>
  getEpoch: () => Effect.Effect<Option.Option<ContextEpoch>, unknown, unknown>
  replaceEpoch: (epoch: ContextEpoch) => Effect.Effect<void, unknown, unknown>
  getBudget: () => Effect.Effect<ContextBudget, unknown, unknown>
  setBudget: (budget: ContextBudget) => Effect.Effect<void, unknown, unknown>
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
  set: (key: string, value: unknown) =>
    getContext().pipe(Effect.flatMap((ctx) => unified.set(toProjectScope(ctx), key, value))),
  delete: (key: string) => getContext().pipe(Effect.flatMap((ctx) => unified.delete(toProjectScope(ctx), key))),
  has: (key: string) =>
    getContext().pipe(Effect.flatMap((ctx) => unified.get(toProjectScope(ctx), key).pipe(Effect.map(Option.isSome)))),
  snapshot: () => getContext().pipe(Effect.flatMap((ctx) => unified.snapshot(toProjectScope(ctx)))),
  restore: (snapshot: ContextSnapshot) =>
    getContext().pipe(Effect.flatMap((ctx) => unified.restore(toProjectScope(ctx), snapshot))),
  initializeEpoch: (baseline: unknown, budget?: ContextBudget) =>
    getContext().pipe(
      Effect.flatMap((ctx) =>
        unified.initializeEpoch(toProjectScope(ctx), baseline, budget),
      ),
    ),
  getEpoch: () => getContext().pipe(Effect.flatMap((ctx) => unified.getEpoch(toProjectScope(ctx)))),
  replaceEpoch: (epoch: ContextEpoch) =>
    getContext().pipe(Effect.flatMap((ctx) => unified.replaceEpoch(toProjectScope(ctx), epoch))),
  getBudget: () => getContext().pipe(Effect.flatMap((ctx) => unified.getBudget(toProjectScope(ctx)))),
  setBudget: (budget: ContextBudget) =>
    getContext().pipe(Effect.flatMap((ctx) => unified.setBudget(toProjectScope(ctx), budget))),
  compact: (strategy?: "auto" | "explicit" | "hybrid") =>
    getContext().pipe(Effect.flatMap((ctx) => unified.compact(toProjectScope(ctx), strategy))),
  release: () => getContext().pipe(Effect.flatMap((ctx) => unified.releaseScope(toProjectScope(ctx)))),
  getOrLoad: (key: string, loader: () => Effect.Effect<unknown>) =>
    getContext().pipe(Effect.flatMap((ctx) => unified.getOrLoad(toProjectScope(ctx), key, loader))),
})

/**
 * InstanceContext Adapter Service
 */
export class InstanceContextAdapter extends Context.Service<InstanceContextAdapter, InstanceContextAdapterInterface>()(
  "@openaxe/InstanceContextAdapter",
) {}

/**
 * Layer that provides the InstanceContext adapter
 */
export const InstanceContextAdapterLayer = (unified: ContextService) =>
  Layer.succeed(InstanceContextAdapter, makeInstanceContextAdapter(unified))

export * as InstanceContext from "./instance-context"
