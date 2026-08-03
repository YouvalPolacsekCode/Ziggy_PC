#!/usr/bin/env bash
# ziggy-matter-enable.sh — turn a hub into a Matter + Thread controller.
#
# Matter is the "customer buys a Matter device later" capability, so — like
# turning Zigbee on after imaging — it's a dedicated, idempotent enable flow
# rather than a step wired into the fresh-image state machine. Re-running is
# safe: every stage checks current state and no-ops when already done.
#
# What it does (each stage idempotent):
#   1. Pick the Thread dongle (a 2nd Silicon Labs radio, DISTINCT from the
#      Zigbee coordinator) and flash it from Zigbee EmberZNet -> OpenThread RCP
#      (ot-rcp) — unless it already runs spinel/ot-rcp.
#   2. Host prep: IPv6 forwarding, BlueZ (bluetoothd) for BLE commissioning,
#      persistent state dirs.
#   3. Write MATTER_THREAD_DEVICE + MATTER_INFRA_IF into /opt/ziggy/.env.
#   4. Bring up the `matter` profile (otbr + matter-server).
#   5. Ensure a Thread network exists (HA-owned dataset) + verify `leader`.
#   6. Wire HA's matter + otbr integrations (config-flow REST). The thread
#      integration auto-activates and holds the preferred dataset.
#   7. Verify the whole chain.
#
# Prereqs: run on the hub, as the `ziggy` user with passwordless sudo, from a
# checkout at /opt/ziggy with the stack already up (ziggy/HA/mosquitto running).
#
# Usage:
#   sudo -v            # (or have NOPASSWD sudo)
#   ./scripts/factory/ziggy-matter-enable.sh                 # auto-detect dongle
#   MATTER_THREAD_DEVICE=/dev/serial/by-id/usb-...  ./scripts/factory/ziggy-matter-enable.sh
#   MATTER_INFRA_IF=eno1 ./scripts/factory/ziggy-matter-enable.sh
#
# See docs/MATTER_THREAD.md for the architecture + manual runbook.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/ziggy}"
ENV_FILE="${ENV_FILE:-$REPO_DIR/.env}"
OT_RCP_URL="${OT_RCP_URL:-https://github.com/darkxst/silabs-firmware-builder/raw/refs/heads/main/firmware_builds/slzb-07/ot-rcp-v2.4.5.0-slzb-07-460800.gbl}"
USF_VENV="${USF_VENV:-$HOME/usf}"
FW_DIR="${FW_DIR:-$HOME/matter-fw}"

_log()  { printf '\033[36m[matter-enable]\033[0m %s\n' "$*"; }
_ok()   { printf '\033[32m[ok]\033[0m %s\n' "$*"; }
_warn() { printf '\033[33m[warn]\033[0m %s\n' "$*"; }
_die()  { printf '\033[31m[die]\033[0m %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || _die "docker not found"
[[ -f "$REPO_DIR/docker-compose.matter.yml" ]] || _die "missing $REPO_DIR/docker-compose.matter.yml (pull the repo)"
docker ps --format '{{.Names}}' | grep -q '^ziggy-ziggy-1$' || _die "ziggy stack not running"

COMPOSE=(docker compose -f "$REPO_DIR/docker-compose.yml" -f "$REPO_DIR/docker-compose.prod.yml" -f "$REPO_DIR/docker-compose.matter.yml" --env-file "$ENV_FILE")
dc() { sudo -n env COMPOSE_PROFILES=matter "${COMPOSE[@]}" "$@"; }

# ---------------------------------------------------------------------------
# 1. Pick + flash the Thread dongle
# ---------------------------------------------------------------------------
ZIGBEE_DEV="$(sudo -n grep -E '^ZIGBEE_COORDINATOR_DEVICE=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"

pick_thread_dongle() {
  [[ -n "${MATTER_THREAD_DEVICE:-}" ]] && { echo "$MATTER_THREAD_DEVICE"; return; }
  # Auto-pick: a Silicon Labs serial in /dev/serial/by-id that is NOT the
  # Zigbee coordinator. Refuse to guess when it's ambiguous.
  local cands=() p
  for p in /dev/serial/by-id/*; do
    [[ -e "$p" ]] || continue
    [[ "$p" == "$ZIGBEE_DEV" ]] && continue
    case "$p" in *SLZB*|*Silicon*|*CP210*|*slzb*) cands+=("$p") ;; esac
  done
  [[ ${#cands[@]} -eq 1 ]] || _die "cannot auto-pick Thread dongle (found ${#cands[@]}); set MATTER_THREAD_DEVICE=<by-id path>. Candidates: ${cands[*]:-none}"
  echo "${cands[0]}"
}

THREAD_DEV="$(pick_thread_dongle)"
[[ -e "$THREAD_DEV" ]] || _die "Thread dongle not present: $THREAD_DEV"
[[ "$THREAD_DEV" != "$ZIGBEE_DEV" ]] || _die "Thread dongle equals the Zigbee coordinator ($THREAD_DEV) — one radio cannot be both. Plug in a SECOND dongle."
_log "Thread dongle: $THREAD_DEV"

ensure_usf() {
  [[ -x "$USF_VENV/bin/universal-silabs-flasher" ]] && return
  _log "installing universal-silabs-flasher"
  sudo -n apt-get install -y python3-venv >/dev/null 2>&1 || true
  python3 -m venv "$USF_VENV"
  "$USF_VENV/bin/pip" install --quiet --upgrade pip
  "$USF_VENV/bin/pip" install --quiet universal-silabs-flasher
}

probe_app() {  # echoes SPINEL / EZSP / etc, or empty
  sudo -n "$USF_VENV/bin/universal-silabs-flasher" --device "$THREAD_DEV" \
    --probe-methods spinel:460800,ezsp:115200,ezsp:460800 probe 2>&1 \
    | grep -oE 'Detected ApplicationType\.[A-Z]+' | head -1 | grep -oE '[A-Z]+$' || true
}

ensure_usf
APP="$(probe_app || true)"
if [[ "$APP" == "SPINEL" ]]; then
  _ok "dongle already runs ot-rcp (spinel) — no flash needed"
else
  _log "dongle app=${APP:-unknown} — flashing ot-rcp"
  mkdir -p "$FW_DIR"; GBL="$FW_DIR/$(basename "$OT_RCP_URL")"
  [[ -s "$GBL" ]] || curl -fsSL -o "$GBL" "$OT_RCP_URL"
  sudo -n "$USF_VENV/bin/universal-silabs-flasher" --device "$THREAD_DEV" flash --firmware "$GBL"
  sleep 3
  [[ "$(probe_app || true)" == "SPINEL" ]] || _die "post-flash probe is not SPINEL — check the dongle"
  _ok "flashed to ot-rcp (spinel)"
fi

# ---------------------------------------------------------------------------
# 2. Host prep
# ---------------------------------------------------------------------------
_log "host prep: IPv6 forwarding + BlueZ + dirs"
printf 'net.ipv6.conf.all.forwarding=1\nnet.ipv4.ip_forward=1\n' | sudo -n tee /etc/sysctl.d/99-ziggy-matter.conf >/dev/null
sudo -n sysctl -q --system >/dev/null 2>&1 || true
sudo -n apt-get install -y bluez >/dev/null 2>&1 || _warn "bluez install failed — BLE commissioning will not work"
# BlueZ MUST run with --experimental: Matter/CHIPoBLE commissioning uses BLE
# GATT features BlueZ only exposes in experimental mode. Without it a device is
# found over BLE but the connection fails (BluezEndpoint "Internal error" /
# "Operation was cancelled"). Ubuntu's unit doesn't enable it by default.
if ! ps -eo args | grep -q "[b]luetoothd .*--experimental"; then
  sudo -n mkdir -p /etc/systemd/system/bluetooth.service.d
  printf "[Service]\nExecStart=\nExecStart=/usr/libexec/bluetooth/bluetoothd --experimental\n" \
    | sudo -n tee /etc/systemd/system/bluetooth.service.d/experimental.conf >/dev/null
  sudo -n systemctl daemon-reload
fi
sudo -n systemctl enable --now bluetooth >/dev/null 2>&1 || _warn "could not start bluetooth.service"
sudo -n systemctl restart bluetooth >/dev/null 2>&1; sleep 2
sudo -n hciconfig hci0 up >/dev/null 2>&1 || true
if ps -eo args | grep -q "[b]luetoothd .*--experimental" && systemctl is-active --quiet bluetooth; then
  _ok "bluetooth active (experimental mode)"
else
  _warn "bluetooth NOT active/experimental (needed for BLE commissioning)"
fi
sudo -n mkdir -p "$REPO_DIR/docker/otbr-data" "$REPO_DIR/docker/matter-data"

# ---------------------------------------------------------------------------
# 3. .env
# ---------------------------------------------------------------------------
INFRA_IF="${MATTER_INFRA_IF:-$(ip -o -4 route show to default | awk '{print $5; exit}')}"
[[ -n "$INFRA_IF" ]] || _die "could not determine LAN NIC; set MATTER_INFRA_IF"
set_env() {  # key value
  if sudo -n grep -q "^$1=" "$ENV_FILE"; then sudo -n sed -i "s#^$1=.*#$1=$2#" "$ENV_FILE";
  else echo "$1=$2" | sudo -n tee -a "$ENV_FILE" >/dev/null; fi
}
set_env MATTER_THREAD_DEVICE "$THREAD_DEV"
set_env MATTER_INFRA_IF "$INFRA_IF"
_ok ".env: MATTER_THREAD_DEVICE + MATTER_INFRA_IF=$INFRA_IF"

# ---------------------------------------------------------------------------
# 4. Bring up otbr + matter-server (does NOT touch ziggy/HA/mosquitto)
# ---------------------------------------------------------------------------
_log "bringing up otbr + matter-server"
dc up -d --no-deps otbr matter-server >/dev/null
# wait for otbr-agent CLI + matter ws
for _ in $(seq 1 20); do docker exec ziggy-otbr ot-ctl state >/dev/null 2>&1 && break; sleep 2; done
docker exec ziggy-otbr ot-ctl state >/dev/null 2>&1 || _die "otbr-agent not responding"
ss -ltn 2>/dev/null | grep -q ':5580' || _die "matter-server not listening on :5580"
_ok "otbr + matter-server up"

# ---------------------------------------------------------------------------
# 5 + 6 + 7. Ensure Thread network + wire HA + verify (delegated to Python
#            inside the ziggy container, which already speaks HA's WS + REST).
# ---------------------------------------------------------------------------
_log "ensuring Thread network + HA integrations"
HA_TOKEN="$(docker exec ziggy-ziggy-1 printenv HA_TOKEN)"
PYSRC=$(cat <<'PY'
import asyncio, json, os, urllib.request, urllib.error
from services.ha_areas import _ws
HA = os.environ.get("HA_LOCAL", "http://localhost:8123"); TOK = os.environ["HA_TOKEN"]
def rest(path, body=None, method="GET"):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(HA+path, data=data, method=method,
        headers={"Authorization":"Bearer "+TOK,"Content-Type":"application/json"})
    try: return urllib.request.urlopen(req, timeout=30).status, json.loads(urllib.request.urlopen(req,timeout=30).read() or "{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or "{}")
        except Exception: return e.code, {}
async def one(msg):
    r = await _ws(msg, timeout=40.0); return r[0] if isinstance(r,(list,tuple)) else r
async def add_entry(handler, url_key, url):
    # skip if a loaded entry already exists
    _, entries = rest("/api/config/config_entries/entry")
    if any(e["domain"]==handler for e in entries): return f"{handler}: exists"
    s,f = rest("/api/config/config_entries/flow", {"handler":handler,"show_advanced_options":True}, "POST")
    if f.get("type")!="form": return f"{handler}: {f.get('reason') or f}"
    fid=f["flow_id"]; sid=f.get("step_id")
    if sid=="on_supervisor":
        s,f = rest("/api/config/config_entries/flow/"+fid, {"use_addon":False}, "POST"); fid=f.get("flow_id",fid)
    s,f = rest("/api/config/config_entries/flow/"+fid, {url_key:url}, "POST")
    return f"{handler}: {f.get('type')}"
async def go():
    print("HA:", await add_entry("matter","url","ws://127.0.0.1:5580/ws"))
    print("HA:", await add_entry("otbr","url","http://127.0.0.1:8081"))
    await asyncio.sleep(4)
    # ensure a Thread network exists + is the sole preferred dataset synced to OTBR
    info = await one({"type":"otbr/info"}); r=info.get("result",{})
    ext = next(iter(r.keys()), None)
    if ext and not r[ext].get("active_dataset_tlvs"):
        print("thread:", await one({"type":"otbr/create_network","extended_address":ext}))
        await asyncio.sleep(6)
    ds = (await one({"type":"thread/list_datasets"})).get("result",{}).get("datasets",[])
    otbr_tlv = (next(iter((await one({"type":"otbr/info"})).get("result",{}).values()),{}) ).get("active_dataset_tlvs","").upper()
    match = next((d for d in ds if (await one({"type":"thread/get_dataset_tlv","dataset_id":d["dataset_id"]})).get("result",{}).get("tlv","").upper()==otbr_tlv), None)
    if match and not match.get("preferred"):
        await one({"type":"thread/set_preferred_dataset","dataset_id":match["dataset_id"]})
    _, entries = rest("/api/config/config_entries/entry")
    st = {e["domain"]:e["state"] for e in entries if e["domain"] in ("matter","thread","otbr")}
    print("entries:", st)
    print("preferred_synced:", bool(match))
    ok = st.get("matter")=="loaded" and st.get("thread")=="loaded" and st.get("otbr")=="loaded" and bool(match)
    print("CHAIN_OK:", ok)
asyncio.run(go())
PY
)
B64=$(printf '%s' "$PYSRC" | base64 | tr -d '\n')
RESULT="$(docker exec -e HA_TOKEN="$HA_TOKEN" ziggy-ziggy-1 sh -c "echo $B64 | base64 -d | python" 2>&1)"
echo "$RESULT" | sed 's/^/  /'
echo "$RESULT" | grep -q 'CHAIN_OK: True' || _die "chain verification failed — see output above"

echo -n "  otbr thread state: "; docker exec ziggy-otbr ot-ctl state 2>&1 | head -1
_ok "Matter + Thread enabled. Pair a device from Ziggy (Add device → Matter) or via the app's Matter tab."
