# PROJECT KNOWLEDGE BASE

**Generated:** 2026-07-12 03:50 UTC
**Commit:** `44587ad`
**Branch:** `dev`

## OVERVIEW

Monorepo for **openaxe** — a lean TUI/CLI AI coding assistant built on Effect v4, with 13 packages, ~4,440 files, and 385K lines of TypeScript. Security-first, zero Electron, 52% fewer packages than upstream.

**Core stack:** TypeScript (Bun), Effect v4, OpenTUI (SolidJS), Drizzle ORM + SQLite.

## STRUCTURE

```
./
├── packages/
│   ├── openaxe/           CLI orchestrator — yargs entry, lazy-loaded commands [AGENTS.md]
│   ├── core/              Session/agent/project/tool orchestration, DB, permissions [AGENTS.md]
│   ├── llm/               LLM integrations — 15+ providers, 6 protocol adapters [AGENTS.md]
│   ├── tui/               SolidJS terminal UI via OpenTUI [AGENTS.md]
│   ├── ui/                Shared SolidJS component library (1558 files)
│   ├── server/            HTTP server and API
│   ├── plugin/            Plugin system — tool, TUI, effect, promise entry points
│   ├── schema/            Data validation schemas (Effect)
│   ├── sdk/               Generated JS SDK [AGENTS.md]
│   ├── cli/               Alternative Effect-runtime CLI
│   ├── effect-drizzle-sqlite/  SQLite layer — Drizzle ORM + Effect [AGENTS.md]
│   ├── http-recorder/     Record/replay HTTP for testing [AGENTS.md]
│   └── script/            Utility package
└── AGENTS.md / AGENTS.md (package-level per subdir)

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Style guide / branch rules | `./AGENTS.md` (this file) | Coding conventions, commit messages |
| V2 Session architecture | `./AGENTS.md` (V2 Session Core section) | Durable prompts, drains, EventV2 |
| CLI commands | `packages/openaxe/src/cli/cmd/` | Yargs lazy-loaded commands |
| Session orchestration | `packages/openaxe/src/session/` | LLM runtime, execution, store |
| Core engine | `packages/core/src/` | DB, tools, permissions, config, plugins |
| LLM provider routes | `packages/llm/src/protocols/` | 15+ provider adapters |
| TUI rendering | `packages/tui/src/` | SolidJS + OpenTUI components |
| Shared UI components | `packages/ui/src/components/` | Icons, app icons, provider icons |
| HTTP API | `packages/server/src/handlers/` | HttpApi groups and handlers |
| Plugin system | `packages/plugin/src/` | Plugin resolution, loading, runtime |
| Database migrations | `packages/core/src/database/migration/` | Drizzle SQLite migrations |
| JS SDK | `packages/sdk/js/` | Generated TypeScript API client, codegen pipeline |
| HTTP recorder | `packages/http-recorder/` | Record/replay HTTP for testing |
| Test fixtures | `packages/openaxe/test/` | tmpdir, testEffect, LLM server |

## CODE MAP

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| OpenCode | class | `packages/core/src/public/opencode.ts` | Public API facade |
| SessionV2 | module | `packages/core/src/session/runner/` | Durable session runner |
| LLM | namespace | `packages/llm/src/llm.ts` | Request constructors |
| LLMClient | service | `packages/llm/src/route/client.ts` | Execute LLM requests |
| Route | type | `packages/llm/src/route/` | Protocol + endpoint + auth + framing |
| ToolRegistry | service | `packages/core/src/tool/registry.ts` | Tool registration/lookup |
| TuiApp | component | `packages/tui/src/app.tsx` | Root TUI App component |

- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.

## Branch Names

Use a short branch name of at most three words, separated by hyphens. Do not use slashes or type prefixes such as `feat/` or `fix/`.

Examples: `session-recovery`, `fix-scroll-state`, `regenerate-sdk`.

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `core`, `openaxe`, `tui`, `app`, `desktop`, `sdk`, or `plugin`.

Examples: `fix(tui): simplify thinking toggle styling`, `docs: update contributing guide`, `chore(sdk): regenerate types`.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Imports

- Never alias imports. Do not use `import { foo as bar } from "..."` or renamed imports like `resolve as pathResolve`.
- Never use star imports. Do not use `import * as Foo from "..."` or `import type * as Foo from "..."`.
- If a namespace-style value is needed, import the module's own exported namespace by name, for example `import { Project } from "@opencode-ai/core/project"`, then reference `Project.ID`.
- Prefer dynamic imports for heavy modules that are only needed in selected code paths, especially in startup-sensitive entrypoints. Destructure dynamic import bindings near the top of the narrowest scope that needs them so they read like normal imports. Avoid inline chains such as `await import("./module").then((mod) => mod.value())` or `(await import("./module")).value()`. Keep branch-specific imports inside the branch that needs them to preserve lazy loading.

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Complex Logic

When a function has several validation branches or supporting details, make the main function read as the happy path and move supporting details into small helpers below it.

```ts
// Good
export function loadThing(input: unknown) {
  const config = requireConfig(input)
  const metadata = readMetadata(input)
  return createThing({ config, metadata })
}

function requireConfig(input: unknown) {
  ...
}
```

- Keep helpers close to the code they support, below the main export when that improves readability.
- Do not over-abstract simple expressions into many single-use helpers; extract only when it names a real concept like `requireConfig` or `readMetadata`.
- Do not return `Effect` from helpers unless they actually perform effectful work. Synchronous parsing, validation, and option building should stay synchronous.
- Prefer Effect schema helpers such as `Schema.UnknownFromJsonString` and `Schema.decodeUnknownOption` over manual `JSON.parse` wrapped in `Effect.try` when parsing untrusted JSON strings.
- Add comments for non-obvious constraints and surprising behavior, not for obvious assignments or control flow.

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible, you shouldn't be using globalThis.\* at all unless it's the only option.
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/openaxe`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/openaxe`), never `tsc` directly.

## V2 Session Core

- Keep durable prompt admission separate from model execution. `SessionV2.prompt(...)` admits one durable `session_input` row before scheduling advisory `SessionExecution.wake(sessionID)` unless `resume: false` requests admit-only behavior. The serialized runner promotes admitted inputs into visible user messages at safe boundaries.
- Reusing a Session ID adopts the existing Session. Reusing a prompt message ID reconciles an exact retry only when Session, prompt, and delivery mode match; conflicting reuse fails. Historical projected prompts lazily synthesize promoted inbox records during exact retry.
- Keep `SessionExecution` process-global and Session-ID based. Its local implementation owns the process-local Session coordinator and discovers placement through `SessionStore` plus `LocationServiceMap.get(session.location)` only when a drain starts; no layer should take a Session ID. V2 interruption targets the active process-local ownership chain for that Session; idle or missing interruption is a no-op.
- Keep `SessionRunner`, model resolution, tool registry, permissions, and filesystem Location-scoped. Omitted `Location.workspaceID` means implicit-local placement; explicit workspace identity remains reserved for future placement semantics.
- Preserve one explicit `llm.stream(request)` call per provider turn and reload projected history before durable continuation. Do not bridge through legacy `SessionPrompt.loop(...)` or delegate orchestration to an in-memory tool loop.
- Keep local Session drains process-local until clustering is implemented. `SessionRunCoordinator` joins explicit same-Session resumes, coalesces prompt wakeups, and allows different Sessions to run concurrently. Advisory wakes drain eligible durable inbox rows only; post-crash continuation recovery requires a separate explicit design before it may retry provider work. A drain has no durable identity or transcript boundary.
- Keep delivery vocabulary explicit. Prompts steer by default and promote at the next safe provider-turn boundary while the current drain requires continuation. An explicit `queue` input remains pending until the Session would otherwise become idle; promote one queued input at that boundary, then reevaluate continuation before promoting another. Promoting any new user input resets the selected agent's provider-turn allowance; a batch of steers resets it once.
- Keep EventV2 replay owner claims separate from clustered Session execution ownership.
- Keep the System Context algebra, registry, and built-ins in `src/system-context`; keep Context Source producers with their observed domains, and keep Session History selection plus Context Epoch persistence Session-owned.

## Arch Linux / KDE

Required system packages:
```
sudo pacman -S base-devel cmake wl-clipboard ripgrep
```

Inotify limit (prevents file watcher from silently failing on large repos):
```
echo fs.inotify.max_user_watches=524288 | sudo tee /etc/sysctl.d/99-inotify.conf
sudo sysctl --system
```

Electron on KDE/Wayland: the `LinuxDisplayBackend` setting ("auto"/"wayland") is stored in electron-store. If the window flickers or renders black, launch with `--disable-gpu` or `--use-gl=swiftshader`.

The TUI (primary mode) has no Electron dependencies. Run via `bun dev` from `packages/openaxe`.
