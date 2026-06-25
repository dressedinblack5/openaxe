import { performance } from "node:perf_hooks"

async function time(label, fn) {
  const t0 = performance.now()
  await fn()
  console.log(`${label.padEnd(60)} ${(performance.now() - t0).toFixed(0)}ms`)
}

async function measure() {
  console.log("\n=== Heavy command sub-imports ===\n")
  
  // run.ts specific imports
  await time(`@opencode-ai/sdk/v2`, () => import("@opencode-ai/sdk/v2"))
  await time(`@/util/filesystem`, () => import("@/util/filesystem"))
  await time(`../effect-cmd`, () => import("./src/cli/effect-cmd"))
  
  console.log()
  
  // providers.ts
  await time(`../../auth (providers)`, () => import("./src/auth"))
  await time(`../../plugin`, () => import("./src/plugin"))
  await time(`@/config/config`, () => import("./src/config/config"))
  await time(`@/util/process`, () => import("./src/util/process"))
  
  console.log()
  
  // debug.ts specific
  await time(`@/cli/cmd/debug imports`, () => import("@/cli/cmd/debug"))
  
  console.log()
  
  // mcp.ts specific
  await time(`@/mcp`, () => import("./src/mcp"))
  await time(`@/mcp/auth`, () => import("./src/mcp/auth"))
  await time(`@/mcp/oauth-provider`, () => import("./src/mcp/oauth-provider"))
  await time(`@/event-v2-bridge`, () => import("./src/event-v2-bridge"))
  await time(`@modelcontextprotocol/sdk/client/index.js`, () => import("@modelcontextprotocol/sdk/client/index.js"))
  
  console.log()
  
  // account.ts specific
  await time(`@/account/account`, () => import("./src/account/account"))
}

measure()
