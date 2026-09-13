// Shared loopback OAuth callback machinery for provider auth plugins
// (plugin/openai/codex.ts, plugin/xai.ts). Owns the pending-authorization
// state machine: the 5-minute timeout promise and the callback/cancel HTTP
// dispatch (code/state/error params -> resolve/reject + branded HTML page).
// Each plugin keeps its own server lifecycle (bind host/port, CORS, listen
// error handling), which differs per provider.

interface PendingOAuth<Tokens, Pkce> {
  pkce: Pkce
  state: string
  resolve: (tokens: Tokens) => void
  reject: (error: Error) => void
}

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000

export function createPendingOAuth<Tokens, Pkce>(options: { supersedeMessage?: string } = {}) {
  let pending: PendingOAuth<Tokens, Pkce> | undefined

  function failWith(message: string) {
    pending?.reject(new Error(message))
    pending = undefined
  }

  return {
    /** Rejects any still-pending authorization (e.g. on plugin dispose). */
    cancel(reason: string) {
      failWith(reason)
    },

    /**
     * Promise that resolves when `handle()` dispatches a matching callback.
     * A previous in-flight authorize that the user abandoned is rejected
     * eagerly when `supersedeMessage` is set, so its caller stops waiting on
     * a state value that can never match the next callback.
     */
    waitFor(pkce: Pkce, state: string): Promise<Tokens> {
      if (pending && options.supersedeMessage) failWith(options.supersedeMessage)
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (pending) {
            pending = undefined
            reject(new Error("OAuth callback timeout - authorization took too long"))
          }
        }, CALLBACK_TIMEOUT_MS)

        pending = {
          pkce,
          state,
          resolve: (tokens) => {
            clearTimeout(timeout)
            resolve(tokens)
          },
          reject: (error) => {
            clearTimeout(timeout)
            reject(error)
          },
        }
      })
    },

    /**
     * Dispatches `<redirectPath>` and `/cancel` requests against the pending
     * authorization. Returns false when the request was not handled so the
     * caller can serve its own fallback (404).
     */
    handle(
      req: { method?: string; url?: string },
      res: {
        writeHead: (status: number, headers?: Record<string, string>) => unknown
        end: (body?: string) => unknown
      },
      opts: {
        redirectPath: string
        baseUrl: string
        htmlContentType: string
        htmlError: (message: string) => string
        htmlSuccess: string
        exchange: (code: string, pkce: Pkce) => Promise<Tokens>
      },
    ): boolean {
      const url = new URL(req.url || "/", opts.baseUrl)

      if (url.pathname === opts.redirectPath) {
        const code = url.searchParams.get("code")
        const state = url.searchParams.get("state")
        const error = url.searchParams.get("error")
        const errorDescription = url.searchParams.get("error_description")

        const respondError = (status: number, message: string) => {
          failWith(message)
          res.writeHead(status, { "Content-Type": opts.htmlContentType })
          res.end(opts.htmlError(message))
        }

        if (error) {
          respondError(200, errorDescription || error)
          return true
        }

        if (!code) {
          respondError(400, "Missing authorization code")
          return true
        }

        if (!pending || state !== pending.state) {
          respondError(400, "Invalid state - potential CSRF attack")
          return true
        }

        const current = pending
        pending = undefined

        opts
          .exchange(code, current.pkce)
          .then((tokens) => current.resolve(tokens))
          .catch((err) => current.reject(err))

        res.writeHead(200, { "Content-Type": opts.htmlContentType })
        res.end(opts.htmlSuccess)
        return true
      }

      if (url.pathname === "/cancel") {
        failWith("Login cancelled")
        res.writeHead(200)
        res.end("Login cancelled")
        return true
      }

      return false
    },
  }
}
