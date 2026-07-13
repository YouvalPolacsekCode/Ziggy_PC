#!/usr/bin/env bash
# scripts/canary/set-relay-secrets.sh
# Run this ON YOUR MAC. It:
#   1. generates the two random relay secrets + the founder master key,
#   2. asks you to paste the 3 Cloudflare values (token, zone id, account id),
#   3. sets everything as Fly secrets on the ziggy-relay app,
#   4. saves the values you'll need later to ~/.ziggy/canary-secrets.txt (0600).
# You never invent a password. Just run it and paste when asked.
set -euo pipefail

RELAY_APP="ziggy-relay"
SECRETS_FILE="$HOME/.ziggy/canary-secrets.txt"
FOUNDER_EMAIL="silentyouval@gmail.com"

cat <<'BANNER'
┌────────────────────────────────────────────────────────────────────────┐
│ PHASE 2 SCRIPT — run this WITH Claude, after Phase 1 (Canary) is green.  │
│ It changes secrets on your LIVE ziggy-relay (rotates JWT → logs out      │
│ existing app sessions; redeploys the relay). Do NOT run it during        │
│ Phase 1. See docs/CANARY_REBUILD_RUNBOOK.md.                             │
└────────────────────────────────────────────────────────────────────────┘
BANNER
read -r -p 'Type EXACTLY "phase2" to proceed: ' _confirm
[ "$_confirm" = "phase2" ] || { echo "Aborted (not confirmed)."; exit 1; }

command -v flyctl >/dev/null 2>&1 || { echo "ERROR: flyctl is not installed. Install: brew install flyctl"; exit 1; }
flyctl auth whoami >/dev/null 2>&1 || { echo "ERROR: not logged into Fly. Run: flyctl auth login"; exit 1; }
flyctl status -a "$RELAY_APP" >/dev/null 2>&1 || { echo "ERROR: cannot see app '$RELAY_APP' on your Fly account."; exit 1; }

echo "== Generating random secrets (you do not need to remember these) =="
RELAY_JWT_SECRET="$(openssl rand -hex 32)"
RELAY_ADMIN_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
MASTER_KEY_B64="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"

echo
echo "== Now paste 3 values from Cloudflare (Part A of the runbook tells you exactly where) =="
read -r -p "Cloudflare API token: " CF_API_TOKEN
read -r -p "Cloudflare Zone ID (ziggy-home.com): " CF_ZONE_ID
read -r -p "Cloudflare Account ID: " CF_ACCOUNT_ID
[ -n "$CF_API_TOKEN" ] && [ -n "$CF_ZONE_ID" ] && [ -n "$CF_ACCOUNT_ID" ] || { echo "ERROR: all three Cloudflare values are required."; exit 1; }

echo
echo "== Setting Fly secrets on $RELAY_APP (this redeploys the relay, ~30s) =="
flyctl secrets set -a "$RELAY_APP" \
  ZIGGY_ENV="prod" \
  RELAY_JWT_SECRET="$RELAY_JWT_SECRET" \
  RELAY_ADMIN_EMAIL="$FOUNDER_EMAIL" \
  RELAY_ADMIN_PASSWORD="$RELAY_ADMIN_PASSWORD" \
  CF_API_TOKEN="$CF_API_TOKEN" \
  CF_ZONE_ID="$CF_ZONE_ID" \
  CF_ACCOUNT_ID="$CF_ACCOUNT_ID" \
  CF_HUB_DOMAIN="hubs.ziggy-home.com" \
  ZIGGY_SSH_DOMAIN="ssh.ziggy-home.com" \
  ZIGGY_SUPPORT_ALLOWED_EMAILS="$FOUNDER_EMAIL"

echo
echo "== Saving what you'll need at imaging time to $SECRETS_FILE =="
mkdir -p "$(dirname "$SECRETS_FILE")"
umask 077
cat > "$SECRETS_FILE" <<EOF
# Ziggy Canary secrets — generated $(date -u +%Y-%m-%dT%H:%M:%SZ)
# KEEP THIS FILE. Also copy MASTER_KEY_B64 into your password manager.
RELAY_ADMIN_EMAIL=$FOUNDER_EMAIL
RELAY_ADMIN_PASSWORD=$RELAY_ADMIN_PASSWORD
MASTER_KEY_B64=$MASTER_KEY_B64
# --- fill these in AFTER you create the Backblaze bucket + key (Part A step 3) ---
B2_KEY_ID=
B2_APP_KEY=
B2_ENDPOINT=
EOF
chmod 600 "$SECRETS_FILE"

echo
echo "DONE. Relay secrets set. Your imaging values are in: $SECRETS_FILE"
echo "NEXT: create the Backblaze bucket + key (runbook Part A step 3) and paste them into that file."
