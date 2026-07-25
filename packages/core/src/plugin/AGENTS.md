# Core Plugin System

## Overview

Plugin loading, resolution, and runtime integration in the core package. Handles plugin discovery, installation, and lifecycle management.

## Structure

```
src/plugin/
├── internal.ts       — Plugin internals (Plugin type, registry)
├── agent.ts          — Agent plugin hooks
├── command.ts        — Command plugin hooks
├── host.ts           — Host plugin integration
├── models-dev.ts    — Plugin model config overrides
├── promise/          — Promise-based plugin entry points
├── provider/         — Provider plugin hooks
├── skill/           — Skill plugin definitions
├── variant/         — Plugin variant handling
└── ...
```

## Key Patterns

- **Plugin type**: `Plugin = Schema.Union([Schema.String, Entry])` where `Entry` has `{ package: string, options?: Record<string, unknown> }`.
- **Plugin context**: Each plugin receives a context with tools, session, config, and lifecycle hooks.
- **V2 plugins**: `src/plugin/v2/` contains modern Effect-runtime plugin entry points (effect, promise).

## Conventions

- Plugin types are defined in `src/plugin/index.ts` — the main type entry point.
- Plugin hooks follow the `Hooks` interface pattern with lifecycle methods.
- Use `Schema.TaggedErrorClass` for plugin-specific errors.

## Anti-Patterns

- Do not create barrel `index.ts` in `src/plugin/` subdirs — import specific files directly.
- Do not add plugin logic that bypasses permission checking — plugins must declare capabilities in config.
