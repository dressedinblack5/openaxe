import { Effect, Layer, ManagedRuntime } from "effect"
import type { Exit } from "effect/Exit"
import { attach } from "./run-service"
import { memoMap } from "@opencode-ai/core/effect/memo-map"
import { mark } from "@/cli/startup-timing"

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
    mark("app-layer-import-start")
    const { AppLayer: RealLayer } = await import("./app-layer")
    mark("app-layer-import-done")
    return RealLayer
  }),
)

let _rt: ManagedRuntime.ManagedRuntime<any, any> | undefined
const getRuntime = () => {
  if (_rt) return _rt
  mark("managed-runtime-make")
  _rt = ManagedRuntime.make(AppLayer, { memoMap })
  return _rt
}

/**
 * Lazy CoreLayer — minimal subset of services for headless commands (serve, etc.).
 * Dynamically imports only the lightweight core layer, skipping session/LLM/LSP/MCP
 * services that add ~200MB.
 */
const CoreLayer = Layer.unwrap(
  Effect.promise(async () => {
    const { CoreLayer: RealLayer } = await import("./app-core-layer")
    return RealLayer
  }),
)

let _coreRt: ManagedRuntime.ManagedRuntime<any, any> | undefined
const getCoreRuntime = () => {
  if (_coreRt) return _coreRt
  _coreRt = ManagedRuntime.make(CoreLayer, { memoMap })
  return _coreRt
}

const wrap = (effect: Effect.Effect<any, any, any>) => attach(effect) as never

export const AppRuntime = {
  runSync<A>(effect: Effect.Effect<A, any, any>): A {
    return getRuntime().runSync(wrap(effect) as Effect.Effect<A, any>)
  },
  runPromise<A>(effect: Effect.Effect<A, any, any>, options?: Effect.RunOptions): Promise<A> {
    return getRuntime().runPromise(wrap(effect) as Effect.Effect<A, any>, options)
  },
  runPromiseExit<A, E>(effect: Effect.Effect<A, E, any>, options?: Effect.RunOptions): Promise<Exit<A, E>> {
    return getRuntime().runPromiseExit(wrap(effect) as Effect.Effect<A, E>, options) as Promise<Exit<A, E>>
  },
  runFork(effect: Effect.Effect<any, any, any>) {
    return getRuntime().runFork(wrap(effect) as Effect.Effect<any, any>)
  },
  runCallback(effect: Effect.Effect<any, any, any>) {
    return getRuntime().runCallback(wrap(effect) as Effect.Effect<any, any>)
  },
  dispose() {
    void getRuntime().dispose()
  },
}

/**
 * Minimal runtime for headless commands. Same interface as AppRuntime but
 * backed by CoreLayer (no session/LLM/LSP/MCP/etc. services).
 */
export const CoreRuntime = {
  runPromise<A>(effect: Effect.Effect<A, any, any>, options?: Effect.RunOptions): Promise<A> {
    return getCoreRuntime().runPromise(wrap(effect) as Effect.Effect<A, any>, options)
  },
  runFork(effect: Effect.Effect<any, any, any>) {
    return getCoreRuntime().runFork(wrap(effect) as Effect.Effect<any, any>)
  },
  dispose() {
    void getCoreRuntime().dispose()
  },
}
