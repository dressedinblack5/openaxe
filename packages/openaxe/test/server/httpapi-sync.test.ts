import { afterEach, describe, expect, mock } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { SyncPaths } from "../../src/server/routes/instance/httpapi/groups/sync"
import { Project } from "@/project/project"
import { InstanceStore } from "@/project/instance-store"
import { Database } from "@opencode-ai/core/database/database"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import * as Socket from "effect/unstable/socket/Socket"
import { HttpApiBuilder, HttpApi, HttpApiGroup, HttpApiEndpoint } from "effect/unstable/httpapi"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { instanceContextLayer, InstanceContextMiddleware } from "../../src/server/routes/instance/httpapi/middleware/instance-context"
import { workspaceRoutingLayer, WorkspaceRoutingMiddleware } from "../../src/server/routes/instance/httpapi/middleware/workspace-routing"
import { workspaceLayerWithRuntimeFlags } from "../fixture/workspace"
import { EventV2Bridge } from "@/event-v2-bridge"

const originalWorkspaces = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES

// Test state layer for database and flags (matching httpapi-instance-context.test.ts)
const testStateLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* Effect.promise(() => resetDatabase())
    Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        await disposeAllInstances()
        await resetDatabase()
      }),
    )
  }),
)

// Sync test layer with middleware
const syncTestLayer = Layer.mergeAll(
  instanceContextLayer,
  workspaceRoutingLayer.pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal)),
)

const SyncTestApi = HttpApi.make("sync-test").add(
  HttpApiGroup.make("sync-test")
    .add(HttpApiEndpoint.post("start", SyncPaths.start, {
      success: Schema.Boolean,
    }))
    .add(HttpApiEndpoint.post("history", SyncPaths.history, {
      payload: Schema.Struct({ aggregate: Schema.Number }),
      success: Schema.Array(Schema.Unknown),
    }))
    .add(HttpApiEndpoint.post("replay", SyncPaths.replay, {
      success: Schema.Struct({ sessionID: Schema.String }),
    }))
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware),
)

const syncTestHandlers = HttpApiBuilder.group(SyncTestApi, "sync-test", (handlers) =>
  handlers
    .handle("start", () => Effect.succeed(true))
    .handle("history", () => Effect.succeed([]))
    .handle("replay", () => Effect.succeed({ sessionID: "test" })),
)

const syncTestRoutes = HttpApiBuilder.layer(SyncTestApi).pipe(
  Layer.provide(syncTestHandlers),
  Layer.provide(syncTestLayer),
)

const serveSync = () => syncTestRoutes.pipe(HttpRouter.serve, Layer.build)

// Build the full test layer with all required services
const it = testEffect(
  Layer.mergeAll(
    testStateLayer,
    testInstanceStoreLayer,
    Project.defaultLayer,
    Database.defaultLayer,
    EventV2Bridge.defaultLayer,
    workspaceLayerWithRuntimeFlags({ experimentalWorkspaces: true }),
    NodeHttpServer.layerTest,
    NodeServices.layer,
  ).pipe(Layer.provide(Ripgrep.defaultLayer)),
)

afterEach(async () => {
  mock.restore()
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = originalWorkspaces
  await disposeAllInstances()
  await resetDatabase()
})

// Helper function to make HTTP requests
function makeTestUrl(server: { readonly address: { readonly _tag: string; readonly hostname?: string; readonly port?: number; readonly path?: string }; readonly serve: (...args: any[]) => any }, path: string): string {
  const address = server.address
  if (address._tag === "UnixAddress") throw new Error("UnixAddress not supported")
  const host = address.hostname === "0.0.0.0" ? "127.0.0.1" : address.hostname
  const reqUrl = path.startsWith("http://") || path.startsWith("https://")
    ? new URL(path)
    : new URL(path, "http://localhost")
  return `http://${host}:${address.port}${reqUrl.pathname}${reqUrl.search}`
}

function requestWithBody(method: string, path: string, init: RequestInit = {}) {
  return Effect.gen(function* () {
    const server = yield* HttpServer.HttpServer
    const url = makeTestUrl(server, path)
    const response = yield* Effect.tryPromise(() => fetch(url, { ...init, method }))
    return response
  })
}

function requestInDirectory(path: string, directory: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("x-opencode-directory", directory)
  return requestWithBody("POST", path, { ...init, headers })
}

describe("sync HttpApi", () => {
  it.live(
    "serves sync routes",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped({ git: true })
        const headers = { "x-opencode-directory": tmp, "content-type": "application/json" }

        yield* serveSync()

        // Just test that the start endpoint returns 200
        const started = yield* requestInDirectory(SyncPaths.start, tmp, { method: "POST", headers })
        expect(started.status).toBe(200)
      }) as Effect.Effect<void>,
  )
})