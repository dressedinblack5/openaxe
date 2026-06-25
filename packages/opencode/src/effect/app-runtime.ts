import { Effect, Layer, ManagedRuntime } from "effect"
import type { Exit } from "effect/Exit"
import { attach } from "./run-service"
import { memoMap } from "@opencode-ai/core/effect/memo-map"

// Type-only import — never evaluates ./app-layer at module scope
import type { AppServices } from "./app-layer"

export type { AppServices }

/**
 * Lazy AppLayer — the 45+ service modules (auth, database, plugin, lsp, etc.)
 * are loaded via dynamic import only when this layer is first constructed,
 * i.e. on the first AppRuntime.run*() call.
 */
const AppLayer = Layer.unwrap(
  Effect.promise(async () => {
    const { AppLayer: RealLayer } = await import("./app-layer")
    return RealLayer
  }),
)

let _rt: ManagedRuntime.ManagedRuntime<any, any> | undefined
const getRuntime = () => {
  if (_rt) return _rt
  _rt = ManagedRuntime.make(AppLayer, { memoMap })
  return _rt
}

const wrap = (effect: Effect.Effect<any, any, any>) => attach(effect) as never

export const AppRuntime = {
  runSync<A>(effect: Effect.Effect<A, any, any>): A {
    return getRuntime().runSync(wrap(effect) as Effect.Effect<A, any, never>)
  },
  runPromise<A>(effect: Effect.Effect<A, any, any>, options?: Effect.RunOptions): Promise<A> {
    return getRuntime().runPromise(wrap(effect) as Effect.Effect<A, any, never>, options) as Promise<A>
  },
  runPromiseExit<A, E>(effect: Effect.Effect<A, E, any>, options?: Effect.RunOptions): Promise<Exit<A, E>> {
    return getRuntime().runPromiseExit(wrap(effect) as Effect.Effect<A, E, never>, options) as Promise<Exit<A, E>>
  },
  runFork(effect: Effect.Effect<any, any, any>) {
    return getRuntime().runFork(wrap(effect) as Effect.Effect<any, any, never>)
  },
  runCallback(effect: Effect.Effect<any, any, any>) {
    return getRuntime().runCallback(wrap(effect) as Effect.Effect<any, any, never>)
  },
  dispose() {
    getRuntime().dispose()
  },
}
