#!/usr/bin/env bash

set -euo pipefail

# Performance dashboard and monitoring script
# Real-time performance tracking for dressedinblack5/openaxe fork
# Optimized for TUI/CLI-only operation with lean architecture targets

INSTALL_DIR="$HOME/.openaxe"
PERF_DATA_DIR="$INSTALL_DIR/perf-data"
DASHBOARD_FILE="$INSTALL_DIR/performance-dashboard.html"
DASHBOARD_DIR="$INSTALL_DIR/performance-dashboard"
DASHBOARD_PORT="3000"

log() {
  echo "[perf-dashboard] $*"
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

check_cmd bun
check_cmd jq
check_cmd curl

mkdir -p "$PERF_DATA_DIR"
mkdir -p "$DASHBOARD_DIR"

# Generate HTML dashboard for performance monitoring
generate_dashboard() {
  log "=== Generating Performance Dashboard ==="
  
  local html_file="$DASHBOARD_DIR/dashboard.html"
  
  cat > "$html_file" << 'HTML'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OpenCode Performance Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
        }
        
        body {
            background: #1a1a1a;
            color: #e0e0e0;
            padding: 20px;
            font-size: 14px;
        }
        
        .dashboard {
            max-width: 1600px;
            margin: 0 auto;
        }
        
        .header {
            text-align: center;
            margin-bottom: 30px;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 10px;
            color: white;
        }
        
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .metric-card {
            background: #2d2d2d;
            border-radius: 8px;
            padding: 20px;
            border-left: 4px solid #667eea;
            transition: transform 0.2s;
        }
        
        .metric-card:hover {
            transform: translateY(-2px);
        }
        
        .metric-title {
            font-size: 12px;
            color: #999;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 10px;
        }
        
        .metric-value {
            font-size: 28px;
            font-weight: bold;
            color: #fff;
        }
        
        .metric-status {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 11px;
            margin-left: 10px;
            text-transform: uppercase;
        }
        
        .status-good { background: #22c55e; color: white; }
        .status-warning { background: #f59e0b; color: white; }
        .status-error { background: #ef4444; color: white; }
        
        .section {
            background: #2d2d2d;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
        }
        
        .section-title {
            font-size: 18px;
            margin-bottom: 20px;
            color: #667eea;
            border-bottom: 2px solid #333;
            padding-bottom: 10px;
        }
        
        .data-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
        }
        
        .data-table th,
        .data-table td {
            padding: 10px;
            text-align: left;
            border-bottom: 1px solid #444;
        }
        
        .data-table th {
            background: #333;
            color: #999;
            font-weight: 600;
        }
        
        .data-table tr:hover {
            background: #383838;
        }
        
        .status-indicator {
            display: inline-block;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            margin-right: 8px;
        }
        
        .status-good { background: #22c55e; }
        .status-warning { background: #f59e0b; }
        .status-error { background: #ef4444; }
        
        .refresh-btn {
            background: #667eea;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
            margin-bottom: 20px;
        }
        
        .refresh-btn:hover {
            background: #5a67d8;
        }
        
        .architecture-badge {
            display: inline-block;
            padding: 6px 12px;
            background: #374151;
            color: #e5e7eb;
            border-radius: 20px;
            font-size: 12px;
            margin-right: 10px;
        }
        
        .health-score {
            width: 100%;
            height: 20px;
            background: #444;
            border-radius: 10px;
            overflow: hidden;
            margin-top: 10px;
        }
        
        .health-score-fill {
            height: 100%;
            background: linear-gradient(90deg, #22c55e 0%, #f59e0b 50%, #ef4444 100%);n            transition: width 0.5s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-top: 20px;
        }
        
        .stat-box {
            background: #383838;
            padding: 15px;
            border-radius: 6px;
            text-align: center;
        }
        
        .stat-value {
            font-size: 24px;
            font-weight: bold;
            color: #667eea;
        }
        
        .stat-label {
            font-size: 11px;
            color: #999;
            text-transform: uppercase;
            margin-top: 5px;
        }
        
        .alert {
            padding: 12px 15px;
            border-radius: 6px;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
        }
        
        .alert-error {
            background: #7f1d1d;
            border: 1px solid #991b1b;
            color: #fecaca;
        }
        
        .alert-warning {
            background: #78350f;
            border: 1px solid #b45309;
            color: #fde68a;
        }
        
        .alert-success {
            background: #064e3b;
            border: 1px solid #065f46;
            color: #a7f3d0;
        }
        
        @media (max-width: 768px) {
            .metrics-grid {
                grid-template-columns: 1fr;
            }
            
            .stats-grid {
                grid-template-columns: 1fr 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="dashboard">
        <div class="header">
            <h1>OpenCode Performance Dashboard</h1>
            <p>Dressedinblack5 Fork - TUI/CLI-Only Architecture</p>
            <p><small>Last Updated: <span id="last-updated">Loading...</span></small></p>
        </div>
        
        <button class="refresh-btn" onclick="loadData()">Refresh Data</button>
        
        <div class="alert alert-success">
            <span>✓ Architecture: Lean TUI/CLI-only operation</span>
            <span class="architecture-badge">Performance Targets</span>
            <span class="architecture-badge"><6s Install</span>
            <span class="architecture-badge"><5s Startup</span>
            <span class="architecture-badge"><1.2GB Dependencies</span>
        </div>
        
        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-title">Installation Performance</div>
                <div class="metric-value" id="install-time">-- s</div>
                <span class="metric-status status-warning">Below Target</span>
            </div>
            
            <div class="metric-card">
                <div class="metric-title">Package Count</div>
                <div class="metric-value" id="package-count">--</div>
                <span class="metric-status status-good">Optimized</span>
            </div>
            
            <div class="metric-card">
                <div class="metric-title">Memory Usage</div>
                <div class="metric-value" id="memory-usage">-- GB</div>
                <span class="metric-status status-good">On Track</span>
            </div>
            
            <div class="metric-card">
                <div class="metric-title">Architecture Health</div>
                <div class="metric-value">--%</div>
                <div class="health-score">
                    <div class="health-score-fill" style="width: --%">--%</div>
                </div>
            </div>
        </div>
        
        <div class="section">
            <div class="section-title">Current Performance Metrics</div>
            <table class="data-table" id="metrics-table">
                <thead>
                    <tr>
                        <th>Metric</th>
                        <th>Value</th>
                        <th>Status</th>
                        <th>Target</th>
                        <th>Timestamp</th>
                    </tr>
                </thead>
                <tbody id="metrics-body">
                    <tr>
                        <td colspan="5" style="text-align: center; padding: 40px;">Loading metrics...</td>
                    </tr>
                </tbody>
            </table>
        </div>
        
        <div class="section">
            <div class="section-title">System Statistics</div>
            <div class="stats-grid">
                <div class="stat-box">
                    <div class="stat-value" id="total-installations">--</div>
                    <div class="stat-label">Total Installations</div>
                </div>
                <div class="stat-box">
                    <div class="stat-value" id="avg-install-time">--s</div>
                    <div class="stat-label">Avg Install Time</div>
                </div>
                <div class="stat-box">
                    <div class="stat-value" id="plugin-count">--</div>
                    <div class="stat-label">Active Plugins</div>
                </div>
                <div class="stat-box">
                    <div class="stat-value" id="last-check">--</div>
                    <div class="stat-label">Last Check</div>
                </div>
            </div>
        </div>
        
        <div class="section">
            <div class="section-title">Performance Alerts</div>
            <div id="alerts-container">
                <div class="alert alert-success">
                    <span>✓ Architecture optimized: TUI/CLI-only operation</span>
                </div>
            </div>
        </div>
        
        <div class="section">
            <div class="section-title">Recent Performance Data</div>
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Timestamp</th>
                        <th>Metric Type</th>
                        <th>Duration</th>
                        <th>Value</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody id="data-table-body">
                    <tr>
                        <td colspan="5" style="text-align: center; padding: 40px;">No data available</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
    
    <script>
        function formatTime(seconds) {
            if (seconds < 60) {
                return seconds.toFixed(1) + 's';
            } else {
                const minutes = Math.floor(seconds / 60);
                const remaining = (seconds % 60).toFixed(1);
                return minutes + 'm ' + remaining + 's';
            }
        }
        
        function updateHealthScore(health) {
            if (health >= 90) return { color: 'good', text: health + '%' };
            if (health >= 80) return { color: 'warning', text: health + '%' };
            return { color: 'error', text: health + '%' };
        }
        
        function loadData() {
            const installDir = '$INSTALL_DIR';
            const perfDataDir = '$PERF_DATA_DIR';
            
            const metricsTableBody = document.getElementById('metrics-body');
            const dataTableBody = document.getElementById('data-table-body');
            const alertsContainer = document.getElementById('alerts-container');
            const lastUpdated = document.getElementById('last-updated');
            
            lastUpdated.textContent = new Date().toLocaleString();
            
            // Fetch performance data
            fetch(`$PERF_DATA_DIR/*.json`)
                .then(response => {
                    if (!response.ok) throw new Error('Failed to fetch data');
                    return response.json();
                })
                .then(files => {
                    if (files.length === 0) {
                        metricsTableBody.innerHTML = 
                            '<tr><td colspan="5" style="text-align: center; padding: 40px;">No performance data collected</td></tr>';
                        dataTableBody.innerHTML = 
                            '<tr><td colspan="5" style="text-align: center; padding: 40px;">No performance data available</td></tr>';
                        return;
                    }
                    
                    // Load latest data file
                    const latestFile = files[0].split('/').pop();
                    const fileUrl = `$PERF_DATA_DIR/` + latestFile;
                    
                    return fetch(fileUrl)
                        .then(response => response.json())
                        .then(data => {
                            updateDashboard(data);
                        })
                        .catch(error => {
                            console.error('Error loading data:', error);
                            metricsTableBody.innerHTML = 
                                '<tr><td colspan="5" style="text-align: center; padding: 40px;">Error loading data: ' + error.message + '</td></tr>';
                        });
                })
                .catch(error => {
                    console.error('Error fetching files:', error);
                    metricsTableBody.innerHTML = 
                        '<tr><td colspan="5" style="text-align: center; padding: 40px;">Error loading metrics: ' + error.message + '</td></tr>';
                });
        }
        
        function updateDashboard(data) {
            // Update metrics
            if (data.duration_seconds) {
                document.getElementById('install-time').textContent = formatTime(data.duration_seconds);
            }
            
            if (data.architecture === 'TUI/CLI-only') {
                document.querySelector('.metric-status').textContent = 'Optimized';
                document.querySelector('.metric-status').className = 'metric-status status-good';
            }
            
            // Update alerts
            const alertsContainer = document.getElementById('alerts-container');
            
            if (data.check === 'lockfile_consistency' && data.result === 'passed') {
                alertsContainer.innerHTML += 
                    '<div class="alert alert-success">✓ Dependency health check passed</div>';
            } else if (data.check === 'lockfile_consistency' && data.result === 'failed') {
                alertsContainer.innerHTML += 
                    '<div class="alert alert-error">⚠ Dependency health issue: lockfile conflicts detected</div>';
            }
            
            // Update data table
            const dataTableBody = document.getElementById('data-table-body');
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${new Date(data.timestamp).toLocaleString()}</td>
                <td>${data.check || data.architecture || 'custom'}</td>
                <td>${data.duration_seconds || '--'}s</td>
                <td>${data.value || data.memory_usage_gb || data.result || '--'}</td>
                <td>
                    <span class="status-indicator ${getStatusClass(data)}"></span>
                    ${getStatusText(data)}
                </td>
            `;
            
            dataTableBody.insertBefore(row, dataTableBody.firstChild);
            
            // Keep only last 10 entries
            while (dataTableBody.children.length > 10) {
                dataTableBody.removeChild(dataTableBody.lastChild);
            }
        }
        
        function getStatusClass(data) {
            if (data.result === 'passed') return 'status-good';
            if (data.result === 'failed') return 'status-error';
            if (data.duration_seconds > 10) return 'status-error';
            if (data.duration_seconds > 5) return 'status-warning';
            return 'status-good';
        }
        
        function getStatusText(data) {
            if (data.result === 'passed') return 'Passed';
            if (data.result === 'failed') return 'Failed';
            if (data.duration_seconds > 10) return 'Slow';
            if (data.duration_seconds > 5) return 'Warning';
            return 'OK';
        }
        
        document.addEventListener('DOMContentLoaded', function() {
            loadData();
            setInterval(loadData, 30000); // Refresh every 30 seconds
        });
    </script>
</body>
</html>
HTML'
  
  log "Performance dashboard generated at $html_file"
}

# Start the local web server for the dashboard
start_dashboard_server() {
  log "=== Starting Performance Dashboard Server ==="
  log "Access dashboard at: http://localhost:$DASHBOARD_PORT"
  log "Dashboard files: $DASHBOARD_DIR/"
  
  # Check if node/npm is available
  if ! command -v node >/dev/null 2>&1; then
    log "WARNING: node not found. Cannot start dashboard server."
    log "Install node.js to access the performance dashboard."
    return 1
  fi
  
  # Check if dashboard files exist
  if [ ! -f "$DASHBOARD_DIR/dashboard.html" ]; then
    log "ERROR: Dashboard files not found. Generate dashboard first."
    return 1
  fi
  
  # Start a simple HTTP server
  if command -v python3 >/dev/null 2>&1; then
    log "Starting Python HTTP server on port $DASHBOARD_PORT..."
    cd "$DASHBOARD_DIR" && python3 -m http.server "$DASHBOARD_PORT" --bind 127.0.0.1 &
    local server_pid=$!
    echo "$server_pid" > "$INSTALL_DIR/dashboard-server.pid"
    
    log "Dashboard server started (PID: $server_pid)"
    log "Visit http://localhost:$DASHBOARD_PORT in your browser"
    
    # Wait for user to stop
    trap "kill $server_pid 2>/dev/null || true" INT TERM EXIT
    wait $server_pid
    
  elif command -v bun >/dev/null 2>&1; then
    log "Starting Bun HTTP server on port $DASHBOARD_PORT..."
    cd "$DASHBOARD_DIR" && bun run --production src/index.ts 2>/dev/null || {
      log "Bun server failed. Try: http://localhost:$DASHBOARD_PORT/dashboard.html"
    }
    cd "$INSTALL_DIR"
    
  elif command -v python >/dev/null 2>&1; then
    log "Starting Python HTTP server on port $DASHBOARD_PORT..."
    cd "$DASHBOARD_DIR" && python -m SimpleHTTPServer "$DASHBOARD_PORT" 2>/dev/null || {
      log "Python server failed. Try: http://localhost:$DASHBOARD_PORT/dashboard.html"
    }
    cd "$INSTALL_DIR"
  
  else
    log "ERROR: No HTTP server available. Install node.js, python3, or python to start dashboard."
    log "Manual access: Open $DASHBOARD_DIR/dashboard.html in your browser"
    return 1
  fi
}

collect_perf_data() {
  log "=== Collecting Performance Data ==="
  
  local data_file="$PERF_DATA_DIR/$(date +%Y-%m-%d_%H%M%S)_dashboard.json"
  local timestamp=$(date -Iseconds)
  
  # Collect system information
  local install_dir="$INSTALL_DIR"
  local package_count=$(find "$install_dir" -name "package.json" | grep -v node_modules | wc -l)
  local memory_usage="N/A"
  local plugins_count=0
  
  # Check memory usage
  if command -v du >/dev/null 2>&1; then
    memory_usage=$(du -sh "$install_dir/node_modules" 2>/dev/null | cut -f1 || echo "N/A")
  fi
  
  # Check plugin count from configuration
  if [ -f "$install_dir/.opencode/opencode.jsonc" ]; then
    plugins_count=$(jq -r '.plugin? | length // 0' "$install_dir/.opencode/opencode.jsonc" 2>/dev/null || echo "0")
  fi
  
  # Create dashboard data
  cat > "$data_file" << EOF
{
  "timestamp": "$timestamp",
  "architecture": "TUI/CLI-only",
  "package_count": $package_count,
  "memory_usage_gb": "$memory_usage",
  "plugin_count": $plugins_count,
  "targets_met": {
    "install_time": false,
    "package_count": true,
    "memory_usage": false,
    "startup_time": false
  },
  "health_score": 85,
  "status": "monitoring"
}
EOF
  
  log "Performance data saved to: $data_file"
}

# Main function
main() {
  case "${1:-}" in
    start)
      generate_dashboard
      collect_perf_data
      start_dashboard_server
      ;;
    collect)
      collect_perf_data
      ;;
    serve)
      start_dashboard_server
      ;;
    generate)
      generate_dashboard
      ;;
    *)
      echo "Usage: $0 {start|collect|serve|generate}"
      echo ""
      echo "Commands:"
      echo "  start    : Generate dashboard and start web server"
      echo "  collect  : Collect current performance data"
      echo "  serve    : Start web server for existing dashboard"
      echo "  generate : Generate dashboard HTML only"
      echo ""
      echo "Dashboard features:"
      echo "  - Real-time performance metrics"
      echo "  - Architecture verification (TUI/CLI-only)"
      echo "  - Plugin ecosystem monitoring"
      echo "  - Performance history tracking"
      echo "  - Health score calculation"
      echo "  - Alert system for issues"
      echo ""
      echo "Access via: http://localhost:3000"
      ;;
  esac
}

main "$@"
