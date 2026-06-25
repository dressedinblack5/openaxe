# openaxe

## Package Overview

This is the `opencode` orchestrator package (name kept for directory consistency) from the **dressedinblack5/openaxe** fork. It assembles the lean TUI/CLI-only architecture — no Electron, no web apps, no cloud infrastructure. The monorepo ships 13 packages (52% fewer than upstream) with security-first design principles and Effect v4 throughout.

## Packages

| Package | Role | Key Dependencies |
|---|---|---|
| `opencode` | CLI orchestrator — yargs entry point, lazy-loaded command dispatch, startup profiling | `@llm`, `@plugin`, `@schema`, `@tui`, `@server`, `@sdk` |
| `cli` | Alternative Effect-runtime CLI with subcommand handlers | `@core`, `@sdk`, `@server`, `@tui` |
| `core` | Hub — session/agent/project/tool orchestration, database, permissions, event store with pruning | `@effect-drizzle-sqlite`, `@llm`, `@schema`, `@plugin` |
| `llm` | LLM integrations — 15+ providers, 6 protocol adapters | `@schema`, `effect` |
| `schema` | Data validation schemas (Effect) | `effect` |
| `plugin` | Plugin system — tool, tui, effect, promise entry points | `@sdk`, `effect` |
| `tui` | SolidJS terminal UI via OpenTUI framework | `@core`, `@plugin`, `@ui`, `@opentui/*` |
| `ui` | SolidJS component library (shared, consumed by TUI) | `@kobalte/core`, `solid-js`, various libraries |
| `server` | Server functionality | `@core`, `effect` |
| `sdk` | Generated JS SDK (standalone) | — |
| `script` | Utility package (semver) | — |
| `effect-drizzle-sqlite` | SQLite database layer — Drizzle ORM + Effect | `drizzle-orm`, `effect` |
| `http-recorder` | Record/replay HTTP traffic for testing | `@effect/platform-node` |

## Dependency Flow

```
@schema ──┐
           ├──> @llm ──┐
@script ──┘            │
@effect-drizzle-sqlite ─┤
@http-recorder ─────────┤
                        ├──> @core ──> @server
@plugin ────────────────┤
@ui ──> @tui ───────────┤
                        └──> @opencode (CLI entry)
```

## Plugins

Loaded via `.opencode/opencode.jsonc`:

- **opencode-vibeguard** — Prevents agent drift from project conventions
- **ponytail** — Lazy senior dev mode (YAGNI/stdlib-first/minimal-code)
- **oh-my-openagent** — Configurable agent persona, styled conversation
- **opencode-plugin-selector** — Enable/disable plugins from TUI
- **superpowers** — Skill-awareness, TDD, debugging, code review
- **@tarquinen/opencode-dcp** — Automatic context pruning
- **ecc-universal** — Claude Code compatibility

**MCP Servers:** `context7` (live docs), `github` (full GitHub API)

## Performance

| Metric | Upstream | This Fork |
|---|---|---|
| Packages | 27 | **13** (52% fewer) |
| `bun install` | ~15-20s | **5.3s** |
| `turbo typecheck` | ~45-60s | **18.4s** |
| node_modules | ~2+ GB | **1.1 GB** |

## Security

### Removed Attack Surface
- **Electron** — Desktop spoofing and privilege escalation
- **Storybook** — Component discovery and XSS vectors
- **Astro/Starlight** — Documentation injection attacks
- **SST Cloud** — Infrastructure compromise vectors
- **SolidJS web apps** — Web application attack surface

### Prohibited
- No `*.astro`, `*.vue`, `*.svelte`, `*.html` files
- No `BrowserWindow`, `dialog.showOpenDialog` usage
- No hybrid components or electron references
- All plugins audited for TUI/CLI compliance

## Maintenance

```bash
# Install lean TUI/CLI version
./scripts/tui-lean/install-lean.sh
# Verify pure TUI/CLI architecture
./scripts/tui-lean/verify-lean.sh
# Performance monitoring
./scripts/tui-lean/performance-dashboard.sh start
# Security & vulnerability audit
./scripts/audit-deps.sh
# Safe upstream sync
./scripts/sync-upstream.sh
```

## Installation

```bash
git clone https://github.com/dressedinblack5/openaxe.git
    cd openaxe
bun install
bun run --cwd packages/opencode src/index.ts
```

## Links

- [GitHub Repository](https://github.com/dressedinblack5/openaxe)
- [Upstream](https://github.com/anomalyco/opencode)