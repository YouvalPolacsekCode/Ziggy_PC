#!/usr/bin/env bash
# =============================================================================
# ziggy-ota-recover.sh — diagnose and recover a stuck Ziggy Linux OTA loop.
#
# Linux port of scripts/ota-recover.ps1. When /health reports ota.status=silent
# (>2h since last verified deploy), something has broken the ziggy-update.timer's
# ability to progress origin/main -> running container.
#
# Prints EVERYTHING you need in one screen:
#   * Repo HEAD vs origin/main + how many commits behind/ahead
#   * ziggy-update.service/.timer unit state (result, last/next run, restarts)
#   * update.heartbeat mtime + status
#   * update_task.json (systemd snapshot from ziggy-update.sh)
#   * Last 30 lines of update.log + last 3 deploy_log blocks
#   * git stash list (an accidental stash storm is a common cause)
#   * Disk free on the repo filesystem + Docker daemon/service state
#
# With --fix it also attempts SAFE recoveries:
#   * systemctl unmask/enable/start a masked or disabled timer
#   * Prune git stashes older than 7 days
#   * Kick one manual ziggy-update.sh run and stream its output
#
# Read-only without --fix. Run from anywhere; autolocates the repo root.
#     sudo /opt/ziggy/scripts/linux/ziggy-ota-recover.sh
#     sudo /opt/ziggy/scripts/linux/ziggy-ota-recover.sh --fix
# =============================================================================
set -uo pipefail   # NOT -e: this is a diagnostic; individual probes may fail.

FIX=false
for arg in "$@"; do
  case "$arg" in
    --fix) FIX=true ;;
    -h|--help) grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//' | head -40; exit 0 ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZIGGY_ENV_FILE="${ZIGGY_ENV_FILE:-/etc/ziggy/ziggy.env}"
[ -f "$ZIGGY_ENV_FILE" ] && { set -a; . "$ZIGGY_ENV_FILE"; set +a; }
REPO_DIR="${ZIGGY_REPO_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
API_URL="${ZIGGY_API_URL:-http://127.0.0.1:8001}"
cd "$REPO_DIR"

USER_FILES="$REPO_DIR/user_files"
UPDATE_LOG="$USER_FILES/update.log"
DEPLOY_LOG="$USER_FILES/deploy_log"
HEARTBEAT="$USER_FILES/update.heartbeat"
TASK_HEARTBEAT="$USER_FILES/update_task.json"
SVC="ziggy-update.service"
TMR="ziggy-update.timer"

# --- colours (fall back to plain if not a tty) ------------------------------
if [ -t 1 ]; then C='\033[36m'; Y='\033[33m'; R='\033[31m'; G='\033[32m'; W='\033[37m'; Z='\033[0m'
else C=''; Y=''; R=''; G=''; W=''; Z=''; fi
section() { printf '\n'"${C}"'==== %s ===='"${Z}"'\n' "$1"; }
warn()    { printf "${Y}"'WARN: %s'"${Z}"'\n' "$1"; }
good()    { printf "${G}"'OK: %s'"${Z}"'\n' "$1"; }

now_epoch="$(date +%s)"
printf "${W}"'Ziggy OTA recovery (%s)'"${Z}"'\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Repo: $REPO_DIR"
echo "Mode: $([ "$FIX" = true ] && echo 'FIX (safe recoveries enabled)' || echo 'READ-ONLY (rerun with --fix)')"

# ---------------------------------------------------------------------------
# 1. Repo state
# ---------------------------------------------------------------------------
section "Repo state"
HEAD="$(git rev-parse HEAD 2>/dev/null || echo '?')"
echo "HEAD: $HEAD"
git log --oneline -3 2>/dev/null | sed 's/^/  /'

echo
echo "Fetching origin (read-only)..."
if git fetch --prune origin >/dev/null 2>&1; then good "git fetch succeeded"
else warn "git fetch failed. Network or auth broken."; fi

MAIN_SHA="$(git rev-parse origin/main 2>/dev/null || echo '?')"
echo "origin/main: $MAIN_SHA"
BEHIND="$(git rev-list --count HEAD..origin/main 2>/dev/null || echo '?')"
AHEAD="$(git rev-list --count origin/main..HEAD 2>/dev/null || echo '?')"
echo "HEAD is $BEHIND commit(s) behind, $AHEAD commit(s) ahead"

echo
echo "Working tree status (tracked):"
git status --porcelain --untracked-files=no 2>&1 | sed 's/^/  /'
DIRTY="$(git status --porcelain --untracked-files=no 2>/dev/null)"
[ -n "$DIRTY" ] && warn "tracked files modified — ziggy-update.sh will auto-stash next run"

echo
echo "Stash list (newest first):"
STASHES="$(git stash list 2>/dev/null)"
if [ -n "$STASHES" ]; then printf '%s\n' "$STASHES" | sed 's/^/  /'; else echo "  (none)"; fi
STASH_COUNT="$(printf '%s\n' "$STASHES" | grep -c 'stash@' 2>/dev/null || echo 0)"
[ "$STASH_COUNT" -gt 20 ] && warn "$STASH_COUNT stashes accumulated — a bug may be auto-stashing every cycle"

# ---------------------------------------------------------------------------
# 2. systemd unit state
# ---------------------------------------------------------------------------
section "ziggy-update units"
if command -v systemctl >/dev/null 2>&1; then
  for u in "$SVC" "$TMR"; do
    if systemctl list-unit-files "$u" >/dev/null 2>&1; then
      printf '  %-24s active=%s enabled=%s result=%s\n' "$u" \
        "$(systemctl is-active "$u" 2>/dev/null || echo '?')" \
        "$(systemctl is-enabled "$u" 2>/dev/null || echo '?')" \
        "$(systemctl show "$u" -p Result --value 2>/dev/null || echo '?')"
    else
      warn "$u not installed — run install-systemd-units.sh"
    fi
  done
  echo "Service last exit status : $(systemctl show "$SVC" -p ExecMainStatus --value 2>/dev/null || echo '?')"
  echo "Service last run         : $(systemctl show "$SVC" -p ExecMainExitTimestamp --value 2>/dev/null || echo '(never)')"
  echo "Service NRestarts        : $(systemctl show "$SVC" -p NRestarts --value 2>/dev/null || echo '?')"
  echo "Timer next elapse        : $(systemctl show "$TMR" -p NextElapseUSecRealtime --value 2>/dev/null || echo '?')"

  TMR_STATE="$(systemctl is-enabled "$TMR" 2>/dev/null || echo 'unknown')"
  if [ "$TMR_STATE" = "masked" ] || [ "$TMR_STATE" = "disabled" ]; then
    warn "timer is $TMR_STATE — this is almost certainly why OTA is stuck"
    if [ "$FIX" = true ]; then
      systemctl unmask "$TMR" >/dev/null 2>&1
      if systemctl enable --now "$TMR" >/dev/null 2>&1; then good "timer re-enabled + started"
      else warn "enable failed (need root?)"; fi
    fi
  elif ! systemctl is-active "$TMR" >/dev/null 2>&1; then
    warn "timer enabled but not active"
    [ "$FIX" = true ] && { systemctl start "$TMR" >/dev/null 2>&1 && good "timer started"; }
  fi
else
  warn "systemctl not available on this host"
fi

# ---------------------------------------------------------------------------
# 3. Heartbeat files
# ---------------------------------------------------------------------------
section "Heartbeat files"
if [ -f "$HEARTBEAT" ]; then
  hb_mtime="$(stat -c %Y "$HEARTBEAT" 2>/dev/null || stat -f %m "$HEARTBEAT" 2>/dev/null || echo "$now_epoch")"
  age=$(( now_epoch - hb_mtime ))
  echo "update.heartbeat age: ${age}s"
  echo "update.heartbeat: $(tr -d '\n' < "$HEARTBEAT")"
  if [ "$age" -gt 900 ]; then warn "heartbeat is stale (>15 min) — no recent cycle"; else good "heartbeat is fresh"; fi
else
  warn "update.heartbeat missing — ziggy-update.sh has never run cleanly here"
fi
if [ -f "$TASK_HEARTBEAT" ]; then echo; echo "update_task.json:"; cat "$TASK_HEARTBEAT"; echo
else warn "update_task.json missing"; fi

# ---------------------------------------------------------------------------
# 4. Logs
# ---------------------------------------------------------------------------
section "update.log — last 30 lines"
[ -f "$UPDATE_LOG" ] && tail -n 30 "$UPDATE_LOG" || warn "update.log does not exist"

section "deploy_log — last 3 blocks"
if [ -f "$DEPLOY_LOG" ]; then
  awk 'BEGIN{RS="\n---\n"} NF{blocks[++n]=$0} END{for(i=(n>2?n-2:1);i<=n;i++){print "----"; print blocks[i]}}' "$DEPLOY_LOG"
else
  warn "deploy_log does not exist"
fi

# ---------------------------------------------------------------------------
# 5. Docker + disk
# ---------------------------------------------------------------------------
section "Docker state"
if systemctl is-active docker >/dev/null 2>&1; then good "docker.service active"
else warn "docker.service not active"; fi
if docker info --format '{{.ServerVersion}} on {{.OperatingSystem}}' 2>/dev/null; then
  good "docker daemon reachable"
else
  warn "docker info failed — daemon down or permission denied"
fi
echo
echo "docker compose ps:"
docker compose ps 2>&1 | head -n 20 | sed 's/^/  /'

section "Disk free"
df -h "$REPO_DIR" 2>/dev/null | sed 's/^/  /'
free_kb="$(df -Pk "$REPO_DIR" 2>/dev/null | awk 'NR==2{print $4}')"
if [ -n "${free_kb:-}" ]; then
  free_gb=$(( free_kb / 1024 / 1024 ))
  [ "$free_gb" -lt 5 ] && warn "less than 5 GB free (${free_gb}GB) — builds may fail on ENOSPC"
fi

# ---------------------------------------------------------------------------
# 6. --fix: prune old stashes + kick one manual cycle
# ---------------------------------------------------------------------------
if [ "$FIX" = true ]; then
  section "FIX: prune git stashes older than 7 days"
  cutoff=$(( now_epoch - 7*24*3600 ))
  pruned=0
  # Iterate newest-first indices; drop from highest index down so refs stay valid.
  mapfile -t stash_lines < <(git stash list --format='%gd %ct' 2>/dev/null | tac)
  for ln in "${stash_lines[@]}"; do
    ref="${ln%% *}"; ct="${ln##* }"
    case "$ct" in ''|*[!0-9]*) continue ;; esac
    if [ "$ct" -lt "$cutoff" ]; then
      git stash drop "$ref" >/dev/null 2>&1 && pruned=$(( pruned + 1 ))
    fi
  done
  good "pruned $pruned stash(es) older than 7 days"

  section "FIX: kick one manual ziggy-update.sh cycle"
  "$SCRIPT_DIR/ziggy-update.sh" || true
  echo
  NEW_HEAD="$(git rev-parse HEAD 2>/dev/null || echo '?')"
  echo "HEAD is now: $NEW_HEAD"
  [ "$NEW_HEAD" != "$HEAD" ] && good "HEAD moved from $HEAD to $NEW_HEAD" || warn "HEAD did not move — see update.log above"

  section "FIX: post-run container SHA"
  sleep 5
  ver="$(curl -fsS --max-time 10 "$API_URL/api/version" 2>/dev/null | sed -n 's/.*"git_sha"[ ]*:[ ]*"\([0-9a-f]\{7,40\}\)".*/\1/p' | head -n1)"
  if [ -n "$ver" ]; then
    echo "container /api/version: $ver"
    [ "$ver" = "$NEW_HEAD" ] && good "container matches HEAD — OTA loop recovered" || warn "container SHA != HEAD — verify loop still failing"
  else
    warn "could not reach $API_URL/api/version"
  fi
fi

section "Done"
[ "$FIX" = true ] || echo "Rerun with --fix to attempt recoveries (root required for timer re-enable)."
