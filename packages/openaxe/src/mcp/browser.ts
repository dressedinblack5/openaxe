import { Effect } from "effect"

const ALLOWED_OAUTH_SCHEMES = new Set(["http:", "https:"])

function validateOAuthUrl(urlString: string): URL {
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    throw new Error(`Invalid OAuth URL: ${urlString}`)
  }
  if (!ALLOWED_OAUTH_SCHEMES.has(url.protocol)) {
    throw new Error(`OAuth URL scheme not allowed: ${url.protocol}. Only http: and https: are permitted.`)
  }
  return url
}

const BROWSER_COMMANDS: Record<string, { command: string; prefixArgs: string[] }> = {
  win32: { command: "cmd.exe", prefixArgs: ["/c", "start", ""] },
  darwin: { command: "open", prefixArgs: [] },
}

export function openBrowser(urlString: string): Effect.Effect<void, Error> {
  return Effect.sync(() => {
    const url = validateOAuthUrl(urlString)
    const args: string[] = []
    const { command, prefixArgs } = BROWSER_COMMANDS[process.platform] ?? { command: "xdg-open", prefixArgs: [] }
    args.push(...prefixArgs, url.toString())
    return Effect.tryPromise({
      try: () =>
        new Promise<void>((resolve, reject) => {
          const child = Bun.spawn([command, ...args], { stderr: "ignore" })
          void child.exited.then((code) => {
            if (code === 0) resolve()
            else reject(new Error(`Browser open failed with exit code ${code}`))
          })
        }),
      catch: (error) => error instanceof Error ? error : new Error(String(error)),
    })
  }).pipe(Effect.flatten)
}
