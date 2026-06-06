#!/usr/bin/env bash
# Inject HA_URL + HA_TOKEN into the Mac's .env for dev HA use.
# Usage:  ./scripts/dev-set-ha-token.sh <long-lived-access-token>
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <ha-long-lived-access-token>"
  echo
  echo "Get a token from the dev HA UI:"
  echo "  http://localhost:8123 -> Profile (avatar) -> Security ->"
  echo "  Long-Lived Access Tokens -> Create Token"
  exit 1
fi

TOKEN="$1"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Run from a repo with a .env first."
  exit 1
fi

# Use a python one-liner instead of sed because tokens contain '/' and '+'
# which break sed's substitution delimiter, and macOS sed is BSD-flavored
# anyway. Python avoids the cross-platform mess entirely.
python3 - "$ENV_FILE" "$TOKEN" <<'PY'
import sys, re
path, token = sys.argv[1], sys.argv[2]
with open(path) as f:
    txt = f.read()

def upsert(text, key, value):
    pat = re.compile(rf"^{re.escape(key)}=.*$", re.MULTILINE)
    if pat.search(text):
        return pat.sub(f"{key}={value}", text)
    return text.rstrip() + f"\n{key}={value}\n"

txt = upsert(txt, "HA_URL",   "http://localhost:8123/")
txt = upsert(txt, "HA_TOKEN", token)

with open(path, "w") as f:
    f.write(txt)
PY

echo "OK: .env updated."
echo "  HA_URL=http://localhost:8123/"
echo "  HA_TOKEN=<set>"
echo
echo "Restart your Mac Ziggy backend so it picks up the new token."
