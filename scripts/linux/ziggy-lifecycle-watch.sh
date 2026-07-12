#!/usr/bin/env bash
# =============================================================================
# ziggy-lifecycle-watch.sh — root-owned spool consumer for lifecycle intents.
#
# This is the missing bridge between the app and the host: Stream 5's
# lifecycle_router.py writes an atomic intent file into the lifecycle spool dir,
# and this watcher (triggered by ziggy-lifecycle.path, run by
# ziggy-lifecycle.service as root, one-shot) consumes each file and invokes the
# matching Stream 2 reset script.
#
# For each  <spool>/<action>.<uuid>.request.json  it:
#   1. parses .action, validates it ∈ {factory-reset, safe-mode, customer-reset}
#   2. runs the matching script with  --intent <file>  (which the scripts treat
#      as pre-authorized — no interactive --confirm needed), adding --dry-run
#      when intent.dry_run is true
#   3. archives the processed intent to <spool>/processed/ (renamed so it no
#      longer matches *.request.json and cannot re-trigger the path unit)
#
# Intent JSON schema (written by lifecycle_router.py):
#   {id, action, script, requested_by, requested_at, reason, dry_run}
#
# Spool dir: /var/lib/ziggy/lifecycle by default. If lifecycle_router.py is
# configured with a custom lifecycle.spool_dir, set ZIGGY_LIFECYCLE_SPOOL here
# AND update PathExistsGlob in ziggy-lifecycle.path to match.
#
#     sudo /opt/ziggy/scripts/linux/ziggy-lifecycle-watch.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZIGGY_ENV_FILE="${ZIGGY_ENV_FILE:-/etc/ziggy/ziggy.env}"
[ -f "$ZIGGY_ENV_FILE" ] && { set -a; . "$ZIGGY_ENV_FILE"; set +a; }
REPO_DIR="${ZIGGY_REPO_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
SPOOL_DIR="${ZIGGY_LIFECYCLE_SPOOL:-/var/lib/ziggy/lifecycle}"
PROCESSED_DIR="$SPOOL_DIR/processed"

# Log to /var/log/ziggy if writable, else fall back to repo user_files.
LOG_DIR="${ZIGGY_LOG_DIR:-/var/log/ziggy}"
if ! mkdir -p "$LOG_DIR" 2>/dev/null; then
  LOG_DIR="$REPO_DIR/user_files"
  mkdir -p "$LOG_DIR" 2>/dev/null || true
fi
LOG_FILE="$LOG_DIR/lifecycle-watch.log"

log() {
  local line
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ) [lifecycle-watch] $*"
  echo "$line"
  echo "$line" >> "$LOG_FILE" 2>/dev/null || true
}

# Strip CR/LF and other control chars so attacker-controlled intent fields
# (action, requested_by) cannot forge log lines via embedded newlines.
sanitize() { printf '%s' "$1" | tr -d '\000-\037\177'; }

# Max age (seconds) for an intent's requested_at before we treat it as
# stale/replayed and refuse it. Defense-in-depth on top of the spool-dir perms.
MAX_INTENT_AGE_S="${ZIGGY_INTENT_MAX_AGE_S:-600}"

# action -> script name (MUST stay in lockstep with LIFECYCLE_SCRIPTS in
# backend/routers/lifecycle_router.py).
script_for_action() {
  case "$1" in
    factory-reset)  echo "ziggy-factory-reset.sh" ;;
    safe-mode)      echo "ziggy-safe-mode.sh" ;;
    customer-reset) echo "ziggy-customer-reset.sh" ;;
    *)              echo "" ;;
  esac
}

# Extract one top-level field from an intent file (bools -> true/false).
ij() {  # $1=file  $2=field
  python3 -c $'import sys,json\ntry:\n d=json.load(open(sys.argv[1]))\nexcept Exception:\n sys.exit(0)\nv=d.get(sys.argv[2])\nif isinstance(v,bool): print("true" if v else "false")\nelif v is not None: print(v)' "$1" "$2" 2>/dev/null || true
}

if [ ! -d "$SPOOL_DIR" ]; then
  log "spool dir $SPOOL_DIR does not exist; nothing to do."
  exit 0
fi

mkdir -p "$PROCESSED_DIR" 2>/dev/null || true

shopt -s nullglob
found=0
for req in "$SPOOL_DIR"/*.request.json; do
  found=1
  base="$(basename "$req")"
  action="$(ij "$req" action)"
  id_field="$(ij "$req" id)"
  script_field="$(ij "$req" script)"
  requested_at="$(ij "$req" requested_at)"
  script_name="$(script_for_action "$action")"
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  safe_action="$(sanitize "$action")"

  # Schema check (defense-in-depth): a legit intent from lifecycle_router.py
  # always carries id + action + script. A file missing any of these is
  # malformed/foreign — refuse it before touching the allowlist.
  if [ -z "$id_field" ] || [ -z "$action" ] || [ -z "$script_field" ]; then
    log "REJECT $base: missing required intent fields (id/action/script present? id=$([ -n "$id_field" ] && echo y || echo n) action=$([ -n "$action" ] && echo y || echo n) script=$([ -n "$script_field" ] && echo y || echo n))"
    mv -f "$req" "$PROCESSED_DIR/${base}.${ts}.rejected" 2>/dev/null || rm -f "$req"
    continue
  fi

  if [ -z "$script_name" ]; then
    log "REJECT $base: invalid/unknown action '${safe_action:-<none>}'"
    mv -f "$req" "$PROCESSED_DIR/${base}.${ts}.rejected" 2>/dev/null || rm -f "$req"
    continue
  fi

  # Freshness check (defense-in-depth): refuse stale/replayed intents whose
  # requested_at is older than MAX_INTENT_AGE_S. Unparseable/absent timestamps
  # are not hard-failed (older intents predate this field), only clearly-old
  # ones are.
  if [ -n "$requested_at" ]; then
    ra_int="${requested_at%.*}"
    case "$ra_int" in
      ''|*[!0-9]*) : ;;  # not a plain epoch int — skip freshness gate
      *)
        now="$(date +%s)"
        age=$(( now - ra_int ))
        if [ "$age" -gt "$MAX_INTENT_AGE_S" ]; then
          log "REJECT $base: stale intent (age ${age}s > ${MAX_INTENT_AGE_S}s)"
          mv -f "$req" "$PROCESSED_DIR/${base}.${ts}.rejected" 2>/dev/null || rm -f "$req"
          continue
        fi
        ;;
    esac
  fi

  script_path="$SCRIPT_DIR/$script_name"
  if [ ! -x "$script_path" ] && [ ! -f "$script_path" ]; then
    log "REJECT $base: script $script_path not installed"
    mv -f "$req" "$PROCESSED_DIR/${base}.${ts}.rejected" 2>/dev/null || rm -f "$req"
    continue
  fi

  cmd=(bash "$script_path" --intent "$req")
  if [ "$(ij "$req" dry_run)" = "true" ]; then
    cmd+=(--dry-run)
  fi

  requested_by="$(sanitize "$(ij "$req" requested_by)")"
  log "RUN $base: action=$safe_action script=$script_name requested_by=${requested_by:-?} dry_run=$(ij "$req" dry_run)"

  # Run the reset script; capture rc but never let one bad intent abort the
  # whole batch (set -e is relaxed around the invocation).
  rc=0
  "${cmd[@]}" >>"$LOG_FILE" 2>&1 || rc=$?
  log "DONE $base: rc=$rc"

  # Archive (rename so it no longer matches *.request.json → won't re-trigger).
  mv -f "$req" "$PROCESSED_DIR/${base}.${ts}.done" 2>/dev/null || rm -f "$req"
done

[ "$found" -eq 0 ] && log "no pending *.request.json in $SPOOL_DIR"
exit 0
