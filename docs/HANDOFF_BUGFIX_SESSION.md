# Ziggy — Bug-Fixing Session Handoff (2026-07-17)

Paste the block below into a fresh session to hand off fully. It is written for a
session whose job is to **fix the pile of bugs the operator found while setting up
his real home on the Canary hub.**

---

You're taking over Ziggy — a locally-hosted AI smart-home platform (FastAPI backend
+ React/Capacitor app + Home Assistant + MQTT + Zigbee + IR) being productized into
flashable beta mini-PC kits. **This session's job: systematically fix a list of bugs
I (the operator) hit while setting up my real home.** I'll paste the bugs; you
diagnose + fix them against the real running hub.

## FIRST, read these (durable context)
Memory files: `project_beta_image_readiness`, `project_kit_prepair_zigbee`,
`project_mobile_lan_adoption`, `project_hebrew_nativization`, `feedback_mobile_collab_style`,
`feedback_real_life_validation`, `feedback_ziggy_product_surface`, `project_ziggy_kit_hardware`,
`project_ac_prefer_smart_over_ir`, `user_hardware`.
Repo skill (READ IT — it's the ops playbook): `.claude/skills/provisioning-ziggy-hubs/SKILL.md`.
Docs: `docs/CANARY_REBUILD_RUNBOOK.md`, `docs/HANDOFF_NEXT_SESSION.md`, `CLAUDE.md`.

## HOW TO WORK WITH ME
I'm the operator / product owner, NOT an engineer. Dumb everything down, no jargon,
ONE step at a time, exact copy-paste commands, walk me click-by-click through any
account/hardware step. Only put `sudo` in a command when it's needed. Nothing "works"
until I test it on real hardware — tests earn the right to ask me to test, not to
declare success. For any bug: find the ROOT CAUSE before proposing a fix (use the
systematic-debugging skill); don't patch symptoms.

## I CAN DRIVE THE CANARY MYSELF (use this — don't make me copy-paste)
- SSH: `ssh ziggy@10.100.102.15` — **key auth is set up** (my Mac's key is in the hub's
  authorized_keys), so a headless agent can run `ssh ziggy@10.100.102.15 '<cmd>'` directly.
- **Passwordless sudo is enabled** on the hub (`/etc/sudoers.d/ziggy-nopasswd`; revocable).
- `ziggy` is in the `docker` group → run `docker …` **without sudo**.
- Read secrets from the **container env**, not the root-owned `/opt/ziggy/.env`:
  `docker exec ziggy-ziggy-1 printenv HA_TOKEN` / `printenv MQTT_URL`.
- Repo at `/opt/ziggy` is root-owned → `sudo git …`.
- **Anything that restarts the `ziggy`/HA container blips my live app (~20-40s); a
  `--build` is ~2-4 min. Confirm before doing it.** z2m/mosquitto restarts don't blip the app.

## THE RECURRING ROOT CAUSE (check this FIRST for any "can't reach the LAN / device
## not found / integration won't connect" bug)
The **ziggy backend runs in a BRIDGE-networked container** (HA is `network_mode: host`;
mosquitto/z2m are bridge on `ziggy_default`). So from the ziggy container:
- `localhost` ≠ the host. The broker is reachable only as `mosquitto:1883` (this already
  bit us: `MQTT_URL` was `@localhost`, fixed → `@mosquitto`).
- **UDP broadcast and "what's my subnet" both resolve to the Docker net (172.18.0.x), NOT
  the home LAN (10.100.102.0/24).** Unicast to a specific LAN IP DOES work (Docker NATs it).
This one pattern explains multiple bugs. When something "can't find" a LAN device,
suspect container networking before anything else.

## CURRENT STATE (all on branch `feat/beta-image-readiness`, pushed; NOT on main)
- The Canary = my real rebuilt home. HM35 mini PC, Ubuntu 24.04,
  `home_id=home-69856ab2ab19d473`, repo `/opt/ziggy` @ `8c1cdff`. App reaches it over
  HTTPS via `app.ziggy-home.com` (cloudflared on the box). Galaxy S24+ debug APK installed.
- **Zigbee is LIVE and validated at scale:** SLZB-07 over USB (CP210x, `ezsp`, fw 7.3.0.0),
  z2m bumped **2.1.1 → 2.12.1** (`Z2M_VERSION` in `.env`; `docker/z2m-data.bak-2026-07-17`
  backup exists). **17 real devices paired, 17/17 supported, named + room-assigned** (Aqara
  temp/motion, Tuya bulbs+plug, Gledopto bulbs, HOBEIAN soil, LUMI FP300 presence, SONOFF
  temps). HA MQTT integration was added by hand (config-flow REST) since the box was imaged
  Zigbee-off. Ziggy's in-app permit-join path works end to end.
- **ziggy image rebuilt** (`up -d --build`) → hide-backup entity filter live + latest web
  frontend shipped.
- Done earlier this arc (code, pushed): **B** onboarding-wizard-entry fix (fresh native
  homes route into the rich wizard + persist ziggy_token) — `019d94a`; **C** Zigbee-ON
  imaging path for pre-paired kits — `8c1cdff`; MQTT_URL host fix — `b4c44bc`; the ops
  skill — `1ce44ee`.

## OPEN THREADS (not this session unless a bug touches them)
- **IR / Broadlink discovery — ROOT-CAUSED, fix pending.** In-app "pair device → IR blaster"
  finds nothing because `services/ir_listener.py:discover_broadlink_devices` broadcasts +
  subnet-scans from the bridge container (wrong network). My **RM4 is at `10.100.102.27`**
  (mac `ec0bae6afc67`, devtype 25276); a host-network broadlink discover finds it fine, the
  ziggy container finds nothing. Fix direction: make discovery scan the real LAN /24 via
  unicast `hello` (pass the host LAN CIDR into the container via env, or run discovery in a
  host-net context). **Must also work for an Avatto IR blaster** — Avatto is likely Tuya
  (WiFi or Zigbee), a DIFFERENT integration path than Broadlink; get the exact model from me.
- Backup → wipe → restore drill on hardware (the big remaining beta gate).
- **Revoke the GitHub token I pasted in an old chat** + mint fresh (overdue security).
- D mobile multi-home (CapacitorHttp), E relay Phase 2b, F Hebrew DeviceControls labels,
  G store publishing — each its own session.

## GOTCHAS
- Android builds need JDK 21 (Android Studio JBR); JDK 25 breaks Gradle. Wireless ADB ports
  rotate — use a USB-C cable.
- To see the NEW onboarding wizard (B), a home must be owner-less (fresh image / customer
  reset) — the Canary already has my owner account, so it shows login, not the wizard.
- 8 backend tests fail pre-existing + unrelated (anomaly_engine, edge_health_router,
  mobile_router_audit_events) — don't chase them.

## START HERE
Ask me to paste my bug list, then for each bug: reproduce on the Canary, find the root
cause (suspect container-networking + the MQTT/HA/Zigbee wiring first), propose the fix,
and — since the Canary is my production home — confirm before any app-restarting change.
Batch the read-only diagnosis; be surgical with the changes.
