export * as TuiConfig from "./tui"

import path from "path"
import { mergeDeep, unique } from "remeda"
import { Cause, Context, Effect, Fiber, Layer } from "effect"
import { ConfigParse } from "@/config/parse"
import * as ConfigPaths from "@/config/paths"
import { migrateTuiConfig } from "./tui-migrate"
import { resolveHostAttentionSoundPaths } from "./tui-host-attention"
import { Flag } from "@opencode-ai/core/flag/flag"
import { isRecord } from "@opencode-ai/tui/util/record"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CurrentWorkingDirectory } from "./tui-cwd"
import { BUNDLED_PLUGINS } from "@/config/config"
import { ConfigPlugin } from "@/config/plugin"
import { parsePluginSpecifier } from "@/plugin/shared"
import { TuiKeybind } from "@opencode-ai/tui/config/keybind"
import { InstallationLocal, InstallationVersion } from "@opencode-ai/core/installation/version"
import { makeRuntime } from "@opencode-ai/core/effect/runtime"
import { Filesystem } from "@/util/filesystem"
import { ConfigVariable } from "@/config/variable"
import { Npm } from "@opencode-ai/core/npm"
import { FormatError, FormatUnknownError } from "@/cli/error"
import { TuiConfig } from "@opencode-ai/tui/config"

export const Info = TuiConfig.Info
export type Info = TuiConfig.Info

type Acc = {
  result: Info
  plugin_origins: ConfigPlugin.Origin[]
}

export type Resolved = TuiConfig.Resolved

export type HostMetadata = {
  plugin_origins?: ConfigPlugin.Origin[]
}

export interface Interface {
  readonly get: () => Effect.Effect<Resolved>
  readonly pluginOrigins: () => Effect.Effect<ConfigPlugin.Origin[]>
  readonly waitForDependencies: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/TuiConfig") {}

function pluginScope(file: string, ctx: { directory: string }): ConfigPlugin.Scope {
  if (Filesystem.contains(ctx.directory, file)) return "local"
  // if (ctx.worktree !== "/" && Filesystem.contains(ctx.worktree, file)) return "local"
  return "global"
}

function normalize(raw: Record<string, unknown>) {
  const data = { ...raw }
  if (!("tui" in data)) return data
  if (!isRecord(data.tui)) {
    delete data.tui
    return data
  }

  const tui = data.tui
  delete data.tui
  return {
    ...tui,
    ...data,
  }
}

function dropUnknownKeybinds(input: Record<string, unknown>) {
  if (!isRecord(input.keybinds)) return input

  const invalid = TuiKeybind.unknownKeys(input.keybinds)
  if (!invalid.length) return input

  return {
    ...input,
    keybinds: Object.fromEntries(Object.entries(input.keybinds).filter(([key]) => !invalid.includes(key))),
  }
}

const loadState = Effect.fn("TuiConfig.loadState")(function* (ctx: { directory: string }) {
  const afs = yield* FSUtil.Service
  let appliedOrder = 0

  const resolvePlugins = (config: Info, configFilepath: string): Effect.Effect<Info> =>
    Effect.gen(function* () {
      const plugins = config.plugin
      if (!plugins) return config
      return {
        ...config,
        plugin: yield* Effect.forEach(plugins, (plugin) =>
          Effect.promise(() => ConfigPlugin.resolvePluginSpec(plugin as ConfigPlugin.Origin["spec"], configFilepath)),
        ),
      }
    })

  const load = (text: string, configFilepath: string): Effect.Effect<Info> =>
    Effect.gen(function* () {
      const expanded = yield* Effect.promise(() =>
        ConfigVariable.substitute({ text, type: "path", path: configFilepath, missing: "empty" }),
      )
      const data = ConfigParse.jsonc(expanded, configFilepath)
      if (!isRecord(data)) return {} as Info
      // Flatten a nested "tui" key so users who wrote `{ "tui": { ... } }` inside tui.json
      // (mirroring the old openaxe.json shape) still get their settings applied.
      const normalized = dropUnknownKeybinds(normalize(data))
      const parsed = ConfigParse.schema(Info, normalized, configFilepath)
      const validated = parsed.attention?.sounds
        ? {
            ...parsed,
            attention: {
              ...parsed.attention,
              sounds: resolveHostAttentionSoundPaths(path.dirname(configFilepath), parsed.attention.sounds),
            },
          }
        : parsed
      return yield* resolvePlugins(validated, configFilepath)
    }).pipe(
      // catchCause (not tapErrorCause + orElseSucceed) because JSONC parsing and validation
      // can sync-throw — those become defects, which orElseSucceed wouldn't catch.
      Effect.catchCause((cause) =>
        Effect.logWarning("skipping invalid tui config", {
          path: configFilepath,
          reason: FormatError(Cause.squash(cause)) ?? FormatUnknownError(Cause.squash(cause)),
        }).pipe(Effect.as({} as Info)),
      ),
    )

  const loadFile = (filepath: string): Effect.Effect<Info> =>
    Effect.gen(function* () {
      // Silent-swallow non-NotFound read errors (perms, EISDIR, IO) → log + skip.
      // Matches how parse/schema/plugin failures in load() are handled — every
      // broken-config path degrades gracefully rather than crashing TUI startup.
      const text = yield* afs.readFileStringSafe(filepath).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to read tui config", {
            path: filepath,
            reason: FormatError(Cause.squash(cause)) ?? FormatUnknownError(Cause.squash(cause)),
          }).pipe(Effect.as(undefined)),
        ),
      )
      if (!text) return {} as Info
      yield* Effect.logInfo("loading tui config", { path: filepath })
      return yield* load(text, filepath)
    })

  const mergeFile = (acc: Acc, file: string) =>
    Effect.gen(function* () {
      const data = yield* loadFile(file)
      if (Object.keys(data).length) {
        appliedOrder += 1
        yield* Effect.logInfo("applying tui config", { path: file, order: appliedOrder })
      }
      acc.result = mergeDeep(acc.result, data)
      if (!data.plugin?.length) return

      const scope = pluginScope(file, ctx)
      const plugins = ConfigPlugin.deduplicatePluginOrigins([
        ...acc.plugin_origins,
        ...data.plugin.map((spec) => ({ spec: spec as ConfigPlugin.Origin["spec"], scope, source: file })),
      ])
      acc.result = {
        ...acc.result,
        plugin: plugins.map((item) => item.spec),
      }
      acc.plugin_origins = plugins
    })

  // Every config dir we may read from: global config dir, any `.openaxe`
  // folders between cwd and home, and OPENCODE_CONFIG_DIR.
  const directories = yield* ConfigPaths.directories(ctx.directory)
  yield* Effect.promise(() => migrateTuiConfig({ directories, cwd: ctx.directory }))

  const projectFiles = Flag.OPENCODE_DISABLE_PROJECT_CONFIG ? [] : yield* ConfigPaths.files("tui", ctx.directory)

  const acc: Acc = {
    result: {},
    plugin_origins: [],
  }

  // 1. Global tui config (lowest precedence).
  for (const file of ConfigPaths.fileInDirectory(Global.Path.config, "tui")) {
    yield* mergeFile(acc, file)
  }

  // 2. Explicit OPENCODE_TUI_CONFIG override, if set.
  if (Flag.OPENCODE_TUI_CONFIG) {
    const configFile = Flag.OPENCODE_TUI_CONFIG
    yield* mergeFile(acc, configFile)
    yield* Effect.logDebug("loaded custom tui config", { path: configFile })
  }

  // 3. Project tui files, applied root-first so the closest file wins.
  for (const file of projectFiles) {
    yield* mergeFile(acc, file)
  }

  // 4. `.openaxe` directories (and OPENCODE_CONFIG_DIR) discovered while
  // walking up the tree. Also returned below so callers can install plugin
  // dependencies from each location.
  const dirs = unique(directories).filter(
    (dir) => dir.endsWith(".openaxe") || dir === Flag.OPENCODE_CONFIG_DIR,
  )

  // Parallel read across all .openaxe dirs, then sequential merge
  const fileEntries: { file: string; data: Info }[] = yield* Effect.forEach(
    dirs,
    (dir) =>
      Effect.forEach(ConfigPaths.fileInDirectory(dir, "tui"), (file) =>
        loadFile(file).pipe(Effect.map((data) => ({ file, data }))),
      ),
    { concurrency: "unbounded" },
  ).pipe(Effect.map((groups) => groups.flat()))

  for (const { file, data } of fileEntries) {
    if (Object.keys(data).length) {
      appliedOrder += 1
      yield* Effect.logInfo("applying tui config", { path: file, order: appliedOrder })
    }
    acc.result = mergeDeep(acc.result, data)
    if (!data.plugin?.length) continue
    const scope = pluginScope(file, ctx)
    const plugins = ConfigPlugin.deduplicatePluginOrigins([
      ...acc.plugin_origins,
      ...data.plugin.map((spec) => ({ spec: spec as ConfigPlugin.Origin["spec"], scope, source: file })),
    ])
    acc.result = { ...acc.result, plugin: plugins.map((item) => item.spec) }
    acc.plugin_origins = plugins
  }

  // Ensure bundled plugins are always present, even if the config file was
  // written before a newer openaxe release added them as defaults.
  const seen = new Set((acc.result.plugin ?? []).map(ConfigPlugin.pluginSpecifier).map((s) => parsePluginSpecifier(s).pkg))
  const add = [...BUNDLED_PLUGINS].filter((p) => !seen.has(parsePluginSpecifier(p).pkg))
  if (add.length) {
    acc.result = {
      ...acc.result,
      plugin: [...(acc.result.plugin ?? []), ...add],
    }
    acc.plugin_origins = [
      ...acc.plugin_origins,
      ...add.map((spec) => ({ spec, scope: "global" as const, source: "bundle" })),
    ]
  }

  const result = TuiConfig.resolve(
    {
      ...acc.result,
    },
    {
      terminalSuspend: process.platform !== "win32",
    },
  )

  return {
    config: result,
    pluginOrigins: acc.plugin_origins,
    dirs: result.plugin?.length ? dirs : [],
  }
})

export const layer = (directory?: string) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const dir = directory ?? (yield* CurrentWorkingDirectory)
      const npm = yield* Npm.Service
      const data = yield* loadState({ directory: dir })
      const deps = yield* Effect.forEach(
        data.dirs,
        (dir) =>
          npm
            .install(dir, {
              add: [
                {
                  name: "@opencode-ai/plugin",
                  version: InstallationLocal ? undefined : InstallationVersion,
                },
                ...BUNDLED_PLUGINS.map((name) => ({ name })),
              ],
            })
            .pipe(Effect.forkScoped),
        {
          concurrency: "unbounded",
        },
      )

      const get = Effect.fn("TuiConfig.get")(() => Effect.succeed(data.config))
      const pluginOrigins = Effect.fn("TuiConfig.pluginOrigins")(() => Effect.succeed(data.pluginOrigins))

      const waitForDependencies = Effect.fn("TuiConfig.waitForDependencies")(() =>
        Effect.forEach(deps, Fiber.join, { concurrency: "unbounded" }).pipe(Effect.ignore(), Effect.asVoid),
      )
      return Service.of({ get, pluginOrigins, waitForDependencies })
  }).pipe(Effect.withSpan("TuiConfig.layer")),
)

export const defaultLayer = layer().pipe(Layer.provide(Npm.defaultLayer), Layer.provide(FSUtil.defaultLayer))

const { runPromise } = makeRuntime(Service, defaultLayer)

export async function waitForDependencies() {
  await runPromise((svc) => svc.waitForDependencies())
}

export async function get(directory?: string) {
  if (!directory) return runPromise((svc) => svc.get())
  const dirLayer = layer(directory).pipe(Layer.provide(Npm.defaultLayer), Layer.provide(FSUtil.defaultLayer))
  const { runPromise: runWithDir } = makeRuntime(Service, dirLayer)
  return runWithDir((svc) => svc.get())
}

export async function pluginOrigins() {
  return runPromise((svc) => svc.pluginOrigins())
}
