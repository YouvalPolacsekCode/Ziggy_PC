---
name: provisioning-ziggy-hubs
description: Use when working hands-on with a Ziggy mini-PC hub / "home" (a Canary or beta unit) — SSHing in, running the factory imaging script, turning Zigbee on (SLZB-07 or Sonoff dongle), wiring Home Assistant's MQTT integration, pairing devices, or debugging why Zigbee / MQTT / the app's pair button don't work. Covers the container+network model and the non-obvious gotchas.
---

# Provisioning & operating Ziggy hubs

## Overview

A Ziggy hub is a mini PC running **four Docker containers** via `docker compose` from `/opt/ziggy`:

| Container | Role | Network |
|---|---|---|
| `ziggy-ziggy-1` | Ziggy backend (FastAPI, port 8001) | **bridge** (`ziggy_default`) |
| `ziggy-homeassistant-1` | Home Assistant (engine, port 8123) | **host** (`network_mode: host`) |
| `ziggy-mosquitto-1` | MQTT broker (authenticated, port 1883, published to host) | **bridge** |
| `ziggy-zigbee2mqtt-1` | Zigbee2MQTT (only when Zigbee is on; `zigbee-z2m` profile) | **bridge** |

Ziggy is the only product surface; HA/MQTT/z2m are the engine (see the wider project instructions). Config layering: base `docker-compose.yml` + `docker-compose.prod.yml` (beta) + `/opt/ziggy/.env` (per-home secrets, root-owned 600). The full imaging entrypoint is `scripts/factory/ziggy-image-device.sh`.

**The single most important mental model** is the network split (below) — most "Zigbee/MQTT doesn't work" bugs are one container using the wrong hostname to reach the broker.

## The container ↔ broker network model (read this first)

Who reaches the MQTT broker how:

| From | Reaches broker at | Why |
|---|---|---|
| **Home Assistant** (host net) | `localhost:1883` | HA shares the host; mosquitto publishes 1883 to the host |
| **Ziggy backend** (bridge) | `mosquitto:1883` | bridge container; `localhost` = itself. **NOT localhost** |
| **Zigbee2MQTT** (bridge) | `mosquitto:1883` | same |

**Corollaries you will hit:**
- Ziggy's `.env` `MQTT_URL` must be `mqtt://<user>:<pass>@mosquitto:1883`. If it says `@localhost:1883`, Ziggy never connects to MQTT and the **app's Zigbee pair button silently does nothing** (Ziggy publishes permit-join over MQTT). Fixed in `step_env`; verify on any older/hand-set hub.
- z2m's `configuration.yaml` `mqtt.server` is `mqtt://mosquitto:1883` **and must include `user:`/`password:`** — the prod broker is `allow_anonymous false`, so a credential-less z2m can never connect (and its devices never reach HA).
- ha-seed adds HA's MQTT config entry with broker `localhost` (HA is host-net).

## Accessing a running hub

The Canary example is `ziggy@10.100.102.15`, repo `/opt/ziggy`, branch `feat/beta-image-readiness`. Adapt the IP.

1. **Key auth** (so a headless agent can drive it): put the operator Mac's `~/.ssh/id_ed25519.pub` into the hub's `~/.ssh/authorized_keys` (one line, `chmod 600`). Test: `ssh -o BatchMode=yes ziggy@<ip> 'echo OK'`.
2. **Docker without sudo:** the `ziggy` user is in the `docker` group → run `docker …` directly. Prefer this over sudo.
3. **Don't fight sudo over non-interactive SSH.** Read secrets from the **container env**, not the root-owned `.env`:
   - `docker exec ziggy-ziggy-1 printenv HA_TOKEN`
   - `docker exec ziggy-ziggy-1 printenv MQTT_URL` (parse user/pass; keeps the secret off your screen)
4. **When you genuinely need sudo** (edit `/opt/ziggy/.env`, `/etc/ziggy/*`, git, image rebuild), grant passwordless sudo once: `echo "ziggy ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/ziggy-nopasswd && sudo chmod 440 /etc/sudoers.d/ziggy-nopasswd` — the operator runs this one line (types password once). Revocable: `sudo rm /etc/sudoers.d/ziggy-nopasswd`. It's their box; confirm first.
5. **Git in `/opt/ziggy`** is root-owned → `sudo git …` and one-time `sudo git config --global --add safe.directory /opt/ziggy`. Pull with `sudo git pull --ff-only origin <branch>`. Recreating `ziggy` only reloads env; the **image is rebuilt only with `--build`** (that's what applies backend code changes — a ~2–4 min build + app blip).

**Anything that restarts the `ziggy`/HA container blips the customer's live app (~20–40s). Confirm before doing it on a production hub.**

## Imaging a NEW home (from a clean Ubuntu 24.04 mini PC)

Full click-by-click for a person is `docs/CANARY_REBUILD_RUNBOOK.md`. The engine is `scripts/factory/ziggy-image-device.sh` (numbered, resumable steps: preflight → identity → mqtt-creds → env → stack-up → ha-seed → zigbee-pair → seal → register-hub → ziggy-up → kit-ready → first-backup).

- **Secrets** come from env (never hardcode): `RELAY_ADMIN_EMAIL/PASSWORD`, `MASTER_KEY_B64`, `B2_KEY_ID/APP_KEY/ENDPOINT`. Keep them in `~/.ziggy/canary-secrets.txt` and `set -a; source …; set +a`.
- **Always `--dry-run` first** (writes to a sandbox, no relay/hardware). Then the real run. `--resume` continues after a failed step; `--from <step>` forces a start point (but note: `--from` re-runs steps ignoring state, and **ha-seed dies if HA is already onboarded** — don't re-run it on a live HA).
- **Zigbee off vs on:** `ENABLE_ZIGBEE=0` (default) images without a coordinator (placeholder IEEE; validates the customer-adds-Zigbee-later path). `ENABLE_ZIGBEE=1` seeds z2m, waits for it online, reads the **real** coordinator IEEE, optionally opens permit-join (`ZIGBEE_PAIR_SECONDS>0`) to pair kit devices, and folds them into the kit manifest (pre-paired kits).
- **USB vs network coordinator:** USB (Sonoff, or SLZB-07-over-USB) is the default. For a **network** SLZB-07, set `COORDINATOR_IP=<ip>` (→ z2m `tcp://ip:6638`, `adapter ezsp`) which pulls in `docker-compose.zigbee-net.yml` (drops the USB device mount).

## Turning Zigbee ON on an already-imaged hub (customer-adds-later)

This is the manual path (the imaging `zigbee-pair` step is for fresh images). Done on the Canary with an SLZB-07 over USB:

1. **Plug the dongle in, find it:** `ls -l /dev/serial/by-id/` + `dmesg | grep -iE "slzb|cp210|ttyUSB"`. SLZB-07 over USB = a **CP210x** serial → e.g. `/dev/ttyUSB0`, stable path `usb-SMLIGHT_SMLIGHT_SLZB-07_<serial>-if00-port0`.
2. **Seed the z2m config** at the LIVE path `docker/z2m-data/configuration.yaml` (NOT `docker/z2m-data.example/`, which is only a template). It MUST include `mqtt.user`/`password` (prod broker is auth) and `adapter: ezsp` (correct for SLZB-07's EFR32/EmberZNet and Sonoff-E). Read the creds from the container so the password stays off-screen. Exact content:
   ```bash
   MQTT_URL=$(docker exec ziggy-ziggy-1 printenv MQTT_URL)
   USER=$(echo "$MQTT_URL" | sed -E 's#mqtt://([^:]+):.*#\1#'); PASS=$(echo "$MQTT_URL" | sed -E 's#mqtt://[^:]+:([^@]+)@.*#\1#')
   BYID=/dev/ttyACM0   # compose maps the host by-id path → /dev/ttyACM0 in the container, so keep this literal
   sudo mkdir -p /opt/ziggy/docker/z2m-data/external_converters
   sudo tee /opt/ziggy/docker/z2m-data/configuration.yaml >/dev/null <<EOF
   homeassistant: true
   permit_join: false
   mqtt:
     base_topic: zigbee2mqtt
     server: 'mqtt://mosquitto:1883'
     user: '$USER'
     password: '$PASS'
   serial:
     port: /dev/ttyACM0
     adapter: ezsp
   frontend:
     port: 8099
   advanced:
     channel: 20
     log_level: info
   external_converters: []
   EOF
   sudo chmod 600 /opt/ziggy/docker/z2m-data/configuration.yaml
   ```
   **Adapter fallback:** if z2m fails to start with `ezsp`, check its log for the firmware version and swap `adapter: ezsp` ↔ `ember` (SLZB-07 firmware ≥7.4 wants `ember`; ≤7.3.x wants `ezsp`).
3. **Point the compose device at the dongle.** Note `serial.port` above stays `/dev/ttyACM0` — compose maps the host device there. Set the HOST path via `.env` (root-owned → `sudo`). A Zigbee-off image may not HAVE this line, so replace-or-append:
   ```bash
   BYID='/dev/serial/by-id/usb-SMLIGHT_SMLIGHT_SLZB-07_<serial>-if00-port0'   # from step 1
   if sudo grep -q '^ZIGBEE_COORDINATOR_DEVICE=' /opt/ziggy/.env; then
     sudo sed -i "s#^ZIGBEE_COORDINATOR_DEVICE=.*#ZIGBEE_COORDINATOR_DEVICE=$BYID#" /opt/ziggy/.env
   else
     echo "ZIGBEE_COORDINATOR_DEVICE=$BYID" | sudo tee -a /opt/ziggy/.env >/dev/null
   fi
   ```
4. **Bring up ONLY z2m** (leaves ziggy/HA/mosquitto running):
   `cd /opt/ziggy && sudo COMPOSE_PROFILES=zigbee-z2m docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file /opt/ziggy/.env up -d zigbee2mqtt`
5. **Check z2m logs** for: adapter/firmware line, "Connected to MQTT server", "Started frontend", `bridge/state → online`. It writes `coordinator_backup.json` (the network key — captured by the nightly backup).
6. **Ensure HA has the MQTT integration.** A hub imaged Zigbee-off won't have it. Add it via HA's config-flow REST API (see snippet below) using the broker creds, broker host `localhost` (HA is host-net). Verify it becomes `loaded` and HA gains `*.zigbee2mqtt_bridge_*` entities — that proves the whole Zigbee→MQTT→HA chain.
7. **Verify Ziggy's own pairing path** (the app button): `docker exec ziggy-ziggy-1 python -c "import asyncio; from services.ha_zigbee import detect_stack, start_permit_join; print(asyncio.run(detect_stack())); print(asyncio.run(start_permit_join(120)))"` → expect `z2m` and `{'ok': True}`, and z2m logs "allowing new devices to join". `detect_stack()` returns `z2m` when HA has an `mqtt` entry and no `zha`.
8. **Pair a device:** open permit-join (step 7, or `docker exec ziggy-mosquitto-1 mosquitto_pub -u <user> -P <pass> -t zigbee2mqtt/bridge/request/permit_join -m '{"value":true,"time":254}'`), put the device in pairing mode, watch `docker logs -f ziggy-zigbee2mqtt-1` for "Interviewing" → "successfully interviewed".

### Add HA's MQTT integration to an already-onboarded HA
```python
# Run inside the hub. Reuses the LLAT + broker creds from the ziggy container.
# HA_TOKEN=$(docker exec ziggy-ziggy-1 printenv HA_TOKEN) MQTT_URL=$(docker exec ziggy-ziggy-1 printenv MQTT_URL) python3 - <<'PY'
import os,re,json,time,urllib.request
tok=os.environ["HA_TOKEN"]; m=re.match(r"mqtt://([^:]+):([^@]+)@",os.environ["MQTT_URL"])
user,pw=(m.group(1),m.group(2)) if m else ("ziggy","")
def call(p,b=None,meth="GET"):
    r=urllib.request.Request("http://localhost:8123"+p,data=(json.dumps(b).encode() if b is not None else None),
        method=meth,headers={"Authorization":"Bearer "+tok,"Content-Type":"application/json"})
    return json.loads(urllib.request.urlopen(r,timeout=20).read() or "{}")
for _ in range(6):  # broker-settle retry; abort=single_instance_allowed means already there
    f=call("/api/config/config_entries/flow",{"handler":"mqtt","show_advanced_options":False},"POST")
    if f.get("reason")=="single_instance_allowed": print("already configured"); break
    res=call("/api/config/config_entries/flow/"+f["flow_id"],{"broker":"localhost","port":1883,"username":user,"password":pw},"POST")
    if res.get("type")=="create_entry": print("MQTT entry created"); break
    time.sleep(4)
PY
```

## Verify a hub end-to-end
- Ziggy healthy: `curl -s -o /dev/null -w '%{http_code}' http://localhost:8001/health` → `200`.
- MQTT reachable from ziggy: `docker exec ziggy-ziggy-1 python3 -c "import socket;s=socket.socket();s.settimeout(2);print(s.connect_ex(('mosquitto',1883)))"` → `0`.
- HA MQTT loaded: query `/api/config/config_entries/entry`, look for `('…','loaded')` with domain `mqtt`.
- Acceptance suite: `sudo ./scripts/canary-validate.sh` (all non-hardware rows PASS).

## Gotchas (hard-won)

| Symptom | Cause | Fix |
|---|---|---|
| App pair button does nothing | (a) z2m stack not running (Zigbee-off image), or (b) Ziggy `MQTT_URL=@localhost:1883` | check BOTH: is `ziggy-zigbee2mqtt-1` up? is `MQTT_URL` `@mosquitto`? Bring up z2m; fix the URL + recreate `ziggy` |
| z2m won't connect to MQTT | z2m config missing `mqtt.user/password` (prod broker is auth) | seed creds into `configuration.yaml` |
| Zigbee devices don't reach HA | HA has no MQTT integration | add it via config-flow REST (snippet) |
| ha-seed logs `cannot_connect` for MQTT | broker still settling / crash-looping | retry the flow (built into ha-seed); check `docker compose logs mosquitto` |
| `git`/`sudo` fail over SSH | root-owned repo / no TTY for sudo password | `sudo git` + `safe.directory`; passwordless sudo; read creds from container env |
| SLZB-07 over network won't image | base compose pins a USB device mount | set `COORDINATOR_IP` → uses `docker-compose.zigbee-net.yml` |
| Recreated ziggy but code change didn't apply | `up -d` without `--build` only reloads env | `docker compose … up -d --build ziggy` |

## Backup / restore
Daily encrypted B2 backups are armed after a real seal (`backup.enabled: true`). Manual: `docker compose exec -T ziggy python -m services.backup_engine --once`. Restore/DR: `scripts/factory/ziggy-restore-device.sh`. Zigbee state is split — dongle (network key in NVRAM) + PC (`docker/z2m-data/` db + `coordinator_backup.json`); ship/keep them as a matched set.

## Key files
`scripts/factory/ziggy-image-device.sh` · `scripts/factory/_seal_step.sh` · `scripts/ha-seed.sh` · `docker-compose.yml` + `docker-compose.prod.yml` + `docker-compose.zigbee-net.yml` · `docker/z2m-data.example/configuration.yaml` · `services/ha_zigbee.py` · `docs/CANARY_REBUILD_RUNBOOK.md` · `docs/KIT_ZIGBEE_AND_PREPAIR_MODEL.md`
