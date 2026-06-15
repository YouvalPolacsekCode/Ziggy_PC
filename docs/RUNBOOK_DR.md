# Disaster Recovery Runbook

**Purpose:** Operator-facing procedure for the founder when a customer's hub dies. Restore from B2 backups onto a freshly imaged replacement, in under 30 minutes excluding sensor mesh re-formation.

**Audience:** Founder (you). Not customer-facing.
**Last updated:** 2026-05-27.
**Related:** [DESIGN_BACKUP_DR.md](../DESIGN_BACKUP_DR.md), [SEAL_KEY_SNIPPET_FOR_FACTORY_IMAGING.md](SEAL_KEY_SNIPPET_FOR_FACTORY_IMAGING.md), [scripts/factory/ziggy-restore-device.sh](../scripts/factory/ziggy-restore-device.sh).

---

## When to run this runbook

Trigger on **any** of:

- Customer reports their hub is bricked, won't boot, or is otherwise unrecoverable.
- Customer reports the hub is "missing" or stolen and a replacement has been ordered.
- During a hardware-fault investigation you determine the disk has lost data integrity.

Do **not** run this for:

- Transient connectivity issues (Cloudflare tunnel down, ISP outage) — those don't need DR.
- "Ziggy is acting weird" — restart the agent first; only DR if state is provably corrupt.
- HA configuration mistakes the customer wants reverted — use HA's own automation history, not a full restore. A daily restore loses the customer's work since the last backup.

---

## Restore-time budget (target: < 30 min)

| Step | Expected duration |
|---|---|
| 1. Pick up replacement Beelink from kit shelf | 1 min |
| 2. Image with `ziggy-image-device.sh` (Docker, HA, Ziggy, tunnel) | ~15 min |
| 3. Run `ziggy-restore-device.sh <old_device_id>` | ~10 min (download + decrypt + extract + start) |
| 4. Verify HA + Ziggy + first sensor reports | 4 min |
| **Total** | **~30 min** |

Sensor mesh re-formation is **asynchronous** and not counted in the 30 min — the active Zigbee stack (ZHA or Z2M, as recorded in the manifest's `zigbee_stack` field) adopts the network parameters at startup, then each sensor checks in over the next ~1 hour as it wakes from its sleep cycle. The customer's home is "online" before the first sensor reports because Ziggy state + automations are restored at HA start. See [RUNBOOK_ZHA_TO_Z2M_CUTOVER.md](RUNBOOK_ZHA_TO_Z2M_CUTOVER.md) for the canary's stack-migration procedure (one-time).

---

## Prerequisites checklist

Run through this before stepping into the customer's home (or before couriering the replacement):

### Physical

- [ ] Replacement Beelink S12 Pro from the kit shelf, sealed.
- [ ] Matching Zigbee coordinator type per `kit_manifest.coordinator_type` of the dead hub. **If unknown, default to SMLIGHT SLZB-06**; the restore script will refuse cross-coordinator without explicit override (see §"Cross-coordinator restore" below).
- [ ] Power cable + Ethernet patch cable.
- [ ] Customer's wifi/network credentials (for cases where the hub goes wifi).

### Identity / secrets

- [ ] **Founder master key**, base64. Primary source: 1Password vault `Ziggy / founder-master-key`. Backup source: printed paper in the physical safe (see §"Paper-only master key recovery").
- [ ] **Founder JWT**, current. Obtain by `curl -X POST $RELAY_URL/api/auth/login -d '{"email":"...","password":"..."}'`. Valid 24h.
- [ ] **B2 read access** — the per-home B2 application key is returned by the relay's `/unseal` endpoint; you don't need to look it up separately.

### Connectivity

- [ ] Relay healthy: `curl -fsS $RELAY_URL/health` returns `{"ok": true}`.
- [ ] B2 reachable: `curl -fsS https://s3.eu-central-003.backblazeb2.com` returns a valid response (any 2xx/3xx/403 — just not a network timeout).
- [ ] Customer's network at the destination home is up.

### Inventory check on the dead device

- [ ] You have the dead hub's `device_id`. Sources, in order of preference:
  1. The QR sticker on the dead hub (printed at imaging time).
  2. The CloudAdmin dashboard → home detail page.
  3. The customer's invoice / kit packing slip.

If you cannot find the device_id and the customer can't either, **stop** — without the device_id you cannot find the right home's backups. Recovery is impossible until it's surfaced.

---

## Happy path — full restore

This is the procedure for the common case: customer hub is bricked, replacement is in hand, all secrets are accessible from 1Password, the new hub has the same Zigbee coordinator family as the old one.

### Step 1 — Image the replacement

Run the factory imaging script (see [SEAL_KEY_SNIPPET_FOR_FACTORY_IMAGING.md](SEAL_KEY_SNIPPET_FOR_FACTORY_IMAGING.md) for the seal-key portion). When prompted by the imaging script:

- Generate a **new** `device_id`/`home_id` UUID for normal first-provisioning. **Do not reuse the old one** — that hub is logically dead.
- Wait. The hub will reach kit-ready state with a successful first backup of its own (which is an empty Ziggy state — we're about to overwrite it).

### Step 2 — Run the restore script

From the new hub's repo checkout (the imaging script left a clone at `/opt/ziggy`):

```bash
cd /opt/ziggy
./scripts/factory/ziggy-restore-device.sh <OLD_DEVICE_ID>
```

The script will prompt for:

1. **Founder JWT** (paste).
2. **Master key** (paste from 1Password; never echoed).
3. **Reason for unseal** — type something specific. This goes into the relay's `audit_log`. Examples:
   - `customer ABC hub failure 2026-05-27 ticket #142`
   - `replacement after stolen hub report`
   - `disk corruption confirmed by smartctl`

After unseal, the script prints a summary like:

```
=========== backup summary ===========
  backup date:        2026-05-26T02:14:33Z
  ziggy version:      0.1.0
  HA version:         2026.5
  coordinator_type:   smlight
  coordinator_ieee:   00:12:4b:00:11:22:33:44
  zigbee_stack:       zha    # or "z2m" / "none"
  file count:         4
  optional_skipped:   ["recorder.db"]
======================================
PROCEED with restore? [y/N]:
```

**Read the summary.** Confirm:

- `backup date` is recent (within last 24h on a healthy hub).
- `coordinator_type` matches what you're holding.
- `zigbee_stack` matches what the replacement hub will run (must match the
  customer's existing stack to avoid a forced re-pair). Per-stack file
  expectations:
  - `zha` → bundle must include `zha-network-backup.json.enc`
  - `z2m` → bundle must include `z2m-data.tar.gz.enc`
  - `none` → no Zigbee bundle (IR-only / Switcher-only / Matter-only hub)
- `file count ≥ 2` always (ha-config, ziggy-state). Add one more for the
  zigbee bundle unless `zigbee_stack` is `none`.
- If `optional_skipped` lists `recorder.db`, that's normal for hubs whose history file grew past 500 MB — see §3 of the design doc.

Type `y` only after the summary looks right. Type `n` (or anything else) to abort — the script has not written anything yet.

### Step 3 — Wait for the script to finish

The script reports each step (1/24 through 24/24). At the end:

```
=============================================
  RESTORE COMPLETE
=============================================
  old device_id:  <UUID>
  home_id:        <UUID>
  backup date:    2026-05-26T02:14:33Z
  ziggy version:  0.1.0
  coordinator:    smlight

  Zigbee mesh re-formation is asynchronous (~1h). ...
```

### Step 4 — Verify in-home

Before leaving the customer:

- [ ] HA reachable in the customer's app (their existing PWA / mobile credentials still work).
- [ ] Ziggy reachable — touch any well-known automation, e.g. ask "what's the temperature in the living room" or trigger a previously-existing scene.
- [ ] At least one Zigbee sensor reports a fresh state within ~10 minutes. (Don't wait for all of them. Wait for one; that proves the active stack's network adoption worked — `zha.network_backup` adoption for ZHA, `coordinator_backup.json` adoption for Z2M.)
- [ ] Push notifications work — send a test from `interfaces/push_test.py`.
- [ ] First successful daily backup lands in B2 within 24h:
  ```bash
  curl -H "Authorization: Bearer $JWT" \
       "$RELAY_URL/api/homes/$HOME_ID/backup-status"
  ```

### Step 5 — Update CloudAdmin + customer

- Mark the old hub as decommissioned in CloudAdmin.
- Send the customer a short confirmation: hub replaced, all settings restored, sensors will re-pair automatically over the next hour.

### Step 6 — Clean up preserved dirs

The restore script preserved any pre-existing content from the new hub's first imaging run as `*.pre-restore-<timestamp>` directories. After you've confirmed the restore works (give it 24h to be safe), delete them:

```bash
rm -rf /opt/ziggy/*.pre-restore-*
```

---

## Edge cases

### Wrong master key (typo on paste)

**Symptom:** Restore script aborts at step 5 with `unseal failed (HTTP 400)`. Relay's audit_log shows a row with `event=backup_key_unsealed`, `ok=0`, `detail=wrong_master_key ...`.

**Cause:** Master key was mistyped, or you pasted the wrong 1Password entry, or you used a per-home wrap key instead of the master.

**Recovery:**
1. Re-open 1Password. Confirm you're on the `Ziggy / founder-master-key` entry, not anything else.
2. Re-run the restore script. It will re-prompt.
3. If three attempts in a row fail with the same key from 1Password, the 1Password entry itself is suspect — proceed to §"Paper-only master key recovery."

The relay treats wrong-master and no-sealed-key as the **same** 400 response (does not leak existence). So a 400 here does NOT necessarily mean the home was sealed wrong at imaging time — most often it's a paste typo.

### Cross-coordinator restore

**Symptom:** The original hub used SMLIGHT but the only spare on the shelf is Sonoff-E (or vice versa). The restore script aborts at step 10 with:

```
coordinator mismatch: backup is "smlight", new hub is "sonoff_e".
Pass --allow-coordinator-switch if you intend to cross-restore (advanced).
```

**Decision:** Both coordinator types run the same EFR32MG21 silicon and the ZHA network backup is portable. Cross-restore works but is flagged as "advanced" because:
- The sensors will retain their pairing but may experience a brief mesh re-formation hiccup.
- The radio path in HA configuration changes (`socket://` vs `/dev/serial/...`).

**Recovery:**
1. Confirm with the customer that you're swapping coordinator types. Document the swap in your support log.
2. Re-run with the flag:
   ```bash
   ./scripts/factory/ziggy-restore-device.sh <OLD_DEVICE_ID> --allow-coordinator-switch
   ```
3. Watch sensor reports for the next 30 min — most should reconnect cleanly.

### B2 unreachable

**Symptom:** Restore script fails at the manifest download step with a `boto3` ClientError or network timeout.

**Recovery (priority order):**
1. Check Backblaze status page. If B2 EU region has an outage, you wait. Sensor data and HA history are not at immediate risk — the dead hub's state is already encrypted in B2; you just can't download right now.
2. If B2 is up but the script can't reach it from the customer's network: check the customer's firewall. The hub needs outbound HTTPS to `s3.eu-central-003.backblazeb2.com` (port 443).
3. As a last resort: download the backup blobs to a laptop with working internet, copy them to a USB stick, then point the restore script at the local files. (Not currently supported via a flag — would require a one-off custom invocation. v1.1 work if it ever becomes common.)

### Manifest schema_version too new

**Symptom:** Restore script aborts at the schema-check step with:

```
manifest schema_version 2 > supported 1 — agent too old to interpret
this backup; upgrade Ziggy first.
```

**Cause:** The dead hub was running a newer Ziggy version that produced a manifest in a forward-incompatible format, and the replacement was imaged with an older Ziggy.

**Recovery:**
1. Update the replacement's Ziggy code (`git pull` in `/opt/ziggy` + restart) to match or exceed the version the dead hub was running.
2. Re-run the restore script. The schema check should pass.

This failure mode is **deliberate** — we'd rather halt than try to interpret a manifest we don't understand. See [DESIGN_BACKUP_DR.md §13 Chunk #4 impl flag](../DESIGN_BACKUP_DR.md).

### Customer's old hub had unfinished writes

**Symptom:** Restored state is missing the last few automation changes the customer made before the hub died.

**Cause:** Backups run nightly at 02:00 local. Anything the customer changed between the last 02:00 and the time the hub died is gone.

**Recovery:** Apologize. Explain the 24h backup window. Help the customer re-create the lost work — usually a small list of changed automations or new device pairings.

**Future mitigation:** none in v1 by design. Continuous / on-change backup is in the [v1.1 backlog](../DESIGN_BACKUP_DR.md) (§15 "Customer-initiated restore" and adjacent).

### Restore script gets interrupted mid-extraction

**Symptom:** Network drops, founder hits Ctrl-C, power fails on the new hub during steps 14–18.

**Recovery:**
1. The restore script preserves the pre-existing directories as `*.pre-restore-<timestamp>` (moved aside, not deleted). They're still on disk.
2. If you can't recover by re-running: manually undo. `rm -rf docker/ha-config user_files config && mv docker/ha-config.pre-restore-* docker/ha-config && mv user_files.pre-restore-* user_files && mv config.pre-restore-* config`. This puts the hub back into its fresh-imaged state.
3. Re-run the restore script from step 1. The unseal endpoint accepts repeat calls (each generates a new audit row).

---

## Paper-only master key recovery

**Trigger:** 1Password is unavailable (you've lost access to your phone + laptop simultaneously, account compromised, vendor outage) AND a customer hub is dead AND the printed paper backup in the physical safe is the only remaining copy of the master key.

This is a low-probability scenario but it's the ultimate fallback. If the paper is also destroyed, **per-home data is permanently undecryptable** — the customer loses everything except their HA configuration that they can manually re-enter.

### Steps

1. **Physically retrieve the paper from the safe.** Both eyes-on it. Take a photo before doing anything else, in case the original is damaged in handling.

2. **Verify the paper's integrity.** Per the §"Paper backup format" recommendation below, the paper should have:
   - The base64-encoded master key (~44 chars).
   - A SHA-256 checksum of the master key (64 hex chars).
   - A timestamp of when it was generated.

   If only the base64 is present and no checksum, you can verify by attempting an unseal on a **known-good home**; if the response is 400, you have the wrong key.

3. **Re-key into a working machine.** Open a text terminal on a trusted device. Carefully type or scan the base64 string. Verify against the SHA-256:
   ```bash
   read -r -s -p "Paste master key (base64): " MK
   echo
   echo -n "$MK" | base64 -d | sha256sum
   # Compare the hex output to the SHA-256 line on the paper.
   ```

4. **If checksum matches:** proceed with the normal restore procedure (§"Happy path"), using `$MK` as the master key.

5. **If checksum doesn't match:** you have a transcription error. Look for confusable chars: `O` vs `0`, `l` vs `1` vs `I`, `+` vs ` `. Re-type and re-verify.

6. **As soon as the customer is recovered:** re-populate 1Password from the paper (or the in-memory `$MK`), then close the session and verify access from a second device. Do **not** leave the paper as the sole copy any longer than necessary — its threat surface (physical break-in) is different from 1Password's (credential theft), and you want both walls back up.

### Paper backup format (recommendation for the original key generation)

When the master key was first generated, the printed paper should have looked roughly like this:

```
ZIGGY FOUNDER MASTER KEY  —  DO NOT LOSE
Generated:  2026-04-01T12:00:00Z
Operator:   <founder name>

Key (base64, 32 bytes):
qK5/J8u3J9YkD3p+L2nQa7BvKx9HZWyA1mNc4xK8d4w=

SHA-256 of decoded key (verification):
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855

Storage:
  Primary copy: 1Password personal vault, "Ziggy / founder-master-key"
  Paper copy:   Physical safe at <location>
  Witnesses:    none — this key has no recoverable shamir split in v1.
```

If your original paper is missing the SHA-256 line — add one **now** by computing it from 1Password and printing a fresh paper to file alongside (or instead of) the old one. The verification step above is much faster than "try to unseal a home blindly and hope."

### What if the paper is also destroyed

You're out of options for the affected per-home data. The customer must accept the loss of automations + device pairings + IR codes + Ziggy memory. Their HA core (any config they kept in `configuration.yaml` and friends) is recoverable if the customer maintained their own export, but the relay-held wrapped keys are now permanently sealed.

**Mitigation work that should already be in place (audit on your next quiet day):**
- Two paper copies in two physically separate safes? At least geographic redundancy across founder + co-founder.
- Time-limited Shamir's Secret Sharing split (3-of-5 trustees)? Significant operational complexity for a single-founder phase but a real option once headcount grows.

Track both as items on your founder backlog. Not blocking v1.

---

## After-the-fact audit

After every restore, do a small audit:

1. **Relay audit_log review.** Filter `home_id=<HOME_ID>` for the last 24h. Confirm:
   - `backup_key_unsealed` row exists with your founder email + the reason you typed.
   - `restore_completed` row exists with `old_device_id` matching the one you typed.
   - No unexpected events (e.g., extra unseal attempts you didn't make).

2. **B2 inventory check.** Confirm the home's `latest/` prefix has the expected file count (4 if recorder DB was present, 3 if it was skipped).

3. **Audit-log retention.** Note the timestamp of the restore in your support log. If you ever need to investigate "why was that home's key unsealed on date X?", the audit row is the source of truth, but you also want a human-readable trail.

---

## Sign-off

| Role | Action | Date | Initials |
|---|---|---|---|
| Founder | Approved runbook v1 | 2026-05-27 | — |
| Founder | First successful prod restore | — | — |
| Founder | First paper-only recovery drill (annual) | — | — |

---

## References

- [DESIGN_BACKUP_DR.md](../DESIGN_BACKUP_DR.md) — full design, especially §6 (backup flow), §7 (restore flow), §11 (founder-gated unseal), §12 (failure modes)
- [SEAL_KEY_SNIPPET_FOR_FACTORY_IMAGING.md](SEAL_KEY_SNIPPET_FOR_FACTORY_IMAGING.md) — what the factory imaging script does that this runbook relies on
- [scripts/factory/ziggy-restore-device.sh](../scripts/factory/ziggy-restore-device.sh) — the script invoked in step 2
- [scripts/factory/restore_helper.py](../scripts/factory/restore_helper.py) — crypto / B2 / manifest helpers invoked by the script
- [relay/app/routers/backup_keys.py](../relay/app/routers/backup_keys.py) — server-side endpoints
- [relay/app/db_backup.py](../relay/app/db_backup.py) — relay DB backup pipeline (separate concern; see §"Relay DB loss" below if you ever need it)

### Relay DB loss

If `/data/relay.db` on the Fly machine is lost (volume failure, deletion), the procedure is **different** — it's not per-home DR, it's relay-level DR. See [relay/app/db_backup.py](../relay/app/db_backup.py) module docstring for the manual restore procedure: provision new Fly volume, set `RELAY_BACKUP_KEY` env var, download `latest/relay.db.enc` from `b2://ziggy-relay-backups/`, decrypt with `unwrap()`, place at `/data/relay.db`, restart relay.

That recovery uses the **dedicated `RELAY_BACKUP_KEY`** (also in 1Password, separate entry), not the per-home master key. See [DESIGN_BACKUP_DR.md §11 amendment](../DESIGN_BACKUP_DR.md).
