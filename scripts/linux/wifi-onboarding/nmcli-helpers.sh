#!/usr/bin/env bash
# =============================================================================
# nmcli-helpers.sh — shared NetworkManager helpers for Wi-Fi onboarding.
#
# Sourced (never executed directly) by connectivity-check.sh and
# wifi-onboard.sh. Every nmcli call goes through run_nm(), which honours:
#   ZIGGY_NMCLI_BIN   path to the nmcli binary (default: nmcli). Point this at
#                     a mock in tests so nothing touches real Wi-Fi hardware.
#   ZIGGY_WIFI_DRYRUN when "1", run_nm() prints the argv and returns success
#                     WITHOUT invoking anything (no system mutation).
#
# All callers pass command words as separate argv elements — never a single
# shell string — so SSIDs / passwords can't inject shell metacharacters.
#
# Structured logging: log <LEVEL> <component> <message...>  → stderr, e.g.
#   2026-07-12T10:00:00Z [INFO ] wifi-onboard: AP up on wlan0
# =============================================================================

# Guard against double-sourcing.
if [ -n "${_ZIGGY_NMCLI_HELPERS_LOADED:-}" ]; then return 0 2>/dev/null || true; fi
_ZIGGY_NMCLI_HELPERS_LOADED=1

NMCLI_BIN="${ZIGGY_NMCLI_BIN:-nmcli}"
ZIGGY_WIFI_DRYRUN="${ZIGGY_WIFI_DRYRUN:-0}"

# --- structured logging ------------------------------------------------------
# log LEVEL COMPONENT MESSAGE...
log() {
  local level="$1" component="$2"; shift 2
  local ts; ts="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo '0000-00-00T00:00:00Z')"
  printf '%s [%-5s] %s: %s\n' "$ts" "$level" "$component" "$*" >&2
}
log_info()  { log INFO  "${LOG_COMPONENT:-wifi}" "$@"; }
log_warn()  { log WARN  "${LOG_COMPONENT:-wifi}" "$@"; }
log_error() { log ERROR "${LOG_COMPONENT:-wifi}" "$@"; }

# --- nmcli wrapper -----------------------------------------------------------
# run_nm <nmcli args...> — argv-only; in dry-run prints the plan and returns 0.
run_nm() {
  if [ "$ZIGGY_WIFI_DRYRUN" = "1" ]; then
    printf '%s\n' "[dry-run] $NMCLI_BIN $*" >&2
    return 0
  fi
  "$NMCLI_BIN" "$@"
}

# run_nm_quiet — like run_nm but swallow output and never fail the caller.
run_nm_quiet() {
  if [ "$ZIGGY_WIFI_DRYRUN" = "1" ]; then
    printf '%s\n' "[dry-run] $NMCLI_BIN $*" >&2
    return 0
  fi
  "$NMCLI_BIN" "$@" >/dev/null 2>&1 || true
}

# --- connectivity probes -----------------------------------------------------
# nm_is_online — 0 (true) when NetworkManager reports usable connectivity.
# Uses `nmcli networking connectivity` (full == real internet) with a fallback
# to `nmcli -t -f STATE general` (connected == at least a usable L3 link).
nm_is_online() {
  # In dry-run we never claim online, so the plan always shows the AP path.
  if [ "$ZIGGY_WIFI_DRYRUN" = "1" ]; then return 1; fi
  local conn state
  conn="$("$NMCLI_BIN" networking connectivity 2>/dev/null || true)"
  if [ "$conn" = "full" ]; then return 0; fi
  state="$("$NMCLI_BIN" -t -f STATE general 2>/dev/null || true)"
  case "$state" in
    connected|connected*) return 0 ;;
  esac
  return 1
}

# has_default_route — 0 when a default route exists (kernel-level online hint).
has_default_route() {
  if [ "$ZIGGY_WIFI_DRYRUN" = "1" ]; then return 1; fi
  ip route show default 2>/dev/null | grep -q '^default ' && return 0
  return 1
}

# --- wifi device discovery ---------------------------------------------------
# first_wifi_iface — echo the first wifi device name (e.g. wlan0), or "" if none.
first_wifi_iface() {
  if [ -n "${ZIGGY_WIFI_IFACE:-}" ]; then printf '%s' "$ZIGGY_WIFI_IFACE"; return 0; fi
  "$NMCLI_BIN" -t -f DEVICE,TYPE device status 2>/dev/null \
    | awk -F: '$2=="wifi"{print $1; exit}'
}

# --- device identity (SSID + AP password derivation) -------------------------
# short_device_id — 6 lowercase hex chars, stable per box. Prefers the DBus
# machine-id; falls back to a hash of the hostname so it's always defined.
short_device_id() {
  if [ -n "${ZIGGY_DEVICE_ID:-}" ]; then printf '%s' "$ZIGGY_DEVICE_ID"; return 0; fi
  local mid=""
  if [ -r /etc/machine-id ]; then mid="$(cat /etc/machine-id 2>/dev/null)"; fi
  if [ -z "$mid" ] && [ -r /var/lib/dbus/machine-id ]; then mid="$(cat /var/lib/dbus/machine-id 2>/dev/null)"; fi
  if [ -z "$mid" ]; then mid="$(hostname 2>/dev/null | cksum | tr -d ' -')"; fi
  printf '%s' "$mid" | tr 'A-Z' 'a-z' | tr -cd 'a-f0-9' | cut -c1-6
}

# ap_ssid — the onboarding hotspot SSID (Ziggy-Setup-<short id>).
ap_ssid() {
  if [ -n "${ZIGGY_AP_SSID:-}" ]; then printf '%s' "$ZIGGY_AP_SSID"; return 0; fi
  printf 'Ziggy-Setup-%s' "$(short_device_id)"
}

# ap_password — WPA2 PSK for the hotspot. Deterministic (so it can be printed on
# the kit label at imaging) unless ZIGGY_AP_PASSWORD is set. 10 lowercase
# alnum chars derived from a hash of the machine-id — always >= 8 (WPA2 floor).
ap_password() {
  if [ -n "${ZIGGY_AP_PASSWORD:-}" ]; then printf '%s' "$ZIGGY_AP_PASSWORD"; return 0; fi
  local seed hash
  seed="ziggy-ap-$(short_device_id)"
  if command -v sha256sum >/dev/null 2>&1; then
    hash="$(printf '%s' "$seed" | sha256sum | cut -c1-16)"
  elif command -v shasum >/dev/null 2>&1; then
    hash="$(printf '%s' "$seed" | shasum -a 256 | cut -c1-16)"
  else
    hash="$(printf '%s' "$seed" | cksum | tr -d ' -')0000000000000000"
  fi
  # Map hex to a readable 10-char alnum password (hex is already [0-9a-f]).
  printf 'ziggy%s' "$(printf '%s' "$hash" | cut -c1-5)"
}
