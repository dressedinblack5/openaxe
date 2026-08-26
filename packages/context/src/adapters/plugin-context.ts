import { Effect, Layer, Option } from "effect"
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

  const setStored = (key: string, value: unknown): Effect.Effect<void, ScopeNotFoundError> =>
    unified.set(scope, key, value)

  const cache = new Map<string, unknown>()

  const syncGet = (key: string): unknown | undefined => {
    return cache.get(key)
  }

  const _syncSet = (key: string, value: unknown): void => {
    cache.set(key, value)
    Effect.runFork(setStored(key, value).pipe(Effect.catchCause(Effect.logError)))
  }

  const initCache = Effect.gen(function* () {
    for (const [, key] of Object.entries(PLUGIN_CONTEXT_KEYS)) {
      const value = yield* unified.get(scope, key)
      if (Option.isSome(value)) {
        cache.set(key, value.value)
      }
    }
  })

  Effect.runFork(initCache)

  const createProxy = (key: string) => {
    return new Proxy({}, {
      get(_target, prop: string) {
        const cached = syncGet(key)
        if (cached && typeof cached === "object" && prop in cached) {
          return (cached as Record<string, unknown>)[prop]
        }
        return undefined
      }
    })
  }

  return {
    options: {
      get name() { return (syncGet(PLUGIN_CONTEXT_KEYS.OPTIONS) as PluginOptions | undefined)?.name ?? "" },
      get version() { return (syncGet(PLUGIN_CONTEXT_KEYS.OPTIONS) as PluginOptions | undefined)?.version ?? "" },
      get description() { return (syncGet(PLUGIN_CONTEXT_KEYS.OPTIONS) as PluginOptions | undefined)?.description },
      get author() { return (syncGet(PLUGIN_CONTEXT_KEYS.OPTIONS) as PluginOptions | undefined)?.author },
      get license() { return (syncGet(PLUGIN_CONTEXT_KEYS.OPTIONS) as PluginOptions | undefined)?.license },
      get repository() { return (syncGet(PLUGIN_CONTEXT_KEYS.OPTIONS) as PluginOptions | undefined)?.repository },
      get keywords() { return (syncGet(PLUGIN_CONTEXT_KEYS.OPTIONS) as PluginOptions | undefined)?.keywords ?? [] },
      get engines() { return (syncGet(PLUGIN_CONTEXT_KEYS.OPTIONS) as PluginOptions | undefined)?.engines ?? {} },
      get dependencies() { return (syncGet(PLUGIN_CONTEXT_KEYS.OPTIONS) as PluginOptions | undefined)?.dependencies ?? {} },
      get peerDependencies() { return (syncGet(PLUGIN_CONTEXT_KEYS.OPTIONS) as PluginOptions | undefined)?.peerDependencies ?? {} },
      get devDependencies() { return (syncGet(PLUGIN_CONTEXT_KEYS.OPTIONS) as PluginOptions | undefined)?.devDependencies ?? {} }
    } as PluginOptions,

    agent: createProxy(PLUGIN_CONTEXT_KEYS.AGENT),
    aisdk: createProxy(PLUGIN_CONTEXT_KEYS.AISDK),
    catalog: createProxy(PLUGIN_CONTEXT_KEYS.CATALOG),
    command: createProxy(PLUGIN_CONTEXT_KEYS.COMMAND),
    integration: createProxy(PLUGIN_CONTEXT_KEYS.INTEGRATION),
    plugin: createProxy(PLUGIN_CONTEXT_KEYS.PLUGIN),
    reference: createProxy(PLUGIN_CONTEXT_KEYS.REFERENCE),
    skill: createProxy(PLUGIN_CONTEXT_KEYS.SKILL),
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