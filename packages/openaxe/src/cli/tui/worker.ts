import { Rpc } from "@/util/rpc"
import { GlobalBus } from "@/bus/global"
import { writeHeapSnapshot } from "node:v8"
import { Heap } from "@/cli/heap"
import { mark } from "@/cli/startup-timing"
import { safeFetch } from "@/util/safe-fetch"
import { tmpdir } from "node:os"
import { resolve } from "node:path"

mark("worker-start")

// ponytail: heavy modules (AppRuntime, Server, etc.) are loaded via dynamic
// import inside RPC handlers. Module resolution + ManagedRuntime.make(AppLayer)
// — which loads ~45 service modules — is deferred until the first RPC call that
// needs them, rather than blocking worker startup.

void Heap.start()

const onUnhandledRejection = (_error: unknown) => {}

const onUncaughtException = (_error: Error) => {}

process.on("unhandledRejection", onUnhandledRejection)
process.on("uncaughtException", onUncaughtException)

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", (event) => {
  Rpc.emit("global.event", event)
})

let server: { stop(force?: boolean): Promise<void>; url?: URL } | undefined

const ALLOWED_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"])

function validateHostname(hostname: string): string {
  if (!ALLOWED_HOSTNAMES.has(hostname)) {
    throw new Error(`Hostname not allowed: ${hostname}. Only localhost bindings permitted.`)
  }
  return hostname
}

function sanitizeSnapshotPath(filename: string): string {
  const safeDir = tmpdir()
  const safePath = resolve(safeDir, filename)
  // Ensure the resolved path is within the temp directory (prevent traversal)
  if (!safePath.startsWith(resolve(safeDir))) {
    throw new Error("Invalid snapshot path")
  }
  return safePath
}

export const rpc = {
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    const { ServerAuth } = await import("@/server/auth")
    if (!server?.url) throw new Error("Server not yet started; call server() first")
    const headers = { ...input.headers }
    const auth = ServerAuth.header()
    if (auth && !headers["authorization"] && !headers["Authorization"]) {
      headers["Authorization"] = auth
    }
    // Proxy through the real server URL so requests hit the fully-configured
    // HttpRouter.serve() handler (with all service layers), not the bare
    // toWebHandler() which lacks the AppLayer context.
    const incomingUrl = new URL(input.url)
    const proxyUrl = new URL(incomingUrl.pathname, server.url)
    proxyUrl.search = incomingUrl.search
    
    // Use safeFetch to block private IPs (metadata endpoints) and enforce HTTPS
    const response = await safeFetch(proxyUrl.toString(), {
      method: input.method,
      headers,
      body: input.body,
    })
    const body = await response.text()
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }
  },
  snapshot() {
    const safePath = sanitizeSnapshotPath("server.heapsnapshot")
    const result = writeHeapSnapshot(safePath)
    return { path: safePath, result }
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[]; noAuth?: boolean }) {
    mark("server-handler-start")
    const hostname = validateHostname(input.hostname)
    if (input.noAuth) {
      process.env.OPENCODE_SERVER_NO_AUTH = "1"
    }
    const { Server } = await import("@/server/server")
    if (server) await server.stop(true)
    server = await Server.listen({ ...input, hostname })
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
    await InstanceRuntime.disposeAllInstances()
    if (server) await server.stop(true)
    process.off("unhandledRejection", onUnhandledRejection)
    process.off("uncaughtException", onUncaughtException)
  },
}

Rpc.listen(rpc)
mark("rpc-ready")
