import { performance } from "node:perf_hooks"

async function time(label, fn) {
  const t0 = performance.now()
  await fn()
  console.log(`${label.padEnd(60)} ${(performance.now() - t0).toFixed(0)}ms`)
}

async function measure() {
  console.log("\n=== debug sub-imports ===\n")
  
  // debug.ts had no import lines match... let me check if it uses effectCmd
  await time(`@/cli/cmd/debug`, () => import("@/cli/cmd/debug"))
  
  // session/session breakdown
  console.log("\n--- session ---\n")
  await time(`@/session/session`, () => import("@/session/session"))
}

measure()
