export * as AxeMdSync from "./sync"

import { Context, Effect, FileSystem, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { Memory } from "./index"

export interface AxeMdRule {
  readonly key: string
  readonly content: string
}

export interface Interface {
  readonly readAxeMd: (projectRoot: string) => Effect.Effect<readonly AxeMdRule[]>
  readonly syncToMemory: (rules: readonly AxeMdRule[]) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AxeMdSync") {}

function parseAxeMd(content: string): readonly AxeMdRule[] {
  const rules: AxeMdRule[] = []
  const lines = content.split("\n")
  let currentHeading: string | undefined
  let currentContent: string[] = []

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/)
    if (headingMatch) {
      if (currentHeading) {
        const key = currentHeading
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
        rules.push({ key: `axe-md:${key}`, content: currentContent.join("\n").trim() })
      }
      currentHeading = headingMatch[1].trim()
      currentContent = []
    } else if (currentHeading) {
      currentContent.push(line)
    }
  }

  if (currentHeading) {
    const key = currentHeading
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
    rules.push({ key: `axe-md:${key}`, content: currentContent.join("\n").trim() })
  }

  return rules
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const memory = yield* Memory.Service
    const fs = yield* FileSystem.FileSystem

    const readAxeMd = Effect.fn("AxeMdSync.readAxeMd")(function* (projectRoot: string) {
      const filePath = `${projectRoot}/AXE.md`
      const exists = yield* fs.exists(filePath).pipe(Effect.orDie)
      if (!exists) return []
      const content = yield* fs.readFileString(filePath).pipe(Effect.orDie)
      return parseAxeMd(content)
    })

    const syncToMemory = Effect.fn("AxeMdSync.syncToMemory")(function* (rules: readonly AxeMdRule[]) {
      for (const rule of rules) {
        yield* memory.set(rule.key, rule.content, "project", "axe-md")
      }
    })

    return Service.of({ readAxeMd, syncToMemory })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(Memory.defaultLayer),
)
