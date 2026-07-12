#!/usr/bin/env bash
# scripts/ha-seed.sh — HEADLESS Home Assistant onboarding + long-lived token.
#
# Drives a FRESH Home Assistant container through onboarding entirely over the
# REST/WS API — zero web-UI interaction — then mints a long-lived access token
# (LLAT) that Ziggy uses to talk to HA. Optionally creates the MQTT broker
# config entry with the imaging-generated credentials.
#
# Sequence (verified against HA onboarding views + auth docs):
#   1. GET  /api/onboarding                → check steps
#   2. POST /api/onboarding/users          → create owner, get auth_code
#   3. POST /auth/token (authorization_code)→ short-lived access_token
#   4. POST /api/onboarding/core_config|analytics|integration (Bearer)
#   5. WS   /api/websocket auth/long_lived_access_token → LLAT
#   6. (--with-mqtt) create MQTT config entry via config_entries flow
#
# Uses ONLY python3 stdlib (socket-based WebSocket client) + curl — no pip
# install on the hub required.
#
# USAGE
#   scripts/ha-seed.sh [--check] [--with-mqtt] [--env-out PATH] [--token-out PATH]
#
# ENV
#   HA_URL            default http://localhost:8123  (host perspective; HA is
#                     host-networked on the hub)
#   HA_ADMIN_USER     default ziggy
#   HA_ADMIN_PASS     required (owner password) unless --check
#   HA_ADMIN_NAME     default "Ziggy"
#   HA_LANG           default he
#   LLAT_CLIENT_NAME  default "Ziggy Backend"
#   LLAT_LIFESPAN_DAYS default 3650
#   --with-mqtt uses: MQTT_USER MQTT_PASS MQTT_HOST(default localhost) MQTT_PORT(1883)
#
# OUTPUT
#   --env-out PATH    upsert `HA_TOKEN=<llat>` (and HA_URL) into a .env file
#   --token-out PATH  write the raw LLAT to a file (mode 0600)
#   default           print the LLAT to stdout
#
# EXIT: 0 ok, 1 failure, 2 bad args.

set -euo pipefail

HA_URL="${HA_URL:-http://localhost:8123}"
HA_ADMIN_USER="${HA_ADMIN_USER:-ziggy}"
HA_ADMIN_NAME="${HA_ADMIN_NAME:-Ziggy}"
HA_LANG="${HA_LANG:-he}"
LLAT_CLIENT_NAME="${LLAT_CLIENT_NAME:-Ziggy Backend}"
LLAT_LIFESPAN_DAYS="${LLAT_LIFESPAN_DAYS:-3650}"
CLIENT_ID="${HA_URL%/}/"

MODE_CHECK=0
WITH_MQTT=0
ENV_OUT=""
TOKEN_OUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) MODE_CHECK=1 ;;
    --with-mqtt) WITH_MQTT=1 ;;
    --env-out) ENV_OUT="${2:?--env-out needs a path}"; shift ;;
    --token-out) TOKEN_OUT="${2:?--token-out needs a path}"; shift ;;
    -h|--help) grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

_log() { printf '[ha-seed] %s\n' "$*" >&2; }
_die() { printf '[ha-seed] ERROR: %s\n' "$*" >&2; exit 1; }

command -v curl    >/dev/null || _die "curl not found"
command -v python3 >/dev/null || _die "python3 not found"

# --- wait for HA to answer ---------------------------------------------------
_wait_ha() {
  local deadline=$(( $(date +%s) + 180 ))
  until curl -sf "$HA_URL/api/onboarding" >/dev/null 2>&1; do
    [[ $(date +%s) -gt $deadline ]] && _die "HA not reachable at $HA_URL after 180s"
    sleep 3
  done
}

# --- --check: reachability + onboarding status, no mutation ------------------
# Quick probe (single attempt, short timeout) — never the 180s onboarding wait,
# so it is safe to call from dry-runs / CI where HA may be down.
if [[ "$MODE_CHECK" == "1" ]]; then
  if ! curl -sf --max-time "${HA_CHECK_TIMEOUT:-5}" "$HA_URL/api/onboarding" >/dev/null 2>&1; then
    _log "HA not reachable at $HA_URL (within ${HA_CHECK_TIMEOUT:-5}s)"
    echo "unreachable"
    exit 1
  fi
  status_json="$(curl -sf --max-time "${HA_CHECK_TIMEOUT:-5}" "$HA_URL/api/onboarding" || echo '[]')"
  user_done="$(printf '%s' "$status_json" | python3 -c '
import json,sys
try: steps=json.load(sys.stdin)
except Exception: steps=[]
d={s.get("step"):s.get("done") for s in steps} if isinstance(steps,list) else {}
print("done" if d.get("user") else "pending")
')"
  _log "HA reachable at $HA_URL; owner-onboarding=$user_done"
  echo "$user_done"
  exit 0
fi

[[ -n "${HA_ADMIN_PASS:-}" ]] || _die "HA_ADMIN_PASS is required (owner password)"

_wait_ha

# --- 1. onboarding status ----------------------------------------------------
STEPS_JSON="$(curl -sf "$HA_URL/api/onboarding" || echo '[]')"
USER_DONE="$(printf '%s' "$STEPS_JSON" | python3 -c '
import json,sys
try: steps=json.load(sys.stdin)
except Exception: steps=[]
d={s.get("step"):s.get("done") for s in steps} if isinstance(steps,list) else {}
print("1" if d.get("user") else "0")
')"

if [[ "$USER_DONE" == "1" ]]; then
  # Owner already exists — onboarding cannot be re-run. We can't recover the
  # short-lived auth_code path, so this is only safe on a truly fresh HA.
  _die "HA owner already onboarded — refusing to re-seed. Wipe docker/ha-config/.storage for a fresh image, or mint a token via the UI."
fi

# --- 2. create owner → auth_code --------------------------------------------
_log "creating owner user '$HA_ADMIN_USER'"
USERS_BODY="$(HA_ADMIN_NAME="$HA_ADMIN_NAME" HA_ADMIN_USER="$HA_ADMIN_USER" \
  HA_ADMIN_PASS="$HA_ADMIN_PASS" CLIENT_ID="$CLIENT_ID" HA_LANG="$HA_LANG" \
  python3 -c 'import json,os; print(json.dumps({
    "name": os.environ["HA_ADMIN_NAME"],
    "username": os.environ["HA_ADMIN_USER"],
    "password": os.environ["HA_ADMIN_PASS"],
    "client_id": os.environ["CLIENT_ID"],
    "language": os.environ["HA_LANG"],
  }))')"
AUTH_CODE="$(curl -sf -X POST "$HA_URL/api/onboarding/users" \
  -H "Content-Type: application/json" -d "$USERS_BODY" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["auth_code"])')"
[[ -n "$AUTH_CODE" ]] || _die "onboarding/users returned no auth_code"

# --- 3. exchange auth_code → access_token (form-encoded!) --------------------
ACCESS_TOKEN="$(curl -sf -X POST "$HA_URL/auth/token" \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "code=$AUTH_CODE" \
  --data-urlencode "client_id=$CLIENT_ID" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')"
[[ -n "$ACCESS_TOKEN" ]] || _die "/auth/token returned no access_token"
_log "short-lived access token obtained"

# --- 4. finish remaining onboarding steps (Bearer required) ------------------
# M3: Bearer token read from a process-substitution file (not argv — argv is
# world-visible in ps/proc).
curl -sf -X POST "$HA_URL/api/onboarding/core_config" \
  -H @<(printf 'Authorization: Bearer %s' "$ACCESS_TOKEN") >/dev/null || _log "core_config step warn"
curl -sf -X POST "$HA_URL/api/onboarding/analytics" \
  -H @<(printf 'Authorization: Bearer %s' "$ACCESS_TOKEN") >/dev/null || _log "analytics step warn"
# L2: build the JSON body with json.dumps (no shell string interpolation).
INTEGRATION_BODY="$(CLIENT_ID="$CLIENT_ID" python3 -c 'import json,os; print(json.dumps({"client_id":os.environ["CLIENT_ID"],"redirect_uri":os.environ["CLIENT_ID"]}))')"
curl -sf -X POST "$HA_URL/api/onboarding/integration" \
  -H @<(printf 'Authorization: Bearer %s' "$ACCESS_TOKEN") -H "Content-Type: application/json" \
  -d "$INTEGRATION_BODY" >/dev/null \
  || _log "integration step warn (harmless headless)"
_log "onboarding steps completed"

# --- 5. mint LLAT over WebSocket (stdlib-only client) ------------------------
LLAT="$(HA_WS_URL="${HA_URL/http/ws}/api/websocket" ACCESS_TOKEN="$ACCESS_TOKEN" \
  LLAT_CLIENT_NAME="$LLAT_CLIENT_NAME" LLAT_LIFESPAN_DAYS="$LLAT_LIFESPAN_DAYS" \
  python3 - <<'PY'
import base64, json, os, socket, ssl, struct, sys
from urllib.parse import urlparse

url = os.environ["HA_WS_URL"]
u = urlparse(url)
host = u.hostname
port = u.port or (443 if u.scheme == "wss" else 80)
path = u.path or "/api/websocket"

sock = socket.create_connection((host, port), timeout=30)
if u.scheme == "wss":
    sock = ssl.create_default_context().wrap_socket(sock, server_hostname=host)

key = base64.b64encode(os.urandom(16)).decode()
req = (f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\n"
       f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
       f"Sec-WebSocket-Version: 13\r\n\r\n")
sock.sendall(req.encode())

buf = b""
while b"\r\n\r\n" not in buf:
    chunk = sock.recv(4096)
    if not chunk:
        print("", end=""); sys.exit("ws handshake failed")
    buf += chunk
if b" 101 " not in buf.split(b"\r\n", 1)[0]:
    sys.exit("ws upgrade rejected: " + buf.split(b"\r\n",1)[0].decode(errors="replace"))
leftover = buf.split(b"\r\n\r\n", 1)[1]

def send_text(s, payload):
    data = payload.encode()
    hdr = bytearray([0x81])  # FIN + text
    n = len(data)
    mask_bit = 0x80
    if n < 126:
        hdr.append(mask_bit | n)
    elif n < 65536:
        hdr.append(mask_bit | 126); hdr += struct.pack("!H", n)
    else:
        hdr.append(mask_bit | 127); hdr += struct.pack("!Q", n)
    mask = os.urandom(4)
    hdr += mask
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
    s.sendall(bytes(hdr) + masked)

_recv_buf = bytearray(leftover)
def _fill(s, n):
    while len(_recv_buf) < n:
        chunk = s.recv(4096)
        if not chunk:
            raise RuntimeError("ws closed")
        _recv_buf.extend(chunk)

def recv_text(s):
    _fill(s, 2)
    b0, b1 = _recv_buf[0], _recv_buf[1]
    masked = b1 & 0x80
    ln = b1 & 0x7F
    idx = 2
    if ln == 126:
        _fill(s, 4); ln = struct.unpack("!H", bytes(_recv_buf[2:4]))[0]; idx = 4
    elif ln == 127:
        _fill(s, 10); ln = struct.unpack("!Q", bytes(_recv_buf[2:10]))[0]; idx = 10
    mask = b""
    if masked:
        _fill(s, idx + 4); mask = bytes(_recv_buf[idx:idx+4]); idx += 4
    _fill(s, idx + ln)
    payload = bytes(_recv_buf[idx:idx+ln])
    del _recv_buf[:idx+ln]
    if masked:
        payload = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
    return payload.decode()

msg = json.loads(recv_text(sock))
assert msg.get("type") == "auth_required", msg
send_text(sock, json.dumps({"type": "auth", "access_token": os.environ["ACCESS_TOKEN"]}))
msg = json.loads(recv_text(sock))
assert msg.get("type") == "auth_ok", msg
send_text(sock, json.dumps({
    "id": 1, "type": "auth/long_lived_access_token",
    "client_name": os.environ["LLAT_CLIENT_NAME"],
    "lifespan": int(os.environ["LLAT_LIFESPAN_DAYS"]),
}))
while True:
    msg = json.loads(recv_text(sock))
    if msg.get("type") == "result":
        assert msg.get("success"), msg
        print(msg["result"])
        break
sock.close()
PY
)"
[[ -n "$LLAT" ]] || _die "failed to mint long-lived access token"
_log "long-lived access token minted (lifespan ${LLAT_LIFESPAN_DAYS}d)"

# --- 6. optional MQTT config entry ------------------------------------------
if [[ "$WITH_MQTT" == "1" ]]; then
  : "${MQTT_USER:?--with-mqtt needs MQTT_USER}"
  : "${MQTT_PASS:?--with-mqtt needs MQTT_PASS}"
  MQTT_HOST="${MQTT_HOST:-localhost}"
  MQTT_PORT="${MQTT_PORT:-1883}"
  _log "creating MQTT config entry (broker $MQTT_HOST:$MQTT_PORT)"
  # Start the mqtt config flow, then submit broker creds. HA returns a
  # flow_id; the broker step accepts broker/port/username/password.
  FLOW="$(curl -sf -X POST "$HA_URL/api/config/config_entries/flow" \
      -H @<(printf 'Authorization: Bearer %s' "$LLAT") -H "Content-Type: application/json" \
      -d '{"handler":"mqtt","show_advanced_options":false}' || echo '{}')"
  FLOW_ID="$(printf '%s' "$FLOW" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("flow_id",""))
except Exception: print("")')"
  if [[ -z "$FLOW_ID" ]]; then
    _log "WARN: could not start MQTT config flow (already configured?). Response: $FLOW"
  else
    STEP_BODY="$(MQTT_HOST="$MQTT_HOST" MQTT_PORT="$MQTT_PORT" \
      MQTT_USER="$MQTT_USER" MQTT_PASS="$MQTT_PASS" python3 -c 'import json,os; print(json.dumps({
        "broker": os.environ["MQTT_HOST"],
        "port": int(os.environ["MQTT_PORT"]),
        "username": os.environ["MQTT_USER"],
        "password": os.environ["MQTT_PASS"],
      }))')"
    RES="$(curl -sf -X POST "$HA_URL/api/config/config_entries/flow/$FLOW_ID" \
        -H @<(printf 'Authorization: Bearer %s' "$LLAT") -H "Content-Type: application/json" \
        -d "$STEP_BODY" || echo '{}')"
    TYPE="$(printf '%s' "$RES" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("type",""))
except Exception: print("")')"
    if [[ "$TYPE" == "create_entry" ]]; then
      _log "MQTT config entry created"
    else
      _log "WARN: MQTT flow did not create_entry (type=$TYPE). Response: $RES"
    fi
  fi
fi

# --- output ------------------------------------------------------------------
# M2: token/env files hold the LLAT — create them 0600 from birth (no
# world-readable window before chmod 600).
umask 077
if [[ -n "$TOKEN_OUT" ]]; then
  printf '%s' "$LLAT" > "$TOKEN_OUT"; chmod 600 "$TOKEN_OUT"
  _log "wrote raw token → $TOKEN_OUT"
fi
if [[ -n "$ENV_OUT" ]]; then
  touch "$ENV_OUT"
  # upsert HA_TOKEN and HA_URL
  python3 - "$ENV_OUT" "$LLAT" "$HA_URL" <<'PY'
import sys
path, token, url = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(path).read().splitlines() if __import__("os").path.exists(path) else []
kv = {"HA_TOKEN": token, "HA_URL": url}
out, seen = [], set()
for ln in lines:
    k = ln.split("=", 1)[0].strip() if "=" in ln else None
    if k in kv:
        out.append(f"{k}={kv[k]}"); seen.add(k)
    else:
        out.append(ln)
for k, v in kv.items():
    if k not in seen:
        out.append(f"{k}={v}")
open(path, "w").write("\n".join(out) + "\n")
PY
  chmod 600 "$ENV_OUT"
  _log "upserted HA_TOKEN + HA_URL → $ENV_OUT"
fi
if [[ -z "$TOKEN_OUT" && -z "$ENV_OUT" ]]; then
  printf '%s\n' "$LLAT"
fi
_log "done"
