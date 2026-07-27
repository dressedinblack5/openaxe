import { performance } from "node:perf_hooks"

async function time(label: string, fn: () => Promise<unknown>) {
  const t0 = performance.now()
  await fn()
  console.log(`${label.padEnd(60)} ${(performance.now() - t0).toFixed(0)}ms`)
}

async function measure() {
  console.log("\n=== UI module imports ===\n")
  await time(`@/cli/ui`, () => import("@/cli/ui"))
}

void measure()
