# Automated Update Workflow

This directory contains scripts for automated maintenance of the dressedinblack5/opencode fork.

## Scripts

### sync-upstream.sh
Pulls changes from upstream dev branch, handles conflicts, and creates maintenance PRs

### audit-deps.sh  
Scans and updates dependencies for security and performance

### performance-check.sh
Monitors and reports on performance metrics

### plugin-sync.sh
Manages custom plugin updates and compatibility

## Usage

```bash
# Run full maintenance workflow
./scripts/sync-upstream.sh --dry-run

# Check for security updates  
./scripts/audit-deps.sh --check --output report.txt

# Profile performance
./scripts/performance-check.sh --measure

# Update plugins
./scripts/plugin-sync.sh --update
```

## Configuration

All maintenance operations respect project-specific constraints:
- TUI/CLI-only architecture preservation
- Plugin ecosystem compatibility
- Performance threshold monitoring
- Automated rollback on critical failures

This system ensures the lean opencode fork stays current without breaking its optimized architecture.
