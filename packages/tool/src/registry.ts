import { Effect, Layer, Context, Ref, HashMap } from "effect"
import type { ToolDefinition, ToolRegistryInterface, ToolCall, ToolExecutionResult, ToolContext, ToolFailure, ToolRegistrationError } from "./types"
import type { ProviderV2 } from "@opencode-ai/core/provider"
import type { ModelV2 } from "@opencode-ai/core/model"
import type { AgentV2 as Agent } from "@opencode-ai/core/agent"
import { AvailabilityService } from "./availability"
import { validateName } from "./tool"
import { Schema } from "effect"
import { AvailabilityLive } from "./availability"

/**
 * ToolRegistry Service - Unified registry with CLI-compatible API
 */
export interface ToolRegistryInterface {
  register: <P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>(
    def: ToolDefinition<P, O>
  ) => Effect.Effect<void, ToolRegistrationError>
  get: <P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>(
    id: string
  ) => Effect.Effect<ToolDefinition<P, O> | undefined>
  list: () => Effect.Effect<ReadonlyArray<ToolDefinition>>
  tools: (model: { providerID: ProviderV2.ID; modelID: ModelV2.ID; agent: Agent.Info }) => Effect.Effect<ReadonlyArray<ToolDefinition>>
  named: () => Effect.Effect<{ task: ToolDefinition; read: ToolDefinition }>
  settle: <P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>(
    tool: ToolDefinition<P, O>,
    call: ToolCall,
    context: ToolContext
  ) => Effect.Effect<ToolExecutionResult, ToolFailure>
}

export class ToolRegistryService extends Context.Service<ToolRegistryService, ToolRegistryInterface>()("@openaxe/ToolRegistry") {}

/**
 * Internal state
 */
interface RegistryState {
  readonly tools: HashMap.HashMap<string, ToolDefinition>
  readonly named: { task: ToolDefinition; read: ToolDefinition } | null
}

/**
 * Create the ToolRegistry layer
 */
export const ToolRegistryLive = Layer.effect(
  ToolRegistryService,
  Effect.gen(function* () {
    const availability = yield* AvailabilityService
    const state = yield* Ref.make<RegistryState>({
      tools: HashMap.empty(),
      named: null,
    })

    const register = <P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>(
      def: ToolDefinition<P, O>
    ): Effect.Effect<void, ToolRegistrationError> =>
      Effect.gen(function* () {
        yield* validateName(def.id)
        yield* Ref.update(state, (s) => ({
          ...s,
          tools: HashMap.set(s.tools, def.id, def),
        }))
      })

    const get = <P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>(
      id: string
    ): Effect.Effect<ToolDefinition<P, O> | undefined> =>
      Effect.gen(function* () {
        const s = yield* Ref.get(state)
        const tool = HashMap.get(s.tools, id)
        return tool._tag === "Some"
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- stored tool compatible with requested types
          ? (tool.value as unknown as ToolDefinition<P, O>)
          : undefined
      })

    const list = (): Effect.Effect<ReadonlyArray<ToolDefinition>> =>
      Effect.gen(function* () {
        const s = yield* Ref.get(state)
        return Array.from(HashMap.values(s.tools))
      })

    const tools = (model: { providerID: ProviderV2.ID; modelID: ModelV2.ID; agent: Agent.Info }): Effect.Effect<ReadonlyArray<ToolDefinition>> =>
      Effect.gen(function* () {
        const s = yield* Ref.get(state)
        const allTools = Array.from(HashMap.values(s.tools))
        return yield* availability.filter(allTools, {
          providerID: model.providerID,
          modelID: model.modelID,
          agent: model.agent,
          flags: {},
        })
      })

    const named = (): Effect.Effect<{ task: ToolDefinition; read: ToolDefinition }> =>
      Effect.gen(function* () {
        const s = yield* Ref.get(state)
        if (s.named) return s.named

        const task = yield* get("task")
        const read = yield* get("read")
        if (!task || !read) throw new Error("Named tools 'task' and 'read' not registered")

        const namedTools = { task, read }
        yield* Ref.update(state, (st) => ({ ...st, named: namedTools }))
        return namedTools
      })

    const settle = <P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>(
      tool: ToolDefinition<P, O>,
      call: ToolCall,
      context: ToolContext
    ): Effect.Effect<ToolExecutionResult, ToolFailure> =>
      Effect.gen(function* () {
        // Import locally to avoid circular dependency
        const { settle: toolSettle } = yield* Effect.promise(() => import("./tool"))
        return yield* toolSettle(tool, call, context)
      })

    return { register, get, list, tools, named, settle }
  })
)

/**
 * Default layer with availability
 */
export const ToolRegistryDefault = ToolRegistryLive.pipe(Layer.provide(AvailabilityLive))

export * as ToolRegistry from "./registry"