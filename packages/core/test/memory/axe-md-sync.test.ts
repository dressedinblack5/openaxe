import { describe, expect } from "bun:test"
import { Effect, FileSystem, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { AxeMdSync } from "@opencode-ai/core/memory/sync"
import { Memory } from "@opencode-ai/core/memory"
import { testEffect } from "../lib/effect"
import { tmpdir } from "../fixture/tmpdir"

const it = testEffect(
  AxeMdSync.layer.pipe(
    Layer.provideMerge(NodeFileSystem.layer),
    Layer.provideMerge(Memory.defaultLayer),
  ),
)

function withTmpDir<A, E, R>(body: (dir: string) => Effect.Effect<A, E, R>) {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => body(tmp.path)))
}

describe("AxeMdSync", () => {
  it.effect("reads plain-text sections (backward compat)", () =>
    withTmpDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(
          `${dir}/AXE.md`,
          [
            "# AXE - Project Memory",
            "",
            "## Architecture",
            "",
            "Use Effect for all services.",
            "",
            "## General",
            "",
            "Be concise.",
            "",
          ].join("\n"),
        )

        const svc = yield* AxeMdSync.Service
        const rules = yield* svc.readAxeMd(dir)
        expect(rules).toHaveLength(2)
        expect(rules[0]).toEqual({ key: "axe-md:architecture", content: "Use Effect for all services." })
        expect(rules[1]).toEqual({ key: "axe-md:general", content: "Be concise." })
      }),
    ),
  )

  it.effect("reads list-item format (AxeSync compat)", () =>
    withTmpDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(
          `${dir}/AXE.md`,
          [
            "# AXE - Project Memory",
            "",
            "## general",
            "",
            "- **project-name**: openaxe",
            "- **language**: TypeScript",
            "",
          ].join("\n"),
        )

        const svc = yield* AxeMdSync.Service
        const rules = yield* svc.readAxeMd(dir)
        expect(rules).toHaveLength(2)
        expect(rules[0]).toEqual({ key: "project-name", content: "openaxe" })
        expect(rules[1]).toEqual({ key: "language", content: "TypeScript" })
      }),
    ),
  )

  it.effect("reads mixed sections (list-item + plain-text)", () =>
    withTmpDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(
          `${dir}/AXE.md`,
          [
            "# AXE - Project Memory",
            "",
            "## project",
            "",
            "- **name**: openaxe",
            "",
            "## Notes",
            "",
            "Some free-form note.",
            "",
          ].join("\n"),
        )

        const svc = yield* AxeMdSync.Service
        const rules = yield* svc.readAxeMd(dir)
        expect(rules).toHaveLength(2)
        expect(rules.find((r) => r.key === "name")).toEqual({ key: "name", content: "openaxe" })
        expect(rules.find((r) => r.key === "axe-md:notes")).toEqual({
          key: "axe-md:notes",
          content: "Some free-form note.",
        })
      }),
    ),
  )
})
