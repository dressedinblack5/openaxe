import path from "node:path"
import { mkdirSync, existsSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { Option, Effect } from "effect"
import { extractTgz } from "@opencode-ai/core/util/archive"
import { Global } from "@opencode-ai/core/global"
import { run } from "@/util/process"

const CODEGRAPH_VERSION = "1.0.1"

function pkgSuffix() {
  return `${process.platform}-${process.arch}`
}

function bundleCommand(bundleRoot: string): string[] | undefined {
  const nodeBin = process.platform === "win32" ? path.join(bundleRoot, "node.exe") : path.join(bundleRoot, "node")
  const entry = path.join(bundleRoot, "lib", "dist", "bin", "codegraph.js")
  if (!existsSync(nodeBin) || !existsSync(entry)) return undefined
  // Mirror the platform shim: run the bundled node against the bundled entry.
  return [nodeBin, "--liftoff-only", entry]
}

function cacheRoot() {
  return path.join(Global.Path.bin, "codegraph", pkgSuffix())
}

/**
 * Resolve the codegraph runtime command synchronously. Priority:
 * 1. env OMO_CODEGRAPH_BIN / CODEGRAPH_BIN (explicit override)
 * 2. previously downloaded cache (Global.Path.bin/codegraph/<platform>-<arch>)
 * 3. node_modules bundle via createRequire (dev/source mode)
 */
export function resolveCodegraphCommandSync(): string[] | undefined {
  const envBin = process.env.OMO_CODEGRAPH_BIN ?? process.env.CODEGRAPH_BIN
  if (envBin && existsSync(envBin)) return [envBin]

  const cached = bundleCommand(cacheRoot())
  if (cached) return cached

  const tryResolve = Option.liftThrowable(() =>
    createRequire(import.meta.url).resolve(`@colbymchenry/codegraph-${pkgSuffix()}/package.json`),
  )
  const pkgJson = tryResolve()
  if (Option.isSome(pkgJson)) {
    const fromNodeModules = bundleCommand(path.dirname(pkgJson.value))
    if (fromNodeModules) return fromNodeModules
  }
  return undefined
}

const downloadRuntime = Effect.fn("Codegraph.downloadRuntime")(function* () {
  const suffix = pkgSuffix()
  const root = cacheRoot()
  mkdirSync(root, { recursive: true })

  const url = `https://registry.npmjs.org/@colbymchenry/codegraph-${suffix}/-/codegraph-${suffix}-${CODEGRAPH_VERSION}.tgz`
  const response = yield* Effect.tryPromise(() => fetch(url))
  if (!response.ok) {
    yield* Effect.fail(new Error(`Failed to download codegraph runtime: HTTP ${response.status}`))
  }
  const bytes = yield* Effect.tryPromise(() => response.arrayBuffer())
  const tmpTgz = path.join(root, `codegraph-${suffix}.tgz`)
  writeFileSync(tmpTgz, Buffer.from(bytes))

  // npm tarballs nest under package/; --strip-components=1 flattens them.
  const result = yield* Effect.tryPromise(() =>
    run(["tar", "-xzf", tmpTgz, "--strip-components=1", "-C", root], { nothrow: true }),
  )
  if (result.code !== 0) {
    // ponytail: Wine ships no tar.exe and a stub powershell — pure-JS
    // extraction is the last-resort fallback.
    yield* Effect.try({
      try: () => extractTgz(tmpTgz, root, 1),
      catch: (cause) => new Error(`Failed to extract codegraph runtime: ${String(cause)}`),
    }).pipe(Effect.orDie)
  }
  rmSync(tmpTgz, { force: true })

  const command = bundleCommand(root)
  if (!command) {
    yield* Effect.fail(new Error("CodeGraph runtime downloaded but bundle structure was unexpected"))
  }
  return command
})

/** Resolve the codegraph runtime, downloading the self-contained bundle on first use. */
export const ensureCodegraphRuntime = Effect.fn("Codegraph.ensureRuntime")(function* () {
  const existing = resolveCodegraphCommandSync()
  if (existing) return existing
  return yield* downloadRuntime()
})

export * as Codegraph from "./codegraph"
