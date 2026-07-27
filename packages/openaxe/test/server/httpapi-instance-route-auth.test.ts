import { describe, expect } from "bun:test"
import { Effect, Layer, Option, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiError, HttpApiGroup } from "effect/unstable/httpapi"
import { NodeHttpServer } from "@effect/platform-node"
import { ServerAuth } from "../../src/server/auth"
import { PtyID } from "@opencode-ai/core/pty/schema"
import {
  PtyConnectAuthorization,
  ptyConnectAuthorizationLayer,
} from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { PtyPaths } from "../../src/server/routes/instance/httpapi/groups/pty"
import { testEffect } from "../lib/effect"

function basic(username: string, password: string) {
  return ServerAuth.header({ username, password }) ?? ""
}

const cancelBody = (response: Response) => {
  const body = response.body
  if (body === null || body === undefined) return Effect.void
  return Effect.sync(() => body.cancel()).pipe(Effect.catch(() => Effect.void))
}

const ProbeApi = HttpApi.make("pty-connect-auth-probe").add(
  HttpApiGroup.make("probe")
    .add(
      HttpApiEndpoint.get("connect", PtyPaths.connect, {
        success: Schema.Boolean,
        error: HttpApiError.Forbidden,
      }),
    )
    .middleware(PtyConnectAuthorization),
)

const probeLayer = HttpRouter.serve(
  HttpApiBuilder.layer(ProbeApi).pipe(
    Layer.provide(
      HttpApiBuilder.group(ProbeApi, "probe", (handlers) =>
        handlers.handle("connect", () => Effect.succeed(true)),
      ),
    ),
    Layer.provide(ptyConnectAuthorizationLayer),
  ),
  { disableListenLog: true, disableLogger: true },
).pipe(Layer.provideMerge(NodeHttpServer.layerTest))

const itSecret = testEffect(probeLayer.pipe(Layer.provide(ServerAuth.Config.layer({ password: Option.some("secret"), username: "opencode" }))))

describe("HttpApi instance route authorization", () => {
  itSecret.live("requires configured auth before resolving the PTY websocket route", () =>
    Effect.gen(function* () {
      const route = PtyPaths.connect.replace(":ptyID", PtyID.ascending())
      const headers = { "x-opencode-directory": "/nonexistent" }

       const missing = yield* HttpClient.execute(
         HttpClientRequest.get(route).pipe(HttpClientRequest.setHeaders(headers)),
       )
       yield* cancelBody(missing)
      expect(missing.status).toBe(401)

      const authed = yield* HttpClient.execute(
        HttpClientRequest.get(route)
          .pipe(
            HttpClientRequest.setHeaders(headers),
            HttpClientRequest.setHeader("authorization", basic("opencode", "secret")),
          ),
      )
      yield* cancelBody(authed)
      expect(authed.status).toBe(200)
    }),
  )
})
