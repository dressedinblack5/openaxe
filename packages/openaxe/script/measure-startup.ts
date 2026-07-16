import { performance } from "node:perf_hooks"

async function time<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now()
  const result = await fn()
  console.log(`  ${label.padEnd(60)} ${(performance.now() - t0).toFixed(0)}ms`)
  return result
}

async function measure() {
  const start = performance.now()
  console.log("\n=== Agent & Database import breakdown ===\n")

  // Agent dependencies
  await time(`ai (Vercel SDK)`, () => import("ai"))
  await time(`@effect/opentelemetry/Tracer`, () => import("@effect/opentelemetry/Tracer"))
  await time(`@opencode-ai/core/v1/permission`, () => import("@opencode-ai/core/v1/permission"))
  await time(`@opencode-ai/core/effect/layer-node`, () => import("@opencode-ai/core/effect/layer-node"))
  await time(`@opencode-ai/core/effect/service-use`, () => import("@opencode-ai/core/effect/service-use"))
  await time(`@opencode-ai/core/schema`, () => import("@opencode-ai/core/schema"))
  await time(`@opencode-ai/core/provider`, () => import("@opencode-ai/core/provider"))
  await time(`@opencode-ai/core/model`, () => import("@opencode-ai/core/model"))
  await time(`@opencode-ai/core/location-layer`, () => import("@opencode-ai/core/location-layer"))
  await time(`@opencode-ai/core/reference`, () => import("@opencode-ai/core/reference"))
  await time(`@opencode-ai/core/location`, () => import("@opencode-ai/core/location"))
  await time(`@opencode-ai/core/plugin`, () => import("@opencode-ai/core/plugin"))
  await time(`@opencode-ai/core/global`, () => import("@opencode-ai/core/global"))

  console.log()
  
  // Database module breakdown
  await time(`@opencode-ai/core/database/database`, () => import("@opencode-ai/core/database/database"))

  console.log()
  
  // fs-util
  await time(`@opencode-ai/core/fs-util`, () => import("@opencode-ai/core/fs-util"))
  
  console.log()
  
  // command module
  await time(`@/command`, () => import("../src/command"))
  
  console.log()

  console.log(`\n  ${"TOTAL".padEnd(60)} ${(performance.now() - start).toFixed(0)}ms`)
}

measure().catch(console.error)
