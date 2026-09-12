# Security Research: Vulnerability Patterns Applicable to openaxe

**Date:** 2026-09-09 · **Scope:** `packages/openaxe/src`, `packages/core/src` · **Method:** CVE/GHSA + bounty writeups + in-repo sink inventory (2 explore agents)

## 1. Effect (effect-ts)

### 1a. AsyncLocalStorage contamination via MixedScheduler (auth bypass)
- **Class:** CWE-362 Race Condition.
- **Real-world:** GHSA-38f7-945m-qr2g / CVE-2026-32887 (`effect < 3.20.0`, fixed in 3.20.0 via PR #6124). `RpcServer.toWebHandler` + Clerk `auth()` returned wrong user's session under concurrent load. Scheduler drained fibers A+B in one microtask, ALS context of whoever triggered `starve()` won. https://github.com/Effect-TS/effect/security/advisories/GHSA-38f7-945m-qr2g · https://effect.website/blog/effect-3-20-security-update/
- **Applicability:** Any `Effect.tryPromise(() => alsBacked())` inside fibers served concurrently. Check `src/server/server.ts:202` (`Effect.all` unbounded close), `src/session/prompt.ts:1028` (`Effect.forEach` unbounded resolvePart), `src/config/config.ts:732` (`Effect.forEach` unbounded Fiber.join). Fix pattern: read ALS values before entering runtime, pass via `HttpServerRequest` headers / Effect Context; pin `effect >= 3.20.0`.
- **Severity:** High (auth bypass when ALS-backed auth is in path; else Medium trace leakage).

### 1b. Unbounded concurrency → resource exhaustion / scope-finalizer leak
- **Class:** CWE-400 Uncontrolled Resource Consumption / CWE-362.
- **Real-world:** Effect #3440 (mikearnaldi): `Effect.scoped(while(true){ Effect.all(..., {concurrency:"unbounded"}) })` leaks — `forEach`/`all` dynamically opens child Scope per call, finalizers accumulate in never-closing parent. ZIO removed the feature; Effect fixed in #3441. https://github.com/Effect-TS/effect/issues/3440
- **Applicability:** `src/session/prompt.ts:1028` unbounded over `input.parts` (LLM-controlled length); `src/server/server.ts:202` unbounded closeAll; `src/config/config.ts:732` unbounded dep join. Bound with fixed N (`instruction.ts:161-162` already uses 8/4 — copy that).
- **Severity:** Medium (DoS via crafted prompt with many parts).

### 1c. forkIn / forkScoped scope escape (daemon leak, use-after-close)
- **Class:** CWE-401 / CWE-362 (lifetime escape).
- **Real-world:** No CVE — documented footgun in Effect docs (daemon vs scoped vs forkIn): `forkDetach` lives to global scope; `forkIn(scope)` outlives parent. Misuse = writes to closed Scope / leaked background loops. https://effect.website/docs/v4/concurrency/fibers
- **Applicability:** 20+ hits: `src/lsp/lsp.ts:243` repeat+forkScoped prune loop; `src/project/vcs.ts:340` `InstanceState.get.pipe(forkIn(scope))`; `src/session/prompt.ts:1249` ignore+forkIn; `src/tool/truncate.ts:147`, `src/config/tui.ts:225`. Audit: every `forkIn` target scope must outlive the fiber; every `forkScoped` must be inside a scope that actually closes (InstanceState disposal).
- **Severity:** Low-Medium (leak / stale writes; escalates if leaked fiber holds auth/net).

### 1d. Schema.decodeUnknown* on untrusted input (prototype pollution / DoS)
- **Class:** CWE-1321 Prototype Pollution / CWE-400.
- **Real-world:** Effect commit `01d00a3` (#2602, 2026-07-12): bracket-path decoding in `SchemaGetter.ts` allowed `__proto__` pollution — fixed with defineProperty guard. Related: `bind`/`__proto__` do-notation issue #5003. https://github.com/Effect-TS/effect/commit/01d00a3abfbf1f37996cdbe738ea5137c646cdd7
- **Applicability:** 20+ decodes of external data: `src/storage/storage.ts:48` `decodeUnknownOption(RootFile)`; `src/config/parse.ts:42` `decodeUnknownExit`; `src/config/agent.ts:50`; `src/config/config.ts:234` `decodeEffect(fromJsonString(schema))(body)`. Ensure `effect` version includes #2602; never `decodeUnknownSync` on LLM/tool output without `errors:"all"` + catch; validate `__proto__`/`constructor` keys at trust boundary.
- **Severity:** Medium (pollution → logic bypass; Low if inputs are local config only).

### 1e. HttpClient / fetch SSRF (see §7 — shared pattern)
- Applicability: `src/installation/index.ts:92,161` (`HttpClient` + `raw.githubusercontent.com/${scriptName}`), `src/config/config.ts:209`, `src/mcp/codegraph.ts:57` bare `fetch(url)`, `src/provider/provider.ts:550` fetch wrapper. See SSRF section for CVE-2026-73307 analogue.

### 1f. ChildProcessSpawner command/argument injection (see §2)
- Applicability: `src/project/project.ts:110,119-120` (`ChildProcess.make("git", args)`), `src/mcp/index.ts:211,439` (`pgrep`), `src/session/prompt.ts:135,579` (`ChildProcess.make(sh, args)`), `src/snapshot/index.ts:3`. See Bun `$`/spawn section.

## 2. Bun runtime

### 2a. `$` shell API command injection + argument injection
- **Class:** CWE-78 OS Command Injection.
- **Real-world:** GHSA-4j66-8f4r-3pjx / CVE-2025-8022 (`bun <= 1.1.39`): `$` tagged-template did not neutralize shell metachars / `--upload-pack=`-style flag injection. PoC: `` $`git ls-remote ${userRepo} main` `` with `userRepo="--upload-pack=env>hello;"` → arbitrary exec. https://www.bunsecurity.dev/blog/bun-security-vulnerability-command-injection/ · https://osv.dev/vulnerability/GHSA-4j66-8f4r-3pjx · CVE-2024-21548 (prior Bun RCE, same class).
- **Applicability:** `src/util/process.ts:94,146` central `spawn(cmd: string[])` + `Bun.spawn` wrapper — safe only if callers never build `sh -c` strings and always pass argv arrays with `--` separator. `src/session/prompt.ts:579` `ChildProcess.make(sh, args)` — verify `sh` is never `/bin/sh -c` with interpolation. `src/cli/cmd/db.ts:38` `spawn("sqlite3", [Database.path()])` — fixed argv, Low. Grep: `rg 'sh.*-c|Bun\.spawn\(.*\+|\$\`.*\$\{'`.
- **Severity:** High-Critical if any LLM/tool-controlled string reaches shell; Low with strict argv + `--`.

### 2b. Bun.file / Bun.write path traversal + symlink escape
- **Class:** CWE-22 Path Traversal / CWE-59 Link Following.
- **Real-world:** oven-sh/bun PR #26955 (2026-02-12): symlink-chain traversal in `libarchive.zig` extraction — 3 individually-safe symlinks (`x/a→.`, `x/a/b→.`, `x/a/b/c→../..`) escape extraction dir; affects `bun create`/`extractToDisk`. Plus canonical audit pattern: `Bun.file(`./uploads/${file}`)` with `file="../../etc/passwd"`. https://github.com/oven-sh/bun/pull/26955
- **Applicability:** `src/util/filesystem.ts:120` `Bun.file(p).type`; `src/session/template.ts:38,41` `Bun.file(file).exists()/text()` (template path — check caller sanitization); `src/installation/index.ts:169,176` `Bun.write(tempPath)` + `Bun.file(tempPath).delete()`. Enforce `basename` + `resolve` + `startsWith(dir)` guard before every `Bun.file/write` on external input.
- **Severity:** High (arbitrary read/write when path is user/LLM-controlled).

### 2c. bun:sqlite silent-NULL binding (logic bypass, not classic inject)
- **Class:** CWE-704 / CWE-20 (silent wrong-result).
- **Real-world:** oven-sh/bun #39877 + #22799 + PR #37109: default (non-`strict`) `bun:sqlite` requires prefixed keys (`:p1`) and binds missing params to NULL silently; `Bun.SQL.unsafe()` spread objects via `$apply` dropping named bindings → empty results, no error. Opt-in `strict:true` throws on missing. https://github.com/oven-sh/bun/issues/39877
- **Applicability:** Prefer Drizzle parameterized layer (below) over raw `bun:sqlite`; if raw is used, construct with `strict:true` and test typo'd keys. `Bun.SQL.unsafe` is documented "you own the query string" — never interpolate.
- **Severity:** Medium (authz bypass via NULL-match is the realistic impact, not RCE).

## 3. TypeScript / ESM module system

### 3a. Dynamic import() RCE via attacker-controlled specifier
- **Class:** CWE-94 Code Injection.
- **Real-world:** CVE-2025-67489 (`@vitejs/plugin-rsc <= 0.5.5`): `loadServerAction/decodeReply/decodeAction` did `import(id)` where `id` came from `x-rsc-action` header / `$ACTION_ID_` form field — `data:text/javascript,...` payloads executed with Node privileges. PoC repo mitsuhiko/rsc-rce-poc shows ESM prefix-check bypass via `../` traversal. https://github.com/vitejs/vite-plugin-react/security/advisories/GHSA-j76j-5p5g-9wfr
- **Applicability:** 20+ dynamic imports, all currently static specifiers (safe shape): `src/cli/tui/worker.ts:32,63,70` (`@/server/auth`, `@/server/server`); `src/cli/cmd/github.ts:12` (`./github.handler`); `src/cli/network.ts:40`; `src/cli/heap.ts:18`. Rule: never `import(userInput)`; plugin loader (`src/plugin/`) must allowlist specifiers + canonicalize (`realpath`) before import; reject `data:`/`file:`/absolute-outside-root.
- **Severity:** Critical if specifier ever becomes plugin/LLM-controlled; currently Low (static strings).

### 3b. import.meta.url manipulation / createRequire escape
- **Class:** CWE-22 / CWE-94 (trust-boundary escape).
- **Real-world:** Same CVE-2025-67489 family: ESM `startsWith(baseURL)` check bypassed by `../` without canonicalization.
- **Applicability:** `src/cli/cmd/tui.ts:121-123` `new URL("./cli/tui/worker.js", import.meta.url)`; `src/cli/native-lib.ts:27` `join(dirname(fileURLToPath(import.meta.url)),...,"bin",LIB_NAME)`; `src/mcp/codegraph.ts:41` `createRequire(import.meta.url).resolve(...)`; `packages/core/src/npm-config.ts:10`. Safe as long as suffixes are literals; if any segment becomes configurable, `realpathSync` + `startsWith(root)` check required.
- **Severity:** Low currently; High if plugin path joins user input.

### 3c. Node builtins exposure to plugins/tools
- **Class:** CWE-749 Exposed Dangerous Function.
- **Real-world:** Pattern-level (no single CVE): any `node:child_process`/`node:fs` reachable from sandbox = sandbox escape.
- **Applicability:** `src/cli/cmd/db.ts:2` unprefixed `child_process`; `packages/core/src/cross-spawn-spawner.ts:32`, `auto-commit.ts:3` (`node:child_process`); `src/util/process.ts:1`, `src/mcp/codegraph.ts:2`, `packages/core/src/global.ts:2,4` (`node:fs`, `node:os`). Audit plugin/tool boundary: plugins must not receive raw `spawn`/fs handles — only capability-scoped wrappers.
- **Severity:** Medium (depends on plugin trust model).

## 4. Drizzle ORM + SQLite

### 4a. SQL injection via sql.identifier() / escapeName()
- **Class:** CWE-89 SQL Injection.
- **Real-world:** GHSA-gpj5-g38j-94v9 / CVE-2026-39356 (CVSS 7.5 High): `escapeName()` wrapped identifiers without doubling embedded delimiters (`"`→`""`, backtick→double-backtick). `sql.identifier(sortField)` / `.as(alias)` with attacker input → breakout. Fixed in `0.45.2` / `1.0.0-beta.20`. https://github.com/drizzle-team/drizzle-orm/security/advisories/GHSA-gpj5-g38j-94v9
- **Applicability:** Direct hits: `packages/core/src/database/migration.ts:55` `sql.identifier("migration")` (literal — safe), `:87` `sql.identifier(savepointName)` — **verify savepointName is internally generated, never user input**; `packages/openaxe/src/project/project.ts:179` raw `` sql`${SessionTable.time_updated}` `` (column ref — safe shape); `packages/core/src/database/fts.ts:166,205,235` `sql\`...${param}\`` — Drizzle binds `${}` as values (safe), but `:235` builds `sql\`AND f.session_id = ${sessionFilter}\`` conditionally — safe only because value-bound. Rule: pin `drizzle-orm >= 0.45.2`; never pass request/LLM strings to `sql.identifier()`/`sql.raw()`; dynamic sort → allowlist columns.
- **Severity:** High if identifier path reachable; Low for current literal/value-bound usage.

### 4b. Migration injection (raw DDL execution)
- **Class:** CWE-89 (second-order).
- **Real-world:** Same advisory family — migration statements built from untrusted table/column names inherit the identifier bug.
- **Applicability:** `packages/core/src/database/migration.ts`, `migration.gen.ts`, `migration/20260227213759_add_session_workspace_id.ts:8` `tx.run(ALTER TABLE...)`. Migrations are checked-in literals (safe); risk only if a future migration interpolates runtime data — forbid it.
- **Severity:** Low currently.

## 5. vscode-jsonrpc / LSP

### 5a. LSP server command hijack (workspace-controlled executable)
- **Class:** CWE-77 Command Injection / CWE-829 Untrusted Include.
- **Real-world:** CVE-2026-46508 (Turborepo LSP < 2.9.14000, CVSS 8.4 High): task names + workspace settings interpolated into shell strings → opening malicious repo = RCE. CVE-2026-48122 / CVE-2026-34060 (Ruby LSP < 0.10.4/0.26.9): `.vscode/settings.json` overrode ruby executable / `rubyLsp.branch` interpolated into generated Gemfile → arbitrary Ruby exec. https://github.com/vercel/turborepo/security/advisories/GHSA-5xc8-49mv-x4mm
- **Applicability:** `src/lsp/server.ts:119,274,420` (`spawn(deno,["lsp"])`, `spawn(lintBin,["--lsp"])`, `spawn(bin,["--lsp"])`) — **check where `deno/lintBin/bin` resolve from**: if PATH/workspace-relative, malicious repo can plant a binary (same class as Ruby LSP). `src/lsp/launch.ts:7,19` spawn wrapper; `src/acp/service.ts:975` `command:[server.command, ...server.args]` (ACP server config — same trust question). Mitigations: absolute-path allowlist for servers, `execFile`-style argv (no shell), Workspace-Trust gate, never honor workspace-provided server binary paths.
- **Severity:** High (repo-open = code exec if binary path is workspace-influenced).

### 5b. JSON-RPC request smuggling / unsolicited notifications
- **Class:** CWE-436 / CWE-20.
- **Real-world:** No direct vscode-jsonrpc CVE; class comes from LSP bounty history (malformed `Content-Length` framing → message-boundary confusion between multiplexed clients).
- **Applicability:** `src/lsp/client.ts:3,125` `createMessageConnection(StreamMessageReader(stdout), StreamMessageWriter(stdin))` — stdio pipes to spawned server; a compromised server can send arbitrary `window/showMessageRequest`, `workspace/applyEdit`, or `client/registerCapability` messages. Client must ignore unsolicited `workspace/*` requests and cap message size.
- **Severity:** Medium (requires compromised/malicious language server).

## 6. MCP (Model Context Protocol)

### 6a. OAuth authorization_endpoint → RCE (the headline MCP bug class)
- **Class:** CWE-78 OS Command Injection.
- **Real-world:** CVE-2025-6514 (CVSS 9.6 Critical, `mcp-remote 0.0.5–0.1.15`): malicious server's `/.well-known/oauth-authorization-server` returns `authorization_endpoint: "a:$(cmd.exe /c ...)"`; client's `sanitizeUrl` preserved first-char `$`, then `open(url)` → PowerShell subexpression exec. Windows full RCE, macOS/Linux arbitrary-binary exec. Follow-ups: CVE-2025-58444 (MCP Inspector < 0.16.6, `javascript:` redirect → XSS → stdio-proxy RCE, $2300 Anthropic bounty), Claude Code/Gemini CLI `cmd.exe /c start &calc` and `powershell Start-Process "${url}"` variants, `use-mcp` `window.open(authUrl)` XSS. https://jfrog.com/blog/2025-6514-critical-mcp-remote-rce-vulnerability/ · https://verialabs.com/blog/from-mcp-to-shell/
- **Applicability:** `src/mcp/oauth-provider.ts`, `src/plugin/openai/codex.ts:83,513` (`redirect_uri`), `packages/core/src/config/mcp.ts:22` (`redirect_uri` schema). Audit every `open`/`xdg-open`/`start`/`Start-Process` call on OAuth URLs: enforce `http(s)` scheme allowlist, `execFile` argv (no shell), reject `javascript:`/`data:`/`file:`/`a:` schemes. Never pass `authorization_endpoint`/`token_endpoint` strings into spawn argv without `new URL()` + scheme+host validation (MCP-275 flag-injection: `--upload-pack=` URLs interpreted as flags by git/curl).
- **Severity:** Critical (connect-to-untrusted-server = RCE when browser-open path is shell-based).

### 6b. Tool execution / tool poisoning (prompt-injection → tool abuse)
- **Class:** CWE-77 / CWE-1427 (AI-specific: poisoned tool descriptions).
- **Real-world:** Docker 2025 MCP ecosystem scan: 43% OAuth/cmd-injection flaws, 5.5% tool-poisoning (false tool descriptions steering agents to exfiltrate). https://www.docker.com/blog/mcp-security-issues-threatening-ai-infrastructure/
- **Applicability:** `src/mcp/catalog.ts:42` `convertTool(mcpTool, client, timeout)` — tool names/descriptions/schemas come from the server. Treat as untrusted: display origin, require confirmation for destructive tools, schema-validate args, timeout + sandbox stdio servers. `src/mcp/index.ts:360` `StdioClientTransport({command, args})` — `command` from config = local exec; config file is a trust boundary (malicious config = RCE, same as malicious workspace in §5a).
- **Severity:** High (untrusted server / config).

### 6c. Transport hijack: stdio ↔ SSE/StreamableHTTP + SSRF in discovery
- **Class:** CWE-918 SSRF / CWE-200 info leak.
- **Real-world:** Dev.to 2026-08-29 report: AI SDK `discoverOAuthProtectedResourceMetadata()` fetched server-controlled `serverUrl` + followed redirects (`redirect:'follow'`) with no `validateDownloadUrl` on the discovery path — SSRF to `127.0.0.1`/metadata endpoints. https://dev.to/thecrazyrabbit/how-i-found-an-ssrf-in-an-ai-sdks-oauth-metadata-discovery-4mkp
- **Applicability:** `src/mcp/index.ts:275,282` (`StreamableHTTPClientTransport(url)`, `SSEClientTransport(url)`), `src/cli/cmd/mcp.ts:822`, `src/mcp/codegraph.ts:57` bare `fetch(url)`. Validate discovery URLs (scheme/host allowlist, no redirects to private nets — see §7), pin `redirect:'error'` or manual allowlisted follow.
- **Severity:** High (cloud-metadata cred theft when MCP URL is attacker-influenced).

## 7. Cross-cutting: SSRF via fetch() (Bun/Effect/MCP/LLM shared sink)

- **Class:** CWE-918 SSRF (+ CWE-367 TOCTOU on naive DNS pre-checks).
- **Real-world:** CVE-2026-73307 (Budibase `uploadUrl()` bare `fetch(url)` on LLM-generated attachment URLs → metadata-endpoint read; fix: `fetchWithBlacklist()`); CVE-2026-43993 (JunoClaw WAVS `fetch(agentUrl)`); Capital One 2019 (169.254.169.254 → IAM creds → 100M records); GitLab Import-from-URL → internal K8s API. AI-specific twist: LLM output as URL source (prompt injection → model emits `http://169.254.169.254/...` → app fetches). Writeups: dev.to "Why Cursor Keeps Writing SSRF" (2026-07-05), "The SSRF Fix Cursor Writes Is Still Vulnerable" (TOCTOU: check-then-`fetch(url)` re-resolves DNS — must validate inside connection via undici `Agent({connect:{lookup}})` + `redirect:'error'` + IMDSv2 + egress deny). https://github.com/advisories/ghsa-hfhx-w8p8-4hc7
- **Applicability:** `src/session/instruction.ts:162` `Effect.forEach(urls, fetch, {concurrency:4})` — **highest-priority audit: where do `urls` come from?** (LLM output = agentic-SSRF sink); `src/mcp/codegraph.ts:57`; `src/provider/provider.ts:550`; `src/cli/tui/worker.ts:45`; `src/installation/index.ts:161`. Apply: scheme allowlist (https only), DNS-pin validation at connect time, `redirect:'error'`, timeout, egress deny for 169.254/10/172.16/192.168 from fetcher role.
- **Severity:** High (cred theft / internal recon; Critical with cloud IAM role attached).

## Priority checklist (cheapest first)

1. `rg 'sql\.identifier|sql\.raw|sql\.unsafe' packages/*/src` — confirm no user/LLM input; pin `drizzle-orm >= 0.45.2`. (§4a)
2. `rg 'forkIn|forkScoped|forkDetach' packages/openaxe/src --glob '*.ts'` — bound unbounded `forEach` (prompt.ts:1028, server.ts:202, config.ts:732 → fixed N). (§1b/1c)
3. `rg 'Bun\.file|Bun\.write|import\(|createRequire|fileURLToPath' packages/openaxe/src` — path guards + static-only imports. (§2b/3a/3b)
4. `rg 'StdioClientTransport|server\.command|\.command,' packages/openaxe/src` + OAuth `open|Start-Process|xdg-open` — scheme allowlist + execFile argv. (§5a/6a/6b)
5. `rg 'fetch\(|HttpClient' packages/openaxe/src packages/core/src` — SSRF guard on instruction.ts:162 + codegraph.ts:57 + provider.ts:550. (§7)
6. Pin `effect >= 3.20.0` (ALS fix) and audit `tryPromise(alsBacked)` in request paths. (§1a)
7. LSP server binaries: absolute-path allowlist, no workspace-relative resolution. (§5a)

## Sources

- Effect GHSA-38f7-945m-qr2g / CVE-2026-32887 · Effect #3440/#3441 · Effect #2602/#5003
- Bun GHSA-4j66-8f4r-3pjx / CVE-2025-8022 · CVE-2024-21548 · oven-sh/bun #26955 #39877 #22799 PR #37109
- Vite CVE-2025-67489 / GHSA-j76j-5p5g-9wfr · mitsuhiko/rsc-rce-poc
- Drizzle GHSA-gpj5-g38j-94v9 / CVE-2026-39356
- Turborepo GHSA-5xc8-49mv-x4mm / CVE-2026-46508 · Ruby LSP CVE-2026-48122 / CVE-2026-34060
- MCP CVE-2025-6514 (JFrog) · CVE-2025-58444 / GHSA-g9hg-qhmf-q45m (Veria Labs, $2300) · Docker MCP 2025 scan · MCP-275 flag-injection
- SSRF CVE-2026-73307 (Budibase) · CVE-2026-43993 (JunoClaw) · Capital One 2019
