import { createRequire } from "node:module"
import path from "node:path"

export function resolve(id: string, dir: string) {
  try {
    return createRequire(path.join(dir, "package.json")).resolve(id)
  } catch {
    return undefined
  }
}

export * as Module from "./module"
