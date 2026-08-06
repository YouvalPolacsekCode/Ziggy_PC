# Matter + Thread support — design

**Date:** 2026-07-30 · **Status:** implemented + live on canary (awaiting live device pair)

## Goal

Let Ziggy commission and control **Matter** devices — Matter-over-Thread (IKEA
Matter bulbs first) and Matter-over-Wi-Fi — through Ziggy's own pairing surface,
on the plain **HA-Container** stack (no HAOS Supervisor, so no Matter/OTBR
add-ons). Built as a **fleet capability** (idempotent enable script + compose
profile), stood up and validated on the canary first.

## Approach (chosen: A — dedicated Thread dongle + two containers)

The customer's kit already has two SLZB-07 dongles. Keep one as the Zigbee
coordinator; flash the **second** to OpenThread-RCP and use it as the Thread
radio. Add two standalone containers behind a `matter` compose profile:
`openthread/otbr` (Thread Border Router) and `python-matter-server` (Matter
controller). Wire HA's `matter` + `otbr` integrations; the `thread` integration
auto-holds the preferred dataset. One dongle + one matter-server covers **both**
Thread and Wi-Fi Matter (Wi-Fi devices skip the dongle; both pair over host BLE).

Rejected: **B** (Wi-Fi-only matter-server, no Thread) — fails the IKEA-Thread
requirement. **C** (multi-PAN, one dongle does Zigbee+Thread) — SiLabs/HA
deprecated multi-PAN as unstable, and we physically have two dongles.

## Components

- **`docker-compose.matter.yml`** (profile `matter`): `ziggy-otbr` (host net,
  `NET_ADMIN`+`NET_RAW`, `/dev/net/tun` + ot-rcp dongle→`/dev/ttyRCP`,
  `FIREWALL=0`, `--backbone-interface <NIC>`, `tmpfs /run`, state at
  `docker/otbr-data`→`/var/lib/thread`) and `ziggy-matter-server` (host net,
  BlueZ via `/run/dbus`, `--bluetooth-adapter 0`, fabric at `docker/matter-data`).
- **`scripts/factory/ziggy-matter-enable.sh`**: idempotent enable — flash dongle
  (if not already spinel), host prep (IPv6 fwd, BlueZ, dirs), `.env`, bring up
  the profile, ensure an HA-owned Thread network, wire HA integrations, verify.
- **`services/ha_pairing.py::commission_matter`**: patched from the non-existent
  `matter.commission_with_code` *service* to the HA WS command `matter/commission`
  (150 s timeout — BLE + Thread-join is slow). HA auto-brokers the preferred
  Thread dataset / Wi-Fi creds to matter-server. Frontend PairingWizard Matter
  tab + `/api/ha/matter/commission` route unchanged.
- **`services/backup_engine.py`**: new `matter-thread.tar.gz` bundle
  (`docker/matter-data` + `docker/otbr-data`), skipped cleanly on non-Matter
  hubs; read-only mounts added to `ziggy` in `docker-compose.prod.yml`.

## Data flow (commission)

Ziggy UI → `POST /api/ha/matter/commission {code}` → `commission_matter` →
HA WS `matter/commission` → matter-server: BLE handshake → push preferred Thread
dataset (or Wi-Fi creds) → device joins Thread(OTBR)/Wi-Fi → HA `matter` entities
appear → Ziggy registry refresh.

## Non-obvious constraints (see docs/MATTER_THREAD.md for the full table)

`tmpfs /run` (restart robustness), `FIREWALL=0` (ipset kernel mismatch on 24.04),
explicit `--backbone-interface` (INFRA_IF_NAME env doesn't set it), persist
`/var/lib/thread` (not `/data`), HA preferred dataset must stay TLV-synced to the
OTBR, host BlueZ required.

## Definition of done

Stack green on canary (OTBR `leader`, matter-server ws:5580, HA
matter/thread/otbr `loaded`, preferred dataset TLV-matched, DR-restart verified);
Ziggy pairing path patched + deployed; nightly backup includes the matter-thread
bundle. Final gate: a real IKEA Matter bulb paired + controllable from Ziggy
(user hardware test).

## Deferred

Async/polled commissioning (today the request blocks up to 150 s); exposing
Thread/Matter health in `ha_health`; fleet rollout to other hubs (enable script
is ready; run per hub as customers add Matter devices).
