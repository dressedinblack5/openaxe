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

## Performance & Security

**Lean TUI/CLI-only fork** of upstream `anomalyco/opencode`:

- **52% fewer packages** (13 vs 27)
- **<1.2GB dependencies** vs 2+GB upstream
- **Installation**: <6s vs 15-20s upstream
- **Type checking**: 18.4s vs 45-60s upstream

### Security-First Architecture
- **TUI/CLI-only** — No web/desktop attack surface
- **Package audit automation** — `./scripts/audit-deps.sh` security scanning
- **Sync protection** — `./scripts/sync-upstream.sh` conflict detection
- **Real-time monitoring** — `./scripts/tui-lean/performance-dashboard.sh`

### Key Security Benefits
- **<1.2GB total dependencies** — ~800MB–1.2GB savings vs upstream
- **No electron/storybook/SST** — Removed desktop, web, cloud attack vectors
- **5.3s installation** — 52% faster with shallow clones
- **Single publish CI job** — No redundant Electron/docker builds

### Security Commands
```bash
# Secure installation (recommended)
./scripts/tui-lean/install-lean.sh
./scripts/tui-lean/verify-lean.sh
./scripts/tui-lean/performance-dashboard.sh start

# Security audits
./scripts/audit-deps.sh           # Package security scans
./scripts/sync-upstream.sh        # Upstream change detection
./scripts/tui-lean/profile-opencode.sh  # Performance security
```

### Runtime
One command to run:
```bash
bun run --cwd packages/opencode src/index.ts
```

<p align="center"><a href="https://github.com/dressedinblack5/opencode">dressedinblack5/opencode</a></p>

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

<p align="center"><a href="https://github.com/dressedinblack5/opencode">dressedinblack5/opencode</a></p>
