export * as ErrorJournal from "./error-journal"

import path from "node:path"
import fs from "node:fs/promises"
import { Effect } from "effect"

export const appendError = Effect.fn("ErrorJournal.appendError")(function* (params: {
  sessionID: string
  toolName: string
  input: unknown
  error: string
}) {
  const dir = path.join(process.cwd(), ".openaxe")

  yield* Effect.promise(() => fs.mkdir(dir, { recursive: true })).pipe(Effect.ignoreCause)

  const entry =
    JSON.stringify({
      time: new Date().toISOString(),
      sessionID: params.sessionID,
      toolName: params.toolName,
      error: params.error,
    }) + "\n"

  yield* Effect.promise(() => fs.appendFile(path.join(dir, "errors.jsonl"), entry)).pipe(Effect.ignoreCause)
})
