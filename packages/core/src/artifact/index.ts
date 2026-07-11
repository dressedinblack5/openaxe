import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { FileSystem } from "effect"
import type { PlatformError } from "effect/PlatformError"

export const DEFAULT_TRUNCATION_THRESHOLD = 10 * 1024

export class StorageError extends Schema.TaggedErrorClass<StorageError>()("Artifact.StorageError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message() {
    const detail = this.cause instanceof Error ? this.cause.message : String(this.cause)
    return `Failed to ${this.operation} artifact${detail ? `: ${detail}` : ""}`
  }
}

export interface ArtifactEntry {
  readonly key: string
  readonly version: number
  readonly content: string
  readonly size: number
  readonly truncated: boolean
  readonly timeCreated: number
  readonly overflowPath?: string
}

export interface ArtifactSummary {
  readonly key: string
  readonly version: number
  readonly size: number
  readonly truncated: boolean
  readonly timeCreated: number
  readonly overflowPath?: string
}

export interface Interface {
  readonly store: (key: string, content: string) => Effect.Effect<ArtifactEntry, StorageError>
  readonly get: (key: string, version?: number) => Effect.Effect<ArtifactEntry | null>
  readonly list: (keyPrefix?: string) => Effect.Effect<Array<ArtifactSummary>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Artifact") {}

// Private helpers

interface Meta {
  key: string
  version: number
  size: number
  truncated: boolean
  time_created: number
  overflow_path?: string
}

function metaFile(baseDir: string, key: string, version: number): string {
  return path.join(baseDir, key, `${version}.json`)
}

function contentFile(baseDir: string, key: string, version: number): string {
  return path.join(baseDir, key, `${version}.content`)
}

function overflowFile(baseDir: string, key: string, version: number): string {
  return path.join(baseDir, key, `${version}.overflow`)
}

function takePrefix(input: string, maximumBytes: number): string {
  let bytes = 0
  let content = ""
  for (const char of input) {
    const size = Buffer.byteLength(char, "utf-8")
    if (bytes + size > maximumBytes) break
    content += char
    bytes += size
  }
  return content
}

function catchFs<A>(effect: Effect.Effect<A, PlatformError>, fallback: A): Effect.Effect<A> {
  return effect.pipe(Effect.catch(() => Effect.succeed(fallback)))
}

export const layer = (baseDir: string, threshold: number = DEFAULT_TRUNCATION_THRESHOLD) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem

      const nextVersion = Effect.fn("Artifact.nextVersion")(function* (key: string) {
        const dir = path.join(baseDir, key)
        const exists = yield* catchFs(fs.exists(dir), false)
        if (!exists) return 1
        const entries = yield* catchFs(fs.readDirectory(dir), [])
        const versions = entries
          .filter((e) => e.endsWith(".json"))
          .map((e) => parseInt(e.replace(".json", ""), 10))
          .filter((n) => !isNaN(n))
        return versions.length > 0 ? Math.max(...versions) + 1 : 1
      })

      const store = Effect.fn("Artifact.store")(function* (key: string, content: string) {
        const version = yield* nextVersion(key).pipe(
          Effect.mapError((cause) => new StorageError({ operation: "read", cause })),
        )
        const dir = path.join(baseDir, key)
        yield* fs.makeDirectory(dir, { recursive: true }).pipe(
          Effect.mapError((cause) => new StorageError({ operation: "store", cause })),
        )

        const size = Buffer.byteLength(content, "utf-8")
        const truncated = size > threshold
        const timeCreated = Date.now()

        let storedContent: string
        let ovPath: string | undefined

        if (truncated) {
          storedContent = takePrefix(content, threshold)
          ovPath = `${version}.overflow`

          yield* fs.writeFileString(contentFile(baseDir, key, version), storedContent).pipe(
            Effect.mapError((cause) => new StorageError({ operation: "store", cause })),
          )
          const remaining = content.slice(storedContent.length)
          yield* fs.writeFileString(overflowFile(baseDir, key, version), remaining).pipe(
            Effect.mapError((cause) => new StorageError({ operation: "store", cause })),
          )
        } else {
          storedContent = content
          yield* fs.writeFileString(contentFile(baseDir, key, version), content).pipe(
            Effect.mapError((cause) => new StorageError({ operation: "store", cause })),
          )
        }

        const meta: Meta = {
          key,
          version,
          size,
          truncated,
          time_created: timeCreated,
          ...(ovPath ? { overflow_path: ovPath } : {}),
        }
        yield* fs.writeFileString(metaFile(baseDir, key, version), JSON.stringify(meta)).pipe(
          Effect.mapError((cause) => new StorageError({ operation: "store", cause })),
        )

        return {
          key,
          version,
          content: storedContent,
          size,
          truncated,
          timeCreated,
          overflowPath: ovPath,
        }
      })

      const get = Effect.fn("Artifact.get")(function* (key: string, version?: number) {
        const dir = path.join(baseDir, key)
        const dirExists = yield* catchFs(fs.exists(dir), false)
        if (!dirExists) return null

        if (version === undefined) {
          const entries = yield* catchFs(fs.readDirectory(dir), [])
          const versions = entries
            .filter((e) => e.endsWith(".json"))
            .map((e) => parseInt(e.replace(".json", ""), 10))
            .filter((n) => !isNaN(n))
          if (versions.length === 0) return null
          version = Math.max(...versions)
        }

        const metaStr = yield* catchFs(fs.readFileString(metaFile(baseDir, key, version)), undefined)
        if (metaStr === undefined) return null
        const meta: Meta = JSON.parse(metaStr)

        const content = yield* catchFs(fs.readFileString(contentFile(baseDir, key, version)), undefined)
        if (content === undefined) return null

        let fullContent = content
        if (meta.truncated && meta.overflow_path) {
          const over = yield* catchFs(fs.readFileString(overflowFile(baseDir, key, version)), undefined)
          if (over !== undefined) fullContent += over
        }

        return {
          key: meta.key,
          version: meta.version,
          content: fullContent,
          size: meta.size,
          truncated: meta.truncated,
          timeCreated: meta.time_created,
          overflowPath: meta.overflow_path,
        }
      })

      const list = Effect.fn("Artifact.list")(function* (keyPrefix?: string) {
        const baseExists = yield* catchFs(fs.exists(baseDir), false)
        if (!baseExists) return []

        const keys = yield* catchFs(fs.readDirectory(baseDir), [])
        const filtered = keyPrefix
          ? keys.filter((k) => k.startsWith(keyPrefix))
          : keys

        const summaries: ArtifactSummary[] = []
        for (const entry of filtered) {
          const entryDir = path.join(baseDir, entry)
          const stat = yield* catchFs(fs.stat(entryDir), undefined)
          if (!stat || stat.type !== "Directory") continue

          const versionEntries = yield* catchFs(fs.readDirectory(entryDir), [])
          const versions = versionEntries
            .filter((e) => e.endsWith(".json"))
            .map((e) => parseInt(e.replace(".json", ""), 10))
            .filter((n) => !isNaN(n))

          for (const ver of versions) {
            const raw = yield* catchFs(fs.readFileString(metaFile(baseDir, entry, ver)), undefined)
            if (raw === undefined) continue
            const m: Meta = JSON.parse(raw)
            summaries.push({
              key: m.key,
              version: m.version,
              size: m.size,
              truncated: m.truncated,
              timeCreated: m.time_created,
              overflowPath: m.overflow_path,
            })
          }
        }

        return summaries.sort((a, b) => a.timeCreated - b.timeCreated)
      })

      return Service.of({ store, get, list })
    }),
  )

export const defaultLayer = layer(".openaxe/artifacts")

export * as Artifact from "."
