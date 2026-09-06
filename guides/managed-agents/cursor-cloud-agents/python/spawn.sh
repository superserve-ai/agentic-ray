#!/usr/bin/env bash
# --spawn hook wrapper for `agent worker controller`: runs spawn.py with the
# project's virtualenv so the hook works from any working directory.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
if [ -x .venv/bin/python ]; then
  exec .venv/bin/python spawn.py
fi
exec python3 spawn.py
