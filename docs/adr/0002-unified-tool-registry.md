# ADR-0002: Unified Tool Registry

**Status**: Accepted
**Date**: 2026-08-24

## Context

The openaxe codebase had three parallel tool systems causing architectural friction:

1. **Core Tools** (`packages/core/src/tool`) - Effect + Schema, returns `Definition` with `settle()`
2. **CLI Tools** (`packages/openaxe/src/tool`) - Effect + Schema + AI SDK, defines with `init()`, registry with availability filtering
3. **Plugin Tools** (`packages/plugin/src/tool.ts`) - Zod-based, `tool()` function returning description/args/execute

Each system had different interfaces, schema formats, execution models, and registry APIs. This violated the deletion test: removing any one would concentrate complexity in the remaining systems.

## Decision

Create a new top-level package `packages/tool` with a unified tool system using the Strangler Fig migration pattern:

### Core Architecture

- **Schema**: Dual format - Effect Schema internally, JSON Schema for model output
- **Execution**: Hybrid - Core primitive `Effect.Effect<Output, ToolFailure>`, CLI enriches context/wraps output
- **Registry**: CLI-compatible API (`register`, `get`, `list`, `tools(model)`, `named()`, `settle`)
- **Context**: Layered system `BaseToolContext` → `CliToolContext` → `PluginToolContext`
- **Availability**: Static + Dynamic with memoization per `(flags, providerID, modelID, agentID)` tuple
- **Permissions**: Hybrid - static `permission` on `ToolDefinition` + dynamic `ctx.ask()`
- **Truncation**: Post-execution in `settle()/execute()` via `Truncate` service
- **Subagents**: Tool declares `subagentSafe: boolean` (default `true`)
- **External Tools**: Separate `ExternalToolLoader` service
- **Observability**: Structured metrics via `Effect.Metric`

### Adapters (Strangler Fig)

1. **Core Adapter** (`core-tool.ts`): Thin re-export of unified API
2. **CLI Adapter** (`cli-tool.ts`): Wraps unified + enrichments (truncation, availability, description enhancement)
3. **Plugin Adapter** (`plugin-tool.ts`): Zod compatibility layer (deprecated, not removed)

### Migration Order

1. Unified module (`packages/tool/src/`)
2. Core adapter (thin re-export)
3. CLI adapter (wraps unified + enrichments)
4. Plugin adapter (Zod compat layer)
5. Feature flags per consumer via Effect layer choice

## Consequences

### Positive

- Single source of truth for tool definitions
- Unified schema format eliminates translation layers
- Single registry eliminates duplicate registration logic
- Layered context system enables clean separation of concerns
- Availability filtering with memoization improves performance
- Strangler Fig migration allows incremental adoption without breaking changes
- External tool loading is decoupled from main registry

### Negative

- Migration effort required for existing tool consumers
- Zod compatibility layer adds temporary complexity
- Dual schema format requires careful boundary management

## Domain Terms Added

1. **ToolDefinition** - Unified tool definition using Effect Schema internally, JSON Schema for model output
2. **ToolRegistry** - Single registry service for tool registration, lookup, availability filtering, and execution
3. **ToolContext** - Layered context system: BaseToolContext → CliToolContext → PluginToolContext
4. **ToolAvailability** - Static + Dynamic availability filtering with memoization
5. **ToolPermission** - Hybrid permission model: static permission string + dynamic ctx.ask()
6. **ToolExecution** - Unified execution flow: settle() validates, executes, encodes, truncates
7. **ExternalToolLoader** - Separate service for discovering external tools from filesystem directories

## Alternatives Considered

1. **Keep three systems** - Rejected: violates deletion test, increases maintenance burden
2. **Merge into Core only** - Rejected: loses CLI enrichments (truncation, availability) and Plugin ecosystem
3. **Merge into CLI only** - Rejected: loses Core's Effect-native execution and Plugin's Zod compatibility
4. **New package without adapters** - Rejected: breaking change, no incremental migration path

## References

- Grilling session: 20 questions across 4 rounds
- Architecture review: Candidate 2 (Parallel Tool Registries)
- CONTEXT.md updates with 7 new domain terms
