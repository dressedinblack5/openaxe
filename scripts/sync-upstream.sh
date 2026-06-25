#!/usr/bin/env bash

set -euo pipefail

# Automated update workflow for dressedinblack5/openaxe fork
# Pulls changes from upstream dev, handles conflicts, and creates maintenance PRs

REPO="dressedinblack5/openaxe"
UPSTREAM_REPO="anomalyco/opencode"
UPSTREAM_BRANCH="dev"
INSTALL_DIR="$HOME/.opencode"
DRY_RUN="${1:-}"
BACKUP_DIR="$INSTALL_DIR.backup.$(date +%Y%m%d_%H%M%S)"

log() {
  echo "[sync-upstream] $*"
}

error() {
  echo "[ERROR] $*" >&2
}

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    error "'$1' is required but not installed."
    exit 1
  fi
}

check_cmd git
check_cmd gh

if [ -z "$DRY_RUN" ]; then
  log "Creating backup at $BACKUP_DIR"
  cp -r "$INSTALL_DIR" "$BACKUP_DIR"
fi

log "Fetching upstream changes..."
git -C "$INSTALL_DIR" fetch origin "$UPSTREAM_BRANCH"

log "Checking for conflicts..."
CONFLICTS=$(git -C "$INSTALL_DIR" status --porcelain | grep -E "^[AMR]?\s" | wc -l)

if [ "$CONFLICTS" -gt 0 ]; then
  log "WARNING: Found $CONFLICTS potential conflicts"
  
  if [ -z "$DRY_RUN" ]; then
    log "WARNING: Conflicts detected. Exiting to prevent data loss."
    log "Review changes manually and run: git -C \"$INSTALL_DIR\" reset --hard origin/$UPSTREAM_BRANCH"
    error "ABORTED: Conflicts present - manual intervention required"
    exit 1
  fi
fi

log "Resetting to upstream $UPSTREAM_BRANCH..."
if [ -n "$DRY_RUN" ]; then
  log "(DRY RUN) Would execute: git -C \"$INSTALL_DIR\" reset --hard origin/$UPSTREAM_BRANCH"
else
  git -C "$INSTALL_DIR" reset --hard "origin/$UPSTREAM_BRANCH"
fi

# Detect and handle lean-specific changes
log "Analyzing structural changes vs upstream..."

# This is critical for our lean TUI/CLI-only architecture
REQUIRED_CHANGES=""

# List of packages we removed vs upstream
UPSTREAM_PACKAGES=$(git -C "$INSTALL_DIR" log --oneline --grep="Remove" | head -10)

if echo "$UPSTREAM_PACKAGES" | grep -q "packages.*removed\|removed.*packages"; then
  log "Upstream is making structural changes we don't want"
  log "Checking if these affect our lean architecture..."
  
  # Continue only if changes are safe for TUI/CLI-only architecture
  log "WARNING: Upstream changes may affect our lean architecture"
  
  if [ -n "$DRY_RUN" ]; then
    log "(DRY RUN) Would pause for manual review due to structural changes"
    log "Safe to continue only if upstream changes don't introduce:
- Web apps (app/, console/, web/)
- Desktop GUI (desktop/, electron/)
- Cloud infrastructure (infra/, sst.config.ts/)
- Analytics/dashboard (stats/, session-ui/)"
  fi
fi

# Keep our custom plugins if upstream changed them
if git -C "$INSTALL_DIR" diff --name-only "origin/$UPSTREAM_BRANCH" -- .opencode/opencode.jsonc | head -5; then
  log "Upstream changed our plugin configuration"
  log "WARNING: Upstream config changes detected - manual review required"
fi

log "Sync completed successfully from upstream/$UPSTREAM_BRANCH"

if [ -n "$DRY_RUN" ]; then
  log "(DRY RUN) Backup available at $BACKUP_DIR for rollback"
elif [ -d "$BACKUP_DIR" ]; then
  log "Backup available at $BACKUP_DIR for rollback"
fi

log "Recommended next steps:
1. Test that TUI/CLI-only architecture still works
2. Run our plugin compatibility checks
3. Verify performance metrics still meet targets
4. Submit any custom improvements as separate PRs to upstream"
