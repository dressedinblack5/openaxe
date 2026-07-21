# PROJECT KNOWLEDGE BASE

**Generated:** 2026-07-20
**Commit:** `09c069995`
**Branch:** `dev`

## OVERVIEW

CLI orchestrator package for the **openaxe** monorepo — a lean TUI/CLI AI coding assistant built on Effect v4. Provides the CLI entry point, session engine, tool system, HTTP server, plugin loader, project/config management, and ACP protocol layer. ~787 files, ~175K lines TypeScript.

## STRUCTURE

```
packages/openaxe/
├── src/
│   ├── index.ts           Main entry point — yargs CLI, 22 lazy-loaded commands
│   ├── node.ts             Package exports: Config, Server, bootstrap, Database
│   ├── cli/                CLI bootstrap + command implementations
│   │   ├── cmd/            Per-command modules (run, debug, ...)
│   │   └── lazy-command.ts  Lazy-loading yargs command helper
│   ├── session/            Session orchestration — runner, prompt, LLM dispatch
│   │   ├── llm/            LLM runtime adapters (AI SDK / native) [see AGENTS.md]
│   │   └── prompt/         Prompt building
│   ├── tool/               Tool system — registry, execute, external directories
│   ├── server/             HTTP server — HttpApi groups, middleware, handlers [see AGENTS.md]
│   ├── plugin/             Plugin loader — install, resolve, npm integration
│   ├── config/             Config system — agent, model, command config
│   ├── effect/             Effect service utilities (makeRuntime, InstanceState, EffectBridge)
│   ├── project/            Project management — bootstrap, init, workspace
│   ├── acp/                Agent Client Protocol — server, agent, content types
│   ├── util/               Shared utilities
│   ├── tool/               Tool implementations (edit, glob, grep, bash, etc.)
│   ├── background/         Background job framework
│   ├── auth/               Authentication
│   ├── bus/                Event bus
│   ├── git/                Git integration
│   ├── mcp/                MCP server management
│   └── ...                 (40+ subdirectories total)
├── test/
│   ├── AGENTS.md           Test fixtures and patterns guide
│   ├── fixture/            tmpdir, test helpers
│   ├── lib/                testEffect, LLM test server
│   └── */                  Per-module test directories
├── script/                 Build scripts
└── specs/effect/           Effect migration patterns reference
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| CLI entry point / yargs | `src/index.ts` | 22 lazy-loaded commands |
| CLI command implementations | `src/cli/cmd/` | Per-command modules |
| Run command engine | `src/cli/cmd/run/` | Complex execution logic |
| Session runner | `src/session/` | Durable session orchestration |
| LLM dispatch | `src/session/llm.ts` + `src/session/llm/` | AI SDK / native runtime |
| Tool system | `src/tool/` | Registry, execution |
| HTTP API | `src/server/` | HttpApi groups + handlers |
| Plugin loading | `src/plugin/` | Install, resolve, npm |
| Config | `src/config/` | Agent/model/command config |
| ACP protocol | `src/acp/` | Agent Client Protocol |
| Effect services | `src/effect/` | Runtime, InstanceState, Bridge |
| Tests | `test/` | Per-module test dirs |
| Test helpers | `test/lib/` | testEffect, llm server |
| LSP native client | `src/lsp/` | Effect-based LSP, 17 tool operations, 30+ builtin servers |
| Effect migration specs | `specs/effect/migration.md` | Compact pattern reference |

## CODE MAP

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `src/index.ts` | Entry | `src/index.ts` | yargs bootstrap, 22 lazy commands |
| `lazyCommand` | Function | `src/cli/lazy-command.ts` | Lazy-load yargs subcommand |
| `bootstrap` | Export | `src/cli/bootstrap.ts` | Application bootstrap |
| `Config` | Export | `src/config/config.ts` | Configuration service |
| `Server` | Export | `src/server/server.ts` | HTTP server setup |
| `Session` | Service | `src/session/` | Session orchestration |
| `LLM` | Service | `src/session/llm.ts` | LLM request dispatch |
| `PluginLoader` | Service | `src/plugin/` | Plugin loading lifecycle |

## COMMANDS

```bash
bun dev              # Start TUI dev server
bun test             # Run tests (--timeout 60000)
bun run typecheck    # TypeScript check via tsgo
bun run build        # Build binary via script/build.ts
```

## ANTI-PATTERNS

- **`export namespace Foo { }`** — Not ESM, prevents tree-shaking, breaks native TS runner. Use flat exports + `export * as Foo` self-reexport.
- **Barrel `index.ts`** in multi-sibling dirs — Forces every import to evaluate all siblings. Import specific files directly.
- **`as any` / `@ts-ignore` / `@ts-expect-error`** — Never suppress type errors.
- **`Effect.sleep(N)` as synchronization** — Races scheduler. Use pollWithTimeout, Latch, or Deferred instead.
- **`Effect.fork` / `Effect.forkDaemon`** — Don't exist in Effect v4 beta. Use `Effect.forkIn(scope)`.
- **`Effect.succeed(undefined)`** — Use `Effect.void`.
- **`new Date(yield* Clock.currentTimeMillis)`** — Use `DateTime.nowAsDate`.
- **Manual `Fiber | undefined` or `Promise | undefined` for dedup** — Use `Effect.cached`.

## UNIQUE STYLES

- Module shape: flat top-level exports + `export * as Foo from "./foo"` self-reexport at file bottom.
- `index.ts` module: use `export * as Foo from "."` not `"./index"`.
- Multi-sibling dirs: no barrel index. Import `@/session/retry` not `@/session`.
- Effect services: `Effect.gen(function* () {})` + `Effect.fn("Domain.method")` for named tracing.
- Effect errors: `yield* new MyError(...)` over `yield* Effect.fail(new MyError(...))`.
- `makeRuntime` for all Effect runtimes (deduplicates layers via memoMap).
- `InstanceState` for per-directory/project state with `ScopedCache`.
- `EffectBridge` for native/external callbacks re-entering Effect services.
- Test Effect patterns: `testEffect(Layer)`, `it.effect` / `it.live` / `it.instance`.

# openaxe database guide

## Database

- **Schema**: Drizzle schema lives in `packages/core/src/**/*.sql.ts`.
- **Migrations**: database migrations live in `packages/core` and are applied by core.

## Development server

- Running `bun dev` from `packages/openaxe` starts the live interactive TUI. Do not run it as a blocking foreground command when you need to inspect the result.
- Start it in `tmux` instead: `tmux new-session -d -s openaxe-dev 'bun dev'`.
- Capture the current TUI output with: `tmux capture-pane -pt openaxe-dev`.
- Stop the session explicitly when done: `tmux kill-session -t openaxe-dev`.

# Module shape

Do not use `export namespace Foo { ... }` for module organization. It is not
standard ESM, it prevents tree-shaking, and it breaks Node's native TypeScript
runner. Use flat top-level exports combined with a self-reexport at the bottom
of the file:

```ts
// src/foo/foo.ts
export interface Interface { ... }
export class Service extends Context.Service<Service, Interface>()("@opencode/Foo") {}
export const layer = Layer.effect(Service, ...)
export const defaultLayer = layer.pipe(...)

export * as Foo from "./foo"
```

Consumers import the namespace projection:

```ts
import { Foo } from "@/foo/foo"

yield * Foo.Service
Foo.layer
Foo.defaultLayer
```

Namespace-private helpers stay as non-exported top-level declarations in the
same file — they remain inaccessible to consumers (they are not projected by
`export * as`) but are usable by the file's own code.

## When the file is an `index.ts`

If the module is `foo/index.ts` (single-namespace directory), use `"."` for
the self-reexport source rather than `"./index"`:

```ts
// src/foo/index.ts
export const thing = ...

export * as Foo from "."
```

## Multi-sibling directories

For directories with several independent modules (e.g. `src/session/`,
`src/config/`), keep each sibling as its own file with its own self-reexport,
and do not add a barrel `index.ts`. Consumers import the specific sibling:

```ts
import { SessionRetry } from "@/session/retry"
import { SessionStatus } from "@/session/status"
```

Barrels in multi-sibling directories force every import through the barrel to
evaluate every sibling, which defeats tree-shaking and slows module load.

# openaxe Effect rules

Use these rules when writing or migrating Effect code.

See `specs/effect/migration.md` for the compact pattern reference and examples.

## Core

- Use `Effect.gen(function* () { ... })` for composition.
- Use `Effect.fn("Domain.method")` for named/traced effects and `Effect.fnUntraced` for internal helpers.
- `Effect.fn` / `Effect.fnUntraced` accept pipeable operators as extra arguments, so avoid unnecessary outer `.pipe()` wrappers.
- Use `Effect.callback` for callback-based APIs.
- Use `Effect.void` instead of `Effect.succeed(undefined)` or `Effect.succeed(void 0)`.
- Prefer `DateTime.nowAsDate` over `new Date(yield* Clock.currentTimeMillis)` when you need a `Date`.

## Module conventions

- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.

## Schemas and errors

- Use `Schema.Class` for multi-field data.
- Use branded schemas (`Schema.brand`) for single-value types.
- Use `Schema.TaggedErrorClass` for typed errors.
- Use `Schema.Defect` instead of `unknown` for defect-like causes.
- In `Effect.gen` / `Effect.fn`, prefer `yield* new MyError(...)` over `yield* Effect.fail(new MyError(...))` for direct early-failure branches.

## Runtime vs InstanceState

- Use `makeRuntime` (from `src/effect/run-service.ts`) for all services. It returns `{ runPromise, runFork, runCallback }` backed by a shared `memoMap` that deduplicates layers.
- Use `InstanceState` (from `src/effect/instance-state.ts`) for per-directory or per-project state that needs per-instance cleanup. It uses `ScopedCache` keyed by directory — each open project gets its own state, automatically cleaned up on disposal.
- If two open directories should not share one copy of the service, it needs `InstanceState`.
- Do the work directly in the `InstanceState.make` closure — `ScopedCache` handles run-once semantics. Don't add fibers, `ensure()` callbacks, or `started` flags on top.
- Use `Effect.addFinalizer` or `Effect.acquireRelease` inside the `InstanceState.make` closure for cleanup (subscriptions, process teardown, etc.).
- Use `Effect.forkScoped` inside the closure for background stream consumers — the fiber is interrupted when the instance is disposed.
- To make a service's `init()` non-blocking, fork `InstanceState.get(state)` at the `init()` call site (e.g. `Effect.forkIn(scope)`), not by forking work inside the `InstanceState.make` closure. Forking inside the closure leaves state incomplete for other methods that read it.
- `src/project/bootstrap.ts` already wraps every service `init()` in `Effect.forkDetach`, so `init()` is fire-and-forget in production. Keep `init()` methods synchronous internally; the caller controls concurrency.

## Effect v4 beta API

- `Effect.fork` and `Effect.forkDaemon` do not exist. Use `Effect.forkIn(scope)` to fork a fiber into a specific scope.

## Preferred Effect services

- In effectified services, prefer yielding existing Effect services over dropping down to ad hoc platform APIs.
- Prefer `FileSystem.FileSystem` instead of raw `fs/promises` for effectful file I/O.
- Prefer `ChildProcessSpawner.ChildProcessSpawner` with `ChildProcess.make(...)` instead of custom process wrappers.
- Prefer `HttpClient.HttpClient` instead of raw `fetch`.
- Prefer `Path.Path`, `Config`, `Clock`, and `DateTime` when those concerns are already inside Effect code.
- For background loops or scheduled tasks, use `Effect.repeat` or `Effect.schedule` with `Effect.forkScoped` in the layer definition.

## Effect.cached for deduplication

Use `Effect.cached` when multiple concurrent callers should share a single in-flight computation rather than storing `Fiber | undefined` or `Promise | undefined` manually. See `specs/effect/migration.md` for the full pattern.

## Callback boundaries

Use `EffectBridge` for native or external callbacks (`@parcel/watcher`, `node-pty`, native `fs.watch`, plugin callbacks, etc.) that need to re-enter Effect services with instance/workspace context.

Plain async code should pass explicit context or stay inside an Effect fiber; do not add ambient instance context shims.

# LSP native tooling

Effect-based native LSP client (not MCP wrapper) in `src/lsp/`. Provides diagnostics, navigation, and code actions directly to the tool system.

## Architecture

```
src/lsp/
├── lsp.ts          Effect service (Interface + Service + layer), 23 methods, InstanceState-scoped
├── client.ts       JSON-RPC via vscode-jsonrpc, push+pull diagnostic merge, per-server debounce
├── server.ts       30+ builtin server definitions, 15 with auto-download
├── launch.ts       Child process spawn helper
├── diagnostic.ts   Diagnostics-to-string formatting
├── language.ts     Extension → languageId mapping
└── lsp.txt         Tool documentation (src/tool/lsp.txt)
```

## LSP service methods (`src/lsp/lsp.ts` — `Interface`)

| Method | LSP Request | Returns |
|--------|-------------|---------|
| `init` | — | `void` (loads config, builds server map) |
| `status` | — | `Status[]` (server id + connected/error) |
| `hasClients` | — | `boolean` (any server matches file extension) |
| `touchFile` | `textDocument/didOpen` + `didChange` | `void` (opens file, optionally waits for diagnostics) |
| `diagnostics` | — | `Record<string, Diagnostic[]>` (all current diagnostics) |
| `hover` | `textDocument/hover` | Markdown content |
| `definition` | `textDocument/definition` | Location[] |
| `references` | `textDocument/references` | Location[] |
| `implementation` | `textDocument/implementation` | Location[] |
| `documentSymbol` | `textDocument/documentSymbol` | DocumentSymbol[] or Symbol[] |
| `workspaceSymbol` | `workspace/symbol` | Symbol[] |
| `prepareCallHierarchy` | `textDocument/prepareCallHierarchy` | CallHierarchyItem[] |
| `incomingCalls` / `outgoingCalls` | `callHierarchy/incomingCalls` / `outgoingCalls` | CallHierarchyIncomingCall[] / OutgoingCall[] |
| `codeAction` | `textDocument/codeAction` | Command[] |
| `applyCodeAction` | `textDocument/codeAction` (resolve) + apply edit | any[] |
| `rename` | `textDocument/rename` | WorkspaceEdit |
| `prepareRename` | `textDocument/prepareRename` | Range \| null |
| `typeDefinition` | `textDocument/typeDefinition` | Location[] |
| `signatureHelp` | `textDocument/signatureHelp` | SignatureHelp |
| `completion` | `textDocument/completion` | CompletionItem[] |
| `formatting` | `textDocument/formatting` | TextEdit[] |
| `removeClients` | — | `void` (shutdown + clear state) |

## Tool integration (`src/tool/lsp.ts`)

The `LSP` tool exposes all operations to the AI assistant. Always available (no feature gate). Operations: `goToDefinition`, `findReferences`, `hover`, `documentSymbol`, `workspaceSymbol`, `goToImplementation`, `prepareCallHierarchy`, `incomingCalls`, `outgoingCalls`, `codeAction`, `applyCodeAction`, `rename`, `prepareRename`, `typeDefinition`, `signatureHelp`, `completion`, `formatting`.

Each operation accepts at minimum `file`, with `line`/`character` for location-based ops, plus operation-specific params (`newName`, `title`, `tabSize`, etc.).

## Patterns

- **InstanceState-scoped**: Single `State` object per open project (clients, servers, broken map, spawning map). Cleaned up on project close via `Effect.addFinalizer`.
- **Broken server retry**: Failed spawns tracked in `broken: Map<string, number>` with 5-minute TTL. After cooldown, server is retried automatically.
- **Spawning dedup**: `spawning: Map<string, Promise<...>>` prevents concurrent spawns for the same server+root pair.
- **Error handling**: All LSP requests catch errors to `null`/`[]` — never propagate transport errors to the caller. The `run()` helper wraps `getClients` + fan-out.
- **Diagnostic merge**: `client.ts` merges push diagnostics (sent by server) with pull diagnostics (on-demand) per file. Deduped by diagnostic message. Four tool edit operations call `touchFile` post-write to refresh diagnostics.
