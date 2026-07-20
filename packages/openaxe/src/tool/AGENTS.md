# TOOL SYSTEM

CLI tool orchestration for **openaxe**. Manages tool registration, execution, and plugin integration. ~40 files.

## STRUCTURE

```
src/tool/
├── registry.ts        ToolRegistry service — registration, lookup, discovery
├── tool.ts            Base tool definitions, Context, and execution wrapper
├── schema.ts          Shared tool schemas and validation
├── external-directory.ts External tool directory loading logic
├── shell/             Shell-specific tool implementations (bash)
├── edit.ts            Advanced file editing with fuzzy matching
├── read.ts            File reading with line limits and truncation
├── task.ts            Subagent task delegation tool
└── ...                (30+ individual tool implementations)
```

## WHERE TO LOOK

| Concern | File | Role |
|---------|------|------|
| Registration | `registry.ts` | Built-in and plugin tool discovery |
| Base Types | `tool.ts` | `Def`, `Context`, `ExecuteResult` |
| File Mutation | `edit.ts`, `write.ts` | `edit` (fuzzy), `write` (full) |
| File Discovery | `glob.ts`, `grep.ts` | `glob` (patterns), `grep` (content) |
| Subagents | `task.ts` | Spawning child agents |
| External Tools | `registry.ts` | Loading from `tool/` dirs or plugins |

## KEY PATTERNS

### Tool Definition
Tools use `define(id, init)` from `tool.ts`. `init` is an Effect that returns the tool's description, parameters (Schema), and `execute` function.

```ts
export const MyTool = define("my_tool", Effect.gen(function*() {
  return {
    description: "Does something",
    parameters: MySchema,
    execute: (args, ctx) => Effect.gen(function*() { ... })
  }
}))
```

### Execution Flow
1. **Lookup**: `ToolRegistry.tools()` returns available tools for a model/agent.
2. **Validation**: `tool.ts` wraps `execute` to validate arguments against `parameters` schema.
3. **Context**: `Context` provides `sessionID`, `messageID`, and `ask` (permission requests).
4. **Truncation**: Tool output is automatically truncated via `Truncate` service if it exceeds limits.

## NOTES

- **Permissions**: Tools must call `ctx.ask()` for sensitive operations (e.g., `edit`, `shell`).
- **External Tools**: Loaded from project-configured tool directories or installed plugins.
- **LSP Integration**: Mutation tools (like `edit`) trigger LSP diagnostics to report errors immediately.
