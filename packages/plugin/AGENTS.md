# @opencode-ai/plugin

Plugin SDK and loader. Defines entry points for tool, TUI, effect, and promise plugins consumed by openaxe and tui.

## Structure

```
packages/plugin/src/
  server/     server-side plugin runtime and API
  tui/        TUI plugin runtime, internal plugins, slots
  v2/         v2 plugin entry points (effect, promise)
  shared.ts   PluginPackage, PluginKind, PluginEntry types and resolution
  loader.ts   plugin module loader
  install.ts  npm plugin install and manifest reading
  meta.ts     plugin metadata store (first/last load, fingerprint, themes
```

## Conventions

- Plugin is a package declaring exports entrypoints in package.json under `exports["./server"]` or `exports["./tui"]`
- Three V2 entry types: effect-server, promise-server, tui (tagged union)
- Runtimes: effect (Effect), promise (async fn), tui (SolidJS plugin module)
- Plugin source: "file" (local path/URL) or "npm" (npm package)
- Plugin metadata persisted in plugin-meta.json (first/last load, fingerprint, themes)
- Theme files declared via `oc-themes` field in package.json

## Anti-Patterns

- Plugin loader should not import session/Domain/LLM services — plugins get an API object
- Plugin dependencies (tools, providers) are resolved by the consuming host, not self-registered