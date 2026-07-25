# Session V1 (Legacy)

## Overview

Legacy V1 session implementation — flat file structure with ~20 sibling files. New session work should go in V2 (`src/session/runner/`). This directory is preserved for migration compatibility.

## Structure

```
src/session/
├── session.ts           — Main session type and operations
├── compaction/          — Session compaction logic
├── context-epoch/       — Context epoch tracking
├── event/               — Event sourcing
├── execution/           — Session execution
├── history/             — Session history management
├── info/                — Session info/metadata
├── input/               — Session input handling
├── message/             — Message types and serialization
├── message-id/          — Message ID generation
├── message-updater/     — Message update logic
├── projector/           — Session projector (prompt projection)
├── prompt/              — Prompt building
├── run-coordinator/     — Session run coordination
├── schema/              — Session schema definitions
├── sql/                 — SQL session queries
├── store/               — Session storage
├── todo/                — Todo list integration
└── ...
```

## Key Patterns

- **V1 is flat**: No subdirectory barrel files — each sibling is imported directly.
- **Event source**: Uses aggregate-based sequence IDs via `EventV2.latestSequence`.
- **`Event.listen()` is deprecated** — use `all()` + Stream consumption instead.

## Conventions

- Keep V1 files flat — no new barrel/index.ts files.
- New session work should target `src/session/runner/` (V2) instead.
- `src/v1/` holds compatibility shims for V1 consumers.

## Anti-Patterns

- Do not add new V1 code — the `v1/` compat layer exists for migration only.
- Do not create barrel `index.ts` in the flat V1 directory.
- Do not add event listeners with `Event.listen()` — it is deprecated.
