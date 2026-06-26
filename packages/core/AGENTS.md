# @opencode-ai/core

Core engine package — session, project, tool orchestration, database, filesystem, LLM adapters, permissions, event sourcing.

## Structure (src/ subdirs by domain)

```
Event system —  event.ts, event/sql.ts, public-event-manifest.ts
Session V1 —    session.ts, session/{compaction,context-epoch,event,execution,history,info,input,
                message,message-id,message-updater,projector,prompt,run-coordinator,schema,sql,store,todo}
Session V2 —    session/runner/{index,llm,max-steps,model,publish-llm-event,to-llm-message},
                session/execution/local.ts, system-context/{index,builtins,registry}
Tool system —   tool/{tool,registry,builtins,application-tools,tools,read,write,edit,glob,grep,bash,
                apply-patch,webfetch,websearch,question,skill,todowrite,http-body,read-filesystem}
Config —        config/{agent,attachments,command,compaction,experimental,formatter,lsp,markdown,
                mcp,plugin,provider,reference,tool-output,watcher}
Filesystem —    filesystem/{fff.bun,fff.node,ignore,protected,search,watcher}, filesystem.ts, fs-util.ts
Database —      database/{database,sqlite,sqlite.bun,sqlite.node,migration,path,schema,db},
                data-migration.sql.ts
Permissions —   permission/{saved,sql}, permission.ts
Provider/LLM —  provider.ts, model.ts, models-dev.ts, aisdk.ts, agent.ts, credential/{sql}, integration
Plugins —       plugin/{agent,command,host,internal,models-dev,promise,provider,skill,variant}
Effect utils —  effect/{keyed-mutex,layer-node-platform,layer-node,memo-map,runtime,service-use}
Control plane — control-plane/{move-session,workspace.sql}
Observability — observability/{logging,otlp,shared}
Util —          util/{array,binary,effect-flock,encode,error,flock,glob,hash,identifier,iife,
                lazy,module,path,retry,slug,token,which,wildcard}
Public API —    public/{index,agent,location,model,opencode,session,tool}
V1 compat —     v1/{config,permission,session}
Other —         account, command, credential, flag, github-copilot, id, image, installation,
                integration, location, npm, npm-config, patch, pty, reference, repository, ripgrep,
                schema, share, shell, skill, snapshot, state, tool-output-store, v2-schema, workspace
```

## Critical Patterns

**Conditional #import system.** `package.json#imports` maps three platform conditionals:
- `#sqlite` → `sqlite.bun.ts` / `sqlite.node.ts` — SQLite driver per runtime
- `#pty` → `pty.bun.ts` / `pty.node.ts` — PTY/spawn per runtime
- `#fff` → `fff.bun.ts` / `fff.node.ts` — fast file finder per runtime

Use `import { X } from "#sqlite"` in code that needs platform-dependent impl. Do not import `sqlite.bun.ts` directly.

**Subpath exports.** Every `src/*.ts` and `src/<dir>/index.ts` is importable as `@opencode-ai/core/<path>`. `@opencode-ai/core/public` is the stable external API — 7 files (Agent, Model, OpenCode, Session, Tool, Location, Prompt, AbsolutePath). Everything else is internal. Do not import from `/public` internally.

**Two session implementations.** `src/session/` is V1 (legacy, ~20 sibling files — keep them flat, no new barrels). `src/session/runner/` + `src/system-context/` is V2. `src/v1/` holds compatibility shims. New session work goes in V2.

**Event system.** `Event.listen()` is deprecated — use `all()` + Stream consumption. Events use aggregate-based sequence IDs (`EventV2.latestSequence`). See `src/event.ts` for `Subscriber`, `SerializedEvent`, and `durableEventManifest`.

**Config modules.** Every `src/config/*.ts` uses `export * as ConfigX from "./x"` self-export at the top (per AGENTS.md module shape rule).

**Schema tables.** Use snake_case field names in Drizzle schema. `src/database/schema.sql.ts` exports `Timestamps` ({`time_created`, `time_updated`}) for reuse.

## Anti-Patterns

- Do not add opencode-specific tables to `@opencode-ai/effect-drizzle-sqlite` — that package is generic SQLite+Effect; core-specific tables go in `src/database/`.
- Do not use hand-rolled process wrappers — `ChildProcessSpawner` from `@effect/platform` is the canonical spawner.
- Do not add barrel `index.ts` to multi-sibling dirs (`session/`, `config/`, `tool/`, `util/`, etc.) — it forces all siblings through one import. Each sibling is imported directly.
- Do not import from `@opencode-ai/core/public` inside the core package — that's the external consumer API.
- Do not add new v1 code — the `v1/` compat layer exists for migration only.

## Commands

```bash
# typecheck (run from packages/core)
tsgo --noEmit

# test (run from packages/core)
bun test --only-failures

# database migration
bun run script/migration.ts
```
