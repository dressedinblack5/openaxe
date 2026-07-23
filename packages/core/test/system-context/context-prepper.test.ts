import { test, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { execFileSync } from "child_process"
import { Effect, Layer } from "effect"
import { AppProcess } from "@opencode-ai/core/process"
import { Location } from "@opencode-ai/core/location"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { SystemContext } from "@opencode-ai/core/system-context"
import { ContextPrepper } from "@opencode-ai/core/context-prepper"

const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
})()

// ponytail: skip git-dependent tests when git isn't available instead of
// polyfilling — a JS git impl or forcing git on CI runners is more weight
// than these tests justify
const testIf = hasGit ? test : test.skip

function git(dir: string, ...args: string[]) {
  execFileSync("git", args, { cwd: dir })
}

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "context-prepper-test-"))
}

async function createTempRepo(): Promise<string> {
  const dir = await tempDir()
  git(dir, "init", "-b", "main")
  git(dir, "config", "user.email", "test@test.com")
  git(dir, "config", "user.name", "Test")
  await fs.writeFile(path.join(dir, "README.md"), "# test\n")
  await fs.writeFile(path.join(dir, "main.ts"), "console.log('hello')\n")
  git(dir, "add", "-A")
  git(dir, "commit", "-m", "init")
  return dir
}

function contextLayer(dir: string) {
  const locationL = Layer.succeed(
    Location.Service,
    Location.Service.of({
      directory: AbsolutePath.make(dir),
      project: { id: Project.ID.global, directory: AbsolutePath.make(dir) },
    } satisfies Location.Interface),
  )

  return ContextPrepper.layer.pipe(
    Layer.provideMerge(AppProcess.defaultLayer),
    Layer.provideMerge(SystemContextRegistry.layer),
    Layer.provideMerge(locationL),
  )
}

function loadContext(dir: string) {
  return contextLayer(dir).pipe(
    Layer.build,
    Effect.flatMap((env) =>
      Effect.gen(function* () {
        const registry = yield* SystemContextRegistry.Service.pipe(Effect.provide(env))
        const contexts = yield* registry.load()
        return yield* SystemContext.initialize(contexts)
      }),
    ),
    Effect.scoped,
  )
}

testIf("ContextPrepper reports recent git changes", async () => {
  const dir = await createTempRepo()
  try {
    await fs.writeFile(path.join(dir, "main.ts"), "console.log('modified')\n")
    await fs.writeFile(path.join(dir, "new.ts"), "export const x = 1\n")
    await fs.unlink(path.join(dir, "README.md"))
    git(dir, "add", "new.ts")

    const ctx = await Effect.runPromise(loadContext(dir))

    expect(ctx.baseline).toContain("<recent_changes>")
    expect(ctx.baseline).toContain("main.ts")
    expect(ctx.baseline).toContain("modified")
    expect(ctx.baseline).toContain("new.ts")
    expect(ctx.baseline).toContain("added")
    expect(ctx.baseline).toContain("README.md")
    expect(ctx.baseline).toContain("deleted")
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}, 10_000)

testIf("ContextPrepper returns empty when repo has no changes", async () => {
  const dir = await createTempRepo()
  try {
    const ctx = await Effect.runPromise(loadContext(dir))

    expect(ctx.baseline).not.toContain("<recent_changes>")
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}, 10_000)

test("ContextPrepper returns empty outside a git repo", async () => {
  const dir = await tempDir()
  try {
    const ctx = await Effect.runPromise(loadContext(dir))

    expect(ctx.baseline).not.toContain("<recent_changes>")
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}, 10_000)

testIf("ContextPrepper handles renamed files as modified", async () => {
  const dir = await createTempRepo()
  try {
    git(dir, "mv", "main.ts", "lib.ts")
    git(dir, "mv", "README.md", "README-renamed.md")

    const ctx = await Effect.runPromise(loadContext(dir))

    expect(ctx.baseline).toContain("lib.ts")
    expect(ctx.baseline).toContain("modified")
    expect(ctx.baseline).toContain("README-renamed.md")
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}, 10_000)
