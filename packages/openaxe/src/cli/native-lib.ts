import { existsSync, mkdirSync, copyFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { platform, tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

const LIB_NAME = platform() === "win32" ? "opentui.dll" : `libopentui.${platform() === "darwin" ? "dylib" : "so"}`

function stageLib(libPath: string): string {
  if (platform() !== "win32" || !libPath.startsWith("\\\\")) return libPath
  const stagedDir = join(tmpdir(), "openaxe-native-lib")
  mkdirSync(stagedDir, { recursive: true })
  const staged = join(stagedDir, LIB_NAME)
  try {
    copyFileSync(libPath, staged)
    return staged
  } catch {
    return libPath
  }
}

export function ensureNativeLib(): string | null {
  const execPath = process.execPath
  if (execPath && execPath !== "") {
    const libPath = join(dirname(execPath), LIB_NAME)
    if (existsSync(libPath)) return stageLib(libPath)
  }
  const pkgBinPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", LIB_NAME)
  if (existsSync(pkgBinPath)) return stageLib(pkgBinPath)
  return null
}
