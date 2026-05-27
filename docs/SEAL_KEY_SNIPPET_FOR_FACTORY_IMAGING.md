# SEAL_KEY_SNIPPET_FOR_FACTORY_IMAGING

**Purpose:** Specification for the seal-key step that the factory imaging script (`ziggy-image-device.sh`, defined in the founder's `PROMPT_FACTORY_IMAGING.md` and built in a future Claude Code session) **must** include. This document is intentionally copy-pasteable — paste it as a section of the imaging-script prompt, or invoke the bash/Python blocks below verbatim from inside the imaging script.

**Status:** v1 spec. Founder review pending integration into the imaging prompt.
**Last updated:** 2026-05-27.
**Related:** [DESIGN_BACKUP_DR.md §4 + §10 + §13 Chunk #10](../DESIGN_BACKUP_DR.md), [relay/app/routers/backup_keys.py](../relay/app/routers/backup_keys.py).

---

## 1. What this step does

After the imaging script has installed Docker + Home Assistant + the Ziggy edge agent and registered the home with the cloud relay, **but before the hub is verified and shipped**, it must:

1. Generate a per-home 32-byte AES-256-GCM `data_key`.
2. Generate / fetch a per-home Backblaze B2 application key, prefix-restricted to this home's `home_id/`.
3. Wrap both with the founder's master key (held in 1Password, never persisted on the hub or relay).
4. Send the wrapped blobs to the relay's `POST /api/homes/{home_id}/seal-key` endpoint. The relay verifies the master key matches (proof-of-knowledge) and stores the wrapped blobs in `home_backup_keys`. The master key is discarded.
5. Persist `data_key` and `b2_credentials` on the hub at `/etc/ziggy/` (mode 0600) so the daily backup engine can use them.
6. Write the kit manifest at `/etc/ziggy/kit_manifest.yaml` so the edge agent's `BackupContext.from_settings()` finds `device_id` + `coordinator_type` + `coordinator_ieee`.

If this step does not run, the hub will fail its kit-ready check and **must not ship**. See [DESIGN_BACKUP_DR.md §3](../DESIGN_BACKUP_DR.md) — sealed key material is Tier-1.

---

## 2. v1 identity model: `device_id` == `home_id`

The imaging script generates **one** UUID v4 and uses it as **both** `device_id` (on the hub, in the kit manifest) and `home_id` (in the relay's `homes` table, in B2 object paths, in audit_log rows).

```bash
DEVICE_ID="$(uuidgen | tr 'A-Z' 'a-z')"   # also used as HOME_ID
HOME_ID="$DEVICE_ID"
```

**Why this constraint:** the restore script ([scripts/factory/ziggy-restore-device.sh](../scripts/factory/ziggy-restore-device.sh)) takes the old device_id as input and uses it as the home_id directly. No `device_id → home_id` lookup exists on the relay in v1.

**Future work (founder-tracked, v1.1 timeline):** add `GET /admin/homes/by-device/{device_id}` to the relay so customers can replace hubs whose `device_id` was generated independently of `home_id` (e.g., for fleet auditing where hubs and homes are separately tracked). When that lands, this 1:1 constraint can be relaxed.

---

## 3. Inputs the imaging script must already have

| Input | Source | Notes |
|---|---|---|
| `DEVICE_ID` / `HOME_ID` | Generated at imaging start (§2) | UUID v4 |
| `COORDINATOR_TYPE` | Kit manifest YAML shipped with the box | `smlight` or `sonoff_e` |
| `COORDINATOR_IEEE` | Read from ZHA after pairing | e.g. `00:12:4b:00:11:22:33:44` |
| `RELAY_URL` | Hard-coded in imaging script | `https://ziggy-relay.fly.dev` |
| `FOUNDER_JWT` | Issued by `POST $RELAY_URL/api/auth/login` at imaging start | Held in memory only |
| `MASTER_KEY_B64` | Prompted from operator (paste from 1Password) | base64 of 32 raw bytes |
| `B2_KEY_ID` / `B2_APP_KEY` | Per-home Backblaze application key | See §4 |
| `B2_BUCKET` | Hard-coded | `ziggy-backups-prod` |
| `B2_ENDPOINT` | Hard-coded | `https://s3.eu-central-003.backblazeb2.com` |

The home **must already exist** in the relay's `homes` table by the time this step runs. If your imaging script uses the existing `/api/auth/register` invite-acceptance flow, the row is created there. If you provision homes a different way, ensure `POST /api/homes/{home_id}/seal-key` will find the row — it returns **404** otherwise.

---

## 4. Provisioning the per-home B2 application key

Per [DESIGN_BACKUP_DR.md §5](../DESIGN_BACKUP_DR.md), each home gets its own B2 app key, **prefix-restricted to `{home_id}/`**. This way, a compromised hub can only damage its own home's backups.

The imaging script can either:

- **(a) Call the Backblaze API directly** with a master B2 admin key, creating a new prefix-scoped key per home. This is the production path.
- **(b) Use a pre-provisioned per-home key** generated offline. Acceptable for the first few beta hubs but doesn't scale.

For (a) — minimal `b2 application-key create` example using the official `b2` CLI:

```bash
B2_KEY_RESPONSE=$(b2 application-key create \
    --bucket ziggy-backups-prod \
    --namePrefix "$HOME_ID/" \
    "key-for-$HOME_ID" \
    listFiles,readFiles,writeFiles,deleteFiles)
B2_KEY_ID=$(echo "$B2_KEY_RESPONSE" | jq -r '.applicationKeyId')
B2_APP_KEY=$(echo "$B2_KEY_RESPONSE" | jq -r '.applicationKey')
```

The capabilities **must** include `writeFiles` (for daily uploads) and `readFiles` (for restore). `listFiles` is needed for the pre-flight B2 reachability check.

---

## 5. The seal step (bash + Python)

This is the actual seal-key invocation. Drop it into the imaging script after §3's inputs are available and §4's B2 key has been provisioned.

```bash
# scripts/factory/_seal_step.sh — invoked from ziggy-image-device.sh
#
# Inputs (env): HOME_ID, DEVICE_ID, COORDINATOR_TYPE, COORDINATOR_IEEE,
#               RELAY_URL, FOUNDER_JWT, MASTER_KEY_B64,
#               B2_KEY_ID, B2_APP_KEY, B2_BUCKET, B2_ENDPOINT
set -euo pipefail

# --- 5.1 Generate per-home data_key (32 raw bytes) -----------------------
DATA_KEY_B64="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"

# --- 5.2 Build the B2 credentials JSON the hub will store ----------------
B2_CREDS_JSON=$(jq -n \
    --arg id  "$B2_KEY_ID" \
    --arg ak  "$B2_APP_KEY" \
    --arg ep  "$B2_ENDPOINT" \
    --arg bk  "$B2_BUCKET" \
    '{b2_key_id:$id, b2_app_key:$ak, b2_endpoint:$ep, b2_bucket:$bk}')

# --- 5.3 Wrap both with the master key (via a Python helper) -------------
# Uses the same AES-256-GCM wire format as services/backup_keys.wrap()
# and relay/app/routers/backup_keys._unwrap(). See DESIGN_BACKUP_DR.md §4.
WRAPPED=$(python3 - "$MASTER_KEY_B64" "$DATA_KEY_B64" "$B2_CREDS_JSON" <<'PY'
import base64, json, os, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

master = base64.b64decode(sys.argv[1], validate=True)
data_key = base64.b64decode(sys.argv[2], validate=True)
b2_creds_json = sys.argv[3].encode("utf-8")
assert len(master)   == 32, "master key must decode to 32 bytes"
assert len(data_key) == 32, "data_key must be 32 bytes"

def wrap(key, plaintext):
    nonce = os.urandom(12)
    ct_with_tag = AESGCM(key).encrypt(nonce, plaintext, None)
    return base64.b64encode(nonce + ct_with_tag).decode()

print(json.dumps({
    "master_key_b64":             sys.argv[1],
    "wrapped_data_key_b64":       wrap(master, data_key),
    "wrapped_b2_credentials_b64": wrap(master, b2_creds_json),
}))
PY
)

# --- 5.4 POST /api/homes/{home_id}/seal-key -----------------------------
HTTP_CODE=$(curl -sS -o /tmp/seal-resp.json -w "%{http_code}" \
    -X POST "$RELAY_URL/api/homes/$HOME_ID/seal-key" \
    -H "Authorization: Bearer $FOUNDER_JWT" \
    -H "Content-Type: application/json" \
    --data "$WRAPPED")

if [[ "$HTTP_CODE" != "200" ]]; then
    cat /tmp/seal-resp.json >&2
    echo "seal-key failed (HTTP $HTTP_CODE) for home $HOME_ID" >&2
    exit 1
fi

ACTION=$(jq -r '.action' /tmp/seal-resp.json)   # "first_seal" or "re_sealed"
echo "[$HOME_ID] seal ok — action=$ACTION"

# --- 5.5 Persist runtime key material on the hub (mode 0600) -------------
sudo mkdir -p /etc/ziggy
echo -n "$DATA_KEY_B64" | base64 -d | sudo tee /etc/ziggy/data_key >/dev/null
sudo chmod 600 /etc/ziggy/data_key
echo "$B2_CREDS_JSON" | sudo tee /etc/ziggy/b2_credentials >/dev/null
sudo chmod 600 /etc/ziggy/b2_credentials

# --- 5.6 Write the kit manifest -----------------------------------------
sudo tee /etc/ziggy/kit_manifest.yaml >/dev/null <<EOF
# Generated by ziggy-image-device.sh at $(date -u +%Y-%m-%dT%H:%M:%SZ)
device_id: $DEVICE_ID
home_id:   $HOME_ID
coordinator_type: $COORDINATOR_TYPE
coordinator_ieee: "$COORDINATOR_IEEE"
EOF
sudo chmod 644 /etc/ziggy/kit_manifest.yaml

# --- 5.7 Wipe in-process secrets -----------------------------------------
unset MASTER_KEY_B64
unset DATA_KEY_B64
unset WRAPPED
unset B2_CREDS_JSON
rm -f /tmp/seal-resp.json
```

---

## 6. Master key prompt UX

The master key (32 bytes, base64-encoded → ~44 chars) is **prompted once at the start of the imaging script** and held in memory for §5.3 only.

```bash
read -r -s -p "Founder master key (paste from 1Password, base64): " MASTER_KEY_B64
echo

# Sanity check — decode and re-encode to fail fast on typos:
DECODED_LEN=$(echo -n "$MASTER_KEY_B64" | base64 -d 2>/dev/null | wc -c | tr -d ' ')
if [[ "$DECODED_LEN" != "32" ]]; then
    echo "ERROR: master key must decode to 32 bytes, got $DECODED_LEN" >&2
    exit 1
fi
```

**The imaging script must never echo, log, or persist `MASTER_KEY_B64`.** It transits the script for exactly the duration of §5.3's seal call, then `unset` in §5.7 drops it.

---

## 7. Endpoint contract (excerpted from relay/app/routers/backup_keys.py)

| Aspect | Value |
|---|---|
| Method + path | `POST /api/homes/{home_id}/seal-key` |
| Auth | `Authorization: Bearer <FOUNDER_JWT>` (role `relay_admin`) |
| Content-Type | `application/json` |
| Body fields | `master_key_b64`, `wrapped_data_key_b64`, `wrapped_b2_credentials_b64` |
| Success | `200 OK` with `{ok: true, home_id, action: "first_seal" \| "re_sealed"}` |
| Wrong master | `400` — relay attempts to unwrap and fails (proof-of-knowledge check) |
| Unknown home_id | `404` — home not in `homes` table |
| Bad base64 | `400` |
| Master not 32 bytes | `400` |
| Wrong / missing JWT | `401` / `403` |

Re-sealing an already-sealed home is permitted (founder re-images the hub). The relay updates the row in place and bumps `key_version`.

---

## 8. Error handling the imaging script must implement

| Failure | Detection | What to do |
|---|---|---|
| Master key decodes to wrong length | `base64 -d | wc -c` ≠ 32 | Abort imaging; prompt operator to recheck 1Password entry |
| `seal-key` returns 400 (proof-of-knowledge failed) | HTTP code | Master key doesn't match the wrapped blobs. Usually a typo. Abort, re-prompt. |
| `seal-key` returns 404 | HTTP code | Home wasn't provisioned in relay. Imaging script must run the provision step before seal. |
| `seal-key` returns 401/403 | HTTP code | Founder JWT expired or insufficient role. Re-login to relay. |
| Network failure mid-seal | curl exit code ≠ 0 | Retry up to 3× with backoff. After 3 failures, abort imaging — do NOT proceed to ship without a confirmed seal. |
| `/etc/ziggy/` write fails | `sudo tee` exits non-zero | Almost always permissions. Abort. Hub should not ship without writable `/etc/ziggy/`. |

**Any failure here is fatal for the imaging run.** The kit-ready checklist must explicitly check that `/etc/ziggy/data_key` exists and has size 32, and that `home_backup_keys` row exists on the relay (queryable via `GET /api/homes/{home_id}` as the founder).

---

## 9. Verification step (the imaging script's own gate)

Before declaring the hub kit-ready, the imaging script should verify the seal landed correctly by triggering a **dry-run backup** end-to-end:

```bash
# This invokes services/backup_engine via the Chunk #5 CLI. Dry-run
# encrypts + manifests + verifies all the pieces but skips the actual
# B2 upload — proves the seal is consistent without burning bandwidth.
cd /opt/ziggy
python3 -m services.backup_engine --once --dry-run
```

Exit code 0 means the seal is internally consistent. The kit checklist treats this as the "sealed and ready" signal.

Then, before shipping, the **first real backup** is also taken (no `--dry-run`). That's the "kit-ready" gate per [DESIGN_BACKUP_DR.md §6](../DESIGN_BACKUP_DR.md) — the founder verifies the first backup landed in B2 before leaving the customer's home.

---

## 10. What this snippet does NOT cover

- **Home provisioning** in the relay `homes` table — that's a separate step earlier in the imaging script (use `/api/auth/register` for invite-driven, or the founder's chosen admin endpoint for direct).
- **Master key generation.** The founder generated this once, well before any imaging. It lives in 1Password and on paper in a physical safe. See [DESIGN_BACKUP_DR.md §11](../DESIGN_BACKUP_DR.md).
- **Cloudflare Tunnel + hub registration** — already part of the existing imaging flow.
- **B2 lifecycle rule configuration** — set once in the B2 console for the `ziggy-backups-prod` bucket; not per-hub.
- **Operator imaging UX** — flowing the operator through the script's prompts (founder JWT login, master key paste, kit manifest values). PROMPT_FACTORY_IMAGING.md owns that.

---

## 11. References

- [DESIGN_BACKUP_DR.md §4](../DESIGN_BACKUP_DR.md) — envelope encryption model
- [DESIGN_BACKUP_DR.md §10](../DESIGN_BACKUP_DR.md) — relay schema (target of seal-key)
- [relay/app/routers/backup_keys.py](../relay/app/routers/backup_keys.py) — server-side handler
- [services/backup_keys.py](../services/backup_keys.py) — `wrap()`/`unwrap()` wire format
- [scripts/factory/ziggy-restore-device.sh](../scripts/factory/ziggy-restore-device.sh) — the consumer of what this seal step produces
- [RUNBOOK_DR.md](RUNBOOK_DR.md) — operator-facing runbook for the disaster-recovery path
