export * as AutoCommit from "./auto-commit"

import { spawn } from "node:child_process"
import { Effect } from "effect"

type BufferEntry = {
  readonly cwd: string
  readonly paths: Set<string>
}

const buffer = new Map<string, BufferEntry>()

export function recordMutation(
  sessionID: string,
  filePaths: readonly string[],
  projectRoot: string,
): void {
  if (filePaths.length === 0) return
  let entry = buffer.get(sessionID)
  if (!entry) {
    entry = { cwd: projectRoot, paths: new Set() }
    buffer.set(sessionID, entry)
  }
  for (const p of filePaths) entry.paths.add(p)
}

function runGit(cwd: string, args: string[]): Effect.Effect<void> {
  return Effect.callback<void>((resume) => {
    const child = spawn("git", args, { cwd, stdio: "ignore" })
    child.on("close", () => resume(Effect.succeed(void 0)))
    child.on("error", () => resume(Effect.succeed(void 0)))
  })
}

export const commitTurn = Effect.fn("AutoCommit.commitTurn")(function* (sessionID: string) {
  const entry = buffer.get(sessionID)
  if (!entry || entry.paths.size === 0) return
  buffer.delete(sessionID)

  const cwd = entry.cwd
  const files = Array.from(entry.paths)
  const summary =
    files.length <= 5
      ? files.join(", ")
      : `${files.slice(0, 5).join(", ")} +${files.length - 5} more`

  // If git fails (not a repo, nothing to commit, etc.) — silently skip
  yield* runGit(cwd, ["add", "-A"])
  yield* runGit(cwd, ["commit", "-m", `ai: ${summary}`])
})
