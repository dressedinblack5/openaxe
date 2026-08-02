#!/bin/sh
# openaxe - one-line install
# Usage: curl -sL https://raw.githubusercontent.com/dressedinblack5/openaxe/dev/install.sh | sh
set -eu

BIN_DIR="${1:-$HOME/.local/bin}"
REPO="${REPO:-dressedinblack5/openaxe}"

# detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  linux)  PLATFORM="linux"   ;;
  darwin) PLATFORM="darwin"  ;;
  mingw*|msys*|cygwin*)
    PLATFORM="windows"
    ;;
  *) echo "unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64) ARCH="x64"            ;;
  aarch64|arm64) ARCH="arm64"         ;;
  *) echo "unsupported arch: $ARCH"; exit 1 ;;
esac

# Windows x64 CPUs without AVX2 (pre-Haswell, some VMs) need the baseline build
if [ "$PLATFORM" = "windows" ] && [ "$ARCH" = "x64" ]; then
  if ! powershell.exe -NoProfile -Command "Add-Type -TypeDefinition 'using System.Runtime.InteropServices;public class Cpu{[DllImport(\"kernel32.dll\")]public static extern bool IsProcessorFeaturePresent(int f);}';if([Cpu]::IsProcessorFeaturePresent(40)){exit 0}else{exit 1}" >/dev/null 2>&1; then
    echo "CPU lacks AVX2, using baseline build..."
    ARCH="x64-baseline"
  fi
fi

ARCHIVE="openaxe-${PLATFORM}-${ARCH}"
# macOS ships .zip; Linux ships .tar.gz (musl variants excluded by default)
if [ "$PLATFORM" = "linux" ]; then
  EXT="tar.gz"
else
  EXT="zip"
fi
ARCHIVE="${ARCHIVE}.${EXT}"

# releases/latest/download redirects to the newest release asset — no API call, no rate limits
DOWNLOAD_URL="https://github.com/$REPO/releases/latest/download/$ARCHIVE"
echo "Downloading openaxe latest ($ARCHIVE)..."

mkdir -p "$BIN_DIR"

if [ "$EXT" = "zip" ]; then
  tmp=$(mktemp -d)
  curl -sL "$DOWNLOAD_URL" -o "$tmp/openaxe.zip"
  unzip -o "$tmp/openaxe.zip" -d "$BIN_DIR"
  rm -rf "$tmp"
else
  curl -sL "$DOWNLOAD_URL" | tar xz -C "$BIN_DIR"
fi

chmod +x "$BIN_DIR/openaxe" 2>/dev/null || chmod +x "$BIN_DIR/openaxe.exe" || true

# Windows: ensure Visual C++ Redistributable is installed (required by opentui.dll)
if [ "$PLATFORM" = "windows" ]; then
  if [ ! -f "$BIN_DIR/opentui.dll" ]; then
    echo "Error: opentui.dll not found after extraction."
    echo "This release is incomplete. Check https://github.com/$REPO/releases"
    exit 1
  fi
  if [ ! -f "$BIN_DIR/tiktoken_bg.wasm" ]; then
    echo "Error: tiktoken_bg.wasm not found after extraction."
    echo "This release is incomplete. Check https://github.com/$REPO/releases"
    exit 1
  fi
  SYSROOT="$(cmd //c "echo %SystemRoot%" 2>/dev/null | tr -d '\r')"
  if [ -z "$SYSROOT" ]; then SYSROOT="C:/Windows"; fi
  if [ ! -f "$SYSROOT/System32/vcruntime140.dll" ] || [ ! -f "$SYSROOT/System32/msvcp140.dll" ]; then
    echo "Visual C++ Redistributable not detected. Installing..."
    VCREDIST="vc_redist.x64.exe"
    if [ "$ARCH" = "arm64" ]; then VCREDIST="vc_redist.arm64.exe"; fi
    tmp=$(mktemp -d)
    if curl -sL "https://aka.ms/vs/17/release/$VCREDIST" -o "$tmp/$VCREDIST"; then
      "$tmp/$VCREDIST" /install /quiet /norestart
      echo "VC++ Redistributable installed."
    else
      echo "Failed to download $VCREDIST. Install manually from https://aka.ms/vs/17/release/$VCREDIST"
    fi
    rm -rf "$tmp"
  fi
  if ! "$BIN_DIR/openaxe.exe" --version >/dev/null 2>&1; then
    echo "Error: downloaded openaxe.exe failed to run."
    echo "If the Visual C++ Redistributable is missing, install it from:"
    echo "  https://aka.ms/vs/17/release/vc_redist.x64.exe"
    exit 1
  fi
fi

if [ "$PLATFORM" = "windows" ]; then
  echo "Installed openaxe latest to $BIN_DIR/openaxe.exe"
else
  echo "Installed openaxe latest to $BIN_DIR/openaxe"
fi
echo "Make sure $BIN_DIR is in your PATH"
