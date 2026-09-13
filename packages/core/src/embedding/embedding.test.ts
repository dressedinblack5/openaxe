import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { ConfigEmbedding } from "../config/embedding"
import { Embedding } from "./embedding"

const vector = (dimension: number, value = 0.5) => Array.from({ length: dimension }, () => value)

const fakeHttp = (body: unknown, status = 200) =>
  HttpClient.make((request) =>
    Effect.sync(() => HttpClientResponse.fromWeb(request, new Response(JSON.stringify(body), { status }))),
  )

const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect)
const failureOf = async <A>(effect: Effect.Effect<A, unknown>) => {
  const exit = await Effect.runPromise(effect.pipe(Effect.exit))
  if (!Exit.isFailure(exit)) throw new Error("expected failure")
  return Cause.squash(exit.cause)
}

describe("OllamaEmbeddingProvider", () => {
  test("parses a canned /api/embed response", async () => {
    const provider = Embedding.makeOllamaProvider(fakeHttp({ embeddings: [vector(768), vector(768)] }))
    const result = await run(provider.embed(["hello", "world"]))
    expect(result.dimension).toBe(768)
    expect(result.model).toBe("nomic-embed-text")
    expect(result.vectors).toHaveLength(2)
    expect(result.vectors[0]).toHaveLength(768)
  })

  test("fails with InvalidDimension when the vector dimension mismatches the model", async () => {
    const provider = Embedding.makeOllamaProvider(fakeHttp({ embeddings: [vector(512)] }))
    expect(await failureOf(provider.embed(["hello"]))).toEqual({
      _tag: "InvalidDimension",
      expected: 768,
      actual: 512,
      model: "nomic-embed-text",
    })
  })

  test("fails with InvalidResponse on non-2xx status", async () => {
    const provider = Embedding.makeOllamaProvider(fakeHttp({}, 500))
    expect(await failureOf(provider.embed(["hello"]))).toMatchObject({ _tag: "InvalidResponse" })
  })

  test("fails with InvalidResponse on malformed body", async () => {
    const provider = Embedding.makeOllamaProvider(fakeHttp({ unexpected: [] }))
    expect(await failureOf(provider.embed(["hello"]))).toMatchObject({ _tag: "InvalidResponse" })
  })
})

describe("OpenAIEmbeddingProvider", () => {
  test("parses a canned /v1/embeddings response and sorts by index", async () => {
    const provider = Embedding.makeOpenAIProvider(
      fakeHttp({
        data: [
          { index: 1, embedding: vector(1536, 0.1) },
          { index: 0, embedding: vector(1536, 0.9) },
        ],
        usage: { prompt_tokens: 7 },
      }),
      { apiKey: "test-key" },
    )
    const result = await run(provider.embed(["hello"]))
    expect(result.dimension).toBe(1536)
    expect(result.model).toBe("text-embedding-3-small")
    expect(result.vectors).toHaveLength(2)
    expect(result.vectors[0][0]).toBe(0.9)
    expect(result.vectors[1][0]).toBe(0.1)
    expect(result.usage?.promptTokens).toBe(7)
  })
})

describe("Embedding layer", () => {
  const makeLayer = (config: ConfigEmbedding.Config, http: HttpClient.HttpClient) =>
    Embedding.layer.pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
      Layer.provide(Layer.succeed(ConfigEmbedding.ConfigService, ConfigEmbedding.ConfigService.of(config))),
    )

  test("wires config provider to the Ollama implementation", async () => {
    const layer = makeLayer({ provider: "ollama" }, fakeHttp({ embeddings: [vector(768)] }))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* Embedding.Service
        return yield* service.embed(["hello"])
      }).pipe(Effect.provide(layer)),
    )
    expect(result.dimension).toBe(768)
  })

  test("wires config provider to the OpenAI implementation", async () => {
    const layer = makeLayer(
      { provider: "openai", apiKey: "test-key" },
      fakeHttp({ data: [{ index: 0, embedding: vector(1536) }], usage: { prompt_tokens: 2 } }),
    )
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* Embedding.Service
        return yield* service.embed(["hello"])
      }).pipe(Effect.provide(layer)),
    )
    expect(result.dimension).toBe(1536)
  })

  test("custom provider fails with UnsupportedProvider", async () => {
    const layer = makeLayer({ provider: "custom", model: "my-model" }, fakeHttp({ embeddings: [] }))
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* Embedding.Service
        return yield* service.embed(["hello"]).pipe(Effect.exit)
      }).pipe(Effect.provide(layer)),
    )
    if (!Exit.isFailure(exit)) throw new Error("expected failure")
    expect(Cause.squash(exit.cause)).toMatchObject({ _tag: "UnsupportedProvider" })
  })
})
