#!/usr/bin/env bash
# =============================================================================
# Ziggy Linux OTA update script (Ubuntu Server 24.04 + systemd + Docker Engine).
#
# Linux port of scripts/update.ps1. Preserves ALL of its behaviour:
#
#   * Two-track cohort model (canary follows origin/main, production follows
#     the newest release-* tag).
#   * Opt-in GPG signed-tag enforcement for production homes.
#   * fetch + reset --hard (canary) / detached checkout of the tag (production)
#     so HEAD *and* the working tree land on the target unambiguously.
#   * Rebuild ONLY the ziggy service with `--no-cache --pull` so a stale layer
#     cache can never resurrect an old bundle.
#   * `docker compose pull` for the PINNED infra images (Home Assistant /
#     Zigbee2MQTT / Mosquitto) on a *controlled channel*, gated to a slow
#     cadence so a 2-minute OTA loop never chases :latest.
#   * Post-deploy /api/version verification with a ~60s timeout.
#   * Auto-rollback to the last verified SHA from user_files/deploy_log, with
#     the rollback itself recorded (kind: rollback) so future runs tell it
#     apart from a real deploy.
#   * Heartbeats (update.heartbeat + update_task.json) so /api/admin/deploy/
#     health can see the loop is alive without SSH.
#   * Silent on no-op so a 2-minute timer doesn't spam the log.
#   * deploy_log rotation so the breadcrumb file can't grow without bound.
#
# systemd replaces the Windows scheduled task. The "task heartbeat" is a
# snapshot of the ziggy-update.service/.timer unit state (systemctl show),
# the equivalent of update.ps1's update_task.json Task Scheduler snapshot.
#
# Runs from ziggy-update.service (root by default). Also safe to run by hand:
#     sudo /opt/ziggy/scripts/linux/ziggy-update.sh
#     sudo /opt/ziggy/scripts/linux/ziggy-update.sh --dry-run
#     sudo /opt/ziggy/scripts/linux/ziggy-update.sh --infra   # force infra sync
#
# Config (env, or /etc/ziggy/ziggy.env which is sourced if present):
#   ZIGGY_COHORT=canary|production          (default canary)
#   ZIGGY_REQUIRE_SIGNED_TAGS=true|false    (default false; production only)
#   ZIGGY_REPO_DIR=/opt/ziggy               (default: autodetect from script path)
#   ZIGGY_API_URL=http://127.0.0.1:8001     (default)
#   ZIGGY_CONTAINER=ziggy-ziggy-1           (default; compose project pinned 'ziggy')
#   ZIGGY_INFRA_CHANNEL=pinned|off          (default pinned)
#   ZIGGY_INFRA_INTERVAL_HOURS=24           (min hours between infra image syncs)
#   ZIGGY_HA_IMAGE / ZIGGY_Z2M_IMAGE / ZIGGY_MOSQUITTO_IMAGE
#                                           (digest-pinned refs; when set they
#                                            drive a generated compose override)
#   ZIGGY_DEPLOYLOG_MAX_ENTRIES=200         (rotate deploy_log past this many)
# =============================================================================

# Schema/cache-buster: bump when a change must force the next poll to rebuild
# even if main hasn't moved. Not read at runtime; only makes this file differ.
_SCHEMA_VERSION="linux-v1"

set -euo pipefail

# --- CLI flags --------------------------------------------------------------
DRY_RUN=false
FORCE_INFRA=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --infra)   FORCE_INFRA=true ;;
    -h|--help)
      grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//' | head -60
      exit 0 ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# --- Path + config resolution ----------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# scripts/linux/ -> repo root is two levels up.
_DEFAULT_REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"

ZIGGY_ENV_FILE="${ZIGGY_ENV_FILE:-/etc/ziggy/ziggy.env}"
if [ -f "$ZIGGY_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$ZIGGY_ENV_FILE"; set +a
fi

REPO_DIR="${ZIGGY_REPO_DIR:-$_DEFAULT_REPO}"
API_URL="${ZIGGY_API_URL:-http://127.0.0.1:8001}"
CONTAINER="${ZIGGY_CONTAINER:-ziggy-ziggy-1}"
COHORT="$(printf '%s' "${ZIGGY_COHORT:-canary}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
REQUIRE_SIGNED="${ZIGGY_REQUIRE_SIGNED_TAGS:-false}"
INFRA_CHANNEL="${ZIGGY_INFRA_CHANNEL:-pinned}"
INFRA_INTERVAL_HOURS="${ZIGGY_INFRA_INTERVAL_HOURS:-24}"
DEPLOYLOG_MAX_ENTRIES="${ZIGGY_DEPLOYLOG_MAX_ENTRIES:-200}"

cd "$REPO_DIR"

USER_FILES="$REPO_DIR/user_files"
DEPLOY_LOG="$USER_FILES/deploy_log"
UPDATE_LOG="$USER_FILES/update.log"
DEPLOY_LOGS_DIR="$USER_FILES/deploy-logs"
HEARTBEAT="$USER_FILES/update.heartbeat"
TASK_HEARTBEAT="$USER_FILES/update_task.json"
INFRA_MARKER="$USER_FILES/.infra-last-sync"
INFRA_OVERRIDE="$USER_FILES/compose.infra-pins.yml"
UNIT_NAME="ziggy-update"

mkdir -p "$USER_FILES" "$DEPLOY_LOGS_DIR"

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# --- Logging ----------------------------------------------------------------
log() {
  local line="[$TS] $1"
  echo "$line"
  $DRY_RUN || printf '%s\n' "$line" >> "$UPDATE_LOG"
}

# Heartbeat: "<utc-ts> <status>" — rewritten every cycle so external observers
# can read "last seen + last outcome" in one stat.
heartbeat() {
  $DRY_RUN && return 0
  printf '%s %s\n' "$TS" "$1" > "$HEARTBEAT" 2>/dev/null || true
}

# --- docker compose invocation (v2 plugin) ----------------------------------
dc() { docker compose "$@"; }

heartbeat "starting"

# --- Fleet-wide clock nudge (mirror of w32tm /resync) -----------------------
# The anomaly engine flags clock_skew_suspected once the local clock drifts a
# couple of minutes. Best-effort; a broken time daemon must never abort OTA.
if ! $DRY_RUN; then
  ( chronyc -a makestep >/dev/null 2>&1 \
    || timedatectl set-ntp true >/dev/null 2>&1 \
    || systemctl restart systemd-timesyncd >/dev/null 2>&1 ) || true
fi

# --- Self-heal a masked/disabled timer (mirror of Enable-ScheduledTask) -----
# systemd can leave the timer inactive after a bad boot or a manual mask.
# Runs BEFORE any check that could exit, so a manual invocation self-heals.
if ! $DRY_RUN && command -v systemctl >/dev/null 2>&1; then
  if systemctl list-unit-files "${UNIT_NAME}.timer" >/dev/null 2>&1; then
    state="$(systemctl is-enabled "${UNIT_NAME}.timer" 2>/dev/null || true)"
    if [ "$state" = "masked" ] || [ "$state" = "disabled" ]; then
      systemctl unmask "${UNIT_NAME}.timer" >/dev/null 2>&1 || true
      systemctl enable --now "${UNIT_NAME}.timer" >/dev/null 2>&1 || true
    fi
    systemctl is-active "${UNIT_NAME}.timer" >/dev/null 2>&1 \
      || systemctl start "${UNIT_NAME}.timer" >/dev/null 2>&1 || true
  fi
fi

# --- Task heartbeat: snapshot the systemd unit state (update_task.json) ------
# The container can't query systemd directly, so snapshot the service/timer
# unit here where /api/admin/deploy/health can read it. This catches the
# failure mode the plain heartbeat can't: the unit reporting a non-zero exit
# even when a run still wrote a heartbeat.
write_task_heartbeat() {
  $DRY_RUN && return 0
  command -v systemctl >/dev/null 2>&1 || return 0
  local svc="${UNIT_NAME}.service" tmr="${UNIT_NAME}.timer"
  local exec_status result last_run next_run n_restarts active
  exec_status="$(systemctl show "$svc" -p ExecMainStatus --value 2>/dev/null || echo '')"
  result="$(systemctl show "$svc" -p Result --value 2>/dev/null || echo '')"
  n_restarts="$(systemctl show "$svc" -p NRestarts --value 2>/dev/null || echo '')"
  last_run="$(systemctl show "$svc" -p ExecMainExitTimestamp --value 2>/dev/null || echo '')"
  active="$(systemctl is-active "$svc" 2>/dev/null || echo 'unknown')"
  next_run="$(systemctl show "$tmr" -p NextElapseUSecRealtime --value 2>/dev/null || echo '')"
  {
    printf '{'
    printf '"written_at":"%s",'       "$TS"
    printf '"unit":"%s",'             "$svc"
    printf '"active_state":"%s",'     "${active:-unknown}"
    printf '"result":"%s",'           "${result:-}"
    printf '"exec_main_status":"%s",' "${exec_status:-}"
    printf '"n_restarts":"%s",'       "${n_restarts:-}"
    printf '"last_run":"%s",'         "${last_run:-}"
    printf '"next_run":"%s"'          "${next_run:-}"
    printf '}\n'
  } > "$TASK_HEARTBEAT" 2>/dev/null || true
}
write_task_heartbeat

# --- Cohort validation ------------------------------------------------------
if [ "$COHORT" != "canary" ] && [ "$COHORT" != "production" ]; then
  log "ABORT: unknown ZIGGY_COHORT='$COHORT' (expected 'canary' or 'production')"
  exit 1
fi

# --- Last-good SHA from deploy_log (for rollback) ---------------------------
# Walk the log backwards. Within a block: verified:true AND not kind:rollback
# AND a new:<sha> => that's the last good forward deploy.
get_last_verified_sha() {
  [ -f "$DEPLOY_LOG" ] || { echo ""; return 0; }
  awk '
    BEGIN { sha=""; }
    { lines[NR]=$0 }
    END {
      verified=0; nonrollback=1;
      for (i=NR; i>=1; i--) {
        line=lines[i];
        gsub(/^[ \t]+|[ \t]+$/, "", line);
        if (line == "---") { verified=0; nonrollback=1; continue }
        if (line ~ /^kind:[ \t]*rollback/) { nonrollback=0; continue }
        if (line ~ /^verified:[ \t]*/) {
          v=line; sub(/^verified:[ \t]*/, "", v);
          if (v == "True" || v == "true") verified=1;
          continue
        }
        if (verified && nonrollback && line ~ /^new:[ \t]*[0-9a-f]{7,40}/) {
          s=line; sub(/^new:[ \t]*/, "", s); sub(/[ \t].*$/, "", s);
          print s; exit
        }
      }
    }
  ' "$DEPLOY_LOG"
}

# --- Dirty-tree auto-stash (never freeze the loop on a stray edit) ----------
# The mini PC should never have local edits, but if it does we stash them with
# a timestamp and keep polling rather than aborting every cycle forever.
dirty="$(git status --porcelain --untracked-files=no 2>/dev/null || true)"
if [ -n "$dirty" ]; then
  if $DRY_RUN; then
    log "[dry-run] working tree dirty -- would auto-stash and continue"
  else
    log "Working tree dirty -- auto-stashing as 'auto-stash-$TS' and continuing"
    printf '%s\n' "$dirty" | sed 's/^/  /' >> "$UPDATE_LOG"
    if ! git stash push -u -m "auto-stash-$TS" >>"$UPDATE_LOG" 2>&1; then
      heartbeat "abort-stash-failed"
      log "ABORT: git stash push failed. Manual cleanup required."
      exit 1
    fi
  fi
fi

# --- Fetch + resolve target ref --------------------------------------------
if $DRY_RUN; then
  log "[dry-run] would: git fetch --prune --tags origin"
else
  if ! git fetch --prune --tags origin >>"$UPDATE_LOG" 2>&1; then
    heartbeat "abort-fetch-failed"
    log "ABORT: git fetch failed"
    exit 1
  fi
fi

GIT_SHA="$(git rev-parse HEAD 2>/dev/null | tr -d '[:space:]')"

TARGET_TAG=""
if [ "$COHORT" = "production" ]; then
  TARGET_TAG="$(git for-each-ref --sort=-creatordate --format='%(refname:short)' 'refs/tags/release-*' 2>/dev/null | head -n1 | tr -d '[:space:]')"
  if [ -z "$TARGET_TAG" ]; then
    # No release tag yet — production homes wait silently.
    heartbeat "idle no-release-tag git=$GIT_SHA"
    exit 0
  fi
  REMOTE_SHA="$(git rev-parse "refs/tags/$TARGET_TAG" 2>/dev/null | tr -d '[:space:]')"
  TARGET_DESC="tag $TARGET_TAG"
else
  REMOTE_SHA="$(git rev-parse origin/main 2>/dev/null | tr -d '[:space:]')"
  TARGET_DESC="origin/main"
fi

# --- Query running container SHA (authoritative: docker inspect env) --------
get_container_sha() {
  local out sha
  out="$(docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null || true)"
  if [ -n "$out" ]; then
    sha="$(printf '%s\n' "$out" | sed -n 's/^ZIGGY_GIT_SHA=\([0-9a-f]\{7,40\}\).*/\1/p' | head -n1)"
    [ -n "$sha" ] && { echo "$sha"; return 0; }
  fi
  # Fallback: HTTP probe (matches update.ps1's fallback).
  local i resp
  for i in 1 2 3; do
    resp="$(curl -fsS --max-time 5 "$API_URL/api/version" 2>/dev/null || true)"
    sha="$(printf '%s' "$resp" | sed -n 's/.*"git_sha"[ ]*:[ ]*"\([0-9a-f]\{7,40\}\)".*/\1/p' | head -n1)"
    [ -n "$sha" ] && { echo "$sha"; return 0; }
    sleep 2
  done
  echo "unknown"
}
CONTAINER_SHA="$(get_container_sha)"

# --- Infra image sync (controlled channel), gated to a slow cadence ---------
# Keeps HA / Z2M / Mosquitto on OPERATOR-CONTROLLED pins rather than chasing
# :latest on every 2-minute tick. Generates a compose override from the pins
# in /etc/ziggy/ziggy.env and pulls + recreates only the changed services.
maybe_sync_infra() {
  [ "$INFRA_CHANNEL" = "off" ] && return 0
  # Only pinned refs are pulled on the controlled channel. If nothing is
  # pinned there is nothing to control — leave compose defaults untouched.
  if [ -z "${ZIGGY_HA_IMAGE:-}" ] && [ -z "${ZIGGY_Z2M_IMAGE:-}" ] && [ -z "${ZIGGY_MOSQUITTO_IMAGE:-}" ]; then
    return 0
  fi
  # Cadence gate (unless --infra forces it).
  if ! $FORCE_INFRA && [ -f "$INFRA_MARKER" ]; then
    local last now age_h
    last="$(cat "$INFRA_MARKER" 2>/dev/null || echo 0)"
    now="$(date +%s)"
    case "$last" in ''|*[!0-9]*) last=0 ;; esac
    age_h=$(( (now - last) / 3600 ))
    [ "$age_h" -lt "$INFRA_INTERVAL_HOURS" ] && return 0
  fi

  # (Re)generate the pin override. Only include services that are pinned.
  {
    echo "# Generated by ziggy-update.sh -- infra image pins ($TS). Do not edit."
    echo "services:"
    [ -n "${ZIGGY_MOSQUITTO_IMAGE:-}" ] && { echo "  mosquitto:";     echo "    image: ${ZIGGY_MOSQUITTO_IMAGE}"; }
    [ -n "${ZIGGY_HA_IMAGE:-}" ]        && { echo "  homeassistant:"; echo "    image: ${ZIGGY_HA_IMAGE}"; }
    [ -n "${ZIGGY_Z2M_IMAGE:-}" ]       && { echo "  zigbee2mqtt:";   echo "    image: ${ZIGGY_Z2M_IMAGE}"; }
  } > "$INFRA_OVERRIDE"

  local svcs=()
  [ -n "${ZIGGY_MOSQUITTO_IMAGE:-}" ] && svcs+=("mosquitto")
  [ -n "${ZIGGY_HA_IMAGE:-}" ]        && svcs+=("homeassistant")
  [ -n "${ZIGGY_Z2M_IMAGE:-}" ]       && svcs+=("zigbee2mqtt")

  if $DRY_RUN; then
    log "[dry-run] would sync infra images (channel=$INFRA_CHANNEL): ${svcs[*]}"
    return 0
  fi

  log "Infra channel=$INFRA_CHANNEL: pulling pinned images: ${svcs[*]}"
  local ilog="$DEPLOY_LOGS_DIR/${TS//:/-}-infra.log"
  if dc -f docker-compose.yml -f "$INFRA_OVERRIDE" pull "${svcs[@]}" >>"$ilog" 2>&1; then
    dc -f docker-compose.yml -f "$INFRA_OVERRIDE" up -d --no-deps "${svcs[@]}" >>"$ilog" 2>&1 || \
      log "WARNING: infra 'up -d' returned non-zero. See $ilog"
  else
    log "WARNING: infra image pull failed. See $ilog (Ziggy deploy continues)."
  fi
  date +%s > "$INFRA_MARKER"
}

# --- deploy_log rotation ----------------------------------------------------
# Keep the breadcrumb file bounded: retain the last N '---' blocks.
rotate_deploy_log() {
  $DRY_RUN && return 0
  [ -f "$DEPLOY_LOG" ] || return 0
  local blocks
  blocks="$(grep -c '^---$' "$DEPLOY_LOG" 2>/dev/null || echo 0)"
  [ "$blocks" -le "$DEPLOYLOG_MAX_ENTRIES" ] && return 0
  local keep_from
  keep_from=$(( blocks - DEPLOYLOG_MAX_ENTRIES + 1 ))
  awk -v keep="$keep_from" '
    /^---$/ { n++ }
    { if (n >= keep) print }
  ' "$DEPLOY_LOG" > "$DEPLOY_LOG.tmp" && mv "$DEPLOY_LOG.tmp" "$DEPLOY_LOG"
}

# --- Post-deploy verify: poll /api/version up to ~60s -----------------------
verify_sha() {
  local want="$1" i resp got
  sleep 3
  for i in $(seq 1 30); do
    resp="$(curl -fsS --max-time 3 "$API_URL/api/version" 2>/dev/null || true)"
    got="$(printf '%s' "$resp" | sed -n 's/.*"git_sha"[ ]*:[ ]*"\([0-9a-f]\{7,40\}\)".*/\1/p' | head -n1)"
    [ "$got" = "$want" ] && return 0
    sleep 2
  done
  return 1
}

# --- Build + restart ONLY the ziggy service ---------------------------------
build_ziggy() {
  local sha="$1" blog="$2"
  # --no-cache --pull: never let a layer cache resurrect an old bundle; always
  # refresh the base image. ~30s extra per deploy, worth it vs a stale frontend.
  GIT_SHA="$sha" dc build --no-cache --pull ziggy >>"$blog" 2>&1 || return 1
  GIT_SHA="$sha" dc up -d --no-deps ziggy >>"$blog" 2>&1 || return 1
  return 0
}

# --- Steady state: nothing to do -------------------------------------------
if [ "$GIT_SHA" = "$REMOTE_SHA" ] && [ "$CONTAINER_SHA" = "$REMOTE_SHA" ]; then
  # Even in steady state, the controlled infra channel may be due.
  maybe_sync_infra
  heartbeat "idle git=$GIT_SHA"
  exit 0
fi

log "Update needed [cohort=$COHORT target=$TARGET_DESC]: git=$GIT_SHA remote=$REMOTE_SHA container=$CONTAINER_SHA"

if $DRY_RUN; then
  log "[dry-run] would verify signed tag (if required), checkout/reset to $REMOTE_SHA, rebuild ziggy, verify /api/version, rollback on failure."
  maybe_sync_infra
  exit 0
fi

# --- Optional GPG signed-tag verification (production only) -----------------
if [ "$COHORT" = "production" ] && [ "$REQUIRE_SIGNED" = "true" ]; then
  if ! git verify-tag "$TARGET_TAG" >>"$UPDATE_LOG" 2>&1; then
    heartbeat "abort-unsigned-tag $TARGET_TAG"
    log "ABORT: git verify-tag $TARGET_TAG failed -- unsigned or untrusted key. Staying on $GIT_SHA."
    exit 1
  fi
  log "Tag $TARGET_TAG verified against trusted key."
fi

DEPLOY_VERBOSE="$DEPLOY_LOGS_DIR/${TS//:/-}-build.log"

# --- Pull / checkout target -------------------------------------------------
if [ "$GIT_SHA" != "$REMOTE_SHA" ]; then
  if [ "$COHORT" = "production" ]; then
    log "Checking out $TARGET_TAG ($REMOTE_SHA)"
    if ! git -c advice.detachedHead=false checkout "refs/tags/$TARGET_TAG" >>"$DEPLOY_VERBOSE" 2>&1; then
      heartbeat "abort-checkout-failed"
      log "ABORT: git checkout of tag failed. See $DEPLOY_VERBOSE"
      exit 1
    fi
  else
    # fetch + reset --hard is unambiguous: HEAD AND working tree both land on
    # origin/main, every tracked file regenerated. Untracked files preserved.
    log "Force-syncing $GIT_SHA -> $REMOTE_SHA (reset --hard origin/main)"
    if ! git reset --hard origin/main >>"$DEPLOY_VERBOSE" 2>&1; then
      heartbeat "abort-reset-failed"
      log "ABORT: git reset --hard origin/main failed. See $DEPLOY_VERBOSE"
      exit 1
    fi
  fi
  GIT_SHA="$(git rev-parse HEAD | tr -d '[:space:]')"
fi

# --- Build + restart --------------------------------------------------------
log "Rebuilding ziggy at $GIT_SHA (build log: $DEPLOY_VERBOSE)"
if ! build_ziggy "$GIT_SHA" "$DEPLOY_VERBOSE"; then
  heartbeat "build-failed $GIT_SHA"
  log "FAILED: docker compose build/up for ziggy at $GIT_SHA. Previous container still running. See $DEPLOY_VERBOSE"
  exit 1
fi

# --- Controlled infra image sync (after Ziggy is up) ------------------------
maybe_sync_infra

# --- Verify -----------------------------------------------------------------
if verify_sha "$GIT_SHA"; then
  {
    echo "---"
    echo "ts:        $TS"
    echo "cohort:    $COHORT"
    echo "target:    $TARGET_DESC"
    echo "old:       $CONTAINER_SHA"
    echo "new:       $GIT_SHA"
    echo "verified:  True"
  } >> "$DEPLOY_LOG"
  rotate_deploy_log
  heartbeat "deployed $GIT_SHA"
  log "Deploy complete: $CONTAINER_SHA -> $GIT_SHA"
  exit 0
fi

# Record the failed forward attempt before rolling back.
{
  echo "---"
  echo "ts:        $TS"
  echo "cohort:    $COHORT"
  echo "target:    $TARGET_DESC"
  echo "old:       $CONTAINER_SHA"
  echo "new:       $GIT_SHA"
  echo "verified:  False"
} >> "$DEPLOY_LOG"

# =============================================================================
# AUTO-ROLLBACK
# =============================================================================
log "WARNING: post-deploy /api/version did not return $GIT_SHA within ~60s. Rolling back."

LAST_GOOD_SHA="$(get_last_verified_sha | tr -d '[:space:]')"
if [ -z "$LAST_GOOD_SHA" ] || [ "$LAST_GOOD_SHA" = "$GIT_SHA" ]; then
  heartbeat "rollback-skipped bad=$GIT_SHA"
  log "ROLLBACK SKIPPED: no prior verified SHA in deploy_log. Check 'docker compose logs ziggy'."
  exit 1
fi

log "ROLLBACK: $GIT_SHA -> $LAST_GOOD_SHA (last verified deploy)"
RB_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
RB_VERBOSE="$DEPLOY_LOGS_DIR/${RB_TS//:/-}-rollback.log"

if ! git -c advice.detachedHead=false checkout "$LAST_GOOD_SHA" >>"$RB_VERBOSE" 2>&1; then
  heartbeat "rollback-checkout-failed last=$LAST_GOOD_SHA"
  log "ROLLBACK FAILED: git checkout $LAST_GOOD_SHA did not succeed. See $RB_VERBOSE"
  exit 1
fi

if ! build_ziggy "$LAST_GOOD_SHA" "$RB_VERBOSE"; then
  heartbeat "rollback-build-failed last=$LAST_GOOD_SHA"
  log "ROLLBACK FAILED: rebuild at $LAST_GOOD_SHA failed. See $RB_VERBOSE"
  exit 1
fi

if verify_sha "$LAST_GOOD_SHA"; then RB_OK=True; else RB_OK=False; fi
{
  echo "---"
  echo "ts:        $RB_TS"
  echo "cohort:    $COHORT"
  echo "kind:      rollback"
  echo "old:       $GIT_SHA"
  echo "new:       $LAST_GOOD_SHA"
  echo "verified:  $RB_OK"
} >> "$DEPLOY_LOG"
rotate_deploy_log

if [ "$RB_OK" = "True" ]; then
  heartbeat "rolledback to=$LAST_GOOD_SHA bad=$GIT_SHA"
  log "ROLLBACK complete: now running $LAST_GOOD_SHA. INVESTIGATE the bad deploy at $GIT_SHA."
  exit 1
else
  heartbeat "rollback-verify-failed last=$LAST_GOOD_SHA"
  log "ROLLBACK applied but $LAST_GOOD_SHA also failed /api/version verify. Manual intervention required."
  exit 1
fi
