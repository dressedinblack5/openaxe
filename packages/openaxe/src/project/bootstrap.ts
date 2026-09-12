import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Plugin } from "../plugin"
import { Format } from "../format"
import { LSP } from "@/lsp/lsp"
import { Snapshot } from "../snapshot"
import { Project } from "./project"
import { Vcs } from "./vcs"
import { InstanceState } from "@/effect/instance-state"
import { ShareNext } from "@/share/share-next"
import { Effect, Layer } from "effect"
import { Config } from "@/config/config"
import { Provider } from "../provider/provider"
import { Service } from "./bootstrap-service"
import { mark } from "@/cli/startup-timing"

export { Service } from "./bootstrap-service"
export type { Interface } from "./bootstrap-service"

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const format = yield* Format.Service
    const plugin = yield* Plugin.Service
    const project = yield* Project.Service
    const shareNext = yield* ShareNext.Service
    const snapshot = yield* Snapshot.Service
    const vcs = yield* Vcs.Service
    const provider = yield* Provider.Service

    const run = Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      yield* Effect.logInfo("bootstrapping", { directory: ctx.directory })
      // config.get() and validateApiKeys() are independent: Provider state init
      // funnels into the same cached Config/Provider InstanceState (it awaits
      // plugin.init() internally), so they run concurrently. plugin.init() stays
      // sequential after to keep plugin hook order deterministic.
      yield* Effect.all(
        [
          config.get().pipe(Effect.tap(() => Effect.sync(() => mark("boot-config-done")))),
          provider.validateApiKeys().pipe(
            Effect.tap((results) => {
              const invalid = Object.entries(results).filter(([, v]) => !v.valid)
              if (invalid.length > 0) {
                for (const [providerID, result] of invalid) {
                  Effect.logWarning("API key validation failed", { providerID, error: result.error })
                }
              }
              return Effect.void
            }),
            Effect.tap(() => Effect.sync(() => mark("boot-apikeys-done"))),
            Effect.catchCause((cause) => Effect.logWarning("API key validation failed", { cause })),
          ),
        ],
        { concurrency: "unbounded", discard: true },
      )
      yield* plugin.init().pipe(Effect.tap(() => Effect.sync(() => mark("boot-plugin-done"))))
      yield* Effect.forEach(
        [
          ["shareNext", shareNext],
          ["format", format],
          ["vcs", vcs],
          ["snapshot", snapshot],
          ["project", project],
        ] as const,
        ([name, s]) =>
          s.init().pipe(
            Effect.catchCause((cause) => Effect.logWarning("init failed", { cause })),
            Effect.tap(() => Effect.sync(() => mark(`boot-init:${name}`))),
          ),
        { concurrency: "unbounded", discard: true },
      ).pipe(Effect.withSpan("InstanceBootstrap.init"))
    }).pipe(Effect.withSpan("InstanceBootstrap"))

    return Service.of({ run })
  }),
)

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide([
    Config.defaultLayer,
    Format.defaultLayer,
    LSP.defaultLayer,
    Plugin.defaultLayer,
    Project.defaultLayer,
    ShareNext.defaultLayer,
    Snapshot.defaultLayer,
    Vcs.defaultLayer,
    Provider.defaultLayer,
  ]),
)

export const node = LayerNode.make(layer, [
  Config.node,
  Format.node,
  LSP.node,
  Plugin.node,
  Project.node,
  ShareNext.node,
  Snapshot.node,
  Vcs.node,
  Provider.node,
])

export * as InstanceBootstrap from "./bootstrap"
