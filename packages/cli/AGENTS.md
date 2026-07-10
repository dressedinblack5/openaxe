# @opencode-ai/cli

Effect-runtime CLI for openaxe — the `lildax` binary. Thin command
definition + lazy handler loading + daemon + TUI boot.

## Structure

```
packages/cli/src/
  index.ts              entry — dynamic-import handler wiring + runtime boot
  commands/
    commands.ts         command tree (Spec.make declarations)
    handlers/
      default.ts        $ handler — no-arg default behavior
      api.ts            api handler — HTTP request tooling
      migrate.ts        v1→v2 data migrator
      serve.ts          start v2 API server
      debug/
        agents.ts       list agents
      service/
        start.ts        start background daemon
        stop.ts         stop background daemon
        restart.ts      restart background daemon
        status.ts       daemon status check
        password.ts     get/set server password
  framework/
    spec.ts             Spec.make — thin wrapper around effect/unstable/cli/Command
    runtime.ts          Runtime.handlers + Runtime.run — command dispatch +
                        lazy import resolution + YamlConfig loading
  services/
    daemon.ts           Daemon service — effect-managed background server lifecycle
  tui.ts                runTui() — boots @opencode-ai/tui with legacy 404 fallback
```

## Commands

All commands are declared declaratively in `commands.ts` and resolved lazily
in `index.ts`:

```ts
const Handlers = Runtime.handlers(Commands, {
  api: () => import("./commands/handlers/api"),
  service: {
    start: () => import("./commands/handlers/service/start"),
  },
})
```

Every handler is a dynamic import — only the requested path is loaded.

## Framework

- `Spec.make(name, options)` — declares a command with optional params and
  sub-commands. Wraps `Command.make` + `Command.withDescription`.
- `Runtime.handlers(spec, tree)` — type-checks the handler tree against the
  spec tree; handlers are lazy `() => Promise<module>` thunks.
- `Runtime.run(spec, handlers, meta)` — resolves the matched handler,
  executes it with parsed CLI args and YamlConfig.

## Daemon Service

The daemon service manages a background server process:

```ts
Effect.provide(Daemon.defaultLayer)
```

Provides lifecycle management (start/stop/status/restart) with daemonization.

## Build & Entry

- Source entry: `src/index.ts`
- Build output: `bin/lildax.cjs` (single-file bundle via `script/build.ts`)
- Bin name: `lildax`
- Depends on: `@opencode-ai/core`, `@opencode-ai/sdk`, `@opencode-ai/server`,
  `@opencode-ai/tui`, `@opentui/core`, `@opentui/solid`, `@parcel/watcher`,
  `effect`, `solid-js`

## Conventions

- Lazy loading everywhere — dynamic `import()` in handler tree, never eager
- Effect-first composition: `Runtime.run(...)` returns `Effect`, bootstrapped
  with `NodeRuntime.runMain`
- Monorepo workspace deps use `"workspace:*"` (never pinned)
- Build via `script/build.ts`, typecheck via `tsgo --noEmit`
- TUI config sets `terminalSuspend: false` — prevents terminal suspension
  when running inside a parent TUI
- Legacy 404 fallback in `tui.ts` — some old endpoints return 404 for v1
  routes; `gracefulFetch` returns sensible defaults instead

## Anti-Patterns

- No barrel files across handler subdirectories — each handler module is a
  standalone dynamic import
- No direct CLI argument parsing outside `framework/` — all parsing goes
  through `effect/unstable/cli`
- No Effect layers defined here that overlap with `core` — daemon lifecycle
  is cli-specific; general services stay in core
