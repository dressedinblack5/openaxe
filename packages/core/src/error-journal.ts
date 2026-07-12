export * as ErrorJournal from "./error-journal"

import path from "node:path"
import { Effect, FileSystem } from "effect"

export const appendError = Effect.fn("ErrorJournal.appendError")(function* (params: {
  sessionID: string
  toolName: string
  input: unknown
  error: string
}) {
  const dir = path.join(process.cwd(), ".openaxe")
  const fs = yield* FileSystem.FileSystem

  yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.ignoreCause)

  const entry =
    JSON.stringify({
      time: new Date().toISOString(),
      sessionID: params.sessionID,
      toolName: params.toolName,
      error: params.error,
    }) + "\n"

  const filePath = path.join(dir, "errors.jsonl")
  const existing = yield* fs.readFileString(filePath).pipe(
    Effect.catch(() => Effect.succeed("")),
  )
  yield* fs.writeFileString(filePath, existing + entry).pipe(Effect.ignoreCause)
})
