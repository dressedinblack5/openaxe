export * as Embedding from "./embedding"

import { Context, Duration, Effect, Layer, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { ConfigEmbedding } from "../config/embedding"

export interface EmbeddingResult {
  readonly vectors: number[][]
  readonly dimension: number
  readonly model: string
  readonly usage?: { readonly promptTokens: number }
}

export type EmbeddingError =
  | { readonly _tag: "ProviderUnreachable"; readonly message: string }
  | { readonly _tag: "InvalidResponse"; readonly message: string }
  | { readonly _tag: "InvalidDimension"; readonly expected: number; readonly actual: number; readonly model: string }
  | { readonly _tag: "UnsupportedProvider"; readonly message: string }

export interface EmbeddingProvider {
  readonly model: string
  readonly dimension: number
  readonly embed: (texts: readonly string[]) => Effect.Effect<EmbeddingResult, EmbeddingError>
}

export interface Interface {
  readonly provider: EmbeddingProvider
  readonly embed: (texts: readonly string[]) => Effect.Effect<EmbeddingResult, EmbeddingError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Embedding") {}

/** Expected dimensions for the models each provider knows; unknown models skip validation. */
const DIMENSIONS: Readonly<Record<string, number>> = {
  "nomic-embed-text": 768,
  "text-embedding-3-small": 1536,
}

const unreachable = (error: unknown): EmbeddingError => ({
  _tag: "ProviderUnreachable",
  message: error instanceof Error ? error.message : String(error),
})

const invalidResponse = (error: unknown): EmbeddingError => ({
  _tag: "InvalidResponse",
  message: error instanceof Error ? error.message : String(error),
})

const embed = (
  http: HttpClient.HttpClient,
  buildRequest: (texts: readonly string[]) => HttpClientRequest.HttpClientRequest,
  decode: (body: string) => Effect.Effect<{ readonly vectors: number[][]; readonly usage?: { promptTokens: number } }, unknown>,
  model: string,
  expected: number | undefined,
): ((texts: readonly string[]) => Effect.Effect<EmbeddingResult, EmbeddingError>) =>
  Effect.fn("Embedding.embed")(function* (texts: readonly string[]) {
    const request = buildRequest(texts)
    const response = yield* http
      .execute(request)
      .pipe(Effect.timeout(Duration.seconds(30)), Effect.mapError(unreachable))
    if (response.status < 200 || response.status >= 300)
      return yield* Effect.fail<EmbeddingError>({ _tag: "InvalidResponse", message: `HTTP ${response.status}` })
    const body = yield* response.text.pipe(Effect.mapError(unreachable))
    const parsed = yield* decode(body).pipe(Effect.mapError(invalidResponse))
    if (expected !== undefined) {
      for (const vector of parsed.vectors) {
        if (vector.length !== expected)
          return yield* Effect.fail<EmbeddingError>({ _tag: "InvalidDimension", expected, actual: vector.length, model })
      }
    }
    return {
      vectors: parsed.vectors,
      dimension: expected ?? parsed.vectors[0]?.length ?? 0,
      model,
      usage: parsed.usage,
    }
  })

export function makeOllamaProvider(http: HttpClient.HttpClient, config: ConfigEmbedding.Config = {}): EmbeddingProvider {
  const model = config.model ?? "nomic-embed-text"
  const baseUrl = (config.baseUrl ?? "http://localhost:11434").replace(/\/+$/, "")
  const expected = DIMENSIONS[model]

  const OllamaResponse = Schema.Struct({
    embeddings: Schema.Array(Schema.Array(Schema.Number)),
  })
  const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(OllamaResponse))

  return {
    model,
    dimension: expected ?? 0,
    embed: embed(
      http,
      (texts) =>
        HttpClientRequest.post(`${baseUrl}/api/embed`).pipe(HttpClientRequest.bodyJsonUnsafe({ model, input: texts })),
      (body) =>
        Effect.map(decode(body), (value) => ({ vectors: value.embeddings.map((vector) => [...vector]) })),
      model,
      expected,
    ),
  }
}

export function makeOpenAIProvider(http: HttpClient.HttpClient, config: ConfigEmbedding.Config = {}): EmbeddingProvider {
  const model = config.model ?? "text-embedding-3-small"
  const baseUrl = (config.baseUrl ?? "https://api.openai.com").replace(/\/+$/, "")
  const expected = DIMENSIONS[model]

  const OpenAIResponse = Schema.Struct({
    data: Schema.Array(
      Schema.Struct({
        index: Schema.Number,
        embedding: Schema.Array(Schema.Number),
      }),
    ),
    usage: Schema.Struct({ prompt_tokens: Schema.Number }).pipe(Schema.optional),
  })
  const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(OpenAIResponse))

  return {
    model,
    dimension: expected ?? 0,
    embed: embed(
      http,
      (texts) =>
        HttpClientRequest.post(`${baseUrl}/v1/embeddings`).pipe(
          HttpClientRequest.setHeaders(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          HttpClientRequest.bodyJsonUnsafe({ model, input: texts }),
        ),
      (body) =>
        Effect.map(decode(body), (value) => ({
          vectors: [...value.data].sort((a, b) => a.index - b.index).map((item) => [...item.embedding]),
          usage: value.usage ? { promptTokens: value.usage.prompt_tokens } : undefined,
        })),
      model,
      expected,
    ),
  }
}

const makeProvider = (config: ConfigEmbedding.Config, http: HttpClient.HttpClient): EmbeddingProvider => {
  switch (config.provider ?? "ollama") {
    case "openai":
      return makeOpenAIProvider(http, config)
    case "custom":
      return {
        model: config.model ?? "",
        dimension: 0,
        embed: () =>
          Effect.fail<EmbeddingError>({
            _tag: "UnsupportedProvider",
            message: `custom embedding provider "${config.model ?? ""}" has no implementation`,
          }),
      }
    default:
      return makeOllamaProvider(http, config)
  }
}

export const make = (config: ConfigEmbedding.Config, http: HttpClient.HttpClient) =>
  Effect.sync(() => {
    const provider = makeProvider(config, http)
    return Service.of({ provider, embed: provider.embed })
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const config = yield* ConfigEmbedding.ConfigService
    return yield* make(config, http)
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(ConfigEmbedding.defaultConfigLayer),
  Layer.provide(FetchHttpClient.layer),
)
