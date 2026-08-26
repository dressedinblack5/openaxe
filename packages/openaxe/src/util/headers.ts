// Merge RequestInit headers into a fresh case-insensitive Headers object
// seeded from the original Request, without mutating either input. Used by
// provider auth fetch overrides so header writes never leak into RequestInit
// objects the AI SDK may reuse on retry.
export function mergeRequestHeaders(requestInput: RequestInfo | URL, init?: RequestInit): Headers {
  const headers = new Headers(requestInput instanceof Request ? requestInput.headers : undefined)
  if (init?.headers) {
    const entries =
      init.headers instanceof Headers
        ? init.headers.entries()
        : Array.isArray(init.headers)
          ? init.headers
          : Object.entries(init.headers as Record<string, string | undefined>)
    for (const [key, value] of entries) {
      if (value !== undefined) headers.set(key, value)
    }
  }
  return headers
}
