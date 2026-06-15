# ZHA → Zigbee2MQTT Cut-over Runbook

**Purpose:** One-time, planned migration of the canary (founder's house) from
ZHA to Zigbee2MQTT. ~3–4 hours, single evening, hands-on at every Zigbee
device in the home.

**Audience:** Founder (you), at the canary, with the mini PC and the
Zigbee coordinator on the LAN.

**Last updated:** 2026-06-15.

**Related:** [DESIGN_BACKUP_DR.md](../DESIGN_BACKUP_DR.md),
[scripts/migrate_zha_to_z2m.py](../scripts/migrate_zha_to_z2m.py),
[docker/z2m-data.example/configuration.yaml](../docker/z2m-data.example/configuration.yaml).

---

## Why this runbook exists

Tuya devices (Aliexpress / Israeli market) use the proprietary 0xEF00
Zigbee cluster. ZHA's coverage of that cluster (via zha-device-handlers
quirks) is incomplete and slow-moving; Zigbee2MQTT (via Koenkk's
[zigbee-herdsman-converters](https://github.com/Koenkk/zigbee-herdsman-converters))
has 3000+ devices supported plus a generic Tuya converter for unknown
models. ~28% of the canary's existing Zigbee install base is already
Tuya, and the share is growing. This migration is the call.

This is a one-way door for paired devices: there is no in-place
migration of pairings between ZHA and Z2M. Every device gets factory
reset and re-paired. Plan accordingly.

---

## What's at risk

**Re-paired devices change entity_ids in HA.** Anywhere Ziggy or HA
stores a Zigbee entity_id (automations, dashboards, Ziggy's
device_registry.json, settings.yaml sensor_alerts, IR hybrid links)
will be stale until remapped. The [migration script](../scripts/migrate_zha_to_z2m.py)
remaps Ziggy's stores; HA automations are remapped via the same script
over HA's REST API.

**1-week rollback window.** Keep the ZHA integration installed-but-disabled
in HA for one week after cut-over. Reverting means re-enabling ZHA
(devices stay paired in ZHA's network because we don't depair them
from ZHA's side — we just stop ZHA and bring up Z2M alongside, taking
control of the coordinator). Past the 1-week mark, remove ZHA.

---

## Preflight (do BEFORE cut-over evening)

### 1. Confirm the canary's posture

- [ ] On the mini PC, `docker compose ps` shows `homeassistant`,
      `mosquitto`, `ziggy` all healthy.
- [ ] HA's MQTT integration is connected (HA → Settings → Integrations
      → MQTT shows "Connected").
- [ ] SLZB-06 coordinator IP is reachable from the mini PC:
      `nc -zv <coordinator_ip> 6638` returns "succeeded".
- [ ] Latest nightly backup landed in B2:
      `curl -H "Authorization: Bearer $JWT" "$RELAY_URL/api/homes/$HOME_ID/backup-status"`
      shows `last_backup_at` within 24h.

### 2. Snapshot the ZHA state

A fresh backup is your rollback safety net.

```bash
# Trigger an out-of-cycle backup so latest/ has the freshest ZHA state.
docker compose exec ziggy python -m services.backup_engine --once
```

Verify the run completed and uploaded `zha-network-backup.json.enc`.

### 3. Stand up the Z2M data dir

The template is already correct for the canary's hardware (Sonoff USB
stick, channel 20). No edits needed unless your hub has different
hardware. Z2M generates a fresh network key on first start — we don't
preserve the ZHA key because every device is being factory-reset in
step 5 anyway, so continuity buys nothing.

```bash
cp -r docker/z2m-data.example docker/z2m-data
# Sanity check: docker/z2m-data/configuration.yaml says
#   serial.port: /dev/ttyACM0
#   advanced.channel: 20
```

### 4. Prime the empty mapping.yaml

Create `~/cutover-mapping.yaml`. You'll fill the `entities:` list as
you walk the house. Example skeleton:

```yaml
entities:
  # - old: binary_sensor.lumi_lumi_sensor_motion_aq2_occupancy
  #   new: binary_sensor.kitchen_motion
```

---

## Cut-over evening

### Step 1 — Disable ZHA in HA (frees the coordinator)

HA UI → Settings → Devices & Services → ZHA → ⋮ → "Disable". Do NOT
delete the integration — disabling preserves the config for rollback.

When ZHA is disabled it releases the TCP socket on the SLZB-06; Z2M can
then claim it.

### Step 2 — Start Z2M

```bash
COMPOSE_PROFILES=zigbee-z2m docker compose up -d zigbee2mqtt
docker compose logs -f zigbee2mqtt
```

Wait for the log line `[INFO] zigbee2mqtt: Coordinator firmware version: ...`.
That confirms Z2M owns the radio. If it hangs at "Starting zigbee-herdsman",
the SLZB-06 is still claimed by ZHA — go back and double-check ZHA is
disabled.

Open `http://<mini-pc-ip>:8099` — Z2M's web UI. You'll use this to
permit-join devices during the walk.

### Step 3 — Walk the house, re-pair every device

Pick a room. For each device in that room:

1. **Factory reset the device.** Method varies:
   - Aqara button-press sensors: hold the small button ~5 s until LED flashes.
   - Tuya bulbs (TS0505B, Zbeacon, `_TZ3210_*`): power cycle 5× quickly
     (off-on-off-on-off-on-off-on-off-on); bulb flashes when reset.
   - SONOFF SNZB-04PR2: hold the pairing button on the back ~5 s.
   - eWeLink SNZB-02P: hold the button on the back ~5 s.
   - HOBEIAN mmWave: small reset button on the device housing, ~5 s.
2. **Open permit-join in Z2M.** In the web UI: top right "Permit join"
   → 254 seconds.
3. **Wait for the device** to appear in the Z2M devices list. Note its
   new `friendly_name` (defaults to a Z2M-generated ID like
   `0x00158d0001234567`). Click → rename to something stable (e.g.
   `kitchen_motion`).
4. **Look up the old ZHA entity_id** for this device. HA → Settings →
   Devices → search for the device's room/type — copy the old entity_id
   from the Disabled-ZHA integration (entities stick around in the
   registry even when their integration is disabled).
5. **Add to mapping.yaml:**
   ```yaml
   entities:
     - old: binary_sensor.lumi_lumi_sensor_motion_aq2_occupancy
       new: binary_sensor.kitchen_motion
   ```

Tip: do one room at a time. Don't try to factory-reset everything
upfront — devices that have been factory-reset but not yet re-paired
are dead weight.

### Step 4 — Special handling: the HOBEIAN trio (gamble path)

We confirmed during preflight that the three HOBEIAN devices
(CK-BL702-MWS-01(7016) ×2, ZG-303Z ×1) are Tuya-OEM with cluster
0xEF00 but their exact model strings aren't in Z2M's converter index.
Expected outcomes when you re-pair them:

| What Z2M does | What you do |
|---|---|
| Recognises and exposes full entities (presence, lux, temp) | Treat as any other device |
| Recognises generically — entities show but with raw DP names | Add an `external_converter` .js (template TBD; see Z2M docs on "external converters") to map DPs to friendly entities |
| Doesn't recognise at all | Pair anyway, leave on ZHA temporarily by re-enabling ZHA after the migration completes for these 3 devices only — accepted compromise per the preflight gamble |

### Step 5 — Run the migration script

After every device is re-paired and mapping.yaml is complete:

```bash
# Dry run first — print what WILL change without writing.
docker compose exec ziggy python -m scripts.migrate_zha_to_z2m \
  --mapping /app/user_files/cutover-mapping.yaml \
  --ha-url "$HA_URL" \
  --ha-token "$HA_TOKEN" \
  --dry-run
```

Read the dry-run summary. Confirm:
- `device_registry.remapped` ≈ the number of Zigbee devices in mapping.yaml
- `settings_yaml.remapped` matches the number of sensor_alerts /
  global_sensors entries that point at Zigbee entities
- `ir_devices.remapped` matches the number of hybrid IR devices (likely 0)
- `ha_automations.automations_touched` ≈ the number of automations that
  reference Zigbee entities
- No `error:` lines

If the dry-run looks right, re-run without `--dry-run`:

```bash
docker compose exec ziggy python -m scripts.migrate_zha_to_z2m \
  --mapping /app/user_files/cutover-mapping.yaml \
  --ha-url "$HA_URL" \
  --ha-token "$HA_TOKEN"
```

### Step 6 — Restart Ziggy + verify

```bash
docker compose restart ziggy
```

In the Ziggy UI:
- [ ] Devices page lists all re-paired devices with the right rooms.
- [ ] Toggle a known-good light → it responds.
- [ ] Trigger a motion sensor → state change shows in the activity log.
- [ ] Sensor alerts (if configured) fire on the new entity_ids.

In Home Assistant:
- [ ] Settings → Automations → spot-check 3 automations open without an
      "Entity not found" warning.

### Step 7 — Trigger a fresh backup

```bash
docker compose exec ziggy python -m services.backup_engine --once
```

Verify the manifest's `zigbee_stack` is now `z2m` and the bundle
contains `z2m-data.tar.gz.enc` (not `zha-network-backup.json.enc`).

---

## Rollback window (1 week)

For the next 7 days, ZHA stays installed-but-disabled in HA. If
something is fundamentally broken on the new stack:

1. Stop Z2M: `docker compose stop zigbee2mqtt`
2. Re-enable ZHA in HA UI → Settings → Devices & Services → ZHA → ⋮ → "Enable"
3. Devices that were re-paired with Z2M are now in Z2M's network only —
   they need to be factory-reset and re-paired to ZHA. (This is why
   we say "1-week window," not "indefinite": rollback cost grows the
   longer you wait.)

After 1 week without rollback, remove ZHA:

1. HA UI → ZHA → Delete integration.
2. Delete the now-stale `core.zigbee_network_backup_*.json` from
   `/config/.storage/` (Ziggy's backup engine will stop trying to
   collect it once `_detect_zigbee_stack` returns `z2m`, but the file
   is no longer protected by the allowlist either way).

---

## Verification checklist (24h post-cutover)

- [ ] First nightly backup lands and `manifest.json.enc → zigbee_stack` is `z2m`.
- [ ] No `Entity not found` errors in HA logs.
- [ ] Anomaly engine starts producing scores again (takes ~24h to
      re-learn baseline timings on the new entity_ids — expected).
- [ ] Pattern detector has re-populated `user_files/events.jsonl`
      with new entity_ids.
- [ ] HOBEIAN devices either: report sensible presence/temp/humidity,
      OR are documented as known-degraded in the cut-over notes.
