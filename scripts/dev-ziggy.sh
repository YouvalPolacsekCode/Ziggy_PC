#!/usr/bin/env bash
# Start Ziggy backend (uvicorn) + frontend (vite) on Mac in one terminal.
# Prefixes each line with [BE]/[FE] so the streams are readable together.
# Ctrl+C stops both cleanly.
#
# Assumes the dev HA stack (./scripts/dev-up.sh) is already running.
# Falls back gracefully if it isn't.

set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

if ! curl -sf --max-time 2 http://localhost:8123/ > /dev/null 2>&1; then
  echo "[dev-ziggy] WARN: dev HA at localhost:8123 is not responding."
  echo "[dev-ziggy]       Run ./scripts/dev-up.sh first if you want HA-backed features."
  echo "[dev-ziggy]       Continuing anyway — Ziggy will start without HA connectivity."
  echo
fi

if [ ! -d ".venv" ]; then
  echo "[dev-ziggy] ERROR: .venv not found. Create it first:"
  echo "  python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

source .venv/bin/activate

pids=()
cleanup() {
  trap - INT TERM EXIT
  echo
  echo "[dev-ziggy] Stopping..."
  for pid in "${pids[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

(uvicorn backend.server:app --host 127.0.0.1 --port 8001 --reload 2>&1 \
  | sed -u 's/^/[BE] /') &
pids+=($!)

(cd frontend && npm run dev 2>&1 | sed -u 's/^/[FE] /') &
pids+=($!)

echo "[dev-ziggy] Backend: http://localhost:8001  |  Frontend: http://localhost:3000"
echo "[dev-ziggy] Ctrl+C to stop both."
echo

wait
