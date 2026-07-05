# @opencode-ai/schema

Pure Effect Schema definitions shared across the openaxe monorepo. No runtime
logic, no IO — just types, branded strings, tagged errors, and event
definitions.

## Structure

```
packages/schema/src/
  index.ts            namespace re-exports (20 exported namespaces)
  schema.ts           shared schema utilities
  event.ts            event definition system (define, inventory, durable)
  identifier.ts       ascending-id generator
  session.ts          Session.Info, Session.ID, Session.ListAnchor
  session-id.ts       Snoc string branded type
  session-input.ts    SessionInput schema
  session-message.ts  SessionMessage schema
  session-message-id.ts
  session-event.ts    SessionEvent definitions
  session-status-event.ts
  session-compaction-event.ts
  session-todo.ts
  session-delivery.ts
  session-v1.ts       legacy v1 session schema
  permission.ts       Permission v2 schemas (Rule, Request, Reply, Event)
  permission-v1.ts
  filesystem.ts       FileSystem schemas
  filesystem-watcher.ts
  prompt.ts           Prompt, Source, FileAttachment, AgentAttachment
  agent.ts            Agent schemas
  model.ts            Model schemas
  models-dev.ts
  project.ts          Project schemas
  project-directories.ts
  location.ts         Location schemas
  connection.ts       Connection schemas
  workspace.ts        Workspace schemas
  workspace-id.ts     Snoc workspace-id branded type
  workspace-event.ts
  worktree-event.ts
  credential.ts       Credential schemas
  integration.ts      Integration schemas
  question.ts         Question schemas
  question-v1.ts
  reference.ts        Reference schemas
  command.ts          Command schemas
  pty.ts              PTY schemas
  llm.ts              LLM schemas
  provider.ts         Provider schemas
  lsp-event.ts
  ide-event.ts
  tui-event.ts
  mcp-event.ts
  vcs-event.ts
  server-event.ts
  catalog.ts          Catalog schemas
  skill.ts            Skill schemas
  file-diff.ts
  event-manifest.ts   Event manifest schemas
  durable-event-manifest.ts
  installation-event.ts
  legacy-event.ts
  plugin.ts           Plugin schemas
  schema.ts           ← shared helpers, not a separate module
```

## Namespace Convention

Each domain module follows the self-reexport pattern:

```ts
// src/session.ts
export * as Session from "./session"
```

The `index.ts` barrel re-exports the top-level namespace:

```ts
export { Session } from "./session"
```

Consumers import the namespace:

```ts
import { Session } from "@opencode-ai/schema"
Session.ID
Session.Info
Session.Event
```

## Shared Utilities (`src/schema.ts`)

These are imported by domain modules — they are NOT re-exported to consumers:

- `DateTimeUtcFromMillis` — `Schema.Finite` ↔ `DateTimeUtc` codec
- `optionalOmitUndefined` — `Schema.optionalKey` wrapper that omits `undefined` on encode
- `withStatics` — attaches static factory methods to a schema (e.g. `ID.create()`)
- `RelativePath` / `AbsolutePath` — branded string schemas
- `PositiveInt` / `NonNegativeInt` — constrained integer schemas

## Event System (`src/event.ts`)

Events are defined via the `define()` helper which returns a typed schema +
definition dual:

```ts
const Asked = define({
  type: "permission.v2.asked",
  schema: { sessionID: SessionID, ... },
})
```

Groups of definitions are collected with `inventory()` for enumeration, while
`durable()` and `latest()` provide versioned event resolution for migration
logic.

## Conventions

- Pure schema definitions only — no DB queries, no HTTP, no file I/O
- Single dependency: `effect` (Effect v4)
- Branded string types for IDs (`SessionID`, `ProjectID`, etc.)
- `Schema.Struct` for multi-field data; `Schema.Class` also used for tagged errors
- `Schema.TaggedErrorClass` for typed errors throughout
- Mutable schemas (e.g. `Schema.mutable(Schema.Array(Rule))`) where downstream mutates
- Effect event data schemas go through `define()` + `inventory()`
- Legacy/v1 schemas live alongside their v2 counterparts (`permission-v1.ts`, `session-v1.ts`, `question-v1.ts`)
- No runtime code, no side effects

## Anti-Patterns

- No business logic — schema package is read-only datatype definitions
- No DB schemas (migration config or column types) — those belong in `core/src/database/`
- No re-exporting `schema.ts` helpers through `index.ts` (internal implementation detail)
