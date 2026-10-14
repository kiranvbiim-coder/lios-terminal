#!/usr/bin/env bash
set -euo pipefail

# Deterministic dependency install for non-visual CI. These jobs never launch
# Electron, so avoid downloading the large Electron runtime binary. This
# reduces self-hosted disk pressure and one avoidable network failure point.
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
ok=0
for attempt in 1 2 3; do
  echo "Installing Node dependencies (attempt ${attempt}/3)..."
  if npm ci     --fetch-retries=5     --fetch-retry-factor=2     --fetch-retry-mintimeout=2000     --fetch-retry-maxtimeout=30000; then
    ok=1
    break
  fi
  if (( attempt < 3 )); then
    echo "::warning::npm ci failed; retrying after bounded backoff."
    npm cache verify >/dev/null 2>&1 || true
    sleep $((attempt * 10))
  fi
done
unset ELECTRON_SKIP_BINARY_DOWNLOAD

if (( ok != 1 )); then
  echo "::error::npm ci failed after 3 attempts."
  exit 1
fi
