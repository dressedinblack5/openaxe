import { Rpc } from "@/util/rpc"
import { GlobalBus } from "@/bus/global"
import { writeHeapSnapshot } from "node:v8"
import { Heap } from "@/cli/heap"
import { mark } from "@/cli/startup-timing"

mark("worker-start")

// ponytail: heavy modules (AppRuntime, Server, etc.) are loaded via dynamic
// import inside RPC handlers. Module resolution + ManagedRuntime.make(AppLayer)
// — which loads ~45 service modules — is deferred until the first RPC call that
// needs them, rather than blocking worker startup.

Heap.start()

const onUnhandledRejection = (_error: unknown) => {}

const onUncaughtException = (_error: Error) => {}

process.on("unhandledRejection", onUnhandledRejection)
process.on("uncaughtException", onUncaughtException)

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", (event) => {
  Rpc.emit("global.event", event)
})

let server: { stop(force?: boolean): Promise<void>; url?: URL } | undefined

export const rpc = {
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    const { Server } = await import("@/server/server")
    const { ServerAuth } = await import("@/server/auth")
    const headers = { ...input.headers }
    const auth = ServerAuth.header()
    if (auth && !headers["authorization"] && !headers["Authorization"]) {
      headers["Authorization"] = auth
    }
    const request = new Request(input.url, {
      method: input.method,
      headers,
      body: input.body,
    })
    const response = await Server.Default().app.fetch(request)
    const body = await response.text()
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }
  },
  snapshot() {
    const result = writeHeapSnapshot("server.heapsnapshot")
    return result
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    mark("server-handler-start")
    const { Server } = await import("@/server/server")
    if (server) await server.stop(true)
    server = await Server.listen(input)
    mark("server-url-ready")
    return { url: server.url!.toString() }
  },
  async checkUpgrade(input: { directory: string }) {
    const { InstanceRuntime } = await import("@/project/instance-runtime")
    const { checkUpgrade } = await import("@/cli/upgrade")
    await InstanceRuntime.load({ directory: input.directory })
    await checkUpgrade().catch(() => {})
  },
  async reload() {
    const { AppRuntime } = await import("@/effect/app-runtime")
    const { Config } = await import("@/config/config")
    const { Effect } = await import("effect")
    const { disposeAllInstancesAndEmitGlobalDisposed } = await import("@/server/global-lifecycle")
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        const cfg = yield* Config.Service
        yield* cfg.invalidate()
        yield* disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true })
      }),
    )
  },
  async shutdown() {
    const { InstanceRuntime } = await import("@/project/instance-runtime")
    const { Server } = await import("@/server/server")
    await InstanceRuntime.disposeAllInstances()
    if (server) await server.stop(true)
    process.off("unhandledRejection", onUnhandledRejection)
    process.off("uncaughtException", onUncaughtException)
  },
}

Rpc.listen(rpc)
mark("rpc-ready")
