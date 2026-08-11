#!/usr/bin/env bash
# =============================================================================
# ziggy-network-pin.sh — give the hub a stable, discoverable LAN identity.
#
# WHY THIS EXISTS
#   A true DHCP reservation lives in the customer's router and there is no
#   standard way to ask for one, so we achieve the same OUTCOME from the hub:
#
#     1. PIN  — convert the address the router already leased us into a static
#               netplan config, so it stops moving.
#     2. NAME — advertise mDNS (<hostname>.local) so anything that needs the hub
#               can find it by name even if the address does change.
#
#   Both halves matter. This fleet has lost real time to address drift: an
#   IP-pinned HA_URL cost the Canary a 9h50m outage, a stale lan_host produced
#   false "arrived home" pushes, and a drifting Broadlink turned IR into 502s.
#   Pinning stops the address moving; mDNS stops it mattering when it does.
#
# WHY THIS IS SAFE TO RUN OVER SSH
#   Applying a bad network config to a headless box in someone's living room is
#   how you turn a software task into a site visit. So, before touching
#   anything, this script ARMS A TRANSIENT SYSTEMD TIMER that reverts to DHCP.
#   The timer lives in systemd, not in this shell, so it fires even if the SSH
#   session dies mid-apply. It is cancelled only after connectivity is proven.
#   This is `netplan try`'s auto-revert, done in a way that works headlessly.
#
#   The address we pin is the one the router ALREADY leased to our MAC, so the
#   router's own lease table already agrees with us — we are not squatting.
#
# MODES
#   --pin            (default) lease -> static, verify, auto-revert on failure
#   --check          boot guard: is the pinned config still valid? revert if not
#   --revert         restore DHCP now
#   --status         show what is currently configured
#   --dry-run        print the plan, touch nothing (works as non-root, off-box)
#
# OPTIONS
#   --iface <name>       override interface detection
#   --mdns-name <name>   set the hostname + advertise it over mDNS
#   --no-mdns            skip the mDNS half
#   --rollback-secs <n>  auto-revert window (default 120)
#
# EXIT: 0 success (or safely reverted); 1 hard failure.
# =============================================================================
set -uo pipefail

ETC_DIR="${ZIGGY_ETC_DIR:-/etc/ziggy}"
NETPLAN_DIR="${ZIGGY_NETPLAN_DIR:-/etc/netplan}"
# 60- sorts after Ubuntu's 50-cloud-init.yaml, so our keys win the merge.
PIN_FILE="$NETPLAN_DIR/60-ziggy-static.yaml"
STATE_FILE="$ETC_DIR/network-pin.state"
BACKUP_DIR="$ETC_DIR/netplan-backup"
ROLLBACK_UNIT="ziggy-netpin-rollback"
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

MODE="pin"
IFACE=""
MDNS_NAME=""
DO_MDNS=1
ROLLBACK_SECS="${ZIGGY_NETPIN_ROLLBACK_SECS:-120}"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pin)           MODE="pin"; shift ;;
    --check)         MODE="check"; shift ;;
    --revert)        MODE="revert"; shift ;;
    --revert-now)    MODE="revert"; shift ;;   # what the rollback timer calls
    --status)        MODE="status"; shift ;;
    --iface)         IFACE="${2:?--iface needs a value}"; shift 2 ;;
    --mdns-name)     MDNS_NAME="${2:?--mdns-name needs a value}"; shift 2 ;;
    --no-mdns)       DO_MDNS=0; shift ;;
    --rollback-secs) ROLLBACK_SECS="${2:?--rollback-secs needs a value}"; shift 2 ;;
    --dry-run)       DRY_RUN=1; shift ;;
    -h|--help)       grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

_log()  { printf '\033[36m[netpin]\033[0m %s\n' "$*" >&2; }
_ok()   { printf '\033[32m[netpin ✓]\033[0m %s\n' "$*" >&2; }
_warn() { printf '\033[33m[netpin !]\033[0m %s\n' "$*" >&2; }
_die()  { printf '\033[31m[netpin ✗]\033[0m %s\n' "$*" >&2; exit 1; }

# Root is required only when we are actually writing to system locations —
# the same "privileges follow the paths" rule ziggy-image-device.sh uses. This
# also makes the pin/revert state machine testable without root.
_need_root() {
  [[ "$DRY_RUN" == "1" ]] && return 0
  [[ "$NETPLAN_DIR" == /etc/* ]] || return 0
  [[ "$(id -u)" == "0" ]] || _die "must run as root (writes $NETPLAN_DIR and reconfigures networking)"
}

# ── discovery ───────────────────────────────────────────────────────────────
# Everything below reads the CURRENT live config. We never invent an address.

_detect_iface() {
  [[ -n "$IFACE" ]] && { printf '%s' "$IFACE"; return 0; }
  ip -j route show default 2>/dev/null \
    | python3 -c 'import json,sys
try: r=json.load(sys.stdin)
except Exception: r=[]
print(r[0].get("dev","") if r else "")' 2>/dev/null
}

_detect_cidr() {  # addr/prefix on $1
  ip -j addr show dev "$1" 2>/dev/null \
    | python3 -c 'import json,sys
try: d=json.load(sys.stdin)
except Exception: d=[]
for it in d:
    for a in it.get("addr_info",[]):
        if a.get("family")=="inet" and not a.get("local","").startswith("127."):
            print("%s/%s" % (a["local"], a["prefixlen"])); raise SystemExit
' 2>/dev/null
}

_detect_gateway() {
  ip -j route show default 2>/dev/null \
    | python3 -c 'import json,sys
try: r=json.load(sys.stdin)
except Exception: r=[]
print(r[0].get("gateway","") if r else "")' 2>/dev/null
}

_detect_dns() {  # space-separated resolvers for iface $1
  local out=""
  if command -v resolvectl >/dev/null 2>&1; then
    out="$(resolvectl dns "$1" 2>/dev/null | sed 's/^.*)://' | tr -s ' ' '\n' \
           | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | tr '\n' ' ')"
  fi
  if [[ -z "${out// /}" ]]; then
    out="$(grep -E '^nameserver ' /run/systemd/resolve/resolv.conf /etc/resolv.conf 2>/dev/null \
           | awk '{print $2}' | grep -E '^[0-9]+\.' | grep -v '^127\.' | head -3 | tr '\n' ' ')"
  fi
  printf '%s' "$out"
}

# ── verification ────────────────────────────────────────────────────────────
# "Did we keep the network?" — deliberately strict. A pin that half-works is
# worse than no pin, because it looks fine until the customer needs support.

_verify_connectivity() {
  local gw="$1" tries="${2:-10}" i
  for (( i=1; i<=tries; i++ )); do
    if ping -c1 -W2 "$gw" >/dev/null 2>&1; then
      # Gateway is back. Now prove DNS still resolves — a pin that keeps L3 but
      # loses the resolver breaks the relay, OTA and the LLM proxy alike.
      if getent hosts cloudflare.com >/dev/null 2>&1 \
         || getent hosts github.com >/dev/null 2>&1; then
        return 0
      fi
      _log "gateway reachable but DNS is not resolving (attempt $i/$tries)"
    fi
    sleep 2
  done
  return 1
}

_address_conflict() {  # true if someone ELSE answers for our address
  local iface="$1" addr="${2%%/*}"
  command -v arping >/dev/null 2>&1 || return 1   # can't tell -> assume fine
  # -D duplicate-address-detection: exit non-zero when a reply arrives.
  arping -D -q -c 2 -w 3 -I "$iface" "$addr" >/dev/null 2>&1 && return 1 || return 0
}

# ── rollback plumbing ───────────────────────────────────────────────────────

_arm_rollback() {
  local secs="$1"
  systemctl stop "$ROLLBACK_UNIT.timer" >/dev/null 2>&1 || true
  systemctl reset-failed "$ROLLBACK_UNIT" >/dev/null 2>&1 || true
  if systemd-run --unit="$ROLLBACK_UNIT" --on-active="${secs}s" \
       --timer-property=AccuracySec=1s \
       --description="Ziggy network pin auto-revert" \
       /bin/bash "$SELF" --revert-now >/dev/null 2>&1; then
    _ok "auto-revert armed: DHCP is restored in ${secs}s unless this run proves connectivity"
    return 0
  fi
  return 1
}

_cancel_rollback() {
  systemctl stop "$ROLLBACK_UNIT.timer" >/dev/null 2>&1 || true
  systemctl reset-failed "$ROLLBACK_UNIT" >/dev/null 2>&1 || true
}

_apply_netplan() {
  # generate first so a syntax error is caught before it can affect the link
  if ! netplan generate >/dev/null 2>&1; then
    _warn "netplan generate rejected the config"
    return 1
  fi
  netplan apply >/dev/null 2>&1
}

# ── revert ──────────────────────────────────────────────────────────────────
_do_revert() {
  _need_root
  if [[ "$DRY_RUN" == "1" ]]; then
    _log "DRY-RUN: would remove $PIN_FILE and re-apply DHCP"
    return 0
  fi
  if [[ -f "$PIN_FILE" ]]; then
    rm -f "$PIN_FILE"
    _apply_netplan || _warn "netplan apply reported an error while reverting"
    _ok "reverted to DHCP (removed $PIN_FILE)"
  else
    _log "nothing to revert — no $PIN_FILE"
  fi
  printf 'state=dhcp\nreverted_at=%s\n' "$(date -Is)" > "$STATE_FILE" 2>/dev/null || true
  _cancel_rollback
}

# ── status ──────────────────────────────────────────────────────────────────
_do_status() {
  local iface cidr gw
  iface="$(_detect_iface)"; cidr="$(_detect_cidr "${iface:-lo}")"; gw="$(_detect_gateway)"
  echo "  interface : ${iface:-<none>}"
  echo "  address   : ${cidr:-<none>}"
  echo "  gateway   : ${gw:-<none>}"
  echo "  dns       : $(_detect_dns "${iface:-lo}")"
  if [[ -f "$PIN_FILE" ]]; then
    echo "  pinned    : YES ($PIN_FILE)"
  else
    echo "  pinned    : no (DHCP)"
  fi
  [[ -f "$STATE_FILE" ]] && { echo "  state     :"; sed 's/^/    /' "$STATE_FILE"; }
  if command -v avahi-daemon >/dev/null 2>&1; then
    echo "  mdns      : $(hostname).local (avahi $(systemctl is-active avahi-daemon 2>/dev/null))"
  else
    echo "  mdns      : not installed"
  fi
}

# ── boot guard ──────────────────────────────────────────────────────────────
# Runs at every boot. The pin is only correct while the network it was made on
# still exists. Two things legitimately invalidate it: the customer replaced the
# router (new subnet), or our address was handed to another device while the hub
# was powered off. Either way the right move is the same — fall back to DHCP and
# keep the home online. A home that boots unreachable is the worst outcome here.
_do_check() {
  _need_root
  [[ -f "$PIN_FILE" ]] || { _log "not pinned — nothing to check"; exit 0; }

  local iface gw cidr
  iface="$(_detect_iface)"
  gw="$(_detect_gateway)"
  cidr="$(_detect_cidr "${iface:-lo}")"

  if [[ -z "$gw" ]]; then
    _warn "no default route with the pinned config — reverting to DHCP"
    _do_revert
    exit 0
  fi

  if _verify_connectivity "$gw" 5; then
    # Also make sure nobody else has taken our address in the meantime.
    if [[ -n "$iface" && -n "$cidr" ]] && _address_conflict "$iface" "$cidr"; then
      _warn "another device is answering for ${cidr%%/*} — reverting to DHCP"
      _do_revert
      exit 0
    fi
    _ok "pinned config healthy (${cidr:-?} via $gw)"
    exit 0
  fi

  _warn "pinned config cannot reach the gateway — reverting to DHCP"
  _do_revert
  exit 0
}

# ── mDNS ────────────────────────────────────────────────────────────────────
# The half that makes address drift survivable. Installing avahi gives the hub a
# <hostname>.local name that phones, browsers and the app can resolve without
# anybody knowing an IP.
_setup_mdns() {
  local name="$1"
  if [[ "$DRY_RUN" == "1" ]]; then
    _log "DRY-RUN: would set hostname to '$name', install avahi-daemon, advertise ${name}.local"
    return 0
  fi
  if [[ -n "$name" ]]; then
    hostnamectl set-hostname "$name" 2>/dev/null || _warn "could not set hostname to '$name'"
    # Keep /etc/hosts consistent or sudo gets slow and some daemons warn.
    if ! grep -qE "^127\.0\.1\.1[[:space:]]+$name\$" /etc/hosts 2>/dev/null; then
      sed -i '/^127\.0\.1\.1[[:space:]]/d' /etc/hosts 2>/dev/null || true
      printf '127.0.1.1\t%s\n' "$name" >> /etc/hosts
    fi
  fi
  if ! command -v avahi-daemon >/dev/null 2>&1; then
    _log "installing avahi-daemon for mDNS…"
    DEBIAN_FRONTEND=noninteractive apt-get install -y avahi-daemon >/dev/null 2>&1 \
      || { _warn "could not install avahi-daemon — mDNS unavailable (not fatal)"; return 0; }
  fi
  systemctl enable --now avahi-daemon >/dev/null 2>&1 || true
  if systemctl is-active --quiet avahi-daemon; then
    _ok "mDNS active: $(hostname).local"
  else
    _warn "avahi-daemon is not running — mDNS unavailable (not fatal)"
  fi
}

# ── pin ─────────────────────────────────────────────────────────────────────
_do_pin() {
  _need_root

  local iface cidr gw dns
  iface="$(_detect_iface)"
  [[ -n "$iface" ]] || _die "could not determine the primary interface (no default route). Is the hub on the network?"
  cidr="$(_detect_cidr "$iface")"
  [[ -n "$cidr" ]] || _die "interface $iface has no IPv4 address to pin"
  gw="$(_detect_gateway)"
  [[ -n "$gw" ]] || _die "no default gateway on $iface"
  dns="$(_detect_dns "$iface")"
  # The router is nearly always a resolver; 1.1.1.1 is the safety net so a
  # router that does not serve DNS cannot leave the home without resolution.
  [[ -z "${dns// /}" ]] && dns="$gw 1.1.1.1"

  local dns_yaml
  dns_yaml="$(printf '%s' "$dns" | tr ' ' '\n' | grep -E '^[0-9]' | sed 's/^/          - /')"

  _log "interface : $iface"
  _log "address   : $cidr  (the lease the router already gave this MAC)"
  _log "gateway   : $gw"
  _log "dns       : $dns"

  if [[ "$DRY_RUN" == "1" ]]; then
    _log "DRY-RUN: would back up $NETPLAN_DIR, arm a ${ROLLBACK_SECS}s auto-revert, write $PIN_FILE:"
    printf '%s\n' "--- $PIN_FILE ---" >&2
    cat >&2 <<EOF
network:
  version: 2
  renderer: networkd
  ethernets:
    $iface:
      dhcp4: false
      addresses:
        - $cidr
      routes:
        - to: default
          via: $gw
      nameservers:
        addresses:
$dns_yaml
EOF
    [[ "$DO_MDNS" == "1" ]] && _setup_mdns "${MDNS_NAME:-$(hostname)}"
    _ok "dry-run complete (nothing changed)"
    return 0
  fi

  # Refuse to pin an address that is already contested.
  if _address_conflict "$iface" "$cidr"; then
    _die "another device on this LAN is already answering for ${cidr%%/*} — refusing to pin. Fix the conflict or reboot to get a fresh lease."
  fi

  # 1. back up whatever netplan config exists today
  install -d -m 0700 "$BACKUP_DIR"
  cp -a "$NETPLAN_DIR"/*.yaml "$BACKUP_DIR"/ 2>/dev/null || true
  _log "backed up existing netplan config to $BACKUP_DIR"

  # 2. arm the auto-revert BEFORE touching anything
  if ! _arm_rollback "$ROLLBACK_SECS"; then
    _die "could not arm the auto-revert timer — refusing to change networking without a safety net"
  fi

  # 3. write the pin
  umask 077
  cat > "$PIN_FILE" <<EOF
# Managed by Ziggy — scripts/linux/ziggy-network-pin.sh
# The address below is the lease this hub's MAC already held; pinning it keeps
# the hub at a fixed address without needing a reservation on the customer's
# router. ziggy-network-guard.service re-checks this at every boot and falls
# back to DHCP if the network moved underneath it. Do not hand-edit.
network:
  version: 2
  renderer: networkd
  ethernets:
    $iface:
      dhcp4: false
      addresses:
        - $cidr
      routes:
        - to: default
          via: $gw
      nameservers:
        addresses:
$dns_yaml
EOF
  chmod 0600 "$PIN_FILE"

  # 4. apply
  if ! _apply_netplan; then
    _warn "netplan rejected or failed to apply the pin — reverting"
    _do_revert
    _die "could not apply the static configuration (config left on DHCP)"
  fi

  # 5. prove we still have a network
  _log "verifying connectivity (auto-revert fires in ${ROLLBACK_SECS}s if this fails)…"
  if ! _verify_connectivity "$gw" 10; then
    _warn "lost connectivity with the pinned config — reverting"
    _do_revert
    _die "static configuration did not hold (config restored to DHCP)"
  fi

  # 6. safe — stand the timer down
  _cancel_rollback
  printf 'state=pinned\niface=%s\naddress=%s\ngateway=%s\ndns=%s\npinned_at=%s\n' \
    "$iface" "$cidr" "$gw" "$dns" "$(date -Is)" > "$STATE_FILE"
  chmod 0600 "$STATE_FILE"
  _ok "address pinned: $cidr on $iface via $gw"

  [[ "$DO_MDNS" == "1" ]] && _setup_mdns "${MDNS_NAME:-$(hostname)}"
  return 0
}

case "$MODE" in
  pin)    _do_pin ;;
  check)  _do_check ;;
  revert) _do_revert ;;
  status) _do_status ;;
  *)      _die "unknown mode: $MODE" ;;
esac
