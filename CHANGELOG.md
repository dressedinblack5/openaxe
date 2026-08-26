# Changelog

All notable changes to this project are documented here. This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- **LSP.Diagnostic**: `LSP.Diagnostic.pretty()` and `LSP.Diagnostic.report()` were undefined. Fixed by exporting the diagnostic namespace instead of an empty schema type.

### Added
- **Separate provider/model for learning reviews** — `experimental.learning.provider` config lets the post-turn learning review run on a different provider than the agent's own (original provider/model still used as fallback). Reviews now go through the AI SDK (`generateText`) instead of raw `chat/completions` fetching.

### Performance
- **TUI startup cut ~48% to first data** — pre-start the server module so its eval overlaps the worker boot, pre-warm the shared instance boot before the TUI sync's first requests, and flag the sync `complete` after the blocking batch so the model dialog unlocks before the slow tail (sessions/LSP/MCP/VCS) streams in. Measured with `OPENAXE_STARTUP_TIMING=1` on an idle machine: sync-blocking-done 16846ms → 8810ms, first content 8974ms → 6447ms, TTF 7430ms → ~5800ms.

### Removed
- **`openaxe memory` CLI command removed** — AXE.md file sync is deleted. Project memory now lives in WorkspaceMemory (project-scoped SQLite with semantic search), injected into the LLM context via the `core/workspace-memory` system-context builtin. Breaking change for users of the AXE.md workflow.

## [1.2.6] - 2026-07-16

### Added
- **Typecheck CI passes for all 13 packages** — fixed `@opencode-ai/plugin` (missing `@types/bun`, tsconfig types), `@opencode-ai/script` (missing typecheck script), `@opencode-ai/tui` (pre-existing Timeout type mismatch). Added `sst-env.d.ts` to `.gitignore`, removed 13 tracked copies.

### Refactored
- **HttpApi error types**: replaced 73 `as any` casts across 16 route group files with a single `errors()` helper in `errors.ts` — one retained `as any` instead of 73.
- **Core type hygiene**: replaced 4 `as any` in `glob.ts` and `sqlite.bun.ts` with narrower casts (`never[]`, `Record<string, unknown>`).
- **Exported `Repository.trimGitSuffix`** from core for cross-package reuse.

## [1.2.5]

### CI / Testing
- Stabilize Windows CI: shard openaxe tests 3-way, disable file watcher on Windows, and add hang guards to prevent ~20-min timeouts.
- Rework test parallelism to avoid Bun worker crashes (SIGILL) and OOM on hosted runners; bump per-test/job timeouts (up to 180s) for slow runner paths.
- Prevent test plugin runtimes from loading real plugins or default bundled plugins during init.
- Add `HttpApi`, `session`, `ACP`, `PTY`, and `workspace` test timeouts and warm-up steps to eliminate flaky CI hangs.
- Fix CI to use the local `setup-bun` action and GitHub-hosted runners; align publish/release workflows with the `main` branch and fork repo.

### Fixed
- **LSP**: run LSP interop tests in a temp dir instead of the repo root (was timing out on Windows).
- **HTTP server**: bound stop-chain timeouts to prevent process hangs; add fetch timeouts to server tests.
- **MCP**: add abort signals, content-filter error path, and a `cwd` CLI flag.
- **TUI**: align SDK location parameters with flat bracket keys.
- **Core**: strip V2 speculative TODOs; update test expectations after cleanup.
- Skip Bedrock tests when AWS credentials are absent.

### Added
- `run`: collapsed thinking view for reasoning entries.

### Chore / Refactor (lighter fork)
- Remove unused deps: `immer`, `chokidar`, `mime-types`, `strip-ansi`, `which`; replace `which` with `Bun.which()`, mime-types/decimal.js with built-ins, strip-ansi with inline regex.
- Remove `superpowers` from bundled plugins (switch to `obra/superpowers`); update READMEs, install scripts, and curl upgrade URL to point at `main`.
- Add GitHub Releases draft workflow (`release.yml`).
- Format codebase with Prettier; deduplicate oxlint config.

[1.2.5]: https://github.com/dressedinblack5/openaxe/releases/tag/v1.2.5
