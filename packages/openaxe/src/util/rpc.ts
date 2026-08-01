type Definition = {
  [method: string]: (input: any) => any
}

const DEFAULT_REQUEST_TIMEOUT = 30_000 // 30 seconds
const CLEANUP_INTERVAL = 60_000 // 1 minute

export function listen(rpc: Definition) {
  onmessage = async (evt) => {
    const parsed = JSON.parse(evt.data)
    if (parsed.type === "rpc.request") {
      const result = await rpc[parsed.method](parsed.input)
      postMessage(JSON.stringify({ type: "rpc.result", result, id: parsed.id }))
    }
  }
}

export function emit(event: string, data: unknown) {
  postMessage(JSON.stringify({ type: "rpc.event", event, data }))
}

export function client<T extends Definition>(target: {
  postMessage: (data: string) => void | null
  onmessage: ((this: Worker, ev: MessageEvent) => any) | null
}, options?: { requestTimeout?: number; cleanupInterval?: number }) {
  const pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void; timestamp: number }>()
  const listeners = new Map<string, Set<(data: any) => void>>()
  let id = 0
  const requestTimeout = options?.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT
  const cleanupInterval = options?.cleanupInterval ?? CLEANUP_INTERVAL

  // Periodic cleanup of stale pending requests
  const cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [requestId, entry] of pending.entries()) {
      if (now - entry.timestamp > requestTimeout) {
        entry.reject(new Error(`Request timeout after ${requestTimeout}ms`))
        pending.delete(requestId)
      }
    }
  }, cleanupInterval)

  target.onmessage = async (evt) => {
    const parsed = JSON.parse(evt.data)
    if (parsed.type === "rpc.result") {
      const entry = pending.get(parsed.id)
      if (entry) {
        if (parsed.error) {
          entry.reject(new Error(parsed.error))
        } else {
          entry.resolve(parsed.result)
        }
        pending.delete(parsed.id)
      }
    }
    if (parsed.type === "rpc.event") {
      const handlers = listeners.get(parsed.event)
      if (handlers) {
        for (const handler of handlers) {
          handler(parsed.data)
        }
      }
    }
  }

  return {
    call<Method extends keyof T>(method: Method, input: Parameters<T[Method]>[0]): Promise<ReturnType<T[Method]>> {
      const requestId = id++
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(requestId)
          reject(new Error(`Request timeout after ${requestTimeout}ms`))
        }, requestTimeout)
        pending.set(requestId, {
          resolve: (result) => {
            clearTimeout(timeout)
            resolve(result)
          },
          reject: (error) => {
            clearTimeout(timeout)
            reject(error)
          },
          timestamp: Date.now(),
        })
        target.postMessage(JSON.stringify({ type: "rpc.request", method, input, id: requestId }))
      })
    },
    on(event: string, handler: (data: unknown) => void) {
      let handlers = listeners.get(event)
      if (!handlers) {
        handlers = new Set()
        listeners.set(event, handlers)
      }
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
    dispose() {
      clearInterval(cleanupTimer)
      // Reject all pending requests
      for (const entry of pending.values()) {
        entry.reject(new Error("RPC client disposed"))
      }
      pending.clear()
      listeners.clear()
    },
  }
}

export * as Rpc from "./rpc"
