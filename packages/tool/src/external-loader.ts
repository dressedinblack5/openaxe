import { Effect, Layer, Context } from "effect"
import { Glob } from "@opencode-ai/core/util/glob"
import { DiscoveryCache } from "./discovery-cache"
import type { ExternalToolLoader, ExternalToolDefinition } from "./types"
import path from "path"
import { pathToFileURL } from "url"

/**
 * ExternalToolLoader Service - Separate service for external tool discovery
 */
export class ExternalToolLoaderService extends Context.Service<ExternalToolLoaderService, ExternalToolLoader>()(
  "@openaxe/ExternalToolLoader",
) {}

interface ToolModule {
  default?: ExternalToolDefinition
  [key: string]: ExternalToolDefinition | undefined
}

function isExternalToolDefinition(value: unknown): value is ExternalToolDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "description" in value &&
    "parameters" in value &&
    "execute" in value
  )
}

export const ExternalToolLoaderLive = Layer.effect(
  ExternalToolLoaderService,
  Effect.gen(function* () {
    const cacheStore = yield* DiscoveryCache.load()

    const load = (directories: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<ExternalToolDefinition>, unknown> =>
      Effect.gen(function* () {
        const allTools: ExternalToolDefinition[] = []

        for (const dir of directories) {
          const prev = cacheStore.dirs[dir]
          // oxlint-disable-next-line typescript/no-redundant-type-constituents -- FileSignature from DiscoveryCache
          const subdirs: Record<string, DiscoveryCache.FileSignature | undefined> = {}
          for (const sub of DiscoveryCache.SCAN_SUBDIRS) {
            subdirs[sub] = DiscoveryCache.statPath(path.join(dir, sub))
          }
          const covered = prev && DiscoveryCache.sameSubdirs(prev.subdirs, subdirs)

          let files: string[]
          if (covered && prev) {
            files = Object.keys(prev.files)
          } else {
            try {
              files = Glob.scanSync("{tool,tools}/*.{js,ts}", {
                cwd: dir,
                absolute: true,
                dot: true,
                symlink: true,
              })
            } catch {
              files = []
            }
          }

          const updated: Record<string, DiscoveryCache.FileCacheEntry> = prev ? { ...prev.files } : {}
          let dirty = !covered

          for (const file of files) {
            const sig = DiscoveryCache.statPath(file)
            if (!sig) {
              if (updated[file]) {
                delete updated[file]
                dirty = true
              }
              continue
            }

            const cached = updated[file]
            if (cached && DiscoveryCache.sameSignature(cached, sig)) {
              if (!cached.exports.length && cached.failedAt === undefined) continue
              if (cached.failedAt !== undefined && Date.now() - cached.failedAt < DiscoveryCache.FAILURE_GRACE_MS)
                continue
              continue
            }

            const mod = yield* importTool(file)
            if (!mod) {
              updated[file] = { ...sig, exports: cached?.exports ?? [], failedAt: Date.now() }
              dirty = true
              continue
            }

            const exports = collectToolExports(mod)
            updated[file] = { ...sig, exports }
            dirty = true

            for (const [, tool] of Object.entries(mod)) {
              if (isExternalToolDefinition(tool)) {
                allTools.push(tool)
              }
            }
          }

          if (dirty && (prev || Object.keys(updated).length > 0)) {
            yield* DiscoveryCache.save({ [dir]: { subdirs, files: updated } })
          }
        }

        return allTools
      })

    const watch = (directories: ReadonlyArray<string>): Effect.Effect<void, unknown> =>
      Effect.gen(function* () {
        // For now, just re-load on watch trigger
        // In a full implementation, this would use a file watcher
        yield* load(directories)
      })

    return { load, watch }
  }),
)

function importTool(file: string): Effect.Effect<ToolModule | undefined> {
  return Effect.match(
    Effect.tryPromise(() => import(pathToFileURL(file).href)),
    {
      onFailure: (error) => {
        console.error(`[external-tool-loader] failed to import ${file}:`, error)
        return undefined
      },
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic import returns unknown
      onSuccess: (mod) => mod as ToolModule,
    },
  )
}

function collectToolExports(mod: ToolModule): string[] {
  return Object.entries(mod)
    .filter(([, def]) => isExternalToolDefinition(def))
    .map(([id]) => id)
}

export * as ExternalToolLoader from "./external-loader"
