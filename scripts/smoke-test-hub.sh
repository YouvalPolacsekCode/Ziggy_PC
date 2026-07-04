#!/usr/bin/env bash
# scripts/smoke-test-hub.sh
# End-to-end smoke test for the mini-PC provisioning flow (Phases 1-4.5).
#
# Steps:
#   1. Log in to the relay as relay_admin → get JWT
#   2. POST /api/provision/hub → get provisioning bundle
#   3. GET /api/provision/home/{id}/status → confirm 'awaiting_claim'
#   4. GET /api/admin/fleet/homes → confirm the new hub appears
#   5. Print deprovision curl for manual cleanup
#
# Interactive: prompts for RELAY_ADMIN_EMAIL and RELAY_ADMIN_PASSWORD
# (SecureString-style: no echo, no history). Password never leaves stdin.

set -euo pipefail

RELAY_URL="${RELAY_URL:-https://ziggy-relay.fly.dev}"
HOME_NAME="${HOME_NAME:-Smoke Test $(date -u +%Y%m%dT%H%M%SZ)}"

echo "=== Ziggy hub provisioning smoke test ==="
echo "Relay:     $RELAY_URL"
echo "Home name: $HOME_NAME"
echo

if [[ -z "${RELAY_ADMIN_EMAIL:-}" ]]; then
  read -rp "Relay admin email: " RELAY_ADMIN_EMAIL
fi
if [[ -z "${RELAY_ADMIN_PASSWORD:-}" ]]; then
  read -rsp "Relay admin password: " RELAY_ADMIN_PASSWORD
  echo
fi

# -------- 1. Log in --------
echo "[1/5] Logging in..."
login_body="$(RELAY_ADMIN_EMAIL="$RELAY_ADMIN_EMAIL" RELAY_ADMIN_PASSWORD="$RELAY_ADMIN_PASSWORD" \
  python3 -c 'import json, os; print(json.dumps({"email": os.environ["RELAY_ADMIN_EMAIL"], "password": os.environ["RELAY_ADMIN_PASSWORD"]}))')"
login_resp="$(curl -fsS -X POST "$RELAY_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "$login_body")"
JWT="$(printf '%s' "$login_resp" | python3 -c 'import json, sys; print(json.load(sys.stdin)["token"])')"
if [[ -z "$JWT" ]]; then
  echo "ERROR: login returned no token. Body: $login_resp"; exit 1
fi
echo "     JWT acquired (${JWT:0:24}...)"

# -------- 2. Provision hub --------
echo "[2/5] POST /api/provision/hub..."
prov_body="$(HOME_NAME="$HOME_NAME" python3 -c 'import json, os; print(json.dumps({"home_name": os.environ["HOME_NAME"], "owner_email": "smoke-test@ziggy.local"}))')"
prov_resp="$(curl -fsS -X POST "$RELAY_URL/api/provision/hub" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "$prov_body")"
HOME_ID="$(printf '%s' "$prov_resp" | python3 -c 'import json, sys; print(json.load(sys.stdin)["home_id"])')"
TUNNEL_URL="$(printf '%s' "$prov_resp" | python3 -c 'import json, sys; print(json.load(sys.stdin)["tunnel_url"])')"
TUNNEL_ID="$(printf '%s' "$prov_resp" | python3 -c 'import json, sys; print(json.load(sys.stdin)["tunnel_id"])')"
echo "     home_id:    $HOME_ID"
echo "     tunnel_url: $TUNNEL_URL"
echo "     tunnel_id:  $TUNNEL_ID"

# -------- 3. Poll status --------
echo "[3/5] GET /api/provision/home/$HOME_ID/status..."
status_resp="$(curl -fsS "$RELAY_URL/api/provision/home/$HOME_ID/status" \
  -H "Authorization: Bearer $JWT")"
STATUS="$(printf '%s' "$status_resp" | python3 -c 'import json, sys; print(json.load(sys.stdin)["status"])')"
TYPE="$(printf '%s' "$status_resp" | python3 -c 'import json, sys; print(json.load(sys.stdin)["type"])')"
echo "     type:   $TYPE"
echo "     status: $STATUS"
if [[ "$TYPE" != "hub" ]]; then echo "FAIL: expected type=hub, got $TYPE"; exit 1; fi
if [[ "$STATUS" != "awaiting_claim" ]]; then echo "FAIL: expected status=awaiting_claim, got $STATUS"; exit 1; fi

# -------- 4. Fleet list --------
echo "[4/5] GET /api/admin/fleet/homes (expect to see $HOME_ID)..."
fleet_resp="$(curl -fsS "$RELAY_URL/api/admin/fleet/homes" -H "Authorization: Bearer $JWT")"
found="$(printf '%s' "$fleet_resp" | HOME_ID="$HOME_ID" python3 -c "
import json, sys, os
data = json.load(sys.stdin)
for h in data.get('homes', []):
    if h['id'] == os.environ['HOME_ID']:
        print('yes')
        break
else:
    print('no')
")"
echo "     appears in fleet: $found"
if [[ "$found" != "yes" ]]; then echo "FAIL: home not in fleet list"; exit 1; fi

# -------- 5. Cleanup instructions --------
echo
echo "=== SMOKE TEST PASSED ==="
echo
echo "Test home left behind at status=awaiting_claim. To deprovision:"
echo
echo "  curl -X DELETE '$RELAY_URL/api/provision/home/$HOME_ID' \\"
echo "    -H 'Authorization: Bearer <YOUR_JWT>'"
echo
echo "(Deprovision will attempt SSH to Oracle and fail silently — the CF tunnel"
echo "will still be deleted, so this is safe.)"
