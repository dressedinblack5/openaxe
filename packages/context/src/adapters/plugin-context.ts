import { Effect, Layer, Schema, Option, Context } from "effect"
import type { ContextService } from "../context"
import { ContextScope, ScopeNotFoundError } from "../context"

/**
 * PluginContext Adapter - Minimal
 */

export interface PluginOptions {
  readonly name: string
  readonly version: string
  readonly description?: string
  readonly author?: string
  readonly license?: string
  readonly repository?: string
  readonly keywords?: ReadonlyArray<string>
  readonly engines?: Record<string, string>
  readonly dependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly devDependencies?: Record<string, string>
}

export interface AgentHooks {}
export interface AISDKHooks {}
export interface CatalogHooks {}
export interface CommandHooks {}
export interface IntegrationHooks {}
export interface PluginDomain {}
export interface ReferenceHooks {}
export interface SkillHooks {}
export interface Reload {}

export interface PluginContext {
  readonly options: PluginOptions
  readonly agent: AgentHooks & Reload
  readonly aisdk: AISDKHooks
  readonly catalog: CatalogHooks & Reload
  readonly command: CommandHooks & Reload
  readonly integration: IntegrationHooks & Reload
  readonly plugin: PluginDomain
  readonly reference: ReferenceHooks & Reload
  readonly skill: SkillHooks & Reload
}

const PLUGIN_CONTEXT_KEYS = {
  OPTIONS: "plugin:options",
  AGENT: "plugin:agent",
  AISDK: "plugin:aisdk",
  CATALOG: "plugin:catalog",
  COMMAND: "plugin:command",
  INTEGRATION: "plugin:integration",
  PLUGIN: "plugin:domain",
  REFERENCE: "plugin:reference",
  SKILL: "plugin:skill"
} as const

export const toPluginScope = (pluginId: string): ContextScope => ({
  _tag: "PluginScope",
  pluginId
})

export const makePluginContext = (
  unified: ContextService,
  pluginId: string
): PluginContext => {
  const scope = toPluginScope(pluginId)

  const getStored = <A>(key: string): Effect.Effect<Option.Option<A>, ScopeNotFoundError> =>
    unified.get<A>(scope, key)

  const setStored = <A>(key: string, value: A): Effect.Effect<void, ScopeNotFoundError> =>
    unified.set(scope, key, value)

  const cache = new Map<string, unknown>()

  const syncGet = <A>(key: string): A | undefined => {
    return cache.get(key) as A | undefined
  }

  const syncSet = <A>(key: string, value: A): void => {
    cache.set(key, value)
    Effect.runFork(setStored(key, value).pipe(Effect.catchCause(Effect.logError)))
  }

  const initCache = Effect.gen(function* () {
    for (const [, key] of Object.entries(PLUGIN_CONTEXT_KEYS)) {
      const value = yield* unified.get<unknown>(scope, key)
      if (Option.isSome(value)) {
        cache.set(key, value.value)
      }
    }
  })

  Effect.runFork(initCache)

  const createProxy = <T extends object>(key: string): T => {
    return new Proxy({} as T, {
      get(_target, prop: string) {
        const cached = syncGet(key)
        if (cached && typeof cached === "object" && prop in cached) {
          return (cached as any)[prop]
        }
        return undefined
      }
    })
  }

  return {
    options: {
      get name() { return syncGet<PluginOptions>(PLUGIN_CONTEXT_KEYS.OPTIONS)?.name ?? "" },
      get version() { return syncGet<PluginOptions>(PLUGIN_CONTEXT_KEYS.OPTIONS)?.version ?? "" },
      get description() { return syncGet<PluginOptions>(PLUGIN_CONTEXT_KEYS.OPTIONS)?.description },
      get author() { return syncGet<PluginOptions>(PLUGIN_CONTEXT_KEYS.OPTIONS)?.author },
      get license() { return syncGet<PluginOptions>(PLUGIN_CONTEXT_KEYS.OPTIONS)?.license },
      get repository() { return syncGet<PluginOptions>(PLUGIN_CONTEXT_KEYS.OPTIONS)?.repository },
      get keywords() { return syncGet<PluginOptions>(PLUGIN_CONTEXT_KEYS.OPTIONS)?.keywords ?? [] },
      get engines() { return syncGet<PluginOptions>(PLUGIN_CONTEXT_KEYS.OPTIONS)?.engines ?? {} },
      get dependencies() { return syncGet<PluginOptions>(PLUGIN_CONTEXT_KEYS.OPTIONS)?.dependencies ?? {} },
      get peerDependencies() { return syncGet<PluginOptions>(PLUGIN_CONTEXT_KEYS.OPTIONS)?.peerDependencies ?? {} },
      get devDependencies() { return syncGet<PluginOptions>(PLUGIN_CONTEXT_KEYS.OPTIONS)?.devDependencies ?? {} }
    } as PluginOptions,

    agent: createProxy<AgentHooks & Reload>(PLUGIN_CONTEXT_KEYS.AGENT),
    aisdk: createProxy<AISDKHooks>(PLUGIN_CONTEXT_KEYS.AISDK),
    catalog: createProxy<CatalogHooks & Reload>(PLUGIN_CONTEXT_KEYS.CATALOG),
    command: createProxy<CommandHooks & Reload>(PLUGIN_CONTEXT_KEYS.COMMAND),
    integration: createProxy<IntegrationHooks & Reload>(PLUGIN_CONTEXT_KEYS.INTEGRATION),
    plugin: createProxy<PluginDomain>(PLUGIN_CONTEXT_KEYS.PLUGIN),
    reference: createProxy<ReferenceHooks & Reload>(PLUGIN_CONTEXT_KEYS.REFERENCE),
    skill: createProxy<SkillHooks & Reload>(PLUGIN_CONTEXT_KEYS.SKILL),
  }
}

/**
 * PluginContext Factory Service
 */
export class PluginContextFactory extends Context.Service<PluginContextFactory, (pluginId: string) => PluginContext>()("@openaxe/PluginContextFactory") {}

/**
 * Layer that provides the PluginContext factory
 */
export const PluginContextAdapterLayer = (unified: ContextService) =>
  Layer.succeed(PluginContextFactory, (pluginId: string) => makePluginContext(unified, pluginId))

export * as PluginContext from "./plugin-context"