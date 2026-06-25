process.title = "openaxe"

import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { GenerateCommand } from "./cli/cmd/generate"
import { UninstallCommand } from "./cli/cmd/uninstall"
import { UI } from "./cli/ui"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { FormatError } from "./cli/error"
import { GithubCommand } from "./cli/cmd/github"
import { AttachCommand } from "./cli/cmd/attach"
import { TuiCommand } from "./cli/cmd/tui"
import { AcpCommand } from "./cli/cmd/acp"
import { EOL } from "os"
import { WebCommand } from "./cli/cmd/web"
import { PrCommand } from "./cli/cmd/pr"
import { SessionCommand } from "./cli/cmd/session"
import { DbCommand } from "./cli/cmd/db"
import { errorMessage } from "./util/error"
import { PluginCommand } from "./cli/cmd/plugin"
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
  .command(AcpCommand)
  .command(lazyCommand("mcp", "manage MCP (Model Context Protocol) servers", undefined, () =>
    import("./cli/cmd/mcp").then((m) => m.McpCommand),
  ))
  .command(TuiCommand)
  .command(AttachCommand)
  .command(lazyCommand("run [message..]", "run openaxe with a message", undefined, () =>
    import("./cli/cmd/run").then((m) => m.RunCommand),
  ))
  .command(GenerateCommand)
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
  .command(UninstallCommand)
  .command(lazyCommand("serve", "starts a headless openaxe server", undefined, () =>
    import("./cli/cmd/serve").then((m) => m.ServeCommand),
  ))
  .command(WebCommand)
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
  .command(GithubCommand)
  .command(PrCommand)
  .command(SessionCommand)
  .command(PluginCommand)
  .command(DbCommand)
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
    await cli.parse(args, (err: Error | undefined, _argv: unknown, out: string) => {
      if (err) throw err
      if (!out) return
      show(out)
    })
  } else {
    await cli.parse()
  }
} catch (e) {
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error" + EOL)
    process.stderr.write(errorMessage(e) + EOL)
  }
  process.exitCode = 1
} finally {
  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses.
  process.exit()
}
