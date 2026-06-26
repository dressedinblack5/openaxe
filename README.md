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
  A fork of OpenCode that strips the bloat, crystalizes the power and embrace security.<br>
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

## Preinstalled Plugins

openaxe ships with auth plugins for these providers — no npm install needed, just run `openaxe providers`:

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

Run `openaxe providers login <provider>` to authenticate any of these.

## External Plugins

Extend openaxe with custom tools, providers, TUI themes, or workspace adapters from npm.

```bash
openaxe plugin my-plugin          # from npm
openaxe plugin ./path/to/pkg      # from local file
openaxe plugin user/pkg           # from git
```

Plugins are npm packages (or local directories) that declare their entrypoints in `package.json` under `exports["./server"]` or `exports["./tui"]`. Add them to `openaxe.jsonc`:

```jsonc
{
  "plugin": ["my-plugin"]
}
```

### Recommended Plugins

These are pre-configured in the auto-generated first-run config. They auto-install on the first `openaxe` command after init:

| Plugin | Description |
|---|---|
| **oh-my-openagent** | Agent orchestration: Sisyphus, Prometheus, Momus, Metis agents |
| **opencode-plugin-selector** | Interactive plugin manager for discovering and installing plugins |
| **superpowers** | Skill system — pluggable agent capabilities (brainstorming, TDD, debugging, etc.) |
| **opencode-vibeguard** | Safety guardrails for agent actions |
| **@tarquinen/opencode-dcp** | Context compression — stay under context limits during long sessions |
| **ponytail** | Lazy senior dev mode — cuts boilerplate and over-engineering (local file plugin; manual install) |

Write your own plugins using the [@opencode-ai/plugin](https://www.npmjs.com/package/@opencode-ai/plugin) SDK. See the [plugin API docs](/packages/plugin/README.md) for details.

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

<p align="center"><a href="https://github.com/dressedinblack5/openaxe">dressedinblack5/openaxe</a></p>
