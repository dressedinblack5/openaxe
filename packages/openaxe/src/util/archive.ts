import path from "path"
import { run } from "./process"
export async function extractZip(zipPath: string, destDir: string) {
  if (process.platform === "win32") {
    const winZipPath = path.resolve(zipPath)
    const winDestDir = path.resolve(destDir)
    // $global:ProgressPreference suppresses PowerShell's blue progress bar popup
    const cmd = `$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path '${winZipPath}' -DestinationPath '${winDestDir}' -Force`
    await run(["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd])
    return
  }

  await run(["unzip", "-o", "-q", zipPath, "-d", destDir])
}

export * as Archive from "./archive"
