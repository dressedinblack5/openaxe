# openaxe

> Lean TUI/CLI AI coding assistant — Effect v4, security-first, 52% fewer packages, zero Electron.

A fork of [anomalyco/opencode](https://github.com/anomalyco/opencode) that strips the bloat and keeps the power. Runs in your terminal, no cloud dependency.

![openaxe preview](../../screenshots/openaxe-preview.png)

## Reading Guide

New to openaxe? Here's what to read in order:

| If you want to... | Start here |
|---|---|
| **Try it now** | [Quick Start](#quick-start) → [User Guide](#user-guide) |
| **Understand the project** | [Features](#features) → [Architecture](#architecture) → [Security](#security) |
| **Configure your setup** | [Configuration](#configuration) → [Providers](#preinstalled-plugins) |
| **Extend openaxe** | [Plugin System](#plugins) → [External Plugins](#external-plugins) |
| **Compare with upstream** | [Advantages](#advantages-over-official-opencode) |
| **Develop openaxe** | [Architecture](#architecture) → repo `AGENTS.md` |

## Quick Start

### Prerequisites

- **Bun** 1.2+ — install via `curl -fsSL https://bun.sh/install | bash` (Linux/macOS) or `powershell -c "irm bun.sh/install.ps1 | iex"` (Windows)
- **Git** 2.30+ (for session/GitHub features)
- **Ripgrep** (optional, for faster codebase search)

### Install

**Linux / macOS**

```bash
# Preferred — one-liner
curl -fsSL https://raw.githubusercontent.com/dressedinblack5/openaxe/main/install | bash
```

**Windows**

**Option 1 — Pre-built binary (recommended)**

Download the latest `openaxe-windows-x64.zip` from the [releases page](https://github.com/dressedinblack5/openaxe/releases/latest), extract, and add to `PATH`.

**Option 2 — Install script (cmd.exe)**

```batch
curl -fsSLo install.bat https://raw.githubusercontent.com/dressedinblack5/openaxe/main/install.bat
install.bat
```

Downloads the right binary for your architecture, creates a desktop shortcut, and adds to PATH.

**Option 3 — PowerShell one-liner (via Git Bash)**

Requires [Git for Windows](https://git-scm.com) (provides Git Bash). Then in Git Bash:

```bash
curl -fsSL https://raw.githubusercontent.com/dressedinblack5/openaxe/main/install | bash
```

**Build from source**

```powershell
git clone https://github.com/dressedinblack5/openaxe.git
cd openaxe
bun install
.\packages\openaxe\bin\openaxe
```

### First Run

```bash
# Start the TUI in your project directory
cd my-project
openaxe

# Run a single prompt, non-interactive
openaxe run "explain this codebase"
```

## Features

- **Multi-provider LLM** — 15+ providers: Anthropic, OpenAI, Google, Groq, Mistral, AWS Bedrock, Azure, TogetherAI, xAI, DeepInfra, Perplexity, Cerebras, OpenRouter, Alibaba, Venice, GitLab, and more
- **Rich TUI** — SolidJS terminal UI via OpenTUI, session management, conversation history, keyboard-driven workflow
- **MCP & ACP** — Model Context Protocol server management and Agent Client Protocol server
- **Plugin system** — Extend with plugins from npm, local paths, or git URLs
- **Session management** — Persistent SQLite + Drizzle ORM, export/import, session fork/continue
- **GitHub integration** — PR fetch/checkout, GitHub agent for issue/PR operations
- **Headless server** — Background HTTP API server with optional web interface
- **All major platforms** — Linux, macOS, Windows (native binaries, AVX2/musl detection)
- **Durable agent memory** — SQLite-backed key-value store synced to project `AXE.md`, survives across sessions; **AxeMdSync/AxeSync round-trip fixed** so both list-item (`- **key**: value`) and free-text sections read/write correctly
- **Auto-verification guardrails** — automatic LSP diagnostics after every file mutation, plus `tsc`/`cargo`/`ruff`/`go vet`, bracket balance, and import validation; **bracket checker now skips `//` and `/* */` comments** and template strings to eliminate false positives
- **Predictive context prepper** — new `core/context-prepper` SystemContext source that runs `git diff HEAD --name-status` on each turn and injects `<recent_changes>` so the agent knows what changed before you ask
- **Versioned artifact store** — content-versioned storage for build outputs and generated files with TUI preview
- **Auto-commit** — automatic git commits at each AI mutation turn
- **Error journal** — tool errors logged to `.openaxe/errors.jsonl` for debugging
- **/revert** — undo AI file changes via snapshot-based rollback

## User Guide

```bash
openaxe --help
```

### Core

| Command | Description |
|---|---|
| `openaxe` [project] | Start the TUI (default) |
| `openaxe run <message>` | Run with a prompt, non-interactive |
| `openaxe serve` | Start headless server |
| `openaxe attach <url>` | Attach to a running server |
| `openaxe memory <action>` | Manage project memory (AXE.md) — list, set, get, remove |

### Providers & Models

| Command | Description |
|---|---|
| `openaxe providers` | Manage AI providers & credentials |
| `openaxe models` | List available models |
| `openaxe agent` | Manage agents |

### Sessions & Data

| Command | Description |
|---|---|
| `openaxe session` | Manage sessions |
| `openaxe stats` | Session statistics |
| `openaxe export` / `import` | Session data portability |
| `openaxe db` | Database tools |

### Extensions

| Command | Description |
|---|---|
| `openaxe mcp` | Manage MCP servers |
| `openaxe acp` | Start ACP server |
| `openaxe plugin` | Install/manage plugins |
| `openaxe github` | GitHub agent |
| `openaxe pr <number>` | Fetch and checkout a PR, then run openaxe |

### System

| Command | Description |
|---|---|
| `openaxe debug` | Debugging and troubleshooting |
| `openaxe upgrade` | Upgrade openaxe |
| `openaxe uninstall` | Uninstall and remove all files |

## Plugins

### Preinstalled Plugins

Ships with auth plugins for these providers — no npm install needed, just run `openaxe providers login <provider>`:

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

### External Plugins

Extend openaxe with custom tools, providers, TUI themes, or workspace adapters from npm:

```bash
openaxe plugin my-plugin          # from npm
openaxe plugin ./path/to/pkg      # from local file
openaxe plugin user/pkg           # from git
```

Plugins are npm packages that declare entrypoints in `package.json` under `exports["./server"]` or `exports["./tui"]`. Add them to `openaxe.jsonc`:

```jsonc
{
  "plugin": ["my-plugin"]
}
```

### Recommended Plugins

Auto-configured on first run. They auto-install the first time you run `openaxe`:

| Plugin | Description |
|---|---|
| **oh-my-openagent** | Agent orchestration: Sisyphus, Prometheus, Momus, Metis agents |
| **opencode-plugin-selector** | Interactive plugin manager |
| **opencode-vibeguard** | Safety guardrails for agent actions |
| **@tarquinen/opencode-dcp** | Context compression for long sessions |
| **ecc-universal** | Everything Claude Code — agents, skills, hooks, MCP, and rules |
| **ponytail** | Lazy senior dev mode — cuts boilerplate (local file; manual install) |

Write your own using the [@opencode-ai/plugin](https://www.npmjs.com/package/@opencode-ai/plugin) SDK.

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

## Built-in Tools

openaxe ships with a rich set of built-in tools that the AI assistant can invoke. The tool system supports 30+ tools covering file operations, code intelligence, shell execution, web access, and subagent delegation.

### LSP Code Intelligence — Native Tooling Arsenal

openaxe ships an **Effect-based native LSP client** (not an MCP wrapper) — direct JSON-RPC 2.0 over stdio with no intermediary. Provides diagnostics, navigation, and code actions directly to the tool system.

#### Architecture

```
src/lsp/
├── lsp.ts          Effect service (Interface + Service + layer), 23 methods, InstanceState-scoped
├── client.ts       JSON-RPC via vscode-jsonrpc, push+pull diagnostic merge, per-server debounce
├── server.ts       30+ builtin server definitions, 15 with auto-download
├── launch.ts       Child process spawn helper
├── diagnostic.ts   Diagnostics-to-string formatting
└── language.ts     Extension → languageId mapping
```

The tool bridge lives in `src/tool/lsp.ts` — exposes all operations to the AI assistant. Always available, no feature gate.

#### 17 Tool Operations

| Operation | LSP Request | What it does |
|---|---|---|
| `goToDefinition` | `textDocument/definition` | Find where a symbol is defined |
| `findReferences` | `textDocument/references` | Find all references to a symbol |
| `hover` | `textDocument/hover` | Get documentation and type info |
| `documentSymbol` | `textDocument/documentSymbol` | List all symbols in a document |
| `workspaceSymbol` | `workspace/symbol` | Search project-wide symbols |
| `goToImplementation` | `textDocument/implementation` | Find implementations of an interface/abstract |
| `prepareCallHierarchy` | `textDocument/prepareCallHierarchy` | Get call hierarchy entry point |
| `incomingCalls` | `callHierarchy/incomingCalls` | What calls this function |
| `outgoingCalls` | `callHierarchy/outgoingCalls` | What this function calls |
| `codeAction` | `textDocument/codeAction` | List available quick fixes and refactorings |
| `applyCodeAction` | `textDocument/codeAction` + edit | Apply a quick fix by title |
| `rename` | `textDocument/rename` | Rename symbol across the codebase |
| `prepareRename` | `textDocument/prepareRename` | Check if a symbol can be renamed |
| `typeDefinition` | `textDocument/typeDefinition` | Find the type definition (e.g. class of a variable) |
| `signatureHelp` | `textDocument/signatureHelp` | Get parameter info at a call site |
| `completion` | `textDocument/completion` | Get code completion suggestions |
| `formatting` | `textDocument/formatting` | Format a document |

**Common parameters:** Each operation accepts `filePath`, with `line`/`character` (1-based) for location-based ops. Operation-specific params: `query` (workspaceSymbol), `newName` (rename), `title` (applyCodeAction), `tabSize`/`insertSpaces` (formatting).

#### Patterns

- **InstanceState-scoped**: Single `State` object per open project (clients, servers, broken map, spawning map). Cleaned up on project close via `Effect.addFinalizer`.
- **Broken server retry**: Failed spawns tracked in a `broken` map with 5-minute TTL. After cooldown, the server is retried automatically.
- **Spawning dedup**: Concurrent spawns for the same server+root pair are deduplicated via an in-flight `spawning` map.
- **Error isolation**: All LSP requests catch errors to `null`/`[]` — transport errors never propagate to the caller.
- **Diagnostic merge**: Push diagnostics (from `textDocument/publishDiagnostics`) and pull diagnostics (on-demand) are merged per file, deduped by diagnostic message.

#### Auto-Verification Guardrail

Every file mutation (`edit`, `write`, `apply_patch`) automatically triggers `touchFile` + `diagnostics()` to surface errors to the AI immediately after the change. The `read` tool also refreshes LSP state on file open.

#### Server Management

30+ builtin language server definitions (TypeScript, Pyright, rust-analyzer, gopls, clangd, etc.), 15 with auto-download if the binary is missing. Lazily spawned per project root. Servers can be configured, overridden, or disabled via `openaxe.jsonc` under the `lsp` key.

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

- **Plugin permission system** — every capability (bash, file I/O, network, MCP) declared in config, enforced at runtime. No escalation beyond declared scope.
- **Zero phone-home** — no telemetry, no crash reporting, no analytics. LLM calls go directly to your provider.
- **BYO-key only** — no managed API keys. Credentials in `~/.local/share/openaxe/auth.json` (permissions 600). Prefer env vars (`OPENAI_API_KEY`, etc.).
- **MCP subprocess isolation** — MCP servers run as separate OS processes with no session/DB access.
- **Session data locality** — all data in local SQLite. No cloud sync. Full export/import control.
- **OpenTelemetry** — optional OTLP tracing for audit trails. Opt-in, never default-on.
- **Explicit upgrades** — `openaxe upgrade` is manual. No silent background updates.
- **No network by default** — server binds to `127.0.0.1:0` (random port). No daemon unless started.
- **`--pure` mode** — run without plugins to eliminate third-party code.
- **Supply chain** — native deps use `node-gyp rebuild` during install. For defense-in-depth: `bun install --ignore-scripts` + `bun audit`.

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

Contributions welcome — see `AGENTS.md` for development guidelines.

## Links

- [GitHub](https://github.com/dressedinblack5/openaxe)
- [Upstream](https://github.com/anomalyco/opencode)
