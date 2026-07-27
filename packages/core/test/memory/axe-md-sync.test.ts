import { describe, expect } from "bun:test"
import { Effect, FileSystem, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { AxeSync } from "@opencode-ai/core/axe-sync"
import { Memory } from "@opencode-ai/core/memory"
import { testEffect } from "../lib/effect"
import { tmpdir } from "../fixture/tmpdir"

const it = testEffect(
  AxeSync.layer.pipe(
    Layer.provideMerge(Memory.defaultLayer),
    Layer.provideMerge(NodeFileSystem.layer),
  ),
)

function withTmpDir<A, E, R>(body: (dir: string) => Effect.Effect<A, E, R>) {
  return Effect.acquireRelease(
    Effect.promise( async () => tmpdir()),
    (tmp) => Effect.promise( async () => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => body(tmp.path)))
}

describe("AxeSync.load (enhanced AxeMdSync parser)", () => {
  it.effect("loads plain-text sections with scope=project source=axe-md", () =>
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

        const sync = yield* AxeSync.Service
        yield* sync.load(dir)

        const memory = yield* Memory.Service
        const entries = yield* memory.list()
        expect(entries).toHaveLength(2)
        const arch = entries.find((e) => e.key === "axe-md:architecture")
        expect(arch).toBeTruthy()
        expect(arch!.value).toBe("Use Effect for all services.")
        expect(arch!.kind).toBe("Architecture")
        expect(arch!.scope).toBe("project")
        expect(arch!.source).toBe("axe-md")
        const gen = entries.find((e) => e.key === "axe-md:general")
        expect(gen).toBeTruthy()
        expect(gen!.value).toBe("Be concise.")
        expect(gen!.kind).toBe("General")
        expect(gen!.scope).toBe("project")
        expect(gen!.source).toBe("axe-md")
      }),
    ),
  )

  it.effect("loads list-item format with kind/source/scope", () =>
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

        const sync = yield* AxeSync.Service
        yield* sync.load(dir)

        const memory = yield* Memory.Service
        const name = yield* memory.get("project-name")
        expect(name).toBe("openaxe")
        const lang = yield* memory.get("language")
        expect(lang).toBe("TypeScript")

        const entries = yield* memory.list()
        const nameEntry = entries.find((e) => e.key === "project-name")
        expect(nameEntry!.kind).toBe("general")
        expect(nameEntry!.scope).toBe("project")
        expect(nameEntry!.source).toBe("axe-md")
      }),
    ),
  )

  it.effect("loads mixed sections", () =>
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

        const sync = yield* AxeSync.Service
        yield* sync.load(dir)

        const memory = yield* Memory.Service
        const name = yield* memory.get("name")
        expect(name).toBe("openaxe")
        const note = yield* memory.get("axe-md:notes")
        expect(note).toBe("Some free-form note.")
      }),
    ),
  )
})
