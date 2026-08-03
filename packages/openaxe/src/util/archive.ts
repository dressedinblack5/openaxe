import path from "path"
import { extractZip as extractZipPureJs } from "@opencode-ai/core/util/archive"
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
      extractZipPureJs(zipPath, destDir)
      return
    }
  }

  try {
    await run(["unzip", "-o", "-q", zipPath, "-d", destDir])
  } catch {
    extractZipPureJs(zipPath, destDir)
  }
}

export * as Archive from "./archive"
