<p align="center">
  <a href="https://github.com/dressedinblack5/opencode">
    <img src="https://img.shields.io/badge/dressedinblack5/opencode-6C47FF?style=for-the-badge&logo=github&logoColor=fff" alt="opencode">
  </a>
</p>


<p align="center">
  <a href="https://github.com/anomalyco/opencode"><img src="https://img.shields.io/github/v/release/anomalyco/opencode?style=flat-square&label=upstream" alt="upstream"></a>
  <a href="https://github.com/dressedinblack5/opencode/compare"><img src="https://img.shields.io/github/commits-since/anomalyco/opencode/dev?style=flat-square&label=ahead" alt="ahead"></a>
  <a href="https://github.com/dressedinblack5/opencode"><img src="https://img.shields.io/github/last-commit/dressedinblack5/opencode?style=flat-square&color=brightgreen&label=updated" alt="updated"></a>
</p>

<p align="center">
  Personal fork of <strong>anomalyco/opencode</strong> — project-wide<br>
  plugin and MCP configuration loaded from <code>.opencode/</code>.<br>
  Pull from <code>origin/dev</code>, push features to <code>fork</code>, send PRs upstream.
</p>

---

## User-Added Features

These additions are not present in the upstream `anomalyco/opencode`:

### Plugins

Loaded from `.opencode/opencode.jsonc` (project) + `~/.config/opencode/opencode.jsonc` (user):

- **[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)** — Configurable agent persona, styled conversation, persistent TUI state
- **[opencode-plugin-selector](https://github.com/illusionaireal/opencode-plugin-selector)** — Enable/disable any plugin on the fly from a TUI panel
- **[superpowers](https://github.com/obra/superpowers)** — Skill-awareness, brainstorming, TDD, debugging, code review workflows
- **[ponytail](https://github.com/DietrichGebert/ponytail)** — Lazy senior dev mode: YAGNI/stdlib-first/minimal-code ruleset
- **[opencode-vibeguard](https://github.com/inkdust2021/opencode-vibeguard)** — Prevents agent drift from project conventions and coding standards
- **[@tarquinen/opencode-dcp](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)** — Automatic context management, compression, slash commands
- **[ecc-universal](https://github.com/affaan-m/ECC)** — Claude Code compatibility: 61 agents, 400+ skills, MCP integration, security

### MCP Servers

Configured via MCP protocol — no hooks, accessible as tools to the LLM:

| Server | Purpose |
|---|---|
| **context7** | Live documentation for any library, framework, or API |
| **github** | Full GitHub API — repos, PRs, issues, search |

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
- **sst.config.ts + sst-env.d.ts** — SST root config, dead after infra/ removal
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

Requires [Bun](https://bun.sh) and `git`.

```bash
curl -fsSL https://raw.githubusercontent.com/dressedinblack5/opencode/dev/install | bash
```

This clones the repo, installs dependencies, and creates a `~/.local/bin/opencode` wrapper.

**From source:**

```bash
git clone https://github.com/dressedinblack5/opencode.git
cd opencode
bun install
bun run --cwd packages/opencode src/index.ts
```

<p align="center"><a href="https://github.com/dressedinblack5/opencode">dressedinblack5/opencode</a></p>
