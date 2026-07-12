#!/usr/bin/env bash
# =============================================================================
# wifi-onboard.sh — headless Wi-Fi onboarding orchestrator for a Ziggy hub.
#
# On a fresh box with no Ethernet and no known Wi-Fi, there is no way to get
# online. This script closes that gap on Ubuntu 24.04 + NetworkManager:
#
#   1. Wait (bounded) for connectivity. If already online → nothing to do.
#   2. Otherwise start ONBOARDING MODE:
#        - bring up a WPA2 AP hotspot  (SSID: Ziggy-Setup-<short device id>)
#        - run portal_server.py: a stdlib captive portal that collects the
#          customer's home SSID + password and joins via nmcli
#   3. On a successful join: tear the AP down, persist the connection
#      (autoconnect=yes → survives reboot), done.
#   4. On failure/timeout: loop back to the AP and let the customer retry.
#
# Idempotent, structured logging, --dry-run (prints the plan, mutates nothing),
# and --status. Runs on boot via ziggy-wifi-onboard.service.
#
# HARDWARE-FREE TESTING
#   ZIGGY_WIFI_DRYRUN=1  every nmcli call and connectivity probe is simulated;
#                        --dry-run sets this for you.
#   ZIGGY_NMCLI_BIN=...  point at a mock nmcli to exercise the real argv paths.
#   ZIGGY_WIFI_IFACE=... skip device discovery (e.g. wlan0).
#
# USAGE
#   wifi-onboard.sh                 # boot flow: check, then onboard if offline
#   wifi-onboard.sh --dry-run       # print the full plan; no system mutation
#   wifi-onboard.sh --status        # report connectivity / AP / saved networks
#   wifi-onboard.sh --timeout 30    # connectivity wait window (seconds)
#   wifi-onboard.sh --max-cycles 3  # AP retry loops before giving up (0=inf)
#
# EXIT: 0 online (already, or after onboarding); 1 gave up; 2 bad args.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=nmcli-helpers.sh
. "$SCRIPT_DIR/nmcli-helpers.sh"
LOG_COMPONENT="wifi-onboard"

CONNECTIVITY_TIMEOUT="${ZIGGY_CONNECTIVITY_TIMEOUT:-45}"
PORTAL_PORT="${ZIGGY_PORTAL_PORT:-80}"
AP_CON_NAME="${ZIGGY_AP_CON:-ziggy-setup-ap}"
MAX_CYCLES="${ZIGGY_MAX_CYCLES:-0}"     # 0 == loop forever until online
DO_STATUS=0
PYTHON_BIN="${ZIGGY_PYTHON_BIN:-python3}"

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)     ZIGGY_WIFI_DRYRUN=1; export ZIGGY_WIFI_DRYRUN; shift ;;
    --status)      DO_STATUS=1; shift ;;
    --timeout)     CONNECTIVITY_TIMEOUT="${2:?--timeout needs seconds}"; shift 2 ;;
    --max-cycles)  MAX_CYCLES="${2:?--max-cycles needs a count}"; shift 2 ;;
    --port)        PORTAL_PORT="${2:?--port needs a value}"; shift 2 ;;
    -h|--help)     grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//' | head -40; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

# --- AP lifecycle ------------------------------------------------------------
# ap_up <iface> <ssid> <psk> — create-or-refresh the WPA2 shared hotspot.
# Idempotent: deletes any prior connection of the same name first.
ap_up() {
  local iface="$1" ssid="$2" psk="$3"
  log_info "bringing up AP '$ssid' on $iface (con=$AP_CON_NAME)"
  run_nm_quiet connection delete "$AP_CON_NAME"
  run_nm connection add type wifi ifname "$iface" con-name "$AP_CON_NAME" \
    autoconnect no ssid "$ssid"
  run_nm connection modify "$AP_CON_NAME" \
    802-11-wireless.mode ap 802-11-wireless.band bg \
    ipv4.method shared \
    wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$psk"
  run_nm connection up "$AP_CON_NAME"
  log_info "AP up — join SSID '$ssid' (WPA2 pass '$psk'), browse http://10.42.0.1"
}

# ap_down — tear the hotspot down (idempotent).
ap_down() {
  log_info "tearing down AP ($AP_CON_NAME)"
  run_nm_quiet connection down "$AP_CON_NAME"
  run_nm_quiet connection delete "$AP_CON_NAME"
}

# --- status mode -------------------------------------------------------------
if [ "$DO_STATUS" = "1" ]; then
  iface="$(first_wifi_iface || true)"
  echo "== Ziggy Wi-Fi onboarding status =="
  echo "wifi iface     : ${iface:-<none found>}"
  echo "AP SSID (would): $(ap_ssid)"
  echo "AP con-name    : $AP_CON_NAME"
  if [ "$ZIGGY_WIFI_DRYRUN" = "1" ]; then
    echo "connectivity   : (dry-run — not probed)"
  else
    echo "connectivity   : $("$NMCLI_BIN" networking connectivity 2>/dev/null || echo unknown)"
    echo "NM state       : $("$NMCLI_BIN" -t -f STATE general 2>/dev/null || echo unknown)"
    if nm_is_online; then echo "verdict        : ONLINE"; else echo "verdict        : OFFLINE"; fi
    echo "-- saved wifi connections --"
    "$NMCLI_BIN" -t -f NAME,TYPE connection show 2>/dev/null \
      | awk -F: '$2 ~ /wireless/ {print "  "$1}' || true
    if "$NMCLI_BIN" -t -f NAME connection show 2>/dev/null | grep -qx "$AP_CON_NAME"; then
      echo "AP hotspot     : PRESENT ($AP_CON_NAME)"
    else
      echo "AP hotspot     : absent"
    fi
  fi
  exit 0
fi

# --- resolve identity + interface -------------------------------------------
SSID="$(ap_ssid)"
PSK="$(ap_password)"
DEVID="$(short_device_id)"
IFACE="$(first_wifi_iface || true)"
if [ -z "$IFACE" ]; then
  if [ "$ZIGGY_WIFI_DRYRUN" = "1" ]; then
    IFACE="wlan0"
    log_warn "no wifi device found — using placeholder '$IFACE' (dry-run)"
  else
    log_error "no Wi-Fi interface found; cannot onboard. Plug Ethernet or add a Wi-Fi adapter."
    exit 1
  fi
fi

log_info "device=$DEVID iface=$IFACE ap-ssid=$SSID connectivity-timeout=${CONNECTIVITY_TIMEOUT}s"

# --- step 1: already online? -------------------------------------------------
if bash "$SCRIPT_DIR/connectivity-check.sh" --timeout "$CONNECTIVITY_TIMEOUT"; then
  log_info "connectivity present — no onboarding needed"
  exit 0
fi

# --- step 2..4: onboarding loop ---------------------------------------------
cycle=0
while :; do
  cycle=$((cycle + 1))
  log_info "onboarding cycle #$cycle"

  ap_up "$IFACE" "$SSID" "$PSK"

  # The portal blocks until the customer's join succeeds, then returns 0.
  portal_args=(--iface "$IFACE" --ssid-ap "$SSID" --device-id "$DEVID"
               --port "$PORTAL_PORT" --nmcli-bin "$NMCLI_BIN")
  if [ "$ZIGGY_WIFI_DRYRUN" = "1" ]; then portal_args+=(--dry-run); fi

  log_info "starting captive portal: $PYTHON_BIN portal_server.py ${portal_args[*]}"
  if [ "$ZIGGY_WIFI_DRYRUN" = "1" ]; then
    # Don't bind port 80 or block during plan testing — just show intent.
    "$PYTHON_BIN" "$SCRIPT_DIR/portal_server.py" "${portal_args[@]}" || true
  else
    "$PYTHON_BIN" "$SCRIPT_DIR/portal_server.py" "${portal_args[@]}" || \
      log_warn "portal exited non-zero (cycle #$cycle)"
  fi

  ap_down

  # Give NM a moment to settle on the newly-joined network, then verify.
  if [ "$ZIGGY_WIFI_DRYRUN" != "1" ]; then sleep 3; fi
  if bash "$SCRIPT_DIR/connectivity-check.sh" --once; then
    log_info "onboarding SUCCESS — hub is online (persisted for reboot)"
    exit 0
  fi

  if [ "$ZIGGY_WIFI_DRYRUN" = "1" ]; then
    log_info "dry-run: single cycle shown; not looping"
    exit 0
  fi
  if [ "$MAX_CYCLES" -gt 0 ] && [ "$cycle" -ge "$MAX_CYCLES" ]; then
    log_error "gave up after $cycle onboarding cycles"
    exit 1
  fi
  log_warn "still offline — restarting AP for another attempt"
done
