process.title = "openaxe"

import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { UI } from "./cli/ui"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { EOL } from "os"
import { lazyCommand } from "./cli/lazy-command"

const args = hideBin(process.argv)

function show(out: string) {
  const text = out.trimStart()
  if (!text.startsWith("openaxe ")) {
    process.stderr.write(UI.logo() + EOL + EOL)
    process.stderr.write(text + EOL)
    return
  }
  process.stderr.write(out)
}

const cli = yargs(args)
  .parserConfiguration({ "populate--": true })
  .scriptName("openaxe")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", InstallationVersion)
  .alias("version", "v")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .option("pure", {
    describe: "run without external plugins",
    type: "boolean",
  })
  .middleware(async (opts) => {
    if (opts.printLogs) process.env.OPENCODE_PRINT_LOGS = "1"
    if (opts.logLevel) process.env.OPENCODE_LOG_LEVEL = opts.logLevel
    if (opts.pure) {
      process.env.OPENCODE_PURE = "1"
    }

    const { Heap } = await import("./cli/heap")
    await Heap.start()

    process.env.AGENT = "1"
    process.env.OPENCODE = "1"
    process.env.OPENCODE_PID = String(process.pid)
  })
  .usage("")
  .completion("completion", "generate shell completion script")
  .command(lazyCommand("acp", "start ACP (Agent Client Protocol) server", undefined, () =>
    import("./cli/cmd/acp").then((m) => m.AcpCommand),
  ))
  .command(lazyCommand("mcp", "manage MCP (Model Context Protocol) servers", undefined, () =>
    import("./cli/cmd/mcp").then((m) => m.McpCommand),
  ))
  .command(lazyCommand("$0 [project]", "start opencode tui", undefined, () =>
    import("./cli/cmd/tui").then((m) => m.TuiCommand),
  ))
  .command(lazyCommand("attach <url>", "attach to a running opencode server", undefined, () =>
    import("./cli/cmd/attach").then((m) => m.AttachCommand),
  ))
  .command(lazyCommand("run [message..]", "run openaxe with a message", undefined, () =>
    import("./cli/cmd/run").then((m) => m.RunCommand),
  ))
  .command(lazyCommand("generate", false, undefined, () =>
    import("./cli/cmd/generate").then((m) => m.GenerateCommand),
  ))
  .command(lazyCommand("debug", "debugging and troubleshooting tools", undefined, () =>
    import("./cli/cmd/debug").then((m) => m.DebugCommand),
  ))
  .command(lazyCommand("console", false, undefined, () =>
    import("./cli/cmd/account").then((m) => m.ConsoleCommand),
  ))
  .command(lazyCommand("providers", "manage AI providers and credentials", ["auth"], () =>
    import("./cli/cmd/providers").then((m) => m.ProvidersCommand),
  ))
  .command(lazyCommand("agent", "manage agents", undefined, () =>
    import("./cli/cmd/agent").then((m) => m.AgentCommand),
  ))
  .command(lazyCommand("upgrade [target]", "upgrade openaxe to the latest or a specific version", undefined, () =>
    import("./cli/cmd/upgrade").then((m) => m.UpgradeCommand),
  ))
  .command(lazyCommand("uninstall", "uninstall openaxe and remove all related files", undefined, () =>
    import("./cli/cmd/uninstall").then((m) => m.UninstallCommand),
  ))
  .command(lazyCommand("serve", "starts a headless openaxe server", undefined, () =>
    import("./cli/cmd/serve").then((m) => m.ServeCommand),
  ))
  .command(lazyCommand("web", "start opencode server and open web interface", undefined, () =>
    import("./cli/cmd/web").then((m) => m.WebCommand),
  ))
  .command(lazyCommand("models [provider]", "list all available models", undefined, () =>
    import("./cli/cmd/models").then((m) => m.ModelsCommand),
  ))
  .command(lazyCommand("stats", "show session statistics", undefined, () =>
    import("./cli/cmd/stats").then((m) => m.StatsCommand),
  ))
  .command(lazyCommand("export [sessionID]", "export session data as JSON", undefined, () =>
    import("./cli/cmd/export").then((m) => m.ExportCommand),
  ))
  .command(lazyCommand("import <file..>", "import session data", undefined, () =>
    import("./cli/cmd/import").then((m) => m.ImportCommand),
  ))
  .command(lazyCommand("github", "manage GitHub agent", undefined, () =>
    import("./cli/cmd/github").then((m) => m.GithubCommand),
  ))
  .command(lazyCommand("pr <number>", "fetch and checkout a GitHub PR branch, then run opencode", undefined, () =>
    import("./cli/cmd/pr").then((m) => m.PrCommand),
  ))
  .command(lazyCommand("session", "manage sessions", undefined, () =>
    import("./cli/cmd/session").then((m) => m.SessionCommand),
  ))
  .command(lazyCommand("plugin <module>", "install plugin and update configuration", ["plug"], () =>
    import("./cli/cmd/plugin").then((m) => m.PluginCommand),
  ))
  .command(lazyCommand("db", "database tools", undefined, () =>
    import("./cli/cmd/db").then((m) => m.DbCommand),
  ))
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp(show)
    }
    if (err) throw err
    process.exit(1)
  })
  .strict()

try {
  if (args.includes("-h") || args.includes("--help")) {
    const out = await cli.getHelp()
    if (out) show(out)
  } else {
    await cli.parse()
  }
} catch (e) {
  const { FormatError } = await import("./cli/error")
  const { errorMessage } = await import("./util/error")
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error" + EOL)
    process.stderr.write(errorMessage(e) + EOL)
  }
  process.exitCode = 1
} finally {
  process.exit()
}
