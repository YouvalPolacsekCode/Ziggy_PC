# Home Assistant Install Assessment

_Prompt 4 chunk 1 — read-only diagnosis before any code changes._

This document answers the five questions from the source prompt by reading the
code that exists today. **Nothing has been modified.** Where I'm guessing about
intent, the assumption is called out explicitly. Risks and gaps are flagged at
the end so the user can decide direction before chunk-1 implementation begins.

---

## 1. How HA is installed and run

There are **two deployment topologies**, and they share the same HA image.

### 1a. Local dev / self-hosted hub — [`docker-compose.yml`](../docker-compose.yml)

```yaml
homeassistant:
  image: ghcr.io/home-assistant/home-assistant:stable
  network_mode: host
  privileged: true
  volumes:
    - ./docker/ha-config:/config
```

HA, Mosquitto, and Ziggy run side-by-side. Ziggy talks to HA at
`http://homeassistant.local:8123` (default in [`config/settings.example.yaml:208`](../config/settings.example.yaml#L208)).
The `/config` directory is bind-mounted from `./docker/ha-config` on the host
— state, config, and `.HA_VERSION` all live there.

### 1b. Cloud home — [`relay/app/provisioner.py`](../relay/app/provisioner.py)

The relay (on Fly.io) SSHes into an Oracle ARM VM and writes a per-home
`docker-compose.yml` at `/opt/ziggy-homes/<home_id>/`:

```
HA_IMAGE = "ghcr.io/home-assistant/home-assistant:stable"   # provisioner.py:49
```

Same image, same `./ha-config:/config` bind (provisioner.py:146), plus
Cloudflare Tunnel + Ziggy + a Cloudflared container. HA listens on the
in-network address `http://homeassistant:8123`, which the Ziggy container
finds via `HA_URL` env var.

### What both share

- HA Core image only — **no Supervisor** (no add-ons, no Snapshots API).
- Bind-mounted `/config` so state survives a `docker compose up -d` recreate.
- Ziggy reads HA via **WebSocket + REST**, using credentials in
  `home_assistant.url` (settings.yaml) and `home_assistant.token` (secrets.yaml).
  See [`services/ha_subscriber.py`](../services/ha_subscriber.py) and
  [`services/home_automation.py`](../services/home_automation.py).
- Ziggy does NOT touch the HA container or `/config` after provisioning —
  every write goes through HA's WS / REST API.

---

## 2. Version pinning status — **currently NOT pinned**

Both `docker-compose.yml` and `relay/app/provisioner.py` ship the HA image
as `:stable`, which is a floating tag. A `docker compose pull` at any time
can silently move HA forward.

### What already exists for pinning

The OTA pipeline lays the rails:

| Component | Location | Status |
|---|---|---|
| Manifest endpoint | [`relay/app/routers/ota.py:129`](../relay/app/routers/ota.py#L129) | ✅ live, signed, tested |
| Release catalog | `ota_releases` table ([`relay/app/database.py:127`](../relay/app/database.py#L127)) | ✅ live |
| Per-home pin | `homes.ota_pinned_release_id` column + `PUT /api/admin/homes/{home_id}/ota-pin` | ✅ live |
| Edge poller | [`services/ota_client.py::poll_once`](../services/ota_client.py) | ✅ live, tested, called hourly from [`ziggy_scheduler.py:278`](../services/ziggy_scheduler.py#L278) |
| State on disk | `user_files/ota_state.json` with `{installed, staged, …}` | ✅ shape exists |
| `mark_installed()` hook | [`services/ota_client.py:107`](../services/ota_client.py#L107) | ✅ awaits an installer to call it |
| **Installer that actually pins HA** | — | ❌ **missing — this is Prompt 4** |

A manifest carries:
```json
{
  "schema_version": 1, "home_id": "...", "device_id": "...",
  "release_id": 7, "ha_version": "2026.5.1", "ziggy_version": "1.2.3",
  "image_digests": {...}, "released_at": "...", "signature": "t=...,v1=..."
}
```

So the **target version** is already arriving at the edge every hour and
being persisted as `staged`. There is no code that turns `staged` into a
pinned HA container.

---

## 3. Ziggy → HA config touch points

### Read paths

| Caller | Purpose |
|---|---|
| `services.ha_subscriber` | Persistent WS, state cache, registry subscription |
| `services.ha_runtime.probe_ha` | Pre-save WS-auth handshake during onboarding |
| `services.ha_update_checker._get_ha_current_version` | `GET /api/config` for installed version |
| `services.telemetry_client._get_ha_version` | Same, for telemetry payload |
| `services.ha_areas`, `services.ha_capabilities`, `services.ha_automations` | Registry/config queries via WS |
| `services.home_automation.call_service` | All device control via `POST /api/services/...` |
| `services.backup_engine` (line 200) | Reads `ha_config_dir` (default `docker/ha-config`) into the encrypted nightly backup |

### Write paths

There are **only two**:

1. [`services.ha_runtime.set_ha_credentials`](../services/ha_runtime.py#L65) — writes
   `home_assistant.url` to `settings.yaml`, `home_assistant.token` to
   `secrets.yaml`, invalidates the registry cache, kicks the subscriber.
2. [`relay/app/provisioner.py:276`](../relay/app/provisioner.py#L276) — writes
   `configuration.yaml` into the new home's `ha-config/` directory **once at
   provision time**. After that the provisioner doesn't touch HA config.

**Key implication for Prompt 4:** the installer can change the HA image
tag (a docker-level concern) without touching HA's `/config` directory.
Existing automations, integrations, and pairings are all stored under
`/config/.storage/`, which is preserved across container recreates because
of the bind mount. Worth verifying experimentally before relying on it.

### What HA-config touch points are NOT in scope

- Ziggy never edits HA YAML in `configuration.yaml`. All Ziggy-side
  automations are stored in Ziggy's `automations.json`, not HA's.
- HA-side automations Ziggy creates go through `services.ha_automations`,
  which uses HA's REST/WS APIs — Ziggy never edits HA's automations.yaml
  directly.

---

## 4. Existing update mechanism

### What is built today

1. **[`services/ha_update_checker.py`](../services/ha_update_checker.py)** — detection-only.
   - Polls `update.home_assistant_core_update` entity for an available version
   - Fetches the GitHub release body, parses Breaking Changes
   - Matches breaking changes against a 19-rule risk catalogue (lines 54-242)
     keyed to the user's actual entity inventory (ZHA count, climate count, …)
   - Scores risk → safe / low / medium / high / unknown
   - Notifies via web push + Telegram on `risk > safe`
   - Writes `user_files/update_history.json` for the admin UI
   - **NEVER auto-updates HA** (line 17 — explicit safety rule)

2. **[`backend/routers/update_router.py`](../backend/routers/update_router.py)** — the
   UI surface for the checker (PWA "HA Update" page).

3. **[`services/backup_engine.py`](../services/backup_engine.py)** — encrypted nightly
   backup of `ha-config/`, recorder DB, and Ziggy state to Backblaze B2.
   Runs at 02:00 by default. This is the natural rollback artifact if a
   bad HA upgrade corrupts `/config` — but **no rollback orchestration exists**.

4. **[`services/ota_client.py`](../services/ota_client.py)** — the part already
   shipped in Prompt 2: fetches + verifies the manifest, persists `staged`,
   exposes `mark_installed(manifest)` for an installer to call after a
   successful apply.

### What is NOT built

- **No installer.** Nothing reads `ota_state.staged` and applies it.
- **No rollback orchestration.** Even if we install, we have no path back.
- **No image-digest verification** on apply (manifest carries `image_digests`,
  edge currently ignores them).
- **No "is HA healthy after restart" probe** beyond `ha_subscriber.ha_connected`.

---

## 5. Existing health reporting

### Telemetry → relay (already wired by Prompt 2 §C)

[`services/telemetry_client.py::post_once`](../services/telemetry_client.py) is
**not stubbed** — contrary to the source prompt's description, the collectors
are functional best-effort:

| Field | Current state |
|---|---|
| `ha_version` | ✅ from `GET /api/config` |
| `ziggy_version` | ✅ from env `ZIGGY_VERSION` → `settings.version` → `"0.0.0+local"` |
| `uptime_s` | ✅ since process import time |
| `sensors[]` | ✅ filters HA states with `device_class=battery` or `battery_level` attr; capped at 200 |
| `disk.{used_gb,total_gb}` | ✅ via `psutil.disk_usage("/")` |
| `cpu_pct`, `mem_pct` | ✅ via `psutil` (non-blocking) |
| `containers[]` | ✅ via `docker.from_env()` — **silently None if Docker SDK can't reach the socket** |
| `last_automation_trigger` | ✅ scans HA states for `automation.*` entities and picks the most recent `last_triggered` attr |

Posted every 5 min via [`ziggy_scheduler.py:252`](../services/ziggy_scheduler.py#L252).

**Open question:** the prompt says collectors are "currently stubs" — they
aren't. There may be quality gaps in the existing collectors worth fixing
(see Risks #5), but a wholesale rewrite would discard working code that
already has unit-test coverage in [`tests/test_edge_telemetry_client.py`](../tests/test_edge_telemetry_client.py).

### Local `/health` (LAN-reachable, app/PWA consumption)

| Endpoint | Auth | Purpose | Gap |
|---|---|---|---|
| `GET /api/health` ([`backend/routers/health_router.py:84`](../backend/routers/health_router.py#L84)) | ✅ required (`_auth`) | HA-cluster health: offline devices, battery warnings, Zigbee coordinator status | Not LAN-readable without a session token |
| `GET /api/mobile/health` ([`backend/routers/mobile_router.py:115`](../backend/routers/mobile_router.py#L115)) | ❌ none | `{ok: true, service: "mobile", version: "0.1.0"}` — pure liveness | Doesn't expose HA version, Ziggy version, uptime, container health |

So **a richer no-auth LAN `/health` does not exist yet.** Building one for
chunk 2 is additive — neither existing endpoint needs to change.

### Admin staged-rollout surface

What exists on the relay (Prompt 2):

- `GET /api/admin/ota/releases` — list catalog
- `POST /api/admin/ota/releases` — publish release
- `GET  /api/admin/homes/{home_id}/ota-pin` — read per-home pin
- `PUT  /api/admin/homes/{home_id}/ota-pin` — set/clear per-home pin

**Per-home pin already works.** A founder can pin one hub to a specific
release before global rollout. What's missing:

- **No cohort concept** in the schema. `homes` has no `cohort` / `release_channel` column.
- **No admin UI** in the Ziggy PWA / admin dashboard pointing at these
  endpoints (they're callable today only via curl + JWT).

---

## Assumptions (where I'm guessing)

1. **HA pinning** means setting the HA Docker image tag to a specific
   version (e.g. `2026.5.1`) rather than `stable`. Not modifying HA's
   internal `update` entity, not using `ha core update` from Supervisor
   (no Supervisor present).
2. **The installer runs on the edge** (Ziggy host), not on the relay. The
   relay only tells the edge "your target is release_id 7"; the edge
   converges to it.
3. **"Last-known-good"** = the previous `installed` manifest in
   `ota_state.json` plus the previously-running HA image tag/digest. The
   installer must record the digest of the image that WAS running before
   it pulls a new one.
4. **The installer needs Docker control of the host's HA container.**
   Today the Ziggy container does not bind `/var/run/docker.sock`. The
   relay container does (`relay/docker-compose.yml:12`), so the pattern
   exists. **Adding the socket bind to the Ziggy container is a privilege
   decision the user must approve.**
5. **Cohort pinning** is not in the schema yet. Two reasonable shapes:
   - (a) Add a `cohort` TEXT column to `homes` + new admin endpoints
     `PUT /api/admin/cohorts/{name}/ota-pin` that fan-out to homes.cohort=name.
   - (b) Separate `cohorts(id, name)` table + `cohort_id` FK on `homes`.
   Approach (a) is cheaper and matches the existing per-home pin shape.

---

## Risks & gaps to confirm before chunk 1 implementation

1. **Docker socket access on the edge.** Without it, the installer cannot
   restart HA. Options:
   - **A.** Bind `/var/run/docker.sock:/var/run/docker.sock` into the Ziggy
     container. Simplest, but gives Ziggy root-equivalent on the host.
   - **B.** Run the installer as a sidecar / systemd unit on the host
     itself, not inside the Ziggy container. Stronger isolation, but a new
     deployment surface to maintain.
   - **C.** Use the Docker HTTP API over TLS on a Unix domain socket
     proxy. Middle ground.
   Recommendation: **A** for v1 of Prompt 4, with a clear comment that
   this is the privilege boundary and we may shrink it later. Need user
   approval.

2. **Compose file location varies by topology.** Cloud:
   `/opt/ziggy-homes/<home_id>/docker-compose.yml` on the host. Local dev:
   `<repo>/docker-compose.yml`. Installer needs to know where. Proposal: a
   new setting `ha.compose_file` (default `/opt/ziggy-homes/<HOME_ID>/docker-compose.yml`
   when `CLOUD_MODE=true`, else `./docker-compose.yml`).

3. **Image tag swap vs digest pinning.** The manifest carries both
   `ha_version` (human tag) and `image_digests` (sha256). Most reliable
   approach is `image: ghcr.io/home-assistant/home-assistant@sha256:...`
   in the compose file. But humans editing the file later will expect
   `:2026.5.1`. Proposal: write the tag for readability AND record the
   digest in `ota_state.json` for verification on restart.

4. **"Existing automations continue without interruption."** Because
   `/config` is bind-mounted and a container recreate preserves the
   volume, this should hold — but it needs to be **tested on a non-prod
   HA** before any production touch (per source prompt). The test plan
   should include: pre-update entity count, pre-update automation count,
   force-recreate at a different tag, post-update entity + automation
   count must match.

5. **Telemetry collector quality gaps** (real, despite the collectors not
   being "stubs"):
   - Sensor list filters to battery-bearing entities only — Prompt 4 asks
     for **total sensor count** plus per-battery breakdown. Today we only
     return the battery list; the count is implicit (`len(sensors)`).
     Could add `sensor_count_total` separately.
   - `last_automation_trigger` re-fetches `/api/states` in the same tick
     after `_collect_sensors` already fetched it. One extra HTTP round-trip
     per 5-min cycle — wasteful but bounded.
   - Container health is "running / exited / etc." — no per-container
     uptime, restart count, or last-exit reason.

6. **`/api/health` is auth-required**, so the PWA can already use it once
   logged in, but a tablet showing a hub-status screen before login can't.
   Proposed new endpoint: `GET /health` (NOT under `/api/`), no auth, LAN-
   reachable, returns ziggy + ha versions, uptime, ha_connected,
   container summary. This **does not replace** `/api/health` — that one
   stays as the rich auth-required view.

7. **Cohort schema** — needs user decision (see Assumption #5) before
   chunk 2 lands. Per-home pinning already works, so a "ship per-home,
   add cohort later" path is viable.

8. **No CI / staging HA instance is documented.** The source prompt says
   "Test on a non-prod HA before any production touch." Need user to point
   me at where that non-prod is, or accept a temporary `docker compose -f
   docker-compose.test.yml` spun up just for the installer's tests.

---

## What is good and should be preserved

- The OTA + manifest + signature path on both sides is **complete, signed,
  and unit-tested**. The installer plugs into a working pipeline.
- The edge telemetry POST is **complete, tested, scheduled**. Fleshing out
  collectors is additive — no rewrite needed.
- The HA update checker is mature and has a thoughtful risk model that the
  installer should reuse (e.g., refuse to auto-apply a `medium+` risk
  release without admin override).
- Backups already capture HA's `/config` daily. Rollback can leverage that
  rather than building a fresh snapshot mechanism.
- Per-home pinning endpoint is **live and tested** — no relay work needed
  for chunk-1 pinning, only edge-side installer work.

---

## Suggested chunk-1 implementation order

_(For user approval; no code touched yet.)_

1. **Settings + env plumbing** — new keys `ha.compose_file`, `ha.image_repo`
   (default `ghcr.io/home-assistant/home-assistant`), `ha.health_url`
   (default `http://homeassistant:8123` cloud / `http://homeassistant.local:8123`
   local). All optional with sensible defaults so existing deployments
   keep working.
2. **`services/ha_installer.py` (new module)** —
   - `read_current_image()` → digest currently running
   - `apply_pin(manifest)` → edit compose, `docker compose up -d homeassistant`, wait for `GET /api/config` to return the expected version, then call `ota_client.mark_installed(manifest)`
   - `rollback(to_manifest)` → reverse of the above
3. **Wire into scheduler** — when `staged` is present and `installed.ha_version != staged.ha_version`, call `apply_pin`. Only run inside a configurable maintenance window (default 03:00-04:00 local, after the 02:00 backup) so we never apply during user activity. **Off by default** until user sets `ha.auto_install: true`.
4. **Tests** — unit tests using fakes for the docker client + HA `/api/config`, plus an integration test against a throwaway docker-compose that spins up an old HA tag → new tag → confirms automations + states preserved.

Steps 1-4 are the four sub-commits the source prompt asks for.

Steps 5 (telemetry collector fleshing), 6 (local `/health`), 7 (admin
staged-rollout surface) belong to **chunk 2** and are out of scope for
this assessment beyond noting they exist as work items.
