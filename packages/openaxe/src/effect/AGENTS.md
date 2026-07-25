# Effect Utilities

## Overview

Effect service utilities for the openaxe CLI orchestrator. Provides `makeRuntime`, `InstanceState`, and `EffectBridge` — the three pillars of Effect integration in the CLI layer.

## Structure

```
src/effect/
├── app-core-layer.ts     — App core layer composition
├── app-layer.ts          — App layer composition
├── app-runtime.ts        — AppRuntime service
├── axe-sync-disposer.ts  — AXE sync disposer
├── bootstrap-runtime.ts  — Bootstrap runtime
├── bridge.ts             — EffectBridge (native/external callbacks)
├── config-service.ts     — Config-backed service generator
├── instance-ref.ts       — Instance reference
├── instance-registry.ts  — Instance registry
├── instance-state.ts     — InstanceState (per-directory state via ScopedCache)
├── promise.ts            — Promise-to-Effect bridge
├── run-service.ts        — makeRuntime (deduplicates layers via memoMap)
├── runner.ts             — Effect runner
└── runtime-flags.ts      — Runtime flags
```

## Key Patterns

- **`makeRuntime`**: Returns `{ runPromise, runFork, runCallback }` backed by a shared `memoMap` that deduplicates layers. Use for all Effect runtimes in the CLI.
- **`InstanceState`**: Per-directory/project state with `ScopedCache` keyed by directory. Each open project gets its own state, automatically cleaned up on disposal.
- **`EffectBridge`**: For native/external callbacks that need to re-enter Effect services with instance/workspace context. Plain async code should pass explicit context or stay inside an Effect fiber.
- **`ConfigService`**: A factory that creates `Context.Service` backed by Effect `Config`. Provides `layer` (test) and `defaultLayer` (production) static methods.

## Conventions

- Use `makeRuntime` for all service runtimes — never create raw Effect runtimes.
- Use `InstanceState` for per-directory state — not manual `Map` + cleanup.
- Use `EffectBridge` for callbacks from native code (`@parcel/watcher`, `node-pty`, `fs.watch`) back into Effect services.

## Anti-Patterns

- Do not use `Effect.fork` or `Effect.forkDaemon` — they don't exist in Effect v4. Use `Effect.forkIn(scope)`.
- Do not use `Effect.succeed(undefined)` — use `Effect.void`.
- Do not use `new Date(yield* Clock.currentTimeMillis)` — use `DateTime.nowAsDate`.
- Do not store `Fiber | undefined` for dedup — use `Effect.cached` instead.
- Do not use `Effect.sleep(N)` for synchronization — use pollWithTimeout, Latch, or Deferred.
