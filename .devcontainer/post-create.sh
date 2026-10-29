#!/usr/bin/env bash
# Runs once when the dev container is created: the tools the missions need, then `make setup`.
# It ends on `make use`, so the last line says which language is saved or how to pick one.
set -euo pipefail

command -v make >/dev/null || { sudo apt-get update && sudo apt-get install -y --no-install-recommends make; }
command -v uv >/dev/null || pip install --no-cache-dir uv
command -v pnpm >/dev/null || npm install -g pnpm@10

make setup USE_HINT=0
echo
echo "Ready."
bash .devcontainer/key-note.sh
make --no-print-directory use
