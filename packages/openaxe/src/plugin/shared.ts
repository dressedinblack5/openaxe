import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { Filesystem } from "@/util/filesystem"
import { isRecord } from "@/util/record"
import { Npm } from "@opencode-ai/core/npm"

// Old npm package names for plugins that are now built-in
export const DEPRECATED_PLUGIN_PACKAGES = ["opencode-openai-codex-auth", "opencode-copilot-auth"]

export function isDeprecatedPlugin(spec: string) {
  return DEPRECATED_PLUGIN_PACKAGES.some((pkg) => spec.includes(pkg))
}

function parsePackageName(spec: string): string {
  if (spec.startsWith("@")) {
    const slash = spec.indexOf("/")
    if (slash === -1) return spec
    const rest = spec.slice(slash + 1)
    const at = rest.indexOf("@")
    return at === -1 ? spec.slice(0, slash + 1 + rest.length) : spec.slice(0, slash + at + 1)
  }
  const isGit = spec.startsWith("git+")
  if (isGit) {
    // For git URLs, version separator is the LAST @ that comes after the last /
    const lastSlash = spec.lastIndexOf("/")
    const at = spec.lastIndexOf("@")
    if (at > lastSlash) return spec.slice(0, at)
    return spec
  }
  const at = spec.indexOf("@")
  return at === -1 ? spec : spec.slice(0, at)
}

function extractVersion(spec: string): string | undefined {
  if (spec.startsWith("@")) {
    const slash = spec.indexOf("/")
    if (slash === -1) return undefined
    const rest = spec.slice(slash + 1)
    const at = rest.indexOf("@")
    return at === -1 ? undefined : rest.slice(at + 1)
  }
  const isGit = spec.startsWith("git+")
  if (isGit) {
    // For git URLs, version is after the LAST @ that comes after the last /
    const lastSlash = spec.lastIndexOf("/")
    const at = spec.lastIndexOf("@")
    if (at > lastSlash) return spec.slice(at + 1)
    return undefined
  }
  const at = spec.indexOf("@")
  return at === -1 ? undefined : spec.slice(at + 1)
}

function normalizePkg(pkg: string): string {
  // git+ URLs keep their format
  if (pkg.startsWith("git+") || !pkg.includes("/")) return pkg
  const slash = pkg.indexOf("/")
  // @Scope/name → @scope/name  (scope is case-insensitive in npm)
  if (pkg.startsWith("@")) return `@${pkg.slice(1, slash).toLowerCase()}${pkg.slice(slash)}`
  // user/repo → @user/repo  (npm GitHub shorthand)
  return `@${pkg.slice(0, slash).toLowerCase()}/${pkg.slice(slash + 1)}`
}

export function parsePluginSpecifier(spec: string) {
  if (spec.startsWith("npm:")) {
    const inner = spec.slice(4)
    const pkg = normalizePkg(parsePackageName(inner))
    return { pkg, version: extractVersion(inner) || "latest" }
  }
  const name = normalizePkg(parsePackageName(spec))
  const version = extractVersion(spec)
  const isGit = spec.startsWith("git+")
  if (isGit && version === undefined) return { pkg: name, version: "" }
  if (version === undefined) return { pkg: name, version: "latest" }
  return { pkg: name, version: version || "" }
}

export type PluginSource = "file" | "npm"
export type PluginKind = "server" | "tui"
type PluginMode = "strict" | "detect"

export type PluginPackage = {
  dir: string
  pkg: string
  json: Record<string, unknown>
}

export type PluginEntry = {
  spec: string
  source: PluginSource
  target: string
  pkg?: PluginPackage
  entry?: string
}

const INDEX_FILES = ["index.ts", "index.tsx", "index.js", "index.mjs", "index.cjs"]

export function pluginSource(spec: string): PluginSource {
  if (isPathPluginSpec(spec)) return "file"
  return "npm"
}

function resolveExportPath(raw: string, dir: string) {
  if (raw.startsWith("file://")) return fileURLToPath(raw)
  if (path.isAbsolute(raw)) return raw
  return path.resolve(dir, raw)
}

function isAbsolutePath(raw: string) {
  return path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)
}

function extractExportValue(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (!isRecord(value)) return undefined
  for (const key of ["import", "default"]) {
    const nested = value[key]
    if (typeof nested === "string") return nested
  }
  return undefined
}

function packageMain(pkg: PluginPackage) {
  const value = pkg.json.main
  if (typeof value !== "string") return
  const next = value.trim()
  if (!next) return
  return next
}

function resolvePackageFile(spec: string, raw: string, kind: string, pkg: PluginPackage) {
  const resolved = resolveExportPath(raw, pkg.dir)
  const root = Filesystem.resolve(pkg.dir)
  const next = Filesystem.resolve(resolved)
  if (!Filesystem.contains(root, next)) {
    throw new Error(`Plugin ${spec} resolved ${kind} entry outside plugin directory`)
  }
  return next
}

function resolvePackagePath(spec: string, raw: string, kind: PluginKind, pkg: PluginPackage) {
  return pathToFileURL(resolvePackageFile(spec, raw, kind, pkg)).href
}

function resolvePackageEntrypoint(spec: string, kind: PluginKind, pkg: PluginPackage) {
  const exports = pkg.json.exports
  if (isRecord(exports)) {
    const raw = extractExportValue(exports[`./${kind}`])
    if (raw) return resolvePackagePath(spec, raw, kind, pkg)
  }

  if (kind !== "server") return
  const main = packageMain(pkg)
  if (main) return resolvePackagePath(spec, main, kind, pkg)

  const opencodePkgPath = path.join(pkg.dir, ".opencode", "package.json")
  return Filesystem.exists(opencodePkgPath)
    .then((exists) => {
      if (!exists) return
      const opencodePkg = path.join(pkg.dir, ".opencode")
      return Filesystem.readJson<Record<string, unknown>>(path.join(opencodePkg, "package.json"))
        .then((json) => {
          const opencodeMain = typeof json.main === "string" ? json.main.trim() : ""
          if (!opencodeMain) return
          return resolvePackagePath(spec, path.join(".opencode", opencodeMain), kind, pkg)
        })
        .catch(() => undefined)
    })
    .then((resolved) => resolved)
}

function targetPath(target: string) {
  if (target.startsWith("file://")) return fileURLToPath(target)
  if (path.isAbsolute(target)) return target
}

async function resolveDirectoryIndex(dir: string) {
  for (const name of INDEX_FILES) {
    const file = path.join(dir, name)
    if (await Filesystem.exists(file)) return file
  }
}

async function resolveTargetDirectory(target: string) {
  const file = targetPath(target)
  if (!file) return
  const stat = await Filesystem.statAsync(file)
  if (!stat?.isDirectory()) return
  return file
}

async function resolvePluginEntrypoint(spec: string, target: string, kind: PluginKind, pkg?: PluginPackage) {
  const source = pluginSource(spec)
  const hit =
    pkg ?? (source === "npm" ? await readPluginPackage(target) : await readPluginPackage(target).catch(() => undefined))
  if (!hit) return target

  const entry = resolvePackageEntrypoint(spec, kind, hit)
  if (entry) return entry

  const dir = await resolveTargetDirectory(target)

  if (kind === "tui") {
    if (source === "file" && dir) {
      const index = await resolveDirectoryIndex(dir)
      if (index) return pathToFileURL(index).href
    }

    if (source === "npm") return
    if (dir) return

    return target
  }

  if (dir && isRecord(hit.json.exports)) {
    if (source === "file") {
      const index = await resolveDirectoryIndex(dir)
      if (index) return pathToFileURL(index).href
    }

    return
  }

  return target
}

export function isPathPluginSpec(spec: string) {
  return spec.startsWith("file://") || spec.startsWith(".") || isAbsolutePath(spec)
}

export async function resolvePathPluginTarget(spec: string) {
  const raw = spec.startsWith("file://") ? fileURLToPath(spec) : spec
  const file = path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw) ? raw : path.resolve(raw)
  const stat = await Filesystem.statAsync(file)
  if (!stat?.isDirectory()) {
    if (spec.startsWith("file://")) return spec
    return pathToFileURL(file).href
  }

  if (await Filesystem.exists(path.join(file, "package.json"))) {
    return pathToFileURL(file).href
  }

  const index = await resolveDirectoryIndex(file)
  if (index) return pathToFileURL(index).href

  throw new Error(`Plugin directory ${file} is missing package.json or index file`)
}

function parseVersion(v: string): number[] {
  return v.split(".").map((x) => parseInt(x, 10) || 0)
}

function satisfies(version: string, range: string): boolean {
  if (range.startsWith("^")) {
    const r = parseVersion(range.slice(1))
    const v = parseVersion(version)
    if (r.length < 1 || v.length < 1) return false
    if (v[0] !== r[0]) return false
    if (v[1] < (r[1] ?? 0)) return false
    if (v[1] === (r[1] ?? 0) && (v[2] ?? 0) < (r[2] ?? 0)) return false
    return true
  }
  return range === version
}

export async function checkPluginCompatibility(target: string, opencodeVersion: string, pkg?: PluginPackage) {
  const parts = opencodeVersion.split(".")
  if (parts.length < 2 || parts.some((p) => isNaN(parseInt(p, 10)))) return
  if (parseInt(parts[0], 10) === 0) return
  const hit = pkg ?? (await readPluginPackage(target).catch(() => undefined))
  if (!hit) return
  const engines = hit.json.engines
  if (!isRecord(engines)) return
  const range = engines.opencode
  if (typeof range !== "string") return
  if (!satisfies(opencodeVersion, range)) {
    throw new Error(`Plugin requires opencode ${range} but running ${opencodeVersion}`)
  }
}

export async function resolvePluginTarget(spec: string) {
  if (isPathPluginSpec(spec)) return resolvePathPluginTarget(spec)
  const parsed = parsePluginSpecifier(spec)
  const pkg = `${parsed.pkg}@${parsed.version}`
  const result = await Npm.add(pkg)
  return result.directory
}

export async function readPluginPackage(target: string): Promise<PluginPackage> {
  const file = target.startsWith("file://") ? fileURLToPath(target) : target
  const stat = await Filesystem.statAsync(file)
  const dir = stat?.isDirectory() ? file : path.dirname(file)
  const pkg = path.join(dir, "package.json")
  const json = await Filesystem.readJson<Record<string, unknown>>(pkg)
  return { dir, pkg, json }
}

export async function createPluginEntry(spec: string, target: string, kind: PluginKind): Promise<PluginEntry> {
  const source = pluginSource(spec)
  const pkg =
    source === "npm" ? await readPluginPackage(target) : await readPluginPackage(target).catch(() => undefined)
  const entry = await resolvePluginEntrypoint(spec, target, kind, pkg)
  return {
    spec,
    source,
    target,
    pkg,
    entry,
  }
}

export function readPackageThemes(spec: string, pkg: PluginPackage) {
  const field = pkg.json["oc-themes"]
  if (field === undefined) return []
  if (!Array.isArray(field)) {
    throw new TypeError(`Plugin ${spec} has invalid oc-themes field`)
  }

  const list = field.map((item) => {
    if (typeof item !== "string") {
      throw new TypeError(`Plugin ${spec} has invalid oc-themes entry`)
    }

    const raw = item.trim()
    if (!raw) {
      throw new TypeError(`Plugin ${spec} has empty oc-themes entry`)
    }
    if (raw.startsWith("file://") || isAbsolutePath(raw)) {
      throw new TypeError(`Plugin ${spec} oc-themes entry must be relative: ${item}`)
    }

    return resolvePackageFile(spec, raw, "oc-themes", pkg)
  })

  return Array.from(new Set(list))
}

export function readPluginId(id: unknown, spec: string) {
  if (id === undefined) return
  if (typeof id !== "string") throw new TypeError(`Plugin ${spec} has invalid id type ${typeof id}`)
  const value = id.trim()
  if (!value) throw new TypeError(`Plugin ${spec} has an empty id`)
  return value
}

export function readV1Plugin(
  mod: Record<string, unknown>,
  spec: string,
  kind: PluginKind,
  mode: PluginMode = "strict",
) {
  const value = mod.default
  if (!isRecord(value)) {
    if (mode === "detect") return
    throw new TypeError(`Plugin ${spec} must default export an object with ${kind}()`)
  }
  if (mode === "detect" && !("id" in value) && !("server" in value) && !("tui" in value)) return

  const server = "server" in value ? value.server : undefined
  const tui = "tui" in value ? value.tui : undefined
  if (server !== undefined && typeof server !== "function") {
    throw new TypeError(`Plugin ${spec} has invalid server export`)
  }
  if (tui !== undefined && typeof tui !== "function") {
    throw new TypeError(`Plugin ${spec} has invalid tui export`)
  }
  if (server !== undefined && tui !== undefined) {
    throw new TypeError(`Plugin ${spec} must default export either server() or tui(), not both`)
  }
  if (kind === "server" && server === undefined) {
    throw new TypeError(`Plugin ${spec} must default export an object with server()`)
  }
  if (kind === "tui" && tui === undefined) {
    throw new TypeError(`Plugin ${spec} must default export an object with tui()`)
  }

  return value
}

export async function resolvePluginId(
  source: PluginSource,
  spec: string,
  target: string,
  id: string | undefined,
  pkg?: PluginPackage,
) {
  if (source === "file") {
    if (id) return id
    throw new TypeError(`Path plugin ${spec} must export id`)
  }
  if (id) return id
  const hit = pkg ?? (await readPluginPackage(target))
  if (typeof hit.json.name !== "string" || !hit.json.name.trim()) {
    throw new TypeError(`Plugin package ${hit.pkg} is missing name`)
  }
  return hit.json.name.trim()
}
