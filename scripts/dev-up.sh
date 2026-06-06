#!/usr/bin/env bash
# Start the Mac dev stack — isolated HA + Mosquitto containers.
# Ziggy itself runs natively (uvicorn + npm run dev), not in Docker.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is not installed."
  echo "Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker is installed but the daemon isn't running."
  echo "Open Docker Desktop, wait until the whale icon stops animating, then re-run."
  exit 1
fi

echo "Starting Ziggy dev stack (HA + Mosquitto)..."
docker compose -f docker-compose.dev.yml up -d

echo
echo "Waiting for HA to come up (this takes ~30-60s on first boot)..."
for i in $(seq 1 60); do
  if curl -fs http://localhost:8123 >/dev/null 2>&1; then
    echo "HA is up at http://localhost:8123"
    break
  fi
  sleep 2
  printf "."
done
echo

cat <<'EOF'

Dev stack is running.

Next steps:
  1. Open http://localhost:8123 in your browser.
  2. Complete HA onboarding (name, password, location — any values).
  3. Profile (bottom-left avatar) -> Security -> Long-Lived Access Tokens
     -> Create Token. Name it "ziggy-dev-mac". Copy the token.
  4. Inject the token into your Mac .env:
       ./scripts/dev-set-ha-token.sh <paste-token-here>
  5. Start Ziggy (in two terminals):
       Terminal 1:  source .venv/bin/activate && uvicorn backend.server:app --host 127.0.0.1 --port 8001 --reload
       Terminal 2:  cd frontend && npm run dev
     Open http://localhost:3000

To stop: ./scripts/dev-down.sh
To wipe HA state and start fresh: ./scripts/dev-down.sh -v
EOF
