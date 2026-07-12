#!/usr/bin/env bash
# =============================================================================
# ziggy-customer-reset.sh — customer-facing "start my home over" soft reset.
#
# Clears the things a customer means by "reset" — automations, routines, and
# device pairings/registry — WITHOUT destroying who the home is. Identity,
# cloud registration, user accounts, web-push keys, and backups all survive,
# so the box stays the same home on the same cloud tenant.
#
# CLEARS (Ziggy state):
#   automations.json, automation_history.json, automation_meta.json,
#   automation_state.json, local_automation_actions.json,
#   device_registry.json, events.jsonl, zones.json, home_map.db
#
# KEEPS:
#   auth.db (accounts), vapid_keys.json (push), persons.json, ui_prefs/,
#   /etc/ziggy/* (identity + cloud registration), config/*, any backups/ dir,
#   and the entire HA + Z2M + Mosquitto stack (paired radios stay paired).
#
# App-consistent path first: POST /api/admin/reset/customer (Stream 5) so the
# running app clears its own in-memory state + broadcasts; the filesystem wipe
# below is the hard fallback / guarantee.
#
# Requires --confirm. --dry-run previews.
#     sudo /opt/ziggy/scripts/linux/ziggy-customer-reset.sh --dry-run
#     sudo /opt/ziggy/scripts/linux/ziggy-customer-reset.sh --confirm
# =============================================================================
set -uo pipefail

CONFIRM=false
DRY_RUN=false
INTENT_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --confirm)  CONFIRM=true ;;
    --dry-run)  DRY_RUN=true ;;
    --intent)   INTENT_ARG="${2:?--intent needs a file path or JSON}"; shift ;;
    --intent=*) INTENT_ARG="${1#--intent=}" ;;
    -h|--help)  grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//' | head -40; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

# --- Intent handoff (from the authenticated admin API via the watcher) -------
# --intent means the app already authorized this (no interactive --confirm) and
# we must NOT fire the outbound app callback (would loop API→script→API).
AUTHORIZED=false
FROM_INTENT=false
if [ -n "$INTENT_ARG" ]; then
  FROM_INTENT=true
  AUTHORIZED=true
  if [ -f "$INTENT_ARG" ]; then INTENT_JSON="$(cat "$INTENT_ARG")"; else INTENT_JSON="$INTENT_ARG"; fi
  _ij() {
    printf '%s' "$INTENT_JSON" | python3 -c $'import sys,json\ntry:\n d=json.load(sys.stdin)\nexcept Exception:\n sys.exit(0)\nv=d.get(sys.argv[1])\nif isinstance(v,bool): print("true" if v else "false")\nelif v is not None: print(v)' "$1" 2>/dev/null || true
  }
  [ "$(_ij dry_run)" = "true" ] && DRY_RUN=true
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZIGGY_ENV_FILE="${ZIGGY_ENV_FILE:-/etc/ziggy/ziggy.env}"
[ -f "$ZIGGY_ENV_FILE" ] && { set -a; . "$ZIGGY_ENV_FILE"; set +a; }
REPO_DIR="${ZIGGY_REPO_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
API_URL="${ZIGGY_API_URL:-http://127.0.0.1:8001}"
USER_FILES="$REPO_DIR/user_files"
BACKUP_DIR="$USER_FILES/reset-backups"
cd "$REPO_DIR"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
say() { if $DRY_RUN; then echo "[dry-run] $1"; else echo "$1"; fi; }

# Files this reset clears (automations + pairings, not identity).
CLEAR_FILES=(
  automations.json
  automation_history.json
  automation_meta.json
  automation_state.json
  local_automation_actions.json
  device_registry.json
  events.jsonl
  zones.json
  home_map.db
)

cat <<EOF

  Ziggy CUSTOMER RESET (soft)
  ---------------------------
  Clears automations + device pairings. Keeps accounts, identity, cloud
  registration, push keys, and backups. The home stays the same home.

  Repo: $REPO_DIR
  Time: $TS

EOF

if ! $CONFIRM && ! $DRY_RUN && ! $AUTHORIZED; then
  echo "Re-run with --confirm to proceed (or --dry-run to preview)."
  exit 1
fi

# --- 1. App-consistent reset first (best-effort) ----------------------------
# Skipped when invoked via --intent (the request already came through the app).
if ! $FROM_INTENT && [ -n "${ZIGGY_ADMIN_TOKEN:-}" ]; then
  say "POST $API_URL/api/admin/reset/customer (app clears automations + pairings)"
  $DRY_RUN || curl -fsS --max-time 20 -X POST "$API_URL/api/admin/reset/customer" \
    -H "Authorization: Bearer ${ZIGGY_ADMIN_TOKEN}" -H "Content-Type: application/json" \
    -d '{}' >/dev/null 2>&1 || echo "  (app endpoint unreachable — filesystem fallback below still applies)"
fi

# --- 2. Snapshot then clear the automation/pairing state --------------------
if ! $DRY_RUN; then mkdir -p "$BACKUP_DIR/$TS"; fi
for f in "${CLEAR_FILES[@]}"; do
  path="$USER_FILES/$f"
  if [ -e "$path" ]; then
    say "back up + clear $f"
    if ! $DRY_RUN; then
      cp -a "$path" "$BACKUP_DIR/$TS/" 2>/dev/null || true
      rm -f "$path" 2>/dev/null || true
    fi
  fi
done

echo
if $DRY_RUN; then
  echo "Dry run complete — nothing changed."
  exit 0
fi

# --- 3. Nudge the app to reload cleared state -------------------------------
# A running Ziggy caches automations/registry in memory; restart just the
# ziggy service so it reloads from the now-empty files. HA + radios untouched.
if command -v docker >/dev/null 2>&1; then
  say "restart ziggy service to reload cleared state"
  docker compose restart ziggy >/dev/null 2>&1 || docker compose up -d --no-deps ziggy >/dev/null 2>&1 || true
fi

echo "Customer reset complete. Cleared state backed up to: $BACKUP_DIR/$TS"
echo "Automations + pairings are gone; your account, home, and backups remain."
