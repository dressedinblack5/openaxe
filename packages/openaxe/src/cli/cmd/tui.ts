import { cmd } from "@/cli/cmd/cmd"
import { Rpc } from "@/util/rpc"
import { type rpc } from "../tui/worker"
import path from "path"
import { fileURLToPath } from "url"
import { UI } from "@/cli/ui"
import { errorMessage } from "@opencode-ai/tui/util/error"
import { withTimeout } from "@/util/timeout"
import { withNetworkOptions, resolveNetworkOptionsNoConfig } from "@/cli/network"
import { Filesystem } from "@/util/filesystem"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import type { EventSource } from "@opencode-ai/tui/context/sdk"
import { writeHeapSnapshot } from "v8"
import { validateSession } from "../tui/validate-session"
import { win32InstallCtrlCGuard } from "@opencode-ai/tui/terminal-win32"
import { mark, report } from "@/cli/startup-timing"
import type { TuiConfig } from "@/config/tui"

declare global {
  const OPENCODE_WORKER_PATH: string
}

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>

function createWorkerFetch(client: RpcClient): typeof fetch {
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const body = request.body ? await request.text() : undefined
    const result = await client.call("fetch", {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
    })
    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    })
  }
  return fn as typeof fetch
}

function createEventSource(client: RpcClient): EventSource {
  return {
    subscribe: async (handler) => {
      return client.on("global.event", (e: unknown) => {
        handler(e as GlobalEvent)
      })
    },
  }
}

function createInternalFetch(): typeof fetch {
  let first = true
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // #4: lazy import inside fetch fn (first-call only) — never hoisted to boot
    const { Server } = await import("@/server/server")
    const { ServerAuth } = await import("@/server/auth")
    const request = new Request(input, init)
    const headers = new Headers(request.headers)
    const auth = ServerAuth.header()
    if (auth) headers.set("Authorization", auth)
    if (first) mark("tui-fetch-start")
    const response = await Server.Default().app.fetch(new Request(request, { headers }))
    if (first) {
      first = false
      mark("tui-fetch-done")
    }
    return response
  }
  return fn as typeof fetch
}

/**
 * Best-effort background warm-up of the AppLayer runtime. The first SDK call
 * into the server pays a one-time ~8s cost (dynamic import of the ~45-module
 * app layer + ManagedRuntime.make + first-use service init). Firing a few real
 * requests during the TUI's own boot moves that cost off the sync's critical
 * path — the sync re-fetches the same endpoints and finds services warm.
 * Failures only cost boot-time CPU; never blocks or fails boot.
 */
function prewarmAppLayer(fetchFn: typeof fetch, url: string, directory: string, isExternal: boolean) {
  void (async () => {
    const warm = (path: string) => fetchFn(`${url}${path}?directory=${encodeURIComponent(directory)}`).catch(() => {})
    const warms = isExternal
      ? [
          warm("/config/providers"),
          warm("/provider"),
          warm("/experimental/capabilities"),
          warm("/agent"),
          warm("/config"),
          warm("/path"),
          warm("/project/current"),
        ]
      : [warm("/config"), warm("/project/current")]
    try {
      // Fire the warms BEFORE importing the app layer: the 45-module dynamic
      // import blocks the main thread for ~1.6s, and every request waits on the
      // shared instance boot anyway — getting a head start on the boot beats
      // warms that arrive 400ms before the sync.
      await Promise.allSettled(warms)
      const { Effect } = await import("effect")
      if (isExternal) {
        const { AppRuntime } = await import("@/effect/app-runtime")
        await Promise.allSettled([AppRuntime.runPromise(Effect.void)])
      } else {
        // Internal mode: skip AppRuntime void warm (~8s, 45 services); CoreRuntime
        // backs CoreLayer (12 services, ~200MB lighter) and is sufficient for
        // the trimmed /config + /project/current warms. Best-effort only.
        const { CoreRuntime } = await import("@/effect/app-runtime")
        await Promise.allSettled([CoreRuntime.runPromise(Effect.void)])
      }
    } catch {
      // pre-warm is best-effort
    }
  })()
}

async function target() {
  if (typeof OPENCODE_WORKER_PATH !== "undefined") return OPENCODE_WORKER_PATH
  const dist = new URL("./cli/tui/worker.js", import.meta.url)
  if (await Filesystem.exists(fileURLToPath(dist))) return dist
  return new URL("../tui/worker.ts", import.meta.url)
}

async function input(value?: string) {
  const piped = process.stdin.isTTY ? undefined : await Bun.stdin.text()
  if (!value) return piped
  if (!piped) return value
  return piped + "\n" + value
}

// OPENAXE_DIRECTORY carries the real launch directory from the launcher wrappers,
// which exec under `bun --cwd` (bun rewrites PWD and process.cwd() to the package dir).
export function resolveThreadDirectory(
  project?: string,
  envPWD = process.env.OPENAXE_DIRECTORY ?? process.env.PWD,
  cwd = process.env.OPENAXE_DIRECTORY ?? process.cwd(),
) {
  if (project) {
    const root = Filesystem.resolve(envPWD ?? cwd)
    return Filesystem.resolve(path.isAbsolute(project) ? project : path.join(root, project))
  }
  return Filesystem.resolve(cwd)
}

async function initOpentuiNativeLib() {
  const { ensureNativeLib } = await import("@/cli/native-lib")
  const nativeLibPath = ensureNativeLib()
  if (nativeLibPath) {
    const { setRenderLibPath } = await import("@opentui/core")
    setRenderLibPath(nativeLibPath)
  }
}

export const TuiCommand = cmd({
  command: "$0 [project]",
  describe: "start openaxe tui",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .positional("project", {
        type: "string",
        describe: "path to start openaxe in",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      })
      .option("fork", {
        type: "boolean",
        describe: "fork the session when continuing (use with --continue or --session)",
      })
      .option("prompt", {
        type: "string",
        describe: "prompt to use",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("mini", {
        type: "boolean",
        describe: "start the minimal interactive interface",
        default: false,
      })
      .option("replay", {
        type: "boolean",
        hidden: true,
      })
      .option("no-replay", {
        type: "boolean",
        describe: "disable mini session history replay on resume and after resize",
      })
      .option("replay-limit", {
        type: "number",
        describe: "cap visible mini replay to the newest N messages",
      })
      .option("demo", {
        type: "boolean",
        hidden: true,
      }),
  handler: async (args) => {
    // OPENCODE_FAST_BOOT (read at packages/tui app.tsx) skips the StartupLoading screen.
    // Set FIRST, before any async work, so TuiStartupProvider reads it during render.
    process.env.OPENCODE_FAST_BOOT ??= "1"
    mark("handler-start")
    if (args.replay === true) {
      UI.error("--replay is not supported; replay is enabled by default")
      process.exitCode = 1
      return
    }
    const noReplay = args.replay === false || args.noReplay === true

    // Defer native lib loading to avoid blocking startup
    const nativeLibPromise = initOpentuiNativeLib().catch(() => {
      UI.error("Failed to load native library, continuing in degraded mode")
      return null
    })
    mark("native-lib-start")

    if (args.mini) {
      const network = ["--port", "--hostname", "--mdns", "--no-mdns", "--mdns-domain", "--cors"].find((option) =>
        process.argv.some((arg) => arg === option || arg.startsWith(option + "=")),
      )
      if (network) {
        UI.error(`${network} cannot be used with --mini`)
        process.exitCode = 1
        return
      }

      const { runMini } = await import("./run")
      await runMini({
        directory: resolveThreadDirectory(args.project),
        continue: args.continue,
        session: args.session,
        fork: args.fork,
        model: args.model,
        agent: args.agent,
        prompt: args.prompt,
        replay: noReplay ? false : undefined,
        replayLimit: args.replayLimit,
        demo: args.demo,
      })
      return
    }

    const unsupported = [
      ["--no-replay", noReplay],
      ["--replay-limit", args.replayLimit !== undefined],
      ["--demo", args.demo !== undefined],
    ].find((entry) => entry[1])?.[0]
    if (unsupported) {
      UI.error(`${unsupported} requires --mini`)
      process.exitCode = 1
      return
    }

    const unguard = win32InstallCtrlCGuard()
    try {
      // Load config early (needed for plugin_origins and config)
      const configMod = import("@/config/tui")
      const { TuiConfig } = await configMod
      mark("config-mod")

      // #4: detect external early (pure: argv + args) so server eval (~2.4s)
      // overlaps worker boot; void import keeps it off handler-start→run-start
      // critical path. Internal fetch keeps lazy import inside fn (first-call only).
      const network = resolveNetworkOptionsNoConfig(args)
      const external =
        process.argv.includes("--port") ||
        process.argv.includes("--hostname") ||
        process.argv.includes("--mdns") ||
        network.mdns ||
        network.port !== 0 ||
        network.hostname !== "127.0.0.1"
      if (!external) void import("@/server/server").catch(() => {})

      if (args.fork && !args.continue && !args.session) {
        UI.error("--fork requires --continue or --session")
        process.exitCode = 1
        return
      }

      // Resolve relative --project paths from PWD, then use the real cwd after
      // chdir so the thread and worker share the same directory key.
      const next = resolveThreadDirectory(args.project)

      // Kick off config loading before chdir (pass directory explicitly to
      // avoid CurrentWorkingDirectory CWD race). ~1s of file I/O overlaps with
      // Worker compilation, saving wall-clock time.
      // Also fetch plugin_origins in the same run to avoid duplicate layer init.
      const configPromise = TuiConfig.getWithPluginOrigins(next)

      // Parallelize: worker creation + Effect imports + config loading
      const filePromise = external ? target() : (Promise.resolve(undefined as unknown as URL) as Promise<URL>)
      const effectImportsPromise = Promise.all([
        import("effect").then((m) => ({ Effect: m.Effect, Cause: m.Cause })),
        import("../tui/layer").then((m) => ({ run: m.run })),
        import("@/plugin/tui/runtime").then((m) => ({ createLegacyTuiPluginHost: m.createLegacyTuiPluginHost })),
      ])

      const file = external ? await filePromise : undefined
      try {
        process.chdir(next)
      } catch {
        UI.error("Failed to change directory to " + next)
        return
      }
      const cwd = Filesystem.resolve(process.cwd())

      let worker: Worker | undefined
      let client: RpcClient | undefined
      if (external) {
        worker = new Worker(file as URL)
        client = Rpc.client<typeof rpc>(worker, { requestTimeout: 120_000 })
        mark("worker-created")
      }

      const [effectImports, { config, pluginOrigins }] = await Promise.all([effectImportsPromise, configPromise])
      const [{ Effect, Cause }, { run }, { createLegacyTuiPluginHost }] = effectImports
      mark("deferred-imports")

      const reload = () => {
        if (!client) return
        client.call("reload", undefined).catch(() => {})
      }
      if (client) process.on("SIGUSR2", reload)

      let stopped = false
      const stop = async () => {
        if (stopped) return
        stopped = true
        if (client) process.off("SIGUSR2", reload)
        if (client) await withTimeout(client.call("shutdown", undefined), 5000).catch(() => {})
        else {
          // Internal mode has no worker; best-effort dispose via CoreRuntime
          // (lighter than AppRuntime) without throwing if not yet warmed.
          try {
            const { CoreRuntime } = await import("@/effect/app-runtime")
            const { InstanceStore } = await import("@/project/instance-store")
            const { Effect: Eff } = await import("effect")
            await CoreRuntime.runPromise(InstanceStore.Service.use((s) => s.disposeAll()).pipe(Eff.catch(() => Eff.void))).catch(
              () => {},
            )
          } catch {}
        }
        worker?.terminate()
        try {
          const { Server } = await import("@/server/server")
          Server.Default.reset?.()
        } catch {}
      }

      const prompt = await input(args.prompt)

      let transport: { url: string; fetch: typeof fetch; events?: EventSource }
      if (external) {
        // External mode: start HTTP server and proxy through it
        const serverResult = await client!.call("server", network)
        mark("server-url")
        transport = {
          url: serverResult.url,
          fetch: createWorkerFetch(client!),
          events: createEventSource(client!),
        }
      } else {
        // Internal mode: use webHandler directly (no HTTP server needed)
        mark("server-url-skip")
        const internalFetch = createInternalFetch()
        transport = {
          url: "http://opencode.internal",
          fetch: internalFetch,
          events: undefined,
        }
      }
      // Warm the AppLayer runtime in the background so the sync's first SDK
      // calls don't pay the one-time ~8s service-init cost on the critical path.
      prewarmAppLayer(transport.fetch, transport.url, cwd, external)
      try {
        await validateSession({
          url: transport.url,
          sessionID: args.session,
          directory: cwd,
          fetch: transport.fetch,
        })
      } catch (error) {
        UI.error(errorMessage(error))
        process.exitCode = 1
        return
      }
      mark("validate-session")

      if (external) {
        setTimeout(() => {
          client!.call("checkUpgrade", { directory: cwd }).catch(() => {})
        }, 1000).unref?.()
      } else {
        // #6: internal checkUpgrade via CoreRuntime (no LLM/LSP/MCP) off critical path
        setTimeout(() => {
          void (async () => {
            try {
              const { CoreRuntime } = await import("@/effect/app-runtime")
              const { Config } = await import("@/config/config")
              const { Effect: Eff } = await import("effect")
              const config = await CoreRuntime.runPromise(Config.Service.use((c) => c.getGlobal()))
              if (config.autoupdate === false) return
              const { Flag } = await import("@opencode-ai/core/flag/flag")
              if (Flag.OPENCODE_DISABLE_AUTOUPDATE) return
              const { InstallationLocal, InstallationVersion } = await import("@opencode-ai/core/installation/version")
              if (InstallationLocal) return
              const { Installation } = await import("@/installation")
              const method = await Installation.method()
              const latest = await Installation.latest(method).catch(() => undefined)
              if (!latest) return
              const { GlobalBus } = await import("@/bus/global")
              if (Flag.OPENCODE_ALWAYS_NOTIFY_UPDATE) {
                GlobalBus.emit("event", {
                  directory: "global",
                  payload: { type: Installation.Event.UpdateAvailable.type, properties: { version: latest } },
                })
                return
              }
              if (InstallationVersion === latest) return
              const kind = Installation.getReleaseType(InstallationVersion, latest)
              if (config.autoupdate === "notify" || kind !== "patch") {
                GlobalBus.emit("event", {
                  directory: "global",
                  payload: { type: Installation.Event.UpdateAvailable.type, properties: { version: latest } },
                })
                return
              }
              if (method === "unknown") return
              await Installation.upgrade(method, latest)
                .then(() =>
                  GlobalBus.emit("event", {
                    directory: "global",
                    payload: { type: Installation.Event.Updated.type, properties: { version: latest } },
                  }),
                )
                .catch(() => {})
            } catch {}
          })()
        }, 1000).unref?.()
      }

      try {
        mark("run-start")
        // #5: native lib was kicked off early (native-lib-start) but await after
        // first paint so TUI boot isn't blocked; degraded mode continues on failure
        void nativeLibPromise.then(() => mark("native-lib")).catch(() => mark("native-lib"))

        try {
          await Effect.runPromise(
            run({
              url: transport.url,
              async onSnapshot() {
                const tui = writeHeapSnapshot("tui.heapsnapshot")
                if (!client) return [tui]
                const server = await client.call("snapshot", undefined)
                return [tui, server]
              },
              config: { ...config, plugin_origins: pluginOrigins } as TuiConfig.Resolved & TuiConfig.HostMetadata,
              pluginHost: createLegacyTuiPluginHost(),
              directory: cwd,
              fetch: transport.fetch,
              events: transport.events,
              args: {
                continue: args.continue,
                sessionID: args.session,
                agent: args.agent,
                model: args.model,
                prompt,
                fork: args.fork,
              },
            }),
          )
        } catch (e) {
          let cause = e
          while (cause instanceof Error && cause.cause) cause = cause.cause
          try {
            UI.error(Cause.pretty(Cause.die(cause)))
          } catch {
            UI.error(errorMessage(cause) || String(cause))
          }
          if (process.platform === "win32") {
            const msg = errorMessage(cause) || String(cause)
            if (msg.includes("error code 126") || msg.includes("Failed to open library")) {
              UI.error(
                "On Windows, this usually means the Visual C++ Redistributable is missing or openaxe is running from a network share.",
              )
              UI.error(
                "Install it from https://aka.ms/vs/17/release/vc_redist.x64.exe (or vc_redist.arm64.exe for ARM64) and run openaxe from a local drive.",
              )
            }
          }
          process.exitCode = 1
          return
        }
        mark("run-complete")
        report()
      } finally {
        await stop()
      }
    } finally {
      try {
        unguard?.()
      } catch {
        // cleanup is best-effort
      }
    }
    process.exit(0)
  },
})
// scratch
