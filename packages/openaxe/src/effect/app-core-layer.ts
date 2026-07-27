import { Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { layer } from "@opencode-ai/core/observability"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Memory } from "@opencode-ai/core/memory"
import { Database } from "@opencode-ai/core/database/database"
import { Auth } from "@/auth"
import { Account } from "@/account/account"
import { Config } from "@/config/config"
import { Git } from "@/git"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Storage } from "@/storage/storage"
import { Plugin } from "@/plugin"
import { Npm } from "@opencode-ai/core/npm"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceLayer } from "@/project/instance-layer"

/**
 * Minimal service layer for headless commands (serve, etc.).
 * Excludes heavy session services (LLM, LSP, MCP, ToolRegistry, Provider, etc.)
 * that add ~200MB and are only needed for interactive sessions.
 */
export const CoreLayer = Layer.mergeAll(
  Npm.defaultLayer,
  FSUtil.defaultLayer,
  Database.defaultLayer,
  Auth.defaultLayer,
  Account.defaultLayer,
  Config.defaultLayer,
  Git.defaultLayer,
  Storage.defaultLayer,
  Plugin.defaultLayer,
  RuntimeFlags.defaultLayer,
  EventV2Bridge.defaultLayer,
  Memory.defaultLayer,
).pipe(
  Layer.provideMerge(Ripgrep.defaultLayer),
  Layer.provideMerge(InstanceLayer.layer),
  Layer.provideMerge(layer),
  Layer.provideMerge(NodeFileSystem.layer),
)

export type CoreServices = typeof CoreLayer
