#!/bin/sh
# openaxe - one-line install
# Usage: curl -sL https://github.com/dressedinblack/openaxe/releases/latest/download/install.sh | sh
set -eu

BIN_DIR="${1:-$HOME/.local/bin}"
REPO="${REPO:-dressedinblack/openaxe}"

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
if [ "$PLATFORM" = "windows" ]; then
  ARCHIVE="${ARCHIVE}.zip"
else
  ARCHIVE="${ARCHIVE}.tar.gz"
fi

DOWNLOAD_URL="https://github.com/$REPO/releases/download/$TAG/$ARCHIVE"
echo "Downloading openaxe $VERSION ($ARCHIVE)..."

mkdir -p "$BIN_DIR"

if [ "$PLATFORM" = "windows" ]; then
  tmp=$(mktemp -d)
  curl -sL "$DOWNLOAD_URL" -o "$tmp/openaxe.zip"
  unzip -o "$tmp/openaxe.zip" -d "$BIN_DIR"
  rm -rf "$tmp"
else
  curl -sL "$DOWNLOAD_URL" | tar xz -C "$BIN_DIR"
fi

chmod +x "$BIN_DIR/openaxe"
echo "Installed openaxe $VERSION to $BIN_DIR/openaxe"
echo "Make sure $BIN_DIR is in your PATH"
