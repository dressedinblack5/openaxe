# PLUGIN LOADING

## OVERVIEW

Plugin lifecycle management for openaxe. Resolution, deferred loading, installation, and config dedup. ~11 files.

## STRUCTURE

```
src/plugin/
├── index.ts           PluginLayer service — InstanceState + Effect.cached for deferred external loading
├── loader.ts          Core load pipeline — Phase 1 parallel loads, Phase 2 retry for file plugins
├── shared.ts          parsePluginSpecifier, resolvePluginTarget, createPluginEntry, readV1Plugin
├── install.ts         npm install + config patching
├── meta.ts            Metadata tracking
├── npm.ts             Npm.add via @npmcli/arborist
├── azure.ts           Azure cloud provider plugin
├── cloudflare.ts      Cloudflare cloud provider plugin
├── digitalocean.ts    DigitalOcean cloud provider plugin
```

## WHERE TO LOOK

| Task                              | File                                     |
| --------------------------------- | ---------------------------------------- |
| Plugin service / deferred loading | `src/plugin/index.ts`                    |
| Load pipeline (resolve → load)    | `src/plugin/loader.ts`                   |
| Specifier parsing + dedup         | `src/plugin/shared.ts`                   |
| npm install + config              | `src/plugin/install.ts`                  |
| Arborist integration              | `src/plugin/npm.ts`                      |
| Bundled plugins config            | `src/config/config.ts` (BUNDLED_PLUGINS) |
| Config dedup                      | `src/config/plugin.ts`                   |

## KEY PATTERNS

- **Deferred External Loading**: `Effect.cached` + `Effect.once` in PluginLayer. External plugins load once, lazily. Subsequent accesses return cached result.
- **Two-Phase Load**: Phase 1 — parallel file loads for all plugins. Phase 2 — retry any failures.
- **Specifier Normalization**: `parsePluginSpecifier` converts GitHub shorthand `user/repo` to `@user/repo` and lowercases scopes. Ensures dedup works across formats.
- **Plugin Dedup**: Deduplication via `Set<spec.pkg>` at 3 merge sites (BUNDLED_PLUGINS, config, external).

## NOTES

- **Plugin Kinds**: External (npm), bundled (built-in), file (local path). Each has a different resolve path.
- **V1 Compatibility**: `readV1Plugin` detects legacy plugins and wraps them in the v2 interface.
- **TUI Path**: TUI runtime uses separate `resolveExternalPlugins` + `PluginLoader.loadExternal(kind='tui')`.
- **Cloud Providers**: Azure, Cloudflare, DigitalOcean have dedicated plugin modules.
