#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="${ROOT}/src"
PY_SERVICE="${SRC}/python-service"

cd "${SRC}"

export ELECTRON_SKIP_BINARY_DOWNLOAD=1
bash script/ci_install_node_dependencies.sh
unset ELECTRON_SKIP_BINARY_DOWNLOAD

if [[ ! -x "${PY_SERVICE}/.venv/bin/python3" ]]; then
  python3 -m venv "${PY_SERVICE}/.venv"
fi

"${PY_SERVICE}/.venv/bin/pip" install --upgrade pip
"${PY_SERVICE}/.venv/bin/pip" install -r "${PY_SERVICE}/requirements.txt"

echo "LiOS cloud-agent install complete (Node + python-service venv)."
