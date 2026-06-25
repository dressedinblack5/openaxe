# openaxe

**openaxe** is a lean TUI/CLI AI coding assistant — a fork of [anomalyco/opencode](https://github.com/anomalyco/opencode) with Effect v4 throughout, security-first architecture, and 52% fewer packages. Runs in your terminal, no Electron, no cloud dependency.

## Features

- **Multi-provider LLM support** — 15+ providers (Anthropic, OpenAI, Google, Groq, Mistral, AWS Bedrock, Azure, TogetherAI, xAI, DeepInfra, Perplexity, Cerebras, OpenRouter, Alibaba, Venice, GitLab, OpenAIAuth, and more)
- **Rich TUI** — SolidJS terminal UI via OpenTUI framework with session management, conversation history, and keyboard-driven workflow
- **MCP & ACP** — Model Context Protocol server management and Agent Client Protocol server
- **Plugin system** — Extend behavior with plugins loaded from npm, local paths, or git URLs
- **Session management** — Persistent sessions with SQLite + Drizzle ORM, export/import, session fork/continue
- **GitHub integration** — PR fetch/checkout, GitHub agent for issue/PR operations
- **Headless server** — Run as a background server with HTTP API and optional web interface
- **Web interface** — Built-in web UI via `opencode web`
- **All major platforms** — Linux, macOS, Windows (native binaries with AVX2/musl detection)

## Quick Start

```bash
# Install via curl (preferred)
curl -fsSL https://openaxe.dev/install.sh | sh

# Or from source
git clone https://github.com/dressedinblack5/openaxe.git
cd openaxe
bun install
bun run --cwd packages/opencode src/index.ts
```

## User Guide

Run `opencode --help` to see all commands:

| Command | Description |
|---|---|
| `opencode` [project] | Start the TUI (default) |
| `opencode run <message>` | Run with a prompt, non-interactive |
| `opencode serve` | Start headless server |
| `opencode web` | Start server with web UI |
| `opencode attach <url>` | Attach to a running server |
| `opencode mcp` | Manage MCP servers |
| `opencode acp` | Start ACP server |
| `opencode providers` | Manage AI providers & credentials |
| `opencode agent` | Manage agents |
| `opencode session` | Manage sessions |
| `opencode github` | GitHub agent |
| `opencode pr <number>` | Fetch and checkout a PR, then run openaxe |
| `opencode models` | List available models |
| `opencode stats` | Session statistics |
| `opencode export/import` | Session data portability |
| `opencode plugin` | Install/manage plugins |
| `opencode upgrade` | Upgrade openaxe |
| `opencode db` | Database tools |

## Configuration

Configure via `.opencode/opencode.jsonc` in your project root:

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

## Architecture

The monorepo ships 13 packages:

| Package | Role |
|---|---|
| `opencode` | CLI orchestrator — yargs entry, lazy-loaded commands |
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

## Performance

| Metric | Value |
|---|---|
| `bun install` | ~5.3s |
| `turbo typecheck` | ~18.4s |
| `node_modules` | ~1.1 GB |
| Packages | 13 (52% fewer than upstream) |
| Architecture | TUI/CLI only — no Electron, no web apps |

## Security

- No Electron, no browser `dialog.showOpenDialog`, no hybrid components
- No web application attack surface (no Astro/Starlight/Storybook/SST Cloud)
- Plugin sandboxing via permission system
- All plugins audited for TUI/CLI compliance
- OpenTelemetry tracing for audit

## Links

- [GitHub](https://github.com/dressedinblack5/openaxe)
- [Upstream](https://github.com/anomalyco/opencode)
