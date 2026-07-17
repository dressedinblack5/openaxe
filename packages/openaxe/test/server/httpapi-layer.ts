import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { Config, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { InstanceRef } from "@/effect/instance-ref"
import { EventV2 } from "@opencode-ai/core/event"
import { InstanceBootstrap as InstanceBootstrapService } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { Project } from "../../src/project/project"
import { ProjectV2 } from "@opencode-ai/core/project"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Config as ConfigService } from "@/config/config"

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
    Layer.succeed(InstanceBootstrapService.Service, InstanceBootstrapService.Service.of({ run: Effect.void })),
  ),
)

const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.routes,
  {
    disableListenLog: true,
    disableLogger: true,
  },
)

export const httpApiLayer = servedRoutes.pipe(
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
  Layer.provide(instanceStoreLayer),
  Layer.provide(Project.defaultLayer),
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(EventV2Bridge.defaultLayer),
  Layer.provide(instanceRefLayer),
  Layer.provide(ConfigService.defaultLayer),
  Layer.provide(Ripgrep.defaultLayer),
)

export function request(path: string, init?: RequestInit) {
  return Effect.gen(function* () {
    const server = yield* HttpServer.HttpServer
    const address = server.address
    if (address._tag === "UnixAddress") {
      return yield* Effect.die(new Error("UnixAddress not supported"))
    }
    const host = address.hostname === "0.0.0.0" ? "127.0.0.1" : address.hostname
    const url = `http://${host}:${address.port}${path.startsWith("/") ? path : `/${path}`}`
    const response = yield* Effect.tryPromise(() => fetch(url, init))
    const request_ = HttpClientRequest.fromWeb(new Request(url, init))
    return HttpClientResponse.fromWeb(request_, response)
  })
}

export function requestInDirectory(path: string, directory: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("x-opencode-directory", directory)
  return request(path, { ...init, headers })
}
