import { performance } from "node:perf_hooks"

async function time(label, fn) {
  const t0 = performance.now()
  await fn()
  console.log(`${label.padEnd(60)} ${(performance.now() - t0).toFixed(0)}ms`)
}

async function measure() {
  const start = performance.now()
  console.log("\n=== Full cold start imports (aligned to index.ts) ===\n")

  // 1. First the yargs + helpers  
  await time(`yargs`, () => import("yargs"))
  await time(`yargs/helpers`, () => import("yargs/helpers"))
  
  // 2. CLI UI + error
  await time(`@/cli/ui`, () => import("@/cli/ui"))
  await time(`@/cli/error`, () => import("@/cli/error"))
  await time(`@/cli/heap`, () => import("@/cli/heap"))
  await time(`@opencode-ai/core/installation/version`, () => import("@opencode-ai/core/installation/version"))

  // 3. All command modules (triggers heavy chains)
  await time(`@/cli/cmd/run`, () => import("@/cli/cmd/run"))
  await time(`@/cli/cmd/generate`, () => import("@/cli/cmd/generate"))
  await time(`@/cli/cmd/account`, () => import("@/cli/cmd/account"))
  await time(`@/cli/cmd/providers`, () => import("@/cli/cmd/providers"))
  await time(`@/cli/cmd/agent`, () => import("@/cli/cmd/agent"))
  await time(`@/cli/cmd/upgrade`, () => import("@/cli/cmd/upgrade"))
  await time(`@/cli/cmd/uninstall`, () => import("@/cli/cmd/uninstall"))
  await time(`@/cli/cmd/models`, () => import("@/cli/cmd/models"))
  await time(`@/cli/cmd/serve`, () => import("@/cli/cmd/serve"))
  await time(`@/cli/cmd/debug`, () => import("@/cli/cmd/debug"))
  await time(`@/cli/cmd/stats`, () => import("@/cli/cmd/stats"))
  await time(`@/cli/cmd/mcp`, () => import("@/cli/cmd/mcp"))
  await time(`@/cli/cmd/github`, () => import("@/cli/cmd/github"))
  await time(`@/cli/cmd/export`, () => import("@/cli/cmd/export"))
  await time(`@/cli/cmd/import_cmd`, () => import("@/cli/cmd/import"))
  await time(`@/cli/cmd/attach`, () => import("@/cli/cmd/attach"))
  await time(`@/cli/cmd/tui`, () => import("@/cli/cmd/tui"))
  await time(`@/cli/cmd/acp`, () => import("@/cli/cmd/acp"))
  await time(`@/cli/cmd/web`, () => import("@/cli/cmd/web"))
  await time(`@/cli/cmd/pr`, () => import("@/cli/cmd/pr"))
  await time(`@/cli/cmd/session`, () => import("@/cli/cmd/session"))
  await time(`@/cli/cmd/db`, () => import("@/cli/cmd/db"))
  await time(`@/cli/cmd/plug`, () => import("@/cli/cmd/plug"))

  console.log(`\n  TOTAL: ${(performance.now() - start).toFixed(0)}ms`)
  console.log("\n(Note: shared caching means actual total < sum of individuals)\n")
}

measure()
