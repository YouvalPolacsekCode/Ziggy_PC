#!/usr/bin/env bash
# =============================================================================
# install-systemd-units.sh — install + enable Ziggy's OTA lifecycle units.
#
# Installs into /etc/systemd/system:
#   ziggy.service             (brings the docker compose stack up on boot)
#   ziggy-update.service      (OTA deploy + rollback, one-shot)
#   ziggy-update.timer        (every 2 minutes, persistent)
#   ziggy-disk-guard.service  (log/image prune, recorder cap, one-shot)
#   ziggy-disk-guard.timer    (daily, persistent)
#   ziggy-lifecycle.service   (reset intent processor, root one-shot)
#   ziggy-lifecycle.path      (watches the lifecycle spool dir for intents)
#
# Rewrites the hardcoded /opt/ziggy paths to this repo's real location and
# (optionally) the User= line, so it works whether the repo lives at
# /opt/ziggy or elsewhere. Marks every scripts/linux/*.sh executable.
#
# Idempotent: re-running re-writes the units, reloads systemd, and re-enables
# the timers. Safe to run from Stream 1's cloud-init / image build.
#
#     sudo /opt/ziggy/scripts/linux/install-systemd-units.sh
#     sudo /opt/ziggy/scripts/linux/install-systemd-units.sh --user ziggy
#     sudo /opt/ziggy/scripts/linux/install-systemd-units.sh --dry-run
#     sudo /opt/ziggy/scripts/linux/install-systemd-units.sh --uninstall
# =============================================================================
set -euo pipefail

RUN_USER="root"
DRY_RUN=false
UNINSTALL=false
NO_START=false
while [ $# -gt 0 ]; do
  case "$1" in
    --user)       RUN_USER="${2:?--user needs a value}"; shift 2 ;;
    --dry-run)    DRY_RUN=true; shift ;;
    --uninstall)  UNINSTALL=true; shift ;;
    --no-start)   NO_START=true; shift ;;
    -h|--help)    grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//' | head -30; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${ZIGGY_REPO_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
SYSTEMD_DIR="/etc/systemd/system"
UNITS=(ziggy.service \
       ziggy-update.service ziggy-update.timer ziggy-disk-guard.service ziggy-disk-guard.timer \
       ziggy-lifecycle.service ziggy-lifecycle.path)
# Directly-enabled services (WantedBy=multi-user.target). ziggy.service brings
# the compose stack up on boot; enabling it is what makes a fresh image run.
SERVICES=(ziggy.service)
TIMERS=(ziggy-update.timer ziggy-disk-guard.timer)
# .path units are enabled like timers (they drive their .service on a trigger).
PATHS=(ziggy-lifecycle.path)
# Lifecycle spool dir the app writes reset intents into (root watcher consumes).
LIFECYCLE_SPOOL="${ZIGGY_LIFECYCLE_SPOOL:-/var/lib/ziggy/lifecycle}"

# Execute an argv array directly (NO eval) so env-derived values (REPO_DIR,
# LIFECYCLE_SPOOL, …) can never inject shell metacharacters. Callers pass the
# command + args as separate words; globs/quoting are resolved by the caller's
# shell before run() is invoked.
run() { if $DRY_RUN; then echo "[dry-run] $*"; else "$@"; fi; }
# Best-effort variant: swallow output and never fail the script (replaces the
# old  '… >/dev/null 2>&1 || true'  strings that used to ride through eval).
run_quiet() { if $DRY_RUN; then echo "[dry-run] $*"; else "$@" >/dev/null 2>&1 || true; fi; }

if [ "$(id -u)" -ne 0 ] && ! $DRY_RUN; then
  echo "ERROR: must run as root (writes $SYSTEMD_DIR, reloads systemd)." >&2
  exit 1
fi
if ! command -v systemctl >/dev/null 2>&1; then
  if $DRY_RUN; then
    echo "NOTE: systemctl not found (non-systemd host) — dry-run continues for validation."
  else
    echo "ERROR: systemctl not found — this installer targets systemd hosts." >&2
    exit 1
  fi
fi

# --- Uninstall path ---------------------------------------------------------
if $UNINSTALL; then
  echo "Uninstalling Ziggy systemd units..."
  # Disable timers/paths and the stack service. `disable --now` on ziggy.service
  # runs its ExecStop (docker compose down), tearing the stack down cleanly.
  for t in "${SERVICES[@]}" "${TIMERS[@]}" "${PATHS[@]}"; do
    run_quiet systemctl disable --now "$t"
  done
  run_quiet systemctl stop ziggy-update.service
  run_quiet systemctl stop ziggy-disk-guard.service
  run_quiet systemctl stop ziggy-lifecycle.service
  for u in "${UNITS[@]}"; do
    run rm -f "$SYSTEMD_DIR/$u"
  done
  run systemctl daemon-reload
  echo "Uninstalled. (Scripts + repo left in place.)"
  exit 0
fi

echo "Installing Ziggy OTA lifecycle units"
echo "  repo:  $REPO_DIR"
echo "  user:  $RUN_USER"
echo "  dest:  $SYSTEMD_DIR"

# --- Make scripts executable ------------------------------------------------
run chmod +x "$SCRIPT_DIR"/*.sh

# --- Install each unit, rewriting paths + User ------------------------------
# esc_repo also escapes '#' because it lands in the s#…#…#g rewrite below where
# '#' is the delimiter; without it a '#' in REPO_DIR would break/inject the sed.
esc_repo="$(printf '%s' "$REPO_DIR" | sed 's/[&#/\]/\\&/g')"
esc_user="$(printf '%s' "$RUN_USER" | sed 's/[&/\]/\\&/g')"
for u in "${UNITS[@]}"; do
  src="$SCRIPT_DIR/$u"
  dst="$SYSTEMD_DIR/$u"
  if [ ! -f "$src" ]; then echo "ERROR: missing $src" >&2; exit 1; fi
  if $DRY_RUN; then
    echo "[dry-run] install $src -> $dst (repo=$REPO_DIR user=$RUN_USER)"
  else
    sed -e "s#/opt/ziggy#${esc_repo}#g" \
        -e "s/^User=root/User=${esc_user}/" \
        "$src" > "$dst"
    chmod 0644 "$dst"
    echo "  installed $dst"
  fi
done

# --- Lifecycle spool dir ----------------------------------------------------
# The unprivileged app writes reset intents here; the root watcher reads +
# deletes them. Group-writable so the 'ziggy' user can queue and root can
# consume (mirrors the WIRING note in backend/routers/lifecycle_router.py).
if id -u ziggy >/dev/null 2>&1; then
  run install -d -o ziggy -g root -m 0770 "$LIFECYCLE_SPOOL"
else
  run install -d -m 0770 "$LIFECYCLE_SPOOL"
  $DRY_RUN || echo "  NOTE: 'ziggy' user not found — spool $LIFECYCLE_SPOOL left root-owned; chown to the app user if it runs unprivileged."
fi

# --- Reload + enable --------------------------------------------------------
# Enable order: bring the stack service up first (so the OTA loop has a running
# stack to update), then the timers/paths. All idempotent.
run systemctl daemon-reload
for t in "${SERVICES[@]}" "${TIMERS[@]}" "${PATHS[@]}"; do
  if $NO_START; then
    run_quiet systemctl enable "$t"
    echo "  enabled $t (not started; --no-start)"
  else
    run systemctl enable --now "$t"
    echo "  enabled + started $t"
  fi
done

echo
echo "Done. Verify with:"
echo "  systemctl status ziggy.service"
echo "  docker compose -f /opt/ziggy/docker-compose.yml -f /opt/ziggy/docker-compose.prod.yml ps"
echo "  systemctl list-timers 'ziggy-*'"
echo "  systemctl status ziggy-update.timer ziggy-disk-guard.timer"
echo "  journalctl -u ziggy-update.service -n 50 --no-pager"
