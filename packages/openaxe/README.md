# openaxe

**openaxe** is a lean TUI/CLI AI coding assistant — a fork of [anomalyco/opencode](https://github.com/anomalyco/opencode) that strips the bloat and keeps the power. Effect v4 throughout, security-first architecture, 52% fewer packages. Runs in your terminal, no Electron, no cloud dependency.

## Features

- **Multi-provider LLM support** — 15+ providers (Anthropic, OpenAI, Google, Groq, Mistral, AWS Bedrock, Azure, TogetherAI, xAI, DeepInfra, Perplexity, Cerebras, OpenRouter, Alibaba, Venice, GitLab, OpenAIAuth, and more)
- **Rich TUI** — SolidJS terminal UI via OpenTUI framework with session management, conversation history, and keyboard-driven workflow
- **MCP & ACP** — Model Context Protocol server management and Agent Client Protocol server
- **Plugin system** — Extend behavior with plugins loaded from npm, local paths, or git URLs
- **Session management** — Persistent sessions with SQLite + Drizzle ORM, export/import, session fork/continue
- **GitHub integration** — PR fetch/checkout, GitHub agent for issue/PR operations
- **Headless server** — Run as a background server with HTTP API and optional web interface
- **Web interface** — Built-in web UI via `openaxe web`
- **All major platforms** — Linux, macOS, Windows (native binaries with AVX2/musl detection)

## Quick Start

```bash
# Install via curl (preferred)
curl -fsSL https://openaxe.dev/install.sh | sh

# Or from source
git clone https://github.com/dressedinblack5/openaxe.git
cd openaxe
bun install
bun run --cwd packages/openaxe src/index.ts
```

## User Guide

Run `openaxe --help` to see all commands:

| Command | Description |
|---|---|
| `openaxe` [project] | Start the TUI (default) |
| `openaxe run <message>` | Run with a prompt, non-interactive |
| `openaxe serve` | Start headless server |
| `openaxe web` | Start server with web UI |
| `openaxe attach <url>` | Attach to a running server |
| `openaxe mcp` | Manage MCP servers |
| `openaxe acp` | Start ACP server |
| `openaxe providers` | Manage AI providers & credentials |
| `openaxe agent` | Manage agents |
| `openaxe session` | Manage sessions |
| `openaxe github` | GitHub agent |
| `openaxe pr <number>` | Fetch and checkout a PR, then run openaxe |
| `openaxe models` | List available models |
| `openaxe stats` | Session statistics |
| `openaxe export/import` | Session data portability |
| `openaxe plugin` | Install/manage plugins |
| `openaxe upgrade` | Upgrade openaxe |
| `openaxe db` | Database tools |

## Configuration

Configure via `.openaxe/openaxe.jsonc` in your project root:

```jsonc
{
  "model": "provider/model-name",
  "plugin": ["plugin-name"],
  "mcp": {
    "my-server": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@org/mcp-server"]
    }
  },
  "permission": {
    "bash": "allow"
  }
}
```

## Advantages Over Official OpenCode

| | openaxe | official opencode |
|---|---|---|
| **Monorepo size** | 13 packages | 27 |
| **Dependency footprint** | ~1.1 GB | ~2 GB+ |
| **Architecture** | TUI/CLI only | TUI + Electron + web apps |
| **Effects** | Effect v4 throughout | Mixed patterns |
| **Plugin audit** | All plugins reviewed for TUI/CLI compliance | Unrestricted |
| **Security surface** | No Electron, no web app attack surface | Electron + Astro/Starlight/Storybook/SST Cloud |
| **Startup** | Lazy-loaded CLI commands | Eager imports |
| **Identity** | Renamed project-wide (`openaxe`) | N/A |

## Architecture

The monorepo ships 13 packages:

| Package | Role |
|---|---|
| `openaxe` | CLI orchestrator — yargs entry, lazy-loaded commands |
| `core` | Session/agent/project/tool orchestration, DB, permissions |
| `llm` | LLM integrations — 15+ providers, 6 protocol adapters |
| `tui` | SolidJS terminal UI via OpenTUI |
| `ui` | Shared SolidJS component library |
| `schema` | Data validation schemas (Effect) |
| `server` | HTTP server and API |
| `plugin` | Plugin system — tool, TUI, effect, promise entry points |
| `sdk` | Generated JS SDK |
| `cli` | Alternative Effect-runtime CLI |
| `effect-drizzle-sqlite` | SQLite layer — Drizzle ORM + Effect |
| `http-recorder` | Record/replay HTTP for testing |
| `script` | Utility package |

## Security

- **Plugin permission system** — every plugin capability (bash, file I/O, network, MCP) must be declared in config and is enforced at runtime. No plugin can escalate beyond its declared scope.
- **Zero phone-home** — no telemetry, no crash reporting, no analytics. All LLM calls go directly to your configured provider endpoint with no intermediary.
- **BYO-key only** — no managed API keys, no cloud billing. Credentials stored in plaintext in `~/.local/share/openaxe/auth.json` (permissions 600). Prefer environment variables where available (e.g., `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`).
- **MCP subprocess isolation** — MCP servers run as separate OS processes with no access to the session database or config. However they inherit the parent process's user and filesystem access — only add MCP servers you trust.
- **Session data locality** — all sessions, logs, and artifacts stored in local SQLite. No cloud sync. Full control via `export`/`import`.
- **Auditable via OpenTelemetry** — optional OTLP tracing for audit trails. Opt-in, never on by default.
- **Explicit upgrades only** — `openaxe upgrade` is a manual command. No silent background updates.
- **No network by default** — server binds to `127.0.0.1` with port `0` (random). No daemon unless you start one.
- **`--pure` mode** — run without any plugins to eliminate all third-party code from the session.
- **Architecture** — TUI/CLI-only. No Electron, no browser runtime, no cloud SDKs. 52% fewer packages than upstream for a verifiably minimal supply chain.
- **Supply chain awareness** — native dependencies (e.g., tree-sitter) run `node-gyp rebuild` during install, fetching and compiling code from npm. For defense-in-depth, use `npm install --ignore-scripts` / `bun install --ignore-scripts` and audit with `npm audit` or `bun audit`.

## Links

- [GitHub](https://github.com/dressedinblack5/openaxe)
- [Upstream](https://github.com/anomalyco/opencode)
