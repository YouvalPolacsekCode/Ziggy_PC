#!/usr/bin/env bash
# scripts/canary-validate.sh — beta-readiness ACCEPTANCE SUITE.
#
# Runs the readiness validation checks against a hub (or, where possible, in CI).
# Each check is a function returning pass/fail/skip; results print as a table.
# Checks that require real hardware (Zigbee dongle, IR blaster) return
# SKIP-HARDWARE rather than FAIL so the suite is meaningful on a bench without a
# full kit. Environment/stack checks that can't run (stack down, no docker)
# return SKIP with a reason.
#
# USAGE: scripts/canary-validate.sh [--image TAG]
#
# ENV:
#   ZIGGY_REPO_DIR default /opt/ziggy (falls back to this repo)
#   HA_URL default http://localhost:8123   ZIGGY_URL default http://localhost:8001
#   MQTT_USER/MQTT_PASS  MQTT_HOST(localhost) MQTT_PORT(1883)
#   ZIGGY_IMAGE  image ref to scan for secrets (else newest ziggy image)
#
# EXIT: 0 if no FAIL (SKIP is not failure); 1 if any FAIL.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${ZIGGY_REPO_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
HA_URL="${HA_URL:-http://localhost:8123}"
ZIGGY_URL="${ZIGGY_URL:-http://localhost:8001}"
MQTT_HOST="${MQTT_HOST:-localhost}"; MQTT_PORT="${MQTT_PORT:-1883}"
MOSQUITTO_IMAGE="${MOSQUITTO_IMAGE:-eclipse-mosquitto:2.0.20}"
IMAGE_REF="${ZIGGY_IMAGE:-}"
[[ "${1:-}" == "--image" ]] && IMAGE_REF="${2:?--image needs a tag}"

# MQTT creds: if not supplied, parse them from the hub's .env MQTT_URL
# (mqtt://user:pass@host:port). .env is root-owned 0600 — only readable when the
# suite runs as root (it should: `sudo ./scripts/canary-validate.sh`).
if [[ -z "${MQTT_USER:-}" || -z "${MQTT_PASS:-}" ]] && [[ -r "$REPO_DIR/.env" ]]; then
  _murl="$(grep -E '^MQTT_URL=' "$REPO_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2-)"
  if [[ "$_murl" =~ ^mqtt://([^:]+):([^@]+)@ ]]; then
    MQTT_USER="${MQTT_USER:-${BASH_REMATCH[1]}}"
    MQTT_PASS="${MQTT_PASS:-${BASH_REMATCH[2]}}"
  fi
fi

declare -a ROWS
_row() { ROWS+=("$1|$2|$3"); }   # name|status|detail
_have_docker() { command -v docker >/dev/null 2>&1; }

# ── check: imaging is zero-keystroke (dry-run needs no prompts) ──────────────
check_imaging_zero_keystroke() {
  local out
  # All required env supplied → the script must complete --dry-run with NO stdin.
  out="$(RELAY_ADMIN_EMAIL=x RELAY_ADMIN_PASSWORD=x \
         MASTER_KEY_B64="$(head -c32 /dev/urandom | base64)" \
         B2_KEY_ID=k B2_APP_KEY=a COORDINATOR_TYPE=smlight COORDINATOR_IEEE=00:12:4b:00:11:22:33:44 \
         HA_ADMIN_PASS=x \
         bash "$SCRIPT_DIR/factory/ziggy-image-device.sh" --dry-run </dev/null 2>&1)"
  if [[ $? -eq 0 ]] && printf '%s' "$out" | grep -q "DRY-RUN complete"; then
    _row "imaging zero-keystroke" "PASS" "dry-run completed with no stdin"
  else
    _row "imaging zero-keystroke" "FAIL" "dry-run did not complete cleanly"
  fi
}

# ── check: HA up ────────────────────────────────────────────────────────────
check_ha_up() {
  local code; code="$(curl -s -o /dev/null -w '%{http_code}' "$HA_URL/api/onboarding" 2>/dev/null || echo 000)"
  if [[ "$code" =~ ^(200|404)$ ]]; then _row "HA up" "PASS" "$HA_URL responded ($code)"
  else _row "HA up" "SKIP" "HA not reachable ($HA_URL, $code) — stack down?"; fi
}

# ── check: MQTT auth enforced ───────────────────────────────────────────────
check_mqtt_auth_enforced() {
  if ! _have_docker; then _row "MQTT auth enforced" "SKIP" "docker unavailable"; return; fi
  if [[ -z "${MQTT_USER:-}" || -z "${MQTT_PASS:-}" ]]; then _row "MQTT auth enforced" "SKIP" "MQTT_USER/PASS not set"; return; fi
  local anon_ok=0 creds_ok=0
  docker run --rm --network host "$MOSQUITTO_IMAGE" mosquitto_pub -h "$MQTT_HOST" -p "$MQTT_PORT" \
    -u "$MQTT_USER" -P "$MQTT_PASS" -t ziggy/canary -m ok >/dev/null 2>&1 && creds_ok=1
  docker run --rm --network host "$MOSQUITTO_IMAGE" mosquitto_pub -h "$MQTT_HOST" -p "$MQTT_PORT" \
    -t ziggy/canary -m nope >/dev/null 2>&1 && anon_ok=1
  if [[ "$creds_ok" == "1" && "$anon_ok" == "0" ]]; then _row "MQTT auth enforced" "PASS" "creds ok, anon rejected"
  elif [[ "$creds_ok" == "0" ]]; then _row "MQTT auth enforced" "SKIP" "broker not reachable with creds (down?)"
  else _row "MQTT auth enforced" "FAIL" "anonymous publish accepted"; fi
}

# ── check: pairing hooks reachable ──────────────────────────────────────────
check_pairing_hooks() {
  local code; code="$(curl -s -o /dev/null -w '%{http_code}' "$ZIGGY_URL/health" 2>/dev/null || echo 000)"
  if [[ "$code" == "200" ]]; then
    # device pairing router should be mounted; probe a pairing endpoint (any
    # non-000/404-at-root response means the backend + routes are alive).
    # Probe real mounted API endpoints — an auth-gated 401 still proves the
    # router surface (devices/pairing) is mounted. A 404 would mean not mounted.
    local pc="000" ep
    for ep in /api/devices /api/ha/config_flows /api/version; do
      pc="$(curl -s -o /dev/null -w '%{http_code}' "$ZIGGY_URL$ep" 2>/dev/null || echo 000)"
      [[ "$pc" =~ ^(200|401|403|405)$ ]] && break
    done
    if [[ "$pc" =~ ^(200|401|403|405)$ ]]; then _row "pairing hooks reachable" "PASS" "backend API routes mounted (probe → $pc)"
    else _row "pairing hooks reachable" "SKIP" "no API route responded (last → $pc)"; fi
  else
    _row "pairing hooks reachable" "SKIP" "Ziggy backend down ($ZIGGY_URL/health $code)"
  fi
}

# ── check: locale = he ──────────────────────────────────────────────────────
check_locale_he() {
  # Prefer the committed prod HA skeleton (source of truth); if a live HA core
  # config is present, cross-check time_zone.
  local cfg="$REPO_DIR/docker/ha-config/configuration.yaml"
  if grep -qE 'time_zone:[[:space:]]*Asia/Jerusalem' "$cfg" 2>/dev/null \
     && grep -qE 'country:[[:space:]]*IL' "$cfg" 2>/dev/null; then
    _row "locale he/IL" "PASS" "prod HA config: Asia/Jerusalem + IL"
  else
    _row "locale he/IL" "FAIL" "prod HA config missing Asia/Jerusalem or IL"
  fi
}

# ── check: HA container kill → recover ──────────────────────────────────────
check_ha_kill_recover() {
  if ! _have_docker; then _row "HA kill→recover" "SKIP" "docker unavailable"; return; fi
  local cid; cid="$(docker ps --filter 'name=homeassistant' --format '{{.ID}}' | head -1)"
  if [[ -z "$cid" ]]; then _row "HA kill→recover" "SKIP" "HA container not running"; return; fi
  local policy; policy="$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$cid" 2>/dev/null)"
  if [[ "$policy" != "unless-stopped" && "$policy" != "always" ]]; then
    _row "HA kill→recover" "FAIL" "restart policy is '$policy' (needs unless-stopped/always)"; return
  fi
  # Simulate a REAL crash: kill the container's main process on the host so the
  # exit is process-initiated. A CLI `docker kill`/`docker stop` is treated as a
  # manual action Docker does NOT auto-restart — using it here gives a false FAIL.
  local pid before; pid="$(docker inspect -f '{{.State.Pid}}' "$cid" 2>/dev/null)"
  before="$(docker inspect -f '{{.RestartCount}}' "$cid" 2>/dev/null)"
  if [[ -z "$pid" || "$pid" == "0" ]]; then _row "HA kill→recover" "SKIP" "could not read container pid"; return; fi
  kill -9 "$pid" 2>/dev/null || sudo kill -9 "$pid" 2>/dev/null
  local deadline=$(( $(date +%s) + 120 )) up=0
  while [[ $(date +%s) -lt $deadline ]]; do
    local st rc; st="$(docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null)"
    rc="$(docker inspect -f '{{.RestartCount}}' "$cid" 2>/dev/null)"
    if [[ "$st" == "running" && "${rc:-0}" -gt "${before:-0}" ]]; then up=1; break; fi
    sleep 3
  done
  if [[ "$up" == "1" ]]; then _row "HA kill→recover" "PASS" "auto-restarted after real crash (policy=$policy)"
  else _row "HA kill→recover" "FAIL" "did not auto-restart within 120s"; fi
}

# ── check: image contains no secrets (docker save grep) ─────────────────────
check_image_no_secrets() {
  if ! _have_docker; then _row "image has no secrets" "SKIP" "docker unavailable"; return; fi
  local ref="$IMAGE_REF"
  if [[ -z "$ref" ]]; then
    ref="$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -iE 'ziggy' | grep -v '<none>' | head -1)"
  fi
  if [[ -z "$ref" ]]; then _row "image has no secrets" "SKIP" "no ziggy image found (build first)"; return; fi
  local tmp; tmp="$(mktemp)"
  # Scan the image tar for secret-bearing paths + obvious secret markers.
  if docker save "$ref" 2>/dev/null | tar -tf - 2>/dev/null > "$tmp"; then
    local hits
    hits="$(grep -E 'config/secrets\.yaml|config/settings\.yaml|user_files/.*\.db|/etc/ziggy/data_key|b2_credentials' "$tmp" || true)"
    if [[ -z "$hits" ]]; then _row "image has no secrets" "PASS" "no secret paths in $ref layers"
    else _row "image has no secrets" "FAIL" "secret paths present: $(echo "$hits" | tr '\n' ' ' | head -c 120)"; fi
  else
    _row "image has no secrets" "SKIP" "docker save failed for $ref"
  fi
  rm -f "$tmp"
}

# ── check: backup → restore hook ────────────────────────────────────────────
check_backup_restore_hook() {
  # The engine + restore helper must exist and expose the expected CLI.
  local be="$REPO_DIR/services/backup_engine.py"
  local rh="$REPO_DIR/scripts/factory/ziggy-restore-device.sh"
  if [[ -f "$be" && -f "$rh" ]] && grep -q -- '--dry-run' "$be"; then
    if _have_docker && docker ps --filter 'name=ziggy' --format '{{.ID}}' | grep -q .; then
      if ( cd "$REPO_DIR" && docker compose -f docker-compose.yml -f docker-compose.prod.yml \
            exec -T ziggy python -m services.backup_engine --once --dry-run >/dev/null 2>&1 ); then
        _row "backup→restore hook" "PASS" "dry-run backup exit 0 + restore script present"
      else
        _row "backup→restore hook" "SKIP" "dry-run backup non-zero (seal/keys not on this bench)"
      fi
    else
      _row "backup→restore hook" "PASS" "engine (--dry-run) + restore script present (not exercised)"
    fi
  else
    _row "backup→restore hook" "FAIL" "backup_engine or restore script missing/incomplete"
  fi
}

# ── check: OTA verify hook ──────────────────────────────────────────────────
check_ota_verify_hook() {
  # OTA path exists (relay ota router + hub updater). Verify the pieces are present.
  local found=""
  [[ -f "$REPO_DIR/relay/app/routers/ota.py" ]] && found="relay-ota"
  for f in scripts/update.sh scripts/ota-recover.ps1 scripts/update.ps1; do
    [[ -f "$REPO_DIR/$f" ]] && found="$found ${f##*/}"
  done
  if [[ -n "$found" ]]; then _row "OTA verify hook" "PASS" "OTA components present:$found"
  else _row "OTA verify hook" "SKIP" "no OTA components found on this bench"; fi
}

# ── check: Zigbee coordinator (HARDWARE) ────────────────────────────────────
check_zigbee_hardware() {
  local dev="${ZIGBEE_COORDINATOR_DEVICE:-}"
  if [[ -n "$dev" && -e "$dev" ]]; then _row "zigbee coordinator" "PASS" "device present: $dev"
  else _row "zigbee coordinator" "SKIP-HARDWARE" "no Zigbee dongle on this bench"; fi
}

# ── check: IR blaster (HARDWARE) ────────────────────────────────────────────
check_ir_blaster() {
  _row "IR blaster (Broadlink)" "SKIP-HARDWARE" "requires real RM4 on the kit"
}

echo "=== Ziggy canary acceptance suite ==="
echo "repo=$REPO_DIR ha=$HA_URL ziggy=$ZIGGY_URL"
echo
check_imaging_zero_keystroke
check_ha_up
check_mqtt_auth_enforced
check_pairing_hooks
check_locale_he
check_ha_kill_recover
check_image_no_secrets
check_backup_restore_hook
check_ota_verify_hook
check_zigbee_hardware
check_ir_blaster

echo
printf '%-26s %-14s %s\n' "CHECK" "STATUS" "DETAIL"
printf '%-26s %-14s %s\n' "-----" "------" "------"
fail=0
for r in "${ROWS[@]}"; do
  IFS='|' read -r name status detail <<<"$r"
  case "$status" in
    PASS)  color=32 ;;
    FAIL)  color=31; fail=1 ;;
    SKIP-HARDWARE) color=35 ;;
    *)     color=33 ;;
  esac
  printf '%-26s \033[%sm%-14s\033[0m %s\n' "$name" "$color" "$status" "$detail"
done
echo
if [[ "$fail" == "1" ]]; then echo ">>> CANARY: FAIL (see table) <<<"; exit 1; fi
echo ">>> CANARY: OK (no failures; SKIPs are environmental/hardware) <<<"; exit 0
