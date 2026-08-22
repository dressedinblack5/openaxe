import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/layer-node-platform"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { PlanExitTool } from "./plan"
import { Session } from "@/session/session"
import { QuestionTool } from "./question"

import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { Database } from "@opencode-ai/core/database/database"
import { TodoWriteTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import type { Def, Descriptor, InferDef, Info } from "./tool"
import { init } from "./tool"
import { Config } from "@/config/config"
import { type ToolContext, type ToolDefinition } from "@opencode-ai/plugin"
import type { JSONSchema7, JSONSchema7Definition } from "@ai-sdk/provider"
import { Schema } from "effect"
import z from "zod"
import { Plugin } from "../plugin"
import { Provider } from "@/provider/provider"

import { WebSearchTool, webSearchEnabled } from "./websearch"

import { ShellTool } from "./shell/shell"
import { LspTool } from "./lsp"
import { DiscoveryCache } from "./discovery-cache"
import { Truncate } from "./truncate"
import { ApplyPatchTool } from "./apply_patch"
import { Glob } from "@opencode-ai/core/util/glob"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer, Context } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { AppProcess } from "@opencode-ai/core/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Format } from "../format"
import { InstanceState } from "@/effect/instance-state"
import { EffectBridge } from "@/effect/bridge"
import { Question } from "../question"
import { Todo } from "../session/todo"
import { LSP } from "@/lsp/lsp"
import { Instruction } from "../session/instruction"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Agent } from "../agent/agent"
import { Skill } from "../skill"
import { Permission } from "@/permission"
import { BackgroundJob } from "@/background/job"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Kanban } from "@opencode-ai/core/kanban/kanban"
import { FTSIndex } from "@opencode-ai/core/database/fts"
import { KanbanTool } from "./kanban"
import { SessionSearchTool } from "./session-search"
import { SkillWriteV1Tool } from "./skill-write"
import { ToolSearchTool } from "./tool-search"
import { KanbanSwarmTool } from "./kanban-swarm"

export { webSearchEnabled }

function pick(entries: BuiltinEntry[], id: string): Def {
  const found = entries.find((entry) => entry.def.id === id)
  if (!found) throw new Error(`builtin tool "${id}" is missing from the registry manifest`)
  return found.def
}

type TaskDef = InferDef<typeof TaskTool>
type ReadDef = InferDef<typeof ReadTool>

type BuiltinEntry = { def: Def; available?: Descriptor["available"] }

type State = {
  custom: Def[]
  builtin: BuiltinEntry[]
}

// Manifest position IS provider-visible tool order (Record insertion order
// reaches the model's tool list). Adding a tool = adding exactly one line here.
const manifest = [
  InvalidTool,
  QuestionTool,
  ReadTool,
  GlobTool,
  GrepTool,
  EditTool,
  WriteTool,
  TaskTool,
  WebFetchTool,
  TodoWriteTool,
  WebSearchTool,
  SkillTool,
  ApplyPatchTool,
  LspTool,
  ShellTool,
  KanbanTool,
  KanbanSwarmTool,
  SessionSearchTool,
  SkillWriteV1Tool,
  ToolSearchTool,
  PlanExitTool,
]

export interface Interface {
  readonly ids: () => Effect.Effect<string[]>
  readonly all: () => Effect.Effect<Def[]>
  readonly named: () => Effect.Effect<{ task: TaskDef; read: ReadDef }>
  readonly tools: (model: { providerID: ProviderV2.ID; modelID: ModelV2.ID; agent: Agent.Info }) => Effect.Effect<Def[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ToolRegistry") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const plugin = yield* Plugin.Service
    const agents = yield* Agent.Service
    const truncate = yield* Truncate.Service
    const flags = yield* RuntimeFlags.Service

    const infos: Info[] = yield* Effect.all(manifest)
    const defs: Def[] = yield* Effect.forEach(infos, (info) => init(info))
    // Zip descriptors back onto their resolved defs by index — Effect.all
    // returns fresh objects, the attached `available` lives on the manifest.
    const entries: BuiltinEntry[] = defs.map((def, i) => ({ def, available: manifest[i].available }))

    const state = yield* InstanceState.make<State>(
      Effect.fn("ToolRegistry.state")(function* (ctx) {
        const custom: Def[] = []

        function fromPlugin(id: string, def: ToolDefinition): Def {
          // Plugin tools still expose Zod args publicly; keep that compatibility
          // boxed at the registry boundary and give the LLM the original JSON Schema.
          // Normalize missing args to `{}` once — pre-1.14.49 the code was
          // `z.object(def.args)` and Zod silently tolerated undefined (#27451, #27630).
          const args = def.args ?? {}
          const entries = Object.entries(args)
          const allZod = entries.every((entry) => isZodType(entry[1]))
          const zodParams = allZod ? z.object(args) : undefined
          const jsonSchema = zodParams ? zodJsonSchema(zodParams) : legacyJsonSchema(entries)
          const parameters = zodParams
            ? Schema.declare<unknown>((u): u is unknown => zodParams.safeParse(u).success)
            : Schema.Unknown
          return {
            id,
            parameters,
            jsonSchema,
            description: def.description,
            execute: (args, toolCtx) =>
              Effect.gen(function* () {
                // Bridge the host's Effect-based `ask` into a Promise-returning
                // function for the plugin to make sure context persists
                const bridge = yield* EffectBridge.make()
                const pluginCtx: ToolContext = {
                  ...toolCtx,
                  ask: (req) => bridge.promise(toolCtx.ask(req)),
                  directory: ctx.directory,
                  worktree: ctx.worktree,
                }
                const result = yield* Effect.promise(() => def.execute(args as z.infer<z.ZodObject<z.ZodRawShape>>, pluginCtx))
                const output = typeof result === "string" ? result : result.output
                const metadata = typeof result === "string" ? {} : (result.metadata ?? {})
                const attachments = typeof result === "string" ? undefined : result.attachments
                const info = yield* agents.get(toolCtx.agent)
                const out = yield* truncate.output(output, {}, info)
                return {
                  title: typeof result === "string" ? "" : (result.title ?? ""),
                  output: out.truncated ? out.content : output,
                  attachments,
                  metadata: {
                    ...metadata,
                    truncated: out.truncated,
                    ...(out.truncated && { outputPath: out.outputPath }),
                  },
                }
              }).pipe(
                Effect.withSpan("execute", {
                  attributes: {
                    "tool.name": id,
                    "session.id": toolCtx.sessionID,
                    "message.id": toolCtx.messageID,
                    ...(toolCtx.callID ? { "tool.call_id": toolCtx.callID } : {}),
                  },
                }),
              ),
          }
        }

        function registerToolExports(mod: Record<string, unknown>, match: string) {
          const namespace = path.basename(match, path.extname(match))
          for (const [id, def] of Object.entries(mod)) {
            if (!isPluginTool(def)) continue
            custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
          }
        }

        const dirs = yield* config.directories()
        const cache = yield* DiscoveryCache.load()

        const isCovered = (
          prev: DiscoveryCache.DirCache | undefined,
          subdirs: Record<string, DiscoveryCache.FileSignature | undefined>,
        ) => Boolean(prev && DiscoveryCache.sameSubdirs(prev.subdirs, subdirs))

        // Per-directory discovery backed by a disk-memoized manifest. On a
        // warm run (the `tool`/`tools` subdirectories are unchanged since the
        // last scan and the files are unchanged) the glob and the imports of
        // files that do not register tools are skipped entirely.
        const plans: Array<{
          dir: string
          subdirs: Record<string, DiscoveryCache.FileSignature | undefined>
          files: string[]
        }> = []
        const updated: Record<string, DiscoveryCache.DirCache> = {}
        let anyMatches = false

        for (const dir of dirs) {
          const prev = cache.dirs[dir]
          const subdirs: Record<string, DiscoveryCache.FileSignature | undefined> = {}
          for (const sub of DiscoveryCache.SCAN_SUBDIRS) {
            subdirs[sub] = DiscoveryCache.statPath(path.join(dir, sub))
          }
          const covered = isCovered(prev, subdirs)
          let files: string[]
          if (covered && prev) {
            files = Object.keys(prev.files)
          } else {
            try {
              files = Glob.scanSync("{tool,tools}/*.{js,ts}", {
                cwd: dir,
                absolute: true,
                dot: true,
                symlink: true,
              })
            } catch {
              files = []
            }
          }
          if (files.length) anyMatches = true
          plans.push({ dir, subdirs, files })
        }

        if (anyMatches) yield* config.waitForDependencies()

        for (const plan of plans) {
          const prev = cache.dirs[plan.dir]
          const files: Record<string, DiscoveryCache.FileCacheEntry> = prev ? { ...prev.files } : {}
          // Anything that touched the manifest (a glob, a refresh, a drop) is
          // persisted so the next run can take the warm path.
          let dirty = !isCovered(prev, plan.subdirs)

          for (const match of plan.files) {
            const sig = DiscoveryCache.statPath(match)
            if (!sig) {
              // The file disappeared since the last scan — drop it.
              if (files[match]) {
                delete files[match]
                dirty = true
              }
              continue
            }

            const cached = files[match]
            if (cached && DiscoveryCache.sameSignature(cached, sig)) {
              // Unchanged file. Files that do not register tools are skipped
              // without importing (the Hermes win: no need to import every
              // candidate to learn whether it registers tools). Tool files
              // still import — their `execute`/zod `args` are runtime values
              // a JSON manifest cannot rehydrate — but a failed import never
              // records a success verdict, so it retries after the grace
              // window instead of permanently poisoning the cache.
              if (!cached.exports.length && cached.failedAt === undefined) continue
              if (cached.failedAt !== undefined && Date.now() - cached.failedAt < DiscoveryCache.FAILURE_GRACE_MS) {
                continue
              }
              const mod = yield* importTool(match)
              if (!mod) {
                files[match] = { ...cached, failedAt: Date.now() }
                dirty = true
                continue
              }
              if (cached.failedAt !== undefined) {
                files[match] = { ...sig, exports: collectToolExports(mod) }
                dirty = true
              }
              registerToolExports(mod, match)
              continue
            }

            // New or changed file — import and refresh the manifest entry.
            const mod = yield* importTool(match)
            if (!mod) {
              // Keep the previous entry (if any) and mark the failure so the
              // file retries after the grace window instead of being dropped.
              files[match] = { ...sig, exports: cached?.exports ?? [], failedAt: Date.now() }
              dirty = true
              continue
            }
            files[match] = { ...sig, exports: collectToolExports(mod) }
            dirty = true
            registerToolExports(mod, match)
          }

          if (dirty && (prev || Object.keys(files).length > 0)) {
            updated[plan.dir] = { subdirs: plan.subdirs, files }
          }
        }

        if (Object.keys(updated).length) yield* DiscoveryCache.save(updated)

        const plugins = yield* plugin.list()
        for (const p of plugins) {
          for (const [id, def] of Object.entries(p.tool ?? {})) {
            custom.push(fromPlugin(id, def))
          }
        }

        const select = { flags }
        return {
          custom,
          builtin: entries.filter((entry) => entry.available?.(select) ?? true),
        }
      }),
    )

    const all: Interface["all"] = Effect.fn("ToolRegistry.all")(function* () {
      const s = yield* InstanceState.get(state)
      return [...s.builtin.map((entry) => entry.def), ...s.custom] as Def[]
    })

    const ids: Interface["ids"] = Effect.fn("ToolRegistry.ids")(function* () {
      return (yield* all()).map((tool) => tool.id)
    })

    const tools: Interface["tools"] = Effect.fn("ToolRegistry.tools")(function* (input) {
      const s = yield* InstanceState.get(state)
      const select = { flags, providerID: input.providerID, modelID: input.modelID }
      const filtered: Def[] = [
        ...s.builtin.filter((entry) => entry.available?.(select) ?? true).map((entry) => entry.def),
        ...s.custom,
      ]

      return yield* Effect.forEach(
        filtered,
        Effect.fnUntraced(function* (tool: Def) {
          const output = {
            description: tool.description,
            parameters: tool.parameters,
            jsonSchema: tool.jsonSchema,
          }
          yield* plugin.trigger("tool.definition", { toolID: tool.id }, output)
          const jsonSchema =
            output.parameters === tool.parameters || output.jsonSchema !== tool.jsonSchema
              ? output.jsonSchema
              : undefined
          const extra = tool.describe ? yield* tool.describe(input.agent) : undefined
          return {
            id: tool.id,
            description: [output.description, extra].filter(Boolean).join("\n"),
            parameters: output.parameters,
            jsonSchema,
            execute: (args: unknown, toolCtx: unknown) => tool.execute(args as never, toolCtx as never),
            formatValidationError: (params: unknown) => tool.formatValidationError?.(params) ?? String(params),
          }
        }),
        { concurrency: "unbounded" },
      )
    })

    const named: Interface["named"] = Effect.fn("ToolRegistry.named")(function* () {
      const s = yield* InstanceState.get(state)
      return {
        task: pick(s.builtin, TaskTool.id) as TaskDef,
        read: pick(s.builtin, ReadTool.id) as ReadDef,
      }
    })

    return Service.of({ ids, all, named, tools })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer
    .pipe(
      Layer.provide(Config.defaultLayer),
      Layer.provide(Plugin.defaultLayer),
      Layer.provide(Question.defaultLayer),
      Layer.provide(Todo.defaultLayer),
      Layer.provide(Skill.defaultLayer),
      Layer.provide(Agent.defaultLayer),
      Layer.provide(Session.defaultLayer),
      Layer.provide(BackgroundJob.defaultLayer),
      Layer.provide(Provider.defaultLayer),
      Layer.provide(LSP.defaultLayer),
      Layer.provide(Instruction.defaultLayer),
      Layer.provide(FSUtil.defaultLayer),
      Layer.provide(EventV2Bridge.defaultLayer),
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(Format.defaultLayer),
      Layer.provide(CrossSpawnSpawner.defaultLayer),
      Layer.provide(AppProcess.defaultLayer),
      Layer.provide(Truncate.defaultLayer),
      Layer.provide(Kanban.defaultLayer),
      Layer.provide(FTSIndex.defaultLayer),
    )
    .pipe(Layer.provide(Database.defaultLayer), Layer.provide(RuntimeFlags.defaultLayer)),
)

function isZodType(value: unknown): value is z.ZodType {
  return typeof value === "object" && value !== null && "_zod" in value
}

function isPluginTool(value: unknown): value is ToolDefinition {
  return typeof value === "object" && value !== null && "args" in value && "description" in value && "execute" in value
}

function importTool(file: string): Effect.Effect<Record<string, unknown> | undefined> {
  return Effect.match(
    Effect.tryPromise(() => import(pathToFileURL(file).href)),
    {
      onFailure: (error) => {
        // A broken tool file must never fail registry initialization or poison
        // the discovery cache: log once and let the cached entry retry later.
        console.error(`[tool.registry] failed to import custom tool ${file}:`, error)
        return undefined
      },
      onSuccess: (mod) => mod as Record<string, unknown>,
    },
  )
}

function collectToolExports(mod: Record<string, unknown>) {
  return Object.entries(mod)
    .filter(([, def]) => isPluginTool(def))
    .map(([id]) => id)
}

function isJsonSchemaDefinition(value: unknown): value is JSONSchema7Definition {
  return typeof value === "boolean" || (typeof value === "object" && value !== null && !Array.isArray(value))
}

function legacyJsonSchema(entries: [string, unknown][]): JSONSchema7 {
  const properties = Object.fromEntries(
    entries.filter((entry): entry is [string, JSONSchema7Definition] => isJsonSchemaDefinition(entry[1])),
  )
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
  }
}

function zodJsonSchema(schema: z.ZodType): JSONSchema7 {
  const result = normalizeZodJsonSchema(z.toJSONSchema(schema, { io: "input", metadata: zodMetadataRegistry(schema) }))
  if (!isJsonSchemaObject(result)) throw new Error("plugin tool Zod schema produced a non-object JSON Schema")
  const { $defs, ...rest } = result
  return (
    $defs && isJsonSchemaObject($defs) ? { ...rest, definitions: $defs as JSONSchema7["definitions"] } : rest
  ) as JSONSchema7
}

function zodMetadataRegistry(schema: z.ZodType) {
  const registry = z.registry<Record<string, unknown>>()
  const seen = new WeakSet<object>()
  const collect = (value: unknown) => {
    if (typeof value !== "object" || value === null) return
    if (seen.has(value)) return
    seen.add(value)

    if (isZodType(value)) {
      const metadata = typeof value.meta === "function" ? value.meta() : undefined
      const description = typeof value.description === "string" ? value.description : undefined
      const merged = {
        ...(metadata && typeof metadata === "object" ? metadata : {}),
        ...(description ? { description } : {}),
      }
      if (Object.keys(merged).length) registry.add(value, merged)
      collect(value._zod.def)
      return
    }

    for (const item of Object.values(value)) collect(item)
  }
  collect(schema)
  return registry
}

function normalizeZodJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeZodJsonSchema(item))
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry) =>
        !((entry[0] === "exclusiveMaximum" || entry[0] === "exclusiveMinimum") && typeof entry[1] === "boolean"),
      )
      .map(([key, item]) => [key, normalizeZodJsonSchema(item)]),
  )
}

function isJsonSchemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export const node = LayerNode.make(layer.pipe(Layer.provide(Ripgrep.defaultLayer)), [
  Config.node,
  Plugin.node,
  Question.node,
  Todo.node,
  Agent.node,
  Skill.node,
  Session.node,
  BackgroundJob.node,
  Provider.node,
  LSP.node,
  Instruction.node,
  FSUtil.node,
  EventV2Bridge.node,
  httpClient,
  AppProcess.node,
  CrossSpawnSpawner.node,
  Format.node,
  Truncate.node,
  RuntimeFlags.node,
  Database.node,
  Kanban.node,
  FTSIndex.node,
])

export * as ToolRegistry from "./registry"
