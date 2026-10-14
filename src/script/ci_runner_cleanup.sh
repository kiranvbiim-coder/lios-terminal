#!/usr/bin/env bash
set -euo pipefail

# Keep the self-hosted runner from accumulating regenerable build state between
# jobs. This script intentionally removes only the current Actions workspace's
# dependency/build outputs plus package-manager download caches. It never
# touches user data, Docker volumes/images, application data, signing material,
# pyenv runtimes, or the runner tool cache.

ROOT="${GITHUB_WORKSPACE:-}"
if [[ -z "$ROOT" || ! -d "$ROOT" ]]; then
  echo "::warning::GITHUB_WORKSPACE is unavailable; skipping workspace cleanup."
  exit 0
fi

case "$ROOT" in
  *"/_work/"*) ;;
  *)
    echo "::warning::Refusing cleanup outside a GitHub Actions _work directory: $ROOT"
    exit 0
    ;;
esac

echo "Disk before post-job cleanup:"
df -h "$ROOT" || true

stop_known_vite_process() {
  local pid_file="$1"
  if [[ ! -f "$pid_file" ]]; then
    return
  fi
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if ! [[ "$pid" =~ ^[0-9]+$ ]]; then
    return
  fi
  local command
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  if [[ "$command" == *"vite"* ]]; then
    kill "$pid" >/dev/null 2>&1 || true
  fi
}

stop_known_vite_process /tmp/lios-visual-smoke-vite.pid
stop_known_vite_process /tmp/lios-analytical-visual-smoke-vite.pid
stop_known_vite_process /tmp/lios-valuation-smoke-vite.pid

rm -rf   "$ROOT/src/node_modules"   "$ROOT/src/dist"   "$ROOT/src/dist-app"   "$ROOT/src/visual-smoke-artifacts"   "$ROOT/src/analytical-visual-smoke-artifacts"   "$ROOT/src/valuation-smoke-artifacts"

rm -f   "$ROOT/src/v6-typecheck.log"   "$ROOT/src/v6-offline-tests.log"   "$ROOT/src/v6-build.log"

npm_cache_root="$(npm config get cache 2>/dev/null || true)"
if [[ "$npm_cache_root" == /* && -d "$npm_cache_root/_npx" ]]; then
  find "$npm_cache_root/_npx" -mindepth 1 -delete 2>/dev/null || true
fi

if [[ "$(uname -s)" == "Darwin" ]]; then
  rm -rf \
    "$HOME/Library/Caches/electron" \
    "$HOME/Library/Caches/electron-builder" \
    "$HOME/Library/Application Support/Cursor/Cache" \
    "$HOME/Library/Application Support/Cursor/CachedData" \
    "$HOME/Library/Application Support/Cursor/Code Cache" \
    "$HOME/Library/Application Support/Cursor/GPUCache" \
    "$HOME/Library/Application Support/Cursor/logs" \
    "$HOME/Library/Application Support/Code/Cache" \
    "$HOME/Library/Application Support/Code/CachedData" \
    "$HOME/Library/Application Support/Code/Code Cache" \
    "$HOME/Library/Application Support/Code/GPUCache" \
    "$HOME/Library/Application Support/Code/logs"
  rm -rf "$HOME/.rustup/downloads" "$HOME/.rustup/tmp"
fi

python3 -m pip cache purge >/dev/null 2>&1 || true
rm -rf "$HOME/Library/Caches/pip" "$HOME/.cache/pip"

rm -f   /tmp/lios-visual-smoke-vite.log   /tmp/lios-visual-smoke-vite.pid   /tmp/lios-analytical-visual-smoke-vite.log   /tmp/lios-analytical-visual-smoke-vite.pid   /tmp/lios-valuation-smoke-vite.log   /tmp/lios-valuation-smoke-vite.pid

if [[ "$(uname -s)" == "Darwin" ]] && command -v colima >/dev/null 2>&1 && colima status >/dev/null 2>&1; then
  echo "Trimming unused Colima VM blocks after CI cleanup."
  colima ssh -- sudo fstrim -a >/dev/null 2>&1 || true
fi

echo "Disk after post-job cleanup:"
df -h "$ROOT" || true
