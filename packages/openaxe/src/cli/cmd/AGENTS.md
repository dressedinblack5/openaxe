# CLI Commands

## Overview

22 lazy-loaded yargs subcommands under `src/cli/cmd/`. Most are single `.ts` files; `run/` and `debug/` are directories. Loaded via `lazyCommand()` in `src/index.ts`.

## Structure

```
cli/cmd/
├── run/         — Execution engine (38 files, the most complex command)
├── debug/       — Debugging and session inspection
├── account.ts   — Account management
├── acp.ts       — ACP server start/stop/status
├── agent.ts     — Agent configuration and selection
├── attach.ts    — Attach to a running server session
├── cmd.ts       — Command listing
├── db.ts        — Database tools (migrate, wipe, inspect)
├── export.ts    — Session data export (JSON, markdown)
├── generate.ts  — Code generation
├── github.ts    — GitHub agent operations (issue, PR, repo)
├── import.ts    — Session data import
├── mcp.ts       — MCP server configuration (add, list, remove, test)
├── memory.ts    — AXE.md memory management (list, set, get, remove)
├── models.ts    — Available model listing
├── plugin.ts    — Plugin installation and management
├── pr.ts        — Fetch and checkout a GitHub PR
├── providers.ts — Provider and credential management (login, list, remove)
├── run.ts       — Run command entry (delegates to run/)
├── serve.ts     — Headless HTTP API server
├── session.ts   — Session management (list, fork, export, import, delete)
├── stats.ts     — Session and token usage statistics
├── tui.ts       — TUI launcher
├── uninstall.ts — Uninstall command
├── upgrade.ts   — Upgrade command
└── web.ts       — Web UI server launcher
```

> Most commands are single `.ts` files loaded lazily via `lazyCommand()` in `src/index.ts`. Only `run/` and `debug/` are directories with sub-modules.

## Key Patterns

- **Command modules**: Most commands are single `.ts` files. Only `run/` and `debug/` are directories with `index.ts`.
- **Run command** (`run/`) has 5 sub-directories: execution engine, stream transport, agent resolution, tool execution, and session lifecycle.
- **Lazy loading**: Commands are dynamically imported via `src/cli/lazy-command.ts`.

## Conventions

- Commands use `lazyCommand()` — never statically import other command modules.
- Each command module follows the same shape: `builder(yargs) → handler(yargs) → Effect task`.
- Error handling uses the shared `cli/error.ts` formatter.

## Anti-Patterns

- Do not add a command as a static import in `src/index.ts` — always go through `lazyCommand`.
- Do not share command handler logic between commands without extracting it into `src/cli/cmd/run/` or a utility module.
