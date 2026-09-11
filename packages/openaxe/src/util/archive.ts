import path from "path"
import * as CoreArchive from "@opencode-ai/core/util/archive"
import { run } from "./process"
export async function extractZip(zipPath: string, destDir: string) {
  if (process.platform === "win32") {
    const winZipPath = path.resolve(zipPath)
    const winDestDir = path.resolve(destDir)
    // $global:ProgressPreference suppresses PowerShell's blue progress bar popup
    const cmd = `$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path '${winZipPath}' -DestinationPath '${winDestDir}' -Force`
    try {
      await run(["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd])
      return
    } catch {
      // ponytail: Wine ships a stub powershell that exits without extracting —
      // fall back to pure-JS extraction.
      CoreArchive.extractZip(zipPath, destDir)
      return
    }
  }

  try {
    await run(["unzip", "-o", "-q", zipPath, "-d", destDir])
  } catch {
    CoreArchive.extractZip(zipPath, destDir)
  }
}

export const extractTgz = CoreArchive.extractTgz
export const extractTarXz = CoreArchive.extractTarXz

// Re-export core functions as Archive namespace for backward compatibility
export const Archive = {
  extractZip: async (archivePath: string, destDir: string) => {
    CoreArchive.extractZip(archivePath, destDir)
  },
  extractTgz,
  extractTarXz,
}
