# @opencode-ai/tui

## Overview

SolidJS + OpenTUI terminal rendering layer for the openaxe TUI. 148 source files, private package, consumed only by `openaxe`.

## Structure

```
src/
  index.tsx          — public entry, exports { run, type TuiInput }
  app.tsx            — root App component (1117 lines), DialogProvider, route switching
  runtime.tsx        — tiny path utility (abbreviateHome)
  theme/             — 33 JSON color assets + theme index
  config/            — TuiConfig schema (keybinds, scroll, diff style, etc.)
  context/           — 21 context providers (args, clipboard, editor, exit, kv, project, route, runtime, sdk, sync, theme, …)
  component/         — 32 dialog/panel components (prompt, command palette, agent/model/mcp/session dialogs, todo-item, spinner, …)
  routes/            — route components: home.tsx + home/, session/ (timeline, footer, sidebar, permission, question, …)
  feature-plugins/   — builtin TUI plugins: home (footer, tips), sidebar (context, files, lsp, mcp, todo), system (diff-viewer, notifications, plugins, which-key)
  plugin/            — TUI plugin runtime (adapter, api, command-shim, slots, route registration)
  prompt/            — prompt input layer (display, frecency, history, stash, autocomplete, cwd, workspace attachment)
  ui/                — shared UI primitives (dialog, spinner, toast, link, border, alert/confirm/select/help dialogs)
  util/              — 20 utility modules (selection, scroll, layout, format, record, transcript, session, signal, …)
```

## Key Patterns

- **JSX source**: Import from `@opentui/solid` (not `solid-js` directly) for TUI rendering. OpenTUI provides `render`, `useTerminalDimensions`, `useRenderer`, `TimeToFirstDraw`.
- **Entry point**: `src/index.tsx` re-exports `{ run, type TuiInput }` from `app.tsx`. The `run()` function boots the renderer with a `CliRenderer` from `@opentui/core`.
- **Context-heavy**: Most state lives in SolidJS context providers under `src/context/`. Each context has a provider component and a `use*` hook.
- **Plugin system**: TUI plugins register via `@opencode-ai/plugin/tui` — route components, slots (sidebar, footer), commands, keybinds. Builtins defined in `feature-plugins/builtins.ts`.
- **Theme**: JSON color maps in `src/theme/assets/` imported with `with { type: "json" }`. Theme index maps ~33 themes to OpenTUI `TerminalColors`.
- **Keybind config**: TuiKeybind schema in `src/config/keybind.ts`. Leader key with configurable timeout.
- **Embedded web UI**: Some routes/components reference `@opencode-ai/ui` for shared SolidJS component primitives.

## Anti-Patterns

- **No business logic**: This is pure rendering. No database queries, no LLM calls, no session orchestration. Use the server API or core SDK via context providers.
- **No direct Effect imports in components**: Domain effects go through context hooks. Only `app.tsx` and runtime bootstrap use Effect directly.
- **No barrel imports across subdirs**: Import from specific module paths (`./context/route`), not a barrel.

## Commands

```bash
# test (run from packages/tui)
bun test --timeout 30000 --only-failures

# typecheck
tsgo --noEmit
```
