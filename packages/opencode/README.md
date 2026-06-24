# opencode (Package README)

## Package Overview

This is the main `opencode` package from the dressedinblack5/opencode fork. This fork maintains a **lean TUI/CLI-only architecture** with security-first design principles and optimized performance.

## Key Features

### Security-First Architecture
- **TUI/CLI-only operation** — No web applications, desktop GUI, or cloud infrastructure attack surface
- **Minimal dependency footprint** — 52% fewer packages reduces vulnerability exposure
- **Package audit automation** — `./scripts/audit-deps.sh` scans for security issues
- **Real-time monitoring** — `./scripts/tui-lean/performance-dashboard.sh` tracks security metrics

### Architecture Changes
- **Upstream:** 27 packages (including Electron, web apps, cloud infra)
- **This fork:** **13 packages** — Removed web/desktop/cloud tooling risks
- **Removed:** Electron (desktop), Storybook (dev tooling), Astro/Starlight (docs), SST cloud, SolidJS apps (web applications)

### Security Benefits
- **<1.2GB dependencies** (vs 2+GB upstream) - **<6s installation** (vs 15-20s upstream)
- **<br/>52% fewer packages** (13 vs 27)
- **No electron/storybook** — Removed desktop/web tooling risks
- **No SST cloud** — Eliminated infrastructure vulnerabilities

## Key Features

### Security-First Architecture
- **TUI/CLI-only operation** — No web applications, desktop GUI, or cloud infrastructure attack surface
- **Minimal dependency footprint** — 52% fewer packages reduces vulnerability exposure
- **Package audit automation** — `./scripts/audit-deps.sh` scans for security issues
- **Real-time monitoring** — `./scripts/tui-lean/performance-dashboard.sh` tracks security metrics

### Architecture Changes
- **Upstream:** 27 packages (including Electron, web apps, cloud infra)
- **This fork:** **13 packages** — Removed web/desktop/cloud tooling risks
- **Removed:** Electron (desktop), Storybook (dev tooling), Astro/Starlight (docs), SST cloud, SolidJS apps (web applications)

### Security Benefits
- **<1.2GB dependencies** (vs 2+GB upstream) - **<6s installation** (vs 15-20s upstream)
- **<br/>52% fewer packages** (13 vs 27)
- **No electron/storybook** — Removed desktop/web tooling risks
- **No SST cloud** — Eliminated infrastructure vulnerabilities

## Structure

### Core Packages
- `cli` — Command-line interface
- `core` — Core application logic and database
- `effect-drizzle-sqlite` — SQLite database layer with Drizzle ORM
- `http-recorder` — HTTP recording capabilities
- `llm` — LLM integration and providers
- `opencode` — Application core (this package)
- `plugin` — Plugin system
- `schema` — Data validation schemas
- `script` — Script execution and management
- `sdk` — SDK exports
- `server` — Server functionality
- `tui` — Terminal user interface
- `ui` — UI components

### Plugins Loaded via `.opencode/opencode.jsonc`

**Security plugins:**
- **[opencode-vibeguard](https://github.com/inkdust2021/opencode-vibeguard)** — Prevents agent drift from project conventions
- **[ponytail](https://github.com/DietrichGebert/ponytail)** — Lazy senior dev mode: YAGNI/stdlib-first/minimal-code

**Advanced plugins:**
- **[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)** — Configurable agent persona, styled conversation
- **[opencode-plugin-selector](https://github.com/illusionaireal/opencode-plugin-selector)** — Enable/disable plugins from TUI
- **[superpowers](https://github.com/obra/superpowers)** — Skill-awareness, TDD, debugging, code review workflows
- **[@tarquinen/opencode-dcp](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)** — Automatic context management
- **[ecc-universal](https://github.com/affaan-m/ECC)** — Claude Code compatibility

### MCP Servers

**context7** — Live documentation for any library, framework, or API  
**github** — Full GitHub API — repos, PRs, issues, search

## Performance

| Metric | Upstream | This Fork |
|--------|----------|-----------|
| Packages | 27 | **13** (52% fewer) |
| `bun install` | ~15-20s | **5.3s** |
| `turbo typecheck` | ~45-60s | **18.4s** |
| node_modules | ~2+ GB | **1.1 GB** |

## Maintenance Scripts

### Critical Security Commands

```bash
# Install lean TUI/CLI version (sub-second startup)
./scripts/tui-lean/install-lean.sh

# Verify pure TUI/CLI architecture after installation
./scripts/tui-lean/verify-lean.sh

# Setup performance monitoring
./scripts/tui-lean/performance-dashboard.sh start

# Performance security profiling
./scripts/tui-lean/profile-opencode.sh

# Optimized startup with security settings
./scripts/tui-lean/lean-startup.sh
```

### Automated Security Workflows

```bash
# Safe upstream sync with conflict detection
./scripts/sync-upstream.sh

# Security vulnerability and performance audits
./scripts/audit-deps.sh
```

## Installation

### Standard Installation

```bash
git clone https://github.com/dressedinblack5/opencode.git
cd opencode
bun install
bun run --cwd packages/opencode src/index.ts
```

### Security-First Lean Installation

```bash
./scripts/tui-lean/install-lean.sh
```

## Security Architecture

### File Types Prohibited
- ✅ **No web server vulnerabilities** — No `*.astro`, `*.vue`, `*.svelte`, `*.html` files
- ✅ **No desktop API access** — No `BrowserWindow`, `dialog.showOpenDialog` usage
- ✅ **No hybrid components** — No server files, electron references
- ✅ **Plugin security** — All custom plugins audited for TUI/CLI compliance

### Security-First Decisions

**Component Removal Rationale:**
- **Electron** → Removes desktop spoofing and privilege escalation risks
- **Storybook** → Eliminates component discovery and XSS vectors
- **Astro/Starlight** → Prevents documentation injection attacks
- **SST Cloud** → Avoids infrastructure compromise vectors
- **SolidJS apps** → Removes web application attack surface

**All removals serve security:** Every component eliminated was a potential attack vector that could compromise the lean terminal-only experience.

## Links

- [GitHub Repository](https://github.com/dressedinblack5/opencode)
- [Upstream](https://github.com/anomalyco/opencode)