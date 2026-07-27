# Config System

## Overview

Configuration system for agents, models, commands, and openaxe settings. Handles `openaxe.jsonc` parsing, provider config, model selection, and runtime config.

## Structure

```
src/config/
├── agent.ts           — Agent configuration (model, provider, rules)
├── command.ts         — Command-level config overrides
├── config.ts          — Config service (main entry, self-export)
├── entry-name.ts      — Entry name resolution
├── managed.ts         — Managed config helpers
├── markdown.ts        — Markdown rendering config
├── parse.ts           — Config parsing
├── paths.ts           — Config path resolution
├── plugin.ts          — Plugin config declarations
├── tui.ts             — TUI-specific config (keybinds, scroll, theme)
├── tui-cwd.ts         — TUI working directory config
├── tui-host-attention.ts — TUI host attention config
├── tui-migrate.ts     — TUI config migration
└── variable.ts        — Variable substitution in config
```

## Key Patterns

- **Self-export pattern**: Every module uses `export * as ConfigX from "./x"` at the bottom — see AGENTS.md module shape.
- **Config service**: `Config.Service` is an Effect service providing runtime config access.
- **Provider config**: API keys are NOT stored in config — they live in `~/.local/share/openaxe/auth.json` (permissions 600). Config holds provider settings (base URL, model, options).

## Conventions

- All config modules follow the self-export pattern.
- Config validation uses Effect Schema (`Schema.Class`, `Schema.brand`).
- Default values come from `Config.withDefault()`, not hardcoded fallbacks.

## Anti-Patterns

- Do not store secrets in config — use `auth.json` with env variable overrides.
- Do not create a barrel `index.ts` — each config module is imported directly.
- Do not add new config without an Effect Schema — use `Schema.Class` or `Schema.brand` for typed validation.
