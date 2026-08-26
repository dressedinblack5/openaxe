import { Process } from "@opencode-ai/core/util/process"
import { ChildProcess } from "node:child_process"

type Child = ChildProcess

/**
 * Spawn helper for LSP server processes
 * Handles cross-platform spawning, especially Windows .cmd/.bat files
 */

// oxlint-disable-next-line typescript/no-redundant-type-constituents -- Process.Options from node:process
export function spawn(cmd: string, args: string[], opts?: Process.Options): Child
export function spawn(cmd: string, opts?: Process.Options): Child
// oxlint-disable-next-line typescript/no-redundant-type-constituents -- Process.Options from node:process
export function spawn(cmd: string, argsOrOpts?: string[] | Process.Options, opts?: Process.Options) {
  const args = Array.isArray(argsOrOpts) ? [...argsOrOpts] : []
  const cfg = Array.isArray(argsOrOpts) ? opts : argsOrOpts

  // On Windows, .cmd/.bat files with spaces in the path need explicit routing
  // through cmd.exe — Bun.spawn doesn't quote the path when delegating to
  // cmd.exe internally, so the space breaks the command line and stdio is null.
  const spawnCmd =
    process.platform === "win32" && /\.(cmd|bat)$/i.test(cmd) && cmd.includes(" ")
      ? [process.env.COMSPEC ?? "cmd.exe", "/c", cmd, ...args]
      : [cmd, ...args]

  const proc = Process.spawn(spawnCmd, {
    ...cfg,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })

  if (!proc.stdin || !proc.stdout || !proc.stderr) throw new Error("Process output not available")

  return proc
}

/**
 * Spawn with timeout and error handling
 */

export async function spawnWithTimeout(
  cmd: string,
  args: string[],
  timeoutMs: number,
  opts?: Process.Options
): Promise<Child> {
  const proc = spawn(cmd, args, opts)

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      proc.kill("SIGTERM")
      reject(new Error(`Spawn timeout after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  try {
    await Promise.race([
      new Promise<void>((resolve) => {
        proc.on("exit", () => resolve())
        proc.on("error", () => {
          if (!proc.killed) resolve() // Ignore errors if we killed it
        })
      }),
      timeoutPromise,
    ])
  } catch {
    if (!proc.killed) proc.kill("SIGKILL")
    throw new Error(`Spawn timeout after ${timeoutMs}ms`)
  }

  return proc
}

/**
 * Kill process tree (cross-platform)
 */

export async function killProcessTree(proc: Child): Promise<void> {
  if (proc.killed) return

  if (process.platform === "win32") {
    // On Windows, use taskkill to kill the process tree
    await Process.run(["taskkill", "/pid", String(proc.pid), "/t", "/f"], { nothrow: true })
  } else if (proc.pid !== undefined) {
    // On Unix, send SIGTERM to process group
    try {
      process.kill(-proc.pid, "SIGTERM")
    } catch {
      proc.kill("SIGTERM")
    }

    // Wait a bit, then SIGKILL if still alive
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (!proc.killed) {
      try {
        process.kill(-proc.pid, "SIGKILL")
      } catch {
        proc.kill("SIGKILL")
      }
    }
  }
}

/**
 * Service
 */

import { Context, Layer } from "effect"

export class LSPLaunchService extends Context.Tag("LSPLaunchService")<
  LSPLaunchService,
  {
    spawn: typeof spawn
    spawnWithTimeout: typeof spawnWithTimeout
    killProcessTree: typeof killProcessTree
  }
>() {}

export const LSPLaunchLive = Layer.succeed(LSPLaunchService, {
  spawn,
  spawnWithTimeout,
  killProcessTree,
})

export * as Launch from "./launch"