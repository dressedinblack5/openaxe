import { NodeHttpServer } from "@effect/platform-node"
import { Credential } from "@opencode-ai/core/credential"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { Context, Effect, Layer, Option, Scope } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { createServer } from "node:http"
import { createRoutes } from "@opencode-ai/server/routes"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { Daemon } from "../../services/daemon"

export default Runtime.handler(
  Commands.commands.serve,
  (input: { readonly [x: string]: any }): Effect.Effect<void, any, Daemon.Service | Scope.Scope> =>
    Effect.scoped(
      Effect.gen(function* () {
        const daemon = yield* Daemon.Service
        const password = yield* daemon.password()
        const address = yield* listen(input.hostname as string, input.port as Option.Option<number>, password)
        if (input.register as boolean) yield* daemon.register(address)
        console.log(`server listening on ${HttpServer.formatAddress(address)}`)
        return yield* Effect.never as unknown as Effect.Effect<never, never, void>
      }) as unknown as Effect.Effect<void, any, Daemon.Service>,
    ),
)

function listen(hostname: string, port: Option.Option<number>, password: string) {
  if (Option.isSome(port)) return bind(hostname, port.value, password)
  const next = (port: number): ReturnType<typeof bind> =>
    bind(hostname, port, password).pipe(
      Effect.catch((error) => (port === 65_535 ? Effect.fail(error) : next(port + 1))),
    )
  return next(4096)
}

function bind(hostname: string, port: number, password: string) {
  return Layer.build(
    HttpRouter.serve(createRoutes(password), { disableListenLog: true, disableLogger: true }).pipe(
      Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port, host: hostname })),
      Layer.provide(Credential.defaultLayer),
      Layer.provide(PermissionSaved.defaultLayer),
    ),
  ).pipe(Effect.map((context) => Context.get(context, HttpServer.HttpServer).address))
}
