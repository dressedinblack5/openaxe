<p align="center">
  <a href="https://github.com/dressedinblack5/openaxe">
    <img src="https://img.shields.io/badge/dressedinblack5/openaxe-6C47FF?style=for-the-badge&logo=github&logoColor=fff" alt="openaxe">
  </a>
</p>


<p align="center">
  <a href="https://github.com/anomalyco/opencode"><img src="https://img.shields.io/github/v/release/anomalyco/opencode?style=flat-square&label=upstream" alt="upstream"></a>
  <a href="https://github.com/dressedinblack5/openaxe/compare"><img src="https://img.shields.io/github/commits-since/anomalyco/opencode/dev?style=flat-square&label=ahead" alt="ahead"></a>
  <a href="https://github.com/dressedinblack5/openaxe"><img src="https://img.shields.io/github/last-commit/dressedinblack5/openaxe?style=flat-square&color=brightgreen&label=updated" alt="updated"></a>
</p>

<p align="center">
  <strong>openaxe</strong> — project-wide plugin and MCP configuration<br>
  loaded from <code>.opencode/</code>. Fork of <strong>anomalyco/opencode</strong>.<br>
  Pull from <code>origin/dev</code>, push features to <code>fork</code>, send PRs upstream.
</p>

---

## Performance & Security

**openaxe** — Lean TUI/CLI-only fork of upstream `anomalyco/opencode`:

### Plugins

Loaded from `.opencode/opencode.jsonc` (project) + `~/.config/opencode/opencode.jsonc` (user):

- **[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)** — Configurable agent persona, styled conversation, persistent TUI state
- **[opencode-plugin-selector](https://github.com/illusionaireal/opencode-plugin-selector)** — Enable/disable any plugin on the fly from a TUI panel
- **[superpowers](https://github.com/obra/superpowers)** — Skill-awareness, brainstorming, TDD, debugging, code review workflows
- **[ponytail](https://github.com/DietrichGebert/ponytail)** — Lazy senior dev mode: YAGNI/stdlib-first/minimal-code ruleset
- **[opencode-vibeguard](https://github.com/inkdust2021/opencode-vibeguard)** — Prevents agent drift from project conventions and coding standards
- **[@tarquinen/opencode-dcp](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)** — Automatic context management, compression, slash commands
- **[ecc-universal](https://github.com/affaan-m/ECC)** — Claude Code compatibility: 61 agents, 400+ skills, MCP integration, security

### Performance

| Metric | Upstream | This Fork |
|---|---|---|
| Packages | 27 | **13** (52% fewer) |
| `bun install` | ~15-20s | **5.3s** |
| `turbo typecheck` | ~45-60s | **18.4s** |
| node_modules | ~2+ GB | **1.1 GB** |

### Security-First Architecture
- **TUI/CLI-only** — No web/desktop/cloud attack surface (Electron, Storybook, Astro, SST, SolidJS apps removed)
- **<1.2GB total dependencies** — ~800MB–1.2GB savings vs upstream
- **Package audit automation** — `./scripts/audit-deps.sh` security scanning
- **Sync protection** — `./scripts/sync-upstream.sh` conflict detection
- **Real-time monitoring** — `./scripts/tui-lean/performance-dashboard.sh`

### Security Commands
```bash
./scripts/tui-lean/install-lean.sh    # Secure installation
./scripts/tui-lean/verify-lean.sh     # Verify TUI/CLI architecture
./scripts/audit-deps.sh               # Package security scans
./scripts/sync-upstream.sh            # Upstream change detection
./scripts/tui-lean/performance-dashboard.sh start  # Real-time metrics
```

### Runtime
```bash
bun run --cwd packages/opencode src/index.ts
```

<p align="center"><a href="https://github.com/dressedinblack5/openaxe">dressedinblack5/openaxe</a></p>

---

## Installation

Requires [Bun](https://bun.sh) and `git`.

```bash
curl -fsSL https://raw.githubusercontent.com/dressedinblack5/openaxe/dev/install | bash
```

This clones the repo, installs dependencies, and creates a `~/.local/bin/openaxe` wrapper.

**From source:**

```bash
git clone https://github.com/dressedinblack5/openaxe.git
cd openaxe
bun install
bun run --cwd packages/opencode src/index.ts
```

### Security-First Installation

**For maximum security and performance:**
```bash
# Install lean TUI/CLI version (sub-second startup)
./scripts/tui-lean/install-lean.sh

# Verify pure TUI/CLI architecture after installation
./scripts/tui-lean/verify-lean.sh

# Setup performance monitoring
./scripts/tui-lean/performance-dashboard.sh start
```

**Why this installation is more secure:**
- Shallow clones reduce repository exposure
- TUI-only prevents web application vulnerabilities
- Plugin security verified before installation
- Performance monitoring tracks security metrics

<p align="center"><a href="https://github.com/dressedinblack5/openaxe">dressedinblack5/openaxe</a></p>
