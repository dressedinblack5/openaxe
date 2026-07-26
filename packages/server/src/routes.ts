import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { FetchHttpClient, HttpRouter } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Config, Layer, Option } from "effect"
import { Api } from "./api"
import { ServerAuth } from "./auth"
import { handlers } from "./handlers"
import { authorizationLayer } from "./middleware/authorization"
import { schemaErrorLayer } from "./middleware/schema-error"
import { PtyEnvironment } from "./pty-environment"

type RouteRequirements =
  | HttpRouter.HttpRouter
  | HttpRouter.Request<"Error", unknown>
  | HttpRouter.Request<"GlobalError", unknown>
  | HttpRouter.Request<"GlobalRequires", unknown>
  | HttpRouter.Request<"Requires", unknown>

export function createRoutes(password?: string): Layer.Layer<never, Config.ConfigError, RouteRequirements> {
  return HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
    Layer.provide(handlers),
    Layer.provide(PtyEnvironment.defaultLayer),
    Layer.provide(authorizationLayer),
    Layer.provide(schemaErrorLayer),
    Layer.provide(
      password
        ? ServerAuth.Config.layer({ username: "opencode", password: Option.some(password) })
        : ServerAuth.Config.defaultLayer,
    ),
    Layer.provide(LocationServiceMap.layer),
    Layer.provide(Database.defaultLayer),
    Layer.provide(EventV2.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
  ) as Layer.Layer<never, Config.ConfigError, RouteRequirements>
}

export const routes = createRoutes()

export const webHandler = () =>
  HttpRouter.toWebHandler(routes, { disableLogger: true })
