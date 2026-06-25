<p align="center">
  <a href="https://github.com/dressedinblack5/openaxe">
    <img src="https://img.shields.io/badge/dressedinblack5/openaxe-6C47FF?style=for-the-badge&logo=github&logoColor=fff" alt="openaxe">
  </a>
</p>

<p align="center">
  <a href="https://github.com/anomalyco/opencode"><img src="https://img.shields.io/github/v/release/anomalyco/opencode?style=flat-square&label=upstream" alt="upstream"></a>
  <a href="https://github.com/dressedinblack5/openaxe/compare"><img src="https://img.shields.io/github/commits-since/anomalyco/opencode/dev?style=flat-square&label=ahead" alt="ahead"></a>
  <a href="https://github.com/dressedinblack5/openaxe"><img src="https://img.shields.io/github/last-commit/dressedinblack5/openaxe?style=flat-square&color=brightgreen&label=updated" alt="updated"></a>
</p>

<p align="center">
  <strong>openaxe</strong> — lean TUI/CLI AI coding assistant.<br>
  A fork of OpenCode that strips the bloat, keeps the power.<br>
  Effect v4, security-first, 52% fewer packages.<br>
</p>

---

## Features

- **Multi-provider LLM support** — 15+ providers (Anthropic, OpenAI, Google, Groq, Mistral, AWS Bedrock, Azure, TogetherAI, xAI, DeepInfra, Perplexity, Cerebras, OpenRouter, Alibaba, Venice, and more)
- **Rich TUI** — SolidJS terminal UI with session management, conversation history, keyboard-driven workflow
- **MCP & ACP** — Model Context Protocol server management and Agent Client Protocol server
- **Plugin system** — Extend behavior with plugins from npm, local paths, or git URLs
- **Session management** — Persistent sessions with SQLite + Drizzle ORM, export/import, fork/continue
- **GitHub integration** — PR fetch/checkout, GitHub agent for issue/PR operations
- **Headless server** — Run as background server with HTTP API and optional web UI
- **All major platforms** — Linux, macOS, Windows (native binaries with AVX2/musl detection)

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

## Quick Start

Requires [Bun](https://bun.sh) and `git`.

```bash
curl -fsSL https://raw.githubusercontent.com/dressedinblack5/openaxe/dev/install | bash
```

**From source:**

```bash
git clone https://github.com/dressedinblack5/openaxe.git
cd openaxe
bun install
bun run --cwd packages/openaxe src/index.ts
```

## CLI Commands

Run `openaxe --help` to see all commands. Main ones:

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
| `openaxe session` | Manage sessions |
| `openaxe github` | GitHub agent |
| `openaxe pr <number>` | Fetch and checkout a PR |
| `openaxe plugin` | Install/manage plugins |
| `openaxe upgrade` | Upgrade openaxe |

## Configuration

Configure via `.openaxe/openaxe.jsonc` in your project root:

```jsonc
{
  "model": "provider/model-name",
  "plugin": ["plugin-name"],
  "mcp": {
    "my-server": { "type": "local", "command": "npx", "args": ["-y", "@org/mcp-server"] }
  },
  "permission": { "bash": "allow" }
}
```

## Security

- TUI/CLI-only — no Electron, no web apps, no cloud infrastructure
- No web application attack surface (no Astro/Starlight/Storybook/SST Cloud)
- Plugin sandboxing via permission system
- All plugins audited for TUI/CLI compliance
- OpenTelemetry tracing for audit
- <1.2GB total dependencies

<p align="center"><a href="https://github.com/dressedinblack5/openaxe">dressedinblack5/openaxe</a></p>
