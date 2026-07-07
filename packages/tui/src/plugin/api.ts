import type { TuiPluginApi, TuiRouteDefinition } from "@opencode-ai/plugin/tui"
import { createSignal } from "solid-js"

type RouteEntry = {
  key: symbol
  render: TuiRouteDefinition["render"]
}

export type RouteMap = Map<string, RouteEntry[]>

export function createPluginRoutes() {
  const routes: RouteMap = new Map()
  const [revision, setRevision] = createSignal(0)

  return {
    register(list: TuiRouteDefinition[]) {
      const key = Symbol()
      list.forEach((item) => routes.set(item.name, [...(routes.get(item.name) ?? []), { key, render: item.render }]))
      setRevision((value) => value + 1)

      return () => {
        list.forEach((item) => {
          const next = routes.get(item.name)?.filter((entry) => entry.key !== key) ?? []
          if (next.length) {
            routes.set(item.name, next)
            return
          }
          routes.delete(item.name)
        })
        setRevision((value) => value + 1)
      }
    },
    get(name: string) {
      revision()
      return routes.get(name)?.at(-1)?.render
    },
  }
}

export type PluginRoutes = ReturnType<typeof createPluginRoutes>

export function createTuiApi(input: Omit<TuiPluginApi, "lifecycle">): TuiPluginApi {
  if (input.renderer === null || input.renderer === undefined) {
    console.warn(
      "[tui.plugin] Invalid renderer provided to TuiPluginApi - renderer is null/undefined. " +
        "Creating safe wrapper to prevent TypeError.",
    )
    return {
      ...input,
      renderer: {
        requestRender: () => {
          console.warn(
            "[tui.plugin] renderer.requestRender called on null/undefined renderer. " +
              "Plugin is not properly initialized with a valid renderer.",
          )
        },
      } as unknown as TuiPluginApi["renderer"],
      lifecycle: createLifecycle(),
    }
  }

  if (typeof input.renderer !== "object" || !("requestRender" in input.renderer)) {
    console.warn(
      "[tui.plugin] Invalid renderer provided to TuiPluginApi - renderer is not a CliRenderer instance. " +
        "Expected renderer with requestRender() method, got " +
        typeof input.renderer,
    )
    return {
      ...input,
      renderer: {
        requestRender: () => {
          console.warn(
            "[tui.plugin] renderer.requestRender called on invalid renderer. " +
              "This plugin may not work correctly without proper renderer initialization.",
          )
        },
      } as unknown as TuiPluginApi["renderer"],
      lifecycle: createLifecycle(),
    }
  }

  return {
    ...input,
    lifecycle: createLifecycle(),
  }
}

function createLifecycle() {
  return {
    signal: new AbortController().signal,
    onDispose() {
      return () => {}
    },
  }
}
