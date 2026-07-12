# Ziggy Beta Hub Image

Everything needed to turn a generic mini PC into a shippable Ziggy hub, starting
from a stock **Ubuntu Server 24.04 LTS** headless image.

There are two layers:

1. **Golden image prep** (this directory) — a reproducible base: Docker Engine,
   the ziggy user, the repo at a pinned release tag, and the systemd units
   (built by Stream 2). Produced either by booting the stock ISO with the
   `cloud-init/` seed, or by baking a golden image with `packer/`.
2. **Per-hub imaging** (`scripts/factory/ziggy-image-device.sh`) — run once per
   physical hub by the operator. Generates identity, provisions the home in the
   relay, seals key material, onboards Home Assistant headlessly, and runs the
   kit-ready gate. See `PROMPT_FACTORY_IMAGING.md`.

> The golden image contains **NO** per-home secrets, tokens, or keys. Those are
> generated per hub during step 2. The canary suite (`scripts/canary-validate.sh`)
> asserts the built Docker image carries no secrets.

## Bill of materials (per kit)

| Item | Spec / default | Notes |
|---|---|---|
| Mini PC | x86-64, 8 GB RAM, 128 GB+ SSD | Every kit ships local compute (memory: ziggy_kit_hardware). |
| OS | Ubuntu Server 24.04 LTS (amd64) | Headless, systemd, Docker Engine (NOT Docker Desktop). |
| Zigbee coordinator | SMLIGHT SLZB-07 (`smlight`) or Sonoff ZBDongle-E (`sonoff_e`) | `coordinator_type` in kit manifest. USB / LAN. |
| IR blaster | Broadlink RM4 | Tadiran/Gree AC (memory: user_hardware). Optional per kit. |
| Network | Ethernet preferred | Cloudflare Tunnel gives remote access; no port-forwarding. |

## Pinned versions

Pins live in `compose/versions.env` (single source of truth) and are echoed into
each hub's `/opt/ziggy/.env` at imaging. Defaults track what dev validated:

| Component | Var | Default |
|---|---|---|
| Home Assistant | `HA_VERSION` | `2026.6.1` |
| Mosquitto | `MOSQUITTO_VERSION` | `2.0.20` |
| Zigbee2MQTT | `Z2M_VERSION` | `2.1.1` |
| Ziggy app | `GIT_SHA` / release tag | set at build |

## Build / flash runbook

### Option A — stock ISO + cloud-init (simplest)

1. Write the Ubuntu Server 24.04 ISO to USB (e.g. `dd` or Raspberry Pi Imager /
   balenaEtcher for the USB stick).
2. Copy `cloud-init/user-data` and `cloud-init/meta-data` onto a second FAT32
   volume labeled `CIDATA` (NoCloud datasource), or serve via the installer's
   `autoinstall`.
3. Edit `user-data`: set the release tag (`ZIGGY_RELEASE_TAG`) and the ziggy
   user's SSH key. Do **not** put secrets here.
4. Boot the mini PC from USB. cloud-init installs Docker, clones the repo to
   `/opt/ziggy` at the pinned tag, creates `/etc/ziggy`, and runs
   `scripts/linux/install-systemd-units.sh --no-start` — the single source of
   truth for the unit names. That installs and enables `ziggy.service` (brings
   the compose stack up) plus the OTA/disk-guard/lifecycle units, so they start
   on the next boot *after* per-hub imaging has written `/opt/ziggy/.env`. The
   golden base holds no secrets, so nothing is started yet. First boot is
   unattended. (Backups are scheduled inside the Ziggy app, so there is no
   backup timer.)
5. SSH in as `ziggy`. Run the per-hub imaging (Option in `PROMPT_FACTORY_IMAGING.md`).

### Option B — Packer golden image (fleet scale)

```bash
cd image/packer
packer init ziggy.pkr.hcl
packer build \
  -var "release_tag=v1.0.0" \
  -var "ha_version=2026.6.1" \
  ziggy.pkr.hcl
```

Produces a golden `.img`/qcow2 with Docker + repo + units baked in. Flash it to
each mini PC's SSD with `dd`, then run per-hub imaging. Golden image is identical
across the fleet; identity is minted per hub.

### After flashing — per-hub imaging (both options)

```bash
ssh ziggy@<hub>
cd /opt/ziggy
sudo ./scripts/factory/ziggy-image-device.sh      # interactive: master key, relay login
# …then the ship gate:
sudo ./scripts/factory/kit-ready-check.sh
# …and the acceptance suite:
./scripts/canary-validate.sh
```

## Provenance

Each built image records `version.json` (schema in this dir): image version,
component pins, git SHA, build host, UTC timestamp, and SHA-256 checksums of the
artifact. Ship it alongside the image so a hub's exact composition is auditable.

## Licenses

`licenses/` holds third-party attribution. **Zigbee2MQTT is GPL-3.0** — its full
license text MUST be included when distributing an image that bundles the Z2M
container. See `licenses/README.md`.
