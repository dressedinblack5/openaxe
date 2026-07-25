# CLI Command Infrastructure

## Overview

Yargs-based CLI with 22 lazy-loaded commands. Entry point is `src/index.ts`; command definitions live in `cmd/`.

## Structure

```
src/cli/
├── bootstrap.ts        — application bootstrap
├── effect-cmd.ts       — Effect command helpers
├── error.ts            — error formatting
├── heap.ts             — memory profiling
├── lazy-command.ts     — lazy-loading yargs subcommand helper
├── native-lib.ts       — native library integration
├── network.ts          — network utilities
├── startup-timing.ts   — startup timing marks
├── ui.ts               — UI utilities
├── upgrade.ts          — upgrade/update helpers
├── cmd/                — per-command modules (22 lazy-loaded commands)
│   ├── run/            — execution engine (38 files)
│   ├── debug/          — debug/session inspection
│   ├── run.ts          — run command entry
│   ├── session.ts      — session management
│   ├── plugin.ts       — plugin install/manage
│   ├── mcp.ts          — MCP server management
│   ├── acp.ts          — ACP server control
│   ├── serve.ts        — headless HTTP server
│   ├── web.ts          — web UI launcher
│   ├── memory.ts       — AXE.md management
│   ├── db.ts           — database tools
│   ├── stats.ts        — session statistics
│   ├── export.ts       — session export
│   ├── import.ts       — session import
│   ├── attach.ts       — attach to running server
│   ├── pr.ts           — PR fetch/checkout
│   ├── github.ts       — GitHub agent
│   ├── providers.ts    — provider/credential management
│   ├── models.ts       — model listing
│   ├── agent.ts        — agent configuration
│   ├── account.ts      — account management
│   ├── tui.ts          — TUI launcher
│   ├── generate.ts     — code generation
│   ├── cmd.ts          — command listing
│   ├── upgrade.ts      — upgrade command
│   ├── uninstall.ts    — uninstall command
│   ├── prompt-display.ts — prompt display helpers
│   └── ...             — additional command files
├── effect/             — Effect runtime layer [see effect/AGENTS.md]
└── tui/                — TUI worker process [see tui/AGENTS.md]
```

## Key Patterns

- **Lazy loading**: All 22 commands use `lazyCommand()` — commands are `import()`-ed on first invocation, not eagerly loaded.
- **Command modules**: Most commands are single `.ts` files under `cmd/<name>.ts`; `run/` and `debug/` are directories with sub-modules.
- **Run command**: The most complex command — 38 files, handles execution, tool dispatch, session creation, and prompt delivery.
- **No barrel index**: Commands are imported directly, not through a barrel.

## Conventions

- Commands return Effect tasks, not raw Promises.
- Error formatting handled by `cli/error.ts` — consistent error shape across all commands.
- `run` command uses `src/cli/cmd/run/` with its own sub-modules for execution, stream transport, and agent resolution.

## Anti-Patterns

- Do not eagerly import command modules — use `lazyCommand` for all commands.
- Do not add new yargs command definitions without using `lazyCommand` — it handles the lazy-loading pattern.
- Do not put command business logic in `src/index.ts` — it only wires commands.
