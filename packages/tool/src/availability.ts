import { Effect, HashMap, Ref, Context, Layer } from "effect"
import type { ToolDefinition, AvailabilityInput, AvailabilityKey, Schema } from "./types"
import type { ProviderV2 } from "@opencode-ai/core/provider"
import type { ModelV2 } from "@opencode-ai/core/model"
import type { AgentV2 as Agent } from "@opencode-ai/core/agent"
import type { RuntimeFlags } from "./types"

/**
 * Availability filtering with memoization per (flags, providerID, modelID, agentID) tuple
 */
export interface AvailabilityServiceInterface {
  readonly check: (
    tool: ToolDefinition,
    input: { providerID: ProviderV2.ID; modelID: ModelV2.ID; agent: Agent.Info; flags: RuntimeFlags.Info }
  ) => Effect.Effect<boolean>
  readonly filter: (
    tools: ReadonlyArray<ToolDefinition>,
    input: { providerID: ProviderV2.ID; modelID: ModelV2.ID; agent: Agent.Info; flags: RuntimeFlags.Info }
  ) => Effect.Effect<ReadonlyArray<ToolDefinition>>
  readonly clearCache: () => Effect.Effect<void>
}

export class AvailabilityService extends Context.Service<AvailabilityService, AvailabilityServiceInterface>()("@openaxe/ToolAvailability") {}

const makeAvailabilityKey = (input: AvailabilityInput): AvailabilityKey => ({
  flagsHash: hashFlags(input.flags),
  providerID: input.providerID,
  modelID: input.modelID,
  agentID: input.agentID,
})

function hashFlags(flags: RuntimeFlags.Info): string {
  // Deterministic hash of flags object
  const sorted = Object.entries(flags).sort(([a], [b]) => a.localeCompare(b))
  return sorted.map(([k, v]) => `${k}=${String(v)}`).join("|")
}

function keyToString(key: AvailabilityKey): string {
  return `${key.flagsHash}|${key.providerID ?? "none"}|${key.modelID ?? "none"}|${key.agentID ?? "none"}`
}

export const AvailabilityLive = Layer.effect(
  AvailabilityService,
  Effect.gen(function* () {
    const cache = yield* Ref.make(HashMap.empty<string, boolean>())

    const check = (
      tool: ToolDefinition,
      input: { providerID: ProviderV2.ID; modelID: ModelV2.ID; agent: Agent.Info; flags: RuntimeFlags.Info }
    ): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        const availInput: AvailabilityInput = {
          flags: input.flags,
          providerID: input.providerID,
          modelID: input.modelID,
          agentID: input.agent.id,
        }
        const key = makeAvailabilityKey(availInput)
        const keyStr = keyToString(key)

        const cached = HashMap.get(yield* Ref.get(cache), keyStr)
        if (cached._tag === "Some") return cached.value

        const available = isAvailable(tool, availInput)
        yield* Ref.update(cache, (m) => HashMap.set(m, keyStr, available))
        return available
      })

    const filter = (
      tools: ReadonlyArray<ToolDefinition>,
      input: { providerID: ProviderV2.ID; modelID: ModelV2.ID; agent: Agent.Info; flags: RuntimeFlags.Info }
    ): Effect.Effect<ReadonlyArray<ToolDefinition>> =>
      Effect.gen(function* () {
        return yield* Effect.filter(tools, (tool) => check(tool, input))
      })

    const clearCache = (): Effect.Effect<void> =>
      Ref.set(cache, HashMap.empty())

    return { check, filter, clearCache }
  })
)

/**
 * Static availability check (doesn't use cache)
 */
export const isAvailable = <
  P extends Schema.Schema<unknown>,
  O extends Schema.Schema<unknown>
>(
  tool: ToolDefinition<P, O>,
  input: AvailabilityInput
): boolean => {
  const runtimeAvail = tool.availability
  return typeof runtimeAvail === "function" ? runtimeAvail(input) : true
}

export * as Availability from "./availability"