#!/usr/bin/env bash
# Deploy or tear down the public Cloud Drive router.
#   ./deploy.sh            idempotent deploy
#   ./deploy.sh teardown   remove only bndz-cloud-* resources this script owns
# Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. Does not print them.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required" >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi
if [[ ! -x node_modules/.bin/wrangler ]]; then
  npm install
fi

exec node deploy.mjs "${1:-deploy}"
