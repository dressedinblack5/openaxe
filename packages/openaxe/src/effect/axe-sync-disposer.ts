import { Effect, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { AxeSync } from "@opencode-ai/core/axe-sync"
import { Memory } from "@opencode-ai/core/memory"
import { Database } from "@opencode-ai/core/database/database"
import { registerDisposer } from "./instance-registry"

const disposerLayer = AxeSync.defaultLayer.pipe(
  Layer.provide(Memory.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(NodeFileSystem.layer),
)

registerDisposer((directory) =>
  Effect.runPromise(
    AxeSync.Service.use((svc) => svc.save(directory)).pipe(
      Effect.provide(disposerLayer),
      Effect.ignoreCause,
    ),
  ),
)
