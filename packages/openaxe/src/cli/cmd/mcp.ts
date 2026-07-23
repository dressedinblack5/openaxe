import { cmd } from "./cmd"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { effectCmd } from "../effect-cmd"
import { Cause } from "effect"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js"
import {
  intro,
  outro,
  select,
  isCancel,
  text,
  confirm as promptConfirm,
  password,
  spinner as createSpinner,
  log,
} from "@clack/prompts"
import { UI } from "../ui"
import { MCP } from "../../mcp"
import { McpAuth } from "../../mcp/auth"
import { McpOAuthProvider } from "../../mcp/oauth-provider"
import { Config } from "@/config/config"
import { ConfigMCPV1 } from "@opencode-ai/core/v1/config/mcp"
import { InstanceRef } from "@/effect/instance-ref"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { modify, applyEdits } from "jsonc-parser"
import { Filesystem } from "@/util/filesystem"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"
import { Effect } from "effect"

function getAuthStatusIcon(status: MCP.AuthStatus): string {
  switch (status) {
    case "authenticated":
      return "✓"
    case "expired":
      return "⚠"
    case "not_authenticated":
      return "✗"
  }
}

function getAuthStatusText(status: MCP.AuthStatus): string {
  switch (status) {
    case "authenticated":
      return "authenticated"
    case "expired":
      return "expired"
    case "not_authenticated":
      return "not authenticated"
  }
}

type McpEntry = NonNullable<ConfigV1.Info["mcp"]>[string]

type McpConfigured = ConfigMCPV1.Info
function isMcpConfigured(config: McpEntry): config is McpConfigured {
  return typeof config === "object" && config !== null && "type" in config
}

type McpRemote = Extract<McpConfigured, { type: "remote" }>
function isMcpRemote(config: McpEntry): config is McpRemote {
  return isMcpConfigured(config) && config.type === "remote"
}

function configuredServers(config: ConfigV1.Info) {
  return Object.entries(config.mcp ?? {}).filter((entry): entry is [string, McpConfigured] => isMcpConfigured(entry[1]))
}

function oauthServers(config: ConfigV1.Info) {
  return configuredServers(config).filter(
    (entry): entry is [string, McpRemote] => isMcpRemote(entry[1]) && entry[1].oauth !== false,
  )
}

function listState() {
  return Effect.gen(function* () {
    const cfg = yield* Config.Service
    const mcp = yield* MCP.Service
    const config = yield* cfg.get()
    const statuses = yield* mcp.status()
    const stored = yield* Effect.all(
      Object.fromEntries(configuredServers(config).map(([name]) => [name, mcp.hasStoredTokens(name)])),
      { concurrency: "unbounded" },
    )
    return { config, statuses, stored }
  })
}

function authState() {
  return Effect.gen(function* () {
    const cfg = yield* Config.Service
    const mcp = yield* MCP.Service
    const config = yield* cfg.get()
    const auth = yield* Effect.all(
      Object.fromEntries(oauthServers(config).map(([name]) => [name, mcp.getAuthStatus(name)])),
      { concurrency: "unbounded" },
    )
    return { config, auth }
  })
}

export const McpCommand = cmd({
  command: "mcp",
  describe: "manage MCP (Model Context Protocol) servers",
  builder: (yargs) =>
    yargs
      .command(McpAddCommand)
      .command(McpListCommand)
      .command(McpAuthCommand)
      .command(McpLogoutCommand)
      .command(McpDebugCommand)
      .demandCommand(),
  async handler() {},
})

export const McpListCommand = effectCmd({
  command: "list",
  aliases: ["ls"],
  describe: "list MCP servers and their status",
  handler: Effect.fn("Cli.mcp.list")(function* () {
    UI.empty()
    intro("MCP Servers")

    const { config, statuses, stored } = yield* listState()
    const servers = configuredServers(config)

    if (servers.length === 0) {
      log.warn("No MCP servers configured")
      outro("Add servers with: openaxe mcp add")
      return
    }

    for (const [name, serverConfig] of servers) {
      const status = statuses[name]
      const hasOAuth = isMcpRemote(serverConfig) && !!serverConfig.oauth
      const hasStoredTokens = stored[name]

      let statusIcon: string
      let statusText: string
      let hint = ""

      if (!status) {
        statusIcon = "○"
        statusText = "not initialized"
      } else if (status.status === "connected") {
        statusIcon = "✓"
        statusText = "connected"
        if (hasOAuth && hasStoredTokens) {
          hint = " (OAuth)"
        }
      } else if (status.status === "disabled") {
        statusIcon = "○"
        statusText = "disabled"
      } else if (status.status === "needs_auth") {
        statusIcon = "⚠"
        statusText = "needs authentication"
      } else if (status.status === "needs_client_registration") {
        statusIcon = "✗"
        statusText = "needs client registration"
        hint = "\n    " + status.error
      } else if (status.status === "pending") {
        statusIcon = "…"
        statusText = "pending"
        hint = ""
      } else {
        statusIcon = "✗"
        statusText = "failed"
        hint = "\n    " + status.error
      }

      const typeHint = serverConfig.type === "remote" ? serverConfig.url : serverConfig.command.join(" ")
      log.info(`${statusIcon} ${name} ${UI.Style.TEXT_DIM}${statusText}${hint}\n    ${UI.Style.TEXT_DIM}${typeHint}`)
    }

    outro(`${servers.length} server(s)`)
  }),
})

export const McpAuthCommand = effectCmd({
  command: "auth [name]",
  describe: "authenticate with an OAuth-enabled MCP server",
  builder: (yargs) =>
    yargs
      .positional("name", {
        describe: "name of the MCP server",
        type: "string",
      })
      .command(McpAuthListCommand),
  handler: Effect.fn("Cli.mcp.auth")(function* (args) {
    UI.empty()
    intro("MCP OAuth Authentication")

    const { config, auth } = yield* authState()
    const mcpServers = config.mcp ?? {}
    const servers = oauthServers(config)

    if (servers.length === 0) {
      log.warn("No OAuth-capable MCP servers configured")
      log.info("Remote MCP servers support OAuth by default. Add a remote server in openaxe.json:")
      log.info(`
  "mcp": {
    "my-server": {
      "type": "remote",
      "url": "https://example.com/mcp"
    }
  }`)
      outro("Done")
      return
    }

    let serverName = args.name
    if (!serverName) {
      // Build options with auth status
      const options = servers.map(([name, cfg]) => {
        const authStatus = auth[name]
        const icon = getAuthStatusIcon(authStatus)
        const statusText = getAuthStatusText(authStatus)
        const url = cfg.url
        return {
          label: `${icon} ${name} (${statusText})`,
          value: name,
          hint: url,
        }
      })

      const selected = yield* Effect.promise(() =>
        select({
          message: "Select MCP server to authenticate",
          options,
        }),
      )
      if (isCancel(selected)) throw new UI.CancelledError()
      serverName = selected
    }

    const serverConfig = mcpServers[serverName]
    if (!serverConfig) {
      log.error(`MCP server not found: ${serverName}`)
      outro("Done")
      return
    }

    if (!isMcpRemote(serverConfig) || serverConfig.oauth === false) {
      log.error(`MCP server ${serverName} is not an OAuth-capable remote server`)
      outro("Done")
      return
    }

    // Check if already authenticated
    const authStatus = auth[serverName] ?? (yield* MCP.Service.use((mcp) => mcp.getAuthStatus(serverName)))
    if (authStatus === "authenticated") {
      const confirm = yield* Effect.promise(() =>
        promptConfirm({
          message: `${serverName} already has valid credentials. Re-authenticate?`,
        }),
      )
      if (isCancel(confirm) || !confirm) {
        outro("Cancelled")
        return
      }
    } else if (authStatus === "expired") {
      log.warn(`${serverName} has expired credentials. Re-authenticating...`)
    }

    const spinner = createSpinner()
    spinner.start("Starting OAuth flow...")

    // Subscribe to browser open failure events to show URL for manual opening
    const events = yield* EventV2Bridge.Service
    const unsubscribe = yield* events.listen((event) => {
      if (event.type !== MCP.BrowserOpenFailed.type) return Effect.void
      const data = event.data as EventV2.Data<typeof MCP.BrowserOpenFailed>
      if (data.mcpName === serverName) {
        spinner.stop("Could not open browser automatically")
        log.warn("Please open this URL in your browser to authenticate:")
        log.info(data.url)
        spinner.start("Waiting for authorization...")
      }
      return Effect.void
    })

    yield* MCP.Service.use((mcp) => mcp.authenticate(serverName)).pipe(
      Effect.tap((status) =>
        Effect.sync(() => {
          if (status.status === "connected") {
            spinner.stop("Authentication successful!")
          } else if (status.status === "needs_client_registration") {
            spinner.stop("Authentication failed", 1)
            log.error(status.error)
            log.info("Add clientId to your MCP server config:")
            log.info(`
  "mcp": {
    "${serverName}": {
      "type": "remote",
      "url": "${serverConfig.url}",
      "oauth": {
        "clientId": "your-client-id",
        "clientSecret": "your-client-secret"
      }
    }
  }`)
          } else if (status.status === "failed") {
            spinner.stop("Authentication failed", 1)
            log.error(status.error)
          } else {
            spinner.stop("Unexpected status: " + status.status, 1)
          }
        }),
      ),
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          spinner.stop("Authentication failed", 1)
          const error = Cause.squash(cause)
          log.error(error instanceof Error ? error.message : String(error))
        }),
      ),
      Effect.ensuring(unsubscribe),
    )

    outro("Done")
  }),
})

export const McpAuthListCommand = effectCmd({
  command: "list",
  aliases: ["ls"],
  describe: "list OAuth-capable MCP servers and their auth status",
  handler: Effect.fn("Cli.mcp.auth.list")(function* () {
    UI.empty()
    intro("MCP OAuth Status")

    const { config, auth } = yield* authState()
    const servers = oauthServers(config)

    if (servers.length === 0) {
      log.warn("No OAuth-capable MCP servers configured")
      outro("Done")
      return
    }

    for (const [name, serverConfig] of servers) {
      const authStatus = auth[name]
      const icon = getAuthStatusIcon(authStatus)
      const statusText = getAuthStatusText(authStatus)
      const url = serverConfig.url

      log.info(`${icon} ${name} ${UI.Style.TEXT_DIM}${statusText}\n    ${UI.Style.TEXT_DIM}${url}`)
    }

    outro(`${servers.length} OAuth-capable server(s)`)
  }),
})

export const McpLogoutCommand = effectCmd({
  command: "logout [name]",
  describe: "remove OAuth credentials for an MCP server",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "name of the MCP server",
      type: "string",
    }),
  handler: Effect.fn("Cli.mcp.logout")(function* (args) {
    UI.empty()
    intro("MCP OAuth Logout")

    const credentials = yield* McpAuth.Service.use((auth) => auth.all())
    const serverNames = Object.keys(credentials)

    if (serverNames.length === 0) {
      log.warn("No MCP OAuth credentials stored")
      outro("Done")
      return
    }

    let serverName = args.name
    if (!serverName) {
      const selected = yield* Effect.promise(() =>
        select({
          message: "Select MCP server to logout",
          options: serverNames.map((name) => {
            const entry = credentials[name]
            const hasTokens = !!entry.tokens
            const hasClient = !!entry.clientInfo
            let hint = ""
            if (hasTokens && hasClient) hint = "tokens + client"
            else if (hasTokens) hint = "tokens"
            else if (hasClient) hint = "client registration"
            return {
              label: name,
              value: name,
              hint,
            }
          }),
        }),
      )
      if (isCancel(selected)) throw new UI.CancelledError()
      serverName = selected
    }

    if (!credentials[serverName]) {
      log.error(`No credentials found for: ${serverName}`)
      outro("Done")
      return
    }

    yield* MCP.Service.use((mcp) => mcp.removeAuth(serverName))
    log.success(`Removed OAuth credentials for ${serverName}`)
    outro("Done")
  }),
})

async function resolveConfigPath(baseDir: string, global = false) {
  // Check for existing config files (prefer .jsonc over .json, check .openaxe/ subdirectory too)
  const candidates = [path.join(baseDir, "openaxe.json"), path.join(baseDir, "openaxe.jsonc")]

  if (!global) {
    candidates.push(path.join(baseDir, ".openaxe", "openaxe.json"), path.join(baseDir, ".openaxe", "openaxe.jsonc"))
  }

  for (const candidate of candidates) {
    if (await Filesystem.exists(candidate)) {
      return candidate
    }
  }

  // Default to openaxe.json if none exist
  return candidates[0]
}

async function addMcpToConfig(name: string, mcpConfig: ConfigMCPV1.Info, configPath: string) {
  let text = "{}"
  if (await Filesystem.exists(configPath)) {
    text = await Filesystem.readText(configPath)
  }

  // Use jsonc-parser to modify while preserving comments
  const edits = modify(text, ["mcp", name], mcpConfig, {
    formattingOptions: { tabSize: 2, insertSpaces: true },
  })
  const result = applyEdits(text, edits)

  await Filesystem.write(configPath, result)

  return configPath
}

export const McpAddCommand = effectCmd({
  command: "add [name]",
  describe: "add an MCP server",
  builder: (yargs) =>
    yargs
      .positional("name", {
        describe: "name of the MCP server",
        type: "string",
      })
      .option("url", {
        describe: "URL for a remote MCP server",
        type: "string",
      })
      .option("cwd", {
        describe: "working directory for a local MCP server",
        type: "string",
      })
      .option("env", {
        describe: "environment variable for a local MCP server (KEY=VALUE)",
        type: "string",
        array: true,
      })
      .option("header", {
        describe: "HTTP header for a remote MCP server (KEY=VALUE)",
        type: "string",
        array: true,
      }),
  handler: Effect.fn("Cli.mcp.add")(function* (args) {
    const maybeCtx = yield* InstanceRef
    if (!maybeCtx) return yield* Effect.die("InstanceRef not provided")
    const ctx = maybeCtx
    yield* Effect.promise(async () => {
      const command = args["--"] ?? []
      if (!args.name && (args.url || args.env?.length || args.header?.length || command.length)) {
        throw new Error("A server name is required for non-interactive MCP configuration")
      }
      if (args.name) {
        if (!!args.url === !!command.length) {
          throw new Error("Provide either --url <url> or a command after --")
        }
        if (args.url && !URL.canParse(args.url)) {
          throw new Error(`Invalid URL: ${args.url}`)
        }
        if (args.url && args.env?.length) {
          throw new Error("--env is only valid for local MCP servers")
        }
        if (args.cwd && args.url) {
          throw new Error("--cwd is only valid for local MCP servers")
        }
        if (command.length && args.header?.length) {
          throw new Error("--header is only valid for remote MCP servers")
        }

        const entries = (values: string[], kind: string) =>
          Object.fromEntries(
            values.map((entry) => {
              const index = entry.indexOf("=")
              if (index < 1) throw new Error(`Invalid ${kind}: ${entry}. Expected KEY=VALUE`)
              return [entry.slice(0, index), entry.slice(index + 1)]
            }),
          )
        const environment = entries(args.env ?? [], "environment variable")
        const headers = entries(args.header ?? [], "HTTP header")
        const mcpConfig: ConfigMCPV1.Info = args.url
          ? {
              type: "remote",
              url: args.url,
              ...(Object.keys(headers).length ? { headers } : {}),
            }
          : {
              type: "local",
              command,
              ...(Object.keys(environment).length ? { environment } : {}),
              ...(args.cwd ? { cwd: args.cwd } : {}),
            }

        const configPath = await resolveConfigPath(Global.Path.config, true)
        await addMcpToConfig(args.name, mcpConfig, configPath)
        log.success(`MCP server "${args.name}" added to ${configPath}`)
        return
      }

      UI.empty()
      intro("Add MCP server")

      const project = ctx.project

      // Resolve config paths eagerly for hints
      const [projectConfigPath, globalConfigPath] = await Promise.all([
        resolveConfigPath(ctx.worktree),
        resolveConfigPath(Global.Path.config, true),
      ])

      // Determine scope
      let configPath = globalConfigPath
      if (project.vcs === "git") {
        const scopeResult = await select({
          message: "Location",
          options: [
            {
              label: "Current project",
              value: projectConfigPath,
              hint: projectConfigPath,
            },
            {
              label: "Global",
              value: globalConfigPath,
              hint: globalConfigPath,
            },
          ],
        })
        if (isCancel(scopeResult)) throw new UI.CancelledError()
        configPath = scopeResult
      }

      const name = await text({
        message: "Enter MCP server name",
        validate: (x) => (x && x.length > 0 ? undefined : "Required"),
      })
      if (isCancel(name)) throw new UI.CancelledError()

      const type = await select({
        message: "Select MCP server type",
        options: [
          {
            label: "Local",
            value: "local",
            hint: "Run a local command",
          },
          {
            label: "Remote",
            value: "remote",
            hint: "Connect to a remote URL",
          },
        ],
      })
      if (isCancel(type)) throw new UI.CancelledError()

      if (type === "local") {
        const command = await text({
          message: "Enter command to run",
          placeholder: "e.g., opencode x @modelcontextprotocol/server-filesystem",
          validate: (x) => (x && x.length > 0 ? undefined : "Required"),
        })
        if (isCancel(command)) throw new UI.CancelledError()

        const cwd = await text({
          message: "Working directory (optional, defaults to workspace root)",
          placeholder: "e.g., ./server or /absolute/path",
        })
        if (isCancel(cwd)) throw new UI.CancelledError()

        const mcpConfig: ConfigMCPV1.Info = {
          type: "local",
          command: command.split(" "),
          ...(cwd ? { cwd } : {}),
        }

        await addMcpToConfig(name, mcpConfig, configPath)
        log.success(`MCP server "${name}" added to ${configPath}`)
        outro("MCP server added successfully")
        return
      }

      if (type === "remote") {
        const url = await text({
          message: "Enter MCP server URL",
          placeholder: "e.g., https://example.com/mcp",
          validate: (x) => {
            if (!x) return "Required"
            if (x.length === 0) return "Required"
            const isValid = URL.canParse(x)
            return isValid ? undefined : "Invalid URL"
          },
        })
        if (isCancel(url)) throw new UI.CancelledError()

        const useOAuth = await promptConfirm({
          message: "Does this server require OAuth authentication?",
          initialValue: false,
        })
        if (isCancel(useOAuth)) throw new UI.CancelledError()

        let mcpConfig: ConfigMCPV1.Info

        if (useOAuth) {
          const hasClientId = await promptConfirm({
            message: "Do you have a pre-registered client ID?",
            initialValue: false,
          })
          if (isCancel(hasClientId)) throw new UI.CancelledError()

          if (hasClientId) {
            const clientId = await text({
              message: "Enter client ID",
              validate: (x) => (x && x.length > 0 ? undefined : "Required"),
            })
            if (isCancel(clientId)) throw new UI.CancelledError()

            const hasSecret = await promptConfirm({
              message: "Do you have a client secret?",
              initialValue: false,
            })
            if (isCancel(hasSecret)) throw new UI.CancelledError()

            let clientSecret: string | undefined
            if (hasSecret) {
              const secret = await password({
                message: "Enter client secret",
              })
              if (isCancel(secret)) throw new UI.CancelledError()
              clientSecret = secret
            }

            mcpConfig = {
              type: "remote",
              url,
              oauth: {
                clientId,
                ...(clientSecret && { clientSecret }),
              },
            }
          } else {
            mcpConfig = {
              type: "remote",
              url,
              oauth: {},
            }
          }
        } else {
          mcpConfig = {
            type: "remote",
            url,
          }
        }

        await addMcpToConfig(name, mcpConfig, configPath)
        log.success(`MCP server "${name}" added to ${configPath}`)
      }

      outro("MCP server added successfully")
    })
  }),
})

export const McpDebugCommand = effectCmd({
  command: "debug <name>",
  describe: "debug OAuth connection for an MCP server",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "name of the MCP server",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.mcp.debug")(function* (args) {
    const config = yield* Config.Service.use((cfg) => cfg.get())
    const mcp = yield* MCP.Service
    const auth = yield* McpAuth.Service
    yield* Effect.promise(async () => {
      UI.empty()
      intro("MCP OAuth Debug")

      const mcpServers = config.mcp ?? {}
      const serverName = args.name

      const serverConfig = mcpServers[serverName]
      if (!serverConfig) {
        log.error(`MCP server not found: ${serverName}`)
        outro("Done")
        return
      }

      if (!isMcpRemote(serverConfig)) {
        log.error(`MCP server ${serverName} is not a remote server`)
        outro("Done")
        return
      }

      if (serverConfig.oauth === false) {
        log.warn(`MCP server ${serverName} has OAuth explicitly disabled`)
        outro("Done")
        return
      }

      log.info(`Server: ${serverName}`)
      log.info(`URL: ${serverConfig.url}`)

      // Check stored auth status — services already in hand, run inline.
      const { authStatus, entry } = await Effect.runPromise(
        Effect.all({
          authStatus: mcp.getAuthStatus(serverName),
          entry: auth.get(serverName),
        }),
      )
      log.info(`Auth status: ${getAuthStatusIcon(authStatus)} ${getAuthStatusText(authStatus)}`)

      if (entry?.tokens) {
        log.info(`  Access token: ${entry.tokens.accessToken.substring(0, 20)}...`)
        if (entry.tokens.expiresAt) {
          const expiresDate = new Date(entry.tokens.expiresAt * 1000)
          const isExpired = entry.tokens.expiresAt < Date.now() / 1000
          log.info(`  Expires: ${expiresDate.toISOString()} ${isExpired ? "(EXPIRED)" : ""}`)
        }
        if (entry.tokens.refreshToken) {
          log.info(`  Refresh token: present`)
        }
      }
      if (entry?.clientInfo) {
        log.info(`  Client ID: ${entry.clientInfo.clientId}`)
        if (entry.clientInfo.clientSecretExpiresAt) {
          const expiresDate = new Date(entry.clientInfo.clientSecretExpiresAt * 1000)
          log.info(`  Client secret expires: ${expiresDate.toISOString()}`)
        }
      }

      const spinner = createSpinner()
      spinner.start("Testing connection...")

      // Test basic HTTP connectivity first
      try {
        const response = await fetch(serverConfig.url, {
          method: "POST",
          headers: {
            ...serverConfig.headers,
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "initialize",
            params: {
              protocolVersion: LATEST_PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: { name: "openaxe-debug", version: InstallationVersion },
            },
            id: 1,
          }),
        })

        spinner.stop(`HTTP response: ${response.status} ${response.statusText}`)

        // Check for WWW-Authenticate header
        const wwwAuth = response.headers.get("www-authenticate")
        if (wwwAuth) {
          log.info(`WWW-Authenticate: ${wwwAuth}`)
        }

        if (response.status === 401) {
          log.warn("Server returned 401 Unauthorized")

          // Try to discover OAuth metadata
          const oauthConfig = typeof serverConfig.oauth === "object" ? serverConfig.oauth : undefined
          const authProvider = new McpOAuthProvider(
            serverName,
            serverConfig.url,
            {
              clientId: oauthConfig?.clientId,
              clientSecret: oauthConfig?.clientSecret,
              scope: oauthConfig?.scope,
              redirectUri: oauthConfig?.redirectUri,
            },
            {
              onRedirect: async () => {},
            },
            auth,
          )

          log.info("Testing OAuth flow (without completing authorization)...")

          // Try creating transport with auth provider to trigger discovery
          const transport = new StreamableHTTPClientTransport(new URL(serverConfig.url), {
            authProvider,
            requestInit: serverConfig.headers ? { headers: serverConfig.headers } : undefined,
          })

          try {
            const client = new Client({
              name: "openaxe-debug",
              version: InstallationVersion,
            })
            await client.connect(transport)
            log.success("Connection successful (already authenticated)")
            await client.close()
          } catch (error) {
            if (error instanceof UnauthorizedError) {
              log.info(`OAuth flow triggered: ${error.message}`)

              // Check if dynamic registration would be attempted
              const clientInfo = await authProvider.clientInformation()
              if (clientInfo) {
                log.info(`Client ID available: ${clientInfo.client_id}`)
              } else {
                log.info("No client ID - dynamic registration will be attempted")
              }
            } else {
              log.error(`Connection error: ${error instanceof Error ? error.message : String(error)}`)
            }
          }
        } else if (response.status >= 200 && response.status < 300) {
          log.success("Server responded successfully (no auth required or already authenticated)")
          const body = await response.text()
          try {
            const json = JSON.parse(body)
            if (json.result?.serverInfo) {
              log.info(`Server info: ${JSON.stringify(json.result.serverInfo)}`)
            }
          } catch {
            // Not JSON, ignore
          }
        } else {
          log.warn(`Unexpected status: ${response.status}`)
          const body = await response.text().catch(() => "")
          if (body) {
            log.info(`Response body: ${body.substring(0, 500)}`)
          }
        }
      } catch (error) {
        spinner.stop("Connection failed", 1)
        log.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      }

      outro("Debug complete")
    })
  }),
})
