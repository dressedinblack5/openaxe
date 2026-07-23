import { performance } from "node:perf_hooks"

async function time(label: string, fn: () => Promise<unknown>) {
  const t0 = performance.now()
  await fn()
  console.log(`${label.padEnd(60)} ${(performance.now() - t0).toFixed(0)}ms`)
}

async function measure() {
  console.log("\n=== fs-util sub-imports ===\n")
  
  await time(`@effect/platform-node`, () => import("@effect/platform-node"))
  await time(`mime-types`, () => import("mime-types"))
  await time(`@opencode-ai/core/util/glob`, () => import("@opencode-ai/core/util/glob"))
  await time(`@opencode-ai/core/effect/service-use`, () => import("@opencode-ai/core/effect/service-use"))
  await time(`@opencode-ai/core/effect/layer-node`, () => import("@opencode-ai/core/effect/layer-node"))
  await time(`@opencode-ai/core/effect/layer-node-platform`, () => import("@opencode-ai/core/effect/layer-node-platform"))
  
  console.log()
  
  // Also measure plugin/src/index imports that might be heavy
  await time(`@/session/session`, () => import("@/session/session"))
  await time(`@/effect/bridge`, () => import("@/effect/bridge"))
  await time(`@/effect/instance-state`, () => import("@/effect/instance-state"))
  await time(`@/plugin/loader`, () => import("@/plugin/loader"))
  await time(`@/control-plane/adapters`, () => import("@/control-plane/adapters"))
}

void measure()
