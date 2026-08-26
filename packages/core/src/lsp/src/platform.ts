import { PlatformResolver, DownloadStrategy } from "./types"

/**
 * PlatformResolver - Cross-platform binary resolution
 * Centralizes platform/arch detection and binary resolution
 */

export const makePlatformResolver = (): PlatformResolver => ({
  resolveBinary(platform: NodeJS.Platform, arch: string): { binary: string; args: string[] } {
    const isWindows = platform === "win32"
    const isMac = platform === "darwin"
    const isLinux = platform === "linux"
    const isArm64 = arch === "arm64" || arch === "aarch64"
    const isX64 = arch === "x64"

    return {
      binary: isWindows ? "cmd.exe" : "sh",
      args: isWindows ? ["/c"] : ["-c"],
    }
  },

  getCurrentPlatform(): { platform: NodeJS.Platform; arch: string } {
    return { platform: process.platform, arch: process.arch }
  },

  isWindows(): boolean {
    return process.platform === "win32"
  },

  isMac(): boolean {
    return process.platform === "darwin"
  },

  isLinux(): boolean {
    return process.platform === "linux"
  },

  getArch(): string {
    return process.arch
  },

  getPlatform(): NodeJS.Platform {
    return process.platform
  },

  normalizeArch(arch: string): string {
    if (arch === "aarch64") return "arm64"
    if (arch === "x86_64") return "x64"
    if (arch === "ia32") return "x86"
    return arch
  },

  getAssetName(pattern: string, version: string): string {
    const { platform, arch } = this.getCurrentPlatform()
    const normalizedArch = this.normalizeArch(arch)

    let assetName = pattern
      .replace("{version}", version)
      .replace("{platform}", platform)
      .replace("{arch}", normalizedArch)

    return assetName
  },

  getSupportedCombos(): ReadonlyArray<string> {
    const platform = process.platform
    const arch = this.normalizeArch(process.arch)

    if (platform === "win32") {
      return [`win32-${arch}.zip`, `win32-${arch}.tar.gz`]
    }
    if (platform === "darwin") {
      return [`darwin-${arch}.tar.gz`, `darwin-${arch}.zip`]
    }
    return [`linux-${arch}.tar.gz`, `linux-${arch}.zip`]
  },
})

/**
 * Platform-specific utilities
 */

export const platformUtils = {
  isWindows(): boolean {
    return process.platform === "win32"
  },

  isMac(): boolean {
    return process.platform === "darwin"
  },

  isLinux(): boolean {
    return process.platform === "linux"
  },

  getExeExtension(): string {
    return process.platform === "win32" ? ".exe" : ""
  },

  getArchiveExtension(strategy: DownloadStrategy): string {
    if (strategy.archiveType) return strategy.archiveType
    if (process.platform === "win32") return "zip"
    return "tar.gz"
  },

  getBinaryName(baseName: string): string {
    return `${baseName}${this.getExeExtension()}`
  },

  getLibraryPath(): string {
    if (process.platform === "win32") return process.env.PATH ?? ""
    if (process.platform === "darwin") return process.env.DYLD_LIBRARY_PATH ?? ""
    return process.env.LD_LIBRARY_PATH ?? ""
  },
}

/**
 * Service
 */

import { Context, Layer } from "effect"

export class PlatformResolverService extends Context.Tag("PlatformResolverService")<
  PlatformResolverService,
  PlatformResolver
>() {}

export const PlatformResolverLive = Layer.succeed(PlatformResolverService, makePlatformResolver())

export * as Platform from "./platform"