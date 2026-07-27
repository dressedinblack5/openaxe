import { performance } from "node:perf_hooks"

async function time(label: string, fn: () => Promise<unknown>) {
  const t0 = performance.now()
  await fn()
  console.log(`${label.padEnd(60)} ${(performance.now() - t0).toFixed(0)}ms`)
}

async function measure() {
  console.log("\n=== Heavy command sub-imports ===\n")
  
  // run.ts specific imports
  await time(`@opencode-ai/sdk/v2`, () => import("@opencode-ai/sdk/v2"))
  await time(`@/util/filesystem`, () => import("@/util/filesystem"))
  await time(`@/cli/effect-cmd`, () => import("@/cli/effect-cmd"))
  
  console.log()
  
  // providers.ts
  await time(`@/auth`, () => import("@/auth"))
  await time(`@/plugin`, () => import("@/plugin"))
  await time(`@/config/config`, () => import("@/config/config"))
  await time(`@/util/process`, () => import("@/util/process"))
  
  console.log()
  
  // debug.ts specific
  await time(`@/cli/cmd/debug imports`, () => import("@/cli/cmd/debug"))
  
  console.log()
  
  // mcp.ts specific
  await time(`@/mcp`, () => import("@/mcp"))
  await time(`@/mcp/auth`, () => import("@/mcp/auth"))
  await time(`@/mcp/oauth-provider`, () => import("@/mcp/oauth-provider"))
  await time(`@/event-v2-bridge`, () => import("@/event-v2-bridge"))
  await time(`@modelcontextprotocol/sdk/client/index.js`, () => import("@modelcontextprotocol/sdk/client/index.js"))
  
  console.log()
  
  // account.ts specific
  await time(`@/account/account`, () => import("@/account/account"))
}

void measure()
