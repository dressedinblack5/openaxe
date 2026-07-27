# Shared Utilities

## Overview

Shared utility modules used across CLI commands, server handlers, session logic, and tool implementations.

## Structure

```
src/util/
├── archive.ts            — Archive utilities
├── bom.ts                — BOM handling
├── data-url.ts           — Data URL parsing
├── effect-http-client.ts — Effect HTTP client wrapper
├── error.ts              — Error formatting
├── filesystem.ts         — Filesystem operations
├── html.ts               — HTML processing
├── iife.ts               — IIFE helpers
├── lazy.ts               — Lazy evaluation
├── local-context.ts      — Local context helpers
├── locale.ts             — Locale utilities
├── media.ts              — Media handling
├── merge-deep.ts         — Deep merge
├── process.ts            — Process utilities
├── proxy-env.ts          — Proxy environment helpers
├── queue.ts              — Queue utilities
├── record.ts             — Record helpers
├── repository.ts         — Repository utilities
├── rpc.ts                — RPC utilities
├── timeout.ts            — Timeout handling
├── token.ts              — Token counting/validation
└── wildcard.ts           — Wildcard matching
```

## Key Patterns

- **RPC**: `src/util/rpc.ts` provides the RPC mechanism for inter-process communication between the TUI renderer and the CLI worker.
- **Error utilities**: Shared error creation patterns used across all modules — consistent error messages and formatting.
- **Retry**: Centralized retry logic with exponential backoff for transient failures.

## Conventions

- Utilities are pure functions or thin Effect-wrapped functions.
- No side effects in utility modules unless explicitly designed for it (e.g., `flock.ts`).
- Import utilities by their specific path, not through a barrel.

## Anti-Patterns

- Do not create a barrel `index.ts` — import utilities directly by path.
- Do not add domain-specific logic to utility modules — they are generic helpers only.
- Do not duplicate utility logic across modules — use the shared utilities in `src/util/`.
