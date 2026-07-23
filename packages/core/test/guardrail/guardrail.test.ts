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

  describe("verifyStructural", () => {
    gw.live("passes balanced file with brackets in strings", () =>
      withTmpDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const guardrail = yield* Guardrail.Service

          const filePath = `${dir}/strings.ts`
          yield* fs.writeFileString(
            filePath,
            [
              'const s = "hello { world }"',
              "const t = `template { with } brackets`",
              "const u = 'single { quotes } too'",
              "const v = { legit: 1 }",
            ].join("\n"),
          )

          const results = yield* guardrail.verifyStructural([filePath])
          expect(results).toHaveLength(1)
          expect(results[0].passed).toBe(true)
          expect(results[0].errors).toEqual([])
        }),
      ),
    )

    gw.live("ignores brackets in line comments", () =>
      withTmpDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const guardrail = yield* Guardrail.Service

          const filePath = `${dir}/comment.ts`
          yield* fs.writeFileString(
            filePath,
            [
              "const x = { a: 1 }",
              "// { unclosed bracket in line comment",
              "const y = 2",
            ].join("\n"),
          )

          const results = yield* guardrail.verifyStructural([filePath])
          expect(results).toHaveLength(1)
          expect(results[0].passed).toBe(true)
          expect(results[0].errors).toEqual([])
        }),
      ),
    )

    gw.live("ignores brackets in block comments", () =>
      withTmpDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const guardrail = yield* Guardrail.Service

          const filePath = `${dir}/block.ts`
          yield* fs.writeFileString(
            filePath,
            [
              "const x = { a: 1 }",
              "/* { unclosed bracket in block comment */",
              "const y = 2",
            ].join("\n"),
          )

          const results = yield* guardrail.verifyStructural([filePath])
          expect(results).toHaveLength(1)
          expect(results[0].passed).toBe(true)
          expect(results[0].errors).toEqual([])
        }),
      ),
    )

    gw.live("detects bracket errors outside comments", () =>
      withTmpDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const guardrail = yield* Guardrail.Service

          const filePath = `${dir}/mixed.ts`
          yield* fs.writeFileString(
            filePath,
            [
              "// { comment is fine",
              "const x = { a: 1;", // unclosed brace outside comment
              "/* } block comment is fine */",
            ].join("\n"),
          )

          const results = yield* guardrail.verifyStructural([filePath])
          expect(results).toHaveLength(1)
          expect(results[0].passed).toBe(false)
          expect(results[0].errors.some((e) => e.message.includes("unclosed brace"))).toBe(true)
        }),
      ),
    )

    gw.live("fails on unbalanced bracket outside strings", () =>
      withTmpDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const guardrail = yield* Guardrail.Service

          const filePath = `${dir}/unbalanced.ts`
          yield* fs.writeFileString(filePath, ["const x = { a: 1;", 'const s = "just a string {"'].join("\n"))

          const results = yield* guardrail.verifyStructural([filePath])
          expect(results).toHaveLength(1)
          expect(results[0].passed).toBe(false)
          expect(results[0].errors).toHaveLength(1)
          expect(results[0].errors[0].message).toBe("unclosed brace at end of file")
        }),
      ),
    )

    gw.live("flags non-existent relative import", () =>
      withTmpDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const guardrail = yield* Guardrail.Service

          const filePath = `${dir}/imports.ts`
          yield* fs.writeFileString(filePath, `import { x } from "./nonexistent"\n`)

          const results = yield* guardrail.verifyStructural([filePath])
          expect(results).toHaveLength(1)
          expect(results[0].passed).toBe(false)
          expect(results[0].errors.some((e) => e.message.includes('"./nonexistent"'))).toBe(true)
        }),
      ),
    )

    gw.live("passes on existing relative import", () =>
      withTmpDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const guardrail = yield* Guardrail.Service

          yield* fs.writeFileString(`${dir}/helper.ts`, "export const x = 1\n")

          const filePath = `${dir}/imports.ts`
          yield* fs.writeFileString(filePath, `import { x } from "./helper"\n`)

          const results = yield* guardrail.verifyStructural([filePath])
          expect(results).toHaveLength(1)
          expect(results[0].passed).toBe(true)
          expect(results[0].errors).toEqual([])
        }),
      ),
    )

    gw.live("passes on require with existing relative import", () =>
      withTmpDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const guardrail = yield* Guardrail.Service

          yield* fs.writeFileString(`${dir}/util.js`, "module.exports = {}\n")

          const filePath = `${dir}/importer.ts`
          yield* fs.writeFileString(filePath, `const u = require("./util")\n`)

          const results = yield* guardrail.verifyStructural([filePath])
          expect(results).toHaveLength(1)
          expect(results[0].passed).toBe(true)
          expect(results[0].errors).toEqual([])
        }),
      ),
    )

    gw.live("handles side-effect imports", () =>
      withTmpDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const guardrail = yield* Guardrail.Service

          yield* fs.writeFileString(`${dir}/side.ts`, "console.log('loaded')\n")

          const filePath = `${dir}/importer.ts`
          yield* fs.writeFileString(filePath, `import "./side"\n`)

          const results = yield* guardrail.verifyStructural([filePath])
          expect(results).toHaveLength(1)
          expect(results[0].passed).toBe(true)
          expect(results[0].errors).toEqual([])
        }),
      ),
    )

    gw.live("skips bare module imports", () =>
      withTmpDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const guardrail = yield* Guardrail.Service

          const filePath = `${dir}/bare.ts`
          yield* fs.writeFileString(filePath, 'import { Effect } from "effect"\nimport { z } from "zod"\n')

          const results = yield* guardrail.verifyStructural([filePath])
          expect(results).toHaveLength(1)
          expect(results[0].passed).toBe(true)
          expect(results[0].errors).toEqual([])
        }),
      ),
    )

    gw.live("reports line number with import error", () =>
      withTmpDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const guardrail = yield* Guardrail.Service

          const filePath = `${dir}/lined.ts`
          yield* fs.writeFileString(
            filePath,
            [
              "const a = 1",
              'import { b } from "./missing"',
              "const c = 2",
            ].join("\n"),
          )

          const results = yield* guardrail.verifyStructural([filePath])
          expect(results).toHaveLength(1)
          const importErr = results[0].errors.find((e) => e.message.includes("./missing"))
          expect(importErr).toBeDefined()
          expect(importErr!.line).toBe(2)
        }),
      ),
    )

    gw.live("handles multiple files with mixed results", () =>
      withTmpDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const guardrail = yield* Guardrail.Service

          yield* fs.writeFileString(`${dir}/exists.ts`, "export const y = 2\n")

          const good = `${dir}/good.ts`
          yield* fs.writeFileString(good, ['import { y } from "./exists"\nconst x = { a: 1 }'].join("\n"))

          const bad = `${dir}/bad.ts`
          yield* fs.writeFileString(bad, ['import { z } from "./nope"\nconst x = { a: 1'].join("\n"))

          const results = yield* guardrail.verifyStructural([good, bad])
          expect(results).toHaveLength(2)
          expect(results[0].passed).toBe(true)
          expect(results[1].passed).toBe(false)
        }),
      ),
    )
  })
})
