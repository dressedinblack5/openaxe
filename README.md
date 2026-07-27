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

## Quick Start

```bash
# Install (Linux/macOS)
curl -fsSL https://raw.githubusercontent.com/dressedinblack5/openaxe/main/install | bash

# Run in your project
cd my-project
openaxe
```

Set your provider API key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.) and you're off. See the [full guide](packages/openaxe/README.md#quick-start) for Windows, build-from-source, and prerequisites.

---

## Reading Guide

| Goal | Start with |
|-----|---|
| Understand the project | [Features](#features) → [Architecture](packages/openaxe/README.md#architecture) → [Security](#security) |
| Browse available commands | [User Guide](packages/openaxe/README.md#user-guide) |
| Set up providers | [Preinstalled Plugins](#preinstalled-plugins) |
| Extend openaxe | [External Plugins](#external-plugins) |
| See how it differs from upstream | [Advantages](#advantages-over-official-opencode) |

---

## ✨ Features

- **Multi-provider LLM support** — 15+ providers (Anthropic, OpenAI, Google, Groq, Mistral, AWS Bedrock, Azure, TogetherAI, xAI, DeepInfra, Perplexity, Cerebras, OpenRouter, Alibaba, Venice, and more)
- **Rich TUI** — SolidJS terminal UI with session management, conversation history, keyboard-driven workflow
- **MCP & ACP** — Model Context Protocol server management and Agent Client Protocol server
- **LSP native tooling arsenal** — Effect-based native LSP client (not an MCP wrapper), runs 17 code intelligence operations across 30+ builtin language servers. Every file mutation triggers automatic diagnostics. See [LSP details](#-lsp-native-tooling-arsenal) below.
- **Plugin system** — Extend behavior with plugins from npm, local paths, or git URLs
- **Session management** — Persistent sessions with SQLite + Drizzle ORM, export/import, fork/continue
- **GitHub integration** — PR fetch/checkout, GitHub agent for issue/PR operations
- **Headless server** — Run as background server with HTTP API and optional web UI
- **All major platforms** — Linux, macOS, Windows (native binaries with AVX2/musl detection)
- **Durable agent memory** — SQLite-backed key-value store synced to project `AXE.md`, persists across sessions
- **Auto-verification guardrails** — automatic LSP diagnostics + `tsc`/`cargo`/`ruff`/`go vet` after every file mutation
- **Versioned artifact store** with TUI preview
- **Auto-commit**, **error journal**, **/revert** — productivity trio for AI change management
- **Learning review** — post-turn background eval that auto-discovers skill and observation updates from each interaction (opt-in via `experimental.learning.review`)
- **Context compressor** — LLM-driven structured compression with ghost-skill re-injection: produces sectioned summaries that preserve agent context across long sessions (opt-in via `experimental.compressor.enabled`)

---

## 🧰 Native LSP

openaxe ships an **Effect-based native LSP client** that communicates directly with language servers over JSON-RPC 2.0 stdio — no MCP wrapper, no intermediary. It provides code intelligence to the AI assistant through 17 operations and auto-verifies every file mutation via diagnostics.

### Architecture

```
src/lsp/
├── lsp.ts          Effect service (Interface + Service + layer), 23 methods, InstanceState-scoped
├── client.ts       JSON-RPC via vscode-jsonrpc, push+pull diagnostic merge, per-server debounce
├── server.ts       30+ builtin server definitions, 15 with auto-download
├── launch.ts       Child process spawn helper
├── diagnostic.ts   Diagnostics-to-string formatting
└── language.ts     Extension → languageId mapping
```

The `lsp` tool (in `src/tool/lsp.ts`) exposes all operations to the AI. Always available, no feature gate.

### 17 Operations

| Operation | What it does |
|---|---|
| `goToDefinition` | Find where a symbol is defined |
| `findReferences` | Find all references to a symbol |
| `hover` | Get documentation and type info at cursor |
| `documentSymbol` | List all symbols (functions, classes, variables) in a document |
| `workspaceSymbol` | Search project-wide symbols by query |
| `goToImplementation` | Find implementations of an interface or abstract method |
| `prepareCallHierarchy` | Get call hierarchy entry point at a position |
| `incomingCalls` / `outgoingCalls` | What calls this function / what it calls |
| `codeAction` / `applyCodeAction` | List and apply quick fixes, auto-imports, refactorings |
| `rename` / `prepareRename` | Rename a symbol across the codebase |
| `typeDefinition` | Find the type definition (e.g., the class of a variable) |
| `signatureHelp` | Get parameter info at a call site |
| `completion` | Get code completion suggestions |
| `formatting` | Format a document |

### Key Patterns

- **InstanceState-scoped**: Per-project state (clients, servers, broken map). Cleaned up on project close via `Effect.addFinalizer`.
- **Broken server retry**: Failed spawns tracked with 5-minute TTL. After cooldown, the server is retried automatically.
- **Spawning dedup**: Concurrent spawns for the same server+root pair are deduplicated.
- **Error isolation**: All LSP requests catch errors to `null`/`[]` — transport errors never propagate to the caller.
- **Diagnostic merge**: Push diagnostics (from `textDocument/publishDiagnostics`) merged with on-demand pull diagnostics, deduped by message.

### Server Support

**30+ builtin language servers** spanning all major languages. 15 include auto-download when the binary is missing:

TypeScript, Pyright, rust-analyzer, gopls, clangd, Biome, ESLint, Deno, Svelte, Astro, Vue, Ruby (rubocop), ElixirLS, Zls (Zig), C# (Roslyn), F#, Kotlin, Java (JDTLS), Dart, PHP (Intelephense), Lua, Bash, Terraform, Dockerfile, Prisma, Ocaml, Gleam, Clojure, Nix, Typst (Tinymist), Haskell, Julia, and SourceKit (Swift).

Servers can be configured, overridden, or disabled per-project via `openaxe.jsonc` under the `lsp` key.

### Auto-Verification Guardrail

Every file mutation (`edit`, `write`, `apply_patch`) automatically opens the file in LSP and fetches diagnostics — surfacing compile errors, type errors, and lint issues to the AI immediately after the change. The `read` tool also refreshes LSP state when opening a file.

---

## 🧠 Hermes-Inspired Intelligence

Two optional systems ported from the [Hermes agent](https://github.com/NousResearch/hermes-agent) architecture:

### Learning Review (`packages/openaxe/src/session/learning/`)

A post-turn background task that evaluates completed interactions to automatically discover skill updates and observations. Fire-and-forget — no blocking.

```jsonc
{
  "experimental": {
    "learning": {
      "review": true,        // enable post-turn learning eval
      "model": "provider/model"  // optional: separate model for reviews
    }
  }
}
```

### Context Compressor (`packages/openaxe/src/session/compressor/`)

LLM-driven structured compression with ghost-skill re-injection. Produces sectioned summaries (decisions, code changes, context, unresolved items) and tracks which skills were referenced — so the agent retains awareness of its toolset after compaction.

```jsonc
{
  "experimental": {
    "compressor": {
      "enabled": true,       // enable LLM-driven structured compression
      "model": "provider/model" // optional: separate model for compression
    }
  }
}
```

---

## 🔒 Security

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

---

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

### Installed Plugins

Auto-configured on first run. They auto-install the first time you run `openaxe`:

| Plugin | Description |
|---|---|
| **oh-my-openagent** | Agent orchestration: Sisyphus, Prometheus, Momus, Metis agents |
| **opencode-plugin-selector** | Interactive plugin manager for discovering and installing plugins |
| **opencode-vibeguard** | Safety guardrails for agent actions |
| **@tarquinen/opencode-dcp** | Context compression — stay under context limits during long sessions |
| **ecc-universal** | Everything Claude Code — battle-tested agents, skills, hooks, MCP, and rules |
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

<p align="center"><a href="https://github.com/dressedinblack5/openaxe">dressedinblack5/openaxe</a></p>
