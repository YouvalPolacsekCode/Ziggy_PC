# Handover — Reliable presence (background GPS + LAN) so Leave-Home actually fires

> **STATUS UPDATE 2026-07-22 — Path B (LAN) is DONE and verified working.** Person confirms
> `state=home`, `_probe_host` returns True, `lan_last_seen` fresh (~38 s). LAN was never actually
> blocked (see §4a — the old "container can't reach LAN" claim was a bad `ping`-binary test).
> **Leaving is now detectable via LAN** (phone drops off home Wi-Fi → `lan_offline_grace` →
> `not_home` → `all_persons_left`), so **Leave Home's phone trigger works today** without background
> GPS. Path A (background GPS) is now needed ONLY for **Pre-cool's distance-approach** ("5 min from
> home" while driving — LAN can't sense distance) and for cleaner away/arrive on cellular-only phones.
> Remaining work below is Path A + the `lan_host` Settings UI (§4b).

**For:** a fresh Claude picking this up.
**Goal:** make Ziggy detect *leaving home* reliably, so the **Leave Home** automation
(and anything else keyed on presence) fires without the app being open in the foreground.
**Two complementary paths, do both:** (A) native **background geolocation** for the *away*
signal, (B) **LAN reachability** for the *at-home* signal. The presence engine already fuses
whichever fires its dwell first — you're wiring inputs, not rebuilding the engine.

---

## 0. Why this exists (the gate we hit)

Ziggy's presence engine works and already fires automations natively (`person_leaves`,
`all_persons_left`) via `services/presence_side_effects.py`. The **Leave Home** wizard
(`frontend/src/components/automations/LeaveHomeWizard.jsx`) now uses that native path
(trigger `{type:'all_persons_left'}`), fed by **Settings → Presence → "Track my location."**

**The problem is the input signal, not the engine.** The only presence input today is
**browser / foreground-Capacitor `watchPosition`**, which iOS/Android suspend the moment the
app backgrounds or the screen locks. Result observed live on Canary:

- Person `Silentyouval` is registered, GPS received, last fix **~38 m from home inside the
  80 m home zone** — but `effective_state` is **`unknown`**.
- Confirming `home` needs `dwell_seconds` (**60 s**) of continuous pings; backgrounding kills
  the watch after one ping → dwell never completes.
- Even a confirmed `home` decays `home → unknown` (NOT `not_home`) after
  `stale_home_no_lan_minutes` (**30 min**) with no LAN signal — and decay does **not** fire a
  leave. So foreground GPS can *sometimes* confirm home, but **cannot reliably detect leaving**.

Fixing this = feeding the engine a signal that survives backgrounding. That's background GPS
(away) and LAN reachability (home).

---

## 1. The presence engine — how a signal becomes a fired automation

Read `services/presence_engine.py` header (lines 1–130) for the full contract. Essentials:

- **State machine per person** (persisted in `user_files/persons.json`): `state` =
  `home | not_home | unknown`, with `candidate_state/candidate_since` (dwell) and
  `last_transition_*` (cooldown). Tunables in `_DEFAULTS` (`presence_engine.py:~118`):
  `home_radius_m`, `away_radius_m`, `max_accuracy_m` (150), `dwell_seconds` (60),
  `cooldown_seconds`, `stale_home_no_lan_minutes` (30), `stale_away_minutes`,
  `lan_fresh_seconds` (180).
- **Ingest entry points:**
  - `ingest_ping_for_person_id(person_id, lat, lon, accuracy, client_ts, wifi_home_hint)` — GPS.
  - `ingest_external_state(person_id, state, source, …)` — a pre-decided home/away (e.g. LAN).
  - `sweep_expiry()` — run each minute by `services/ziggy_scheduler.py`; applies staleness decay
    AND runs the **LAN probe** (`services/lan_presence.py`).
- **`effective_state(person)`** (`presence_engine.py:380`) applies asymmetric staleness:
  `home` trusted up to `stale_home_hours` **if LAN recently confirmed**, else only
  `stale_home_no_lan_minutes` (30). This is exactly why LAN matters — LAN keeps `home` alive
  across a backgrounded phone.
- **Fan-out:** every confirmed transition → `Decision` → `services/presence_side_effects.py`:
  - `_fire_automations(name, new_state)` runs automations with trigger `person_leaves` /
    `person_arrives`; when `is_all_away()` it also fires `all_persons_left`.
  - Also fires `zone_entered` / `zone_left`, pushes, and WS broadcasts.

**HTTP ingest endpoints** (`backend/routers/presence_router.py`):
- `POST /api/presence/me/ping` — JWT (logged-in user). Body `MePingBody {lat, lon, accuracy?, ts?}`.
  Auto-creates the user's person (`_resolve_or_create_my_person`). **Used by the web PWA.**
- `POST /api/presence/ping` — **no JWT**, body `PingBody {token, lat, lon, accuracy?, ts?}`; the
  per-person `token` is the credential. **This is what the native app already uses** (survives
  background better — no session/cookie needed). Get the token from
  `GET /api/presence/my-person` → `person.token`.
- `PATCH /api/presence/persons/{id}/lan-host` — admin; sets `lan_host` (see Path B).
- `GET /api/presence/persons` → `{persons:[…]}`; `GET /api/presence/zone` → home zone.

Home zone on Canary: **lat 32.519459, lon 34.939181, radius 80 m.**

---

## 2. What already exists (do NOT rebuild)

- **Foreground native GPS is already wired.** `frontend/src/App.jsx` ~line 620–660: a Capacitor
  `Geo.watchPosition({enableHighAccuracy:true})` loop throttled to one ping / 30 s, plus a 2-min
  `keepAlive`, POSTing to `/api/presence/ping` with the per-person token. It uses
  `@capacitor/geolocation` — **foreground only** (stops on background). There's a parallel PWA
  `navigator.geolocation` path above it.
- **LAN reachability engine is already built.** `services/lan_presence.py`: ICMP `ping -c1 -W…`
  first, TCP-connect fallback; per person `lan_host`, `lan_last_probe`, `lan_last_seen`; run every
  minute from the scheduler; `lan_fresh_seconds` (180) window = strong `home`. The `lan_host`
  field + `PATCH …/lan-host` endpoint exist.
- **Mobile app repo:** `~/ziggy_mobile/` (Capacitor 7, appId `com.ziggyhome.app`,
  [[reference_mobile_bundle_id]]). Currently DEV-LOOP mode: `capacitor.config` loads
  `https://app.ziggy-home.com` live (swap to bundled `www/` + capgo OTA for store builds —
  [[project_mobile_cold_start_plan]]). Installed plugins include `@capacitor/geolocation` and
  `@capacitor/network`. **No background-geolocation plugin yet.**

---

## 3. Path A — Native background geolocation (the *away* signal)

**Missing piece:** a background-capable geolocation source. `@capacitor/geolocation` is
foreground-only. Add a background plugin and feed the SAME `/api/presence/ping` contract.

### Plugin choice
- **`@transistorsoft/capacitor-background-geolocation`** — the robust, batteries-included option
  (geofencing, motion-activity throttling, iOS `location` background mode, Android foreground
  service). **Paid license for release builds** but free in debug. Best reliability.
- **`@capacitor-community/background-geolocation`** — free/MIT, lighter, keeps a background watch
  alive with a persistent notification (Android) / `location` background mode (iOS). Good enough
  for "am I in/near the home zone."

Recommend starting with the **community** plugin (free, unblocks validation); flag Transistor as
the upgrade if reliability is short. **Surface this license trade-off to the user before picking.**

### Wiring (mirror the existing foreground path)
1. Install + `npx cap sync` in `~/ziggy_mobile/`.
2. **iOS** (`ios/App/App/Info.plist`): `NSLocationWhenInUseUsageDescription`,
   `NSLocationAlwaysAndWhenInUseUsageDescription` (Hebrew + English copy — this is user-facing,
   keep it Ziggy-branded, no "Home Assistant"), and background mode `location` in
   `UIBackgroundModes`. Request **Always** authorization (When-In-Use won't fire backgrounded).
3. **Android** (`AndroidManifest.xml`): `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`,
   `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_LOCATION`; runtime-request background location
   (Android 10+ needs the separate "Allow all the time" grant).
4. **Feed the engine:** on each background fix, POST `/api/presence/ping` with
   `{token, lat, lon, accuracy}` — reuse the throttle (≥30 s) and the per-person token from
   `getMyPresencePerson()`. Prefer a **geofence around the home zone** (`GET /api/presence/zone`)
   over a raw 1 Hz watch — you only need transitions in/out of the 80 m radius, which is far
   kinder on battery and exactly what dwell/hysteresis wants.
5. Put this behind a Settings toggle (extend the existing PresenceSection, `Settings.jsx` ~424,
   which today owns the web "Track my location" toggle + Home-zone editor). Keep the web path for
   PWA users; the native plugin supersedes it inside the app (`Capacitor.isNativePlatform()`).

### Gotchas
- iOS **Always** permission is a two-step OS prompt; the app must handle "When-In-Use only" and
  explain why background is needed. Walk the user through the iOS ceremony
  ([[feedback_mobile_collab_style]]).
- Dwell is 60 s — a single geofence-exit event is enough for `not_home` only after the engine's
  hysteresis/dwell; verify `away_radius_m` vs `home_radius_m` give clean separation (no flapping
  at the boundary). Tune `_DEFAULTS` if the 80 m zone flaps.
- Background pings must use `/api/presence/ping` + token, **not** `/me/ping` (no JWT/cookie in a
  background context).

---

## 4. Path B — LAN reachability (the *at-home* signal)

The engine + probe already exist. **LAN presence is VERIFIED WORKING (2026-07-22).**

### 4a. RESOLVED — LAN was never actually blocked (bridge network is fine)
Earlier this doc claimed the bridge-networked ziggy container couldn't reach the LAN, based on
`docker exec ziggy-ziggy-1 ping <host>` → UNREACHABLE. **That test was misleading:** the container's
`ping` BINARY lacks raw-socket privileges, but `lan_presence.py` uses its OWN raw-socket ICMP
(`_icmp_reachable_raw`), which works over the bridge. Verified live on Canary:
`lan_presence._probe_host("10.100.102.13") = True`, `lan_last_seen` age ~38 s (actively fresh),
person `state=home`. So **no host-networking / sidecar / HA-probe change is needed** — LAN presence
runs as-is. (When testing reachability from the container, use the app's `_probe_host`, NOT the
`ping` binary.) This also softens [[reference_ziggy_container_networking]] for the ICMP case:
outbound raw-socket ICMP to the LAN works from the bridge; only the packaged `ping` tool fails.

### 4b. MISSING — a user-facing way to set `lan_host`
Today `lan_host` is admin-only (`PATCH /api/presence/persons/{id}/lan-host`). Add a field to the
Settings PresenceSection: "Your phone's home address (IP or `name.local`)". Consider auto-suggesting
it: on the native app you can read the device's LAN IP (`@capacitor/network` + a small native bit),
or capture the client IP server-side on a same-LAN `/me/ping` (`_client_is_on_home_lan` already
computes a wifi hint from the client IP — you could persist that IP as a candidate `lan_host`).

### 4c. Caveats to document for the user
- **Wi-Fi sleep:** phones drop off Wi-Fi when idle/locked to save battery → intermittent
  unreachable even while home. `lan_offline_grace` cushions this; tune it. TCP-probe a port the
  phone keeps open if ICMP is unreliable.
- **MAC/IP randomization:** DHCP can reassign the phone's IP; prefer a DHCP reservation or an
  mDNS `.local` name. mDNS resolution needs avahi on the host (works once ziggy is host-networked;
  see 4a).

---

## 5. How the two paths layer

The engine fuses them — you don't choose one:
- **LAN** = strong, cheap, background-proof **home** confirmation; keeps `effective_state` from
  decaying to `unknown` while the phone sits backgrounded at home (`lan_fresh_seconds` window).
- **Background GPS geofence** = the reliable **leave** edge (`home → not_home`) that LAN alone
  can't give cleanly (Wi-Fi-drop ≠ left).
Together: LAN says "still home" → GPS geofence-exit + dwell says "now left" → `all_persons_left`
fires → Leave Home runs. That's the whole objective.

---

## 6. Working conventions (inherited — obey)

- **Branch `feat/beta-image-readiness`.** A concurrent session may be on it — `git pull --ff-only`
  before work, keep edits additive, mirror every user string in `he.js` (warm, dugri, gender-free),
  diff `he.js` before committing to confirm only your lines changed.
- **Never surface HA / entity_ids / HA jargon** in any user string ([[feedback_ziggy_product_surface]]).
- **Nothing is "done" until the user validates on the real phone** ([[feedback_real_life_validation]]).
  You can verify math/state live, but the user tests background-leave by actually walking out.
- **Canary deploy loop** (`ziggy@10.100.102.15`, repo `/opt/ziggy`, passwordless sudo):
  commit → push → `sudo git pull --ff-only` →
  `SHA=$(sudo git rev-parse --short HEAD); sudo env GIT_SHA=$SHA docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build ziggy`
  → poll `/health` for 200. **`GIT_SHA` build-arg is REQUIRED** or the phone OTA won't pull.
- **PROD gotcha:** the container runs `uvicorn backend.server:app`, NOT `core/ziggy_main.py`.
  Background threads/tasks (like the presence scheduler) must start in
  `backend/server.py::_startup()`.
- **Read live presence state:** `ssh ziggy@10.100.102.15` → `docker exec ziggy-ziggy-1 python3 -c "…"`
  (`HA_URL`/`HA_TOKEN` in container env). Handy: dump `persons.json` via `presence_engine._load()`,
  check `effective_state`, `presence_store.all_away()/any_home()`.
- **Mobile native builds** (`~/ziggy_mobile/`): JDK 21 for Android; iOS falls back to the free
  Personal Team 7-day cert until the Apple account clears ([[project_mobile_dev_accounts]]).
  Prefer Wireless debugging for Android sideload ([[feedback_wireless_adb_default]]).

---

## 7. Suggested order of work

1. **Path B blocker first** (4a): host-network the ziggy container, confirm
   `docker exec ziggy-ziggy-1 ping <phone>` succeeds. Cheap, unblocks the already-built LAN engine.
2. Set your `lan_host` (via the admin PATCH for now), confirm `effective_state` holds `home` while
   the phone is backgrounded at home (LAN keeps it alive).
3. **Path A** (background geofence): add the community plugin, iOS **Always** + Android background
   perms, geofence the home zone, POST `/api/presence/ping`. Validate a real walk-out flips
   `home → not_home` and fires `all_persons_left`.
4. Then the Leave Home automation you already have will fire for real — the user validates by
   walking out with lights on.

**First thing to read:** `services/presence_engine.py` (header + `effective_state` +
`ingest_ping_for_person_id`), `services/presence_side_effects.py`,
`services/lan_presence.py`, `frontend/src/App.jsx` ~620–660, and
`frontend/src/components/automations/LeaveHomeWizard.jsx`.
Memory pointers: [[project_leave_home_and_library_add]], [[project_mobile_architecture]],
[[reference_ziggy_container_networking]], [[reference_home_access]].
