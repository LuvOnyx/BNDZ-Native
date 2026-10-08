#!/usr/bin/env bash
# Live check of https://cloud.bndz.org through a throwaway tunnel and the real guest panel.
# Installs cloudflared and wrangler when they are missing. Requires node, npm, curl, and python3.
# Tears the throwaway tunnel down on the way out. Does not print tokens or the origin secret.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required" >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to run the guest panel" >&2
  exit 1
fi

if [[ ! -x node_modules/.bin/wrangler ]]; then
  npm install
fi

arch="$(uname -m)"
case "$arch" in
  x86_64) asset="cloudflared-linux-amd64" ;;
  aarch64|arm64) asset="cloudflared-linux-arm64" ;;
  *) echo "unsupported architecture $arch" >&2; exit 1 ;;
esac
if ! command -v cloudflared >/dev/null 2>&1 && [[ ! -x bin/cloudflared ]]; then
  mkdir -p bin
  curl -fsSL -o bin/cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}"
  chmod 755 bin/cloudflared
fi

./deploy.sh
exec node e2e.mjs
