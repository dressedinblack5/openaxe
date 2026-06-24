<p align="center">
  <strong><big>OpenCode</big></strong>
</p>

<p align="center">
  <a href="https://github.com/anomalyco/opencode"><img src="https://img.shields.io/github/v/release/anomalyco/opencode?style=flat&label=upstream" alt="upstream"></a>
  <a href="https://github.com/dressedinblack5/opencode/compare"><img src="https://img.shields.io/github/commits-since/anomalyco/opencode/dev?style=flat&label=commits+ahead" alt="ahead"></a>
  <a href="https://github.com/dressedinblack5/opencode"><img src="https://img.shields.io/github/last-commit/dressedinblack5/opencode?style=flat&label=updated" alt="updated"></a>
</p>

<p align="center">
  Personal fork of <strong>anomalyco/opencode</strong> with project-wide<br>
  plugin and MCP configuration loaded from <code>.opencode/</code>.<br>
  Pull from <code>origin/dev</code>, push features to <code>fork</code>, send PRs upstream.
</p>

---

## User-Added Features

These additions are not present in the upstream `anomalyco/opencode`:

### Plugins

Loaded from `.opencode/opencode.jsonc` (project) + `~/.config/opencode/opencode.jsonc` (user):

| Plugin | Version | Capabilities | Mechanism |
|---|---|---|---|
| **oh-my-openagent** | 4.13.0 | Configurable agent persona, styled conversation, persistent TUI state | TUI plugin + `experimental.chat.system.transform` |
| **opencode-plugin-selector** | 1.0.1 | Enable/disable any plugin on the fly from a TUI panel — no config editing | TUI plugin + `config` hook |
| **superpowers** | 6.0.3 | Injects superpowers bootstrap into every session (skill-awareness, 20+ skill directories); enables brainstorming, TDD, debugging, code review workflows | `config` (registers skills paths) + `experimental.chat.messages.transform` |
| **ponytail** | — | Lazy senior dev mode: appends YAGNI/stdlib-first/minimal-code ruleset to system prompts; persists `/ponytail off\|full\|lite\|ultra` across restarts | `experimental.chat.system.transform` + `command.execute.before` |
| **opencode-vibeguard** | 0.1.0 | Prevents agent drift from project conventions and coding standards | System prompt injection, behavior monitoring |
| **@tarquinen/opencode-dcp** | 3.1.13 | Automatic context management: model-triggered compression (range/message), duplicate tool-call deduplication, errored-tool input pruning, context-limit nudges, `/dcp` panel, prompt overrides | `compress` tool registration + TUI panel + slash commands |
| **ecc-universal** | 2.0.0 | Claude Code compatibility: 61 agents, 400+ skills, 76 commands, agent orchestration, MCP integration, security rules | Multi-hook, TUI plugin, full lifecycle |

### MCP Servers

Configured via MCP protocol — no hooks, accessible as tools to the LLM:

| Server | Purpose |
|---|---|
| **context7** | Live documentation for any library, framework, or API |
| **github** | Full GitHub API — repos, PRs, issues, search |

### Platform fixes (Arch Linux / KDE)

- **Display backend persistence** — `LinuxDisplayBackend` setting stored in electron-store; `--disable-gpu` / `--use-gl=swiftshader` workaround for flickering/black Electron windows on Wayland
- **Inotify limit diagnostic** — detects and warns when `fs.inotify.max_user_watches` is too low for file watchers

---

## Structural Changes vs Upstream

Upstream has 27 packages. This fork keeps **13** — everything else is removed for a lean TUI/CLI-only workspace.

| Removed | Type | Reason |
|---------|------|--------|
| `packages/app` | Web app | Separate project, not TUI/CLI |
| `packages/console` | Web interface | Separate project, not TUI/CLI |
| `packages/containers` | Dockerfiles | CI infra, no package.json |
| `packages/desktop` | Electron app | Desktop GUI, not TUI/CLI |
| `packages/docs` | Docs staging | Orphaned, no package.json |
| `packages/effect-sqlite-node` | SQLite driver | Dead code, nothing imported it |
| `packages/enterprise` | Enterprise portal | Separate project |
| `packages/function` | SST function | Cloud infra, not TUI/CLI |
| `packages/identity` | Icon files | Orphaned, no package.json |
| `packages/session-ui` | Session components | Merged into core already |
| `packages/slack` | Slack bot | Separate project |
| `packages/stats` | Analytics dashboard | Separate project |
| `packages/storybook` | Component playground | Dev-only, zero dependents |
| `packages/web` | Docs website | Separate project |

Also removed:
- **infra/** — SST cloud deployment configs
- **sdks/vscode/** — VS Code extension
- **21 stale README translations** (kept only `README.md`)
- **65 `.stories.*` files** across `ui` and `session-ui`
- **5 dead GitHub workflows** (storybook, docs-locale-sync, containers, docs-update, stats)
- **Electron build job** from publish CI

### Remaining packages (13)

`cli`, `core`, `effect-drizzle-sqlite`, `http-recorder`, `llm`, `opencode`, `plugin`, `schema`, `script`, `sdk`, `server`, `tui`, `ui`

## Performance

| | Upstream | This fork |
|---|---|---|
| Packages | 27 | **13** (52% fewer) |
| `bun install` | ~15-20s | **5.3s** |
| `turbo typecheck` | ~45-60s | **18.4s** |
| node_modules | ~2+ GB | **1.1 GB** |
| CI publish jobs | 3 (npm + electron + docker) | **1** (npm only) |

**What you're not installing:**
| Heavy dependency | Weight saved | Why removed |
|---|---|---|
| Electron | ~400 MB | TUI-only, no desktop GUI |
| Storybook | ~200 MB | Dev tooling, zero runtime dependents |
| Astro + Starlight | ~150 MB | Docs site, separate project |
| SST (3 sub-packages) | ~120 MB | Cloud infra, not TUI/CLI |
| SolidJS apps (console/enterprise/app) | ~80 MB each | Separate web projects |

**~800 MB–1.2 GB** total dependency savings. One command to run: `bun run --cwd packages/opencode src/index.ts`.

---

## Installation

**Quick install**

```bash
curl -fsSL https://raw.githubusercontent.com/dressedinblack5/opencode/dev/install | bash
```

**From source**

```bash
git clone https://github.com/dressedinblack5/opencode.git
cd opencode
bun install
bun run --cwd packages/opencode src/index.ts
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Install path priority

1. `$OPENCODE_INSTALL_DIR` — custom directory
2. `$XDG_BIN_DIR` — XDG compliant path
3. `$HOME/bin` — user binary directory
4. `$HOME/.opencode/bin` — default

```bash
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://raw.githubusercontent.com/dressedinblack5/opencode/dev/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://raw.githubusercontent.com/dressedinblack5/opencode/dev/install | bash
```

<p align="center"><a href="https://github.com/dressedinblack5/opencode">dressedinblack5/opencode</a></p>
