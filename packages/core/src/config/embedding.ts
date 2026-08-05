export * as ConfigEmbedding from "./embedding"

import { Context, Layer, Schema } from "effect"

export const Provider = Schema.Literals(["ollama", "openai", "custom"])
export type Provider = typeof Provider.Type

export interface Config {
  readonly provider?: Provider
  readonly model?: string
  readonly baseUrl?: string
  readonly apiKey?: string
}

export class ConfigService extends Context.Service<ConfigService, Config>()("@opencode/v2/EmbeddingConfig") {}

const envProvider = (): Provider => {
  const value = process.env.OPENCODE_EMBEDDING_PROVIDER
  return value === "openai" || value === "custom" ? value : "ollama"
}

export const defaultConfigLayer = Layer.sync(ConfigService, () =>
  ConfigService.of({
    provider: envProvider(),
    model: process.env.OPENCODE_EMBEDDING_MODEL,
    baseUrl: process.env.OPENCODE_EMBEDDING_BASE_URL,
    apiKey: process.env.OPENCODE_EMBEDDING_API_KEY,
  }),
)
