import path from "path"
import { statSync } from "fs"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { Flock } from "@opencode-ai/core/util/flock"
import { Filesystem } from "@/util/filesystem"

// Disk-memoized manifest for the V1 external-tool discovery scan in
// registry.ts. Hermes-parity for its `tools/registry.py` per-file
// mtime_ns+size cache: each scanned config directory is keyed by its own
// stat, and every file under it by `{ mtimeNs, size, exports }`. A warm run
// stats each previously-seen file and skips the glob (and the imports of
// files that do not register tools) entirely when nothing changed.

const CACHE_FILE = "tool-discovery-cache.json"
const CACHE_VERSION = 1
const LOCK_TIMEOUT_MS = 5_000

export type FileSignature = {
  // Exact nanosecond mtime. Stored as a string because JSON numbers are
  // doubles and cannot represent ns timestamps without losing precision.
  mtimeNs: string
  size: number
}

export type FileCacheEntry = FileSignature & {
  // Module export keys (e.g. "default") that registered plugin tools.
  exports: string[]
  // Epoch-ms of the last failed import. Retries are suppressed for
  // FAILURE_GRACE_MS so a transient failure is surfaced once instead of on
  // every warm run (Hermes uses the same 60s grace window). Absent when the
  // file imports cleanly.
  failedAt?: number
}

export type DirCache = {
  // Per-subdirectory stat of the `tool`/`tools` scan targets — detects
  // added/removed/renamed files so a fully-covered directory can skip the
  // glob. `undefined` means the subdirectory does not exist.
  subdirs: Record<string, FileSignature | undefined>
  files: Record<string, FileCacheEntry>
}

export type CacheStore = {
  version: number
  dirs: Record<string, DirCache>
}

export const FAILURE_GRACE_MS = 60_000

// The glob in registry.ts scans these subdirectories of each config dir.
export const SCAN_SUBDIRS = ["tool", "tools"] as const

function cachePath() {
  return path.join(Global.Path.state, CACHE_FILE)
}

function lock(file: string) {
  return `tool-discovery:${file}`
}

export function emptyStore(): CacheStore {
  return { version: CACHE_VERSION, dirs: {} }
}

// Sync stat of a path (file or directory), keyed by mtime+size.
export function statPath(p: string): FileSignature | undefined {
  const stat = statSync(p, { bigint: true, throwIfNoEntry: false })
  if (!stat) return undefined
  return { mtimeNs: stat.mtimeNs.toString(), size: Number(stat.size) }
}

export function sameSignature(a: FileSignature, b: FileSignature) {
  return a.mtimeNs === b.mtimeNs && a.size === b.size
}

export function sameSubdirs(
  a: Record<string, FileSignature | undefined>,
  b: Record<string, FileSignature | undefined>,
) {
  // JSON round-tripping drops `undefined`-valued keys, so a missing key and
  // an explicitly-`undefined` value must compare equal.
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const left = a[key]
    const right = b[key]
    if (left === undefined) {
      if (right !== undefined) return false
    } else if (right === undefined || !sameSignature(left, right)) {
      return false
    }
  }
  return true
}

// Structural validation so a corrupt/foreign cache file falls back to a cold
// scan instead of being trusted.
export function isValidStore(value: unknown): value is CacheStore {
  if (typeof value !== "object" || value === null) return false
  const store = value as Record<string, unknown>
  if (store.version !== CACHE_VERSION) return false
  if (typeof store.dirs !== "object" || store.dirs === null) return false
  return Object.values(store.dirs).every(isValidDir)
}

function isValidDir(value: unknown): value is DirCache {
  if (typeof value !== "object" || value === null) return false
  const dir = value as Record<string, unknown>
  if (typeof dir.subdirs !== "object" || dir.subdirs === null) return false
  if (!Object.values(dir.subdirs).every((sig) => sig === undefined || isValidFileSignature(sig))) return false
  if (typeof dir.files !== "object" || dir.files === null) return false
  return Object.values(dir.files).every(isValidFile)
}

function isValidFileSignature(value: unknown): value is FileSignature {
  if (typeof value !== "object" || value === null) return false
  const sig = value as Record<string, unknown>
  return (typeof sig.mtimeNs === "string" || typeof sig.mtimeNs === "number") && typeof sig.size === "number"
}

function isValidFile(value: unknown): value is FileCacheEntry {
  if (!isValidFileSignature(value)) return false
  return Array.isArray((value as Record<string, unknown>).exports)
}

// Read the manifest, tolerating a missing/corrupt file (cold scan + overwrite).
export const load = Effect.fn("DiscoveryCache.load")(function* () {
  const file = cachePath()
  const store = yield* Effect.match(
    Effect.tryPromise(() => Filesystem.readJson<unknown>(file)),
    {
      onFailure: () => undefined,
      onSuccess: (value) => value,
    },
  )
  return isValidStore(store) ? store : emptyStore()
})

// Persist the given per-directory entries, merging under a cross-process lock
// so concurrent writers do not clobber each other. Best-effort: a lock or
// write failure must never break registry initialization.
export const save = Effect.fn("DiscoveryCache.save")(function* (updates: Record<string, DirCache>) {
  const file = cachePath()
  yield* Effect.match(
    Effect.tryPromise(() =>
      Flock.withLock(
        lock(file),
        async () => {
          const store = await readStore(file)
          for (const [dir, entry] of Object.entries(updates)) {
            store.dirs[dir] = entry
          }
          await Filesystem.writeJson(file, store)
        },
        { timeoutMs: LOCK_TIMEOUT_MS },
      ),
    ),
    {
      onFailure: () => undefined,
      onSuccess: () => undefined,
    },
  )
})

async function readStore(file: string): Promise<CacheStore> {
  const raw = await Filesystem.readJson<unknown>(file).catch(() => undefined)
  return isValidStore(raw) ? raw : emptyStore()
}

export * as DiscoveryCache from "./discovery-cache"
