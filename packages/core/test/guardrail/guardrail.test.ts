import { describe, expect } from "bun:test"
import { Effect, FileSystem, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { Guardrail } from "@opencode-ai/core/guardrail"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const gw = testEffect(
  Guardrail.layer.pipe(Layer.provideMerge(NodeFileSystem.layer)),
)

function withTmpDir<A, E, R>(body: (dir: string) => Effect.Effect<A, E, R>) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => body(tmp.path)))
}

describe("Guardrail", () => {
  gw.live("passes a balanced file", () =>
    withTmpDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const guardrail = yield* Guardrail.Service

        const filePath = `${dir}/balanced.ts`
        yield* fs.writeFileString(filePath, "const x = { a: [1, 2, 3] };")

        const results = yield* guardrail.verify([filePath])
        expect(results).toHaveLength(1)
        expect(results[0].passed).toBe(true)
        expect(results[0].file).toBe(filePath)
        expect(results[0].errors).toEqual([])
      }),
    ),
  )

  gw.live("fails on unclosed brace", () =>
    withTmpDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const guardrail = yield* Guardrail.Service

        const filePath = `${dir}/unclosed.ts`
        yield* fs.writeFileString(filePath, "const x = { a: 1;")

        const results = yield* guardrail.verify([filePath])
        expect(results).toHaveLength(1)
        expect(results[0].passed).toBe(false)
        expect(results[0].errors).toEqual([
          { message: "unclosed brace at end of file" },
        ])
      }),
    ),
  )

  gw.live("fails on unexpected closing bracket", () =>
    withTmpDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const guardrail = yield* Guardrail.Service

        const filePath = `${dir}/unexpected.ts`
        yield* fs.writeFileString(filePath, "const x = ];")

        const results = yield* guardrail.verify([filePath])
        expect(results).toHaveLength(1)
        expect(results[0].passed).toBe(false)
        expect(results[0].errors).toEqual([
          { message: "unexpected closing bracket", line: 1 },
        ])
      }),
    ),
  )

  gw.live("handles multiple files", () =>
    withTmpDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const guardrail = yield* Guardrail.Service

        const goodFile = `${dir}/good.ts`
        const badFile = `${dir}/bad.ts`
        yield* fs.writeFileString(goodFile, "const ok = { x: 1 };")
        yield* fs.writeFileString(badFile, "const bad = { x: 1;")

        const results = yield* guardrail.verify([goodFile, badFile])
        expect(results).toHaveLength(2)
        expect(results[0].passed).toBe(true)
        expect(results[1].passed).toBe(false)
      }),
    ),
  )

  gw.live("does not crash on missing file", () =>
    withTmpDir((dir) =>
      Effect.gen(function* () {
        const guardrail = yield* Guardrail.Service
        const results = yield* guardrail.verify([`${dir}/nonexistent.ts`])
        expect(results).toHaveLength(1)
        expect(results[0].passed).toBe(true)
        expect(results[0].errors).toEqual([])
      }),
    ),
  )
})
