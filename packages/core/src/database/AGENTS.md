# Database Layer

## Overview

Drizzle ORM + SQLite layer for session persistence, tool state, and project data. Effect-scoped connections with WAL mode and automatic migration.

## Structure

```
src/database/
├── database.ts     — Database service (entry point, self-export)
├── sqlite.ts       — SQLite type/class
├── sqlite.bun.ts   — Bun-native SQLite impl (conditional #sqlite)
├── sqlite.node.ts  — Node.js SQLite impl (conditional #sqlite)
├── migration/      — Drizzle migration files
│   └── ...
├── path/            — Database path resolution
├── schema/          — Drizzle schema definitions
│   └── ...
├── db/              — Database connection pool
└── data-migration.sql.ts — Data migration scripts
```

## Key Patterns

- **Conditional imports**: `#sqlite` condition maps to `sqlite.bun.ts` / `sqlite.node.ts` per runtime. Use `import { X } from "#sqlite"` in code.
- **InstanceState-scoped**: Each open project gets its own `State` object with a `ScopedCache`. Cleaned up on disposal via `Effect.addFinalizer`.
- **WAL mode**: Databases are created with `PRAGMA journal_mode = WAL` for concurrent read access.
- **Snake_case**: All Drizzle schema field names use snake_case to match SQLite column naming.

## Conventions

- Use `Schema.Class` for multi-field data and `Schema.brand` for single-value types.
- Use `Schema.TaggedErrorClass` for typed database errors.
- `Timestamps` (`{ time_created, time_updated }`) from `src/database/schema.sql.ts` is reused across all tables.

## Anti-Patterns

- Do not add opencode-specific tables to `@opencode-ai/effect-drizzle-sqlite` — that package is generic; core-specific tables go in `src/database/`.
- Do not use hand-rolled process wrappers for DB — use `ChildProcessSpawner` from `@effect/platform`.
- Do not import from `@opencode-ai/core/public` inside the core package.
