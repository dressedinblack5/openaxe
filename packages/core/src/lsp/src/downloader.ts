import { Effect, Layer, Context } from "effect"
import {
  ServerDownloader,
  DownloadStrategy,
  DownloadError,
  ServerSpawnError,
} from "./types"
import { Filesystem } from "@opencode-ai/core/util/filesystem"
import { Archive } from "@opencode-ai/core/util/archive"
import { Process } from "@opencode-ai/core/util/process"
import { Global } from "@opencode-ai/core/global"
import path from "path"
import fs from "fs/promises"

/**
 * ServerDownloader - Strategy pattern for auto-download
 * Supports npm, go, cargo, binary, mason, github strategies
 */

const run = (cmd: string[], opts: Process.RunOptions = {}) =>
  Process.run(cmd, { ...opts, nothrow: true })

const output = (cmd: string[], opts: Process.RunOptions = {}) =>
  Process.text(cmd, { ...opts, nothrow: true })

export const makeServerDownloader = (): ServerDownloader => ({
  download(strategy: DownloadStrategy, targetDir: string): Effect.Effect<string, DownloadError> {
    return Effect.gen(function* () {
      switch (strategy.type) {
        case "npm": {
          const bin = yield* downloadNpmPackage(strategy.package, targetDir)
          return bin
        }
        case "go": {
          const bin = yield* downloadGoModule(strategy.module, strategy.binary, targetDir)
          return bin
        }
        case "cargo": {
          const bin = yield* downloadCargoCrate(strategy.crate, strategy.binary, targetDir)
          return bin
        }
        case "binary": {
          const bin = yield* downloadBinary(strategy.url, strategy.binary, strategy.archiveType ?? "tar.gz", targetDir)
          return bin
        }
        case "mason": {
          const bin = yield* downloadMasonPackage(strategy.package, strategy.binary, targetDir)
          return bin
        }
        case "github": {
          const bin = yield* downloadGithubRelease(strategy.repo, strategy.assetPattern, strategy.binary, strategy.archiveType ?? "tar.gz", targetDir)
          return bin
        }
      }
    }).pipe(
      Effect.catchAll((cause) =>
        Effect.fail(new DownloadError({
          serverID: "unknown",
          url: "unknown",
          message: String(cause),
          cause,
        }))
      ),
    )
  },

  extract(archivePath: string, targetDir: string, archiveType: "zip" | "tar.gz" | "tar.xz"): Effect.Effect<void, DownloadError> {
    return Effect.tryPromise({
      try: async () => {
        if (archiveType === "zip") {
          await Archive.extractZip(archivePath, targetDir)
        } else if (archiveType === "tar.gz") {
          await run(["tar", "-xzf", archivePath], { cwd: targetDir })
        } else if (archiveType === "tar.xz") {
          await run(["tar", "-xJf", archivePath], { cwd: targetDir })
        }
      },
      catch: (cause) => new DownloadError({
        serverID: "unknown",
        url: archivePath,
        message: `Failed to extract ${archiveType}: ${cause}`,
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
 * Strategy implementations
 */

async function downloadNpmPackage(packageName: string, targetDir: string): Promise<string> {
  // In real implementation, would use npm pack or direct download
  throw new Error("Not implemented - would use npm pack or registry download")
}

async function downloadGoModule(module: string, binary?: string, targetDir: string): Promise<string> {
  const proc = Process.spawn(["go", "install", `${module}@latest`], {
    env: { ...process.env, GOBIN: Global.Path.bin },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  })
  const exit = await proc.exited
  if (exit !== 0) throw new Error("Go install failed")
  return path.join(Global.Path.bin, binary ?? path.basename(module))
}

async function downloadCargoCrate(crate: string, binary?: string, targetDir: string): Promise<string> {
  const proc = Process.spawn(["cargo", "install", crate, "--locked"], {
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  })
  const exit = await proc.exited
  if (exit !== 0) throw new Error("Cargo install failed")
  return path.join(Global.Path.bin, binary ?? crate)
}

async function downloadBinary(url: string, binary?: string, archiveType: "zip" | "tar.gz" | "tar.xz" = "tar.gz", targetDir: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Download failed: ${response.status}`)
  if (!response.body) throw new Error("No response body")

  const ext = archiveType === "zip" ? ".zip" : archiveType === "tar.gz" ? ".tar.gz" : ".tar.xz"
  const archivePath = path.join(targetDir, `download${ext}`)
  await Filesystem.writeStream(archivePath, response.body)

  if (archiveType === "zip") {
    await Archive.extractZip(archivePath, targetDir)
  } else if (archiveType === "tar.gz") {
    await run(["tar", "-xzf", archivePath], { cwd: targetDir })
  } else {
    await run(["tar", "-xJf", archivePath], { cwd: targetDir })
  }

  await fs.rm(archivePath, { force: true })

  // Find the binary
  const foundBin = binary ? path.join(targetDir, binary) : findBinary(targetDir)
  if (!foundBin) throw new Error("Binary not found after extraction")
  return foundBin
}

async function downloadMasonPackage(packageName: string, binary?: string, targetDir: string): Promise<string> {
  // Would use mason.nvim package manager
  throw new Error("Not implemented - would use mason")
}

async function downloadGithubRelease(
  repo: string,
  assetPattern: string,
  binary?: string,
  archiveType: "zip" | "tar.gz" | "tar.xz" = "tar.gz",
  targetDir: string
): Promise<string> {
  const releaseResponse = await fetch(`https://api.github.com/repos/${repo}/releases/latest`)
  if (!releaseResponse.ok) throw new Error("Failed to fetch release")
  const release = await releaseResponse.json()
  const tag = release.tag_name
  if (!tag) throw new Error("No tag in release")

  const assets = release.assets ?? []
  const asset = assets.find((a: any) => a.name?.match(assetPattern.replace("{version}", tag.slice(1))))
  if (!asset?.browser_download_url) throw new Error("Asset not found")

  return downloadBinary(asset.browser_download_url, binary, archiveType, targetDir)
}

function findBinary(dir: string): string | undefined {
  // Simple binary finder - would need enhancement
  return undefined
}

/**
 * Service
 */

export class ServerDownloaderService extends Context.Service<ServerDownloaderService>()("@opencode/LSP/ServerDownloader") {
  static Live = Layer.succeed(ServerDownloaderService, makeServerDownloader())
}

export * as Downloader from "./downloader"