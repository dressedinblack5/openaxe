import { existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { platform } from "node:os"
import { fileURLToPath } from "node:url"

const LIB_NAME = platform() === "win32" ? "opentui.dll" : `libopentui.${platform() === "darwin" ? "dylib" : "so"}`

export function ensureNativeLib(): string | null {
  const execPath = process.execPath
  if (execPath && execPath !== "") {
    const libPath = join(dirname(execPath), LIB_NAME)
    if (existsSync(libPath)) return libPath
  }
  // Also check the package bin directory (where build places the native lib)
  const pkgBinPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", LIB_NAME)
  if (existsSync(pkgBinPath)) return pkgBinPath
  return null
}
