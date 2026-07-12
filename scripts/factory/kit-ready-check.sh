#!/usr/bin/env bash
# scripts/factory/kit-ready-check.sh — the SHIP GATE.
#
# A hub MUST pass every non-skipped check here before it leaves the factory /
# customer's home. Mirrors the verification patterns in smoke-test-hub.sh and
# ziggy-restore-device.sh.
#
# Checks:
#   1. /etc/ziggy/data_key exists and is EXACTLY 32 bytes
#   2. /etc/ziggy/kit_manifest.yaml present with a real (non-placeholder)
#      device_id, home_id, and a valid coordinator_type
#   3. /etc/ziggy/b2_credentials present + B2 env available for the backup engine
#   4. HA reachable AND the minted token authenticates (GET /api/ = 200)
#   5. MQTT auth enforced (creds succeed, anonymous fails)
#   6. Dry-run backup exits 0 (seal is internally consistent)
#
# USAGE: scripts/factory/kit-ready-check.sh [--skip-mqtt] [--skip-backup]
#
# ENV:
#   ZIGGY_ETC_DIR  default /etc/ziggy
#   ZIGGY_REPO_DIR default /opt/ziggy   (where `python -m services.backup_engine` runs)
#   HA_URL, HA_TOKEN  (else read from $ZIGGY_REPO_DIR/.env)
#   MQTT_USER, MQTT_PASS, MQTT_HOST(default localhost), MQTT_PORT(1883)
#   MOSQUITTO_IMAGE default eclipse-mosquitto:2
#   BACKUP_CMD  default: docker compose -f docker-compose.yml -f docker-compose.prod.yml \
#                        exec -T ziggy python -m services.backup_engine --once --dry-run
#
# EXIT: 0 all required checks pass; 1 any FAIL.

set -uo pipefail   # NOT -e: we want to run every check and summarize.

ZIGGY_ETC_DIR="${ZIGGY_ETC_DIR:-/etc/ziggy}"
ZIGGY_REPO_DIR="${ZIGGY_REPO_DIR:-/opt/ziggy}"
MOSQUITTO_IMAGE="${MOSQUITTO_IMAGE:-eclipse-mosquitto:2}"
MQTT_HOST="${MQTT_HOST:-localhost}"
MQTT_PORT="${MQTT_PORT:-1883}"

SKIP_MQTT=0
SKIP_BACKUP=0
for a in "$@"; do
  case "$a" in
    --skip-mqtt) SKIP_MQTT=1 ;;
    --skip-backup) SKIP_BACKUP=1 ;;
    -h|--help) grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done

# Pull HA_URL/HA_TOKEN from the hub .env if not in env.
if [[ -f "$ZIGGY_REPO_DIR/.env" ]]; then
  # shellcheck disable=SC1091
  set -a; . "$ZIGGY_REPO_DIR/.env" 2>/dev/null || true; set +a
fi
HA_URL="${HA_URL:-http://localhost:8123}"

RESULTS=()
_pass() { RESULTS+=("PASS  $1"); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
_fail() { RESULTS+=("FAIL  $1"); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAILED=1; }
_skip() { RESULTS+=("SKIP  $1"); printf '  \033[33mSKIP\033[0m  %s\n' "$1"; }
FAILED=0

_filesize() { stat -c%s "$1" 2>/dev/null || stat -f%z "$1" 2>/dev/null; }

echo "=== Ziggy kit-ready check ==="
echo "etc: $ZIGGY_ETC_DIR   repo: $ZIGGY_REPO_DIR   ha: $HA_URL"
echo

# 1. data_key ---------------------------------------------------------------
if [[ -f "$ZIGGY_ETC_DIR/data_key" ]]; then
  sz="$(_filesize "$ZIGGY_ETC_DIR/data_key")"
  if [[ "$sz" == "32" ]]; then _pass "data_key present and 32 bytes"
  else _fail "data_key wrong size ($sz bytes, expected 32)"; fi
else
  _fail "data_key missing at $ZIGGY_ETC_DIR/data_key (seal step did not run)"
fi

# 2. kit_manifest -----------------------------------------------------------
KM="$ZIGGY_ETC_DIR/kit_manifest.yaml"
if [[ -f "$KM" ]]; then
  dev="$(grep -E '^device_id:' "$KM" | head -1 | sed 's/^device_id:[[:space:]]*//')"
  home="$(grep -E '^home_id:' "$KM" | head -1 | sed 's/^home_id:[[:space:]]*//')"
  ctype="$(grep -E '^coordinator_type:' "$KM" | head -1 | sed 's/^coordinator_type:[[:space:]]*//')"
  if [[ -z "$dev" || "$dev" == "REPLACE_WITH_DEVICE_ID" ]]; then
    _fail "kit_manifest device_id missing/placeholder"
  elif [[ -z "$home" ]]; then
    _fail "kit_manifest home_id missing"
  elif [[ "$ctype" != "smlight" && "$ctype" != "sonoff_e" ]]; then
    _fail "kit_manifest coordinator_type invalid ('$ctype')"
  else
    _pass "kit_manifest valid (device_id=$dev, coordinator=$ctype)"
  fi
else
  _fail "kit_manifest missing at $KM"
fi

# 3. b2 credentials + env ---------------------------------------------------
if [[ -f "$ZIGGY_ETC_DIR/b2_credentials" ]]; then
  if [[ -n "${ZIGGY_B2_KEY_ID:-}" && -n "${ZIGGY_B2_APP_KEY:-}" ]] \
     || [[ -f "$ZIGGY_ETC_DIR/b2_env" ]]; then
    _pass "b2_credentials present + B2 env available for backup engine"
  else
    _fail "b2_credentials present but ZIGGY_B2_KEY_ID/APP_KEY not exported and no $ZIGGY_ETC_DIR/b2_env"
  fi
else
  _fail "b2_credentials missing at $ZIGGY_ETC_DIR/b2_credentials"
fi

# 4. HA reachable + token authenticates -------------------------------------
if [[ -z "${HA_TOKEN:-}" ]]; then
  _fail "HA_TOKEN not set (ha-seed.sh did not write it to $ZIGGY_REPO_DIR/.env)"
else
  code="$(curl -s -o /dev/null -w '%{http_code}' \
          -H "Authorization: Bearer $HA_TOKEN" "$HA_URL/api/" || echo 000)"
  if [[ "$code" == "200" ]]; then _pass "HA reachable and token authenticates ($HA_URL)"
  else _fail "HA token auth failed (GET $HA_URL/api/ → HTTP $code)"; fi
fi

# 5. MQTT auth enforced -----------------------------------------------------
if [[ "$SKIP_MQTT" == "1" ]]; then
  _skip "MQTT auth (skipped by flag)"
elif ! command -v docker >/dev/null; then
  # M1: a real gate run must NOT fail open. Without docker we cannot prove
  # anonymous MQTT is blocked, so treat it as a FAIL (matches check 6). Use
  # --skip-mqtt to intentionally opt out (dry-run does).
  _fail "MQTT auth NOT verified — docker unavailable to run mosquitto client (required for the ship gate)"
elif [[ -z "${MQTT_USER:-}" || -z "${MQTT_PASS:-}" ]]; then
  _fail "MQTT_USER/MQTT_PASS not set — cannot verify broker auth"
else
  ok_auth=1; ok_anon_blocked=1
  docker run --rm --network host "$MOSQUITTO_IMAGE" \
    mosquitto_pub -h "$MQTT_HOST" -p "$MQTT_PORT" \
    -u "$MQTT_USER" -P "$MQTT_PASS" -t ziggy/kitcheck -m ok >/dev/null 2>&1 || ok_auth=0
  # Anonymous publish MUST fail (non-zero) when auth is enforced.
  if docker run --rm --network host "$MOSQUITTO_IMAGE" \
    mosquitto_pub -h "$MQTT_HOST" -p "$MQTT_PORT" \
    -t ziggy/kitcheck -m nope >/dev/null 2>&1; then ok_anon_blocked=0; fi
  if [[ "$ok_auth" == "1" && "$ok_anon_blocked" == "1" ]]; then
    _pass "MQTT auth enforced (creds ok, anonymous rejected)"
  elif [[ "$ok_auth" != "1" ]]; then
    _fail "MQTT publish with creds failed (broker down or wrong creds)"
  else
    _fail "MQTT accepts ANONYMOUS publish — auth NOT enforced"
  fi
fi

# 6. dry-run backup ---------------------------------------------------------
if [[ "$SKIP_BACKUP" == "1" ]]; then
  _skip "dry-run backup (skipped by flag)"
else
  BACKUP_CMD="${BACKUP_CMD:-docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T ziggy python -m services.backup_engine --once --dry-run}"
  # L1: private per-run log file (no fixed, predictable /tmp path).
  BACKUP_LOG="$(mktemp "${TMPDIR:-/tmp}/kit-backup.XXXXXX.log")"
  if ( cd "$ZIGGY_REPO_DIR" 2>/dev/null && eval "$BACKUP_CMD" >"$BACKUP_LOG" 2>&1 ); then
    _pass "dry-run backup exited 0 (seal internally consistent)"
  else
    _fail "dry-run backup FAILED (see $BACKUP_LOG)"
  fi
fi

echo
echo "=== summary ==="
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo
if [[ "$FAILED" == "1" ]]; then
  echo ">>> KIT NOT READY — do NOT ship. <<<"; exit 1
fi
echo ">>> KIT READY <<<"; exit 0
