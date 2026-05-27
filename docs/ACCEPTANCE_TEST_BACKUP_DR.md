# Acceptance Test — Backup & Disaster Recovery (v1)

**Purpose:** Founder-executable runbook for the §14 acceptance test of [DESIGN_BACKUP_DR.md](../DESIGN_BACKUP_DR.md). Run end-to-end on **Beta Unit #1** during its imaging week — that hub is the first time all eleven implementation chunks meet a real Ubuntu mini-PC, real Backblaze B2, a real Fly.io relay, and a real Zigbee coordinator at the same time.

**Status:** Not yet executed. Beta Unit #1 hardware lands in ~3 weeks.
**Last updated:** 2026-05-27.
**Time budget:** ~26 hours wall-clock (step 5 requires a 24h wait). Active time ≈ 90 min.
**Related:** [DESIGN_BACKUP_DR.md §14](../DESIGN_BACKUP_DR.md), [RUNBOOK_DR.md](RUNBOOK_DR.md), [SEAL_KEY_SNIPPET_FOR_FACTORY_IMAGING.md](SEAL_KEY_SNIPPET_FOR_FACTORY_IMAGING.md).

---

## How to use this document

Run the phases in order. **Do not skip a step on a failure** — every step is a precondition for at least one later step. If a step fails:

1. Walk the **Troubleshooting** subsection for that step.
2. Fix the root cause (configuration, code, or environment).
3. Re-run the step from the top.
4. Only proceed to the next step after the failing one passes.

Record pass/fail + notes in the §"Sign-off" table at the bottom of this file (or a copy in your support log) as you go. Date each row.

---

## Pre-flight — must all be true before Step 1

Tick every box. If any is missing, **stop** and fix before starting.

### Hardware

- [ ] One Beelink S12 Pro, factory-sealed.
- [ ] One **SMLIGHT SLZB-06** Zigbee coordinator (PoE, network-attached).
- [ ] One **Sonoff ZBDongle-E** Zigbee coordinator (USB) — needed for steps 14–15 (cross-coordinator tests).
- [ ] One Zigbee sensor for pairing (Aqara door/motion or equivalent). Pre-paired or fresh.
- [ ] Ethernet patch + power for both the hub and the SLZB-06.

### Cloud + secrets

- [ ] Backblaze account active, `ziggy-backups-prod` bucket exists in **eu-central-003** (Amsterdam).
- [ ] Backblaze `ziggy-relay-backups` bucket also exists in eu-central-003.
- [ ] B2 **lifecycle rules** configured per [DESIGN_BACKUP_DR.md §9](../DESIGN_BACKUP_DR.md):
  - `ziggy-backups-prod/{home}/daily/*` → keep 7 most recent
  - `ziggy-backups-prod/{home}/weekly/*` → keep 4 most recent
  - `ziggy-relay-backups/daily/*` → keep 14 most recent
  - `ziggy-relay-backups/weekly/*` → keep 8 most recent
- [ ] Fly.io relay app deployed from `main` at or beyond commit `6ad0458` (Chunk #11 land).
- [ ] `fly secrets list` on the relay app shows: `RELAY_BACKUP_KEY`, `RELAY_B2_KEY_ID`, `RELAY_B2_APP_KEY`, `RELAY_JWT_SECRET`.
  - `RELAY_BACKUP_KEY` was generated once with `head -c 32 /dev/urandom | base64` and stored in 1Password (`Ziggy / relay-backup-key`).
- [ ] **Staging Fly app** (`ziggy-relay-staging`) provisioned with its own `/data/` volume — needed for step 17 without risking prod.

### Founder-held secrets

- [ ] **Founder master key** in 1Password (`Ziggy / founder-master-key`).
- [ ] **Founder master key paper backup** in the physical safe — verified readable in the last 90 days.
- [ ] **Relay backup key** in 1Password (`Ziggy / relay-backup-key`). Same value as the Fly secret.
- [ ] Founder JWT obtained for the test session:
  ```bash
  RELAY_URL=https://ziggy-relay.fly.dev
  curl -sS -X POST "$RELAY_URL/api/auth/login" \
      -H 'Content-Type: application/json' \
      -d '{"email":"<founder>","password":"<password>"}' | jq -r .token > /tmp/jwt
  ```

### Local tooling on the founder laptop

- [ ] `python3` with `cryptography`, `boto3`, `PyYAML`, `httpx`, `PyJWT` installed.
- [ ] `b2` CLI (Backblaze) installed and authenticated (for direct B2 inspection in steps 3, 5, 6, 16).
- [ ] `flyctl` installed and authenticated.
- [ ] `jq`, `curl`, `tar`, `sqlite3` available.
- [ ] Repo checked out at the same commit as the hub will run.

### Test home in the relay

- [ ] Test home created in relay's `homes` table via the normal invite/register flow. `home_id` recorded in the test log below.
- [ ] Founder's user has `relay_admin` role (verify with `GET /api/auth/me`).

**If any of the above is unticked, stop. The acceptance test is not ready to run.**

---

## Phase 1 — Per-home backup happy path (steps 1–6)

This phase validates the encrypt-and-upload side of the pipeline: imaging seals correctly, manual + scheduled runs land in B2, manifest is structurally sound, and the weekly promotion fires on Sunday.

### Step 1 — Image non-prod hub with the factory imaging script

**Goal:** A clean Beelink boots, runs the imaging script per `PROMPT_FACTORY_IMAGING.md`, generates `device_id` + `home_id` + per-home B2 key, seals the data_key into the relay, pairs the test sensor.

**Commands** (run on the Beelink):

```bash
# Founder-supplied during the imaging script's interactive flow:
#   - founder JWT (from /tmp/jwt on laptop, copied via secure channel)
#   - master key (paste from 1Password)
#   - kit manifest values (coordinator_type=smlight for this test)
sudo ./ziggy-image-device.sh
```

**Expected output (excerpted from the imaging script's tail):**

```
[<HOME_ID>] seal ok — action=first_seal
imaging complete. device_id=<HOME_ID>
ZHA: 1 device paired (sensor.test_door_contact)
```

**Pass criteria:**
- Imaging exits 0.
- `/etc/ziggy/data_key` exists, is exactly 32 bytes, mode 0600.
- `/etc/ziggy/b2_credentials` exists, parses as JSON, mode 0600.
- `/etc/ziggy/kit_manifest.yaml` contains `device_id`, `home_id`, `coordinator_type: smlight`, `coordinator_ieee`.
- One Zigbee sensor visible in HA.

Record the generated `HOME_ID` here: `__________________________________________`

**Troubleshooting:**
- Seal step fails with HTTP 400 → §"Wrong master key" in [RUNBOOK_DR.md](RUNBOOK_DR.md).
- Seal step fails with HTTP 404 → home not provisioned in relay; create the home row first.
- ZHA can't find the SLZB-06 → check mDNS / `coordinator_ip` in kit manifest; SLZB-06 must be on the same L2 segment as the hub.

If imaging cannot succeed, **stop** and do not continue this runbook.

---

### Step 2 — Verify initial seal in relay DB

**Goal:** The relay's `home_backup_keys` table holds a row for this home with non-null wrapped blobs.

**Commands (run on the founder laptop):**

```bash
flyctl ssh console --app ziggy-relay \
    --command "sqlite3 /data/relay.db \"
        SELECT home_id, length(wrapped_data_key) AS dk_len,
               length(wrapped_b2_credentials) AS b2_len,
               key_version, created_at
        FROM home_backup_keys WHERE home_id='$HOME_ID';\""
```

**Expected output:**

```
<HOME_ID>|60|<varies, expect 80–200>|1|2026-XX-XXTXX:XX:XX+00:00
```

**Pass criteria:**
- One row returned.
- `dk_len` is exactly 60 (12 nonce + 32 ciphertext + 16 tag).
- `b2_len` ≥ 80 (variable, B2 creds JSON is typically 60–120 bytes plaintext).
- `key_version` = 1.
- `created_at` is within the last few minutes.

**Troubleshooting:**
- Zero rows → seal-key POST didn't reach the relay. Check imaging script logs.
- `key_version` > 1 → home was sealed previously; this is fine for a re-test of the same `home_id` but means step 1 didn't generate a fresh UUID. For a clean acceptance run, re-image with a new UUID.
- `dk_len` ≠ 60 → wrap function on the imaging side is broken. Stop and investigate `services/backup_keys.wrap()`.

---

### Step 3 — Trigger backup manually + verify files in B2

**Goal:** The Chunk #5 CLI produces a real bundle that lands in `b2://ziggy-backups-prod/{HOME_ID}/daily/{today}/`.

**Commands (run on the Beelink):**

```bash
cd /opt/ziggy
sudo -E python3 -m services.backup_engine --once 2>&1 | tee /tmp/backup1.log
```

**Expected output (last 5 lines):**

```
... INFO services.backup_engine: backup ok home=<HOME_ID> files=4 bytes=<N> included_ha=[...]
{
  "ok": true,
  "stage": "done",
  "uploaded_bytes": <N>,
  "files": ["ha-config.tar.gz.enc", "ziggy-state.tar.gz.enc",
            "zha-network-backup.json.enc", "manifest.json.enc"],
  ...
}
```

**Verify in B2 (founder laptop):**

```bash
TODAY=$(date -u +%Y-%m-%d)
b2 ls --recursive ziggy-backups-prod "${HOME_ID}/daily/${TODAY}/"
b2 ls --recursive ziggy-backups-prod "${HOME_ID}/latest/"
```

**Expected (B2 listing):**

```
<HOME_ID>/daily/2026-XX-XX/ha-config.tar.gz.enc      <size>
<HOME_ID>/daily/2026-XX-XX/manifest.json.enc          <size>
<HOME_ID>/daily/2026-XX-XX/zha-network-backup.json.enc <size>
<HOME_ID>/daily/2026-XX-XX/ziggy-state.tar.gz.enc     <size>
<HOME_ID>/latest/ha-config.tar.gz.enc                 <size>
<HOME_ID>/latest/manifest.json.enc                    <size>
<HOME_ID>/latest/zha-network-backup.json.enc          <size>
<HOME_ID>/latest/ziggy-state.tar.gz.enc               <size>
```

**Pass criteria:**
- CLI exits 0 with `"ok": true`.
- 4 files in `daily/{today}/` (3 mandatory + manifest) — 5 if recorder.db included.
- 4 files in `latest/` matching the daily/ set.
- All file sizes > 0.

**Troubleshooting:**
- NTP pre-flight fails → `chronyc tracking` on hub, confirm sync within ±60s.
- B2 unreachable → check `RELAY_B2_*` env vars + the per-home B2 key in `/etc/ziggy/b2_credentials`.
- ZHA service call fails → HA logs (`docker compose logs homeassistant | tail -50`).
- Disk space pre-flight fails → free up `/tmp`.

---

### Step 4 — Verify manifest HMAC + schema_version locally

**Goal:** Independently decrypt + HMAC-verify the manifest off the hub, proving the bundle is recoverable from B2 alone.

**Commands (founder laptop):**

```bash
# Download
b2 file download \
    "b2://ziggy-backups-prod/${HOME_ID}/latest/manifest.json.enc" \
    /tmp/manifest.enc

# Pull the data_key (we know it from imaging; for real DR we'd unseal —
# but for this verification step we use it directly to isolate the
# crypto from the unseal path).
DATA_KEY_B64=$(sudo cat /etc/ziggy/data_key | base64)  # on the hub, or copy out via scp

# Decrypt + verify via the restore helper:
echo "$DATA_KEY_B64" > /tmp/dk.b64
python3 scripts/factory/restore_helper.py decrypt-manifest \
    --data-key-file /tmp/dk.b64 \
    < /tmp/manifest.enc \
    | tee /tmp/manifest.json
```

**Expected output (sample fields):**

```json
{
  "schema_version": 1,
  "home_id": "<HOME_ID>",
  "device_id": "<HOME_ID>",
  "coordinator_type": "smlight",
  "coordinator_ieee": "00:12:4b:...",
  "files": [ {...}, {...}, {...} ],
  "optional_skipped": []
}
```

stderr line confirms HMAC + schema check:

```
manifest ok — schema_version=1, files=3, coordinator='smlight'
```

**Pass criteria:**
- `restore_helper.py` exits 0.
- `schema_version` = 1.
- `home_id` matches §1's recorded value.
- `coordinator_type` = `smlight`.
- `files` array has at least 3 entries (ha-config, ziggy-state, zha-network-backup).

**Troubleshooting:**
- "manifest HMAC verification FAILED" → wrong data_key. Re-check `/etc/ziggy/data_key`.
- "manifest schema_version N > supported 1" → backup was produced by a newer Ziggy than the helper. Update the helper's repo checkout.
- Decryption error → the bundle may be partially uploaded; re-run step 3 and re-download.

**Cleanup:**

```bash
shred -u /tmp/dk.b64 /tmp/manifest.enc /tmp/manifest.json
```

---

### Step 5 — Wait 24h, verify scheduled run

**Goal:** Confirm the scheduler tick fires at 02:00 local time and produces a second daily backup, overwriting `latest/` with today's keys.

**Setup:** This step takes ≥ 24 hours wall-clock. Flip `backup.enabled: true` in `config/settings.yaml` on the hub if it isn't already, and restart the Ziggy agent so the scheduler picks up the change.

**Commands (after the 02:00 tick the day after step 3):**

```bash
TODAY_2=$(date -u +%Y-%m-%d)
b2 ls ziggy-backups-prod "${HOME_ID}/daily/${TODAY_2}/"
b2 ls ziggy-backups-prod "${HOME_ID}/latest/"

# Check the relay's audit log for the scheduled hub report:
flyctl ssh console --app ziggy-relay \
    --command "sqlite3 /data/relay.db \"
        SELECT ts, event, detail FROM audit_log
        WHERE home_id='$HOME_ID' AND event='backup_status_updated'
        ORDER BY ts DESC LIMIT 3;\""
```

**Expected:**

- `daily/<yesterday>/` from step 3 is still present.
- `daily/<today>/` exists with the same 4 files.
- `latest/` files have a Last-Modified within the last few hours (today, not step 3's date).
- Audit log row from the scheduler run with `detail` containing `uploaded_bytes`, `files`, etc. as JSON.

**Pass criteria:**
- Two daily directories exist (step 3 + step 5).
- `latest/` points at today's daily.
- Audit log has the new `backup_status_updated` row.

**Troubleshooting:**
- No second daily → check `journalctl -u ziggy` for the scheduler tick log line ("Firing daily backup at 02:00"). If missing, `backup.enabled` was false or the hub was offline at 02:00.
- Second daily exists but `latest/` not updated → server-side copy permission issue with the per-home B2 key (`writeFiles` capability missing).
- Audit row missing despite B2 files present → relay POST failed; check the hub's logs for the `backup-status` HTTP response.

---

### Step 6 — Verify Sunday weekly promotion

**Goal:** On the first Sunday during the test window, the engine creates a `weekly/{ISO-week}/` copy via B2 server-side copy.

**Setup:** Run this step the Sunday after step 5 (or use a manual run with a faked date if you don't want to wait — see Troubleshooting).

**Commands (Sunday after the 02:00 tick):**

```bash
ISO_WEEK=$(date -u +%G-W%V)
b2 ls --recursive ziggy-backups-prod "${HOME_ID}/weekly/${ISO_WEEK}/"
```

**Expected:**

```
<HOME_ID>/weekly/2026-W21/ha-config.tar.gz.enc       <size>
<HOME_ID>/weekly/2026-W21/manifest.json.enc          <size>
<HOME_ID>/weekly/2026-W21/zha-network-backup.json.enc <size>
<HOME_ID>/weekly/2026-W21/ziggy-state.tar.gz.enc      <size>
```

**Pass criteria:** Four files exist in the `weekly/{ISO_WEEK}/` prefix. Sizes match the corresponding `daily/{sunday-date}/` files exactly (this is a server-side copy, no re-encryption).

**Troubleshooting:**
- Weekly directory missing → the engine's "is today Sunday?" check (`now.weekday() == 6`) didn't fire. Confirm timezone — the engine uses local time on the hub. Check `date` output.
- To **test without waiting for Sunday**: monkey-patch `today=` in `BackupContext.from_settings()` via a one-off Python invocation:
  ```bash
  sudo -E python3 -c "
  import datetime
  from services.backup_engine import BackupContext, run_daily_backup_with_lock
  ctx = BackupContext.from_settings(today=datetime.date(2026, 5, 24))  # a Sunday
  print(run_daily_backup_with_lock(ctx))
  "
  ```
  This is a verification-only shortcut. The actual scheduled path uses `dt.date.today()`.

---

## Phase 2 — Wipe-and-restore happy path (steps 7–12)

This phase wipes the hub clean, re-images, and runs the restore script end-to-end. It's the most operationally complex part and the closest analog to the actual customer DR scenario.

### Step 7 — Wipe the hub

**Goal:** Destroy all local state on the hub so step 9's restore is a real recovery, not a partial overlay.

**Commands (on the Beelink):**

```bash
# Capture pre-wipe state for comparison after restore:
sudo tar -czf ~/pre-wipe-snapshot.tar.gz /opt/ziggy/user_files /opt/ziggy/config /opt/ziggy/docker/ha-config
sudo cp /etc/ziggy/kit_manifest.yaml ~/pre-wipe-kit_manifest.yaml

# Now wipe:
cd /opt/ziggy
docker compose down -v   # -v removes named volumes too
sudo rm -rf docker/ha-config user_files config
sudo rm -rf /etc/ziggy/data_key /etc/ziggy/b2_credentials /etc/ziggy/kit_manifest.yaml
```

**Pass criteria:**
- `/opt/ziggy/docker/ha-config`, `/opt/ziggy/user_files`, `/opt/ziggy/config` are gone.
- `/etc/ziggy/data_key` is gone.
- `docker volume ls` shows no Ziggy-related volumes.
- Pre-wipe snapshot at `~/pre-wipe-snapshot.tar.gz` is intact (we'll compare in step 11).

**Troubleshooting:**
- `rm -rf` permission denied → use `sudo`. The data_key file is mode 0600 root-owned.
- `docker compose down -v` doesn't remove volumes → ensure compose project name matches; use `docker volume rm` explicitly.

---

### Step 8 — Re-image with a fresh device_id

**Goal:** A blank Beelink returns to kit-ready state. **This run uses a fresh UUID** — the new `device_id`/`home_id` is the "replacement hub" identity.

**Commands (on the Beelink):**

```bash
sudo ./ziggy-image-device.sh
```

When the script asks for the home_id, **enter a fresh UUID** (the script can generate one). Record:
- `NEW_HOME_ID = __________________________________________`
- `OLD_HOME_ID = <from step 1 — this is what we restore FROM>`

Note: in real DR the old hub is dead, so the operator only knows the OLD device_id; the new device_id is generated fresh by the imaging script. This step models that.

**Pass criteria:** Same as step 1, but with `NEW_HOME_ID` distinct from `OLD_HOME_ID`.

**Troubleshooting:** Same as step 1.

---

### Step 9 — Run `ziggy-restore-device.sh` and verify completion

**Goal:** Restore the OLD hub's data onto the new hub. Operationally identical to a real customer DR — follow [RUNBOOK_DR.md](RUNBOOK_DR.md) §"Happy path" for the in-script procedure.

**Commands (on the new Beelink):**

```bash
cd /opt/ziggy
time ./scripts/factory/ziggy-restore-device.sh "$OLD_HOME_ID"
```

When prompted, type a clear reason such as: `acceptance test 2026-XX-XX — wipe-and-restore from Phase 2`.

**Pass criteria:**
- Script reports steps 1/24 through 24/24 without aborting.
- `time` reports < 30 minutes wall-clock for the script body (excluding the network downloads, which depend on customer bandwidth).
- Final block reads "RESTORE COMPLETE" with `old device_id: $OLD_HOME_ID`.
- `/etc/ziggy/data_key` exists, 32 bytes, mode 0600 (re-created from unseal).
- `/etc/ziggy/b2_credentials` exists with the OLD home's B2 key.

**Troubleshooting:**
- Unseal returns 400 → see [RUNBOOK_DR.md](RUNBOOK_DR.md) §"Wrong master key".
- Schema_version > KNOWN → step 8 re-imaged with an older Ziggy than step 3's backup was produced with. Pull latest, re-image, re-run.
- HA doesn't come up within 90s → check `docker compose logs homeassistant`; recorder DB may be corrupted from the restored bundle. As a fallback, re-run the script with `--dry-run` to confirm the bundle itself is sound.

**Decision branch:** If step 9 passes, continue. If it fails, fix per the troubleshooting and re-run — do NOT proceed to step 10 with a half-restored hub.

---

### Step 10 — Verify ZHA mesh re-formation

**Goal:** The Zigbee sensor paired in step 1 reports state on the restored hub without re-pairing, within 1 hour.

**Setup:** After step 9 completes, wait up to 60 minutes (sensors check in on their sleep-wake cycle). Trigger the sensor manually if possible (open the door, walk past the motion detector) to force an earlier report.

**Commands (founder laptop, polling):**

```bash
# Watch HA state for the original sensor entity:
HA_URL=http://homeassistant.local:8123
HA_TOKEN=<long-lived token>
watch -n 10 "curl -sS -H 'Authorization: Bearer $HA_TOKEN' \
    $HA_URL/api/states/sensor.test_door_contact | jq -r .state"
```

**Expected:** Within an hour, `.state` becomes a real value (`on`, `off`, a temperature, etc.) — not `unavailable` or `unknown`.

**Pass criteria:**
- Original sensor (paired in step 1) reports a fresh state within 60 minutes.
- ZHA logs `network adopted` at HA startup (`docker compose logs homeassistant | grep -i 'zha.*network'`).
- No "device unavailable" alerts in HA after the sensor reports.

**Troubleshooting:**
- Sensor never reports → check that the SLZB-06 is the SAME PHYSICAL UNIT as in step 1. ZHA's network backup carries the network key but the coordinator must be the same family.
- ZHA logs say "could not adopt network" → the zha-network-backup.json may have been placed in the wrong location. Confirm `ha-config/.storage/core.zigbee_network_backup_*.json` exists with the restored content.

---

### Step 11 — Verify Ziggy state restored

**Goal:** Customer-visible state (automations, IR devices, auth records) matches what existed pre-wipe.

**Commands (on the new Beelink):**

```bash
# Compare key state files against the pre-wipe snapshot from step 7:
sudo tar -tzf ~/pre-wipe-snapshot.tar.gz | sort > /tmp/pre-wipe.list
( cd /opt/ziggy && find user_files config docker/ha-config -type f | sort ) > /tmp/post-restore.list
diff /tmp/pre-wipe.list /tmp/post-restore.list
```

Also test a known automation through Ziggy's natural-language interface (e.g., ask Ziggy something that depends on `user_files/ir_devices.json` or an automation that was set up before step 7).

**Pass criteria:**
- `diff` output is empty OR only differs in expected places (HA logs, recorder DB if oversized — listed in `manifest.optional_skipped`).
- At least one IR device or automation works end-to-end through Ziggy.
- User authentication works with credentials known pre-wipe (`user_files/auth.db` restored intact).

**Troubleshooting:**
- Many files missing → restore script may have failed silently mid-extraction. Re-run step 9.
- Specific files missing → check the manifest's `files[].sha256_plaintext` against the restored file (compute `sha256sum`). A mismatch means the file was corrupted on B2; an extra entry in `diff` means the pre-wipe snapshot included junk that shouldn't have been backed up — refine `HA_STORAGE_PREFIX_ALLOWLIST` in `services/backup_engine.py`.

---

### Step 12 — Verify audit log entries

**Goal:** Every state-changing operation in this acceptance run is recorded in the relay's `audit_log`.

**Commands (founder laptop):**

```bash
flyctl ssh console --app ziggy-relay \
    --command "sqlite3 /data/relay.db \"
        SELECT ts, event, ok, substr(detail, 1, 80) AS detail
        FROM audit_log
        WHERE home_id IN ('$OLD_HOME_ID', '$NEW_HOME_ID')
        ORDER BY ts;\""
```

**Expected (in chronological order):**

```
2026-XX-XX...|backup_key_sealed       |1|first_seal              ← step 1
2026-XX-XX...|backup_status_updated   |1|{"uploaded_bytes":...}  ← step 3
2026-XX-XX...|backup_status_updated   |1|{"uploaded_bytes":...}  ← step 5
2026-XX-XX...|backup_key_sealed       |1|first_seal              ← step 8 (NEW_HOME_ID)
2026-XX-XX...|backup_key_unsealed     |1|founder=... reason=...  ← step 9
2026-XX-XX...|restore_completed       |1|old_device_id=...       ← step 9 tail
```

**Pass criteria:**
- `backup_key_sealed` row for OLD_HOME_ID exists with `ok=1`.
- `backup_status_updated` rows for OLD_HOME_ID exist with `ok=1`.
- `backup_key_unsealed` row for OLD_HOME_ID exists with `ok=1` and contains the test reason string.
- `restore_completed` row for OLD_HOME_ID exists with `ok=1`.

**Troubleshooting:**
- Missing `backup_key_unsealed` → step 9 didn't reach the relay; check the restore script's curl output.
- Missing `restore_completed` → the restore script's step 23 failed (non-fatal per [RUNBOOK_DR.md](RUNBOOK_DR.md), but you should know why; usually `relay_secret` missing from restored `settings.yaml`).

---

## Phase 3 — Per-home negative tests (steps 13–15)

### Step 13 — Negative test: typo master key on unseal

**Goal:** A wrong master key produces a clean 400 with no leak, and the audit log captures the failed attempt.

**Setup:** Re-image (step 7 → 8) or use a third UUID, OR simply attempt the unseal directly with `curl` without running the full restore script.

**Commands:**

```bash
WRONG_MASTER=$(head -c 32 /dev/urandom | base64)  # random; will not unwrap
JWT=$(cat /tmp/jwt)

curl -sS -o /tmp/unseal-resp.json -w "%{http_code}\n" \
    -X POST "$RELAY_URL/api/homes/$OLD_HOME_ID/unseal" \
    -H "Authorization: Bearer $JWT" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg mk "$WRONG_MASTER" \
              '{master_key_b64:$mk, reason:"acceptance step 13 — intentional wrong key"}')"
```

**Expected:**

```
400
```

```json
{"detail": "Unable to unseal."}
```

**Then check the audit log:**

```bash
flyctl ssh console --app ziggy-relay \
    --command "sqlite3 /data/relay.db \"
        SELECT ok, detail FROM audit_log
        WHERE home_id='$OLD_HOME_ID' AND event='backup_key_unsealed'
        ORDER BY ts DESC LIMIT 1;\""
```

Expected: `0|wrong_master_key founder=... reason=acceptance step 13 ...`.

**Pass criteria:**
- HTTP 400 returned.
- Response body is exactly `{"detail": "Unable to unseal."}` — no leak about whether the home is sealed.
- Audit log row with `ok=0` and `detail` starting with `wrong_master_key`.

**Troubleshooting:**
- HTTP 200 → wrong master key somehow unwrapped successfully (effectively impossible with random input; check the test setup).
- HTTP 422 → request body shape wrong; re-check the jq invocation.

---

### Step 14 — Negative test: cross-coordinator restore without flag

**Goal:** Attempting a restore where the backup's coordinator_type doesn't match the new hub's kit manifest aborts cleanly with a descriptive error.

**Setup:** Re-image step 8 but with the **Sonoff ZBDongle-E** plugged in instead of the SLZB-06; kit manifest will say `coordinator_type: sonoff_e`. The backup we're restoring (from step 1) says `coordinator_type: smlight`.

**Commands:**

```bash
./scripts/factory/ziggy-restore-device.sh "$OLD_HOME_ID"
# At the "PROCEED?" prompt, type y.
# Expect abort at step 10/24.
```

**Expected output:**

```
[XX:XX:XX] Step 10/24: verifying coordinator type vs new hub
restore_helper: coordinator mismatch: backup is 'smlight', new hub is 'sonoff_e'.
Pass --allow-coordinator-switch if you intend to cross-restore (advanced — see DESIGN_BACKUP_DR.md §8).
```

Script exit code: 1.

**Pass criteria:**
- Restore aborts at step 10/24.
- Error message names both coordinator types explicitly.
- Error message mentions `--allow-coordinator-switch`.
- `/etc/ziggy/data_key` was NOT overwritten (was already cleared by step 7).
- `/opt/ziggy/docker/ha-config` was NOT modified (compose was not stopped).

**Troubleshooting:**
- Script proceeds past step 10 → `--allow-coordinator-switch` was accidentally enabled, or the kit manifest doesn't say `sonoff_e`. Re-check both.
- Script aborts earlier than step 10 → an earlier step failed; troubleshoot that first.

---

### Step 15 — Negative test: cross-coordinator restore WITH flag

**Goal:** Same setup as step 14, but with `--allow-coordinator-switch` the restore completes. Sensors re-join the new coordinator using the same network key.

**Commands:**

```bash
./scripts/factory/ziggy-restore-device.sh "$OLD_HOME_ID" --allow-coordinator-switch
```

**Expected output (excerpted):**

```
[XX:XX:XX] Step 10/24: verifying coordinator type vs new hub
WARNING: coordinator switch — backup=smlight → hub=sonoff_e.
Sensors will adopt the network key seamlessly.
[XX:XX:XX] Step 11/24: downloading + decrypting 4 backup file(s)
...
RESTORE COMPLETE
```

Wait up to 60 minutes, then poll the test sensor's state (same as step 10).

**Pass criteria:**
- Script completes through step 24/24.
- Test sensor reports state on the Sonoff-E coordinator within 60 minutes.
- ZHA logs in HA show "network adopted" with the Sonoff-E radio path (`/dev/serial/by-id/usb-ITead_*`).

**Troubleshooting:**
- Sensor doesn't report → ZHA may have refused to adopt; check `core.zigbee_network_backup_*.json` exists in `.storage/` post-restore and HA's ZHA integration startup logs.
- This is an **advanced** path — if it fails repeatedly with no clear cause, defer to v1.1 and document the limitation to customers (don't cross-coordinator their hubs).

---

## Phase 4 — Relay DB backup pipeline (steps 16–17)

### Step 16 — Verify relay DB backup ran

**Goal:** The nightly relay DB backup is producing encrypted snapshots in `ziggy-relay-backups`.

**Setup:** External cron / systemd timer / GitHub Action on the relay Fly machine must be configured to run `python -m relay.app.db_backup --once` nightly. Verify by listing recent runs:

**Commands (founder laptop):**

```bash
# List recent daily snapshots:
b2 ls --recursive ziggy-relay-backups daily/

# And the latest pointer:
b2 ls ziggy-relay-backups latest/

# Manually trigger one if no recent snapshot exists (the docs-defined CLI):
flyctl ssh console --app ziggy-relay \
    --command "python -m relay.app.db_backup --once"
```

**Expected output:**

- `daily/2026-XX-XX/relay.db.enc` files present for the last several days.
- `latest/relay.db.enc` present.
- Manual trigger returns `"ok": true` with non-zero `encrypted_bytes` and `plaintext_bytes`.

**Pass criteria:**
- At least one snapshot in `daily/` from the last 24h.
- `latest/relay.db.enc` exists.
- Snapshot file size > 0.

**Troubleshooting:**
- No daily snapshots → cron/timer not configured on Fly machine. Set up per [relay/app/db_backup.py](../relay/app/db_backup.py) module docstring.
- Manual `--once` fails with "RELAY_BACKUP_KEY env var missing" → Fly secrets not set. `fly secrets set RELAY_BACKUP_KEY=<base64>`.
- Manual `--once` fails with `RELAY_B2_KEY_ID` missing → same fix, different secret name.

---

### Step 17 — Simulated relay DB loss + restore

**Goal:** Recover from a complete loss of `/data/relay.db` on the relay. **Run on the staging Fly app** (`ziggy-relay-staging`), not production.

**Setup:**
- Confirm staging relay has at least one snapshot in `ziggy-relay-backups` (run step 16's `--once` against staging first if needed — but careful: staging and prod share the same `ziggy-relay-backups` bucket, so a staging-side restore would pull a prod snapshot. For a clean test, use a SEPARATE bucket for staging snapshots, or stand up a one-off `ziggy-relay-backups-staging` bucket).

**Commands:**

```bash
# Step 17.1 — Delete /data/relay.db on staging
flyctl ssh console --app ziggy-relay-staging \
    --command "rm /data/relay.db && echo DELETED"

# Step 17.2 — Stop the relay process (will exit on next request anyway, but
# we want a clean halt for the test):
flyctl apps suspend ziggy-relay-staging

# Step 17.3 — Download the latest snapshot to the founder laptop:
b2 file download \
    "b2://ziggy-relay-backups-staging/latest/relay.db.enc" \
    /tmp/relay.db.enc

# Step 17.4 — Decrypt with RELAY_BACKUP_KEY (from 1Password):
read -r -s -p "RELAY_BACKUP_KEY (base64): " RBK; echo
python3 -c "
import base64, os, sys
from relay.app.db_backup import unwrap
key = base64.b64decode('$RBK', validate=True)
blob = open('/tmp/relay.db.enc', 'rb').read()
open('/tmp/relay.db.restored', 'wb').write(unwrap(key, blob))
print('decrypt ok:', len(open('/tmp/relay.db.restored','rb').read()), 'bytes')
"

# Step 17.5 — Upload to staging Fly volume:
flyctl ssh console --app ziggy-relay-staging \
    --command "mkdir -p /data"
flyctl ssh sftp shell --app ziggy-relay-staging <<EOF
put /tmp/relay.db.restored /data/relay.db
quit
EOF

# Step 17.6 — Resume and verify:
flyctl apps resume ziggy-relay-staging
sleep 10
curl -fsS https://ziggy-relay-staging.fly.dev/health
```

**Expected:**

- Step 17.4 prints `decrypt ok: <N> bytes` where N matches the snapshot's plaintext_bytes from step 16.
- Step 17.6 returns `{"ok": true, "service": "ziggy-relay"}`.

**Pass criteria:**
- Staging relay comes up after the restore.
- Old `home_backup_keys` rows are queryable (try the step 2 query against staging).
- Audit_log entries from before the deletion are intact (`SELECT count(*) FROM audit_log` should match a known prior count).

**Troubleshooting:**
- Decrypt fails with InvalidTag → wrong RELAY_BACKUP_KEY; check 1Password.
- Upload via sftp fails → use `flyctl ssh console` to copy from the running machine's `/tmp` to `/data/`.
- Relay won't start → check Fly logs; the restored DB schema must match what `init_db()` would create. If `init_db()` ran before the restore overwrote `/data/relay.db`, it might have created a different schema — restart cleanly.

**Cleanup:**

```bash
shred -u /tmp/relay.db.enc /tmp/relay.db.restored
unset RBK
```

---

## Phase 5 — Relay DB negative test (step 18)

### Step 18 — Negative test: wrong RELAY_BACKUP_KEY on relay DB restore

**Goal:** A wrong RELAY_BACKUP_KEY (or accidentally using the per-home master key) fails with a clear GCM tag error, and `/data/relay.db` is not partially written.

**Setup:** Same staging app, but with a DIFFERENT scenario — try decryption with a wrong key BEFORE attempting to overwrite the file.

**Commands:**

```bash
# Try the per-home master key by mistake:
read -r -s -p "Per-home master key (the WRONG one to use here): " MASTER; echo
b2 file download \
    "b2://ziggy-relay-backups-staging/latest/relay.db.enc" \
    /tmp/relay.db.enc

python3 -c "
import base64, sys
from cryptography.exceptions import InvalidTag
from relay.app.db_backup import unwrap
key = base64.b64decode('$MASTER', validate=True)
blob = open('/tmp/relay.db.enc', 'rb').read()
try:
    out = unwrap(key, blob)
    open('/data/relay.db', 'wb').write(out)  # this should NEVER execute
    print('UH OH: decrypt succeeded with wrong key')
    sys.exit(1)
except InvalidTag:
    print('expected InvalidTag — clean refusal')
    sys.exit(0)
"
```

**Expected output:**

```
expected InvalidTag — clean refusal
```

Exit code: 0 (the test passes because the wrong key was correctly rejected).

**Pass criteria:**
- Python script prints `expected InvalidTag — clean refusal`.
- `/data/relay.db` on the staging machine was NOT modified during this step (verify via `flyctl ssh console ... ls -la /data/relay.db`).
- No partial file written anywhere on the laptop's filesystem.

**Troubleshooting:**
- Decrypt unexpectedly succeeded → keys collided by coincidence (statistically impossible) or the per-home master IS the relay backup key (a configuration mistake — they should be different per [DESIGN_BACKUP_DR.md §11 amendment](../DESIGN_BACKUP_DR.md)). Stop and investigate.

**Cleanup:**

```bash
shred -u /tmp/relay.db.enc
unset MASTER
```

---

## Sign-off

Acceptance test for v1 of the Backup & DR pipeline. Each row below is filled in **as the test passes**, not in advance. Failing steps remain blank with notes in the comments column.

| Step | Pass / Fail | Date | Notes |
|---|---|---|---|
| Pre-flight all green | | | |
| 1. Image non-prod hub | | | |
| 2. Initial seal in relay DB | | | |
| 3. Manual backup trigger | | | |
| 4. Manifest HMAC + schema | | | |
| 5. 24h scheduled run | | | |
| 6. Sunday weekly promotion | | | |
| 7. Wipe hub | | | |
| 8. Re-image | | | |
| 9. Restore script completion | | | |
| 10. ZHA mesh re-forms | | | |
| 11. Ziggy state restored | | | |
| 12. Audit log entries | | | |
| 13. Typo master key (negative) | | | |
| 14. Cross-coord no-flag (negative) | | | |
| 15. Cross-coord with-flag | | | |
| 16. Relay DB backup ran | | | |
| 17. Simulated relay DB loss | | | |
| 18. Wrong RELAY_BACKUP_KEY (negative) | | | |

When every row in the table is **Pass**, complete the final sign-off:

| Role | Name | Signature | Date |
|---|---|---|---|
| Acceptance Lead | Founder | — | — |
| Acceptance Approved (v1 ships) | Founder | — | — |

**Until both signature lines above are dated, the Backup & DR pipeline is NOT acceptance-cleared for production beyond Beta Unit #1.**

---

## After the acceptance test passes

1. Update [DESIGN_BACKUP_DR.md §16 Sign-Off](../DESIGN_BACKUP_DR.md) with the acceptance date + founder signature.
2. Flip `backup.enabled: true` as the default in `config/settings.example.yaml` (currently defaults `false` for safety).
3. Document the test artifact: a copy of the completed table above lives in the founder's support archive, dated and signed.
4. Schedule a quarterly DR drill — re-execute steps 7–12 on a customer-volunteer hub or a dedicated staging hub. Trigger date in calendar.
5. Schedule an annual paper-only master key recovery drill (steps from [RUNBOOK_DR.md §6](RUNBOOK_DR.md)).

---

## References

- [DESIGN_BACKUP_DR.md](../DESIGN_BACKUP_DR.md) — full design, especially §14 (acceptance test plan)
- [RUNBOOK_DR.md](RUNBOOK_DR.md) — operator runbook for real customer DR (overlaps with steps 9–12 here; this doc references it instead of duplicating)
- [SEAL_KEY_SNIPPET_FOR_FACTORY_IMAGING.md](SEAL_KEY_SNIPPET_FOR_FACTORY_IMAGING.md) — what the imaging script in step 1 + step 8 must do
- [scripts/factory/ziggy-restore-device.sh](../scripts/factory/ziggy-restore-device.sh) — the script exercised in steps 9, 14, 15
- [relay/app/db_backup.py](../relay/app/db_backup.py) — the relay DB pipeline exercised in steps 16, 17, 18
