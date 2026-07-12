#!/usr/bin/env bash
# =============================================================================
# connectivity-check.sh — boot-time "am I online?" gate for Wi-Fi onboarding.
#
# Polls NetworkManager connectivity (and the default route) for up to
# --timeout seconds. Exit 0 == online within the window; exit 1 == still
# offline (the caller, wifi-onboard.sh, then starts AP onboarding mode).
#
# Designed to run WITHOUT real hardware: point ZIGGY_NMCLI_BIN at a mock, or
# set ZIGGY_WIFI_DRYRUN=1 to force the "offline" verdict for plan testing.
#
#   connectivity-check.sh                 # wait up to 45s for connectivity
#   connectivity-check.sh --timeout 20    # custom window (seconds)
#   connectivity-check.sh --once          # single probe, no waiting
#   ZIGGY_WIFI_DRYRUN=1 connectivity-check.sh   # always reports offline
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=nmcli-helpers.sh
. "$SCRIPT_DIR/nmcli-helpers.sh"
LOG_COMPONENT="conn-check"

TIMEOUT="${ZIGGY_CONNECTIVITY_TIMEOUT:-45}"
INTERVAL="${ZIGGY_CONNECTIVITY_INTERVAL:-3}"
ONCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --timeout)  TIMEOUT="${2:?--timeout needs seconds}"; shift 2 ;;
    --interval) INTERVAL="${2:?--interval needs seconds}"; shift 2 ;;
    --once)     ONCE=1; shift ;;
    -h|--help)  grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//' | head -20; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

probe_online() {
  if nm_is_online; then return 0; fi
  if has_default_route; then return 0; fi
  return 1
}

# Dry-run is always "offline" (so the plan exercises the AP path) — never wait.
if [ "$ZIGGY_WIFI_DRYRUN" = "1" ]; then ONCE=1; fi

if [ "$ONCE" = "1" ]; then
  if probe_online; then log_info "online (single probe)"; exit 0; fi
  log_info "offline (single probe)"; exit 1
fi

log_info "waiting up to ${TIMEOUT}s for connectivity (interval ${INTERVAL}s)"
deadline=$(( $(date +%s) + TIMEOUT ))
while :; do
  if probe_online; then
    log_info "online"
    exit 0
  fi
  now=$(date +%s)
  if [ "$now" -ge "$deadline" ]; then
    log_warn "still offline after ${TIMEOUT}s — onboarding needed"
    exit 1
  fi
  sleep "$INTERVAL"
done
