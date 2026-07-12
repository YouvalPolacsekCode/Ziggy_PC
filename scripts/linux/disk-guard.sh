#!/usr/bin/env bash
# =============================================================================
# disk-guard.sh — keep a Ziggy hub from silently filling its disk.
#
# A mini PC that runs out of disk fails EVERYTHING at once: OTA builds die on
# ENOSPC, HA's recorder DB corrupts, MQTT stops persisting. This runs from
# ziggy-disk-guard.timer (default daily) and:
#
#   * Prunes user_files/deploy-logs/*.log older than N days.
#   * Trims user_files/update.log if it grows past a size cap.
#   * `docker image prune -f` (dangling images left by --no-cache rebuilds);
#     with --deep also prunes unused images + build cache older than a window.
#   * Caps the Home Assistant recorder DB: if it exceeds the GB cap it asks HA
#     to purge history (safe, online) via recorder.purge when HA_URL/HA_TOKEN
#     are set; otherwise it warns loudly.
#   * Warns (and, from the timer, journals) when free space drops below 5 GB.
#
# Acts by default (it IS the maintenance job). --dry-run reports only.
#     sudo /opt/ziggy/scripts/linux/disk-guard.sh
#     sudo /opt/ziggy/scripts/linux/disk-guard.sh --dry-run
#     sudo /opt/ziggy/scripts/linux/disk-guard.sh --deep
#
# Config (env or /etc/ziggy/ziggy.env):
#   ZIGGY_DEPLOYLOG_KEEP_DAYS=14
#   ZIGGY_UPDATELOG_CAP_MB=20
#   ZIGGY_RECORDER_DB_CAP_GB=2
#   ZIGGY_DISK_WARN_GB=5
#   ZIGGY_HA_CONFIG_DIR=/opt/ziggy/docker/ha-config
#   ZIGGY_IMAGE_PRUNE_UNTIL=168h   (only with --deep)
#   HA_URL / HA_TOKEN              (for online recorder purge)
# =============================================================================
set -uo pipefail

DRY_RUN=false
DEEP=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --deep)    DEEP=true ;;
    -h|--help) grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//' | head -40; exit 0 ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZIGGY_ENV_FILE="${ZIGGY_ENV_FILE:-/etc/ziggy/ziggy.env}"
[ -f "$ZIGGY_ENV_FILE" ] && { set -a; . "$ZIGGY_ENV_FILE"; set +a; }
REPO_DIR="${ZIGGY_REPO_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"

DEPLOYLOG_KEEP_DAYS="${ZIGGY_DEPLOYLOG_KEEP_DAYS:-14}"
UPDATELOG_CAP_MB="${ZIGGY_UPDATELOG_CAP_MB:-20}"
RECORDER_DB_CAP_GB="${ZIGGY_RECORDER_DB_CAP_GB:-2}"
DISK_WARN_GB="${ZIGGY_DISK_WARN_GB:-5}"
HA_CONFIG_DIR="${ZIGGY_HA_CONFIG_DIR:-$REPO_DIR/docker/ha-config}"
IMAGE_PRUNE_UNTIL="${ZIGGY_IMAGE_PRUNE_UNTIL:-168h}"

USER_FILES="$REPO_DIR/user_files"
DEPLOY_LOGS_DIR="$USER_FILES/deploy-logs"
UPDATE_LOG="$USER_FILES/update.log"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

log()  { echo "[$TS] $1"; }
act()  { if $DRY_RUN; then echo "[$TS] [dry-run] would: $1"; else echo "[$TS] $1"; fi; }

log "disk-guard start (repo=$REPO_DIR dry_run=$DRY_RUN deep=$DEEP)"

# --- 1. Prune old per-deploy build logs ------------------------------------
if [ -d "$DEPLOY_LOGS_DIR" ]; then
  count="$(find "$DEPLOY_LOGS_DIR" -type f -name '*.log' -mtime "+$DEPLOYLOG_KEEP_DAYS" 2>/dev/null | wc -l | tr -d ' ')"
  act "prune $count deploy-log file(s) older than ${DEPLOYLOG_KEEP_DAYS}d in $DEPLOY_LOGS_DIR"
  $DRY_RUN || find "$DEPLOY_LOGS_DIR" -type f -name '*.log' -mtime "+$DEPLOYLOG_KEEP_DAYS" -delete 2>/dev/null || true
fi

# --- 2. Trim update.log if oversized ---------------------------------------
if [ -f "$UPDATE_LOG" ]; then
  sz_mb=$(( $(wc -c < "$UPDATE_LOG" 2>/dev/null || echo 0) / 1024 / 1024 ))
  if [ "$sz_mb" -ge "$UPDATELOG_CAP_MB" ]; then
    act "trim update.log (${sz_mb}MB >= ${UPDATELOG_CAP_MB}MB) — keep last 2000 lines"
    if ! $DRY_RUN; then
      tail -n 2000 "$UPDATE_LOG" > "$UPDATE_LOG.tmp" 2>/dev/null && mv "$UPDATE_LOG.tmp" "$UPDATE_LOG"
    fi
  fi
fi

# --- 3. Docker image prune -------------------------------------------------
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  act "docker image prune -f (dangling)"
  $DRY_RUN || docker image prune -f >/dev/null 2>&1 || true
  if $DEEP; then
    act "docker image prune -af --filter until=$IMAGE_PRUNE_UNTIL + builder prune"
    if ! $DRY_RUN; then
      docker image prune -af --filter "until=$IMAGE_PRUNE_UNTIL" >/dev/null 2>&1 || true
      docker builder prune -f --filter "until=$IMAGE_PRUNE_UNTIL" >/dev/null 2>&1 || true
    fi
  fi
else
  log "WARN: docker not reachable — skipping image prune"
fi

# --- 4. Cap the HA recorder DB ---------------------------------------------
RECORDER_DB="$HA_CONFIG_DIR/home-assistant_v2.db"
if [ -f "$RECORDER_DB" ]; then
  db_bytes="$(wc -c < "$RECORDER_DB" 2>/dev/null || echo 0)"
  cap_bytes=$(( RECORDER_DB_CAP_GB * 1024 * 1024 * 1024 ))
  db_gb_x10=$(( db_bytes * 10 / 1024 / 1024 / 1024 ))
  log "HA recorder DB: $(( db_gb_x10 / 10 )).$(( db_gb_x10 % 10 )) GB (cap ${RECORDER_DB_CAP_GB} GB)"
  if [ "$db_bytes" -gt "$cap_bytes" ]; then
    if [ -n "${HA_URL:-}" ] && [ -n "${HA_TOKEN:-}" ]; then
      act "recorder.purge via HA REST (keep_days=10, repack) to bring DB under cap"
      if ! $DRY_RUN; then
        curl -fsS --max-time 30 -X POST "${HA_URL%/}/api/services/recorder/purge" \
          -H "Authorization: Bearer ${HA_TOKEN}" \
          -H "Content-Type: application/json" \
          -d '{"keep_days":10,"repack":true}' >/dev/null 2>&1 \
          && log "recorder.purge requested (HA compacts online)" \
          || log "WARN: recorder.purge request failed — check HA_URL/HA_TOKEN"
      fi
    else
      log "WARN: recorder DB over cap but HA_URL/HA_TOKEN unset — set them for online purge, or lower recorder purge_keep_days in HA config"
    fi
  fi
fi

# --- 5. Free-space warning -------------------------------------------------
free_kb="$(df -Pk "$REPO_DIR" 2>/dev/null | awk 'NR==2{print $4}')"
if [ -n "${free_kb:-}" ]; then
  free_gb=$(( free_kb / 1024 / 1024 ))
  log "Free space on repo filesystem: ${free_gb} GB"
  if [ "$free_gb" -lt "$DISK_WARN_GB" ]; then
    log "WARN: less than ${DISK_WARN_GB} GB free (${free_gb} GB) — OTA builds and HA recorder are at risk"
    exit 1
  fi
fi

log "disk-guard done"
