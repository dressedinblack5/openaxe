# Changelog

All notable changes to this project are documented here. This project adheres to [Semantic Versioning](https://semver.org/).

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
