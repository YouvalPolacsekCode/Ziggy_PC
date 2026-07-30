# Matter + Thread on a Ziggy hub

How Ziggy commissions **Matter** devices — both **Matter-over-Thread** (IKEA
bulbs, Eve, Nanoleaf) and **Matter-over-Wi-Fi** — on our plain **HA-Container**
stack, where the HAOS "Matter Server" and "OpenThread Border Router" add-ons
don't exist and are replicated as standalone containers.

## Mental model

Matter is an application protocol, not a radio. It rides **Thread** or
**Wi-Fi/Ethernet**, and every device is first paired over a **BLE** handshake.
So the chain is:

```
Matter device ─BLE(pair)─┐
   └─Thread─> SLZB-07 (ot-rcp) ─> OTBR ─┐
   └─Wi-Fi ──────────────────────────┐  │
                                      ▼  ▼
                              python-matter-server ─ws:5580─> HA (matter)
                                      ▲
                        HA (thread) preferred dataset ── HA (otbr) ── OTBR REST:8081
```

- **The Thread dongle is a SECOND radio**, distinct from the Zigbee coordinator.
  One SLZB-07 cannot be both a Zigbee coordinator and a Thread RCP — Zigbee stays
  on its dongle, Thread gets its own, flashed to **ot-rcp** firmware.
- **matter-server** does all commissioning. Thread devices join via the OTBR;
  Wi-Fi devices join your LAN. Both need **host Bluetooth** for the BLE pairing
  step. One dongle + one matter-server therefore covers **both** transports.
- **HA is the Thread credential vault.** The `thread` integration holds the
  *preferred* operational dataset; at commission time HA hands it (or Wi-Fi
  creds) to matter-server, which pushes it to the device over BLE.

## Containers (docker-compose.matter.yml, profile `matter`)

| Container | Image | Role | Ports (host net) |
|---|---|---|---|
| `ziggy-otbr` | `openthread/otbr` | Thread Border Router, owns the mesh, fed by the ot-rcp dongle | REST `8081`, web `80` |
| `ziggy-matter-server` | `ghcr.io/home-assistant-libs/python-matter-server` | Matter controller (fabric + commissioning) | ws `5580` |

Both `network_mode: host` (Matter needs IPv6 + mDNS on the LAN). State:
`docker/otbr-data/` (Thread dataset, mounted at **`/var/lib/thread`** — that's
where otbr-agent persists, NOT `/data`) and `docker/matter-data/` (Matter fabric
+ device creds). Both are bind-mounted read-only into `ziggy` for the nightly
backup (matter-thread bundle).

## Enable it

One idempotent script does the whole thing (flash → host prep → stack → HA wiring
→ verify):

```bash
# on the hub, as ziggy (passwordless sudo), repo at /opt/ziggy, stack up:
git -C /opt/ziggy pull --ff-only   # get docker-compose.matter.yml + the script
./scripts/factory/ziggy-matter-enable.sh              # auto-picks the 2nd dongle
# or pin it:
MATTER_THREAD_DEVICE=/dev/serial/by-id/usb-SMLIGHT_..._<serial>-if00-port0 \
  ./scripts/factory/ziggy-matter-enable.sh
```

Then pair a device from Ziggy (or, engine-side, HA → Add device → Matter → enter
the 11-digit code / scan the `MT:` QR).

## The flash (what "make it a Matter dongle" means)

Flash the **second** SLZB-07 (EFR32MG21) from Zigbee EmberZNet → **ot-rcp**:

```bash
python3 -m venv ~/usf && ~/usf/bin/pip install universal-silabs-flasher
curl -fsSL -o ot-rcp.gbl \
 "https://github.com/darkxst/silabs-firmware-builder/raw/refs/heads/main/firmware_builds/slzb-07/ot-rcp-v2.4.5.0-slzb-07-460800.gbl"
# TARGET THE THREAD DONGLE BY-ID — never ttyUSBx, and never the Zigbee one:
sudo ~/usf/bin/universal-silabs-flasher --device /dev/serial/by-id/usb-SMLIGHT_..._<thread-serial>-if00-port0 flash --firmware ot-rcp.gbl
# verify:
sudo ~/usf/bin/universal-silabs-flasher --device <by-id> --probe-methods spinel:460800 probe   # -> Detected SPINEL
```

ot-rcp is **stateless** — the old Zigbee NVM3 network is orphaned/inert, so the
flash *is* the clean. No separate erase needed.

## Gotchas (hard-won on the canary)

| Symptom | Cause | Fix |
|---|---|---|
| OTBR container Up but `ot-ctl`/REST dead after a reboot/`docker restart` | image uses sysvinit; a stale pidfile/socket in `/run` persists → "already started; not starting" and otbr-agent never launches | `tmpfs: [/run]` on the otbr service (in the compose) — clears `/run` each start |
| OTBR dies at boot: "Failed to start firewall service" | image's `ipset` userspace (proto 6-6) vs Ubuntu 24.04 kernel (6-7) mismatch | `FIREWALL=0` env (we don't need Thread border firewalling for local control) |
| OTBR: "CreateIcmp6Socket … No such device" | agent's backbone iface defaults to nonexistent `eth0` | pass `--backbone-interface <real NIC>` (env `INFRA_IF_NAME` alone does NOT set it) |
| Thread network lost after container recreate | otbr-agent persists to `/var/lib/thread`, not `/data` | mount the state dir at `/var/lib/thread` |
| Ziggy Matter pair button fails "integration not available" | `matter` exposes **no** `commission_with_code` HA *service* | Ziggy calls the WS command `matter/commission` instead (`services/ha_pairing.py`) |
| Thread device commissions but never appears | HA's *preferred* dataset ≠ the OTBR's live dataset | make the live dataset preferred (`thread/set_preferred_dataset`); the enable script keeps them TLV-matched |
| matter-server can't do BLE | host has no `bluetoothd` | `apt install bluez` + `systemctl enable --now bluetooth`; mount `/run/dbus` into the container |

## Backup / DR

The nightly encrypted B2 backup includes a **`matter-thread.tar.gz`** bundle:
`docker/matter-data/` (the Matter fabric — **non-recoverable** if lost; every
device would need factory-reset + re-pair) and `docker/otbr-data/` (the Thread
dataset — restoring it keeps existing Thread devices joined). HA's `.storage`
(the preferred dataset + config entries) rides the existing ha-config bundle.
On a rebuild, restore all three and the fabric + Thread network return with no
re-commissioning.
