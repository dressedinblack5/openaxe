#!/usr/bin/env bun

import { runMain } from "@effect/platform-node/NodeRuntime";
import { layer } from "@effect/platform-node/NodeServices";
import { provide, scoped } from "effect/Effect";
import { Commands } from "./commands/commands"
import { Runtime } from "./framework/runtime"
import { Daemon } from "./services/daemon"

const Handlers = Runtime.handlers(Commands, {
  $:  async () => import("./commands/handlers/default"),
  api:  async () => import("./commands/handlers/api"),
  debug: {
    agents:  async () => import("./commands/handlers/debug/agents"),
  },
  migrate:  async () => import("./commands/handlers/migrate"),
  service: {
    start:  async () => import("./commands/handlers/service/start"),
    restart:  async () => import("./commands/handlers/service/restart"),
    status:  async () => import("./commands/handlers/service/status"),
    stop:  async () => import("./commands/handlers/service/stop"),
    password:  async () => import("./commands/handlers/service/password"),
  },
  serve:  async () => import("./commands/handlers/serve"),
})

Runtime.run(Commands, Handlers, { version: "local" }).pipe(
  provide(Daemon.defaultLayer),
  provide(layer),
  scoped,
  runMain,
)
