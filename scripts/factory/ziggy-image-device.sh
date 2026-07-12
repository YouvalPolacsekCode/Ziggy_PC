#!/usr/bin/env bash
# scripts/factory/ziggy-image-device.sh
# ═══════════════════════════════════════════════════════════════════════════
# THE factory imaging entrypoint. Turns a generic Ubuntu 24.04 hub with the
# Ziggy repo at /opt/ziggy into a shippable, sealed, kit-ready Ziggy hub.
#
# It is STRUCTURED (numbered steps), RESUMABLE (a state file records completed
# steps; re-running skips them) and supports --dry-run (exercises everything
# testable without relay/master-key/hardware, writing to a sandbox).
#
# STEPS
#   0  preflight      tools present, repo + compose files exist
#   1  identity       generate uuid; provision home in relay; adopt home_id
#   2  mqtt-creds     generate MQTT user/pass → mosquitto passwordfile + secrets
#   3  env            write /opt/ziggy/.env (HOME_ID, RELAY_*, MQTT_URL, pins…)
#   4  stack-up       docker compose up mosquitto + homeassistant (+z2m if kit)
#   5  ha-seed        headless HA onboarding + LLAT + MQTT config entry
#   6  seal           _seal_step.sh: data_key + kit_manifest + relay seal-key
#   7  register-hub   bind tunnel_url to the home (HMAC) → status active
#   8  ziggy-up       docker compose up the ziggy backend
#   9  kit-ready      kit-ready-check.sh gate
#   10 first-backup   one REAL backup to B2 (the ship signal)
#
# USAGE
#   sudo scripts/factory/ziggy-image-device.sh              # full run
#   scripts/factory/ziggy-image-device.sh --dry-run         # no hardware/relay
#   scripts/factory/ziggy-image-device.sh --resume          # continue after fail
#   scripts/factory/ziggy-image-device.sh --from seal       # force-start at step
#   scripts/factory/ziggy-image-device.sh --list            # list steps + state
#
# REQUIRED ENV (real run; NEVER hardcode — inject at imaging):
#   RELAY_ADMIN_EMAIL / RELAY_ADMIN_PASSWORD   founder relay login (or prompted)
#   MASTER_KEY_B64                             founder master key (or prompted, hidden)
#   B2_KEY_ID / B2_APP_KEY                     per-home Backblaze app key (§4)
#   HA_ADMIN_PASS                              HA owner password (generated if unset)
#   COORDINATOR_TYPE  (smlight|sonoff_e)       from the kit manifest sheet
#   COORDINATOR_IEEE                           read from the coordinator after pairing
# OPTIONAL ENV (safe defaults):
#   RELAY_URL=https://ziggy-relay.fly.dev  HOME_NAME  OWNER_EMAIL
#   HA_VERSION MOSQUITTO_VERSION Z2M_VERSION TZ=Asia/Jerusalem
#   B2_BUCKET=ziggy-backups-prod  B2_ENDPOINT=https://s3.eu-central-003.backblazeb2.com
#   ZIGBEE_COORDINATOR_DEVICE  ENABLE_ZIGBEE=1
#   ZIGGY_REPO_DIR=/opt/ziggy  ZIGGY_ETC_DIR=/etc/ziggy  ZIGGY_ENV_FILE=/opt/ziggy/.env
#   GIT_SHA
#
# EXIT: 0 kit ready; 1 a step failed (fatal); 2 bad args.
# ═══════════════════════════════════════════════════════════════════════════

set -uo pipefail

# ── config / paths ──────────────────────────────────────────────────────────
DRY_RUN=0
RESUME=0
FROM_STEP=""
LIST=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --resume)  RESUME=1 ;;
    --from)    FROM_STEP="${2:?--from needs a step name}"; shift ;;
    --list)    LIST=1 ;;
    -h|--help) grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

# M2: every secret this script writes (/opt/ziggy/.env, sandbox env, state) is
# created mode 0600 from birth — no world-readable window before an explicit chmod.
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPO_DIR="${ZIGGY_REPO_DIR:-$DEFAULT_REPO}"

RELAY_URL="${RELAY_URL:-https://ziggy-relay.fly.dev}"
HOME_NAME="${HOME_NAME:-Ziggy Home}"
OWNER_EMAIL="${OWNER_EMAIL:-}"
TZ_VAL="${TZ:-Asia/Jerusalem}"
HA_VERSION="${HA_VERSION:-2026.6.1}"
MOSQUITTO_VERSION="${MOSQUITTO_VERSION:-2.0.20}"
Z2M_VERSION="${Z2M_VERSION:-2.1.1}"
B2_BUCKET="${B2_BUCKET:-ziggy-backups-prod}"
B2_ENDPOINT="${B2_ENDPOINT:-https://s3.eu-central-003.backblazeb2.com}"
COORDINATOR_TYPE="${COORDINATOR_TYPE:-smlight}"
COORDINATOR_IEEE="${COORDINATOR_IEEE:-}"
ENABLE_ZIGBEE="${ENABLE_ZIGBEE:-0}"
GIT_SHA="${GIT_SHA:-dev}"
MQTT_USER="${MQTT_USER:-ziggy}"

if [[ "$DRY_RUN" == "1" ]]; then
  SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/ziggy-image.XXXXXX")"
  ETC_DIR="$SANDBOX/etc-ziggy"
  ENV_FILE="$SANDBOX/env"
  STATE_DIR="$SANDBOX/state"
else
  ETC_DIR="${ZIGGY_ETC_DIR:-/etc/ziggy}"
  ENV_FILE="${ZIGGY_ENV_FILE:-/opt/ziggy/.env}"
  STATE_DIR="$ETC_DIR"
fi
STATE_FILE="$STATE_DIR/imaging.state"

STEPS=(preflight identity mqtt-creds env stack-up ha-seed seal register-hub ziggy-up kit-ready first-backup)

_log()  { printf '\033[36m[image]\033[0m %s\n' "$*" >&2; }
_ok()   { printf '\033[32m[image ✓]\033[0m %s\n' "$*" >&2; }
_die()  { printf '\033[31m[image ✗]\033[0m %s\n' "$*" >&2; exit 1; }
_maybe_sudo() {
  if [[ "$DRY_RUN" != "1" && ( "$ETC_DIR" == /etc/* || "${ENV_FILE%/*}" == /opt/* ) && "$(id -u)" != "0" ]]; then
    sudo "$@"; else "$@"; fi
}

mkdir -p "$STATE_DIR" 2>/dev/null || _maybe_sudo mkdir -p "$STATE_DIR"
_maybe_sudo touch "$STATE_FILE" 2>/dev/null || true

_state_done() { grep -qx "$1" "$STATE_FILE" 2>/dev/null; }
_mark_done()  { _state_done "$1" || echo "$1" | _maybe_sudo tee -a "$STATE_FILE" >/dev/null; }

if [[ "$LIST" == "1" ]]; then
  echo "Steps (state: $STATE_FILE):"
  for s in "${STEPS[@]}"; do
    if _state_done "$s"; then echo "  [x] $s"; else echo "  [ ] $s"; fi
  done
  exit 0
fi

# Persist small key/values across steps (home_id, relay_secret, tunnel_url…)
KV_FILE="$STATE_DIR/imaging.kv"
_maybe_sudo touch "$KV_FILE" 2>/dev/null || true
_kv_set() { _maybe_sudo sed -i.bak "/^$1=/d" "$KV_FILE" 2>/dev/null; echo "$1=$2" | _maybe_sudo tee -a "$KV_FILE" >/dev/null; _maybe_sudo rm -f "$KV_FILE.bak" 2>/dev/null || true; }
_kv_get() { grep -E "^$1=" "$KV_FILE" 2>/dev/null | tail -1 | cut -d= -f2-; }

# Decide whether to run a given step given --from / --resume / state.
_should_run() {
  local step="$1"
  if [[ -n "$FROM_STEP" ]]; then
    # run this step only if it's at/after FROM_STEP
    local reached=0 s
    for s in "${STEPS[@]}"; do
      [[ "$s" == "$FROM_STEP" ]] && reached=1
      [[ "$s" == "$step" ]] && { [[ "$reached" == "1" ]] && return 0 || return 1; }
    done
  fi
  if [[ "$RESUME" == "1" || "$DRY_RUN" == "0" ]]; then
    _state_done "$step" && return 1
  fi
  return 0
}

_need() { [[ -n "${!1:-}" ]] || _die "required env \$$1 is not set (see --help). Dry-run: use --dry-run."; }

# ═══════════════════════════════════════════════════════════════════════════
# STEP 0: preflight
# ═══════════════════════════════════════════════════════════════════════════
step_preflight() {
  for t in curl python3 jq base64 head; do command -v "$t" >/dev/null || _die "missing tool: $t"; done
  python3 -c 'import cryptography' 2>/dev/null || _die "python3 'cryptography' missing (pip install cryptography)"
  [[ -f "$REPO_DIR/docker-compose.yml" ]] || _die "docker-compose.yml not found in $REPO_DIR"
  [[ -f "$REPO_DIR/docker-compose.prod.yml" ]] || _die "docker-compose.prod.yml not found in $REPO_DIR"
  [[ -f "$SCRIPT_DIR/_seal_step.sh" ]] || _die "_seal_step.sh missing"
  [[ -f "$REPO_DIR/scripts/ha-seed.sh" ]] || _die "scripts/ha-seed.sh missing"
  if [[ "$DRY_RUN" != "1" ]]; then command -v docker >/dev/null || _die "docker not installed"; fi
  _ok "preflight ok (repo=$REPO_DIR, dry_run=$DRY_RUN)"
}

# ═══════════════════════════════════════════════════════════════════════════
# STEP 1: identity — generate uuid; provision home in relay; adopt home_id
# ───────────────────────────────────────────────────────────────────────────
# CONTRACT NOTE (Stream 3): the SHARED identity model is DEVICE_ID==HOME_ID==
# uuidv4(lowercase). But today's relay POST /api/provision/hub GENERATES its own
# id (`home-<uuid>`) and does NOT accept a supplied home_id. So we send our uuid
# as `home_id` (forward-compatible; ignored by today's relay) and ADOPT whatever
# the relay returns as the canonical DEVICE_ID/HOME_ID. When Stream 3 teaches the
# relay to honor a supplied home_id, the two will match and the bare-uuid form is
# preserved. See report → patches for Stream 3.
# ═══════════════════════════════════════════════════════════════════════════
step_identity() {
  local local_uuid
  local_uuid="$( (command -v uuidgen >/dev/null && uuidgen || python3 -c 'import uuid;print(uuid.uuid4())') | tr 'A-Z' 'a-z')"
  _kv_set LOCAL_UUID "$local_uuid"

  if [[ "$DRY_RUN" == "1" ]]; then
    _kv_set HOME_ID "$local_uuid"
    _kv_set RELAY_SECRET "dry-run-secret"
    _kv_set TUNNEL_URL "https://dry-run.example"
    _ok "identity (dry-run): HOME_ID=$local_uuid (no relay call)"
    return 0
  fi

  # Founder login → JWT
  : "${RELAY_ADMIN_EMAIL:=}"; : "${RELAY_ADMIN_PASSWORD:=}"
  if [[ -z "$RELAY_ADMIN_EMAIL" ]]; then read -rp "Relay admin email: " RELAY_ADMIN_EMAIL; fi
  if [[ -z "$RELAY_ADMIN_PASSWORD" ]]; then read -rsp "Relay admin password: " RELAY_ADMIN_PASSWORD; echo; fi
  local login_body jwt
  login_body="$(RE="$RELAY_ADMIN_EMAIL" RP="$RELAY_ADMIN_PASSWORD" python3 -c 'import json,os;print(json.dumps({"email":os.environ["RE"],"password":os.environ["RP"]}))')"
  jwt="$(curl -fsS -X POST "$RELAY_URL/api/auth/login" -H 'Content-Type: application/json' -d "$login_body" \
        | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')" || _die "relay login failed"
  [[ -n "$jwt" ]] || _die "relay login returned no token"
  _kv_set FOUNDER_JWT "$jwt"

  # Provision hub (send our uuid as home_id — forward-compat; adopt what returns)
  local prov_body prov_resp home_id relay_secret tunnel_url
  prov_body="$(HN="$HOME_NAME" OE="$OWNER_EMAIL" HID="$local_uuid" python3 -c 'import json,os;print(json.dumps({"home_name":os.environ["HN"],"owner_email":(os.environ["OE"] or None),"home_id":os.environ["HID"]}))')"
  prov_resp="$(curl -fsS -X POST "$RELAY_URL/api/provision/hub" -H "Authorization: Bearer $jwt" -H 'Content-Type: application/json' -d "$prov_body")" || _die "provision/hub failed"
  home_id="$(printf '%s' "$prov_resp" | python3 -c 'import json,sys;print(json.load(sys.stdin)["home_id"])')"
  relay_secret="$(printf '%s' "$prov_resp" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("relay_secret",""))')"
  tunnel_url="$(printf '%s' "$prov_resp" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("tunnel_url",""))')"
  [[ -n "$home_id" ]] || _die "provision/hub returned no home_id"
  if [[ "$home_id" != "$local_uuid" ]]; then
    _log "NOTE: relay assigned home_id=$home_id (differs from local uuid $local_uuid). Adopting relay id as canonical (see Stream 3 contract note)."
  fi
  _kv_set HOME_ID "$home_id"
  _kv_set RELAY_SECRET "$relay_secret"
  _kv_set TUNNEL_URL "$tunnel_url"
  _ok "identity: HOME_ID=$home_id  tunnel=$tunnel_url"
}

# ═══════════════════════════════════════════════════════════════════════════
# STEP 2: mqtt-creds — generate password, hash into mosquitto passwordfile,
#         write HA secrets.yaml, wire Z2M config if present.
# ═══════════════════════════════════════════════════════════════════════════
step_mqtt_creds() {
  local mqtt_pass
  mqtt_pass="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
  _kv_set MQTT_USER "$MQTT_USER"
  _kv_set MQTT_PASS "$mqtt_pass"

  local pwfile="$REPO_DIR/docker/mosquitto/passwordfile"
  if [[ "$DRY_RUN" == "1" ]]; then
    pwfile="$SANDBOX/passwordfile"
    if command -v docker >/dev/null 2>&1; then
      docker run --rm -v "$SANDBOX:/pw" "eclipse-mosquitto:${MOSQUITTO_VERSION}" \
        mosquitto_passwd -b -c /pw/passwordfile "$MQTT_USER" "$mqtt_pass" >/dev/null 2>&1 \
        && _ok "mqtt-creds (dry-run): hashed passwordfile → $pwfile" \
        || _log "mqtt-creds (dry-run): docker unavailable, skipped hashing (would run mosquitto_passwd)"
    else
      _log "mqtt-creds (dry-run): docker unavailable, skipped hashing"
    fi
    return 0
  fi

  docker run --rm -v "$REPO_DIR/docker/mosquitto:/pw" "eclipse-mosquitto:${MOSQUITTO_VERSION}" \
    mosquitto_passwd -b -c /pw/passwordfile "$MQTT_USER" "$mqtt_pass" >/dev/null \
    || _die "mosquitto_passwd failed"
  chmod 640 "$pwfile" 2>/dev/null || true

  # HA secrets.yaml from template
  local sec_tmpl="$REPO_DIR/docker/ha-config/secrets.yaml.template"
  local sec="$REPO_DIR/docker/ha-config/secrets.yaml"
  if [[ -f "$sec_tmpl" ]]; then
    sed -e "s#^mqtt_username:.*#mqtt_username: $MQTT_USER#" \
        -e "s#^mqtt_password:.*#mqtt_password: $mqtt_pass#" "$sec_tmpl" > "$sec"
    chmod 640 "$sec" 2>/dev/null || true
  fi
  _ok "mqtt-creds: passwordfile + HA secrets.yaml written (user=$MQTT_USER)"
}

# ═══════════════════════════════════════════════════════════════════════════
# STEP 3: env — write the hub's .env consumed by docker-compose.prod.yml
# ═══════════════════════════════════════════════════════════════════════════
step_env() {
  local home_id relay_secret tunnel_url mqtt_pass
  home_id="$(_kv_get HOME_ID)"; relay_secret="$(_kv_get RELAY_SECRET)"
  tunnel_url="$(_kv_get TUNNEL_URL)"; mqtt_pass="$(_kv_get MQTT_PASS)"
  local zdev="${ZIGBEE_COORDINATOR_DEVICE:-/dev/serial/by-id/usb-Itead_Sonoff_Zigbee_3.0_USB_Dongle_Plus_V2-if00-port0}"

  _maybe_sudo mkdir -p "$(dirname "$ENV_FILE")"
  _maybe_sudo tee "$ENV_FILE" >/dev/null <<EOF
# Generated by ziggy-image-device.sh $(date -u +%Y-%m-%dT%H:%M:%SZ) — do NOT commit.
TZ=$TZ_VAL
HA_VERSION=$HA_VERSION
MOSQUITTO_VERSION=$MOSQUITTO_VERSION
Z2M_VERSION=$Z2M_VERSION
GIT_SHA=$GIT_SHA
HOME_ID=$home_id
HOME_NAME=$HOME_NAME
HOME_TYPE=hub
CLOUD_MODE=false
RELAY_URL=$RELAY_URL
RELAY_SECRET=$relay_secret
TUNNEL_URL=$tunnel_url
HA_URL=http://localhost:8123
MQTT_URL=mqtt://$MQTT_USER:$mqtt_pass@localhost:1883
ZIGBEE_COORDINATOR_DEVICE=$zdev
EOF
  # B2 env for the backup engine (also written to $ETC_DIR/b2_env by seal step).
  if [[ -n "${ZIGGY_B2_KEY_ID:-}" ]]; then echo "ZIGGY_B2_KEY_ID=${ZIGGY_B2_KEY_ID}" | _maybe_sudo tee -a "$ENV_FILE" >/dev/null; fi
  if [[ -n "${ZIGGY_B2_APP_KEY:-}" ]]; then echo "ZIGGY_B2_APP_KEY=${ZIGGY_B2_APP_KEY}" | _maybe_sudo tee -a "$ENV_FILE" >/dev/null; fi
  if [[ -n "${B2_KEY_ID:-}" ]]; then echo "ZIGGY_B2_KEY_ID=${B2_KEY_ID}" | _maybe_sudo tee -a "$ENV_FILE" >/dev/null; fi
  if [[ -n "${B2_APP_KEY:-}" ]]; then echo "ZIGGY_B2_APP_KEY=${B2_APP_KEY}" | _maybe_sudo tee -a "$ENV_FILE" >/dev/null; fi
  _maybe_sudo chmod 600 "$ENV_FILE"
  _ok "env: wrote $ENV_FILE"
}

_compose() {
  local args=(-f "$REPO_DIR/docker-compose.yml" -f "$REPO_DIR/docker-compose.prod.yml" --env-file "$ENV_FILE")
  if [[ "$ENABLE_ZIGBEE" == "1" ]]; then export COMPOSE_PROFILES="zigbee-z2m"; fi
  ( cd "$REPO_DIR" && docker compose "${args[@]}" "$@" )
}

# ═══════════════════════════════════════════════════════════════════════════
# STEP 4: stack-up — bring up mosquitto + homeassistant (+z2m if kit)
# ═══════════════════════════════════════════════════════════════════════════
step_stack_up() {
  if [[ "$DRY_RUN" == "1" ]]; then
    _log "stack-up (dry-run): would 'docker compose ... up -d mosquitto homeassistant'"
    _compose config >/dev/null 2>&1 && _ok "stack-up (dry-run): compose config valid" || _log "stack-up (dry-run): compose config check skipped (docker unavailable)"
    return 0
  fi
  local svcs=(mosquitto homeassistant)
  [[ "$ENABLE_ZIGBEE" == "1" ]] && svcs+=(zigbee2mqtt)
  _compose up -d "${svcs[@]}" || _die "docker compose up failed"
  _ok "stack-up: ${svcs[*]} started"
}

# ═══════════════════════════════════════════════════════════════════════════
# STEP 5: ha-seed — headless onboarding + LLAT + MQTT config entry
# ═══════════════════════════════════════════════════════════════════════════
step_ha_seed() {
  local ha_pass mqtt_pass
  ha_pass="${HA_ADMIN_PASS:-$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)}"
  _kv_set HA_ADMIN_PASS "$ha_pass"
  mqtt_pass="$(_kv_get MQTT_PASS)"
  if [[ "$DRY_RUN" == "1" ]]; then
    HA_URL="http://localhost:8123" bash "$REPO_DIR/scripts/ha-seed.sh" --check 2>/dev/null \
      && _ok "ha-seed (dry-run): --check passed (HA reachable)" \
      || _log "ha-seed (dry-run): HA not running (expected in dry-run) — would onboard + mint token"
    return 0
  fi
  HA_URL="http://localhost:8123" HA_ADMIN_USER="$MQTT_USER" HA_ADMIN_PASS="$ha_pass" \
    MQTT_USER="$MQTT_USER" MQTT_PASS="$mqtt_pass" MQTT_HOST="localhost" MQTT_PORT="1883" \
    bash "$REPO_DIR/scripts/ha-seed.sh" --with-mqtt --env-out "$ENV_FILE" || _die "ha-seed failed"
  _ok "ha-seed: onboarded, token written to $ENV_FILE, MQTT entry created"
}

# ═══════════════════════════════════════════════════════════════════════════
# STEP 6: seal — data_key + kit_manifest + relay seal-key
# ═══════════════════════════════════════════════════════════════════════════
step_seal() {
  local home_id; home_id="$(_kv_get HOME_ID)"
  [[ -n "$COORDINATOR_IEEE" || "$DRY_RUN" == "1" ]] || _die "COORDINATOR_IEEE required for kit_manifest (pair the coordinator first)"
  local ieee="${COORDINATOR_IEEE:-00:00:00:00:00:00:00:00}"

  local master="${MASTER_KEY_B64:-}"
  if [[ "$DRY_RUN" == "1" && -z "$master" ]]; then
    master="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
  elif [[ -z "$master" ]]; then
    read -rsp "Founder master key (base64 from 1Password): " master; echo
  fi
  # H1: the dryrun-* placeholders are ONLY acceptable in a dry-run. In a real run
  # forgotten B2 creds must FAIL loudly here, never get silently sealed.
  if [[ "$DRY_RUN" == "1" ]]; then
    : "${B2_KEY_ID:=${ZIGGY_B2_KEY_ID:-dryrun-key-id}}"
    : "${B2_APP_KEY:=${ZIGGY_B2_APP_KEY:-dryrun-app-key}}"
  else
    : "${B2_KEY_ID:=${ZIGGY_B2_KEY_ID:-}}"
    : "${B2_APP_KEY:=${ZIGGY_B2_APP_KEY:-}}"
    [[ -n "$B2_KEY_ID" ]]  || _die "B2_KEY_ID is empty — per-home Backblaze key id required before seal (see --help)"
    [[ -n "$B2_APP_KEY" ]] || _die "B2_APP_KEY is empty — per-home Backblaze app key required before seal (see --help)"
  fi

  DRY_RUN="$DRY_RUN" ZIGGY_ETC_DIR="$ETC_DIR" \
  HOME_ID="$home_id" DEVICE_ID="$home_id" \
  COORDINATOR_TYPE="$COORDINATOR_TYPE" COORDINATOR_IEEE="$ieee" \
  RELAY_URL="$RELAY_URL" FOUNDER_JWT="$(_kv_get FOUNDER_JWT)" MASTER_KEY_B64="$master" \
  B2_KEY_ID="$B2_KEY_ID" B2_APP_KEY="$B2_APP_KEY" B2_BUCKET="$B2_BUCKET" B2_ENDPOINT="$B2_ENDPOINT" \
    bash "$SCRIPT_DIR/_seal_step.sh" || _die "seal step failed"
  unset master MASTER_KEY_B64 || true
  _ok "seal: data_key + kit_manifest written under $ETC_DIR"
}

# ═══════════════════════════════════════════════════════════════════════════
# STEP 7: register-hub — bind tunnel_url to the home (HMAC over body)
# ═══════════════════════════════════════════════════════════════════════════
step_register_hub() {
  if [[ "$DRY_RUN" == "1" ]]; then _log "register-hub (dry-run): would POST /api/homes/register-hub (HMAC)"; return 0; fi
  local home_id relay_secret tunnel_url
  home_id="$(_kv_get HOME_ID)"; relay_secret="$(_kv_get RELAY_SECRET)"; tunnel_url="$(_kv_get TUNNEL_URL)"
  [[ -n "$tunnel_url" ]] || { _log "register-hub: no tunnel_url — skipping (tunnel set later)"; return 0; }
  local body sig
  body="$(HID="$home_id" HN="$HOME_NAME" TU="$tunnel_url" python3 -c 'import json,os;print(json.dumps({"home_id":os.environ["HID"],"name":os.environ["HN"],"tunnel_url":os.environ["TU"]},separators=(",",":")))')"
  sig="$(RS="$relay_secret" BODY="$body" python3 -c 'import hmac,hashlib,os;print(hmac.new(os.environ["RS"].encode(),os.environ["BODY"].encode(),hashlib.sha256).hexdigest())')"
  curl -fsS -X POST "$RELAY_URL/api/homes/register-hub" -H 'Content-Type: application/json' -H "X-Ziggy-Signature: $sig" -d "$body" >/dev/null \
    && _ok "register-hub: tunnel bound, home active" \
    || _log "register-hub: failed (non-fatal; can retry later)"
}

# ═══════════════════════════════════════════════════════════════════════════
# STEP 8: ziggy-up — bring up the Ziggy backend
# ═══════════════════════════════════════════════════════════════════════════
step_ziggy_up() {
  if [[ "$DRY_RUN" == "1" ]]; then _log "ziggy-up (dry-run): would 'docker compose ... up -d --build ziggy'"; return 0; fi
  _compose up -d --build ziggy || _die "ziggy up failed"
  _ok "ziggy-up: backend started"
}

# ═══════════════════════════════════════════════════════════════════════════
# STEP 9: kit-ready — the ship gate
# ═══════════════════════════════════════════════════════════════════════════
step_kit_ready() {
  if [[ "$DRY_RUN" == "1" ]]; then
    ZIGGY_ETC_DIR="$ETC_DIR" ZIGGY_REPO_DIR="$REPO_DIR" \
      bash "$SCRIPT_DIR/kit-ready-check.sh" --skip-mqtt --skip-backup >/dev/null 2>&1 \
      && _ok "kit-ready (dry-run): structural checks passed" \
      || _log "kit-ready (dry-run): some checks FAIL (expected without live HA/relay)"
    return 0
  fi
  local mqtt_pass; mqtt_pass="$(_kv_get MQTT_PASS)"
  ZIGGY_ETC_DIR="$ETC_DIR" ZIGGY_REPO_DIR="$REPO_DIR" \
    MQTT_USER="$MQTT_USER" MQTT_PASS="$mqtt_pass" \
    bash "$SCRIPT_DIR/kit-ready-check.sh" || _die "KIT-READY GATE FAILED — do not ship"
  _ok "kit-ready: gate passed"
}

# ═══════════════════════════════════════════════════════════════════════════
# STEP 10: first-backup — one REAL backup to B2 (the ship signal)
# ═══════════════════════════════════════════════════════════════════════════
step_first_backup() {
  if [[ "$DRY_RUN" == "1" ]]; then _log "first-backup (dry-run): would run backup_engine --once (no --dry-run)"; return 0; fi
  _compose exec -T ziggy python -m services.backup_engine --once \
    && _ok "first-backup: real backup landed in B2" \
    || _die "first real backup failed"
}

# ── dispatch ────────────────────────────────────────────────────────────────
# Case-based (portable to bash 3.2 — macOS bench — and bash 5 — Ubuntu hub).
_run_step_fn() {
  case "$1" in
    preflight)     step_preflight ;;
    identity)      step_identity ;;
    mqtt-creds)    step_mqtt_creds ;;
    env)           step_env ;;
    stack-up)      step_stack_up ;;
    ha-seed)       step_ha_seed ;;
    seal)          step_seal ;;
    register-hub)  step_register_hub ;;
    ziggy-up)      step_ziggy_up ;;
    kit-ready)     step_kit_ready ;;
    first-backup)  step_first_backup ;;
    *) _die "unknown step: $1" ;;
  esac
}

_log "Ziggy imaging starting (dry_run=$DRY_RUN, resume=$RESUME, from=${FROM_STEP:-none})"
for step in "${STEPS[@]}"; do
  if _should_run "$step"; then
    _log "── step: $step ──"
    _run_step_fn "$step"
    _mark_done "$step"
  else
    _log "── step: $step (skip) ──"
  fi
done

echo
if [[ "$DRY_RUN" == "1" ]]; then
  _ok "DRY-RUN complete. Sandbox: $SANDBOX"
  _log "Inspect: $ENV_FILE , $ETC_DIR , $STATE_FILE"
else
  _ok "IMAGING COMPLETE — hub is KIT READY. HOME_ID=$(_kv_get HOME_ID)"
fi
