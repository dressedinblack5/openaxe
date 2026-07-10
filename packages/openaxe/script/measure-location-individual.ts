import { performance } from "node:perf_hooks"

async function time(label: string, fn: () => Promise<unknown>) {
  const t0 = performance.now()
  await fn()
  console.log(`${label.padEnd(60)} ${(performance.now() - t0).toFixed(0)}ms`)
}

async function measure() {
  console.log("\n=== location.ts imports ===\n")
  // Already measured effect at 169ms in warm
  await time(`@opencode-ai/schema/location`, () => import("@opencode-ai/schema/location"))
  await time(`@opencode-ai/core/project`, () => import("@opencode-ai/core/project"))
  await time(`@opencode-ai/core/schema`, () => import("@opencode-ai/core/schema"))
  await time(`@opencode-ai/core/workspace`, () => import("@opencode-ai/core/workspace"))
}

measure()
