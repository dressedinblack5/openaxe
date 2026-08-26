# ADR-0003: Unified Session Runner

**Date**: 2026-08-24
**Status**: Accepted
**Deciders**: Architecture Review Team

## Context

The openaxe codebase had four parallel session execution systems:

1. **Core Durable Runner** (`packages/core/src/session/runner/`) — Effect-based durable session execution with EventV2, DB persistence, compaction, tool settlement
2. **CLI Session Data** (`packages/openaxe/src/cli/cmd/run/session-data.ts`) — Mutable reducer with 15+ Map/Set fields for TUI rendering state
3. **Effect Runner** (`packages/openaxe/src/effect/runner.ts`) — Generic Effect fiber manager with Idle/Running/Shell states
4. **Session Run State** (`packages/openaxe/src/session/run-state.ts`) — CLI-layer InstanceState wrapping Effect Runner per session

These systems had overlapping responsibilities, different state models, and complex coordination. The deletion test confirmed they would concentrate complexity if unified.

## Decision

Create a **Unified Session Runner** in `packages/core/src/session/unified-runner/` with Strangler Fig migration:

### Core Architecture

| Component | Location | Responsibility |
|-----------|----------|----------------|
| `UnifiedRunner` | core | Durable orchestration: `run()`, `cancel()`, `drainSubagents()`, emits `SessionEvent` |
| `SessionEffectRunner` | core (internal) | Minimal executor `run(work): Effect<A,E>`, manages Idle/Running/Shell states |
| `SessionForkService` | core | Shared forking: DB clone + SessionInput chain + EventV2 Forked event |
| `SessionEventSubscriber` | CLI | Streams EventV2 → pure reducer → InstanceState for TUI hot-reload |
| `SessionData` Reducer | shared | Pure function reducing EventV2 → SessionData for TUI |

### Responsibility Split

- **Core owns**: SessionInput admission, SessionHistory projection, compaction, tool settlement, durable state
- **CLI owns**: SessionData reducer + TUI rendering fields (visible, sent, end, lastBashOutput, announced)
- **Core emits**: `SessionEvent` (RunnerStateChanged, Compacted, Interrupted, SubagentForked, SubagentCompleted)
- **CLI subscribes**: EventV2 stream → reduces → publishes SessionData to InstanceState

### Migration Strategy

1. **Build first**: `UnifiedRunner` + `SessionEventSubscriber`
2. **Adapters**: Thin wrappers implementing original interfaces
   - `SessionRunnerAdapter` → wraps `UnifiedRunner.run()`
   - `SessionRunStateAdapter` → wraps `UnifiedRunner` + `SessionEventSubscriber`
   - `SessionDataAdapter` → wraps `SessionEventSubscriber.getData()`
3. **Feature flags**: Per-component (core, cli-subscriber, session, session-run-state, session-data)
4. **Backward compat**: Adapter layers implementing original interfaces

## Consequences

### Positive

- Single source of truth for session execution
- Clean separation: core = durable, CLI = ephemeral UI state
- EventV2 as the single communication channel
- Pure reducer enables property testing and hot-reload
- Subagent drainage built into core orchestration
- Observability via `Effect.Metric` in core + `RunnerStateChanged` events for CLI

### Negative

- Migration effort across 4 systems
- New EventV2 event types needed (RunnerStateChanged, Compacted, Interrupted, SubagentForked, SubagentCompleted)
- CLI must subscribe to EventV2 stream (new dependency)

## Domain Terms Added

1. **UnifiedRunner** — Core durable orchestration service
2. **SessionEventSubscriber** — CLI EventV2 → InstanceState bridge
3. **SessionEffectRunner** — Internal minimal executor
4. **SessionForkService** — Shared forking service
5. **RunnerState** — Ephemeral execution state
6. **SubagentDrain** — Subagent-first execution ordering

## Alternatives Considered

- **Keep separate systems** — Rejected: deletion test shows concentrated complexity
- **Merge into CLI** — Rejected: durable orchestration belongs in core
- **Event sourcing with CQRS** — Rejected: over-engineering for current needs

## References

- ADR-0001: Unified Context Module
- ADR-0002: Unified Tool Registry
- CONTEXT.md: Domain glossary