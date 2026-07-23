import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { Effect, Layer, Option, Path } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { instanceContextLayer } from "../../src/server/routes/instance/httpapi/middleware/instance-context"
import { workspaceRoutingLayer } from "../../src/server/routes/instance/httpapi/middleware/workspace-routing"
import { authorizationLayer } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { schemaErrorLayer } from "../../src/server/routes/instance/httpapi/middleware/schema-error"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../../src/server/routes/instance/httpapi/api"
import { ServerAuth } from "../../src/server/auth"
import { Workspace } from "../../src/control-plane/workspace"
import { Memory } from "@opencode-ai/core/memory"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { AppProcess } from "@opencode-ai/core/process"
import { EventV2 } from "@opencode-ai/core/event"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Git } from "@/git"
import { Worktree } from "@/worktree"
import { Project } from "@/project/project"

// Import handlers for the instance API
import { configHandlers } from "../../src/server/routes/instance/httpapi/handlers/config"
import { experimentalHandlers } from "../../src/server/routes/instance/httpapi/handlers/experimental"
import { fileHandlers } from "../../src/server/routes/instance/httpapi/handlers/file"
import { instanceHandlers } from "../../src/server/routes/instance/httpapi/handlers/instance"
import { mcpHandlers } from "../../src/server/routes/instance/httpapi/handlers/mcp"
import { memoryHandlers } from "../../src/server/routes/instance/httpapi/handlers/memory"
import { projectHandlers } from "../../src/server/routes/instance/httpapi/handlers/project"
import { projectCopyHandlers } from "../../src/server/routes/instance/httpapi/handlers/project-copy"
import { ptyHandlers } from "../../src/server/routes/instance/httpapi/handlers/pty"
import { questionHandlers } from "../../src/server/routes/instance/httpapi/handlers/question"
import { permissionHandlers } from "../../src/server/routes/instance/httpapi/handlers/permission"
import { providerHandlers } from "../../src/server/routes/instance/httpapi/handlers/provider"
import { sessionHandlers } from "../../src/server/routes/instance/httpapi/handlers/session"
import { syncHandlers } from "../../src/server/routes/instance/httpapi/handlers/sync"
import { tuiHandlers } from "../../src/server/routes/instance/httpapi/handlers/tui"
import { workspaceHandlers } from "../../src/server/routes/instance/httpapi/handlers/workspace"

// Build the instance API routes with handlers
const instanceApiRoutes = HttpApiBuilder.layer(InstanceHttpApi).pipe(
  Layer.provide([
    configHandlers,
    experimentalHandlers,
    fileHandlers.pipe(Layer.provide([Ripgrep.defaultLayer, NodeServices.layer])),
    instanceHandlers,
    mcpHandlers,
    memoryHandlers,
    projectHandlers,
    projectCopyHandlers,
    ptyHandlers,
    questionHandlers,
    permissionHandlers,
    providerHandlers,
    sessionHandlers,
    syncHandlers,
    tuiHandlers,
    workspaceHandlers,
  ]),
)

// Build the instance routes with middleware
const instanceRoutes = instanceApiRoutes.pipe(
  Layer.provideMerge(
    Layer.mergeAll([
      Memory.layer,
      authorizationLayer,
      workspaceRoutingLayer.pipe(Layer.provide(layerWebSocketConstructorGlobal)),
      instanceContextLayer,
      schemaErrorLayer,
      Ripgrep.defaultLayer,
      FSUtil.defaultLayer,
      AppProcess.defaultLayer,
      Git.defaultLayer,
      Worktree.defaultLayer,
    ]),
  ),
)

// Now serve the routes
const servedRoutes = HttpRouter.serve(
  instanceRoutes,
  {
    disableListenLog: true,
    disableLogger: true,
  },
)

// Build the final layer
export const httpApiLayer = servedRoutes.pipe(
  Layer.provideMerge(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(Project.defaultLayer),
  Layer.provideMerge(EventV2.defaultLayer),
  Layer.provideMerge(EventV2Bridge.defaultLayer),
  Layer.provideMerge(Path.layer),
  Layer.provideMerge(Database.defaultLayer),
  Layer.provideMerge(ServerAuth.Config.layer({ username: "test", password: Option.some("test") })),
  Layer.provideMerge(Workspace.defaultLayer),
  Layer.provideMerge(Ripgrep.defaultLayer),
)

// Keep the helper functions for making requests
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