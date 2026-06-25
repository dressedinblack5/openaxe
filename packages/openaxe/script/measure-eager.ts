import { performance } from "node:perf_hooks"

async function time(label: string, fn: () => Promise<unknown>) {
  const t0 = performance.now()
  await fn()
  const elapsed = performance.now() - t0
  console.log(`${label.padEnd(60)} ${elapsed.toFixed(0)}ms`)
}

async function measure() {
  console.log("\n=== EAGER command imports (loaded at index.ts top level) ===\n")
  
  await time(`yargs`, () => import("yargs"))
  await time(`yargs/helpers`, () => import("yargs/helpers"))
  
  // eager commands
  await time(`@/cli/cmd/generate`, () => import("@/cli/cmd/generate"))
  await time(`@/cli/cmd/upgrade`, () => import("@/cli/cmd/upgrade"))
  await time(`@/cli/cmd/uninstall`, () => import("@/cli/cmd/uninstall"))
  await time(`@/cli/cmd/serve`, () => import("@/cli/cmd/serve"))
  await time(`@/cli/cmd/github`, () => import("@/cli/cmd/github"))
  await time(`@/cli/cmd/export`, () => import("@/cli/cmd/export"))
  await time(`@/cli/cmd/attach`, () => import("@/cli/cmd/attach"))
  await time(`@/cli/cmd/tui`, () => import("@/cli/cmd/tui"))
  await time(`@/cli/cmd/acp`, () => import("@/cli/cmd/acp"))
  await time(`@/cli/cmd/web`, () => import("@/cli/cmd/web"))
  await time(`@/cli/cmd/pr`, () => import("@/cli/cmd/pr"))
  await time(`@/cli/cmd/session`, () => import("@/cli/cmd/session"))
  await time(`@/cli/cmd/db`, () => import("@/cli/cmd/db"))
  await time(`@/cli/cmd/plug`, () => import("@/cli/cmd/plug"))
  
  // other eager modules
  await time(`@/cli/error`, () => import("@/cli/error"))
  await time(`@/cli/lazy-command`, () => import("@/cli/lazy-command"))
  await time(`@opencode-ai/core/installation/version`, () => import("@opencode-ai/core/installation/version"))
  await time(`@/util/error`, () => import("@/util/error"))
  
  // cli/ui import already measured
  await time(`@/cli/ui`, () => import("@/cli/ui"))
}

measure().catch(console.error)
