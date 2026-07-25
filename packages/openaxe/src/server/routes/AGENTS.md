# Server Routes

## Overview

HTTP API route definitions for the openaxe server. Routes are assembled from HttpApi group definitions into a runnable `HttpRouter`.

## Structure

```
src/server/routes/
├── instance/
│   ├── httpapi/
│   │   ├── groups/        — HttpApi group definitions (21 groups)
│   │   ├── handlers/      — Handler layers for each group
│   │   └── middleware/    — Authorization, schema error middleware
│   └── AGENTS.md          — Instance route documentation
└── ...
```

## Key Patterns

- **HttpApi groups**: Each route group (Health, Location, Agent, Session, etc.) is defined as an `HttpApi` group in `src/server/api.ts`.
- **Handler layers**: Each group has a handler layer that provides the service dependencies.
- **Route assembly**: `createRoutes()` merges all handler layers + middleware into a runnable `HttpRouter`.

## Conventions

- Route definitions live in `packages/server/src/` (the API definition package).
- The actual server runtime that wires routes is in `packages/openaxe/src/server/server.ts`.
- Handler modules import their service layers from `@opencode-ai/core` and `@opencode-ai/server`.

## Anti-Patterns

- Do not define route groups directly in the openaxe server module — use the `packages/server` API definition.
- Do not add middleware that bypasses authorization — use `Authorization` middleware consistently.
