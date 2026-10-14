#!/usr/bin/env bash
set -euo pipefail

# Install the JS dependency graph without coupling the whole npm install to a
# single Electron binary download attempt. The visual smoke jobs need Electron,
# but the package graph itself can be installed deterministically first.
#
# Registry/network resets are transient infrastructure failures, not product
# regressions. Keep retries bounded and deterministic; npm ci still validates
# the committed lockfile on every attempt.
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
install_ok=0
for attempt in 1 2 3; do
  echo "Installing visual dependencies (attempt ${attempt}/3)..."
  if npm ci     --fetch-retries=5     --fetch-retry-factor=2     --fetch-retry-mintimeout=2000     --fetch-retry-maxtimeout=30000; then
    install_ok=1
    break
  fi

  if (( attempt < 3 )); then
    echo "::warning::npm ci failed; retrying after a bounded backoff."
    npm cache verify >/dev/null 2>&1 || true
    sleep $((attempt * 10))
  fi
done
unset ELECTRON_SKIP_BINARY_DOWNLOAD

if (( install_ok != 1 )); then
  echo "::error::npm ci failed after 3 attempts."
  exit 1
fi

ELECTRON_BINARY="node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
if [[ -x "$ELECTRON_BINARY" ]]; then
  echo "Electron binary is already present."
  exit 0
fi

for attempt in 1 2 3; do
  echo "Preparing Electron binary (attempt ${attempt}/3)..."
  if node node_modules/electron/install.js; then
    if [[ -x "$ELECTRON_BINARY" ]]; then
      echo "Electron binary is ready."
      exit 0
    fi
    echo "Electron installer exited successfully but the expected binary is missing." >&2
  fi

  if (( attempt < 3 )); then
    sleep $((attempt * 5))
  fi
done

echo "Unable to prepare the Electron binary after 3 attempts." >&2
exit 1
