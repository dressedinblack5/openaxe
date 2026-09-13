import { Effect } from "effect"
import { effectCmd, CliError } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { SERVER_AUTH_REQUIRED_MESSAGE, SERVER_NO_AUTH_WARNING, resolveServerAuth } from "./auth-gate"
import { Global } from "@opencode-ai/core/global"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { HttpServer } from "effect/unstable/http"
import { randomUUID } from "crypto"
import path from "path"
import fs from "fs/promises"

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .option("register", {
        type: "boolean",
        describe: "Register this server instance with the daemon",
        default: false,
      })
      .option("auth", {
        type: "boolean",
        describe: "require authentication (use --no-auth to disable)",
        default: true,
        hidden: true,
      })
      .option("no-auth", {
        type: "boolean",
        describe: "Allow unauthenticated access (DANGEROUS - only for trusted networks)",
        default: false,
      }),
  describe: "starts a headless openaxe server",
  // Server loads instances per-request via x-opencode-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false,
  layer: "core",
  handler: Effect.fn("Cli.serve")(function* (args) {
    const { Server } = yield* Effect.promise(() => import("../../server/server"))
    const { hasPassword, noAuth } = resolveServerAuth(args)
    if (!hasPassword && !noAuth) {
      throw new CliError({
        message: SERVER_AUTH_REQUIRED_MESSAGE,
      })
    }
    if (!hasPassword && noAuth) {
      console.error(SERVER_NO_AUTH_WARNING)
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    if (args.register) {
      const id = randomUUID()
      const directory = Global.Path.state
      const file = path.join(directory, "server.json")
      const temp = file + "." + id + ".tmp"
      const address = { _tag: "TcpAddress" as const, hostname: server.url.hostname, port: Number(server.url.port) }
      yield* Effect.tryPromise({
        try: () => fs.mkdir(directory, { recursive: true }),
        catch: (cause) => new CliError({ message: String(cause) }),
      })
      yield* Effect.tryPromise({
        try: () =>
          fs.writeFile(
            temp,
            JSON.stringify({
              id,
              version: InstallationVersion,
              url: HttpServer.formatAddress(address),
              pid: process.pid,
            }),
            { mode: 0o600 },
          ),
        catch: (cause) => new CliError({ message: String(cause) }),
      })
      yield* Effect.tryPromise({
        try: () => fs.rename(temp, file),
        catch: (cause) => new CliError({ message: String(cause) }),
      })
    }

    yield* Effect.never
  }),
})
