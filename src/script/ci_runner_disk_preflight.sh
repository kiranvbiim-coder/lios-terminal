#!/usr/bin/env bash
set -euo pipefail

TARGET="${GITHUB_WORKSPACE:-.}"
CLEAN_BELOW_KB="${LIOS_CI_CLEAN_BELOW_KB:-10485760}"
REQUIRED_FREE_KB="${LIOS_CI_REQUIRED_FREE_KB:-6291456}"

is_lios_actions_workspace() {
  [[ "${GITHUB_ACTIONS:-}" == "true" ]] \
    && [[ "${GITHUB_REPOSITORY:-}" == "kiranvbiim-coder/lios-v1.0.0" ]] \
    && [[ "$TARGET" == *"/_work/"* ]]
}

# Checkout is complete and dependency installation has not started yet. Remove
# only regenerable outputs from this exact Actions workspace so a cancelled
# prior run cannot strand node_modules/build artifacts and block the next gate.
case "$TARGET" in
  *"/_work/"*)
    rm -rf \
      "$TARGET/src/node_modules" \
      "$TARGET/src/dist" \
      "$TARGET/src/dist-app" \
      "$TARGET/src/visual-smoke-artifacts" \
      "$TARGET/src/analytical-visual-smoke-artifacts" \
      "$TARGET/src/valuation-smoke-artifacts"
    ;;
esac

available_kb() {
  df -Pk "$TARGET" | awk 'NR == 2 { print $4 }'
}

report_disk() {
  echo "Self-hosted runner disk state:"
  df -h "$TARGET"
}

before="$(available_kb)"
report_disk

if (( before < CLEAN_BELOW_KB )); then
  echo "::warning::Runner free space is below $((CLEAN_BELOW_KB / 1024 / 1024)) GiB; clearing regenerable package caches only."
  npm cache clean --force >/dev/null 2>&1 || true
  npm_cache_root="$(npm config get cache 2>/dev/null || true)"
  if [[ "$npm_cache_root" == /* && -d "$npm_cache_root/_npx" ]]; then
    find "$npm_cache_root/_npx" -mindepth 1 -delete
  fi
  rm -rf "$HOME/Library/Caches/electron" "$HOME/Library/Caches/electron-builder" "$HOME/.cache/electron" "$HOME/.cache/electron-builder"

  # Quant/Python CI installs can leave large wheel/download caches. These are
  # fully regenerable and contain no project data, virtualenvs, or user files.
  python3 -m pip cache purge >/dev/null 2>&1 || true
  rm -rf "$HOME/Library/Caches/pip" "$HOME/.cache/pip"

  after_package_cleanup="$(available_kb)"

  # Self-hosted runner temp state from cancelled jobs and Xcode DerivedData are
  # build caches only. They are safe to regenerate and are never release
  # archives, signing identities, source trees, Docker state or user data.
  if (( after_package_cleanup < REQUIRED_FREE_KB )); then
    if [[ -n "${RUNNER_TEMP:-}" && -d "${RUNNER_TEMP}" ]]; then
      find "${RUNNER_TEMP}" -mindepth 1 -mmin +120 -exec rm -rf {} + 2>/dev/null || true
    fi
    if [[ "$(uname -s)" == "Darwin" && -d "$HOME/Library/Developer/Xcode/DerivedData" ]]; then
      echo "Runner is still critically low on space; clearing regenerable Xcode DerivedData."
      find "$HOME/Library/Developer/Xcode/DerivedData" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
    fi
  fi

  after_package_cleanup="$(available_kb)"
  if (( after_package_cleanup < REQUIRED_FREE_KB )) && command -v brew >/dev/null 2>&1; then
    brew_cache="$(brew --cache 2>/dev/null || true)"
    if [[ -n "$brew_cache" && -d "$brew_cache" ]]; then
      echo "Runner is still critically low on space; clearing Homebrew download cache only."
      find "$brew_cache" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
    fi
  fi

  # Last-resort shared developer-cache reclamation for this dedicated Actions
  # runner. These paths are caches only: no ~/.codex settings/history, source
  # repositories, credentials, signing material, models or LiOS workspaces are
  # touched. Runtime packages are downloaded/regenerated automatically.
  after_package_cleanup="$(available_kb)"
  if (( after_package_cleanup < REQUIRED_FREE_KB )) && is_lios_actions_workspace; then
    echo "Runner is still critically low on space; reclaiming regenerable shared development caches."
    for shared_cache in \
      "$HOME/.cache/codex-runtimes" \
      "$HOME/.cache/hyperframes" \
      "$HOME/.cache/prisma" \
      "$HOME/.cache/uv" \
      "$HOME/.cargo/registry/cache" \
      "$HOME/.cargo/registry/src" \
      "$HOME/.cargo/registry/index" \
      "$HOME/.cargo/git/db" \
      "$HOME/.gradle/caches" \
      "$HOME/.local/share/pnpm/store" \
      "$HOME/.pnpm-store" \
      "$HOME/.bun/install/cache" \
      "$HOME/.yarn/cache" \
      "$HOME/.pyenv/cache" \
      "$HOME/Library/Caches/typescript" \
      "$HOME/Library/Caches/bun" \
      "$HOME/Library/Caches/uv" \
      "$HOME/Library/Caches/node-gyp" \
      "$HOME/Library/Caches/Comet" \
      "$HOME/Library/Caches/ollama" \
      "$HOME/Library/Caches/org.R-project.R" \
      "$HOME/Library/Caches/Codex" \
      "$HOME/Library/Application Support/Cursor/Cache" \
      "$HOME/Library/Application Support/Cursor/CachedData" \
      "$HOME/Library/Application Support/Cursor/Code Cache" \
      "$HOME/Library/Application Support/Cursor/GPUCache" \
      "$HOME/Library/Application Support/Cursor/logs" \
      "$HOME/Library/Application Support/Code/Cache" \
      "$HOME/Library/Application Support/Code/CachedData" \
      "$HOME/Library/Application Support/Code/Code Cache" \
      "$HOME/Library/Application Support/Code/GPUCache" \
      "$HOME/Library/Application Support/Code/logs" \
      "$HOME/.rustup/downloads" \
      "$HOME/.rustup/tmp" \
      "$HOME/Library/Caches/lios" \
      "$HOME/Library/Caches/colima"; do
      if [[ -d "$shared_cache" ]]; then
        echo "Clearing cache: $shared_cache"
        find "$shared_cache" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
      fi
    done

    # Node/Python/server tests create isolated lios-* directories under the
    # macOS temp root. Normally tests remove them themselves; cancelled jobs
    # cannot. Only stale LiOS-prefixed entries are eligible here.
    temp_root="${TMPDIR:-/tmp}"
    if [[ -d "$temp_root" ]]; then
      echo "Clearing stale LiOS test temp entries older than two hours."
      find "$temp_root" -maxdepth 1 -name 'lios-*' -mmin +120 -exec rm -rf {} + 2>/dev/null || true
    fi

    # Old self-hosted runner diagnostic text logs are safe to remove. Keep a
    # full week for troubleshooting and never touch runner config/tool caches.
    runner_root="${TARGET%%/_work/*}"
    if [[ "$runner_root" != "$TARGET" && -d "$runner_root/_diag" ]]; then
      find "$runner_root/_diag" -type f -mtime +7 -delete 2>/dev/null || true
    fi
  fi

  # Simulator caches can be very large on a developer Mac but contain no
  # project source or signing material. Delete only caches and simulator
  # devices Xcode itself already marks unavailable.
  after_package_cleanup="$(available_kb)"
  if (( after_package_cleanup < REQUIRED_FREE_KB )) && [[ "$(uname -s)" == "Darwin" ]]; then
    if [[ -d "$HOME/Library/Developer/CoreSimulator/Caches" ]]; then
      echo "Runner remains low on space; clearing CoreSimulator caches."
      find "$HOME/Library/Developer/CoreSimulator/Caches" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
    fi
    if command -v xcrun >/dev/null 2>&1; then
      echo "Removing simulator devices already marked unavailable by Xcode."
      xcrun simctl delete unavailable >/dev/null 2>&1 || true
    fi
  fi

  # Homebrew cleanup removes download cache and superseded package versions,
  # never the currently installed version required by the runner.
  after_package_cleanup="$(available_kb)"
  if (( after_package_cleanup < REQUIRED_FREE_KB )) && command -v brew >/dev/null 2>&1; then
    echo "Runner remains low on space; pruning superseded Homebrew versions."
    brew cleanup --prune=all >/dev/null 2>&1 || true
  fi

  # Old RLS test containers are named by this repository and can be left behind
  # by interrupted runs. Remove only that namespace and its anonymous volumes;
  # never prune unrelated developer containers, named volumes or images.
  after_package_cleanup="$(available_kb)"
  if (( after_package_cleanup < REQUIRED_FREE_KB )) && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    stale_lios_pg="$(docker ps -aq --filter "name=^/lios_test_pg_" 2>/dev/null || true)"
    if [[ -n "$stale_lios_pg" ]]; then
      echo "Runner remains low on space; removing stale LiOS RLS test containers and anonymous volumes only."
      # Docker container IDs contain no whitespace, so shell splitting here is
      # deliberate and remains compatible with macOS Bash 3.2.
      docker rm -fv $stale_lios_pg >/dev/null 2>&1 || true
    fi
  fi

  # Final host-cache fallback for this dedicated Actions runner. ~/Library/Caches
  # is macOS user-level cache storage only; settings, application support,
  # documents, models, credentials and source trees live elsewhere.
  after_package_cleanup="$(available_kb)"
  if (( after_package_cleanup < REQUIRED_FREE_KB )) && [[ "$(uname -s)" == "Darwin" ]] && is_lios_actions_workspace; then
    if [[ -d "$HOME/Library/Caches" ]]; then
      echo "Runner remains low on space; clearing remaining regenerable user-level macOS caches."
      find "$HOME/Library/Caches" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
    fi
  fi

  # Colima/Lima VM disks can retain host blocks after files inside the VM are
  # deleted. fstrim marks only already-unused guest blocks as discardable; it
  # does not delete Docker images, containers, volumes, or user data. Colima
  # documents this as the manual disk-space recovery path on v0.5+.
  after_package_cleanup="$(available_kb)"
  if (( after_package_cleanup < REQUIRED_FREE_KB )) && [[ "$(uname -s)" == "Darwin" ]] && command -v colima >/dev/null 2>&1; then
    if colima status >/dev/null 2>&1; then
      echo "Runner remains low on space; trimming unused blocks from the Colima VM disk."
      colima ssh -- sudo fstrim -a >/dev/null 2>&1 || true
    fi
  fi

  # Final CI-only fallback: Docker/BuildKit build cache is regenerable. Do NOT
  # prune images, containers or volumes; those may be deliberate developer or
  # test assets and are outside this cleanup contract.
  after_package_cleanup="$(available_kb)"
  if (( after_package_cleanup < REQUIRED_FREE_KB )) && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    echo "Runner remains low on space; pruning Docker build cache only."
    docker builder prune -af >/dev/null 2>&1 || true
    if docker buildx version >/dev/null 2>&1; then
      docker buildx prune -af >/dev/null 2>&1 || true
    fi
  fi
fi

after="$(available_kb)"
report_disk

if (( after < REQUIRED_FREE_KB )); then
  echo "Safe CI cache diagnostics (sizes only):"
  for candidate in \
    "$HOME/Library/Developer/Xcode/DerivedData" \
    "$HOME/Library/Developer/CoreSimulator" \
    "$HOME/Library/Caches" \
    "$HOME/.cache" \
    "$HOME/.gradle/caches" \
    "$HOME/.cargo" \
    "$HOME/.local/share/pnpm" \
    "$HOME/.pyenv/cache" \
    "$HOME/.npm" \
    "${RUNNER_TEMP:-}" \
    "$(dirname "$TARGET")" \
    "${RUNNER_TOOL_CACHE:-}"; do
    if [[ -n "$candidate" && -e "$candidate" ]]; then
      du -sh "$candidate" 2>/dev/null || true
    fi
  done
  for cache_root in "$HOME/.cache" "$HOME/Library/Caches"; do
    if [[ -d "$cache_root" ]]; then
      echo "Largest entries under $cache_root:"
      du -sh "$cache_root"/* 2>/dev/null | sort -h | tail -n 20 || true
    fi
  done
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    echo "Docker disk usage (diagnostic only; images/volumes are never pruned):"
    docker system df 2>/dev/null || true
  fi

  # When ordinary CI caches are already exhausted, report only the sizes of
  # common developer/model stores. These locations may contain deliberate user
  # assets, so this block is diagnostics-only and MUST NOT delete them.
  echo "Developer/model storage diagnostics (sizes only; never auto-deleted):"
  for candidate in \
    "$HOME/Library/Developer" \
    "$HOME/Library/Containers/com.docker.docker" \
    "$HOME/Library/Application Support/Ollama" \
    "$HOME/Library/Application Support/ComfyUI" \
    "$HOME/Library/Application Support/Cursor" \
    "$HOME/Library/Application Support/Code" \
    "$HOME/.ollama" \
    "$HOME/ComfyUI" \
    "$HOME/.docker" \
    "$HOME/.colima" \
    "$HOME/.vscode/extensions" \
    "$HOME/.cursor" \
    "$HOME/.codex" \
    "$HOME/.rustup" \
    "$HOME/.local" \
    "$HOME/actions-runner-lios-v4clone"; do
    if [[ -e "$candidate" ]]; then
      du -sh "$candidate" 2>/dev/null || true
    fi
  done

  echo "::error::Self-hosted runner has less than $((REQUIRED_FREE_KB / 1024 / 1024)) GiB free after safe cache cleanup. Free disk space on the runner before retrying CI."
  exit 1
fi
