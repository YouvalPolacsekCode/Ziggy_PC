# Ziggy Kit — Zigbee & Pre-Pairing Model

How Zigbee state lives across the dongle and the mini PC, and how to build a
**pre-paired kit** (devices already connected out of the box). Written 2026-07-16
during the Canary rebuild. Plain-language for the operator; technical notes inline.

---

## Where the Zigbee network lives (dongle vs PC)

The state is split across two places — you need **both**:

| Piece | Holds | Analogy |
|---|---|---|
| **Dongle (Zigbee coordinator)** | The live network: **network key**, PAN ID, channel (in the dongle's NVRAM). Devices are paired to *this*. | The Zigbee network's **password + radio** |
| **Mini PC (Zigbee2MQTT data)** | The **device list** (which devices, IEEE addresses, friendly names, rooms) in `docker/z2m-data/database.db` + config, **plus a backup copy of the network key** (`coordinator_backup`). | The **address book** + a spare copy of the password |

- Devices join **the dongle's network** (keyed by network key + PAN).
- The PC's Z2M knows **which** devices exist and their names/config.
- Ziggy's daily backup captures the Z2M database **and** the coordinator backup — so the network key is recoverable even if hardware dies.

## Move / replace scenarios

- **Move dongle + PC together** → works (just a relocation).
- **PC dies, keep dongle** → restore the PC's backup onto a new PC + plug the **same dongle** → devices reconnect. (Standard DR — `scripts/factory/ziggy-restore-device.sh`.)
- **Dongle dies, keep PC** → load the coordinator backup (network key/PAN) onto a **new dongle of the same type** → devices reconnect, **no re-pairing**. (Why `coordinator_type` is in the kit manifest — the replacement must be the same adapter family: `smlight` or `sonoff_e`.)
- **Move ONLY the dongle to a fresh PC (empty Z2M)** → devices are still on the air, but the new PC doesn't *list* them until its Z2M database is restored. Dongle alone is **not** enough.

**Conclusion for kits:** ship **dongle + mini PC as a matched set**. The backup ties them so either can be swapped.

---

## Pre-paired kit model (premium "just works")

Ship a kit whose devices are already connected. Customer plugs in, does onboarding
(account + rooms), and their sensors/lights are already there.

### Factory sequence (per kit)
1. Assemble the kit: mini PC + **its** dongle + **its** devices.
2. Image the mini PC **with Zigbee ON** (`ENABLE_ZIGBEE=1` — see gaps below).
3. **Pair each device** (Z2M permit-join → device joins) — writes them into the PC's
   Z2M database; the real `COORDINATOR_IEEE` gets recorded in the kit manifest.
4. **Then** run the seal + kit-ready gate + first backup — this **captures** the
   paired Zigbee state (Z2M db + coordinator backup) into the ship image + B2.
5. Ship mini PC + dongle + devices **together**, labeled as one matched kit.

### Trade-offs
- ✅ Best out-of-box experience; onboarding becomes "account + name your rooms."
- ⚠️ **More bench labor per kit** (pair + image each kit as a unit).
- ⚠️ **Matched sets** — a kit's dongle, devices, and PC image are married; don't mix
  dongles between kits after pairing. Label and keep together.

### What onboarding becomes (either model)
Account creation + assign the (pre-paired or freshly-paired) devices to rooms +
opt into starter automations. Onboarding is the same; pre-pairing just means the
devices are already present to assign.

### "Add more devices later" must still work
Even a pre-paired kit's owner will buy a new sensor someday and pair it **in the
app** (Zigbee permit-join through Ziggy). So the in-app pairing path must be solid
regardless of pre-pairing.

---

## Requirements / open build items (before pre-paired kits ship)

1. **Zigbee-ON imaging path.** Tonight's Canary was imaged `ENABLE_ZIGBEE=0` with a
   placeholder coordinator IEEE. Pre-paired kits need `ENABLE_ZIGBEE=1`:
   detect the dongle (`/dev/serial/by-id/...` for USB `sonoff_e`, or tcp:// for the
   network `smlight` SLZB-07), bring up the `zigbee2mqtt` compose profile, seed
   `docker/z2m-data/configuration.yaml` (adapter `ezsp` for Sonoff-E), pair devices,
   then seal with the **real** `COORDINATOR_IEEE`. (`ziggy-image-device.sh` already
   has the ENABLE_ZIGBEE branch + the not-required-when-off IEEE guard; the pair +
   real-IEEE capture step is the piece to add.)
2. **Fix the HA↔MQTT config-entry step.** During imaging `ha-seed.sh` logged
   `MQTT flow did not create_entry ... cannot_connect` — HA's MQTT integration wasn't
   created (broker not ready / creds not passed). Zigbee2MQTT surfaces devices to HA
   **through MQTT**, so this must succeed for pre-paired OR in-app Zigbee to reach HA.
3. **SMLIGHT (network coordinator) support** in compose — the current prod overlay
   wires a USB device mount only; a network SLZB-07 needs a `tcp://ip:port` Z2M serial
   config, not a USB path.
4. **Matched-set labeling** in the manufacturing/packaging process.

## Decision recorded
**Next mini PC gets imaged Zigbee-ON.** The Canary (this box) stays Zigbee-off and is
used to validate the *customer-adds-Zigbee* path (plug dongle → enable → pair), which
every kit needs anyway for post-ship additions.

See DESIGN_BACKUP_DR.md (coordinator backup), docs/RUNBOOK_ZHA_TO_Z2M_CUTOVER.md,
scripts/factory/ziggy-image-device.sh, scripts/factory/ziggy-restore-device.sh.
