# Production Binary Build & Verification

```sh
# 1. Build all platforms (from packages/openaxe/)
bun run build
# → dist/openaxe-{linux-x64,linux-arm64,linux-musl,darwin-x64,darwin-arm64,win32-x64}/bin/openaxe

# 2. Copy system-wide (linux-x64 only, build does this automatically)
# Build script already copies libopentui.so → bin/
```

## Smoke tests (must pass)

```sh
bin/openaxe --version     # → "local" (exit 0)
bin/openaxe --mini        # → reaches TTY interactive mode (no hang)
```

## Integration test

```sh
timeout 30 bin/openaxe run "say hi in one word"
# Must return text response, not hang. Expected ~20s wall time.
```

## Plugin sanity

```sh
# All plugins in config must be cached under:
ls ~/.cache/openaxe/packages/
# Each dir must have node_modules/<name>/ present
```

## Stale caches

Missing `node_modules/` in any cached plugin dir triggers `Npm.add()` →
`import("@npmcli/arborist")` which **hangs in compiled binary**. If a new
external plugin is added to config, run it in dev mode first so caching happens.

## Diagnostic toolkit

| Symptom | Tool |
|---------|------|
| Binary hangs (no output) | `strace -f -o /tmp/trace bin/openaxe --mini` → look for futex-only loops |
| Unknown plugin overhead | `bin/openaxe --pure run "x"` as baseline, then per-plugin isolation |
| Plugin load failure | `--pure` works → external plugin issue. Dev mode to check which one. |
