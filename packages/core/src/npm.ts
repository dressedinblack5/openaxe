export * as Npm from "./npm"

import path from "path"
import { Effect, Schema, Context, Layer, Option, FileSystem } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { EffectFlock } from "./util/effect-flock"
import { LayerNode } from "./effect/layer-node"
import { filesystem } from "./effect/layer-node-platform"
import { makeRuntime } from "./effect/runtime"
import { NpmConfig } from "./npm-config"

export class InstallFailedError extends Schema.TaggedErrorClass<InstallFailedError>()("NpmInstallFailedError", {
  add: Schema.Array(Schema.String).pipe(Schema.optional),
  dir: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface EntryPoint {
  readonly directory: string
  readonly entrypoint?: string
}

export interface Interface {
  readonly add: (pkg: string) => Effect.Effect<EntryPoint, InstallFailedError | EffectFlock.LockError>
  readonly install: (
    dir: string,
    input?: {
      add: {
        name: string
        version?: string
      }[]
    },
  ) => Effect.Effect<void, EffectFlock.LockError | InstallFailedError>
  readonly which: (pkg: string, bin?: string) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Npm") {}

const illegal = process.platform === "win32" ? new Set(["<", ">", ":", '"', "|", "?", "*"]) : undefined

export function sanitize(pkg: string) {
  if (!illegal) return pkg
  return Array.from(pkg, (char) => (illegal.has(char) || char.charCodeAt(0) < 32 ? "_" : char)).join("")
}

function normalizeCacheKey(spec: string): string {
  let name = spec
  let version = ""

  if (spec.startsWith("@")) {
    const slash = spec.indexOf("/")
    if (slash !== -1) {
      const afterScope = spec.slice(slash + 1)
      const at = afterScope.indexOf("@")
      if (at !== -1) {
        name = spec.slice(0, slash + at + 1)
        version = afterScope.slice(at)
      }
    }
  } else {
    const at = spec.indexOf("@")
    if (at !== -1) {
      name = spec.slice(0, at)
      version = spec.slice(at)
    }
  }

  if (!name.startsWith("@") && name.includes("/")) {
    const slash = name.indexOf("/")
    name = `@${name.slice(0, slash).toLowerCase()}/${name.slice(slash + 1)}`
  } else if (name.startsWith("@")) {
    const slash = name.indexOf("/")
    if (slash !== -1) {
      name = `@${name.slice(1, slash).toLowerCase()}${name.slice(slash)}`
    }
  }

  return name + version
}

function parsePackageName(spec: string): string {
  if (spec.startsWith("@")) {
    const slash = spec.indexOf("/")
    if (slash === -1) return spec
    const rest = spec.slice(slash + 1)
    const at = rest.indexOf("@")
    return at === -1 ? spec.slice(0, slash + 1 + rest.length) : spec.slice(0, slash + at + 1)
  }
  const at = spec.indexOf("@")
  return at === -1 ? spec : spec.slice(0, at)
}

const resolveEntryPoint = (name: string, dir: string): EntryPoint => {
  let entrypoint: string | undefined
  try {
    entrypoint = typeof Bun !== "undefined" ? import.meta.resolve(name, dir) : import.meta.resolve(dir)
  } catch { /* ponytail: package not installed yet, defer to first install */
    entrypoint = undefined
  }
  return {
    directory: dir,
    entrypoint,
  }
}

interface ArboristNode {
  name: string
  path: string
}

interface ArboristTree {
  edgesOut: Map<string, { to?: ArboristNode }>
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const afs = yield* FSUtil.Service
    const global = yield* Global.Service
    const fs = yield* FileSystem.FileSystem
    const flock = yield* EffectFlock.Service
    const directory = (pkg: string) => path.join(global.cache, "packages", sanitize(pkg))
    const reify = (input: { dir: string; add?: string[] }) =>
      Effect.gen(function* () {
        yield* flock.acquire(`npm-install:${input.dir}`)
        const { Arborist } = yield* Effect.promise(() => import("@npmcli/arborist"))
        const add = input.add ?? []
        const npmOptions = yield* NpmConfig.load(input.dir)
        const arborist = new Arborist({
          ...npmOptions,
          path: input.dir,
          binLinks: true,
          progress: false,
          savePrefix: "",
          ignoreScripts: true,
        })
        return yield* Effect.tryPromise({
          try: () =>
            arborist.reify({
              ...npmOptions,
              add,
              save: true,
              saveType: "prod",
            }),
          catch: (cause) =>
            new InstallFailedError({
              cause,
              add,
              dir: input.dir,
            }),
        }) as Effect.Effect<ArboristTree, InstallFailedError>
      }).pipe(
        Effect.withSpan("Npm.reify", {
          attributes: input,
        }),
      )

    const add = Effect.fn("Npm.add")(function* (pkg: string) {
      pkg = normalizeCacheKey(pkg)
      const dir = directory(pkg)
      const name = (() => {
        try {
          return parsePackageName(pkg)
        } catch { /* ponytail: npa can fail on edge case package specs, fall back to raw name */
          return pkg
        }
      })()

      if (yield* afs.existsSafe(path.join(dir, "node_modules", name))) {
        return resolveEntryPoint(name, path.join(dir, "node_modules", name))
      }

      const tree = yield* reify({ dir, add: [pkg] })

      // Plugin packages often list @opencode-ai/* packages as devDependencies
      // but import them at runtime. npm skips devDeps of transitive deps, so
      // install those explicitly if the package needs them.
      yield* Effect.gen(function* () {
        const pkgPath = path.join(dir, "node_modules", name, "package.json")
        const json = yield* afs.readJson(pkgPath).pipe(Effect.option)
        if (Option.isNone(json)) return
        const devDeps = (json.value as Record<string, unknown>)?.devDependencies as Record<string, string> | undefined
        if (!devDeps) return
        const devAdd = Object.keys(devDeps).filter((d) => d.startsWith("@opencode-ai/"))
        if (!devAdd.length) return
        yield* reify({ dir, add: devAdd })
      }).pipe(Effect.withSpan("Npm.installDevRuntimeDeps"), Effect.ignore)

      const first = tree.edgesOut.values().next().value?.to
      if (!first) {
        const result = resolveEntryPoint(name, path.join(dir, "node_modules", name))
        if (result.entrypoint) return result
        return yield* new InstallFailedError({ add: [pkg], dir })
      }
      return resolveEntryPoint(first.name, first.path)
    }, Effect.scoped)

    const install: Interface["install"] = Effect.fn("Npm.install")(function* (dir, input) {
      const canWrite = yield* afs.access(dir, { writable: true }).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      )
      if (!canWrite) return

      const add = input?.add.map((pkg) => [pkg.name, pkg.version].filter(Boolean).join("@")) ?? []
      if (
        yield* Effect.gen(function* () {
          const nodeModulesExists = yield* afs.existsSafe(path.join(dir, "node_modules"))
          if (!nodeModulesExists) {
            yield* reify({ add, dir })
            return true
          }
          return false
        }).pipe(Effect.withSpan("Npm.checkNodeModules"))
      )
        return

      yield* Effect.gen(function* () {
        const pkg = yield* afs.readJson(path.join(dir, "package.json")).pipe(Effect.orElseSucceed(() => ({})))
        const lock = yield* afs.readJson(path.join(dir, "package-lock.json")).pipe(Effect.orElseSucceed(() => ({})))

        type PackageJson = {
          dependencies?: Record<string, string>
          devDependencies?: Record<string, string>
          peerDependencies?: Record<string, string>
          optionalDependencies?: Record<string, string>
        }
        type LockFile = {
          packages?: Record<string, { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }>
        }

        const pkgTyped = pkg as PackageJson
        const lockTyped = lock as LockFile
        const declared = new Set([
          ...Object.keys(pkgTyped.dependencies || {}),
          ...Object.keys(pkgTyped.devDependencies || {}),
          ...Object.keys(pkgTyped.peerDependencies || {}),
          ...Object.keys(pkgTyped.optionalDependencies || {}),
          ...(input?.add || []).map((pkg) => pkg.name),
        ])

        const root = lockTyped.packages?.[""] || {}
        const locked = new Set([
          ...Object.keys(root?.dependencies || {}),
          ...Object.keys(root?.devDependencies || {}),
          ...Object.keys(root?.peerDependencies || {}),
          ...Object.keys(root?.optionalDependencies || {}),
        ])

        for (const name of declared) {
          if (!locked.has(name)) {
            yield* reify({ dir, add })
            return
          }
        }
      }).pipe(Effect.withSpan("Npm.checkDirty"))

      return
    }, Effect.scoped)

    const which = Effect.fn("Npm.which")(function* (pkg: string, bin?: string) {
      pkg = normalizeCacheKey(pkg)
      const dir = directory(pkg)
      const binDir = path.join(dir, "node_modules", ".bin")

      const pick = Effect.fnUntraced(function* () {
        const files = yield* fs.readDirectory(binDir).pipe(Effect.catch(() => Effect.succeed([] as string[])))

        if (files.length === 0) return Option.none<string>()
        // Caller picked a specific bin (e.g. pyright exposes both `pyright` and
        // `pyright-langserver`); trust the hint if the package provides it.
        if (bin) return files.includes(bin) ? Option.some(bin) : Option.none<string>()
        if (files.length === 1) return Option.some(files[0])

        const pkgJson = yield* afs.readJson(path.join(dir, "node_modules", pkg, "package.json")).pipe(Effect.option)

        if (Option.isSome(pkgJson)) {
          const parsed = pkgJson.value as { bin?: string | Record<string, string> }
          if (parsed?.bin) {
            const unscoped = pkg.startsWith("@") ? pkg.split("/")[1] : pkg
            const parsedBin = parsed.bin
            if (typeof parsedBin === "string") return Option.some(unscoped)
            const keys = Object.keys(parsedBin)
            if (keys.length === 1) return Option.some(keys[0])
            return parsedBin[unscoped] ? Option.some(unscoped) : Option.some(keys[0])
          }
        }

        return Option.some(files[0])
      })

      return Option.getOrUndefined(
        yield* Effect.gen(function* () {
          const bin = yield* pick()
          if (Option.isSome(bin)) {
            return Option.some(path.join(binDir, bin.value))
          }

          yield* fs.remove(path.join(dir, "package-lock.json")).pipe(Effect.orElseSucceed(() => {}))

          yield* add(pkg)

          const resolved = yield* pick()
          if (Option.isNone(resolved)) return Option.none<string>()
          return Option.some(path.join(binDir, resolved.value))
        }).pipe(
          Effect.scoped,
          Effect.orElseSucceed(() => Option.none<string>()),
        ),
      )
    })

    return Service.of({
      add,
      install,
      which,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(EffectFlock.layer),
  Layer.provide(FSUtil.layer),
  Layer.provide(Global.layer),
  Layer.provide(NodeFileSystem.layer),
)
export const node = LayerNode.make(layer, [FSUtil.node, Global.node, filesystem, EffectFlock.node])

const { runPromise } = makeRuntime(Service, defaultLayer)

export async function install(...args: Parameters<Interface["install"]>) {
  return runPromise((svc) => svc.install(...args))
}

export async function add(...args: Parameters<Interface["add"]>) {
  return runPromise((svc) => svc.add(...args))
}

export async function which(...args: Parameters<Interface["which"]>) {
  return runPromise((svc) => svc.which(...args))
}
