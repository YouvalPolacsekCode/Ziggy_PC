# DESIGN_BACKUP_DR — Ziggy Backup & Disaster Recovery

**Status:** Approved by founder 2026-05-27 (with revisions applied). Implementation proceeding in commit-sized chunks per §13.
**Owner:** Founder.
**Last updated:** 2026-05-27.

---

## 1. Goals & Non-Goals

### Goals

- **G1.** Daily encrypted backup of every shipped hub to S3-compatible storage (Backblaze B2).
- **G2.** Restore time **under 30 min** from a blank Beelink S12 Pro to "customer's home, same state" — excluding physical Zigbee mesh re-formation (which the coordinator backup automates).
- **G3.** Per-home envelope encryption with founder-held master key. Founder cannot read user data without an explicit, audited unseal action.
- **G4.** Retention: 7 daily + 4 weekly per hub.
- **G5.** Dual Zigbee coordinator support — SMLIGHT SLZB-06 (primary, PoE/network) and Sonoff ZBDongle-E (secondary, USB). Same backup format; restore can target either.
- **G6.** Implementable in commit-sized chunks; each step independently revertable.

### Non-Goals

- **NG1.** Continuous / streaming backup. Daily snapshots are sufficient.
- **NG2.** Point-in-time recovery within a day. Latest daily wins.
- **NG3.** Replacing or interfering with HA's `hassio.backup` service domain — that's blocked at [backend/routers/ha_router.py:159](backend/routers/ha_router.py#L159) per S3, and stays blocked.
- **NG4.** Automated key unsealing. Every unseal is a manual founder action.
- **NG5.** Surfacing coordinator-switching to customers. Cross-coordinator restore is documented as advanced operator option only.

Relay-side data backup (homes/users/invites/audit_log/home_backup_keys) **is in scope** — see §13 Chunk #8. Without it, every hub's `wrapped_data_key` is a single point of failure: lose the Fly.io volume and every customer backup becomes permanently undecryptable.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CUSTOMER HOME                            │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Beelink S12 Pro (hub)                                    │   │
│  │                                                          │   │
│  │  ┌─────────┐  ┌──────────────┐  ┌────────────────────┐   │   │
│  │  │ HA      │  │ Ziggy edge   │  │ services/          │   │   │
│  │  │ +ZHA    │  │ + scheduler  │  │ backup_engine.py   │   │   │
│  │  └────┬────┘  └──────┬───────┘  └──────────┬─────────┘   │   │
│  │       │              │                     │             │   │
│  │   ha-config/    user_files/+config/     daily tick       │   │
│  │       │              │                     │             │   │
│  │       └──────────────┴─────────────────────┘             │   │
│  │                       │                                  │   │
│  │              ┌────────▼─────────┐                        │   │
│  │              │ Encrypt (AES-GCM)│                        │   │
│  │              │ with data_key    │                        │   │
│  │              └────────┬─────────┘                        │   │
│  └───────────────────────┼──────────────────────────────────┘   │
└──────────────────────────┼──────────────────────────────────────┘
                           │ HTTPS (B2 S3 API)
                           ▼
              ┌────────────────────────┐
              │  Backblaze B2          │
              │  ziggy-backups-prod    │
              │  {home_id}/{date}/...  │
              └────────────────────────┘

                       ╔═══════════════╗
                       ║ RESTORE PATH  ║
                       ╚═══════════════╝
                              │
   founder runs:              ▼
   ziggy-restore-device.sh <device_id>
                              │
        ┌─────────────────────┴─────────────────────┐
        │                                           │
        ▼                                           ▼
  Relay /admin/unseal               B2 download {home_id}/latest/
  (founder pastes                         │
   master key from 1Password)             │
        │                                 │
        └──────► ephemeral data_key ◄─────┘
                       │
                       ▼
              Decrypt → write to ha-config/,
              user_files/, config/, ZHA restore
                       │
                       ▼
              Start HA + Ziggy → verify
```

---

## 3. Data Assets & Tiering

Two priority tiers. Tier-1 is required for a hub to be "kit-ready." Tier-2 is best-effort.

### Tier 1 — must-have (block ship if missing)

| Asset | Source path | Why |
|---|---|---|
| HA core config | `docker/ha-config/configuration.yaml`, `automations.yaml`, `scenes.yaml`, `scripts.yaml`, `customize.yaml`, `secrets.yaml`, `.storage/` (excluding cache) | Identity of the HA install |
| ZHA Zigbee network backup | Produced via HA service `zha.network_backup` → JSON file in `ha-config/.storage/core.zigbee_network_backup_*.json` | Sensors re-join mesh on any same-family coordinator without physical re-pairing |
| Ziggy state | All of `user_files/` (auth.db, home_map.db, state_memory.json, events.jsonl, ir_devices.json, device_registry.json, automation_meta.json, automation_history.json, persons.json, pattern_candidates.json, push_subscriptions.json, quick_asks.json, suggestions.json, zones.json, mobile_pair_codes.json, update_history.json, ui_prefs.json, local_automation_actions.json, routine_meta.json, mock_anomalies.json, vapid_keys.json, ir_unknown_signals.jsonl) | Customer-specific automations, devices, auth |
| Ziggy config | `config/settings.yaml`, `config/secrets.yaml`, `config/ziggy_memory.yaml`, `config/contacts.yaml` | Integrations, room mappings, persistent memory |
| Kit manifest | The YAML used by `ziggy-image-device.sh`; captures `coordinator_type`, sensor inventory, device_id | Needed for restore to pick correct ZHA radio path |

### Tier 2 — optional (skip if oversized)

| Asset | Threshold | Behavior |
|---|---|---|
| HA recorder DB | `ha-config/home-assistant_v2.db` if ≤ 500 MB | Backed up daily; if > 500 MB, skipped and tagged `optional_skipped` in manifest |

### Explicit exclusions

- HA cache directories: `ha-config/deps/`, `ha-config/tts/`, `ha-config/.cloud/`, `ha-config/home-assistant.log*` — regenerable
- Python `__pycache__`, `*.pyc`
- Ziggy log files (rotated; not DR-critical)

---

## 4. Encryption Model

### Envelope encryption

```
┌──────────────────────┐
│ Master Key (256-bit) │   ← Founder-held. 1Password personal vault.
│  in 1Password        │     Paper backup in physical safe.
└──────────┬───────────┘     NEVER in code, env, or cloud DB.
           │
           │ AES-256-GCM
           ▼
┌──────────────────────┐
│ wrapped_data_key     │   ← Stored in relay DB: home_backup_keys table.
│  (per home)          │     Useless without master key.
└──────────┬───────────┘
           │ unwrap (manual unseal)
           ▼
┌──────────────────────┐
│ data_key (256-bit)   │   ← Per-home. Held on hub at runtime.
│  per home            │     Encrypts every file in that home's bucket prefix.
└──────────┬───────────┘
           │ AES-256-GCM, random 96-bit nonce per file
           ▼
   Encrypted bundles on B2
```

### Cipher choices

- **Wrap (master → data_key):** AES-256-GCM, 96-bit random nonce, master key from 1Password.
- **Bulk encryption (files):** AES-256-GCM, fresh 96-bit nonce per file. File-specific subkeys derived via HKDF-SHA256 from `data_key` + filename salt — so a leaked single-file key cannot decrypt other files.
- **Manifest integrity:** HMAC-SHA256 with `data_key` over the manifest JSON.
- **Library:** Python `cryptography` (pyca/cryptography). Already audited; no rolled-our-own.

### Data key lifecycle

| Event | Action |
|---|---|
| Factory imaging (new hub) | `ziggy-image-device.sh` generates `data_key`, wraps with master key (founder pastes), stores wrapped blob in relay; ephemeral copy held on hub for runtime backups |
| Routine daily backup | Hub uses runtime `data_key` to encrypt; no relay interaction |
| Disaster restore | Founder runs unseal → relay returns `data_key` (5-min TTL) → new hub decrypts and continues using it |
| Key rotation (future) | Out of scope for v1. Document upgrade path in §15 |

### Where the runtime data_key lives on the hub

Stored at `/etc/ziggy/data_key` (root-owned, mode 0600), outside the repo and outside any backup bundle (would create a circular dependency). On hub destruction, it's lost — that's intentional; recovery requires founder unseal.

### Why not just KMS?

Considered AWS KMS / Hetzner Cloud KMS / Vault. Rejected because:
- Adds a dependency that breaks if cloud KMS provider is down at restore time
- Founder explicitly wants 1Password + paper as custody — already operationally familiar
- B2 + Python `cryptography` + relay DB = three components we already run; KMS = a fourth

### Master key handling on the relay (accepted risk)

Master key resides in relay process memory for the duration of a single unseal request handler. Python provides **no guaranteed memory zeroing** — `bytes` objects are immutable and never wiped on garbage collection. Mitigation relies on:

- **(a) Short request lifetime.** Unseal handler completes in well under one second; GC reclaims the page quickly.
- **(b) No swap.** Fly.io machines run without swap by default — the key never spills to disk.
- **(c) Machine isolation.** Each Fly machine is a separate Firecracker microVM; co-tenants cannot read its memory.

Documented as **accepted risk** for v1. Full mitigation requires either a C extension that does `explicit_bzero()` after use, or moving the unwrap operation to an external KMS / HSM that never exposes plaintext. Deferred to v1.1.

---

## 5. Storage Layout on Backblaze B2

### Bucket

- **Name:** `ziggy-backups-prod` (single bucket for all homes)
- **Region:** `us-east-005` (closest to Fly.io relay; not customer-facing latency-sensitive)
- **Versioning:** Enabled (B2 native; supports lifecycle deletion)
- **Default encryption:** SSE-B2 (B2-managed AES). This is **belt-and-suspenders** on top of our envelope encryption — we never trust it for confidentiality.
- **Lifecycle rules:** See §9.

### Per-home key scoping

One **application key per home**, B2 prefix-restricted to `{home_id}/`. If a hub is compromised, revoke that one app key — other homes unaffected. Key + key_id stored on hub at `/etc/ziggy/b2_credentials` (mode 0600), provisioned during imaging.

The B2 per-home `key_id + app_key` pair is **also** wrapped with the founder master key and stored in the relay DB (column `wrapped_b2_credentials` on `home_backup_keys`, see §10). This is necessary because a DR restore on a new hub must recover both:
1. the `data_key` (to decrypt bundles), and
2. the B2 credentials (to download bundles in the first place).

Without (2) in the relay, a destroyed hub takes its B2 credentials with it — and the founder would have to mint a new app key in the Backblaze UI before every restore. By wrapping both at seal time, unseal returns both. The old B2 app key stays valid through the restore; rotation (issuing a fresh key, deleting the old one) is a separate operation deferred to v1.1.

### Object layout

```
b2://ziggy-backups-prod/
  {home_id}/
    daily/
      2026-05-26/
        manifest.json.enc        ← encrypted manifest (file list, hashes, sizes, coordinator_type)
        ha-config.tar.gz.enc
        zha-network-backup.json.enc
        ziggy-state.tar.gz.enc   ← user_files/ + config/
        recorder.db.enc          ← optional; absent if > 500 MB
      2026-05-25/...
      ...
    weekly/
      2026-W21/
        (same structure; promoted from daily on Sundays)
    latest -> daily/2026-05-26/  ← B2 server-side object copy; pointer, not symlink
```

### Manifest contents

```json
{
  "schema_version": 1,
  "home_id": "uuid",
  "device_id": "uuid",
  "created_at": "2026-05-26T02:14:33Z",
  "ziggy_version": "x.y.z",
  "ha_version": "2026.x",
  "coordinator_type": "smlight",
  "coordinator_ieee": "00:12:4b:00:...",
  "files": [
    {"name": "ha-config.tar.gz.enc", "size": 12345678, "sha256": "...", "nonce": "..."},
    {"name": "zha-network-backup.json.enc", "size": 4321, "sha256": "...", "nonce": "..."},
    ...
  ],
  "optional_skipped": ["recorder.db"],
  "hmac": "..."
}
```

`coordinator_type` is **first-class** — restore reads it before deciding which ZHA radio path to wire up. Cross-coordinator restore is allowed but flagged: if the manifest says `smlight` and the new hub has `sonoff_e`, the restore script prints a warning and requires `--allow-coordinator-switch`.

---

## 6. Backup Flow (Daily)

Triggered by `services/ziggy_scheduler.py` at 02:00 local time (configurable). Runs in-process on the edge agent.

```
1.  acquire backup lock (file lock at /var/run/ziggy-backup.lock)
2.  read kit manifest → coordinator_type, device_id, home_id
3.  trigger HA service zha.network_backup → wait for file in .storage/
4.  tar.gz ha-config/ (excluding cache + recorder if > 500 MB)
5.  tar.gz user_files/ + config/
6.  generate per-file nonces, encrypt each bundle (AES-256-GCM)
7.  build manifest, HMAC, encrypt
8.  upload all files to b2://.../{home_id}/daily/{YYYY-MM-DD}/
9.  server-side copy → b2://.../{home_id}/latest/
10. update relay: POST /admin/homes/{home_id}/backup-status
       { last_backup_at, bytes, ha_version, ziggy_version }
11. release lock
12. on any failure → log, emit metric, do NOT retry the same day
       (next day's run will pick up; we don't want noisy retries)
```

### Pre-flight checks before encryption

- Disk space at `/tmp` ≥ 2× estimated bundle size
- B2 reachability (HEAD on bucket)
- `data_key` readable
- **NTP sync.** Query `chronyd` (or `systemd-timesyncd` fallback) — abort if clock is not synced within **±60 s** of real time. A skewed clock would land the backup in the wrong daily directory and confuse B2 lifecycle rules into deleting fresh backups as if they were stale. Better to skip a run than to silently corrupt retention.
- ZHA network backup completed within last 5 min (if not, raise — don't ship an HA backup without a fresh coordinator backup; they must be a consistent pair)

### What does NOT happen during backup

- HA is **not** stopped. Files are read while live. Acceptable risk for config files (overwhelmingly idle) and recorder DB (snapshot via `sqlite3 .backup` to avoid mid-write tears).
- ZHA is **not** stopped — `zha.network_backup` is a live HA service.

---

## 7. Restore Flow (DR)

Triggered by founder running `scripts/factory/ziggy-restore-device.sh <old_device_id>` on a freshly imaged hub (after `ziggy-image-device.sh` has completed).

```
1.  parse args → old_device_id
2.  founder authenticates to relay (existing JWT)
3.  founder pastes master key from 1Password
4.  POST relay /admin/homes/{home_id-from-device_id}/unseal
       { master_key, reason: "DR restore for device X" }
       → relay audit_log row written;
         BOTH data_key AND b2_credentials returned (5-min TTL)
5.  derive home_id from device_id (relay lookup)
6.  list b2://.../{home_id}/latest/ → fetch manifest.json.enc
7.  decrypt + verify HMAC manifest
8.  print summary to founder:
       - backup date, ziggy/HA version, coordinator_type
       - file list with sizes
       - "PROCEED? [y/N]"
9.  detect new hub coordinator_type from kit manifest
10. if mismatch and no --allow-coordinator-switch flag → abort
11. download + decrypt all files in parallel
12. systemctl stop ziggy ; docker compose stop homeassistant
13. wipe existing ha-config/, user_files/, config/ contents
       (founder confirms — these are post-imaging defaults, OK to overwrite)
14. extract ha-config.tar.gz → docker/ha-config/
15. extract ziggy-state.tar.gz → user_files/ + config/
16. place zha-network-backup.json.enc decrypted → ha-config/.storage/
17. (optional) restore recorder.db if present
18. write /etc/ziggy/data_key AND /etc/ziggy/b2_credentials
       with returned values (mode 0600 each)
       (old B2 app key remains valid; rotation deferred to v1.1)
19. docker compose start homeassistant
20. wait for HA up → poll /api/  (≤ 90 s)
21. ZHA will detect the network backup at startup → adopt network parameters
22. start ziggy → run verification suite
23. write restore record to relay /admin/homes/{home_id}/restore-events
24. print success summary
```

**Restore time budget:** download (5 min on 50 Mbps for 200 MB bundle) + decrypt (30 s) + extract (1 min) + HA cold start (5 min) + verify (5 min) + buffer = **under 20 min**, well inside the 30-min target. Mesh re-formation is asynchronous post-restore — sensors check in over the next hour as they wake.

---

## 8. Coordinator Handling (Dual Support)

Both SMLIGHT SLZB-06 and Sonoff ZBDongle-E run **EFR32MG21** silicon. ZHA's `zha.network_backup` produces an identical JSON schema for both (Zigpy network backup format). Restore semantics:

| Source coordinator | Target coordinator | Behavior |
|---|---|---|
| smlight | smlight | Default. Restore script auto-detects via mDNS or kit manifest's `coordinator_ip`, configures ZHA radio path `socket://<ip>:6638` |
| sonoff_e | sonoff_e | Restore script reads `/dev/serial/by-id/usb-ITead_*`, configures ZHA radio path accordingly |
| smlight | sonoff_e | Cross-restore. Requires `--allow-coordinator-switch`. Same network key applied to USB stick; sensors do not notice. Document as advanced. |
| sonoff_e | smlight | Same as above, reversed |

The restore script **never hardcodes** `/dev/ttyUSB0` or any specific path. Paths come from:
1. Kit manifest (factory-shipped YAML on the hub)
2. Falls back to HA config inspection if manifest absent

If neither is available → restore aborts with clear error. Better to halt than guess.

---

## 9. Retention & Lifecycle

Implemented via B2 lifecycle rules — **not** in our code. We rely on B2 to enforce.

### Rules

| Path pattern | Rule | TTL |
|---|---|---|
| `{home_id}/daily/*` | Keep 7 most recent versions | 7 days |
| `{home_id}/weekly/*` | Keep 4 most recent versions | 28 days |
| `{home_id}/latest/*` | Always overwritten by today's backup; no expiration | n/a |

### Weekly promotion

Every Sunday after a successful daily backup, the engine does a B2 server-side copy from `daily/{today}/` to `weekly/{ISO-week}/`. No bandwidth cost, no re-encryption.

### What happens if a hub goes offline for > 7 days

- Last 7 daily backups age out; weeklies still cover up to 28 days.
- If offline > 28 days: last weekly is preserved by the lifecycle "keep 4 most recent" rule (oldest weekly is only deleted when a 5th is added; if no new weeklies are added, all stay).
- Indefinite offline → backups frozen at last successful run. Acceptable: hub is presumed dead at that point; DR restores whatever was last captured.

---

## 10. Relay-Side Schema Additions

New table in `relay/app/database.py`:

```python
class HomeBackupKey(Base):
    __tablename__ = "home_backup_keys"
    home_id: str (PK, FK → homes.id)
    wrapped_data_key: bytes         # AES-256-GCM ciphertext of the data_key
    wrap_nonce: bytes               # 96-bit nonce used to wrap data_key
    wrapped_b2_credentials: bytes   # AES-256-GCM ciphertext of {b2_key_id, b2_app_key} JSON
    b2_creds_nonce: bytes           # 96-bit nonce used to wrap B2 creds
    key_version: int                # for future rotation; v1 always = 1
    created_at: datetime
    last_unsealed_at: datetime (nullable)
    last_unsealed_by: str (nullable, FK → users.email)
```

Both wrap operations use the same master key but independent random nonces — required for AES-GCM safety even when the same key encrypts multiple plaintexts.

New audit_log event types (existing audit_log table from S2):

| Event | When | Payload |
|---|---|---|
| `backup_key_sealed` | Factory imaging completes initial seal | `home_id, founder_email` |
| `backup_key_unsealed` | Restore-time unwrap | `home_id, founder_email, reason, ttl_seconds` |
| `backup_status_updated` | Hub reports successful daily backup | `home_id, bytes, ha_version` |
| `restore_completed` | New hub finishes DR | `home_id, old_device_id, new_device_id` |
| `restore_aborted` | Restore failed mid-flow | `home_id, reason, stage` |

### New relay endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/admin/homes/{home_id}/seal-key` | Founder JWT | Initial seal during imaging. Body: `{master_key_b64, wrapped_data_key_b64}`. Master key is **only** used for verification; never persisted. |
| `POST` | `/admin/homes/{home_id}/unseal` | Founder JWT + master key in body | Returns ephemeral `data_key` (5-min TTL). Required field: `reason` (free text, audited). |
| `POST` | `/admin/homes/{home_id}/backup-status` | Hub HMAC | Hub reports daily success |
| `GET` | `/admin/homes/{home_id}/backup-status` | Founder JWT | Read last backup timestamp, bytes |
| `POST` | `/admin/homes/{home_id}/restore-events` | Hub HMAC | Hub reports restore complete/failed |

Master key flows through the relay in memory only, during a single request handler. Never logged. Never written to disk. Memory-zeroing caveats and accepted-risk rationale documented in §4 ("Master key handling on the relay").

---

## 11. Unseal Operation (Founder-Gated)

### Founder steps

1. Founder receives "device X dead, customer needs restore" signal.
2. Founder images new hub with `ziggy-image-device.sh`. Done in ~15 min.
3. Founder runs `scripts/factory/ziggy-restore-device.sh <old_device_id>`.
4. Script prompts: "Paste master key (will not echo):". Founder retrieves from 1Password, pastes.
5. Script prompts: "Reason for unseal:". Founder types e.g. `customer ABC hub failure 2026-05-26`.
6. Restore proceeds.

### What is NOT possible

- Hub cannot self-unseal. Even compromised, it cannot decrypt other homes' backups (per-home B2 keys, per-home data keys).
- Relay cannot self-unseal. Master key never lives on relay.
- Anyone with relay DB read access sees `wrapped_data_key` (ciphertext), useless without master key.
- Anyone with B2 read access sees `*.enc` files, useless without master key + relay row.

Three independent breaches required to read a single home's data: B2 credential + relay DB + master key. Each requires a different attacker capability.

---

## 12. Failure Modes & Guardrails

| Failure | Detection | Behavior |
|---|---|---|
| B2 unreachable during daily run | Pre-flight HEAD fails | Skip run, log, emit metric, retry next day |
| Disk full on hub during bundle creation | `os.statvfs()` pre-check | Skip run, alert |
| ZHA network backup hangs | Timeout 90 s | Skip the HA+coordinator pair entirely (don't ship a half-backup); alert |
| Manifest HMAC mismatch on restore | Decrypt step | Abort restore; print which file failed; tell operator to try a previous daily |
| Coordinator mismatch on restore | Manifest field vs detected hardware | Abort unless `--allow-coordinator-switch` |
| Data key TTL expires mid-restore | 5-min window | Restore script catches, prompts founder to re-unseal |
| Master key typo on unseal | GCM tag verification fails | Relay returns 400 with no detail (don't leak whether wrap exists); founder retries |
| Two backups racing on same hub | File lock at `/var/run/ziggy-backup.lock` | Second run aborts cleanly |
| Two restores racing on same home_id | Relay-side lock on home_id | Second restore returns 409 |

### Alerting

For v1, "log + relay-side counter" is enough. Push notifications / paging come later when fleet > 5 hubs. Daily backup success/failure is visible in admin dashboard via existing relay endpoints (extends current health monitoring).

---

## 13. Commit-Sized Implementation Plan

Each chunk is small, independently testable, and revertable. Order matters — earlier chunks unblock later ones.

| # | Change | Files touched | Test gate |
|---|---|---|---|
| 1 | Add `cryptography`, `boto3` to `requirements.txt`. Add `backup:` section to `config/settings.example.yaml` (b2_endpoint, bucket, key_id_env, key_env, schedule). | `requirements.txt`, `config/settings.example.yaml` | `pip install -r requirements.txt` passes |
| 2 | New module `services/backup_keys.py` — pure functions: `generate_data_key()`, `wrap(master, data_key) -> bytes`, `unwrap(master, wrapped) -> bytes`, `derive_file_key(data_key, filename) -> bytes`, `encrypt_file(plaintext, file_key) -> (nonce, ciphertext, tag)`, `decrypt_file(...)`. Unit tests with known vectors. | `services/backup_keys.py`, `tests/services/test_backup_keys.py` | Unit tests green |
| 3 | New module `services/backup_storage.py` — boto3 wrapper for B2. Functions: `upload(bytes, key)`, `download(key) -> bytes`, `list_prefix(prefix)`, `copy(src, dst)`. Mockable for tests. | `services/backup_storage.py`, `tests/services/test_backup_storage.py` | Mocked tests green |
| 4 | New module `services/backup_engine.py` — orchestrator. Functions: `run_daily_backup()`, `_collect_ha_config()`, `_collect_ziggy_state()`, `_trigger_zha_backup()`, `_build_manifest()`, `_upload_all()`. Reads kit manifest for coordinator_type. **Impl flag:** explicit HA `.storage/` allowlist (config) vs denylist (cache directories) — don't rely on "excluding cache"; whitelist exactly what we want. **Impl flag:** manifest writer stamps `schema_version: 1`; reader aborts with clear message if `schema_version > KNOWN`. | `services/backup_engine.py`, `tests/services/test_backup_engine.py` | Local end-to-end test against a B2 dev bucket |
| 5 | Wire scheduler hook in `services/ziggy_scheduler.py` — daily at 02:00 local. Off by default behind feature flag `backup.enabled` in settings.yaml. **Impl flag:** stale-lock cleanup — on lock acquisition, read PID from lockfile; if process is dead, clear lock and proceed. Avoids stuck-forever state after a crashed prior run. | `services/ziggy_scheduler.py` | Manually trigger; verify file appears in B2 |
| 6 | Relay schema migration — add `home_backup_keys` table (incl. `wrapped_b2_credentials`, `b2_creds_nonce`). New audit event types. | `relay/app/database.py`, migration file | Relay test suite green |
| 7 | Relay endpoints — `seal-key`, `unseal`, `backup-status` (POST/GET), `restore-events`. Unseal response returns both `data_key` and `b2_credentials`. | `relay/app/routes/admin.py` (or matching existing path) | Integration tests with mock founder JWT |
| 8 | **NEW.** Relay DB backup pipeline. Nightly `sqlite3 /data/relay.db .backup /tmp/relay.db.snapshot` → encrypt with founder master key (NOT per-home keys — per-home keys ARE the data being protected) → upload to **separate** bucket `b2://ziggy-relay-backups`. Lifecycle: **14 daily + 8 weekly** (heavier retention than per-home because catastrophic loss is unrecoverable). Restore is a documented manual procedure: founder supplies master key + downloads from B2 + decrypts to `/data/relay.db`. | `relay/app/services/db_backup.py`, `relay/app/scheduler.py` (or equivalent), Fly machine cron / sidecar | Manual trigger; verify encrypted snapshot in `ziggy-relay-backups`; full decrypt + restore-to-new-Fly-volume dry run |
| 9 | `scripts/factory/ziggy-restore-device.sh` — full restore flow. Calls relay for unseal, B2 for download, drives docker compose. **Impl flag:** verify manifest `schema_version` matches KNOWN before any extraction; abort otherwise. | `scripts/factory/ziggy-restore-device.sh` | Dry-run mode (`--dry-run`) validates flow without touching containers |
| 10 | **REVISED.** Write `docs/SEAL_KEY_SNIPPET_FOR_FACTORY_IMAGING.md` — exact CLI calls + code snippet the future factory imaging script (per PROMPT_FACTORY_IMAGING.md, a Claude Code prompt for a future session, not an existing file) must include for sealing during imaging. Covers: generate `data_key`, generate B2 app key for this home, wrap both with master key, POST `/admin/homes/{home_id}/seal-key`, persist runtime copies to `/etc/ziggy/`. **We do not touch any file outside the repo.** Founder integrates this snippet into the PROMPT_FACTORY_IMAGING.md spec separately. | `docs/SEAL_KEY_SNIPPET_FOR_FACTORY_IMAGING.md` | Founder reviews, confirms snippet can be pasted into the imaging prompt verbatim |
| 11 | `RUNBOOK_DR.md` — operator runbook. Step-by-step for the founder: "device dead → restore in 30 min." Also covers manual relay DB restore from Chunk #8. | `RUNBOOK_DR.md` | Walkthrough with founder |
| 12 | Acceptance test — full backup-and-restore cycle on a non-prod Beelink (per §14). Documented sign-off in §16. | (test artifact only) | Founder signs off |

**Stops between chunks:** After each chunk, I pause for your test. We don't move to the next chunk until the previous one is green.

---

## 14. Acceptance Test Plan (non-prod hub)

To be executed before declaring v1 done.

| # | Step | Expected |
|---|---|---|
| 1 | Image non-prod hub with imaging script | Hub up, ZHA online, sensor paired |
| 2 | Verify initial seal in relay DB | `home_backup_keys` row exists, wrapped_data_key non-null |
| 3 | Trigger backup manually | Files appear in `b2://ziggy-backups-prod/{home_id}/daily/{today}/` |
| 4 | Verify manifest HMAC | Decrypt + verify locally with master key |
| 5 | Wait 24 h, verify scheduled run | Second daily appears; `latest/` updated |
| 6 | Verify Sunday weekly promotion | `weekly/{ISO-week}/` appears after Sunday run |
| 7 | Wipe hub (`docker compose down -v`) | Hub is now blank |
| 8 | Re-image with imaging script | Hub up, fresh state |
| 9 | Run `ziggy-restore-device.sh <device_id>` | Unseal succeeds, restore completes in < 30 min |
| 10 | Verify ZHA mesh re-forms | Original sensor reports state within 1 h without re-pairing |
| 11 | Verify Ziggy state restored | Automations, IR devices, auth — all match pre-wipe |
| 12 | Verify audit log entries | `backup_key_sealed`, `backup_key_unsealed`, `restore_completed` all present |
| 13 | Negative test: typo master key on unseal | Relay returns 400; audit log records attempt; restore aborts cleanly |
| 14 | Negative test: cross-coordinator restore without flag | Restore script aborts with clear message |
| 15 | Negative test: cross-coordinator restore WITH flag | Restore completes; sensors re-join |
| 16 | Verify relay DB backup ran | Encrypted snapshot appears in `b2://ziggy-relay-backups/{date}/` per Chunk #8 schedule |
| 17 | **Simulated relay DB loss + restore.** On a staging Fly app, delete `/data/relay.db`. Stop relay process. Download latest snapshot from `b2://ziggy-relay-backups`. Decrypt with founder master key. Place at `/data/relay.db`. Restart relay. | Relay comes up healthy; previously-sealed homes still unseal cleanly; audit_log entries from before the simulated loss are intact |
| 18 | Negative test: relay DB restore with wrong master key | Decryption fails with GCM tag error; clear message; no partial write to `/data/relay.db` |

---

## 15. Open Items / Future Work

Not blocking v1. Captured here so we don't lose them.

| Item | Notes |
|---|---|
| Per-home key rotation | v1 is single-key-per-home forever. Rotation needs a re-encrypt-and-rewrap flow (including issuing a fresh B2 app key and revoking the old). Add in v1.1 if we suspect master key compromise. |
| B2 app key rotation on restore | Restore reuses the old B2 app key (still valid). Rotating to a fresh key post-restore is a v1.1 operation. |
| Restore-from-paper | If 1Password is unavailable AND paper backup is the only copy of master key, document a manual decrypt procedure using OpenSSL on a clean machine. RUNBOOK_DR.md will cover. |
| Customer-initiated restore | Currently founder-gated. Eventually customers should be able to trigger restore via app → notifies founder → founder approves with single tap. |
| Backup-time fleet dashboard | Admin dashboard panel showing per-home last_backup_at, byte count, success/failure trend. |
| Encrypted backup transport | We use B2 HTTPS, which is fine. But for paranoid mode, we could pre-encrypt + use rclone with no SSE-B2. Defer. |
| Cross-region replication | B2 has it; ~$1/TB/month extra. Add when we exceed 100 hubs. |
| Cost dashboard | Per-home B2 storage + bandwidth. Maps to billing tiers later. |
| Master-key memory zeroing | Per §4: full mitigation requires C-extension `explicit_bzero()` or external KMS. Accepted risk for v1, defer to v1.1. |

### B2 cost projection

Sanity-check the storage choice against fleet growth.

| Fleet size | Per-hub size | Total stored | B2 storage cost | Free egress quota | Restores covered free |
|---|---|---|---|---|---|
| 1 hub | 100 MB | 100 MB | $0.0006/mo | 300 MB/mo | ~3 full restores |
| 10 hubs | 100 MB | 1 GB | $0.006/mo | 3 GB/mo | ~30 restores |
| 100 hubs | 100 MB | 10 GB | **~$0.06/mo** | **30 GB/mo** | **~300 restores** |
| 1,000 hubs | 100 MB | 100 GB | ~$0.60/mo | 300 GB/mo | ~3,000 restores |

Backblaze: $6/TB/month storage, free egress up to 3× monthly stored bytes. At any plausible scale we hit through year 2, **storage cost is rounding-error and DR egress is fully free**. Confirms B2 as correct choice; no need to revisit until fleet > 10,000 hubs.

(Relay DB backups in the separate `ziggy-relay-backups` bucket are tiny — single SQLite file per night × 14 daily + 8 weekly retention × ~10 MB/snapshot ≈ 220 MB total, well under a cent per month.)

---

## 16. Sign-Off

| Role | Name | Signature | Date |
|---|---|---|---|
| Designer | Claude | — | 2026-05-26 |
| Revisions applied | Claude | — | 2026-05-27 |
| Founder approval (design, with 6 revisions) | Founder | ✓ | 2026-05-27 |
| Founder approval (acceptance test) | — | — | — |

**Design approved. Implementation proceeding in commit-sized chunks per §13. Each chunk pauses for founder test gate before the next begins.**
