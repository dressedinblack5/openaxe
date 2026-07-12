import { describe, expect } from "bun:test"
import { Effect, FileSystem } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { ErrorJournal } from "@opencode-ai/core/error-journal"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const gw = testEffect(NodeFileSystem.layer)

function withTmpDir<A, E, R>(body: (dir: string) => Effect.Effect<A, E, R>) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(
    Effect.flatMap((tmp) => {
      const origCwd = process.cwd
      process.cwd = () => tmp.path
      return body(tmp.path).pipe(
        Effect.ensuring(Effect.sync(() => {
          process.cwd = origCwd
        })),
      )
    }),
  )
}

describe("ErrorJournal", () => {
  gw.live("creates .openaxe directory and writes error entry", () =>
    withTmpDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem

        yield* ErrorJournal.appendError({
          sessionID: "ses_test",
          toolName: "test-tool",
          input: { arg: "value" },
          error: "something went wrong",
        })

        const content = yield* fs.readFileString(`${dir}/.openaxe/errors.jsonl`)
        const entry = JSON.parse(content.trim())
        expect(entry.sessionID).toBe("ses_test")
        expect(entry.toolName).toBe("test-tool")
        expect(entry.error).toBe("something went wrong")
        expect(entry.time).toBeDefined()
        expect(typeof entry.time).toBe("string")
      }),
    ),
  )

  gw.live("appends to existing errors.jsonl", () =>
    withTmpDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem

        yield* ErrorJournal.appendError({
          sessionID: "ses_1",
          toolName: "tool-a",
          input: {},
          error: "first error",
        })

        yield* ErrorJournal.appendError({
          sessionID: "ses_2",
          toolName: "tool-b",
          input: { key: "val" },
          error: "second error",
        })

        const content = yield* fs.readFileString(`${dir}/.openaxe/errors.jsonl`)
        const lines = content.trim().split("\n")
        expect(lines).toHaveLength(2)
        expect(JSON.parse(lines[0]).sessionID).toBe("ses_1")
        expect(JSON.parse(lines[1]).sessionID).toBe("ses_2")
      }),
    ),
  )

  gw.live("handles empty error string", () =>
    withTmpDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem

        yield* ErrorJournal.appendError({
          sessionID: "ses_empty",
          toolName: "test-tool",
          input: null,
          error: "",
        })

        const content = yield* fs.readFileString(`${dir}/.openaxe/errors.jsonl`)
        const entry = JSON.parse(content.trim())
        expect(entry.sessionID).toBe("ses_empty")
        expect(entry.error).toBe("")
      }),
    ),
  )

  gw.live("returns void", () =>
    withTmpDir((_dir) =>
      Effect.gen(function* () {
        const result = yield* ErrorJournal.appendError({
          sessionID: "ses_void",
          toolName: "test-tool",
          input: {},
          error: "err",
        })
        expect(result).toBeUndefined()
      }),
    ),
  )
})
