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

echo "Fetching latest release..."
TAG=$(curl -sL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep '"tag_name"' | cut -d'"' -f4)
[ -n "$TAG" ] || { echo "could not find latest release"; exit 1; }
VERSION="${TAG#v}"

ARCHIVE="openaxe-${PLATFORM}-${ARCH}"
# macOS ships .zip; Linux ships .tar.gz (musl variants excluded by default)
if [ "$PLATFORM" = "linux" ]; then
  EXT="tar.gz"
else
  EXT="zip"
fi
ARCHIVE="${ARCHIVE}.${EXT}"

DOWNLOAD_URL="https://github.com/$REPO/releases/download/$TAG/$ARCHIVE"
echo "Downloading openaxe $VERSION ($ARCHIVE)..."

mkdir -p "$BIN_DIR"

if [ "$EXT" = "zip" ]; then
  tmp=$(mktemp -d)
  curl -sL "$DOWNLOAD_URL" -o "$tmp/openaxe.zip"
  unzip -o "$tmp/openaxe.zip" -d "$BIN_DIR"
  rm -rf "$tmp"
else
  curl -sL "$DOWNLOAD_URL" | tar xz -C "$BIN_DIR"
fi

chmod +x "$BIN_DIR/openaxe"

# Windows: ensure Visual C++ Redistributable is installed (required by opentui.dll)
if [ "$PLATFORM" = "windows" ]; then
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
fi

echo "Installed openaxe $VERSION to $BIN_DIR/openaxe"
echo "Make sure $BIN_DIR is in your PATH"
