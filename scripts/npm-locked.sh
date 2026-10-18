#!/bin/bash
# Serializes npm commands across parallel workers so the shared workspace
# node_modules and package-lock.json are never written concurrently.
# Usage: scripts/npm-locked.sh install -w app some-package
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCK="/tmp/rivertide-npm.lock"
for _ in $(seq 1 900); do
  if mkdir "$LOCK" 2>/dev/null; then
    trap 'rmdir "$LOCK"' EXIT
    cd "$ROOT"
    npm "$@"
    exit $?
  fi
  sleep 2
done
echo "npm-locked: timed out waiting for $LOCK (remove it if no npm is running)" >&2
exit 1
