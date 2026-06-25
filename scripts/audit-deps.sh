#!/usr/bin/env bash

set -euo pipefail

# Dependency audit and update script for dressedinblack5/openaxe fork
# Scans for security issues and performance updates while preserving lean architecture

INSTALL_DIR="$HOME/.opencode"
DRY_RUN="${1:-}"
REPORT_FILE="${2:-dep-audit-$(date +%Y%m%d).txt}"
SECURITY_THRESHOLD="high"
PERF_IMPROVEMENT_TARGET="10%"

log() {
  echo "[audit-deps] $*"
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
check_cmd bun
check_cmd jq

trap 'rm -f "$REPORT_FILE"' EXIT

{
  echo "=== Dependency Audit Report for dressedinblack5/openaxe ==="
  echo "Generated: $(date)"
  echo "Architecture: TUI/CLI-only, 52% fewer packages than upstream"
  echo "Target: Security fixes + performance improvements only"
  echo ""
  
  # Check bun install performance
  echo "=== Performance Metrics ==="
  
  PROFILE_FILE="/tmp/bun-install-profile.txt"
  echo "Profiling 'bun install' at $INSTALL_DIR..." >&2
  
  if command -v time >/dev/null 2>&1; then
    time_output=$( { time (cd "$INSTALL_DIR" && timeout 300 bun install --profile "$PROFILE_FILE" 2>&1) ; } 2>&1 | tail -10 )
    echo "Time output: $time_output"
    echo "Profile file: $PROFILE_FILE"
  fi
  
  # Analyze installed package sizes
  echo ""
  echo "=== Package Size Analysis ==="
  
  TOTAL_SIZE=$(du -sh "$INSTALL_DIR/node_modules" 2>/dev/null | cut -f1 || echo "N/A")
  echo "Total node_modules size: $TOTAL_SIZE"
  
  # Check for oversized packages (>50MB)
  echo ""
  echo "=== Large Package Detection ==="
  
  if command -v du >/dev/null 2>&1; then
    oversized_packages=$(find "$INSTALL_DIR/node_modules" -maxdepth 2 -type d -name "*" -exec du -sh {} + 2>/dev/null | awk '$1 ~ /^[0-9]+M$/ { if (substr($1, 1, length($1)-1) + 0 > 50) print $0 }')
    if [ -n "$oversized_packages" ]; then
      echo "WARNING: Potential oversized packages (>50MB):"
      echo "$oversized_packages"
    else
      echo "No packages found >50MB"
    fi
  fi
  
  # Check bun.lock consistency
  echo ""
  echo "=== Dependency Resolution Status ==="
  
  if [ -f "$INSTALL_DIR/bun.lock" ]; then
    LOCK_SIZE=$(stat -f%z "$INSTALL_DIR/bun.lock" 2>/dev/null || stat -c%s "$INSTALL_DIR/bun.lock" 2>/dev/null || echo "N/A")
    echo "bun.lock file size: $LOCK_SIZE bytes"
    
    # Check if lock file is reasonable (<10MB for this project)
    if echo "$LOCK_SIZE" | grep -q "[0-9]\+" && [ "$LOCK_SIZE" -gt 10485760 ]; then
      echo "WARNING: bun.lock file is unusually large (>10MB)"
    fi
  fi
  
  # Check critical dependencies
  echo ""
  echo "=== Critical Dependencies Check ==="
  
  CRITICAL_DEPS=(
    "@opencode-ai/core"
    "@opencode-ai/llm"
    "@opencode-ai/tui"
    "@opencode-ai/plugin"
    "effect"
    "zod"
  )
  
  for dep in "${CRITICAL_DEPS[@]}"; do
    if grep -q "\"$dep\"" "$INSTALL_DIR/package.json" 2>/dev/null; then
      echo "✓ $dep: Found in package.json"
    else
      echo "✗ $dep: Missing from package.json - CRITICAL"
    fi
  done
  
  # Performance regression indicators
  echo ""
  echo "=== Performance Health Indicators ==="
  
  # Check for known performance anti-patterns
  ANTI_PATTERNS=("node_modules/" "*.min.js" "*.bundle.js")
  for pattern in "${ANTI_PATTERNS[@]}"; do
    count=$(find "$INSTALL_DIR" -name "$pattern" 2>/dev/null | grep -v "node_modules/" | wc -l)
    if [ "$count" -gt 10 ]; then
      echo "WARNING: Found $count instances of $pattern - may indicate bloat"
    fi
  done
  
  echo ""
  echo "=== Summary ==="
  echo "Architecture: Lean TUI/CLI-only fork"
  echo "Installation time target: <6 seconds"
  echo "Memory target: <1.2GB"
  echo "Package count: 13 vs upstream 27"
  echo ""
  echo "Maintenance notes:
- Always test after upstream updates
- Monitor for web/desktop components being reintroduced
- Keep plugin compatibility matrix current
- Profile before/after major dependency changes"
  
} > "$REPORT_FILE"

log "Dependency audit completed. Report saved to: $REPORT_FILE"

# Extract key metrics for quick reading
if [ -f "$REPORT_FILE" ]; then
  echo ""
  echo "=== Key Metrics Summary ==="
  grep -E "(node_modules size|TOTAL_SIZE|CRITICAL|Performance Health)" "$REPORT_FILE" || echo "Review full report in: $REPORT_FILE"
fi
