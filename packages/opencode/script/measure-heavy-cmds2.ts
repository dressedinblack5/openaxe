import { performance } from "node:perf_hooks"

async function time(label, fn) {
  const t0 = performance.now()
  await fn()
  console.log(`${label.padEnd(60)} ${(performance.now() - t0).toFixed(0)}ms`)
}

async function measure() {
  console.log("\n=== More heavy sub-imports ===\n")
  
  await time(`@/util/filesystem`, () => import("@/util/filesystem"))
  await time(`@/cli/effect-cmd`, () => import("@/cli/effect-cmd"))
  await time(`@/auth`, () => import("@/auth"))
  await time(`@/plugin`, () => import("@/plugin"))
  await time(`@/config/config`, () => import("@/config/config"))
  await time(`@/util/process`, () => import("@/util/process"))
  await time(`@/account/account`, () => import("@/account/account"))
  await time(`@/mcp`, () => import("@/mcp"))
  await time(`@/mcp/auth`, () => import("@/mcp/auth"))
  await time(`@/event-v2-bridge`, () => import("@/event-v2-bridge"))

  console.log()
  await time(`@modelcontextprotocol/sdk/client/index.js`, () => import("@modelcontextprotocol/sdk/client/index.js"))
  await time(`@/account/schema`, () => import("@/account/schema"))
  await time(`@opencode-ai/core/v1/config/config`, () => import("@opencode-ai/core/v1/config/config"))
  await time(`@opencode-ai/core/v1/config/mcp`, () => import("@opencode-ai/core/v1/config/mcp"))
}

measure()
