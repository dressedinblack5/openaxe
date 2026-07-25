# LSP Native Client

## Overview

Effect-based native LSP client (not an MCP wrapper). Direct JSON-RPC 2.0 over stdio with push+pull diagnostic merge, per-server debounce, and automatic server download.

## Structure

```
src/lsp/
├── lsp.ts          — Effect service (Interface + Service + layer), 23 methods, InstanceState-scoped
├── client.ts        — JSON-RPC via vscode-jsonrpc, push+pull diagnostic merge, per-server debounce
├── server.ts       — 30+ builtin server definitions, 15 with auto-download
├── launch.ts        — Child process spawn helper
├── diagnostic.ts    — Diagnostics-to-string formatting
├── language.ts      — Extension → languageId mapping
└── lsp.txt          — Tool documentation (src/tool/lsp.txt)
```

## Key Patterns

- **InstanceState-scoped**: Single `State` per open project (clients, servers, broken map, spawning map). Cleaned up on project close.
- **Broken server retry**: Failed spawns tracked with 5-minute TTL. Auto-retried after cooldown.
- **Spawning dedup**: `spawning: Map<string, Promise<...>>` prevents concurrent spawns for same server+root pair.
- **Error isolation**: All LSP requests catch errors to `null`/`[]` — never propagate transport errors.
- **Diagnostic merge**: Push (server-sent) + pull (on-demand) diagnostics merged per file, deduped by message.

## Key Operations

| Operation | LSP Request |
|---|---|
| `goToDefinition` | `textDocument/definition` |
| `findReferences` | `textDocument/references` |
| `hover` | `textDocument/hover` |
| `documentSymbol` | `textDocument/documentSymbol` |
| `workspaceSymbol` | `workspace/symbol` |
| `codeAction` | `textDocument/codeAction` |
| `applyCodeAction` | `textDocument/codeAction` (resolve) + apply edit |
| `rename` | `textDocument/rename` |
| `completion` | `textDocument/completion` |
| `formatting` | `textDocument/formatting` |
| ...and 13 more | |

## Auto-Verification

Every file mutation (`edit`, `write`, `apply_patch`) triggers `touchFile` + `diagnostics()` automatically.

## Anti-Patterns

- Do not use LSP as an MCP wrapper — it's a native JSON-RPC client.
- Do not propagate transport errors to callers — catch and return null/empty.
- Do not spawn concurrent servers for the same server+root pair — `spawning` map dedupes.
