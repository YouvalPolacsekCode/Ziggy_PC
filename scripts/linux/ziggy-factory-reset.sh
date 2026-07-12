#!/usr/bin/env bash
# =============================================================================
# ziggy-factory-reset.sh — return a Ziggy hub to generic-image state.
#
# The heaviest reset. Wipes ALL runtime state so the box is indistinguishable
# from a freshly-flashed image (optionally keeping cloud identity so it rejoins
# the SAME home instead of provisioning a brand-new one).
#
# WIPES:
#   * Home Assistant config      (docker/ha-config/*  — entities, automations,
#                                 recorder DB, .storage/auth, secrets)
#   * Zigbee2MQTT data           (docker/z2m-data/*   — network key, pairings)
#   * Ziggy state                (user_files/*        — auth.db, device registry,
#                                 automations, tasks, events, VAPID keys)
#   * Mosquitto broker state     (docker volumes ziggy_mosquitto_data/_log)
#   * Secrets / config           (/etc/ziggy/secrets.yaml, config/settings.yaml,
#                                 config/secrets.yaml)
#
# MODES:
#   (default)      keep cloud identity: HOME_ID + RELAY_URL + RELAY_SECRET +
#                  cohort + infra pins are preserved in /etc/ziggy/ziggy.env so
#                  the box re-registers as the SAME home on next boot.
#   --full         generic image: also wipes /etc/ziggy entirely. The next boot
#                  must be re-provisioned from scratch (new HOME_ID).
#
# SAFETY:
#   Refuses to run without --confirm. --dry-run prints the plan and touches
#   nothing. Best-effort POSTs the server-side pre-reset hook first so the app
#   can deregister devices / flush cloud state cleanly.
#
#     sudo /opt/ziggy/scripts/linux/ziggy-factory-reset.sh --dry-run
#     sudo /opt/ziggy/scripts/linux/ziggy-factory-reset.sh --confirm
#     sudo /opt/ziggy/scripts/linux/ziggy-factory-reset.sh --full --confirm
# =============================================================================
set -uo pipefail

CONFIRM=false
DRY_RUN=false
FULL=false
INTENT_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --confirm)  CONFIRM=true ;;
    --dry-run)  DRY_RUN=true ;;
    --full)     FULL=true ;;
    --intent)   INTENT_ARG="${2:?--intent needs a file path or JSON}"; shift ;;
    --intent=*) INTENT_ARG="${1#--intent=}" ;;
    -h|--help)  grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//' | head -45; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

# --- Intent handoff (from the authenticated admin API via the watcher) -------
# --intent <file|json> means the request already passed super_admin auth in the
# app, so it is AUTHORIZED (no interactive --confirm needed) and we must NOT
# fire the outbound app callback below (that would loop API→script→API).
AUTHORIZED=false
FROM_INTENT=false
if [ -n "$INTENT_ARG" ]; then
  FROM_INTENT=true
  AUTHORIZED=true
  if [ -f "$INTENT_ARG" ]; then INTENT_JSON="$(cat "$INTENT_ARG")"; else INTENT_JSON="$INTENT_ARG"; fi
  _ij() {  # extract one top-level field from the intent JSON (bools -> true/false)
    printf '%s' "$INTENT_JSON" | python3 -c $'import sys,json\ntry:\n d=json.load(sys.stdin)\nexcept Exception:\n sys.exit(0)\nv=d.get(sys.argv[1])\nif isinstance(v,bool): print("true" if v else "false")\nelif v is not None: print(v)' "$1" 2>/dev/null || true
  }
  [ "$(_ij dry_run)" = "true" ] && DRY_RUN=true
  case "$(_ij mode)" in
    full|full-generic|generic) FULL=true ;;
  esac
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZIGGY_ENV_FILE="${ZIGGY_ENV_FILE:-/etc/ziggy/ziggy.env}"
[ -f "$ZIGGY_ENV_FILE" ] && { set -a; . "$ZIGGY_ENV_FILE"; set +a; }
REPO_DIR="${ZIGGY_REPO_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
API_URL="${ZIGGY_API_URL:-http://127.0.0.1:8001}"
ETC_DIR="$(dirname "$ZIGGY_ENV_FILE")"
HA_CONFIG_DIR="${ZIGGY_HA_CONFIG_DIR:-$REPO_DIR/docker/ha-config}"
Z2M_DATA_DIR="${ZIGGY_Z2M_DATA_DIR:-$REPO_DIR/docker/z2m-data}"
USER_FILES="$REPO_DIR/user_files"
COMPOSE_PROJECT="${ZIGGY_COMPOSE_PROJECT:-ziggy}"

cd "$REPO_DIR"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
say() { if $DRY_RUN; then echo "[dry-run] $1"; else echo "$1"; fi; }

# Safety: never let a mis-set ZIGGY_ENV_FILE turn --full into `rm -rf /`.
# ETC_DIR must be a real, non-root, ziggy-scoped directory.
case "$ETC_DIR" in
  ""|"/"|"/etc"|"/home"|"/root"|"/opt"|"/var"|"/usr")
    echo "ABORT: refusing to operate on unsafe secrets dir '$ETC_DIR' (check ZIGGY_ENV_FILE)." >&2
    exit 1 ;;
esac
if [ "${#ETC_DIR}" -lt 5 ]; then
  echo "ABORT: secrets dir '$ETC_DIR' looks unsafe (too short). Check ZIGGY_ENV_FILE." >&2
  exit 1
fi

# Reusable guard for any dir we `find -delete` inside. Same spirit as the
# ETC_DIR check above: a mis-set env override (ZIGGY_HA_CONFIG_DIR=/, etc.) must
# never let a wipe escape the repo. Requires: non-empty, long enough, not a
# protected system root, and resolving to a path UNDER $REPO_DIR. Aborts loudly
# otherwise — runs in dry-run too so a bad target is caught before execution.
_canon() { ( cd "$1" 2>/dev/null && pwd -P ); }
assert_wipe_dir_safe() {
  _dir="$1"; _label="$2"
  if [ -z "$_dir" ] || [ "${#_dir}" -lt 5 ]; then
    echo "ABORT: $_label '$_dir' is empty/too short — refusing find -delete." >&2; exit 1
  fi
  case "$_dir" in
    "/"|"/etc"|"/home"|"/root"|"/opt"|"/var"|"/usr")
      echo "ABORT: $_label '$_dir' is a protected system path — refusing find -delete." >&2; exit 1 ;;
  esac
  _adir="$(_canon "$_dir")"; _arepo="$(_canon "$REPO_DIR")"
  if [ -z "$_adir" ] || [ -z "$_arepo" ]; then
    echo "ABORT: $_label '$_dir' could not be resolved — refusing find -delete." >&2; exit 1
  fi
  case "$_adir/" in
    "$_arepo/"*) : ;;  # under the repo — safe to wipe inside
    *) echo "ABORT: $_label '$_dir' ($_adir) is not under REPO_DIR ($_arepo) — refusing find -delete." >&2; exit 1 ;;
  esac
}

MODE="keep-identity"; $FULL && MODE="full-generic"

cat <<EOF

  Ziggy FACTORY RESET
  -------------------
  Repo:        $REPO_DIR
  Mode:        $MODE
  HA config:   $HA_CONFIG_DIR
  Z2M data:    $Z2M_DATA_DIR
  Ziggy state: $USER_FILES
  Secrets:     $ETC_DIR $([ "$FULL" = true ] && echo '(WIPED)' || echo '(identity kept)')
  Time:        $TS

EOF

if ! $CONFIRM && ! $DRY_RUN && ! $AUTHORIZED; then
  echo "REFUSING: this erases the home. Re-run with --confirm (or --dry-run to preview)."
  exit 1
fi

# --- 0. Best-effort server-side pre-reset hook ------------------------------
# Lets the app deregister devices / notify cloud before we nuke state.
# Stream 5 owns POST /api/admin/reset/factory. Failure is non-fatal.
# Skipped when invoked via --intent: the request already came THROUGH the app,
# so calling back would loop API→watcher→script→API.
if ! $FROM_INTENT && [ -n "${ZIGGY_ADMIN_TOKEN:-}" ]; then
  say "POST $API_URL/api/admin/reset/factory (pre-reset hook)"
  $DRY_RUN || curl -fsS --max-time 15 -X POST "$API_URL/api/admin/reset/factory" \
    -H "Authorization: Bearer ${ZIGGY_ADMIN_TOKEN}" -H "Content-Type: application/json" \
    -d "{\"mode\":\"$MODE\"}" >/dev/null 2>&1 || echo "  (pre-reset hook unreachable — continuing)"
fi

# --- 1. Stop the OTA loop so it can't rebuild mid-wipe ----------------------
if command -v systemctl >/dev/null 2>&1; then
  say "stop + disable ziggy-update.timer (prevent OTA rebuild during reset)"
  $DRY_RUN || { systemctl stop ziggy-update.timer >/dev/null 2>&1 || true; }
fi

# --- 2. Bring the whole stack down (all profiles) ---------------------------
if command -v docker >/dev/null 2>&1; then
  say "docker compose down (stop HA + Z2M + Mosquitto + Ziggy)"
  if ! $DRY_RUN; then
    docker compose --profile zigbee-z2m down >/dev/null 2>&1 \
      || docker compose down >/dev/null 2>&1 || true
  fi
fi

# --- 3. Wipe HA config ------------------------------------------------------
if [ -d "$HA_CONFIG_DIR" ]; then
  assert_wipe_dir_safe "$HA_CONFIG_DIR" "HA config dir"
  say "wipe HA config contents in $HA_CONFIG_DIR"
  if ! $DRY_RUN; then
    find "$HA_CONFIG_DIR" -mindepth 1 -delete 2>/dev/null || true
    mkdir -p "$HA_CONFIG_DIR"
  fi
fi

# --- 4. Wipe Z2M data -------------------------------------------------------
if [ -d "$Z2M_DATA_DIR" ]; then
  assert_wipe_dir_safe "$Z2M_DATA_DIR" "Z2M data dir"
  say "wipe Zigbee2MQTT data in $Z2M_DATA_DIR"
  if ! $DRY_RUN; then
    find "$Z2M_DATA_DIR" -mindepth 1 -delete 2>/dev/null || true
    mkdir -p "$Z2M_DATA_DIR"
  fi
fi

# --- 5. Wipe Ziggy state (keep .gitkeep so the bind mount stays valid) ------
if [ -d "$USER_FILES" ]; then
  assert_wipe_dir_safe "$USER_FILES" "Ziggy state dir"
  say "wipe Ziggy state in $USER_FILES (preserving .gitkeep)"
  if ! $DRY_RUN; then
    find "$USER_FILES" -mindepth 1 ! -name '.gitkeep' -delete 2>/dev/null || true
    mkdir -p "$USER_FILES"
    touch "$USER_FILES/.gitkeep"
  fi
fi

# --- 6. Wipe Mosquitto broker volumes --------------------------------------
if command -v docker >/dev/null 2>&1; then
  for vol in "${COMPOSE_PROJECT}_mosquitto_data" "${COMPOSE_PROJECT}_mosquitto_log"; do
    say "remove docker volume $vol"
    $DRY_RUN || docker volume rm "$vol" >/dev/null 2>&1 || true
  done
fi

# --- 7. Secrets / config ----------------------------------------------------
if $FULL; then
  say "wipe $ETC_DIR entirely (full generic image — new HOME_ID on reprovision)"
  if ! $DRY_RUN; then
    # find -mindepth 1 -delete removes dotfiles too (a shell glob '/*' skips
    # them, leaving credential dotfiles behind → data remanence on resale).
    find "${ETC_DIR:?}" -mindepth 1 -delete 2>/dev/null || true
  fi
else
  # keep-identity: preserve only the cloud-registration + cohort keys.
  say "preserve cloud identity keys in $ZIGGY_ENV_FILE, drop all other secrets"
  if ! $DRY_RUN && [ -f "$ZIGGY_ENV_FILE" ]; then
    tmp="$(mktemp)"
    grep -E '^(HOME_ID|HOME_TYPE|RELAY_URL|RELAY_SECRET|ZIGGY_COHORT|ZIGGY_HA_IMAGE|ZIGGY_Z2M_IMAGE|ZIGGY_MOSQUITTO_IMAGE|ZIGGY_INFRA_CHANNEL)=' \
      "$ZIGGY_ENV_FILE" > "$tmp" 2>/dev/null || true
    mv "$tmp" "$ZIGGY_ENV_FILE"
  fi
fi
# Config files that carry user data / credentials (always cleared; the app
# recreates settings.yaml from the example or the relay provisioner on boot).
for f in "$REPO_DIR/config/settings.yaml" "$REPO_DIR/config/secrets.yaml" "$ETC_DIR/secrets.yaml"; do
  if [ -e "$f" ]; then
    say "remove $f"
    $DRY_RUN || rm -f "$f" 2>/dev/null || true
  fi
done

echo
if $DRY_RUN; then
  echo "Dry run complete. Nothing was changed. Re-run with --confirm to execute."
  exit 0
fi

cat <<EOF
Factory reset complete ($MODE).

Next steps:
  * keep-identity : reboot, or 'systemctl start ziggy-update.timer' + bring the
                    stack up — the box re-registers as HOME_ID=${HOME_ID:-<preserved>}.
  * full          : re-provision from the relay (fresh HOME_ID). The OTA timer
                    is left stopped; provisioning re-enables it.
EOF
