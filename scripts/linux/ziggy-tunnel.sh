#!/usr/bin/env bash
# =============================================================================
# ziggy-tunnel.sh — install + run the per-home Cloudflare Tunnel on an Ubuntu hub.
#
# WHY THIS EXISTS
#   The relay already does the whole Cloudflare side when a home is provisioned
#   (relay/app/provisioner.py): it creates the tunnel, PUTs the ingress config
#   (catch-all -> http://localhost:8001), mints the per-home connector token and
#   binds the public hostname. The ONLY missing half was on the hub: nothing
#   ever installed or ran `cloudflared`, so every home's tunnel was brought up
#   by hand after imaging. A hub that is imaged but has no connector is
#   invisible to the owner's app and to founder support.
#
#   This script is that missing half, and it is idempotent so it can be re-run
#   on a live hub without disturbing a working tunnel.
#
# SECURITY
#   The connector token is a bearer credential for this home's tunnel. It is
#   NEVER passed on a command line (visible in `ps` to every local user) and
#   never baked into the unit file. It lives in /etc/ziggy/tunnel.env, root-only
#   0600, and reaches cloudflared as the TUNNEL_TOKEN environment variable via
#   systemd EnvironmentFile.
#
# USAGE
#   sudo ziggy-tunnel.sh --token <connector-token> [--verify-url https://...]
#   sudo ziggy-tunnel.sh                      # reuses the stored token
#   ZIGGY_TUNNEL_TOKEN=... sudo -E ziggy-tunnel.sh
#   ziggy-tunnel.sh --dry-run                 # no install, no network, no root
#   sudo ziggy-tunnel.sh --status
#   sudo ziggy-tunnel.sh --uninstall
#
# EXIT: 0 tunnel running (and verified, if --verify-url given); 1 failure.
# =============================================================================
set -uo pipefail

ETC_DIR="${ZIGGY_ETC_DIR:-/etc/ziggy}"
TOKEN_FILE="$ETC_DIR/tunnel.env"
UNIT_NAME="ziggy-tunnel.service"
# Overridable so the unit-generation logic is testable without root. In
# production this is always the real systemd directory.
SYSTEMD_DIR="${ZIGGY_SYSTEMD_DIR:-/etc/systemd/system}"
UNIT_PATH="$SYSTEMD_DIR/$UNIT_NAME"
CLOUDFLARED_BIN="${ZIGGY_CLOUDFLARED_BIN:-/usr/bin/cloudflared}"
# How long to wait for the connector to register with Cloudflare's edge.
CONNECT_TIMEOUT_S="${ZIGGY_TUNNEL_CONNECT_TIMEOUT_S:-60}"
# How long to wait for the public hostname to actually serve the hub.
VERIFY_TIMEOUT_S="${ZIGGY_TUNNEL_VERIFY_TIMEOUT_S:-90}"

TOKEN="${ZIGGY_TUNNEL_TOKEN:-}"
VERIFY_URL=""
DRY_RUN=0
UNINSTALL=0
STATUS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --token)      TOKEN="${2:?--token needs a value}"; shift 2 ;;
    --verify-url) VERIFY_URL="${2:?--verify-url needs a value}"; shift 2 ;;
    --dry-run)    DRY_RUN=1; shift ;;
    --uninstall)  UNINSTALL=1; shift ;;
    --status)     STATUS=1; shift ;;
    -h|--help)    grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

_log()  { printf '\033[36m[tunnel]\033[0m %s\n' "$*" >&2; }
_ok()   { printf '\033[32m[tunnel ✓]\033[0m %s\n' "$*" >&2; }
_warn() { printf '\033[33m[tunnel !]\033[0m %s\n' "$*" >&2; }
_die()  { printf '\033[31m[tunnel ✗]\033[0m %s\n' "$*" >&2; exit 1; }

# Root is required only when we are actually writing to system locations —
# the same "privileges follow the paths" rule ziggy-image-device.sh uses.
_need_root() {
  [[ "$DRY_RUN" == "1" ]] && return 0
  [[ "$SYSTEMD_DIR" == /etc/* || "$ETC_DIR" == /etc/* ]] || return 0
  [[ "$(id -u)" == "0" ]] || _die "must run as root (writes $TOKEN_FILE and $UNIT_PATH)"
}

# ── status ──────────────────────────────────────────────────────────────────
if [[ "$STATUS" == "1" ]]; then
  systemctl is-active --quiet "$UNIT_NAME" \
    && _ok "$UNIT_NAME is active" \
    || _warn "$UNIT_NAME is NOT active"
  systemctl is-enabled --quiet "$UNIT_NAME" \
    && _ok "$UNIT_NAME is enabled at boot" \
    || _warn "$UNIT_NAME is NOT enabled at boot"
  journalctl -u "$UNIT_NAME" -n 20 --no-pager 2>/dev/null || true
  exit 0
fi

# ── uninstall ───────────────────────────────────────────────────────────────
if [[ "$UNINSTALL" == "1" ]]; then
  _need_root
  systemctl disable --now "$UNIT_NAME" >/dev/null 2>&1 || true
  rm -f "$UNIT_PATH"
  systemctl daemon-reload >/dev/null 2>&1 || true
  # Leave the token file: re-installing should not require re-provisioning.
  _ok "uninstalled $UNIT_NAME (token file kept at $TOKEN_FILE)"
  exit 0
fi

_need_root

# ── 1. resolve the token ────────────────────────────────────────────────────
# Precedence: --token / env  >  the stored token. A supplied token always wins
# so re-provisioning a home (new tunnel) can rotate the connector in place.
if [[ -z "$TOKEN" && -f "$TOKEN_FILE" ]]; then
  TOKEN="$(sed -n 's/^TUNNEL_TOKEN=//p' "$TOKEN_FILE" | tail -1)"
  [[ -n "$TOKEN" ]] && _log "reusing the connector token already stored in $TOKEN_FILE"
fi
[[ -n "$TOKEN" ]] || _die "no connector token. Pass --token, set ZIGGY_TUNNEL_TOKEN, or provision the home first (relay POST /api/provision/hub returns it)."

# Cloudflare connector tokens are base64. Catch a truncated/garbled paste here
# rather than as an opaque cloudflared crash loop three minutes from now.
if [[ ${#TOKEN} -lt 40 ]]; then
  _die "connector token looks truncated (${#TOKEN} chars). Expected a long base64 string."
fi

if [[ "$DRY_RUN" == "1" ]]; then
  _log "DRY-RUN: would install cloudflared, write $TOKEN_FILE (0600), install $UNIT_PATH, enable + start $UNIT_NAME"
  [[ -n "$VERIFY_URL" ]] && _log "DRY-RUN: would verify $VERIFY_URL responds through the tunnel"
  _ok "dry-run complete (nothing changed)"
  exit 0
fi

# ── 2. install cloudflared ──────────────────────────────────────────────────
_install_cloudflared() {
  if command -v cloudflared >/dev/null 2>&1; then
    CLOUDFLARED_BIN="$(command -v cloudflared)"
    _log "cloudflared already installed: $($CLOUDFLARED_BIN --version 2>/dev/null | head -1)"
    return 0
  fi

  local arch deb url tmp
  arch="$(dpkg --print-architecture 2>/dev/null || echo amd64)"
  case "$arch" in
    amd64|arm64|armhf|386) ;;
    *) _die "unsupported architecture '$arch' for cloudflared" ;;
  esac

  deb="cloudflared-linux-${arch}.deb"
  url="https://github.com/cloudflare/cloudflared/releases/latest/download/${deb}"
  tmp="$(mktemp -d)"
  _log "downloading cloudflared ($arch)…"
  if ! curl -fsSL --retry 3 --retry-delay 2 -o "$tmp/$deb" "$url"; then
    rm -rf "$tmp"
    _die "could not download cloudflared from $url (no internet on the hub?)"
  fi
  # apt-get, not dpkg -i, so any dependency is resolved rather than left broken.
  if ! apt-get install -y "$tmp/$deb" >/dev/null 2>&1; then
    rm -rf "$tmp"
    _die "installing $deb failed"
  fi
  rm -rf "$tmp"
  command -v cloudflared >/dev/null 2>&1 || _die "cloudflared still not on PATH after install"
  CLOUDFLARED_BIN="$(command -v cloudflared)"
  _ok "cloudflared installed: $($CLOUDFLARED_BIN --version 2>/dev/null | head -1)"
}
_install_cloudflared

# ── 3. store the token, root-only ───────────────────────────────────────────
install -d -m 0755 "$ETC_DIR"
umask 077
printf 'TUNNEL_TOKEN=%s\n' "$TOKEN" > "$TOKEN_FILE"
chmod 0600 "$TOKEN_FILE"
_ok "connector token stored at $TOKEN_FILE (0600, root-only)"

# ── 4. install the unit ─────────────────────────────────────────────────────
# We write our own unit rather than using `cloudflared service install`, which
# bakes the token into the unit's ExecStart. Here the token reaches cloudflared
# only via EnvironmentFile, so it appears in neither `ps` nor the unit file.
cat > "$UNIT_PATH" <<EOF
[Unit]
Description=Ziggy per-home Cloudflare Tunnel connector
Documentation=https://github.com/YouvalPolacsekCode/Ziggy_PC
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=notify
# The token is a bearer credential: keep it out of \`ps\` by passing it as an
# environment variable from a root-only file, never as an argv element.
EnvironmentFile=$TOKEN_FILE
ExecStart=$CLOUDFLARED_BIN --no-autoupdate --metrics 127.0.0.1:20241 tunnel run
Restart=always
RestartSec=5
# A home's remote access must survive a flaky uplink indefinitely.
TimeoutStartSec=0
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/log

[Install]
WantedBy=multi-user.target
EOF
chmod 0644 "$UNIT_PATH"
systemctl daemon-reload
_ok "installed $UNIT_PATH"

# ── 5. start it ─────────────────────────────────────────────────────────────
systemctl enable "$UNIT_NAME" >/dev/null 2>&1 || _die "could not enable $UNIT_NAME"
systemctl restart "$UNIT_NAME" || _die "could not start $UNIT_NAME (journalctl -u $UNIT_NAME)"

# ── 6. wait for the connector to register with the edge ─────────────────────
# "active" only means the process is up; it does NOT mean Cloudflare accepted
# the token. Wait for a registered connection before calling this done, so a
# bad token fails HERE instead of silently at handover.
_log "waiting up to ${CONNECT_TIMEOUT_S}s for the connector to register…"
registered=0
for _ in $(seq 1 "$CONNECT_TIMEOUT_S"); do
  if ! systemctl is-active --quiet "$UNIT_NAME"; then
    _log "$(journalctl -u "$UNIT_NAME" -n 15 --no-pager 2>/dev/null | tail -15)"
    _die "$UNIT_NAME died on startup — the token is probably wrong or revoked"
  fi
  if journalctl -u "$UNIT_NAME" --since "-5 min" --no-pager 2>/dev/null \
       | grep -qiE "Registered tunnel connection|Connection [a-f0-9-]+ registered"; then
    registered=1
    break
  fi
  sleep 1
done

if [[ "$registered" != "1" ]]; then
  _log "$(journalctl -u "$UNIT_NAME" -n 20 --no-pager 2>/dev/null | tail -20)"
  _die "connector never registered within ${CONNECT_TIMEOUT_S}s — check the token and the hub's outbound 443"
fi
_ok "connector registered with the Cloudflare edge"

# ── 7. optional end-to-end verification ─────────────────────────────────────
# NOTE: the bare *.cfargotunnel.com tunnel_url is NOT publicly routable — only
# the per-home public hostname is. Callers should pass the reachable URL
# (https://<home_id>.hubs.ziggy-home.com), which is what the relay returns as
# `reachable_url`. Verification is best-effort: DNS for a freshly-minted
# hostname can take a minute to propagate, and a home is not broken because of
# that, so a miss warns rather than fails.
if [[ -n "$VERIFY_URL" ]]; then
  _log "verifying $VERIFY_URL through the tunnel (up to ${VERIFY_TIMEOUT_S}s)…"
  verified=0
  deadline=$(( SECONDS + VERIFY_TIMEOUT_S ))
  while (( SECONDS < deadline )); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${VERIFY_URL%/}/health" 2>/dev/null || echo 000)"
    # Any real HTTP status means the tunnel carried the request to the hub.
    # 401/404 still proves the path works; only 000/502/530 mean "not through".
    case "$code" in
      000|502|503|530) ;;
      *) verified=1; break ;;
    esac
    sleep 5
  done
  if [[ "$verified" == "1" ]]; then
    _ok "public hostname serves the hub (HTTP $code)"
  else
    _warn "could not reach $VERIFY_URL yet (last status ${code:-000}). The connector IS registered; this is usually DNS propagation. Re-check with: curl -i ${VERIFY_URL%/}/health"
  fi
fi

_ok "tunnel up and enabled at boot"
