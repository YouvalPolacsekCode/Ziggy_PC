# Ziggy Linux OTA lifecycle (Ubuntu Server 24.04 · systemd · Docker Engine)

This directory is the **Linux port** of the mature Windows OTA path
(`scripts/*.ps1`). The Windows scripts stay in place for Windows mini PCs; on
the Ubuntu beta image, systemd + these scripts do the same job.

Target layout:

| Thing            | Path                                   |
|------------------|----------------------------------------|
| Repo             | `/opt/ziggy`                           |
| Config / secrets | `/etc/ziggy/ziggy.env` (+ `secrets.yaml`) |
| Runtime state    | `/opt/ziggy/user_files/`               |
| systemd units    | `/etc/systemd/system/ziggy-*.{service,timer}` |

All scripts autodetect the repo as the parent-of-parent of `scripts/linux/`,
so they work even if the repo lives somewhere other than `/opt/ziggy`. Override
with `ZIGGY_REPO_DIR`. Every script sources `/etc/ziggy/ziggy.env` if present.

---

## 1. OTA update loop

**`ziggy-update.sh`** — the port of `update.ps1`. On every run it:

1. Writes `user_files/update.heartbeat` + `user_files/update_task.json`
   (systemd unit snapshot) so `/api/admin/deploy/health` can see the loop live.
2. Nudges the clock (`chronyc makestep` / `timedatectl`), self-heals a
   masked/disabled `ziggy-update.timer`.
3. Picks the target by **cohort**:
   - `ZIGGY_COHORT=canary` (default) → follows `origin/main`.
   - `ZIGGY_COHORT=production` → newest `release-*` tag; bare pushes to main do
     **not** deploy here. Set `ZIGGY_REQUIRE_SIGNED_TAGS=true` to enforce
     `git verify-tag` before checkout.
4. Auto-stashes a dirty tree (never freezes the loop), `git fetch --prune
   --tags`, then **canary** `reset --hard origin/main` / **production** detached
   `checkout` of the tag.
5. Rebuilds **only** the `ziggy` service: `docker compose build --no-cache
   --pull ziggy` + `up -d --no-deps ziggy`.
6. Syncs the **pinned infra images** (HA / Z2M / Mosquitto) on a *controlled
   channel* — see §2.
7. Verifies `/api/version` returns the new SHA within ~60s. On failure,
   **auto-rolls back** to the last verified SHA from `user_files/deploy_log`
   and records the rollback (`kind: rollback`).
8. Rotates `deploy_log` past `ZIGGY_DEPLOYLOG_MAX_ENTRIES` (default 200).

Silent on no-op. Detailed logs: `user_files/update.log` (status) and
`user_files/deploy-logs/<ts>-build.log` (noisy build output).

```bash
sudo /opt/ziggy/scripts/linux/ziggy-update.sh            # one cycle
sudo /opt/ziggy/scripts/linux/ziggy-update.sh --dry-run  # plan only, no mutation
sudo /opt/ziggy/scripts/linux/ziggy-update.sh --infra    # force infra image sync now
```

Driven by **`ziggy-update.timer`** → **`ziggy-update.service`** every 2 minutes
(`OnUnitInactiveSec=120`, `Persistent=true` catches up after downtime,
`Restart=on-failure`/`RestartSec=60` = the Windows RestartCount=3 equivalent).

---

## 2. Controlled infra channel (HA / Z2M / Mosquitto pins)

The `ziggy` service is rebuilt from source every deploy. The **infra** images
are operator-pinned and pulled on a slow cadence so a 2-minute loop never
chases `:latest`. In `/etc/ziggy/ziggy.env`:

```ini
ZIGGY_INFRA_CHANNEL=pinned            # or 'off' to never touch infra images
ZIGGY_INFRA_INTERVAL_HOURS=24         # min hours between infra syncs
ZIGGY_HA_IMAGE=ghcr.io/home-assistant/home-assistant@sha256:...
ZIGGY_Z2M_IMAGE=koenkk/zigbee2mqtt@sha256:...
ZIGGY_MOSQUITTO_IMAGE=eclipse-mosquitto@sha256:...
```

When any pin is set, `ziggy-update.sh` generates
`user_files/compose.infra-pins.yml` (a compose override), then `docker compose
-f docker-compose.yml -f compose.infra-pins.yml pull/up -d` only the pinned
services. No pins set → compose defaults are left untouched. `--infra` forces a
sync regardless of the cadence gate.

> To bump infra fleet-wide, change the digest pins (Stream 1 seeds them into
> the image / cloud-init) — do **not** edit `docker-compose.yml`.

---

## 3. Recovery

**`ziggy-ota-recover.sh`** — port of `ota-recover.ps1`. One-screen diagnosis of
a stuck loop: repo HEAD vs `origin/main`, unit state, heartbeats, `update.log`,
last deploy blocks, stash list, docker + disk. `--fix` unmasks/enables the
timer, prunes stashes older than 7 days, and kicks one manual cycle.

```bash
sudo /opt/ziggy/scripts/linux/ziggy-ota-recover.sh          # read-only
sudo /opt/ziggy/scripts/linux/ziggy-ota-recover.sh --fix    # safe recoveries
```

**`ziggy-safe-mode.sh`** — minimal known-good state so a botched unit stays
reachable. `on` stops the OTA timer, stops Z2M, ensures Mosquitto + HA + Ziggy
are up, and (best-effort) tells the app to drop voice/heavy threads. `off`
restores the full stack + OTA. `status` reports.

```bash
sudo /opt/ziggy/scripts/linux/ziggy-safe-mode.sh on|off|status
```

---

## 4. Disk guard

**`disk-guard.sh`** (+ `ziggy-disk-guard.timer`, daily) prunes
`user_files/deploy-logs` older than N days, trims `update.log`, `docker image
prune -f` (+ `--deep` for unused images/build cache), caps the HA recorder DB
(online `recorder.purge` when `HA_URL`/`HA_TOKEN` are set), and warns when the
repo filesystem drops below 5 GB free.

```bash
sudo /opt/ziggy/scripts/linux/disk-guard.sh            # act (maintenance job)
sudo /opt/ziggy/scripts/linux/disk-guard.sh --dry-run  # report only
sudo /opt/ziggy/scripts/linux/disk-guard.sh --deep     # also prune unused images/cache
```

---

## 5. Reset matrix

| Script | Wipes | Keeps | Gate |
|--------|-------|-------|------|
| **ziggy-customer-reset.sh** | automations, routines, device pairings/registry, zones, home map | accounts, identity, cloud registration, push keys, backups, HA+radios | `--confirm` |
| **ziggy-factory-reset.sh** (default) | HA config, Z2M data, Ziggy state, Mosquitto volumes, most secrets | cloud identity (`HOME_ID`/`RELAY_*`/cohort/infra pins) → rejoins same home | `--confirm` |
| **ziggy-factory-reset.sh --full** | everything above **plus** all of `/etc/ziggy` | nothing → generic image, needs re-provision | `--confirm` |

All three support `--dry-run`. Customer + factory back up cleared state before
deleting (customer → `user_files/reset-backups/<ts>`). Factory reset stops the
OTA timer first so it can't rebuild mid-wipe.

```bash
sudo /opt/ziggy/scripts/linux/ziggy-customer-reset.sh --confirm
sudo /opt/ziggy/scripts/linux/ziggy-factory-reset.sh  --confirm          # keep identity
sudo /opt/ziggy/scripts/linux/ziggy-factory-reset.sh  --full --confirm   # generic image
```

---

## 6. Install / enable

**`install-systemd-units.sh`** installs all four units into
`/etc/systemd/system`, rewriting the `/opt/ziggy` paths to the real repo
location and (optionally) `User=`, then `daemon-reload` + `enable --now` the
timers. Idempotent — safe from cloud-init.

```bash
sudo /opt/ziggy/scripts/linux/install-systemd-units.sh              # root, start now
sudo /opt/ziggy/scripts/linux/install-systemd-units.sh --user ziggy # non-root (needs docker group + repo ownership)
sudo /opt/ziggy/scripts/linux/install-systemd-units.sh --no-start   # enable, don't start (image build)
sudo /opt/ziggy/scripts/linux/install-systemd-units.sh --dry-run
sudo /opt/ziggy/scripts/linux/install-systemd-units.sh --uninstall
```

### Unit names (for Stream 1 cloud-init / image)

```
ziggy-update.service      ziggy-update.timer
ziggy-disk-guard.service  ziggy-disk-guard.timer
```

Enable in the image with either `install-systemd-units.sh --no-start` at build
time (then the timers start on first boot) or `systemctl enable --now
ziggy-update.timer ziggy-disk-guard.timer` after the units are placed.

---

## 7. `/etc/ziggy/ziggy.env` reference

```ini
# --- cohort / integrity ---
ZIGGY_COHORT=canary                 # canary | production
ZIGGY_REQUIRE_SIGNED_TAGS=false     # production: enforce git verify-tag

# --- identity (preserved by factory-reset keep-identity) ---
HOME_ID=home-...
HOME_TYPE=hub
RELAY_URL=https://...
RELAY_SECRET=...

# --- infra channel (see §2) ---
ZIGGY_INFRA_CHANNEL=pinned
ZIGGY_INFRA_INTERVAL_HOURS=24
ZIGGY_HA_IMAGE=...
ZIGGY_Z2M_IMAGE=...
ZIGGY_MOSQUITTO_IMAGE=...

# --- paths / endpoints (usually defaults) ---
ZIGGY_REPO_DIR=/opt/ziggy
ZIGGY_API_URL=http://127.0.0.1:8001
ZIGGY_CONTAINER=ziggy-ziggy-1
ZIGGY_COMPOSE_PROFILES=              # e.g. zigbee-z2m when Z2M is live

# --- host-script → app coordination (Stream 5 endpoints) ---
ZIGGY_ADMIN_TOKEN=                   # bearer used by reset/safe-mode POSTs

# --- disk guard ---
ZIGGY_DEPLOYLOG_KEEP_DAYS=14
ZIGGY_RECORDER_DB_CAP_GB=2
ZIGGY_DISK_WARN_GB=5
HA_URL=...                           # for online recorder.purge
HA_TOKEN=...
```

---

## 8. Endpoints these scripts call (Stream 5 owns the server side)

Best-effort, gated on `ZIGGY_ADMIN_TOKEN`; scripts still complete the
filesystem work if the endpoint is absent.

| Method + path | Caller | Purpose |
|---------------|--------|---------|
| `POST /api/admin/reset/customer` | customer-reset | app clears automations + pairings, broadcasts |
| `POST /api/admin/reset/factory`  | factory-reset  | pre-wipe hook: deregister devices / flush cloud (`{"mode":"keep-identity"\|"full-generic"}`) |
| `POST /api/admin/safe-mode`      | safe-mode      | `{"enabled":true\|false}` — toggle voice / heavy threads |
| `GET  /api/version`              | update, recover | confirm running SHA (already exists) |
| `GET  /api/admin/deploy/health`  | (dashboard)    | reads `update.heartbeat` + `deploy_log` (already exists) |
