# MCP Server Management

## Overview

MCP (Model Context Protocol) server management for openaxe. Handles MCP server configuration, lifecycle, and tool exposure.

## Structure

```
src/mcp/
├── auth.ts           — MCP authentication
├── catalog.ts        — MCP server catalog
├── index.ts          — Main entry, exports
├── oauth-callback.ts — OAuth callback handling
└── oauth-provider.ts — OAuth provider integration
```

## Key Patterns

- MCP servers run as separate OS processes with no session/DB access.
- Server lifecycle (start/stop/status) managed through the plugin system.

## Conventions

- MCP servers are configured per-project in `openaxe.jsonc` under the `mcp` key.
- Each MCP server declaration specifies `type` (local/remote), `command`, and `args`.

## Anti-Patterns

- Do not give MCP servers session/DB access — they run in subprocess isolation.
- Do not add MCP servers without declaring permissions in config.
