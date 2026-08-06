# Ziggy — Session Handoff (2026-07-27): support-SSH foundation + David's home

Paste this whole block into a fresh session. It is the full state after imaging **Ziggy_02
(David's home)** — the fleet's second hub — end to end.

---

You're taking over **Ziggy**, a locally-hosted AI smart-home platform being productized into
flashable beta mini-PC kits: a FastAPI backend + React/Capacitor app + Home Assistant + MQTT +
Zigbee2MQTT + IR, one physical mini PC per home, fronted by a Fly.io relay + per-home Cloudflare
Tunnel.

## HOW TO WORK WITH THE OPERATOR (Youval)
Product owner / operator, **not** an engineer. Dumb everything down, ONE step at a time, exact
copy-paste commands, walk click-by-click through any account/hardware step. Only add `sudo` when
needed. **Nothing "works" until he tests it on real hardware.** For any bug, find the ROOT CAUSE
before patching (systematic-debugging). Do the WHOLE job — surface any deliberate skip explicitly.

## 🎯 FIRST TASK THIS SESSION (do this before anything else)
**Set up the Cloudflare/support-SSH foundation so David's home (and every future home) is reachable
from Youval's Mac.** Right now David's box is at his house (LAN `192.168.1.171`) and is **completely
unreachable** from Youval's home — SSH times out (different LAN) and the remote app hostname doesn't
resolve. This one foundation unlocks *both* remote app access AND support SSH, for David and the
whole fleet. It is entirely doable remotely (no trip to David's) — see "Why remote works" below.

**The design is fully built** (`docs/RUNBOOK_SUPPORT_TUNNEL.md`, `scripts/linux/ziggy-support-access.sh`,
relay `support_session.py`) — the gap is that **the Cloudflare account/credentials were never wired**.
Confirmed gaps on the relay (via `flyctl secrets list -a ziggy-relay`):
- `CF_ZONE_ID` — **UNSET** (the `ziggy-home.com` zone; covers both `hubs.` and `ssh.` hostnames).
- `CF_API_TOKEN` — present but **Tunnel-only scope** (verified: `zones?name=ziggy-home.com` returns 0 —
  it can't list/edit DNS or Access). Tunnel creation works; DNS CNAME + Access app creation silently skip.
- `ZIGGY_SSH_INGRESS_ENABLED`, `ZIGGY_SUPPORT_ALLOWED_EMAILS` — **UNSET** (support SSH is opt-in + fail-closed).
- Cloudflare **Access IdP** (One-time PIN or Google) — unconfirmed; needed for `cloudflared login`.

**Steps (all from Youval's Mac + Cloudflare dashboard + Fly — nothing on David's box):**
1. Cloudflare dashboard → copy the **`ziggy-home.com` Zone ID**.
2. Mint a **new API token** scoped: *Zone→DNS→Edit* (ziggy-home.com) + *Account→Cloudflare Tunnel→Edit*
   + *Account→Access: Apps and Policies→Edit*.
3. Enable a CF **Access IdP** (One-time PIN is simplest).
4. `flyctl secrets set CF_ZONE_ID=… CF_API_TOKEN=<new> ZIGGY_SSH_INGRESS_ENABLED=1 ZIGGY_SUPPORT_ALLOWED_EMAILS=silentyouval@gmail.com -a ziggy-relay` (restarts relay ~30s — briefly blips Canary's remote; LAN unaffected).
5. On the Mac (one-time): `cloudflared login` (browser auth to the Ziggy CF Access team) +
   `ssh-keygen -t ed25519 -f ~/.ssh/ziggy_support -C "founder@ziggy"`.
6. **Re-provision David's home** (idempotent) → creates the app CNAME + SSH ingress + Access app:
   `POST https://ziggy-relay.fly.dev/api/provision/hub` (relay-admin JWT) body
   `{"home_id":"c7c965d3-034a-4e6e-a618-06b01198e294","home_name":"David's Home"}`.
7. Verify: `dig c7c965d3-034a-4e6e-a618-06b01198e294.hubs.ziggy-home.com` resolves; the app `/health`
   via that hostname = 200; relay proxy `GET /api/proxy/{home_id}/health` = 200.
8. **SSH into David's box** (Youval's key is already installed there — see Access below):
   `cloudflared access ssh --hostname ssh-c7c965d3-….ssh.ziggy-home.com --user ziggy -- -i ~/.ssh/id_ed25519`.
9. Then continue: fix David's automation-wizard bugs and finish his setup (below).

**Why remote works with no trip to David's:** (a) all the config is cloud-side (relay + CF); (b) David's
`cloudflared` uses **remotely-managed config** (its log shows "Updated to new configuration…"), so it
auto-pulls the new SSH ingress with no restart; (c) **Youval's SSH key is already in the box's
`ziggy` authorized_keys** (from today's `ssh-copy-id`). Only requirement: David's box stays powered +
online (it's his always-on hub).

---

## WHAT HAPPENED TODAY (2026-07-27)
Imaged **Ziggy_02 = David's Home** (Youval's brother) end to end — the first fleet expansion beyond Canary.
Youval drove to David's home; the whole imaging was run headless from Youval's Mac over SSH.

- **IMAGING COMPLETE (12/12), kit-ready PASS, first encrypted backup in Backblaze.** David's home is live
  in the relay: `HOME_ID=c7c965d3-034a-4e6e-a618-06b01198e294`, owner `davidpolacsek@gmail.com`. **Fleet of two.**
- **First-ever clean Zigbee-ON image on hardware** — SLZB-07/USB (CP210x), adapter `ezsp` (fallback not
  needed), coordinator IEEE `0x9035eafffe76b9c2` captured + sealed.
- **`nomodeset` is a REQUIRED install step on these HM35 mini PCs** — the AMD Radeon (Vega) black-screens the
  Ubuntu installer under `amdgpu`. At the GRUB "Try or Install" menu: press `e`, append `nomodeset` to the
  `linux …/casper/vmlinuz … quiet splash ---` line, `Ctrl+X`. Documented in the runbook (Part D step 2b) + memory.
- **Fixed 3 imaging bugs, pushed fleet-wide:**
  - `62ff218` — z2m default bumped 2.1.1→**2.12.1** (validated version) + **ezsp↔ember adapter auto-fallback**.
  - `9e2230b` — (1) `step_env` wrote `HOME_NAME` UNQUOTED → `HOME_NAME=David's Home`; the apostrophe broke every
    `source .env`, so kit-ready-check never loaded `HA_TOKEN` (false "HA_TOKEN not set"). Fix: quote it. (2)
    kit-ready-check ran on the HOST but used the CONTAINER's `HA_URL` (`host.docker.internal`) → HTTP 000. Fix:
    force `localhost`. Both surfaced only because David's home name has an apostrophe; Canary's didn't.
  - On David's box these two were also applied manually (quoted `HOME_NAME` in `.env`, patched
    `kit-ready-check.sh`) so it's slightly ahead of its imaged SHA — harmless; a future `git pull` aligns it.
- David **created his owner account** (PWA on his iPhone, LAN) and **paired 3 devices**. Set the Aqara motion
  `occupancy_timeout` to **60 s** live via z2m.

## FLEET STATE + ACCESS (SSH KEYS, CREDS, EVERYTHING)
| Home | ID / SHA | Reach | Notes |
|---|---|---|---|
| **Canary** (Youval's) | `10.100.102.15`, repo `/opt/ziggy` @ `5f8c77f` | `ssh ziggy@10.100.102.15` (key auth + passwordless sudo) **only from Youval's LAN 10.100.102.x**; remote via legacy `app.ziggy-home.com` | Youval's live home; z2m 2.12.1; healthy |
| **David's Ziggy_02** | `HOME_ID=c7c965d3-034a-4e6e-a618-06b01198e294` | LAN `192.168.1.171` (David's Wi-Fi, DHCP — may change; find via subnet scan + `hostname`=`ziggy-david`). **Unreachable from Youval's home until FIRST TASK done.** | see below |

**David's box specifics:**
- host `ziggy-david`, login user `ziggy`, mini-PC password **`ziggy-david`** (WEAK — set up key-only + retire it).
- **Youval's Mac key (`~/.ssh/id_ed25519.pub`) is already in the box's `ziggy` authorized_keys** (ssh-copy-id).
- **Passwordless sudo enabled** on the box (`/etc/sudoers.d/ziggy-nopasswd`).
- `cloudflared` running (container `ziggy-cloudflared`, `--restart unless-stopped`, connected; remotely-managed
  config → auto-updates). tunnel_id `c248eedb-cae6-4ea0-a9a8-94042cd3ad42`.
- Devices (3 physical): IKEA bulb `light.0x006ce4a4ffbe9c3d`; Aqara motion RTCGQ11LM `0x00158d008c7d308d`
  (occupancy_timeout=60s); Aqara temp/humidity/pressure `0x00158d008c80c9b0`. Still hex-named, partial rooms.
- Read live state (once reachable): `docker exec ziggy-ziggy-1 printenv HA_TOKEN|MQTT_URL|RELAY_SECRET`; call
  the app as David via relay-secret headers: `-H "X-Relay-Secret: $RELAY_SECRET" -H "X-Relay-User: davidpolacsek@gmail.com" -H "X-Relay-Role: super_admin" -H "X-Relay-Home: $HOME_ID"`.

**Secrets on Youval's Mac (`~/.ziggy/`, chmod 600):**
- `david-secrets.txt` — RELAY_ADMIN_EMAIL/PASSWORD (founder), MASTER_KEY_B64 (founder, fleet-wide), B2 key.
- `canary-secrets.txt` — same founder relay-admin + master key.
- `imaging-token.txt` — fleet GitHub imaging token (`github_pat_…`, fine-grained, Contents:Read on Ziggy_PC only).
- `david-tunnel-token.txt` — David's cloudflared connector token.

**Relay:** `ziggy-relay.fly.dev` (Fly, 1 machine, ams). `flyctl` authed as `youvalpolacsek@gmail.com`.
Relay-admin login: `POST /api/auth/login` with the founder creds → JWT. Architecture: `docs/ARCHITECTURE_RELAY.md`
(app → `app.ziggy-home.com/api/proxy/{home_id}/*` → relay → `{home_id}.hubs.ziggy-home.com` → cloudflared → hub:8001).

## OPEN BUGS
1. **Automation-creation wizard — 3 symptoms, likely ONE root cause** (fix + rebuild + OTA to David *after* FIRST
   TASK gives us access): trigger "when device changes" **device picker is empty**; "add condition" → **"something
   went wrong"**; "add action" → **does nothing**. `EntitySelect` reads `useDeviceStore(s=>s.entities)` (WS-fed);
   on David's hub device **state reads empty** (`/api/devices` returns devices but `state: —`), so the live
   device/entity list isn't populating → everything downstream on the empty list breaks. **Chase why live state
   isn't flowing into the store (WebSocket vs store) — that likely clears all three.**
2. **PWA/web onboarding wizard is native-ONLY** — `frontend/src/App.jsx` `UnauthenticatedGate` does
   `if (!native) return`, so browser/PWA always gets LoginPage→dashboard, never the guided `MobileOnboarding`
   wizard. **Every iPhone/PWA beta user misses onboarding** (iOS is PWA-only until the native app ships). Add a
   web onboarding path.
3. **`light.turn_on failed: 400`** seen in David's backend log — verify whether it's a real bulb-control bug when
   testing the IKEA light.
4. **`register-hub` failed (non-fatal)** — home stuck `status=awaiting_claim`; will be resolved by the re-provision
   in FIRST TASK.
5. **`ui_prefs` write error at first-run** (dir was missing before 21:34; exists now) — confirm imaging creates
   `user_files/ui_prefs/` so it can't recur.

## OTHER OPEN ITEMS / PRODUCTIZATION GAPS
- **Backup → wipe → restore DR drill** — never run on hardware; THE big remaining beta gate. Do on a spare bench
  box (not David's live home).
- **IR/Broadlink discovery** fix unvalidated on hardware; **Avatto (Tuya) blaster path not handled**.
- **Device advanced-settings UI** — expose z2m options (occupancy_timeout etc.) as Ziggy-language controls
  (`project_device_advanced_settings_ui`); today only settable via raw MQTT.
- **Harden David's box** — replace the weak `ziggy-david` password with key-only auth.
- Revoke the old GitHub token pasted in a past chat (we now use the dedicated fine-grained imaging token).

## IMAGING / RUNBOOK
- **Fleet imaging runbook: `docs/DAVID_ZIGGY_02_RUNBOOK.md`** (Zigbee-ON, owner-less handover, `nomodeset` step,
  single-Ethernet-cable note). Entry point `scripts/factory/ziggy-image-device.sh` (12 steps, resumable,
  `--dry-run`/`--resume`). Bootstrap `scripts/canary/hub-bootstrap.sh` pins branch **`feat/beta-image-readiness`**.
- **Branches:** `feat/unified-bundle-wizards` (active dev) and `feat/beta-image-readiness` (imaging) are BOTH at
  **`9e2230b`** now (imaging fixes on both). `main` is stale by design.
- Ops playbook skill: `provisioning-ziggy-hubs`. Support-SSH design: `docs/RUNBOOK_SUPPORT_TUNNEL.md`.

## READ FIRST (memory + docs)
Memory: `project_david_ziggy02_imaging` (this home, full detail + resume plan), `project_beta_image_readiness`,
`project_ziggy_kit_hardware` (HM35 + nomodeset), `project_device_advanced_settings_ui`, `reference_home_access`,
`reference_ziggy_container_networking`, `feedback_ziggy_product_surface`, `feedback_real_life_validation`,
`feedback_mobile_collab_style`. Docs: `docs/ARCHITECTURE_RELAY.md`, `docs/RUNBOOK_SUPPORT_TUNNEL.md`,
`docs/DAVID_ZIGGY_02_RUNBOOK.md`. Skill: `provisioning-ziggy-hubs`.

## START HERE
Do the **FIRST TASK** (Cloudflare/support-SSH foundation) with Youval at the CF dashboard, re-provision David's
home, confirm you can `cloudflared access ssh` into `192.168.1.171`'s box remotely — then use that access to fix
the automation-wizard bugs and finish David's device naming/rooms. Confirm each step on the real box.
