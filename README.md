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
  A fork of OpenCode that strips the bloat, crystalizes the power and embraces security.<br>
  Effect v4, security-first, 52% fewer packages.<br>
</p>

<p align="center">
  <img src="screenshots/openaxe-preview.png" alt="openaxe preview" width="720">
</p>

---

## Reading Guide

| Goal | Start with |
|---|---|
| Install and try openaxe | [Quick Start](#quick-start) |
| Understand the project | [Features](#features) → [Architecture](packages/openaxe/README.md#architecture) → [Security](#security) |
| Browse available commands | [User Guide](packages/openaxe/README.md#user-guide) |
| Set up providers | [Preinstalled Plugins](#preinstalled-plugins) |
| Extend openaxe | [External Plugins](#external-plugins) |
| See how it differs from upstream | [Advantages](#advantages-over-official-opencode) |

## Quick Start

### Prerequisites

- **Bun** 1.2+ — `curl -fsSL https://bun.sh/install | bash` (Linux/macOS) or `powershell -c "irm bun.sh/install.ps1 | iex"` (Windows)
- **Git** 2.30+

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/dressedinblack5/openaxe/dev/install | bash
```

Installs `openaxe` to `~/.local/bin` and sets up a desktop entry.

### Windows

**Option 1 — Pre-built binary (recommended)**

Download the latest `openaxe-windows-x64.zip` from the [releases page](https://github.com/dressedinblack5/openaxe/releases/latest), extract, and add to `PATH`.

**Option 2 — PowerShell one-liner (via Git Bash)**

```powershell
# Requires Git for Windows (git-scm.com) which provides Git Bash
# Then in Git Bash:
curl -fsSL https://raw.githubusercontent.com/dressedinblack5/openaxe/dev/install | bash
```

**Option 3 — Build from source**

```powershell
git clone https://github.com/dressedinblack5/openaxe.git
cd openaxe
bun install
.\packages\openaxe\bin\openaxe
```

### Pre-built Binary

Download the archive for your platform from the [latest release](https://github.com/dressedinblack5/openaxe/releases/latest), extract it, and place the binary in your `PATH`:

| Platform | Archive |
|---|---|
| Linux x64 | `openaxe-linux-x64.tar.gz` |
| Linux x64 (AVX2) | `openaxe-linux-x64.tar.gz` (preferred on modern CPUs) |
| Linux arm64 | `openaxe-linux-arm64.tar.gz` |
| macOS x64 | `openaxe-darwin-x64.tar.gz` |
| macOS arm64 | `openaxe-darwin-arm64.tar.gz` |
| Windows x64 | `openaxe-windows-x64.zip` |

```bash
# Linux / macOS
tar xzf openaxe-*.tar.gz
mv openaxe ~/.local/bin/

# Windows
# Extract the zip and add the folder to your PATH
```

### First Run

```bash
cd my-project
openaxe                  # launch TUI
openaxe run "summarize this codebase"  # non-interactive
```

## Features

- **Multi-provider LLM support** — 15+ providers (Anthropic, OpenAI, Google, Groq, Mistral, AWS Bedrock, Azure, TogetherAI, xAI, DeepInfra, Perplexity, Cerebras, OpenRouter, Alibaba, Venice, and more)
- **Rich TUI** — SolidJS terminal UI with session management, conversation history, keyboard-driven workflow
- **MCP & ACP** — Model Context Protocol server management and Agent Client Protocol server
- **Plugin system** — Extend behavior with plugins from npm, local paths, or git URLs
- **Session management** — Persistent sessions with SQLite + Drizzle ORM, export/import, fork/continue
- **GitHub integration** — PR fetch/checkout, GitHub agent for issue/PR operations
- **Headless server** — Run as background server with HTTP API and optional web UI
- **All major platforms** — Linux, macOS, Windows (native binaries with AVX2/musl detection)

## Preinstalled Plugins

openaxe ships with auth plugins for these providers — no npm install needed, just run `openaxe providers login <provider>`:

| Plugin | Provider |
|---|---|
| **Codex** | OpenAI Codex (o1, o3, GPT) |
| **GitHub Copilot** | GitHub Copilot chat models |
| **GitLab** | GitLab Duo Agent Platform |
| **Poe** | Poe by Quora |
| **Cloudflare Workers AI** | Cloudflare Workers AI inference |
| **Cloudflare AI Gateway** | Cloudflare AI Gateway (multi-provider proxy) |
| **Azure** | Azure OpenAI Service |
| **DigitalOcean** | DigitalOcean GPU Droplets / Paperspace |
| **Snowflake Cortex** | Snowflake Cortex AI |
| **xAI** | xAI Grok models |

## External Plugins

Extend openaxe with custom tools, providers, TUI themes, or workspace adapters from npm.

```bash
openaxe plugin my-plugin          # from npm
openaxe plugin ./path/to/pkg      # from local file
openaxe plugin user/pkg           # from git
```

Plugins are npm packages that declare entrypoints in `package.json` under `exports["./server"]` or `exports["./tui"]`:

```jsonc
{ "plugin": ["my-plugin"] }
```

### Recommended Plugins

Auto-configured on first run. They auto-install the first time you run `openaxe`:

| Plugin | Description |
|---|---|
| **oh-my-openagent** | Agent orchestration: Sisyphus, Prometheus, Momus, Metis agents |
| **opencode-plugin-selector** | Interactive plugin manager for discovering and installing plugins |
| **superpowers** | Skill system — pluggable agent capabilities (brainstorming, TDD, debugging, etc.) |
| **opencode-vibeguard** | Safety guardrails for agent actions |
| **@tarquinen/opencode-dcp** | Context compression — stay under context limits during long sessions |
| **ponytail** | Lazy senior dev mode — cuts boilerplate and over-engineering (local file plugin; manual install) |

Write your own using the [@opencode-ai/plugin](https://www.npmjs.com/package/@opencode-ai/plugin) SDK.

## Configuration

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

Configure via `.openaxe/openaxe.jsonc` in your project root. See the [full guide](packages/openaxe/README.md#configuration) for details.

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

## Security

- **Plugin permission system** — every capability (bash, file I/O, network, MCP) declared in config and enforced at runtime. No escalation beyond declared scope.
- **Zero phone-home** — no telemetry, no crash reporting, no analytics. LLM calls go directly to your configured provider endpoint.
- **BYO-key only** — no managed API keys. Credentials in `~/.local/share/openaxe/auth.json` (permissions 600). Prefer env vars (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`).
- **MCP subprocess isolation** — MCP servers run as separate OS processes with no access to session database or config.
- **Session data locality** — all data in local SQLite. No cloud sync. Full export/import control.
- **OpenTelemetry** — optional OTLP tracing for audit trails. Opt-in, never on by default.
- **Explicit upgrades** — `openaxe upgrade` is manual. No silent background updates.
- **No network by default** — server binds to `127.0.0.1:0` (random port). No daemon unless started.
- **`--pure` mode** — run without plugins to eliminate all third-party code.
- **Supply chain** — native deps use `node-gyp rebuild` during install. For defense-in-depth: `bun install --ignore-scripts` + `bun audit`.

<p align="center"><a href="https://github.com/dressedinblack5/openaxe">dressedinblack5/openaxe</a></p>
