<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img width="320" src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode">
    </picture>
  </a>
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

## Plugins & MCP

Loaded project-wide via <code>.opencode/opencode.jsonc</code>:

| Plugin | |
|---|---|
| **oh-my-openagent** | Agent personality & behavior customization |
| **opencode-plugin-selector** | Pick and switch plugins on the fly |
| **superpowers** | Skill-based dev workflows — brainstorming, TDD, debugging, code review |
| **ponytail** | Lazy senior developer mode — minimal code, no over-engineering |
| **opencode-vibeguard** | Keeps agents aligned and on track |
| **@tarquinen/opencode-dcp** | Dynamic context pruning — lean conversation window |
| **ecc-universal** | Everything Claude Code — 61 agents, 400+ skills, 76 commands, security, MCP |

| MCP server | |
|---|---|
| **context7** | Live docs for any library, framework, or API |
| **github** | Full GitHub API — repos, PRs, issues, search |

---

<br>

## Structural Changes

This fork trims upstream bloat:

| Change | What |
|--------|------|
| **Removed** | 21 stale README translations (kept only `README.md`) |
| **Removed** | `packages/storybook` + 65 component story files — unused dev tooling |
| **Removed** | `packages/effect-sqlite-node` — dead code, nothing imported it |

Upstream package count: 27 → 24. No behavior changes.

<br>

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
