# Core Config Modules

## Overview

Per-domain config modules in the core package. Each follows the `export * as ConfigX from "./x"` self-export pattern.

## Structure

```
src/config/
├── agent.ts          — Agent config (model, provider, rules)
├── attachments.ts   — File attachment config
├── command.ts       — Command-level config overrides
├── compaction.ts    — Session compaction settings
├── experimental.ts   — Experimental feature flags
├── formatter.ts      — Output formatter config
├── lsp.ts            — LSP server config overrides
├── markdown.ts       — Markdown rendering config
├── mcp.ts            — MCP server configuration
├── plugin.ts         — Plugin config declarations
├── provider.ts       — Provider config (API keys, base URLs)
├── reference.ts      — Reference/config validation
├── tool-output.ts    — Tool output display config
└── watcher.ts        — File watcher config
```

## Key Patterns

- **Self-export**: Every module uses `export * as ConfigX from "./x"` at the bottom. This is the module shape convention for `src/config/`.
- **Config modules are Effect services** — they read from `Config.Service` and provide typed config values.
- **Plugin config**: `ConfigPlugin` re-exports the plugin config schema for use by the plugin loader.

## Conventions

- Follow the existing `export * as ConfigX from "./x"` pattern for new config modules.
- Use `Schema.Class` for config schemas with multiple fields.
- Use `Schema.brand` for single-value config types.
- Config validation uses Effect Schema codecs — no manual JSON.parse.

## Anti-Patterns

- Do not create a barrel `index.ts` in `src/config/` — each module is imported directly.
- Do not store secrets in config — API keys live in `~/.local/share/openaxe/auth.json`.
- Do not import from `@opencode-ai/core/public` inside core — that's for external consumers.
