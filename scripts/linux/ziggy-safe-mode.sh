#!/usr/bin/env bash
# =============================================================================
# ziggy-safe-mode.sh — bring a hub to a minimal known-good, reachable state.
#
# When an OTA leaves a unit botched, or Z2M/voice wedges the box, safe mode
# strips the stack down to the essentials so the operator can still reach
# Ziggy and diagnose:
#
#   ON:   * stop + disable ziggy-update.timer      (no OTA churn while you work)
#         * stop zigbee2mqtt                        (skip the flakiest service)
#         * ensure mosquitto + homeassistant + ziggy are up
#         * best-effort POST /api/admin/safe-mode {enabled:true} so the app
#           disables voice / heavy background threads
#         * write /etc/ziggy/safe-mode marker
#
#   OFF:  * remove marker, POST safe-mode {enabled:false}
#         * bring the FULL stack back (honouring ZIGGY_COMPOSE_PROFILES)
#         * re-enable + start ziggy-update.timer
#
# Idempotent. --dry-run prints the plan.
#     sudo /opt/ziggy/scripts/linux/ziggy-safe-mode.sh on
#     sudo /opt/ziggy/scripts/linux/ziggy-safe-mode.sh off
#     sudo /opt/ziggy/scripts/linux/ziggy-safe-mode.sh status
# =============================================================================
set -uo pipefail

ACTION=""
DRY_RUN=false
INTENT_ARG=""
FROM_INTENT=false
while [ $# -gt 0 ]; do
  case "$1" in
    on|off|status) ACTION="$1" ;;
    --dry-run)  DRY_RUN=true ;;
    --intent)   INTENT_ARG="${2:?--intent needs a file path or JSON}"; shift ;;
    --intent=*) INTENT_ARG="${1#--intent=}" ;;
    -h|--help)  grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//' | head -40; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

# --- Intent handoff (from the authenticated admin API via the watcher) -------
# The lifecycle intent has no explicit on/off; parse an optional op/mode/state
# field if present, else default to entering safe mode ("on"). --intent also
# suppresses the outbound app callback (see post_flag) to avoid an API loop.
if [ -n "$INTENT_ARG" ]; then
  FROM_INTENT=true
  if [ -f "$INTENT_ARG" ]; then INTENT_JSON="$(cat "$INTENT_ARG")"; else INTENT_JSON="$INTENT_ARG"; fi
  _ij() {
    printf '%s' "$INTENT_JSON" | python3 -c $'import sys,json\ntry:\n d=json.load(sys.stdin)\nexcept Exception:\n sys.exit(0)\nv=d.get(sys.argv[1])\nif isinstance(v,bool): print("true" if v else "false")\nelif v is not None: print(v)' "$1" 2>/dev/null || true
  }
  [ "$(_ij dry_run)" = "true" ] && DRY_RUN=true
  if [ -z "$ACTION" ]; then
    case "$(_ij op)$(_ij mode)$(_ij state)" in
      *off*) ACTION="off" ;;
      *status*) ACTION="status" ;;
      *) ACTION="on" ;;
    esac
  fi
fi
[ -z "$ACTION" ] && { echo "Usage: $0 {on|off|status} [--dry-run] [--intent <file>]" >&2; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZIGGY_ENV_FILE="${ZIGGY_ENV_FILE:-/etc/ziggy/ziggy.env}"
[ -f "$ZIGGY_ENV_FILE" ] && { set -a; . "$ZIGGY_ENV_FILE"; set +a; }
REPO_DIR="${ZIGGY_REPO_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
API_URL="${ZIGGY_API_URL:-http://127.0.0.1:8001}"
ETC_DIR="$(dirname "$ZIGGY_ENV_FILE")"
# Safety: never let a mis-set ZIGGY_ENV_FILE point the marker mkdir/rm at a
# system root. Same guard as ziggy-factory-reset.sh — ETC_DIR must be a real,
# non-root, ziggy-scoped dir before we mkdir/rm anything under it.
case "$ETC_DIR" in
  ""|"/"|"/etc"|"/home"|"/root"|"/opt"|"/var"|"/usr")
    echo "ABORT: refusing to operate on unsafe secrets dir '$ETC_DIR' (check ZIGGY_ENV_FILE)." >&2
    exit 1 ;;
esac
if [ "${#ETC_DIR}" -lt 5 ]; then
  echo "ABORT: secrets dir '$ETC_DIR' looks unsafe (too short). Check ZIGGY_ENV_FILE." >&2
  exit 1
fi
MARKER="$ETC_DIR/safe-mode"
COMPOSE_PROFILES="${ZIGGY_COMPOSE_PROFILES:-}"
cd "$REPO_DIR"
say() { if $DRY_RUN; then echo "[dry-run] $1"; else echo "$1"; fi; }

# Compose invocation honouring an optional zigbee-z2m profile in normal mode.
dc_full() {
  if [ -n "$COMPOSE_PROFILES" ]; then docker compose --profile "$COMPOSE_PROFILES" "$@"
  else docker compose "$@"; fi
}

post_flag() {  # $1 = true|false ; best-effort app hook, Stream 5 owns the endpoint
  # Skipped when invoked via --intent: the request already came through the app.
  # NOTE: targets the app HOOK /api/admin/reset/safe-mode, NOT the trigger
  # /api/admin/safe-mode — calling the trigger here would re-queue the intent
  # and loop the watcher forever.
  $FROM_INTENT && return 0
  [ -n "${ZIGGY_ADMIN_TOKEN:-}" ] || return 0
  say "POST $API_URL/api/admin/reset/safe-mode {enabled:$1}"
  $DRY_RUN || curl -fsS --max-time 10 -X POST "$API_URL/api/admin/reset/safe-mode" \
    -H "Authorization: Bearer ${ZIGGY_ADMIN_TOKEN}" -H "Content-Type: application/json" \
    -d "{\"enabled\":$1}" >/dev/null 2>&1 || true
}

case "$ACTION" in
  status)
    if [ -f "$MARKER" ]; then echo "safe-mode: ON  (since $(cat "$MARKER" 2>/dev/null))"; else echo "safe-mode: OFF"; fi
    echo "ziggy-update.timer: $(systemctl is-active ziggy-update.timer 2>/dev/null || echo '?') / $(systemctl is-enabled ziggy-update.timer 2>/dev/null || echo '?')"
    echo "containers:"
    docker compose ps 2>/dev/null | sed 's/^/  /'
    exit 0
    ;;

  on)
    echo "Entering SAFE MODE (Ziggy + HA only)..."
    if command -v systemctl >/dev/null 2>&1; then
      say "stop ziggy-update.timer"
      $DRY_RUN || systemctl stop ziggy-update.timer >/dev/null 2>&1 || true
    fi
    if command -v docker >/dev/null 2>&1; then
      say "stop zigbee2mqtt"
      $DRY_RUN || docker compose stop zigbee2mqtt >/dev/null 2>&1 || true
      say "ensure mosquitto + homeassistant + ziggy are up"
      $DRY_RUN || docker compose up -d --no-deps mosquitto homeassistant ziggy >/dev/null 2>&1 || true
    fi
    post_flag true
    if ! $DRY_RUN; then
      mkdir -p "$ETC_DIR"; date -u +%Y-%m-%dT%H:%M:%SZ > "$MARKER"
    fi
    echo "Safe mode ON. Ziggy should be reachable at $API_URL. OTA is paused."
    echo "Return to normal with: $0 off"
    ;;

  off)
    echo "Leaving safe mode — restoring full stack..."
    post_flag false
    if command -v docker >/dev/null 2>&1; then
      say "docker compose up -d (full stack${COMPOSE_PROFILES:+, profile=$COMPOSE_PROFILES})"
      $DRY_RUN || dc_full up -d >/dev/null 2>&1 || true
    fi
    if command -v systemctl >/dev/null 2>&1; then
      say "enable + start ziggy-update.timer"
      $DRY_RUN || { systemctl enable --now ziggy-update.timer >/dev/null 2>&1 || systemctl start ziggy-update.timer >/dev/null 2>&1 || true; }
    fi
    $DRY_RUN || rm -f "$MARKER" 2>/dev/null || true
    echo "Safe mode OFF. Full stack restored, OTA resumed."
    ;;
esac
