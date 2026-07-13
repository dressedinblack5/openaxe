export * as Revert from "./revert"

import { Effect, FileSystem } from "effect"
import type { PlatformError } from "effect/PlatformError"

export interface SnapshotEntry {
  readonly path: string
  readonly content: string | null
  readonly timestamp: number
  readonly sequence: number
}

const MAX_ENTRIES = 100
const buffers = new Map<string, SnapshotEntry[]>()
let nextSequence = 0

function getBuffer(): SnapshotEntry[] {
  const key = process.cwd()
  let buffer = buffers.get(key)
  if (!buffer) {
    buffer = []
    buffers.set(key, buffer)
  }
  return buffer
}

/**
 * Record a snapshot of a file's current content so it can be reverted later.
 * If the file does not exist, content is stored as null (new file → delete on revert).
 */
export function recordRevertSnapshot(fs: FileSystem.FileSystem, path: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    const content: string | null = yield* fs.readFileString(path).pipe(
      Effect.catchTag("PlatformError", () => Effect.succeed(null)),
    )
    const buffer = getBuffer()
    const entry: SnapshotEntry = {
      path,
      content,
      timestamp: Date.now(),
      sequence: nextSequence++,
    }
    buffer.push(entry)
    if (buffer.length > MAX_ENTRIES) {
      buffer.shift()
    }
  })
}

/**
 * Revert the last `count` file mutations for the current process directory.
 * Returns the number of files successfully reverted.
 */
export function revert(count: number): Effect.Effect<number, PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const buffer = getBuffer()
    const toRevert = buffer.splice(-count, count)
    let reverted = 0
    for (const entry of toRevert) {
      if (entry.content === null) {
        yield* fs.remove(entry.path).pipe(
          Effect.catchReason("PlatformError", "NotFound", () => Effect.void),
        )
        reverted++
      } else {
        yield* fs.writeFileString(entry.path, entry.content).pipe(
          Effect.catchReason("PlatformError", "NotFound", () => Effect.void),
        )
        reverted++
      }
    }
    return reverted
  })
}
