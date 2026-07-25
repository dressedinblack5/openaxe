# CLI TUI Worker

## Overview

TUI worker process that bridges the CLI CLI commands with the OpenTUI renderer. Manages the RPC communication between the main process and the TUI renderer.

## Structure

```
cli/tui/
├── layer.ts               — TUI layer composition
├── validate-session.ts    — Session validation helpers
└── worker.ts              — RPC server (fetch proxy, server start, reload, shutdown)
```

## Key Patterns

- **RPC server**: `Rpc.listen(rpc)` provides inter-process communication for:
  - `fetch` — proxies HTTP requests through the real server URL
  - `server` — starts/stops the HTTP server
  - `reload` — invalidates config and disposes all instances
  - `shutdown` — clean shutdown with instance disposal
- **Heavy module deferral**: `AppRuntime`, `Server`, etc. are loaded via dynamic `import()` inside RPC handlers, not at startup.
- **Heap snapshots**: `writeHeapSnapshot` for debugging memory issues.

## Conventions

- RPC handlers use `async/await` with Effect runtime wrapping.
- Server startup marks are tracked via `mark()` for startup timing.
- Unhandled rejections and uncaught exceptions are caught and no-opped (not re-thrown).

## Anti-Patterns

- Do not eagerly import `AppRuntime` or `Server` at module top level — defer via dynamic import inside RPC handlers.
- Do not leak the server URL outside the RPC — always proxy through the real server URL.
