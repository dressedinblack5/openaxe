import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { Effect, Layer, Option, Path } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { InstanceRef } from "@/effect/instance-ref"
import { EventV2 } from "@opencode-ai/core/event"
import { InstanceBootstrap } from "@/project/bootstrap-service"
import { InstanceStore } from "@/project/instance-store"
import { Project } from "@/project/project"
import { ProjectV2 } from "@opencode-ai/core/project"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Database } from "@opencode-ai/core/database/database"
import { ServerAuth } from "../../src/server/auth"
import { Workspace } from "../../src/control-plane/workspace"

const instanceRefLayer = Layer.succeed(InstanceRef, {
  directory: "/tmp/test",
  worktree: "/tmp/test",
  project: {
    id: ProjectV2.ID.make("test"),
    worktree: "/tmp/test",
    time: { created: Date.now(), updated: Date.now() },
    sandboxes: [],
  },
})

const instanceStoreLayer = InstanceStore.defaultLayer.pipe(
  Layer.provide(
    Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
  ),
)

const servedRoutes = HttpRouter.serve(
  HttpApiApp.routes,
  {
    disableListenLog: true,
    disableLogger: true,
  },
)

export const httpApiLayer = servedRoutes.pipe(
  Layer.provideMerge(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(instanceStoreLayer),
  Layer.provideMerge(Project.defaultLayer),
  Layer.provideMerge(EventV2.defaultLayer),
  Layer.provideMerge(EventV2Bridge.defaultLayer),
  Layer.provideMerge(instanceRefLayer),
  Layer.provideMerge(Path.layer),
  Layer.provideMerge(Database.defaultLayer),
  Layer.provideMerge(ServerAuth.Config.layer({ username: "test", password: Option.some("test") })),
  Layer.provideMerge(Workspace.defaultLayer),
  Layer.provideMerge(Ripgrep.defaultLayer),
)

export function makeTestUrl(server: { readonly address: { readonly _tag: string; readonly hostname?: string; readonly port?: number; readonly path?: string }; readonly serve: (...args: any[]) => any }, path: string): string {
  const address = server.address
  if (address._tag === "UnixAddress") throw new Error("UnixAddress not supported")
  const host = address.hostname === "0.0.0.0" ? "127.0.0.1" : address.hostname
  const reqUrl = path.startsWith("http://") || path.startsWith("https://")
    ? new URL(path)
    : new URL(path, "http://localhost")
  return `http://${host}:${address.port}${reqUrl.pathname}${reqUrl.search}`
}

export function requestWithBody(method: string, path: string, init: RequestInit = {}) {
  return Effect.gen(function* () {
    const server = yield* HttpServer.HttpServer
    const url = makeTestUrl(server, path)
    const response = yield* Effect.tryPromise(() => fetch(url, { ...init, method }))
    const request_ = HttpClientRequest.fromWeb(new Request(url, { ...init, method }))
    return HttpClientResponse.fromWeb(request_, response)
  })
}

export function request(path: string, init?: RequestInit) {
  return requestWithBody("POST", path, init)
}

export function requestInDirectory(path: string, directory: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("x-opencode-directory", directory)
  return requestWithBody("POST", path, { ...init, headers })
}
