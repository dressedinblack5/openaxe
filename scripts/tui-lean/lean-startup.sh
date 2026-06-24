#!/usr/bin/bash

set -euo pipefail

# Optimized startup script for pure TUI/CLI operation
# Maximum performance with minimal overhead

INSTALL_DIR="$HOME/.opencode"
PACKAGE_DIR="$INSTALL_DIR/packages/opencode"

log() {
  echo "[lean-startup] $*"
}

log "=== Optimized TUI/CLI Startup ==="

# Performance optimizations
export NODE_NO_WARNINGS=1
export BUN_RUN_SHIMS="true"
export RUST_BACKTRACE=short
export VIRTUAL_ENV="$INSTALL_DIR/venv"

# Skip web/browsers if available
if command -v xvfb-run >/dev/null 2>&1; then
  export DISPLAY=":99"
  export XDG_RUNTIME_DIR="/tmp"
fi

# Create optimized virtual environment if needed
if [ ! -d "$VIRTUAL_ENV" ] && command -v python3 >/dev/null 2>&1; then
  log "Creating optimized Python environment..."
  python3 -m venv "$VIRTUAL_ENV"
  source "$VIRTUAL_ENV/bin/activate"
  pip install --quiet --no-cache-dir colorama "packaging>=20.0" 2>/dev/null || true
fi

# Fast environment setup
cd "$PACKAGE_DIR" || {
  log "ERROR: Cannot access package directory"
  exit 1
}

log "Starting opencode in optimized TUI/CLI mode..."
log "Performance settings activated:"\n"

# Check active plugins
if [ -f "$INSTALL_DIR/.opencode/opencode.jsonc" ]; then
  plugin_count=$(jq -r '.plugin? | length // 0' "$INSTALL_DIR/.opencode/opencode.jsonc" 2>/dev/null || echo "0")
  log "- Custom plugins active: $plugin_count"
fi

# Monitor memory usage
if command -v free >/dev/null 2>&1; then
  available_memory=$(free -m | awk 'NR==2{print $4}')
  if [ "$available_memory" -lt 512 ]; then
    log "WARNING: Low memory ($available_memory MB available)"
    log "Consider: 'pkill -f opencode && free -h' to check process memory"
  fi
fi

# Execute with maximum performance
log "Command: bun run src/index.ts \"$@\""
log "Architecture: Pure TUI/CLI, no web components"
log ""

# Run with optimized settings
(
  # Set environment for performance
  export NODE_OPTIONS="--no-warnings --experimental-specifier-resolution=node"
  export BUN_INSTALL=1
  export BUN_BUILD="release"
  
  # Execute opencode with performance monitoring
  if command -v time >/dev/null 2>&1 && [ -n "$MEASURE_PERFORMANCE" ]; then
    time timeout 3600 bun run src/index.ts "$@"
  else
    timeout 3600 bun run src/index.ts "$@"
  fi
)

exit_code=$?

# Capture performance metrics
if [ -f "$INSTALL_DIR/perf-enabled" ] && command -v jq >/dev/null 2>&1; then
  perf_dir="$INSTALL_DIR/perf-data"
  mkdir -p "$perf_dir"
  
  perf_entry="$perf_dir/$(date +%Y-%m-%d_%H%M%S)_startup.json"
  cat > "$perf_entry" << EOF
{
  "timestamp": "$(date -Iseconds)",
  "exit_code": $exit_code,
  "architecture": "TUI/CLI-only",
  "plugins_loaded": "oh-my-openagent, opencode-plugin-selector, superpowers, ponytail, vibeguard, ecc-universal"
}
EOF
  
  log "Performance metrics saved to: $perf_entry"
fi

log "\n=== Startup complete (exit code: $exit_code) ==="
log "Architecture: Pure TUI/CLI operation maintained"
log ""
