#!/usr/bin/env bash
# scripts/factory/_seal_step.sh
#
# The seal-key step of factory imaging. Real implementation of
# docs/SEAL_KEY_SNIPPET_FOR_FACTORY_IMAGING.md §5.
#
# Generates a per-home 32-byte AES-256-GCM data_key, wraps it (+ the B2
# credentials JSON) under the founder master key, POSTs the wrapped blobs to the
# relay's seal-key endpoint (proof-of-knowledge; master key never persisted),
# then writes runtime key material + the kit manifest under $ZIGGY_ETC_DIR.
#
# INVOCATION
#   Sourced or executed by ziggy-image-device.sh after the home is provisioned.
#   Standalone (for testing the crypto path):
#       DRY_RUN=1 ZIGGY_ETC_DIR=/tmp/ziggy-etc \
#       MASTER_KEY_B64=$(head -c32 /dev/urandom | base64) \
#       HOME_ID=home-test DEVICE_ID=home-test \
#       COORDINATOR_TYPE=smlight COORDINATOR_IEEE=00:12:4b:00:11:22:33:44 \
#       B2_KEY_ID=k B2_APP_KEY=a B2_BUCKET=b B2_ENDPOINT=https://e \
#       ./scripts/factory/_seal_step.sh
#
# INPUTS (env): HOME_ID DEVICE_ID COORDINATOR_TYPE COORDINATOR_IEEE
#               RELAY_URL FOUNDER_JWT MASTER_KEY_B64
#               B2_KEY_ID B2_APP_KEY B2_BUCKET B2_ENDPOINT
# OPTIONS (env): DRY_RUN=1        → skip relay POST; still generates + wraps +
#                                    writes key material to $ZIGGY_ETC_DIR.
#                ZIGGY_ETC_DIR    → target dir for key material (default /etc/ziggy).
#                SEAL_MAX_RETRIES → relay POST retries (default 3).
#
# EXIT: 0 ok, 1 failure (fatal for the imaging run — do NOT ship on failure).

set -euo pipefail

# M2: create every secret file (data_key, b2_credentials, b2_env) mode 0600 from
# birth — no world-readable window between tee and chmod.
umask 077

DRY_RUN="${DRY_RUN:-0}"
ZIGGY_ETC_DIR="${ZIGGY_ETC_DIR:-/etc/ziggy}"
SEAL_MAX_RETRIES="${SEAL_MAX_RETRIES:-3}"
# H2: only mint a brand-new data_key when explicitly told to rotate; otherwise an
# existing 32-byte data_key is reused so re-imaging never orphans B2 backups.
ROTATE_DATA_KEY="${ROTATE_DATA_KEY:-0}"
for _arg in "$@"; do
  case "$_arg" in
    --rotate-data-key) ROTATE_DATA_KEY=1 ;;
  esac
done

_log() { printf '[seal] %s\n' "$*" >&2; }
_die() { printf '[seal] ERROR: %s\n' "$*" >&2; exit 1; }

# Use sudo only when writing to a root-owned dir and we're not already root.
_maybe_sudo() {
  if [[ "$ZIGGY_ETC_DIR" == /etc/* && "$(id -u)" != "0" ]]; then
    sudo "$@"
  else
    "$@"
  fi
}

# --- 0. Validate inputs ------------------------------------------------------
for v in HOME_ID DEVICE_ID COORDINATOR_TYPE COORDINATOR_IEEE \
         MASTER_KEY_B64 B2_KEY_ID B2_APP_KEY B2_BUCKET B2_ENDPOINT; do
  [[ -n "${!v:-}" ]] || _die "required input \$$v is empty"
done
if [[ "$DRY_RUN" != "1" ]]; then
  for v in RELAY_URL FOUNDER_JWT; do
    [[ -n "${!v:-}" ]] || _die "required input \$$v is empty (needed unless DRY_RUN=1)"
  done
fi
case "$COORDINATOR_TYPE" in
  smlight|sonoff_e) : ;;
  *) _die "COORDINATOR_TYPE must be 'smlight' or 'sonoff_e', got '$COORDINATOR_TYPE'";;
esac
command -v python3 >/dev/null || _die "python3 not found"
command -v jq      >/dev/null || _die "jq not found"

# Master key sanity (spec §6): must be STRICT base64 (L5 — a whitespace/newline
# -corrupted key fails locally with a clear message, not a relay 400) decoding to
# exactly 32 bytes. Secret goes via ENV, never argv.
DECODED_LEN="$(MASTER_KEY_B64="$MASTER_KEY_B64" python3 -c '
import base64, os, sys
try:
    raw = base64.b64decode(os.environ["MASTER_KEY_B64"], validate=True)
except Exception as e:
    sys.exit("not strict base64 (%s)" % e)
print(len(raw))
' 2>&1)" || _die "master key is not valid strict base64 — check for stray whitespace/newlines ($DECODED_LEN)"
[[ "$DECODED_LEN" == "32" ]] || _die "master key must decode to 32 bytes, got $DECODED_LEN"

# --- 5.1 Per-home data_key: REUSE existing (re-image safe) or generate/rotate -
# H2: an unconditional fresh key would orphan every existing B2 backup on re-seal.
EXISTING_KEY="$ZIGGY_ETC_DIR/data_key"
EXISTING_SZ="$(_maybe_sudo stat -c%s "$EXISTING_KEY" 2>/dev/null \
               || _maybe_sudo stat -f%z "$EXISTING_KEY" 2>/dev/null || echo 0)"
if [[ "$ROTATE_DATA_KEY" != "1" && "$EXISTING_SZ" == "32" ]]; then
  DATA_KEY_B64="$(_maybe_sudo cat "$EXISTING_KEY" | base64 | tr -d '\n')"
  _log "REUSING existing data_key at $EXISTING_KEY (32 bytes) — existing backups preserved"
else
  if [[ "$ROTATE_DATA_KEY" == "1" ]]; then
    _log "ROTATING data_key (--rotate-data-key/ROTATE_DATA_KEY set) — prior backups will be orphaned"
  else
    _log "no existing 32-byte data_key — generating a fresh per-home data_key"
  fi
  DATA_KEY_B64="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
fi

# --- 5.2 Build the B2 credentials JSON the hub will store --------------------
B2_CREDS_JSON="$(jq -n \
    --arg id "$B2_KEY_ID" --arg ak "$B2_APP_KEY" \
    --arg ep "$B2_ENDPOINT" --arg bk "$B2_BUCKET" \
    '{b2_key_id:$id, b2_app_key:$ak, b2_endpoint:$ep, b2_bucket:$bk}')"

# --- 5.3 Wrap both with the master key (AES-256-GCM; matches backup_keys.wrap)-
# Wire format: base64(nonce(12) || ciphertext || tag(16)).
# C1: secrets pass via ENV (not argv — argv is world-visible in ps/proc).
WRAPPED="$(MASTER_KEY_B64="$MASTER_KEY_B64" DATA_KEY_B64="$DATA_KEY_B64" \
           B2_CREDS_JSON="$B2_CREDS_JSON" python3 - <<'PY'
import base64, json, os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

master_b64 = os.environ["MASTER_KEY_B64"]
data_key_b64 = os.environ["DATA_KEY_B64"]
master = base64.b64decode(master_b64, validate=True)
data_key = base64.b64decode(data_key_b64, validate=True)
b2_creds_json = os.environ["B2_CREDS_JSON"].encode("utf-8")
assert len(master) == 32, "master key must decode to 32 bytes"
assert len(data_key) == 32, "data_key must be 32 bytes"

def wrap(key, plaintext):
    nonce = os.urandom(12)
    ct_with_tag = AESGCM(key).encrypt(nonce, plaintext, None)
    return base64.b64encode(nonce + ct_with_tag).decode()

print(json.dumps({
    "master_key_b64": master_b64,
    "wrapped_data_key_b64": wrap(master, data_key),
    "wrapped_b2_credentials_b64": wrap(master, b2_creds_json),
}))
PY
)"
_log "data_key generated + wrapped (crypto OK)"

# --- 5.4 POST /api/homes/{home_id}/seal-key ---------------------------------
if [[ "$DRY_RUN" == "1" ]]; then
  _log "DRY_RUN: skipping relay POST /api/homes/$HOME_ID/seal-key"
  ACTION="dry_run"
else
  attempt=0
  while :; do
    attempt=$((attempt + 1))
    # C1: JWT header read from a process-substitution file (not argv); seal body
    # streamed over STDIN (not argv). Neither secret appears on any command line.
    HTTP_CODE="$(curl -sS -o /tmp/seal-resp.json -w '%{http_code}' \
        -X POST "$RELAY_URL/api/homes/$HOME_ID/seal-key" \
        -H @<(printf 'Authorization: Bearer %s' "$FOUNDER_JWT") \
        -H "Content-Type: application/json" \
        --data @- <<<"$WRAPPED" || echo "000")"
    if [[ "$HTTP_CODE" == "200" ]]; then
      break
    fi
    # 4xx are deterministic — do not retry (bad master key / unknown home / auth).
    if [[ "$HTTP_CODE" =~ ^4 ]]; then
      cat /tmp/seal-resp.json >&2 || true
      _die "seal-key returned HTTP $HTTP_CODE for home $HOME_ID (see body above; 400=wrong master, 404=home not provisioned, 401/403=JWT)"
    fi
    if [[ "$attempt" -ge "$SEAL_MAX_RETRIES" ]]; then
      cat /tmp/seal-resp.json >&2 || true
      _die "seal-key failed after $attempt attempts (last HTTP $HTTP_CODE)"
    fi
    _log "seal-key HTTP $HTTP_CODE — retry $attempt/$SEAL_MAX_RETRIES after backoff"
    sleep $((attempt * 2))
  done
  ACTION="$(jq -r '.action // "unknown"' /tmp/seal-resp.json)"
  _log "[$HOME_ID] seal ok — action=$ACTION"
fi

# --- 5.5 Persist runtime key material on the hub (mode 0600) -----------------
_maybe_sudo mkdir -p "$ZIGGY_ETC_DIR"
printf '%s' "$DATA_KEY_B64" | base64 -d | _maybe_sudo tee "$ZIGGY_ETC_DIR/data_key" >/dev/null
_maybe_sudo chmod 600 "$ZIGGY_ETC_DIR/data_key"
printf '%s' "$B2_CREDS_JSON" | _maybe_sudo tee "$ZIGGY_ETC_DIR/b2_credentials" >/dev/null
_maybe_sudo chmod 600 "$ZIGGY_ETC_DIR/b2_credentials"

# Also emit B2 creds as an env file for the backup engine, which reads
# ZIGGY_B2_KEY_ID / ZIGGY_B2_APP_KEY from the ENVIRONMENT (not b2_credentials).
# Stream 2's backup systemd unit / the prod compose ziggy env_file source this.
_maybe_sudo tee "$ZIGGY_ETC_DIR/b2_env" >/dev/null <<EOF
ZIGGY_B2_KEY_ID=$B2_KEY_ID
ZIGGY_B2_APP_KEY=$B2_APP_KEY
ZIGGY_B2_BUCKET=$B2_BUCKET
ZIGGY_B2_ENDPOINT=$B2_ENDPOINT
EOF
_maybe_sudo chmod 600 "$ZIGGY_ETC_DIR/b2_env"

# --- 5.6 Write the kit manifest ---------------------------------------------
# Build the manifest body in a temp file first, then install it in one write.
# When the imaging script paired kit devices (zigbee-pair step), KIT_SENSORS_FILE
# holds a `sensors:` YAML block with each device's real IEEE + model + inferred
# type. Folding it in here is what makes those pre-paired devices show up in the
# mobile onboarding SensorsStep for the customer to name + place.
_MANIFEST_TMP="$(mktemp)"
{
  printf '# Generated by ziggy-image-device.sh (_seal_step.sh) at %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'device_id: %s\n' "$DEVICE_ID"
  printf 'home_id: %s\n' "$HOME_ID"
  printf 'coordinator_type: %s\n' "$COORDINATOR_TYPE"
  printf 'coordinator_ieee: "%s"\n' "$COORDINATOR_IEEE"
  [[ -n "${COORDINATOR_IP:-}" ]] && printf 'coordinator_ip: %s\n' "$COORDINATOR_IP"
  if [[ -n "${KIT_SENSORS_FILE:-}" && -f "$KIT_SENSORS_FILE" ]]; then
    # Only fold in a non-empty sensors list (skip the `sensors: []` placeholder
    # so a capture-IEEE-only run leaves the manifest sensor-less as before).
    if grep -q 'zigbee_mac:' "$KIT_SENSORS_FILE" 2>/dev/null; then
      cat "$KIT_SENSORS_FILE"
    fi
  fi
} > "$_MANIFEST_TMP"
_maybe_sudo tee "$ZIGGY_ETC_DIR/kit_manifest.yaml" >/dev/null < "$_MANIFEST_TMP"
rm -f "$_MANIFEST_TMP"
_maybe_sudo chmod 644 "$ZIGGY_ETC_DIR/kit_manifest.yaml"

# --- Verify data_key landed at exactly 32 bytes ------------------------------
KEY_SIZE="$(_maybe_sudo stat -c%s "$ZIGGY_ETC_DIR/data_key" 2>/dev/null \
             || _maybe_sudo stat -f%z "$ZIGGY_ETC_DIR/data_key")"
[[ "$KEY_SIZE" == "32" ]] || _die "data_key at $ZIGGY_ETC_DIR is $KEY_SIZE bytes, expected 32"

# --- 5.7 Wipe in-process secrets --------------------------------------------
unset MASTER_KEY_B64 DATA_KEY_B64 WRAPPED B2_CREDS_JSON || true
rm -f /tmp/seal-resp.json || true

_log "seal step complete (action=$ACTION, etc=$ZIGGY_ETC_DIR)"
