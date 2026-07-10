# Optimized TUI/CLI Installation and Usage

This directory contains scripts and configurations optimized for TUI/CLI-only operation of the dressedinblack5/openaxe fork. This installation eliminates web apps, desktop GUI, and cloud infrastructure to maintain a lean, fast, terminal-focused experience.

## Scripts

### install-lean.sh
Minimal installation focusing only on TUI/CLI components

### profile-openaxe.sh
Performance profiling and optimization for terminal operation

### verify-lean.sh
Verifies the installation remains pure TUI/CLI

## Configuration

### tui-only-config.json
Core configuration optimized for terminal operation

### lean-startup.sh
Optimized startup for maximum performance

## Usage

```bash
# Install lean TUI/CLI version
./scripts/install-lean.sh

# Profile for optimization
./scripts/profile-openaxe.sh --measure

# Verify pure TUI/CLI operation
./scripts/verify-lean.sh

# Optimized startup
./scripts/lean-startup.sh
```

## Architecture Focus

This installation ensures:
- **No web components**: No web apps, docs sites, or console interfaces
- **No desktop GUI**: Minimal Electron/desktop dependencies  
- **No cloud infrastructure**: Pure local TUI operation
- **Performance first**: <6s installation, <5s startup, <1.2GB dependencies
- **Plugin focused**: Essential plugins maintained for TUI/CLI functionality
- **Terminal optimized**: Command-line commands, no web interfaces

The lean installation saves ~800MB–1.2GB of dependencies while preserving all core TUI/CLI functionality.
