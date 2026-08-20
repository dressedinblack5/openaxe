export interface SpeedTier {
  id: string
  label: string
  request: {
    body?: Record<string, unknown>
    headers?: Record<string, string>
  }
}

export interface ProviderSpeed {
  models?: string[]
  tiers: SpeedTier[]
}

export const PROVIDER_SPEEDS: Record<string, ProviderSpeed> = {
  openai: {
    tiers: [{ id: "fast", label: "Fast", request: { body: { service_tier: "fast" } } }],
  },
  anthropic: {
    models: ["claude-opus-5", "claude-opus-4-8"],
    tiers: [
      {
        id: "fast",
        label: "Fast",
        request: {
          body: { speed: "fast" },
          headers: { "anthropic-beta": "fast-mode-2026-02-01" },
        },
      },
      {
        id: "standard",
        label: "Standard",
        request: { body: { speed: "standard" } },
      },
    ],
  },
  xai: {
    tiers: [{ id: "priority", label: "Priority", request: { body: { service_tier: "priority" } } }],
  },
  groq: {
    tiers: [
      { id: "on_demand", label: "On demand", request: { body: { service_tier: "on_demand" } } },
      { id: "flex", label: "Flex", request: { body: { service_tier: "flex" } } },
      { id: "performance", label: "Performance", request: { body: { service_tier: "performance" } } },
    ],
  },
  openrouter: {
    tiers: [
      { id: "flex", label: "Flex", request: { body: { service_tier: "flex" } } },
      { id: "priority", label: "Priority", request: { body: { service_tier: "priority" } } },
    ],
  },
}

export * as ProviderSpeed from "./provider-speed"