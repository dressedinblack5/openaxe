import { Effect } from "effect"
import { define } from "../internal"
import { ProviderV2 } from "../../provider"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined
  const field = value[key]
  return typeof field === "string" ? field : undefined
}

// Exported for testing: intercepts Cortex-specific request/response quirks.
export function cortexFetch(upstream?: unknown) {
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (init?.body && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body)
        if ("max_tokens" in body) {
          body.max_completion_tokens = body.max_tokens
          delete body.max_tokens
          init = { ...init, body: JSON.stringify(body) }
        }
      } catch {}
    }

    const response = await (typeof upstream === "function" ? upstream : fetch)(url, init)

    // Cortex returns 400 "conversation complete" as a normal stop condition
    if (!response.ok && response.status === 400) {
      try {
        const body: unknown = await response.clone().json()
        const message = stringField(body, "message") || stringField(body, "error") || ""
        if (message.toLowerCase().includes("conversation complete")) {
          return new Response(
            JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "", role: "assistant" } }] }),
            { status: 200, headers: new Headers({ "content-type": "application/json" }) },
          )
        }
      } catch {}
    }

    // Cortex returns role:"" in streaming deltas; the AI SDK schema requires "assistant"
    if (response.body && response.headers.get("content-type")?.includes("text/event-stream")) {
      const reader = response.body.getReader()
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      const stream = new ReadableStream({
        async pull(ctrl) {
          const { done, value } = await reader.read()
          if (done) {
            ctrl.close()
            return
          }
          ctrl.enqueue(
            encoder.encode(decoder.decode(value, { stream: true }).replace(/"role"\s*:\s*""/g, '"role":"assistant"')),
          )
        },
        cancel() {
          void reader.cancel()
        },
      })
      return new Response(stream, { headers: response.headers, status: response.status })
    }

    return response
  }
}

export const SnowflakeCortexPlugin = define({
  id: "snowflake-cortex",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.aisdk.sdk(
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.make("snowflake-cortex")) return
        const token =
          process.env.SNOWFLAKE_CORTEX_TOKEN ??
          process.env.SNOWFLAKE_CORTEX_PAT ??
          (typeof evt.options.token === "string" ? evt.options.token : undefined) ??
          (typeof evt.options.apiKey === "string" ? evt.options.apiKey : undefined)
        if (evt.options.includeUsage !== false) evt.options.includeUsage = true
        const mod = yield* Effect.promise(async () => import("@ai-sdk/openai-compatible"))
        evt.sdk = mod.createOpenAICompatible({
          ...evt.options,
          ...(token ? { apiKey: token } : {}),
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- FetchFunction is typeof globalThis.fetch; the wrapped implementation is a structural fetch whose static members are irrelevant to callers.
          fetch: cortexFetch(evt.options.fetch) as typeof fetch,
          name: evt.model.providerID,
          baseURL: typeof evt.options.baseURL === "string" ? evt.options.baseURL : "",
        })
      }),
    )
  }),
})
