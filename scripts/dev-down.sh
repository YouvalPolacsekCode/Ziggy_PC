#!/usr/bin/env bash
# Stop the Mac dev stack. With -v, also wipes the dev HA's state.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

if [ "${1:-}" = "-v" ]; then
  echo "Stopping dev stack AND wiping HA state (you'll have to re-onboard)..."
  docker compose -f docker-compose.dev.yml down -v
  rm -rf docker/ha-config-dev/.storage \
         docker/ha-config-dev/.cloud \
         docker/ha-config-dev/home-assistant_v2.db* \
         docker/ha-config-dev/home-assistant.log* \
         docker/ha-config-dev/.HA_VERSION \
         docker/ha-config-dev/secrets.yaml \
         2>/dev/null || true
  echo "Done. Run ./scripts/dev-up.sh to start fresh."
else
  echo "Stopping dev stack (HA state preserved)..."
  docker compose -f docker-compose.dev.yml down
  echo "Done. Run ./scripts/dev-up.sh to resume."
fi
