# openaxe — CLI orchestrator package

This package is the CLI orchestrator of the **openaxe** monorepo — yargs entry point, session engine, tool system, HTTP server, plugin loader, and ACP protocol layer.

The full project README (features, quick start, user guide, plugins, configuration, built-in tools, security, architecture) lives at the [repository root](../../README.md).

For development guidance — module layout, Effect v4 rules, LSP native tooling, and anti-patterns — see the package's [`AGENTS.md`](./AGENTS.md).

## Quick reference

```bash
bun dev              # Start TUI dev server (primary, no binary)
bun test             # Run tests (--timeout 60000)
bun run typecheck    # TypeScript check via tsgo
bun run build        # Build binary via script/build.ts (distribution only)
```

> **Note:** `bun dev` runs the TUI directly from source — this is the primary way to run openaxe (Linux/macOS rolling release, no binary). The binary (`bun run build`) is only needed for **Windows distribution** and official releases.

## Links

- [Project README](../../README.md)
- [GitHub](https://github.com/dressedinblack5/openaxe)
- [Upstream](https://github.com/anomalyco/opencode)
