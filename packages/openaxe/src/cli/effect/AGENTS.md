# CLI Effect Layer

## Overview

Effect runtime integration for CLI commands. Provides `AppRuntime`, `InstanceRuntime`, and command-layer services for the lazy-loaded commands.

## Structure

```
cli/effect/
└── prompt.ts  — CLI command prompt helpers
```

## Key Patterns

- **Dynamic imports**: Heavy modules (AppRuntime, Server) are loaded via `import()` inside RPC handlers — not at worker startup. This defers module resolution + layer composition (~45 service modules) until first use.
- **Layer dedup**: `makeRuntime` with shared `memoMap` for all service runtimes.
- **Per-project state**: `InstanceState` keys state by directory — each open project gets its own isolated state.

## Conventions

- Use `Effect.forkIn(scope)` for background tasks within layers — not `Effect.fork` (doesn't exist in v4).
- `init()` methods are fire-and-forget via `Effect.forkDetach` in callers.
- Keep `init()` synchronous internally; the caller controls concurrency.

## Anti-Patterns

- Do not use `Effect.fork` or `Effect.forkDaemon` — use `Effect.forkIn(scope)`.
- Do not add fibers or `ensure()` callbacks on top of `InstanceState.make` — `ScopedCache` handles run-once semantics.
- Do not fork work inside `InstanceState.make` closure — it leaves state incomplete for other methods that read it.
