// Shared Snowflake Cortex request/response shaping, used by both the auth
// plugin fetch override (plugin/snowflake-cortex.ts) and the provider-level
// fetch fallback (provider/provider.ts).

// OpenAI-compat clients send `max_tokens`; Cortex only accepts
// `max_completion_tokens`. Returns the input unchanged when it is not
// parseable JSON or has nothing to rewrite.
export function rewriteMaxTokensBody(body: string): string {
  try {
    const parsed = JSON.parse(body)
    if (!("max_tokens" in parsed)) return body
    parsed.max_completion_tokens = parsed.max_tokens
    delete parsed.max_tokens
    return JSON.stringify(parsed)
  } catch {
    // expected when body is not parseable JSON
    return body
  }
}

// Maps Cortex's "conversation complete" 400 to a synthetic completed choice
// and rewrites streamed deltas so assistant messages never carry an empty
// role. Anything else passes through untouched.
export async function transformCortexResponse(response: Response): Promise<Response> {
  if (!response.ok && response.status === 400) {
    try {
      const errorData = await response.clone().json()
      const errorMessage = String(errorData.message || errorData.error || "")
      if (errorMessage.toLowerCase().includes("conversation complete")) {
        return new Response(
          JSON.stringify({
            choices: [{ finish_reason: "stop", message: { content: "", role: "assistant" } }],
          }),
          { status: 200, headers: new Headers({ "content-type": "application/json" }) },
        )
      }
    } catch {
      // expected when error response is not JSON
    }
  }

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
        const text = decoder.decode(value, { stream: true })
        ctrl.enqueue(encoder.encode(text.replace(/"role"\s*:\s*""/g, '"role":"assistant"')))
      },
      cancel() {
        void reader.cancel()
      },
    })
    return new Response(stream, { headers: response.headers, status: response.status })
  }

  return response
}
