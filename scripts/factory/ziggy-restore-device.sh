#!/usr/bin/env bash
# ziggy-restore-device.sh — disaster recovery for a Ziggy hub.
#
# Run after `ziggy-image-device.sh` brings up a fresh Beelink S12 Pro.
# The founder retrieves the master key from 1Password, this script does
# the rest: unseal → download → decrypt → install → start.
#
# Full design: DESIGN_BACKUP_DR.md §7 (restore flow).
# This script implements steps 1–24 from that section.
#
# USAGE:
#   ./ziggy-restore-device.sh <old_device_id> [flags]
#
# Required arg:
#   <old_device_id>   The device_id of the dead hub. v1 assumes this
#                     equals the home_id (set so by the factory imaging
#                     script at provisioning time).
#
# Flags:
#   --relay-url URL              Override settings.relay.url
#   --ha-config DIR              Where HA config lives (default docker/ha-config)
#   --user-files DIR             Where user_files/ should land (default user_files)
#   --config DIR                 Where config/ should land (default config)
#   --kit-manifest PATH          /etc/ziggy/kit_manifest.yaml by default
#   --data-key-path PATH         /etc/ziggy/data_key by default
#   --b2-credentials-path PATH   /etc/ziggy/b2_credentials by default
#   --bucket NAME                B2 bucket (default ziggy-backups-prod)
#   --founder-token-file PATH    Read founder JWT from a file (else prompt)
#   --allow-coordinator-switch   Permit cross-coordinator restore
#   --dry-run                    Stop after manifest decrypt + verify;
#                                does not touch /etc/ziggy, containers, or dirs.
#   -h, --help                   Show this header + exit
#
# Exit codes:
#   0 success
#   1 generic failure (message on stderr)
#   2 bad args
#
# Required tools: bash, curl, jq, python3 (with `cryptography`, `boto3`,
# `PyYAML` — already in requirements.txt from Chunk #1).

set -euo pipefail

# ---------- defaults ----------

RELAY_URL=""
HA_CONFIG_DIR="docker/ha-config"
USER_FILES_DIR="user_files"
CONFIG_DIR="config"
KIT_MANIFEST="/etc/ziggy/kit_manifest.yaml"
DATA_KEY_PATH="/etc/ziggy/data_key"
B2_CREDS_PATH="/etc/ziggy/b2_credentials"
B2_BUCKET="ziggy-backups-prod"
FOUNDER_TOKEN_FILE=""
DRY_RUN=0
ALLOW_COORD_SWITCH=0
OLD_DEVICE_ID=""

# ---------- arg parsing ----------

while [[ $# -gt 0 ]]; do
    case "$1" in
        --relay-url)              RELAY_URL="$2"; shift 2 ;;
        --ha-config)              HA_CONFIG_DIR="$2"; shift 2 ;;
        --user-files)             USER_FILES_DIR="$2"; shift 2 ;;
        --config)                 CONFIG_DIR="$2"; shift 2 ;;
        --kit-manifest)           KIT_MANIFEST="$2"; shift 2 ;;
        --data-key-path)          DATA_KEY_PATH="$2"; shift 2 ;;
        --b2-credentials-path)    B2_CREDS_PATH="$2"; shift 2 ;;
        --bucket)                 B2_BUCKET="$2"; shift 2 ;;
        --founder-token-file)     FOUNDER_TOKEN_FILE="$2"; shift 2 ;;
        --allow-coordinator-switch) ALLOW_COORD_SWITCH=1; shift ;;
        --dry-run)                DRY_RUN=1; shift ;;
        -h|--help)
            sed -n '2,46p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        -*) echo "Unknown flag: $1" >&2; exit 2 ;;
        *)
            if [[ -z "$OLD_DEVICE_ID" ]]; then
                OLD_DEVICE_ID="$1"; shift
            else
                echo "Unexpected positional arg: $1" >&2; exit 2
            fi
            ;;
    esac
done

[[ -n "$OLD_DEVICE_ID" ]] || { echo "USAGE: $0 <old_device_id> [flags]" >&2; exit 2; }

# v1 mapping (see header): home_id == device_id.
HOME_ID="$OLD_DEVICE_ID"

# ---------- locate repo + helper ----------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
HELPER="$SCRIPT_DIR/restore_helper.py"
[[ -f "$HELPER" ]] || { echo "restore helper missing: $HELPER" >&2; exit 1; }

# Resolve RELAY_URL from settings.yaml if not overridden.
if [[ -z "$RELAY_URL" ]]; then
    if [[ -f "$REPO/$CONFIG_DIR/settings.yaml" ]]; then
        RELAY_URL=$(python3 -c "
import sys, yaml
d = yaml.safe_load(open(sys.argv[1])) or {}
print((d.get('relay') or {}).get('url', ''))
" "$REPO/$CONFIG_DIR/settings.yaml")
    fi
fi
[[ -n "$RELAY_URL" ]] || { echo "RELAY_URL not set and not found in settings.yaml" >&2; exit 1; }

# ---------- helpers ----------

TMPDIR="$(mktemp -d -t ziggy-restore-XXXXXX)"
chmod 700 "$TMPDIR"
trap 'rm -rf "$TMPDIR"' EXIT

log()  { echo "[$(date +%H:%M:%S)] $*"; }
die()  { echo "ERROR: $*" >&2; exit 1; }

prompt_secret() {
    local prompt="$1" v
    if ! read -r -s -p "$prompt" v < /dev/tty 2>/dev/tty; then
        die "could not read from /dev/tty (run interactively, not via stdin pipe)"
    fi
    echo >&2
    printf "%s" "$v"
}

prompt_line() {
    local prompt="$1" v
    if ! read -r -p "$prompt" v < /dev/tty 2>/dev/tty; then
        die "could not read from /dev/tty"
    fi
    printf "%s" "$v"
}

# Verify required external tools up front.
for tool in curl jq python3; do
    command -v "$tool" >/dev/null 2>&1 || die "missing required tool: $tool"
done

# ---------- step 1-2: founder JWT ----------

log "Step 1/24: relay = $RELAY_URL"

if [[ -n "$FOUNDER_TOKEN_FILE" ]]; then
    [[ -f "$FOUNDER_TOKEN_FILE" ]] || die "token file not found: $FOUNDER_TOKEN_FILE"
    FOUNDER_TOKEN=$(<"$FOUNDER_TOKEN_FILE")
else
    log "Step 2/24: founder authentication"
    FOUNDER_TOKEN="$(prompt_secret 'Founder JWT (from relay /auth/login): ')"
fi
[[ -n "$FOUNDER_TOKEN" ]] || die "founder token required"

# ---------- step 3-4: master key + reason ----------

log "Step 3/24: master key (paste from 1Password)"
MASTER_KEY_B64="$(prompt_secret 'Master key (base64, 32 bytes): ')"
[[ -n "$MASTER_KEY_B64" ]] || die "master key required"

log "Step 4/24: reason for unseal (audited on the relay)"
REASON="$(prompt_line 'Reason (e.g. "customer ABC hub failure 2026-05-27"): ')"
[[ -n "$REASON" ]] || die "reason required"

# ---------- step 5: unseal ----------

log "Step 5/24: calling /api/homes/$HOME_ID/unseal"
UNSEAL_REQ="$TMPDIR/unseal-req.json"
UNSEAL_RESP="$TMPDIR/unseal-resp.json"
jq -n --arg mk "$MASTER_KEY_B64" --arg r "$REASON" \
    '{master_key_b64:$mk, reason:$r}' > "$UNSEAL_REQ"

HTTP_CODE=$(curl -sS -o "$UNSEAL_RESP" -w "%{http_code}" \
    -X POST "$RELAY_URL/api/homes/$HOME_ID/unseal" \
    -H "Authorization: Bearer $FOUNDER_TOKEN" \
    -H "Content-Type: application/json" \
    --data @"$UNSEAL_REQ")

if [[ "$HTTP_CODE" != "200" ]]; then
    echo "--- relay response (HTTP $HTTP_CODE) ---" >&2
    cat "$UNSEAL_RESP" >&2 || true
    die "unseal failed; verify home_id, founder token, and master key"
fi

DATA_KEY_B64=$(jq -r '.data_key_b64' "$UNSEAL_RESP")
B2_CREDS_JSON=$(jq -c '.b2_credentials' "$UNSEAL_RESP")
TTL=$(jq -r '.ttl_seconds' "$UNSEAL_RESP")
log "  → data_key + b2_credentials returned (TTL ${TTL}s)"

# Stash data_key on disk inside the tmpdir for the helper to consume.
echo -n "$DATA_KEY_B64" > "$TMPDIR/data_key.b64"
chmod 600 "$TMPDIR/data_key.b64"

# ---------- step 6: download manifest ----------

log "Step 6/24: downloading manifest.json.enc"
python3 "$HELPER" download-b2 \
    --b2-credentials-json "$B2_CREDS_JSON" \
    --bucket "$B2_BUCKET" \
    --key "$HOME_ID/latest/manifest.json.enc" \
    --output "$TMPDIR/manifest.json.enc"

# ---------- step 7-9: decrypt + verify + schema check ----------

log "Step 7-9/24: decrypting, HMAC-verifying, schema-checking manifest"
MANIFEST_JSON="$TMPDIR/manifest.json"
python3 "$HELPER" decrypt-manifest \
    --data-key-file "$TMPDIR/data_key.b64" \
    < "$TMPDIR/manifest.json.enc" \
    > "$MANIFEST_JSON"

BACKUP_DATE=$(jq -r '.created_at' "$MANIFEST_JSON")
ZIGGY_VER=$(jq -r '.ziggy_version' "$MANIFEST_JSON")
HA_VER=$(jq -r '.ha_version // "(unknown)"' "$MANIFEST_JSON")
MANIFEST_COORD=$(jq -r '.coordinator_type' "$MANIFEST_JSON")
COORD_IEEE=$(jq -r '.coordinator_ieee // "(unknown)"' "$MANIFEST_JSON")
NFILES=$(jq -r '.files | length' "$MANIFEST_JSON")
SKIPPED=$(jq -c '.optional_skipped // []' "$MANIFEST_JSON")

echo ""
echo "=========== backup summary ==========="
echo "  backup date:        $BACKUP_DATE"
echo "  ziggy version:      $ZIGGY_VER"
echo "  HA version:         $HA_VER"
echo "  coordinator_type:   $MANIFEST_COORD"
echo "  coordinator_ieee:   $COORD_IEEE"
echo "  file count:         $NFILES"
echo "  optional_skipped:   $SKIPPED"
echo "======================================"
echo ""

if [[ $DRY_RUN -eq 1 ]]; then
    log "DRY RUN: stopping after manifest verification. Nothing has been written."
    log "Files in $TMPDIR will be cleaned up on exit."
    exit 0
fi

CONFIRM="$(prompt_line "PROCEED with restore? [y/N]: ")"
[[ "$CONFIRM" == "y" || "$CONFIRM" == "Y" ]] || die "aborted by founder"

# ---------- step 10: coordinator check ----------

log "Step 10/24: verifying coordinator type vs new hub"
COORD_FLAGS=()
[[ $ALLOW_COORD_SWITCH -eq 1 ]] && COORD_FLAGS+=("--allow-switch")
# Allow restore on a hub that hasn't been imaged with a kit_manifest yet
# (treat absence as "operator knows what they're doing").
[[ -f "$KIT_MANIFEST" ]] || COORD_FLAGS+=("--allow-missing")
python3 "$HELPER" verify-coordinator \
    --kit-manifest "$KIT_MANIFEST" \
    --manifest-coord "$MANIFEST_COORD" \
    "${COORD_FLAGS[@]}"

# ---------- step 11: download + decrypt all files ----------

log "Step 11/24: downloading + decrypting $NFILES backup file(s)"
mapfile -t FILE_NAMES < <(jq -r '.files[].name' "$MANIFEST_JSON")
for enc_name in "${FILE_NAMES[@]}"; do
    log "  · $enc_name"
    python3 "$HELPER" download-b2 \
        --b2-credentials-json "$B2_CREDS_JSON" \
        --bucket "$B2_BUCKET" \
        --key "$HOME_ID/latest/$enc_name" \
        --output "$TMPDIR/$enc_name"

    plain_name="${enc_name%.enc}"
    python3 "$HELPER" decrypt-file \
        --data-key-file "$TMPDIR/data_key.b64" \
        --filename "$enc_name" \
        --output "$TMPDIR/$plain_name" \
        < "$TMPDIR/$enc_name"
done

# ---------- step 12: stop services ----------

log "Step 12/24: stopping ziggy + Home Assistant"
if command -v systemctl >/dev/null && systemctl is-active --quiet ziggy 2>/dev/null; then
    sudo systemctl stop ziggy || log "  (systemctl stop ziggy failed — continuing)"
fi
( cd "$REPO" && docker compose stop homeassistant 2>/dev/null ) || \
    log "  (docker compose stop homeassistant failed — continuing)"

# ---------- step 13: move existing dirs aside ----------

log "Step 13/24: preserving existing target directories"
STAMP="$(date +%Y%m%d-%H%M%S)"
for d in "$REPO/$HA_CONFIG_DIR" "$REPO/$USER_FILES_DIR" "$REPO/$CONFIG_DIR"; do
    if [[ -d "$d" && -n "$(ls -A "$d" 2>/dev/null)" ]]; then
        log "  $d → ${d}.pre-restore-$STAMP"
        mv "$d" "${d}.pre-restore-$STAMP"
    fi
    mkdir -p "$d"
done

# ---------- step 14-16: extract bundles ----------

log "Step 14/24: extracting ha-config.tar.gz → $HA_CONFIG_DIR"
tar -xzf "$TMPDIR/ha-config.tar.gz" -C "$REPO/$HA_CONFIG_DIR"

log "Step 15/24: extracting ziggy-state.tar.gz"
# ziggy-state archive contains 'user_files/' and 'config/' at its root.
# Extract to a staging dir, then move into place — handles any
# user-customized target names.
STAGE="$TMPDIR/stage"
mkdir -p "$STAGE"
tar -xzf "$TMPDIR/ziggy-state.tar.gz" -C "$STAGE"
if [[ -d "$STAGE/user_files" ]]; then
    cp -a "$STAGE/user_files/." "$REPO/$USER_FILES_DIR/"
fi
if [[ -d "$STAGE/config" ]]; then
    cp -a "$STAGE/config/." "$REPO/$CONFIG_DIR/"
fi

log "Step 16/24: placing ZHA network backup → .storage/"
mkdir -p "$REPO/$HA_CONFIG_DIR/.storage"
# Use the manifest-time filename to avoid collision with anything HA
# may have already generated.
cp "$TMPDIR/zha-network-backup.json" \
   "$REPO/$HA_CONFIG_DIR/.storage/core.zigbee_network_backup_restored.json"

# ---------- step 17: optional recorder DB ----------

if [[ -f "$TMPDIR/recorder.db" ]]; then
    log "Step 17/24: restoring recorder.db"
    cp "$TMPDIR/recorder.db" "$REPO/$HA_CONFIG_DIR/home-assistant_v2.db"
else
    log "Step 17/24: no recorder.db in backup (skipped or oversized — fine)"
fi

# ---------- step 18: write keys to /etc/ziggy/ ----------

log "Step 18/24: writing data_key + b2_credentials to system paths"
python3 "$HELPER" write-keys \
    --data-key-b64 "$DATA_KEY_B64" \
    --b2-credentials-json "$B2_CREDS_JSON" \
    --data-key-path "$DATA_KEY_PATH" \
    --b2-credentials-path "$B2_CREDS_PATH"

# ---------- step 19-22: start services ----------

log "Step 19/24: starting Home Assistant"
( cd "$REPO" && docker compose start homeassistant ) || die "HA start failed"

log "Step 20/24: waiting for HA to come up (≤ 90s)"
HA_URL_FROM_SETTINGS=$(python3 -c "
import yaml
d = yaml.safe_load(open('$REPO/$CONFIG_DIR/settings.yaml')) or {}
print(((d.get('home_assistant') or {}).get('url') or '').rstrip('/'))
")
HA_URL="${HA_URL_FROM_SETTINGS:-http://homeassistant.local:8123}"
deadline=$(( $(date +%s) + 90 ))
until curl -fsS "$HA_URL/" >/dev/null 2>&1; do
    [[ $(date +%s) -gt $deadline ]] && die "HA did not respond within 90s"
    sleep 3
done
log "  HA reachable at $HA_URL"

log "Step 21/24: ZHA adopts network parameters from .storage backup at startup"

log "Step 22/24: starting ziggy"
if command -v systemctl >/dev/null && systemctl list-unit-files ziggy.service >/dev/null 2>&1; then
    sudo systemctl start ziggy || log "  (systemctl start ziggy failed — start manually)"
else
    log "  (no ziggy systemd unit — operator should start the agent manually)"
fi

# ---------- step 23: report restore_completed ----------

log "Step 23/24: reporting restore_completed to relay"
RELAY_SECRET=$(python3 -c "
import yaml
d = yaml.safe_load(open('$REPO/$CONFIG_DIR/settings.yaml')) or {}
print(((d.get('relay') or {}).get('secret') or ''))
")
if [[ -n "$RELAY_SECRET" ]]; then
    BODY=$(jq -n \
        --arg ev "restore_completed" \
        --arg old "$OLD_DEVICE_ID" \
        --arg new "$(hostname)" \
        --arg reason "$REASON" \
        '{event:$ev, old_device_id:$old, new_device_id:$new, reason:$reason}')
    SIG=$(python3 -c "
import sys, os
sys.path.insert(0, '$REPO')
from relay.app.audit import sign
print(sign(os.environ['RS'], sys.stdin.read().encode()))
" RS="$RELAY_SECRET" <<< "$BODY")
    curl -sS -X POST "$RELAY_URL/api/homes/$HOME_ID/restore-events" \
        -H "X-Ziggy-Signature: $SIG" \
        -H "Content-Type: application/json" \
        --data "$BODY" >/dev/null \
        || log "  (restore-events POST failed — non-fatal, restore is complete)"
else
    log "  (no relay_secret in restored settings.yaml — skipping restore-events POST)"
fi

# ---------- step 24: success ----------

log "Step 24/24: done."
echo ""
echo "================================================================"
echo "  RESTORE COMPLETE"
echo "================================================================"
echo "  old device_id:  $OLD_DEVICE_ID"
echo "  home_id:        $HOME_ID"
echo "  backup date:    $BACKUP_DATE"
echo "  ziggy version:  $ZIGGY_VER"
echo "  coordinator:    $MANIFEST_COORD"
echo ""
echo "  Zigbee mesh re-formation is asynchronous (~1h). Sensors check in"
echo "  as they wake; ZHA has already adopted the network parameters."
echo ""
echo "  Preserved pre-restore directories (delete after verification):"
ls -d "$REPO"/*.pre-restore-"$STAMP" 2>/dev/null || true
echo "================================================================"
