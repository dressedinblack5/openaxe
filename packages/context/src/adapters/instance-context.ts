import { Effect, Layer, Option, Context } from "effect"
import type { ContextService } from "../context"
import { InstanceRef } from "openaxe/effect/instance-ref"

/**
 * InstanceContext Adapter - Minimal
 */
export interface InstanceContext {
  readonly directory: string
  readonly worktree: string | undefined
}

export const toProjectScope = (ctx: InstanceContext): import("../context").ContextScope => ({
  _tag: "ProjectScope",
  dir: ctx.directory
})

export interface InstanceContextAdapterInterface {
  getContext: () => Effect.Effect<InstanceContext, unknown, unknown>
  getDirectory: () => Effect.Effect<string, unknown, unknown>
  get: <A>(key: string) => Effect.Effect<Option.Option<A>, unknown, unknown>
  set: <A>(key: string, value: A) => Effect.Effect<void, unknown, unknown>
  delete: (key: string) => Effect.Effect<boolean, unknown, unknown>
  has: (key: string) => Effect.Effect<boolean, unknown, unknown>
  snapshot: () => Effect.Effect<any, unknown, unknown>
  restore: (snapshot: any) => Effect.Effect<void, unknown, unknown>
  initializeEpoch: (baseline: unknown, budget?: any) => Effect.Effect<any, unknown, unknown>
  getEpoch: () => Effect.Effect<Option.Option<any>, unknown, unknown>
  replaceEpoch: (epoch: any) => Effect.Effect<void, unknown, unknown>
  getBudget: () => Effect.Effect<any, unknown, unknown>
  setBudget: (budget: any) => Effect.Effect<void, unknown, unknown>
  compact: (strategy?: "auto" | "explicit" | "hybrid") => Effect.Effect<any, unknown, unknown>
  release: () => Effect.Effect<void, unknown, unknown>
  getOrLoad: <A>(key: string, loader: () => Effect.Effect<A>) => Effect.Effect<A, unknown, unknown>
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
  get: <A>(key: string) => getContext().pipe(
    Effect.flatMap((ctx) => unified.get<A>(toProjectScope(ctx), key))
  ),
  set: <A>(key: string, value: A) => getContext().pipe(
    Effect.flatMap((ctx) => unified.set(toProjectScope(ctx), key, value))
  ),
  delete: (key: string) => getContext().pipe(
    Effect.flatMap((ctx) => unified.delete(toProjectScope(ctx), key))
  ),
  has: (key: string) => getContext().pipe(
    Effect.flatMap((ctx) => unified.get<unknown>(toProjectScope(ctx), key).pipe(
      Effect.map(Option.isSome)
    ))
  ),
  snapshot: () => getContext().pipe(
    Effect.flatMap((ctx) => unified.snapshot(toProjectScope(ctx)))
  ),
  restore: (snapshot: any) => getContext().pipe(
    Effect.flatMap((ctx) => unified.restore(toProjectScope(ctx), snapshot))
  ),
  initializeEpoch: (baseline: unknown, budget?: any) => getContext().pipe(
    Effect.flatMap((ctx) => unified.initializeEpoch(toProjectScope(ctx), baseline, budget))
  ),
  getEpoch: () => getContext().pipe(
    Effect.flatMap((ctx) => unified.getEpoch(toProjectScope(ctx)))
  ),
  replaceEpoch: (epoch: any) => getContext().pipe(
    Effect.flatMap((ctx) => unified.replaceEpoch(toProjectScope(ctx), epoch))
  ),
  getBudget: () => getContext().pipe(
    Effect.flatMap((ctx) => unified.getBudget(toProjectScope(ctx)))
  ),
  setBudget: (budget: any) => getContext().pipe(
    Effect.flatMap((ctx) => unified.setBudget(toProjectScope(ctx), budget))
  ),
  compact: (strategy?: "auto" | "explicit" | "hybrid") => getContext().pipe(
    Effect.flatMap((ctx) => unified.compact(toProjectScope(ctx), strategy))
  ),
  release: () => getContext().pipe(
    Effect.flatMap((ctx) => unified.releaseScope(toProjectScope(ctx)))
  ),
  getOrLoad: <A>(key: string, loader: () => Effect.Effect<A>) => getContext().pipe(
    Effect.flatMap((ctx) => unified.getOrLoad(toProjectScope(ctx), key, loader))
  )
})

/**
 * InstanceContext Adapter Service
 */
export class InstanceContextAdapter extends Context.Service<InstanceContextAdapter, InstanceContextAdapterInterface>()("@openaxe/InstanceContextAdapter") {}

/**
 * Layer that provides the InstanceContext adapter
 */
export const InstanceContextAdapterLayer = (unified: ContextService) =>
  Layer.succeed(InstanceContextAdapter, makeInstanceContextAdapter(unified))

export * as InstanceContext from "./instance-context"