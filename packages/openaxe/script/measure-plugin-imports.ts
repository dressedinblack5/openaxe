import { performance } from "node:perf_hooks"

async function time(label: string, fn: () => Promise<unknown>) {
  const t0 = performance.now()
  await fn()
  console.log(`${label.padEnd(60)} ${(performance.now() - t0).toFixed(0)}ms`)
}

async function measure() {
  console.log("\n=== Plugin sub-imports ===\n")
  
  await time(`@opencode-ai/core/util/glob`, () => import("@opencode-ai/core/util/glob"))
  await time(`@opencode-ai/core/fs-util`, () => import("@opencode-ai/core/fs-util"))
  
  console.log()
  
  // Plugin heavy candidates
  await time(`@/server/auth`, () => import("@/server/auth"))
  await time(`@opencode-ai/core/project`, () => import("@opencode-ai/core/project"))
  await time(`@opencode-ai/core/plugin`, () => import("@opencode-ai/core/plugin"))
  await time(`@opencode-ai/plugin`, () => import("@opencode-ai/plugin"))
}

void measure()
