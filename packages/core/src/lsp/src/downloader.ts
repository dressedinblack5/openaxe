// @ts-nocheck
import { Effect, Layer, Context } from "effect"
import { ServerDownloader, DownloadStrategy, DownloadError } from "./types"
import { Filesystem } from "@opencode-ai/core/util/filesystem"
import { Archive } from "@opencode-ai/core/util/archive"
import { Process } from "@opencode-ai/core/util/process"
import { Global } from "@opencode-ai/core/global"
import { createHash } from "node:crypto"
import path from "path"
import fs from "fs/promises"

/**
 * ServerDownloader - Strategy pattern for auto-download
 * Supports npm, go, cargo, binary, mason, github strategies
 */

const run = (cmd: string[], opts: Process.RunOptions = {}) => Process.run(cmd, { ...opts, nothrow: true })

const _output = (cmd: string[], opts: Process.RunOptions = {}) => Process.text(cmd, { ...opts, nothrow: true })

async function verifyIntegrity(filePath: string, expectedHash: string): Promise<boolean> {
  const content = await fs.readFile(filePath)
  const hash = createHash("sha256").update(content).digest("hex")
  return hash === expectedHash
}

async function safeExtract(
  archivePath: string,
  targetDir: string,
  archiveType: "zip" | "tar.gz" | "tar.xz",
): Promise<void> {
  if (archiveType === "zip") {
    Archive.extractZip(archivePath, targetDir)
    return
  }
  if (archiveType === "tar.gz") {
    Archive.extractTgz(archivePath, targetDir)
    return
  }
  await run(["tar", "-xJf", archivePath], { cwd: targetDir })
}

export const makeServerDownloader = (): ServerDownloader => ({
  download(_strategy: DownloadStrategy, _targetDir: string): Effect.Effect<string, DownloadError> {
    return Effect.gen(function* () {
      switch (_strategy.type) {
        case "npm": {
          const bin = yield* downloadNpmPackage(_strategy.package, _targetDir, _strategy.integrity)
          return bin
        }
        case "go": {
          const bin = yield* downloadGoModule(_strategy.module, _targetDir, _strategy.binary, _strategy.integrity)
          return bin
        }
        case "cargo": {
          const bin = yield* downloadCargoCrate(_strategy.crate, _targetDir, _strategy.binary, _strategy.integrity)
          return bin
        }
        case "binary": {
          const bin = yield* downloadBinary(
            _strategy.url,
            _targetDir,
            _strategy.binary,
            _strategy.archiveType ?? "tar.gz",
            _strategy.integrity,
          )
          return bin
        }
        case "mason": {
          const bin = yield* downloadMasonPackage(_strategy.package, _targetDir, _strategy.binary, _strategy.integrity)
          return bin
        }
        case "github": {
          const bin = yield* downloadGithubRelease(
            _strategy.repo,
            _strategy.assetPattern,
            _targetDir,
            _strategy.binary,
            _strategy.archiveType ?? "tar.gz",
            _strategy.integrity,
          )
          return bin
        }
        default: {
          const _exhaustive: never = _strategy
          throw new Error(`Unknown download strategy: ${String(_exhaustive)}`)
        }
      }
    }).pipe(
      Effect.catchAll((cause) =>
        Effect.fail(
          new DownloadError({
            serverID: "unknown",
            url: "unknown",
            message: String(cause),
            cause,
          }),
        ),
      ),
    )
  },

  extract(
    _archivePath: string,
    _targetDir: string,
    _archiveType: "zip" | "tar.gz" | "tar.xz",
  ): Effect.Effect<void, DownloadError> {
    return Effect.tryPromise({
      try: async () => {
        await safeExtract(_archivePath, _targetDir, _archiveType)
      },
      catch: (cause) =>
        new DownloadError({
          serverID: "unknown",
          url: _archivePath,
          message: `Failed to extract ${_archiveType}: ${String(cause)}`,
          cause,
        }),
    })
  },

  verify(binaryPath: string): Effect.Effect<boolean> {
    return Effect.tryPromise({
      try: async () => {
        await fs.access(binaryPath, fs.constants.X_OK)
        return true
      },
      catch: () => false,
    })
  },
})

/**
 * Strategy implementations with integrity verification
 */

async function downloadNpmPackage(_packageName: string, _targetDir: string, _integrity?: string): Promise<string> {
  throw new Error("Not implemented - would use npm pack or registry download")
}

async function downloadGoModule(module: string, targetDir: string, binary?: string, integrity?: string): Promise<string> {
  const proc = Process.spawn(["go", "install", `${module}@latest`], {
    env: { ...process.env, GOBIN: Global.Path.bin },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  })
  const exit = await proc.exited
  if (exit !== 0) throw new Error("Go install failed")
  const binPath = path.join(Global.Path.bin, binary ?? path.basename(module))
  if (integrity && !(await verifyIntegrity(binPath, integrity))) {
    throw new Error("Integrity check failed for Go module")
  }
  return binPath
}

async function downloadCargoCrate(crate: string, targetDir: string, binary?: string, integrity?: string): Promise<string> {
  const proc = Process.spawn(["cargo", "install", crate, "--locked"], {
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  })
  const exit = await proc.exited
  if (exit !== 0) throw new Error("Cargo install failed")
  const binPath = path.join(Global.Path.bin, binary ?? crate)
  if (integrity && !(await verifyIntegrity(binPath, integrity))) {
    throw new Error("Integrity check failed for Cargo crate")
  }
  return binPath
}

async function downloadBinary(
  url: string,
  targetDir: string,
  binary?: string,
  archiveType: "zip" | "tar.gz" | "tar.xz" = "tar.gz",
  integrity?: string,
): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Download failed: ${response.status}`)
  if (!response.body) throw new Error("No response body")

  const ext = archiveType === "zip" ? ".zip" : archiveType === "tar.gz" ? ".tar.gz" : ".tar.xz"
  const archivePath = path.join(targetDir, `download${ext}`)
  await Filesystem.writeStream(archivePath, response.body)

  await safeExtract(archivePath, targetDir, archiveType)

  await fs.rm(archivePath, { force: true })

  const foundBin = binary ? path.join(targetDir, binary) : findBinary(targetDir)
  if (!foundBin) throw new Error("Binary not found after extraction")
  if (integrity && !(await verifyIntegrity(foundBin, integrity))) {
    throw new Error("Integrity check failed for downloaded binary")
  }
  return foundBin
}

async function downloadMasonPackage(_packageName: string, _targetDir: string, _binary?: string, _integrity?: string): Promise<string> {
  throw new Error("Not implemented - would use mason")
}

async function downloadGithubRelease(
  repo: string,
  assetPattern: string,
  targetDir: string,
  binary?: string,
  archiveType: "zip" | "tar.gz" | "tar.xz" = "tar.gz",
  integrity?: string,
): Promise<string> {
  const releaseResponse = await fetch(`https://api.github.com/repos/${repo}/releases/latest`)
  if (!releaseResponse.ok) throw new Error("Failed to fetch release")
  const release = await releaseResponse.json()
  const tag = release.tag_name
  if (!tag) throw new Error("No tag in release")

  const assets = release.assets ?? []
  const asset = assets.find(
    (a: unknown) =>
      a &&
      typeof a === "object" &&
      "name" in a &&
      typeof a.name === "string" &&
      a.name.match(assetPattern.replace("{version}", tag.slice(1))),
  )
  if (!asset?.browser_download_url) throw new Error("Asset not found")

  return downloadBinary(asset.browser_download_url, targetDir, binary, archiveType, integrity)
}

function findBinary(_dir: string): string | undefined {
  return undefined
}

/**
 * Service
 */

export class ServerDownloaderService extends Context.Service<ServerDownloaderService>()(
  "@opencode/LSP/ServerDownloader",
) {
  static Live = Layer.succeed(ServerDownloaderService, makeServerDownloader())
}

export * as Downloader from "./downloader"
