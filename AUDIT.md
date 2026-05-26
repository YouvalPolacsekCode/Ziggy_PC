# Ziggy Codebase Audit

**Audit date:** 2026-05-24
**Method:** Read-only inspection of all major modules. No code executed, no files modified, no `pytest` invoked. Where claims are inferred from code, they are noted as such; where code is unclear, that is stated explicitly.
**Scope:** Everything under `/Users/YouvalPolacsek/ziggy_pc` except `node_modules`, `.venv`, `.git`, `__pycache__`, `.pytest_cache`, `dist`, `build`, captured WAV training samples, and binary model files.

> **Founder confirmation required wherever an item is tagged `[?]`** — these are claims I could not verify from the code alone.

---

## Section 1 — Repository Map

```
ziggy_pc/                                  ~308 source files, 1.4 GB on disk
                                           (most weight is voice training data + Piper model)
│
├── README.md                              Project overview — accurate in spirit, stale on specifics
├── Claude.md                              Authoring guidance for me; same content as CLAUDE.md frontmatter
├── AGENTS.md                              Just an embedded copy of the GitNexus section from Claude.md
├── TODOS.md                               Live in-progress notes (Hebrew voice handlers, AI map render on hold)
├── Dockerfile                             Production image (frontend + backend)
├── docker-compose.yml                     Local dev stack (Ziggy + HA + Mosquitto)
├── requirements.txt                       Python deps for the hub (NOT pinned for most pkgs)
├── .env / .env.example                    .env is git-ignored, .env.example is in tree
├── .gitignore                             ⚠ Line 50 corrupt; fails to exclude config/settings.yaml
├── .dockerignore                          Minimal; excludes node_modules + frontend/dist
├── pytest.ini                             pytest configuration
│
├── backend/                               FastAPI application (the API server, port 8001)
│   ├── server.py                          App wiring; 29 routers; 2 ASGI middlewares; SPA static mount
│   ├── ws_manager.py                      WebSocket fan-out; per-client 0.5 s send timeout
│   ├── middleware/
│   │   ├── error_handler.py               Unified {error: {code, message, request_id}} envelope
│   │   ├── relay_auth.py                  Pure-ASGI; trusts X-Relay-Secret to inject a synthetic user
│   │   └── request_logger.py              Pure-ASGI; mints request_id, emits to debug_bus
│   └── routers/                           29 routers (README says 17 — stale)
│       │   intent_router, device_router (60 KB), ha_router, pairing_router, task_router,
│       │   automation_router, routine_router, event_router, capability_router,
│       │   virtual_device_router, ir_router (22 KB), suggestion_router, quick_ask_router,
│       │   status_router, auth_router, auth_deps, invite_router, map_router (22 KB),
│       │   admin_router (17 KB), activity_router, health_router (14 KB),
│       │   presence_router (30 KB), camera_router, push_router, debug_router,
│       │   update_router, ui_prefs_router, mobile_router
│
├── core/                                  Orchestration + intent dispatch
│   ├── ziggy_main.py                      Thread-spawner entry: Voice, Dashboard, MQTT, Reminder,
│   │                                      SensorAlerts, Ollama, PatternEngine, API, Vite
│   ├── intent_parser.py                   GPT-4o-mini tool-calling parser with Hebrew normalization,
│   │                                      fast-path regex, confidence gate
│   ├── action_parser.py                   Async dispatcher: merges HANDLERS dicts from 21 handler modules
│   ├── tools_schema.py                    55 KB — OpenAI function definitions (99 tools)
│   ├── session_manager.py                 Multi-channel sessions (voice + telegram), chat-mode whitelist
│   ├── conversation_context.py            Pronoun + bulk-undo memory (5 min TTL)
│   ├── memory.py                          Key/value memory backed by config/ziggy_memory.yaml
│   ├── automation_file.py                 JSON store for automation definitions
│   ├── task_file.py                       JSON store for tasks
│   ├── errors.py                          ZiggyError + ErrorCode taxonomy
│   ├── debug_bus.py                       Scoped/levelled event bus, WS-pushed
│   ├── logger_module.py                   Async-queue file logger + bus bridge
│   ├── settings_loader.py                 YAML + env-var overrides; supports CLOUD_MODE
│   ├── intent_utils.py / result_utils.py  Tiny helpers
│   ├── response_templates.py              Templated phrasing helpers
│   ├── shared_flags.py                    Process-wide flags (shutdown_event, mic mute)
│   ├── restart_ziggy.bat                  Windows restart shim
│   ├── handlers/                          20 intent handlers; ~105 intents total
│   │   │  light, climate, tv, ir, media, sensor, device,
│   │   │  task, file, memory, event, pattern, anomaly,
│   │   │  reference, system, web, comm, visual, chat, automation
│   │   └── __init__.py
│   └── scripts/                           Small ad-hoc HA helpers (get_ids.py, parsed_ha_ids.yaml)
│
├── services/                              The actual business logic layer — 65 modules
│   ├── home_automation.py     (28 KB)     HA REST+WS bridge, service caller, entity resolver
│   ├── ha_subscriber.py       (12 KB)     Persistent HA WebSocket + state cache + anomaly trigger
│   ├── ha_update_checker.py   (30 KB)     HA upgrade-risk analyzer (28 rules, GitHub release notes)
│   ├── ha_capabilities.py     (13 KB)     Service-catalog cache
│   ├── ha_automations.py      (19 KB)     HA-side automation CRUD wrapper
│   ├── ha_areas.py            (12 KB)     HA area registry interface
│   ├── ha_scripts.py          (10 KB)     HA script CRUD wrapper
│   ├── ha_flow_driver.py      (8 KB)      Driver for HA's config-flow wizard
│   ├── ha_pairing.py / ha_zha.py          HA pairing + ZHA helpers
│   ├── device_registry.py     (27 KB)     Entity-keyed registry persisted to JSON
│   ├── device_groups.py       (35 KB)     Multi-entity → physical-device collapse for UI
│   ├── capability_catalog.py  (18 KB)     Per-entity capability detection
│   ├── capability_matcher.py  (6 KB)      Capability → command matching
│   ├── domain_registry.py     (17 KB)     Domain → metadata catalog
│   ├── display_registry.py / target_resolver.py / room_alias_bank.py (14 KB)
│   ├── zones_registry.py / entity_filter.py / event_manager.py
│   ├── ir_listener.py         (30 KB)     Direct Broadlink RX (HA only TX), continuous capture
│   ├── ir_manager.py          (43 KB)     IR device CRUD, assumed-state, AC mode/temp memory, sequences
│   ├── ir_protocol.py         (40 KB)     Pulse parser, fingerprinter, fuzzy match, protocol decoders
│   ├── ir_unassigned.py / media_player_vendors.py
│   ├── automation_history.py / automation_templates.py (26 KB)
│   ├── local_automation_actions.py (35 KB)  Ziggy-side runtime for Ziggy-only automation steps
│   ├── manual_overrides.py / command_router.py
│   ├── anomaly_engine.py      (45 KB)     11 ANOM-XX rules, snooze SQLite, history SQLite, debounced
│   ├── state_memory.py        (3 KB)      Records device state for post-power-cycle restore
│   ├── pattern_detector.py    (32 KB)     Pattern candidate accumulator (time/sequence/group)
│   ├── pattern_logger.py      (10 KB)     Append-only event log feeding the detector
│   ├── suggestion_engine.py   (16 KB)     Pattern → Ollama-quality-gate → user-facing suggestion
│   ├── suggestion_manager.py  (10 KB)     Suggestion CRUD + rejection memory + caps
│   ├── presence_engine.py     (45 KB)     Multi-signal presence state machine (GPS + LAN + external)
│   ├── presence_side_effects.py / presence_store.py
│   ├── lan_presence.py        (7 KB)      ICMP/TCP reachability probe → engine
│   ├── ziggy_scheduler.py     (7 KB)      Minute-tick loop for time triggers + sweeps
│   ├── task_manager.py        (8 KB)      Task CRUD + polling reminder thread
│   ├── mobile_app.py          (11 KB)     Mobile pairing + webhook ingest (Phase-1 stubs)
│   ├── mobile_ws_manager.py   (5 KB)      Per-device WS registry separate from PWA /ws
│   ├── mobile_push.py         (7 KB)      APNs/FCM scaffolding (no creds wired)
│   ├── push_notify.py         (9 KB)      Web push via pywebpush + per-user preferences
│   ├── push_preferences.py / push_actions.py
│   ├── sensor_alerts.py       (7 KB)      Door/motion push-alert polling loop
│   ├── communication_manager.py (10 KB)   Multi-channel notify (Gmail/Telegram/SMS stubs)
│   ├── email_sender.py        (6 KB)      SMTP send + branded HTML wrapper for invites
│   ├── mqtt_client.py         (2 KB)      MQTT pub/sub (used when Zigbee enabled)
│   ├── system_tools.py        (5 KB)      Disk, IP, network diagnostics
│   ├── file_manager.py        (6 KB)      Local file ops backing file_handler intents
│   ├── web_manager.py         (16 KB)     Web search / news / recipe / stocks helpers
│   ├── media_manager.py       (19 KB)     Chromecast / media-player control
│   ├── virtual_devices.py     (4 KB)      User-defined virtual device events
│   ├── reference_manager.py / quick_ask_manager.py / debug_control.py / camera_utils.py
│   ├── map_renderer.py        (12 KB)     Geometry → base SVG + GPT-4o enrichment (on hold)
│   ├── switcher_account.py    (5 KB)      Switcher (water-heater) account validate/cache
│   └── switcher_pairing.py    (17 KB)     End-to-end Switcher pairing via HA's switcher_kis flow
│
├── interfaces/                            Process entry points other than the API
│   ├── voice_interface.py     (50 KB)     Wake-word → Whisper → intent → response → TTS
│   ├── dashboard.py           (3 KB)      Small Flask debug dashboard (optional)
│   └── __init__.py
│   ⚠ NO telegram_interface.py — README claims one exists; it does not.
│
├── integrations/
│   ├── ollama_client.py       Local Ollama HTTP client + auto-spawn `ollama serve`
│   └── openai_client.py       Thin singleton OpenAI client
│
├── frontend/                              React 18 + Vite 5 + Zustand + Tailwind + Konva PWA
│   ├── package.json / vite.config.js     PWA via vite-plugin-pwa with custom SW
│   ├── public/
│   │   ├── sw.js              (4 KB)      Custom SW — push notifications, NO fetch caching (by design)
│   │   ├── manifest.webmanifest
│   │   └── icons/
│   ├── src/
│   │   ├── App.jsx            (25 KB)     Routing, WS dispatch, push subscribe, presence pinging
│   │   ├── main.jsx / index.css (18 KB)
│   │   ├── pages/             29 pages (consumer + auth + mobile + /ops console)
│   │   ├── components/        device/, layout/, orb/, ui/ + 8 top-level wizards
│   │   ├── stores/            11 Zustand stores (auth, device, automation, ui, voice, chat,
│   │   │                      task, quickAsk, suggestion, camera, features)
│   │   ├── hooks/             useWebSocket, useApi, useNetworkStatus
│   │   └── lib/               api.js (655 L) + i18n + native + mobileApi + errors + logger + utils
│   └── user_files/, logs/                 Stray frontend-local runtime state (git-ignored)
│
├── relay/                                 Cloud-side FastAPI app deployed to Fly.io (Amsterdam)
│   ├── Dockerfile / fly.toml / docker-compose.yml / requirements.txt
│   └── app/
│       ├── main.py            App bootstrap + lifespan
│       ├── auth.py            JWT (HS256, 30-day) + HMAC-SHA256 password hash + role hierarchy
│       ├── database.py        aiosqlite — homes, users, invites tables
│       ├── provisioner.py     (11 KB) SSH+SFTP into Oracle ARM VM, Cloudflare Tunnel, docker compose up
│       └── routers/           auth, homes, invites, provision, proxy, presence
│
├── docker/
│   └── mosquitto.conf         Only file present. docker/home-template/ referenced in
│                              docker-compose.yml comment does NOT exist.
│
├── config/
│   ├── settings.yaml          ⚠ Contains live secrets + 20 session tokens. Tracked in git (see §6).
│   ├── ziggy_memory.yaml      Long-term KV memory for the assistant
│   └── contacts.yaml          Contact directory for comm handlers
│
├── user_files/                Per-installation runtime state (JSON, JSONL, SQLite)
│                              automation_history, automation_meta, device_registry, events,
│                              home_map.db, ir_devices, ir_unknown_signals, persons, push_subscriptions,
│                              vapid_keys, pattern_candidates, state_memory, suggestions, quick_asks,
│                              routine_meta, ui_prefs, update_history, zones, mobile_pair_codes,
│                              mock_anomalies, local_automation_actions, note_*.txt
│
├── memory/state/              Empty placeholder directory (just .gitkeep equivalents)
├── routines/                  Only sample_routine.py (49 bytes) — looks superseded by user_files state
├── scripts/                   setup_cloudflare_tunnel.sh, setup_gmail.py, backfill_evidence_summary.py,
│                              test_pattern_learning.py
├── tests/                     11 test files — see §3 for coverage analysis
├── docs/                      Sparse — home_assistant_automation*.yaml, ziggy_home_assistant_setup.md
├── design_handoff_ziggy_redesign/   Design system handover kit (HTML + CSS + design/)
├── oww_data/hey_ziggy/        Wake-word training data (positives/ + near_negatives/ WAVs)
├── piper_voices/              en_US-libritts_r-medium.onnx (75 MB). Hebrew Piper voice NOT present.
├── logs/                      Rotating ziggy.log + agent-emitted logs
│
├── ui/                        ⚠ EMPTY (only __pycache__) — likely superseded but needs confirmation
├── routers/                   ⚠ EMPTY (only __pycache__) — superseded by backend/routers/
├── utils/                     ⚠ Just a 250-byte helpers.py stub
│
├── backend_test.py / backend_system_test.py / backend_error_test.py   ⚠ ~24 KB of orphan integration
│                                                                       scripts at repo root; no
│                                                                       imports, not in tests/
├── microphone_test.py         ⚠ 0 bytes
├── room_final.html / room_review[1-4].html   ⚠ 5 HTML mockup iterations at repo root
├── room_review2.html
├── get_folders_structure.py   ⚠ Looks like one-off utility
├── x.mp3                      ⚠ 6.9 KB stray audio file
├── test_result.md             ⚠ Old QA artifact (7.5 KB)
├── generate_hey_ziggy_dataset.py   Synthetic wake-word dataset generator (Piper-driven)
├── record_hey_ziggy.py        Live wake-word recording
├── train_hey_ziggy.py         OWW training entry
└── validate_hebrew_intent.py  Hebrew intent regression harness (≥85% pass target)
```

### Sub-projects / how they relate
This is a **single-repo polyglot codebase** containing two FastAPI apps and one Vite/React SPA:

1. **The hub** — `backend/` + `core/` + `services/` + `interfaces/` + `integrations/` — runs on the mini-PC (or, in cloud mode, inside the per-home Oracle VM container). FastAPI on port 8001, serves the SPA from `frontend/dist/` when present.
2. **The frontend** — `frontend/` — Vite-built PWA. In dev, `ziggy_main.py` spawns `npm run dev` on port 3000 with a proxy to 8001. In production, the built `dist/` is mounted by the hub's FastAPI app.
3. **The relay** — `relay/` — independent FastAPI app deployed to Fly.io (`ziggy-relay` in `ams`). Provisions per-home docker stacks on an Oracle ARM VM via SSH; brokers `/api/proxy/{home_id}/...` traffic; manages the invite/onboarding/email flow.
4. **The mobile app** — referenced from `frontend/src/lib/native.js` + `mobileApi.js` + `MobileOnboarding.jsx`, but the actual Capacitor shell **lives in a separate repo** (`~/ziggy_mobile/`, per founder memory). This repo only contains the web side that runs inside that shell.

---

## Section 2 — Architecture as It Actually Is

### What runs on the mini-PC (or per-home cloud VM)
At minimum, one Python process started by `core/ziggy_main.py`. That process spawns the following daemon threads (driven by `settings.features.*` flags):

| Thread | Source | Always-on? | Purpose |
|---|---|---|---|
| `API` | `backend.server.start_api_server` → uvicorn | yes (if `web_interface.enabled`) | Serves all HTTP + WS on **:8001** |
| `Vite` | `npm run dev` subprocess | only when `web_interface.frontend_dev` | Dev SPA on **:3000** with proxy to 8001 |
| `Voice` | `interfaces.voice_interface.start_voice_interface` | only when `features.voice` AND an audio input device is present | Wake-word → STT → intent loop |
| `Reminder` | `services.task_manager.start_reminder_thread` | yes | 60 s poll of due reminders, push via web-push |
| `SensorAlerts` | `services.sensor_alerts.start_sensor_alerts` | when `sensor_alerts.enabled` | Polls door/motion sensors, fires push alerts |
| `MQTT` | `services.mqtt_client.start_mqtt` | when `features.zigbee_support` | MQTT pub/sub (Zigbee-adjacent helper) |
| `Ollama` | `integrations.ollama_client.ensure_server_running` | when pattern learning + llm_synthesis on | Spawns `ollama serve` if not running |
| `PatternEngine` | `services.suggestion_engine.start_pattern_scheduler` | when pattern learning enabled | Runs the pattern → suggestion pipeline |
| `Dashboard` | `interfaces.dashboard.start_dashboard` | when `debug.enable_dashboard` | Small auxiliary Flask debug page |

In addition, the FastAPI startup hook ([`backend/server.py:55-120`](backend/server.py#L55-L120)) spawns these `asyncio` tasks inside the API event loop:

- `reconcile_with_ha()` — periodic HA reconciliation
- `sync_rooms_to_ha()` — push Ziggy rooms back to HA areas
- `run_scheduler()` — the minute-tick scheduler
- `run_subscriber()` — long-lived HA WebSocket subscriber
- `_register_with_relay()` — POST `/api/homes/register-hub` to RELAY_URL with TUNNEL_URL + RELAY_SECRET
- `_start_ir_listener()` — Broadlink RX listener task(s), one per blaster host
- `_run_update_checker()` — one-off HA-update check at boot

Also alongside Ziggy on the same host (per `docker-compose.yml`):
- **Home Assistant** — `ghcr.io/home-assistant/home-assistant:stable`, host networking, port 8123
- **Mosquitto** — `eclipse-mosquitto:2` on port 1883

### What runs in the cloud
The **relay** at `https://ziggy-relay.fly.dev` (per `config/settings.yaml`). It hosts:
- The user-facing auth endpoints (`/api/auth/login`, register-via-invite, etc.)
- Home management endpoints (relay_admin only)
- The proxy: `/api/proxy/{home_id}/*` → forwards to that home's Cloudflare Tunnel URL with `X-Relay-Secret` + `X-Relay-User` + `X-Relay-Role` + `X-Relay-Home` headers
- An invite flow with SMTP email delivery
- A provisioning endpoint that SSHes into an Oracle ARM VM and runs `docker compose up -d` for a new home

The relay also doubles as the build host for the Ziggy hub Docker image (per `ZIGGY_IMAGE=registry.fly.io/ziggy-relay:ziggy-app` in the provisioner).

There is **no relay-side billing, OTA distribution, telemetry ingestion, or backup pipeline**. There IS a `status='suspended'` value the relay admin can set on a home — the proxy returns 403 for suspended homes — but no automation around it.

### What runs in the mobile app
This repo only contains the web side. The native shell (Capacitor) is a separate project. The web side, when running inside the shell, uses:
- `window.Capacitor.Plugins.Geolocation` for foreground location pings (presence)
- `@capacitor/preferences`-style storage abstraction (`frontend/src/lib/native.js`)
- A separate mobile auth flow: pair code (5 min TTL, 6-char alphanumeric) → device token (`zgy_mb_` prefixed, stored in Preferences)
- A separate WebSocket endpoint at `/api/mobile/ws` (server-side at [`backend/routers/mobile_router.py:186`](backend/routers/mobile_router.py#L186))
- A separate push channel: scaffolded APNs + FCM in `services/mobile_push.py`, but **no credentials are wired** — calls are no-ops today

The mobile-router on the server is explicitly Phase 1 — the WebSocket loop is ping/pong only; real fan-out to mobile clients is deferred.

### APIs / ports / sockets / message buses
| Surface | Port | Auth model | Notes |
|---|---|---|---|
| Hub REST + WS | **:8001** | Bearer token (32-hex session) for most routes; `X-Relay-Secret` header injects a synthetic user (`backend/middleware/relay_auth.py`) | 29 routers, single `/ws` endpoint, SPA fallback mount |
| Hub Vite dev | **:3000** | (none — dev only) | Proxies `/api`, `/presence`, `/ws` to 8001 |
| Home Assistant REST + WS | **:8123** | HA long-lived access token, currently kept in `config/settings.yaml` and `.env` | Token in tree expires `2072-06-09` — non-rotating |
| Mosquitto MQTT | **:1883** | Username/password (`ziggy` / `6584ypSB!` in `.env`) | Optional; only used when zigbee_support is on |
| Ollama | **:11434** | (none — localhost only) | Auto-spawned on demand |
| Relay | **:8080** (Fly maps 80/443 → 8080) | JWT (HS256, 30-day) | `/api/auth`, `/api/homes`, `/api/invites`, `/api/proxy/{home_id}/*` |
| Cloudflare Tunnel (per home) | n/a (outbound) | Tunnel-managed | One `*.cfargotunnel.com` URL per home, points at hub :8001 |

### Databases / stores
- **HA's own SQLite** (recorder, registry) — managed by HA itself
- **`user_files/home_map.db`** — Ziggy's own SQLite: tables `canvas_rooms`, `anomaly_snooze`, `anomaly_history`, `map_render`, `zone_occupancy`
- **`relay/data/relay.db`** on Fly volume — aiosqlite: `homes`, `users`, `invites`
- **JSON files in `user_files/`** — automation metadata, IR devices, persons, push subs, etc. (20+ files)
- **`config/settings.yaml`** — the single biggest piece of state. Contains creds + per-room mappings + per-user records
- **`config/ziggy_memory.yaml`** — long-term assistant memory (user name, dog name, etc.)
- **In-memory** — pattern candidates, anomaly per-entity timers, presence working state, IR listener state, debug-bus ring buffer (500 events). Anomaly timers in particular are NOT persisted — see Section 6.

### How Ziggy talks to HA
HA is run as a **Docker container with host networking** alongside the hub (per `docker-compose.yml`), not Supervised / Core / OS as a separate machine. Ziggy talks to HA via:
- **REST** (`services/home_automation.py`) — entity reads, service calls, area registry, history. URL+token loaded at module import from `settings.home_assistant.{url,token}` (env override `HA_URL`/`HA_TOKEN`). No token-refresh path.
- **WebSocket** (`services/ha_subscriber.py`) — persistent subscription to `state_changed` plus area/device/entity registry diffs. Maintains `state_cache` and `active_anomalies` in-process. Exponential backoff reconnect (2/4/8/…/60 s).
- **Direct device protocol** for Broadlink IR — `services/ir_listener.py` opens UDP/TCP directly to the blaster IP (`python-broadlink`) for the RX pipeline because HA's Broadlink integration is TX-only.

### Where Zigbee / SMLIGHT fits
There is **no SMLIGHT-specific code** in the repo. Zigbee integration is delegated to HA's own ZHA stack — `services/ha_zha.py` (2.5 KB) is a thin helper around HA ZHA admin commands. `requirements.txt` lists `zigpy`/`bellows`/`zigpy-znp`/`zha-quirks` but Ziggy itself does not run a Zigbee coordinator — those packages are present so that Zigbee data structures could be parsed if needed. The MQTT thread is generic MQTT, not Zigbee2MQTT-specific. `[?]` Founder confirmation: is direct Ziggy-side Zigbee planned, or is HA-via-ZHA the permanent design?

### Where voice fits
- The voice loop runs as its own daemon thread (`Voice`) spawned by `ziggy_main.py` only when an audio input device is detected
- Wake-word: OpenWakeWord (default) or Porcupine. Settings say `wakeword_model: hey_mycroft` but the founder's memory notes the intended name is "Hey Ziggy" — see Section 6
- STT: faster-whisper running locally with the Hebrew model `ivrit-ai/whisper-large-v3-turbo-ct2`; falls back to OpenAI's Whisper API if local fails
- Intent: same `quick_parse` → `_parse_with_tools` pipeline used by the web `/api/intent` endpoint
- Response: localized via instant regex patterns first, then Ollama (local), then OpenAI translation API
- TTS: Piper (default, local) or Azure Cognitive Services. **Hebrew Piper voice is not present on disk** — Hebrew TTS only works with Azure

---

### Data flow 1 — Motion sensor triggers a light
The trail goes cold on the most natural interpretation: a Ziggy-owned motion→light automation. Here is what I can verify from the code:

**Path A — HA-native automation (most common today):**
1. Zigbee motion sensor reports state to its coordinator, which feeds HA's recorder, which fires HA's WebSocket `state_changed` event.
2. The HA-side automation (created via Ziggy's `automation_handler.py` or imported manually) sees the trigger inside HA and calls `light.turn_on`.
3. HA executes the service call against the light — Ziggy is not in the path.
4. HA fires another `state_changed` for the light.
5. Ziggy's `ha_subscriber.py` receives that event, updates `state_cache`, and broadcasts it on `/ws`.
6. The PWA's `App.jsx` WS handler ([App.jsx:166-193](frontend/src/App.jsx#L166-L193)) dispatches `updateEntityState()` into `deviceStore`, which re-renders the device tile.

**Path B — Ziggy-side automation (`services/local_automation_actions.py`):**
1. `state_changed` event arrives at `ha_subscriber.py`.
2. ha_subscriber routes the event into `anomaly_engine.evaluate()` (always) and into automation triggering paths (per `local_automation_actions.py`, which has both HA-trigger and Ziggy-trigger action chains).
3. If a Ziggy-side automation matches, `execute_ziggy_actions()` is queued as a FastAPI BackgroundTask. It executes each step (delay, ir_command, call_service, notify, speak, …) sequentially. The `manual_overrides.py` gate is consulted per step.
4. Same WS broadcast → PWA update.

`[?]` I cannot tell from the code whether Path B is the canonical path for motion→light today or only for routines/scripts that HA's engine cannot express. The README treats them as interchangeable; the `automation_router` shapes new automations in HA's schema by default.

### Data flow 2 — A user issues a voice command from the app
The clearest end-to-end flow in the codebase.

1. **Capture** — AIChat page records audio via `MediaRecorder` (`frontend/src/stores/voiceStore.js`) and posts to `POST /api/voice/transcribe` or `POST /api/voice` (full pipeline) with the user's bearer token.
2. **Auth + logging** — `RequestLoggerMiddleware` ([backend/middleware/request_logger.py](backend/middleware/request_logger.py)) mints a `request_id`. `get_current_user` validates the token against the user records in `settings.yaml`. Rate-limit check (30 voice requests / 60 s per client) in [intent_router.py:26-61](backend/routers/intent_router.py#L26-L61).
3. **Transcribe** — multipart audio written to a temp file, transcribed via OpenAI Whisper API (per the agent audit; local Whisper is the voice-thread path, not the web path).
4. **Parse** — `core/intent_parser.quick_parse(text, chat_history)`:
   - Fast-path regex first (time, date, "good night" → `turn_off_everything`, etc.)
   - Hebrew normalization: rooms (`_normalize_hebrew_rooms`) + devices/actions (`_normalize_hebrew_devices`) replace HE strings with EN equivalents before the GPT call
   - Augments system prompt with live device map (`device_registry.get_rooms_by_device_type`), live IR context (`ir_manager.build_ir_context_hint`), and conversation context (`conversation_context.build_context_hint`)
   - Calls GPT-4o-mini with `tools_schema.TOOLS` (99 tools) and `parallel_tool_calls=True`
   - **Confidence gate** (`_MUTATION_INTENTS` + `_has_action_vocab`): if GPT picks a mutating intent but the raw text has no recognisable action verb, downgrade to `unrecognized_command`. Bypassed when chat history exists.
5. **Dispatch** — `core/action_parser.handle_intent(intent_result)`:
   - For `__multi__`, recurse over each sub-intent
   - Look up handler in `_ALL_HANDLERS`; emit `intent_received` + `intent_params` to debug_bus
   - Call `await handler(params, source=…)`; emit `intent_result` with duration
   - `_log_event_safe()` posts the executed intent to the `services/pattern_logger` event log
6. **Execute** — handler reaches into the appropriate service. E.g. `light_handler.toggle_light` → `home_automation.call_service('light', 'turn_on', {entity_id})` → HA REST.
7. **Respond** — handler returns `{ok, message}`. The intent_router returns the JSON envelope to the PWA, which renders the assistant turn and optionally TTSes it via Azure if configured.
8. **Side effects** — HA fires its own `state_changed`, which `ha_subscriber.py` ingests and broadcasts on `/ws` for live tile updates. `App.jsx`'s WS handler may also display a toast on `command_failed`, `execution_result`, `ir_command_detected`, etc.

### Data flow 3 — User opens the app and views the dashboard
1. **Boot** — PWA loads index.html → `main.jsx` → `App.jsx`. If `window.location.pathname.startsWith('/invite/')`, renders `AcceptInvite` without auth. Otherwise checks `authStore.authenticated` (token in localStorage).
2. **Login** — if unauthenticated, `<LoginPage />`. On submit, `POST /api/auth/login` against the hub. On success, token + role go into `authStore` (persisted to localStorage as `ziggy_token` / `ziggy_role`).
3. **Bootstrap fetches** — once authenticated, App.jsx kicks off:
   - `getAuthStatus()` → refresh role
   - `getGeneralSettings()` → hydrate i18n language
   - `useDeviceStore.getState().syncUiPrefsFromServer()` → pull pinned shortcuts/quick-controls
   - `useFeaturesStore.getState().fetch()` → feature flags
4. **WebSocket** — `useWebSocket` opens `/ws` (proxied through Vite in dev, direct in prod). On connect → `App.jsx` re-fetches everything (force=true) so any updates that happened while disconnected are picked up.
5. **Push subscription** — first-time only: registers `public/sw.js`, requests `Notification.permission`, fetches VAPID public key, subscribes, posts subscription to `POST /api/push/subscribe`.
6. **Presence pinging** — `App.jsx` starts a `geolocation.watchPosition` (PWA) OR `Capacitor.Plugins.Geolocation.watchPosition` (native shell) and POSTs to `/api/presence/ping` every 2 minutes (and on each new fix) using a per-person token.
7. **Render Dashboard** — `Dashboard.jsx` (eagerly loaded; everything else is lazy) reads `deviceStore`, `automationStore`, `cameraStore`, `suggestionStore`, plus the activity/anomaly endpoints, and composes the home view.
8. **Live updates** — every `state_changed` WS message updates `deviceStore` per-entity. Motion `binary_sensor` events with `device_class=motion` also feed `cameraStore`'s motion log. `ir_command_detected` events update IR device assumed state and toast.

Notable: the PWA performs **no offline caching** by design — the custom `sw.js` intentionally has no `fetch` handler (it would otherwise serve stale index.html with deleted bundle hashes). If the hub is unreachable the PWA is a blank page after the cached HTML loads.

---

## Section 3 — Component Inventory

### Ziggy edge agent core (orchestration)
- **What it does** — Loads `settings.yaml` (+ env overrides), spawns the daemon threads listed in §2, hooks SIGTERM into a `shutdown_event`, then sleeps the main thread emitting a heartbeat every 60 s.
- **Quality** — Production-ready.
- **Files** — `core/ziggy_main.py`, `core/settings_loader.py`, `core/shared_flags.py`, `core/logger_module.py`.
- **Depends on** — every other subsystem; `python-dotenv`, `pyyaml`, `psutil`, `sounddevice` (probe only).
- **Risks** — `_has_audio_input_device()` calls `sounddevice.query_devices()` which can hang on some Linux/ALSA stacks. Threads are daemon=True so the parent process exits cleanly, but the Vite subprocess gets its own kill thread (good — port 3000 would otherwise leak).

### Ziggy backend (HTTP/WS layer)
- **What it does** — FastAPI app on :8001. Wires 29 routers; installs a unified error-envelope handler (`backend/middleware/error_handler.py`); runs two pure-ASGI middlewares (relay auth + request logger); mounts the built SPA from `frontend/dist/` if present.
- **Quality** — Production-ready overall. The error-envelope plumbing is excellent: every error becomes `{error: {code, message, request_id, [details]}}` with `details` only exposed for admin + `X-Ziggy-Debug: 1`.
- **Files** — `backend/server.py`, `backend/ws_manager.py`, `backend/middleware/*.py`, `backend/routers/*.py`.
- **Depends on** — `fastapi`, `uvicorn`, `httpx`, `pydantic`, `pywebpush`; everything in `core/` and `services/`.
- **Risks** —
  - `device_router.py` is 60 KB and directly mutates `settings.yaml` on device/room delete (`save_settings()` at lines 438, 461, 908). Read-modify-write of a YAML file containing live secrets — concurrent calls can race.
  - `GET /api/debug/registry` in `device_router.py` lacks an explicit `Depends(get_current_user)` parameter (per the routers agent's reading). Confirm.
  - `POST /api/ha/service` in `ha_router.py` accepts arbitrary `domain.service` pairs — any logged-in user can call `homeassistant.restart` or `shell_command.*`. **No domain whitelist.**
  - `CORS allow_origins=["*"]` (with `allow_credentials=False`). Acceptable but worth noting given the relay proxy headers some routes trust.

### Home Assistant integration layer
- **What it does** — Stable REST + WS bridge, capability catalog, area/script/automation CRUD wrappers, ZHA hooks.
- **Quality** — Production-ready. `home_automation.py` uses pooled httpx (10/20), 300 s entity-resolution cache, WS-cache fallback for fast state reads. `ha_subscriber.py` reconnects with proper backoff and seeds `state_cache` before declaring connected (small race noted by the agent).
- **Files** — `services/home_automation.py`, `services/ha_subscriber.py`, `services/ha_capabilities.py`, `services/ha_areas.py`, `services/ha_automations.py`, `services/ha_scripts.py`, `services/ha_flow_driver.py`, `services/ha_pairing.py`, `services/ha_zha.py`, `services/ha_update_checker.py`, `services/entity_filter.py`, `services/device_registry.py`, `services/device_groups.py`, `services/capability_catalog.py`, `services/capability_matcher.py`, `services/domain_registry.py`, `services/target_resolver.py`.
- **Depends on** — `httpx`, `websockets`, HA itself.
- **Risks** —
  - HA token is read at module import time. **Token rotation needs a process restart.**
  - `device_registry.py` keys by `entity_id`, not by physical device — works, but has no native "this entity and that entity are the same physical device" understanding. That's left to `device_groups.py` (35 KB), which collapses entities by HA `device_id`.
  - `device_groups.py` spawns a worker thread to `asyncio.run()` the HA-WS registry fetch from sync callers; concurrent sync callers can pile up on `t.join(timeout=8.0)`.
  - `ir_listener.py` Phase-2 protocol decode for Tadiran/Gree: when present, long-frame AC packets bypass fuzzy match. If the Phase-2 decoder is incomplete for a given model, long captures silently drop. The recent commits on the branch (`fix(ir): Tadiran short packets carry state, not commands — decode them as state`) suggest this is actively being hardened.

### Voice pipeline (STT / intent / TTS)
- **What it does** — Wake-word detection → audio capture → transcribe → intent parse → handler execute → response → TTS. Same `quick_parse` and `action_parser` reused from the web path.
- **Quality** — Functional-but-monolithic. 1146 lines in one file (`interfaces/voice_interface.py`) mixing model loading, audio capture, regex Hebrew patterns, TTS dispatch, and session loops.
- **Files** — `interfaces/voice_interface.py`, `core/intent_parser.py`, `core/action_parser.py`, `core/handlers/chat_handler.py`, `oww_data/hey_ziggy/`, `piper_voices/`, training scripts at repo root.
- **Depends on** — `faster-whisper`, `SpeechRecognition`, `pyaudio`, `sounddevice`, `pvporcupine`, `onnxruntime`, `openwakeword`, optional `azure-cognitiveservices-speech`, optional `ollama`, `openai`.
- **Risks** —
  - Wake-word model name is `hey_mycroft` in settings — the founder memory says "Hey Ziggy" is the intended replacement. The training dataset directory `oww_data/hey_ziggy/` contains 152 positives + 62 near-negatives WAVs but **no compiled ONNX model is visible** for "hey_ziggy". `[?]`
  - Hebrew Piper voice is not present. Hebrew TTS requires Azure key — which is currently in `config/settings.yaml` (see §6).
  - Per-`tts_engine: azure`, TTS is "on" by default. The founder's mobile direction is "push-to-talk + on-screen response, no TTS." `[?]` — is current TTS intentional or vestigial?

### Admin dashboard
- **What it does** — Two distinct surfaces in `frontend/src/pages/`:
  - **AdminSettings** (consumer) — HA settings, push config, integrations, debug toggles. Talks to `admin_router.py`.
  - **AdminConsole + /ops sub-routes** (super_admin only) — `CloudAdmin` (manages relay homes), `DebugPage` (live event stream + request tracing), `HAUpdate` (changelog + dismiss), `FeatureFlags`, `AdminConsole` (users + invites).
- **Quality** — Comprehensive but very large. `AdminSettings.jsx` 709 L, `DebugPage.jsx` 768 L. The cloud-admin surface exists and is wired to relay endpoints (`relayRequest()` path in `lib/api.js`).
- **Risks** — `admin_router.py` PATCH endpoints write straight into `settings.yaml` without validation (empty token/empty API key both accepted); secrets returned masked but masked tokens still leak the last 4 chars. No mutation audit log.

### User and account handling
- **Hub side** — `auth_router.py` + `invite_router.py`. Multi-user table inside `settings.yaml`. Bearer tokens (`secrets.token_hex(32)`) per user, kept as a list under `session_tokens` (capped at 20). Roles: guest/user/admin/super_admin. `auth_deps.find_user_by_token` uses `hmac.compare_digest`. Initial super_admin can be bootstrapped via `INITIAL_ADMIN_EMAIL`/`INITIAL_ADMIN_PASSWORD` env vars at first boot.
- **Relay side** — `relay/app/auth.py`. JWT (HS256, 30-day expiry, secret defaults to a fresh random 32 bytes if `JWT_SECRET` not set). Passwords hashed with **HMAC-SHA256 + 16-byte salt** — *not* a password KDF; the relay `requirements.txt` lists `passlib[bcrypt]` but the code uses HMAC-SHA256.
- **Quality** — Functional. Multi-session tokens on the hub work. Invite flow is real (token TTL 72h).
- **Risks** —
  - Session tokens stored in plain in `settings.yaml`. If the file is read by anyone (which it is — see §6), all live sessions are compromised.
  - Relay passwords are HMAC-SHA256, not bcrypt/argon2. Fast hash = brute-forceable if the DB ever leaks.
  - No email verification on hub-side signup (only the invite path requires possession of the invite token).
  - Login fallback when `users` is empty silently returns a super_admin token (`auth_router.py:142-144`).

### Device pairing flow
- **Frontend** — `PairingWizard.jsx` (824 L) — multi-protocol picker (ZHA, Z-Wave, Matter, Switcher); `SwitcherPairingFlow.jsx` (541 L) drives the Switcher-specific step machine.
- **Backend** — `pairing_router.py` + `services/ha_pairing.py` + `services/switcher_pairing.py` + `services/switcher_account.py`.
- **Quality** — Switcher flow is the most complete (account validate-and-cache, port collision diagnosis, auto-fill credentials, refresh device registry on success). Z-Wave and Matter UIs are conservative ("unsupported" branches).
- **Risks** — Tight coupling to HA's `switcher_kis` flow shape; no automated test.

### Sensor management & state tracking
- **What it does** — `device_registry.py` is the canonical entity list. `ha_subscriber.state_cache` is the live state. `sensor_alerts.py` polls sensors from `settings.sensor_alerts.sensors` every 20 s and fires push notifications on change.
- **Quality** — Production-ready for the basic loop.
- **Risks** — Settings list is hand-maintained — there's no UI loop that re-discovers sensors. Cooldown is in-memory only.

### Automation engine / rules layer
- **HA-side** — `automation_router.py` + `services/ha_automations.py` shape HA's YAML automations.
- **Ziggy-side** — `services/local_automation_actions.py` (35 KB) runs Ziggy-only action steps as FastAPI BackgroundTasks. Step types include `ziggy_intent`, `ir_command`, `call_service`, `device`, `delay`, `notify`, `send_intent`, `message`, `automation` (nested!), `wait_for_state`, `speak`, `notify_actionable`, `device_command`. Conditions gate the whole chain; manual-override gate is consulted per step.
- **Templates** — `services/automation_templates.py` (26 KB) provides pre-baked automation templates the chat handler can fill in.
- **Quality** — Functional-but-rough. The dual path exists by design but the boundary isn't crisp.
- **Risks** —
  - Duplicate-trigger gate is global — legitimate rapid-fire time triggers may be debounced away.
  - Snooze timestamps are ISO strings — no UTC enforcement.
  - Nested `automation` steps: no visible infinite-loop guard beyond the duplicate-trigger gate.
  - IR action failures don't retry; partial sequence side-effects can leave the device in an unintended state.

### IR handling (Broadlink)
- **What it does** — Three big modules: `ir_listener.py` (RX), `ir_manager.py` (device CRUD + dispatch + assumed state), `ir_protocol.py` (pulse parsing + fingerprint + decoders). HA only does TX; the RX listener talks Broadlink protocol directly so physical-remote presses can be detected in real time. Backed by `user_files/ir_devices.json` and `user_files/ir_unknown_signals.jsonl`.
- **Quality** — Production-ready for fingerprint-cascade matching (Phase 1 — confirmed working on the user's RM4 per founder memory). Phase 2 protocol decoders (NEC, Sony, Samsung, LG, Mitsubishi, Daikin, Tadiran/Gree) are partial. Recent commits address Tadiran short-packet handling.
- **Risks** —
  - `ir_listener._discovery_lock` is declared `Optional[asyncio.Lock] = None` and the code references it as if guaranteed-non-None (per the services-A agent's reading). Confirm whether there's a guarded initialization path elsewhere.
  - Custom command IDs normalize over-permissively (`test_cmd!@#$` → `test_cmd`) — silent collisions possible.
  - AC state memory defaults are hardcoded (cool, 22 °C) — no per-device calibration.

### Cloud-side code
- **What's there** — `relay/` is a real, deployed FastAPI service (Fly.io, `ziggy-relay`, Amsterdam region, 512 MB / 1 shared CPU, soft limit 100 / hard 200 connections). It does:
  - Auth (login, register-via-invite, role gating)
  - Home registry (`POST /api/homes/register-hub` is **public**; relies on possession of the home's `relay_secret` to authorize the update)
  - Invite + email delivery (SMTP)
  - Proxy: `/api/proxy/{home_id}/*` forwards to the home's Cloudflare Tunnel URL with `X-Relay-*` headers; user JWT must satisfy `home_id` match OR `role == relay_admin`.
  - Provision: `POST /api/provision/home` (relay_admin) → background task that SSHes into Oracle ARM VM, creates a Cloudflare Tunnel via API, writes a docker-compose stack, and `docker compose up -d`.
- **What is NOT there** — no billing, no usage telemetry, no OTA artefact distribution, no backups, no scheduled health monitoring of homes beyond on-demand health checks. The hub container is pulled from `registry.fly.io/ziggy-relay:ziggy-app` — updates are *image-tag* updates, not feature-flagged rolling deployments.
- **Risks** —
  - `POST /api/homes/register-hub` is public — possession of `(home_id, relay_secret)` lets you overwrite that home's `tunnel_url`. If the secret leaks, an attacker can point the relay at their own server, and subsequent health checks send `X-Relay-Secret` to that server.
  - `GET /api/homes/{home_id}/health` (per the cloud agent's reading) lacks the same ownership check that the standard `get_home` route enforces — a logged-in user could poll the tunnel_url of any home. `[?]` Confirm.
  - Password hashing is HMAC-SHA256 (see §3 "User and account handling").
  - Provisioner SSH key is parsed by replacing `\n` literals — fragile to env-var serialization variance.
  - `docker login` passes the Fly registry token as a CLI argument — visible in `ps`.
  - On partial provisioner failure, the Cloudflare tunnel cleanup is best-effort and may leak orphan tunnels.

### Remote access / relay code
Covered above. The hub registers itself with the relay 2 s after FastAPI startup; thereafter the relay's proxy delivers user traffic. There is **no WireGuard** anywhere in the repo (the Gap Analysis prompt asks about WireGuard — it is not present today; Cloudflare Tunnel fills the role).

### OTA / update mechanism
- **HA side** — `services/ha_update_checker.py` (30 KB) is a *risk analyzer*, not an updater. 28 rules cover ZHA, MQTT, Z-Wave, climate, light, media, scripts, automations, scenes, persons, todo, fans, covers, template, YAML config. Score 0/2/5/8 → safe/low/medium/high. Cached 1 h. **Does not install** updates — just surfaces them to the operator. History in `user_files/update_history.json`.
- **Ziggy side** — no in-app OTA. Updates require a new image pull + container restart (or pulling the source on bare-metal hubs).
- **Mobile** — not in this repo.

### Backup mechanism
Not present. There is no scheduled snapshot of `user_files/`, `config/`, `home_map.db`, or the relay DB. No per-user encrypted backups, no remote backup target.

### Subscription / billing / paywall
Not present. The relay schema has no billing tables. The hub has no entitlement checks. `status='suspended'` on a home is the closest thing to a kill switch.

### Onboarding / first-boot
- **Hub** — `_bootstrap_cloud_admin()` in `backend/server.py` reads `INITIAL_ADMIN_EMAIL`/`INITIAL_ADMIN_PASSWORD` env vars on each startup and adds the user if the username is not already present. The first manual super_admin must be created via `POST /api/auth/setup` (no-auth) or via that env-var path.
- **Mobile** — `MobileOnboarding.jsx` consumes a pair code (`mobile_router.py`) and stores a device token. PWA push subscription happens automatically after login.
- **Cloud home** — the relay's `POST /api/provision/home` is the closest thing; it creates the hub, then the new owner accepts the home invite and registers, after which their JWT proxies through to the hub.

### Logging / telemetry / error reporting
- **Local logging** — `core/logger_module.py` uses a `QueueListener` + `TimedRotatingFileHandler` (daily rotation, 7-day retention) in `logs/ziggy.log`. Log level slaved to the in-app debug bus level (`off`/`basic`/`verbose`/`trace`).
- **Debug bus** — `core/debug_bus.py` is a 500-event ring buffer with scopes, levels, and live WS push (`debug_event` messages). Sensitive keys (token, password, api_key, secret, …) are masked in event payloads. The frontend's `DebugPage` consumes this.
- **Frontend logging** — `frontend/src/lib/logger.js` POSTs sanitized frontend events to a `/debug/frontend-event` endpoint (per the frontend agent).
- **No remote crash reporting** — no Sentry / Bugsnag / Rollbar. Errors live and die in the local log + ring buffer + (optionally) the admin UI.

---

## Section 4 — Dependencies & Versions

### Hub Python — `requirements.txt`
**Pinned (good):** `playsound==1.2.2`, `pywebpush>=2.0.0`, `pytest>=8.0`, `pytest-asyncio>=0.23`.
**Floating (>= constraint, no upper bound):** `openai>=1.0.0`, `fastapi>=0.100.0`, `uvicorn[standard]>=0.23.0`, `aiofiles>=23.0.0`, `python-multipart>=0.0.6`, `websockets>=11.0`, `aiosqlite>=0.19.0`, `broadlink>=0.18.0`, `aioswitcher>=6.0`, `ddgs>=0.1.0`, `feedparser>=6.0.11`, `recipe-scrapers>=14.55.0`, `trafilatura>=1.9.0`, `requests>=2.32.3`, `yfinance>=0.2.40`, `spotipy>=2.24.0`, `google-api-python-client>=2.136.0`, `google-auth-httplib2>=0.2.0`, `google-auth-oauthlib>=1.2.0`.
**Fully unpinned:** `faster-whisper`, `SpeechRecognition`, `pyaudio`, `langdetect`, `gTTS`, `pvporcupine`, `sounddevice`, `onnxruntime`, `openwakeword`, `Flask`, `psutil`, `watchdog`, `pyyaml`, `python-dotenv`, `pytz`, `dateparser`, `paho-mqtt`, `zigpy`, `bellows`, `zigpy-znp`, `zha-quirks`, `RPi.GPIO`, `gpiozero`, `ffmpeg-python`, `python-docx`, `python-pptx`, `openpyxl`, `reportlab`, `dotenv`, `PyYAML` (duplicate), `numpy`.

**Discrepancy with the Dockerfile.** The Dockerfile pins a slightly different set inline:
```
pip install --no-cache-dir fastapi uvicorn pydantic aiofiles \
    paho-mqtt requests websockets httpx PyYAML python-multipart \
    openai anthropic feedparser trafilatura yfinance python-dotenv \
    2>/dev/null || pip install --no-cache-dir -r requirements.txt 2>/dev/null || true
```
**Three concrete problems with that line:**
1. `anthropic` and `httpx` are installed in the Docker image but are **not in `requirements.txt`**. Anywhere in the code that imports `anthropic` only works inside the image, not in a clean `pip install -r requirements.txt` checkout.
2. `2>/dev/null || ... || true` swallows pip failures. **The container can ship without its dependencies and still start.**
3. The inline list omits voice deps (`faster-whisper`, `openwakeword`, `pvporcupine`, etc.), so the cloud image cannot run the voice loop — consistent with `ziggy_main` skipping the Voice thread when no audio device is present.

**Missing per TODOS.md:** `python-bidi` is imported optionally for `fix_hebrew_direction` but not in `requirements.txt`.

### Relay Python — `relay/requirements.txt`
All pinned (good):
```
fastapi==0.115.0, uvicorn[standard]==0.30.6, aiosqlite==0.20.0,
PyJWT==2.9.0, httpx==0.27.2, python-multipart==0.0.12,
python-dotenv==1.0.1, docker==7.1.0, passlib[bcrypt]==1.7.4,
asyncssh==2.17.0
```
Note that `passlib[bcrypt]` is installed but `relay/app/auth.py` uses HMAC-SHA256 instead.

### Frontend — `frontend/package.json`
Pinned with `^` caret semver (typical for SPAs):
```
@radix-ui/react-dialog ^1.1.2, @radix-ui/react-slider ^1.2.1,
@radix-ui/react-switch ^1.1.1, clsx ^2.1.1, framer-motion ^11.11.0,
konva ^9.3.16, lucide-react ^0.454.0, qrcode ^1.5.4,
react ^18.3.1, react-dom ^18.3.1, react-konva ^18.2.10,
react-router-dom ^6.27.0, tailwind-merge ^2.5.4, zustand ^5.0.0
```
**Dev deps:** Vite 5, vite-plugin-pwa 0.20.5, vitest 2, Tailwind 3.4, @vitejs/plugin-react 4.3, jsdom 25, @testing-library/jest-dom 6.6.
**Stack health:** Modern, evergreen. No abandoned packages.

### System services
- `eclipse-mosquitto:2` (Docker)
- `ghcr.io/home-assistant/home-assistant:stable` (Docker, host networking) — **floating `stable` tag**, which is exactly what the HA update checker exists to manage
- `cloudflare/cloudflared:latest` (per the relay's provisioner) — also floating
- The hub itself: `registry.fly.io/ziggy-relay:ziggy-app` (per provisioner)
- Ollama (optional, auto-spawned by the hub) — version unconstrained

### HA version targeted
The `docker-compose.yml` pulls `stable`. Settings include a long-lived HA token issued 2025-09-07 with `exp` 2073-06-09 — so the operational target is "whatever current stable HA happens to be." No version pin in any Ziggy config.

### Third-party APIs in active use
- **OpenAI** — GPT-4o-mini (intent parsing, chat), Whisper API (voice STT fallback). Key in `config/settings.yaml` AND `.env`.
- **Azure Cognitive Services Speech** — Hebrew + English TTS. Key in `config/settings.yaml`.
- **Cloudflare API** — Tunnel management from the relay (`CF_API_TOKEN` + `CF_ACCOUNT_ID`).
- **GitHub** — HA release notes (anonymous, 60 req/h limit).
- **Fly.io** — image hosting + relay deploy.
- **Oracle Cloud** — ARM VM host for per-home docker stacks (SSH-driven, no SDK).
- **SerpAPI** — referenced in settings; `[?]` whether web_handler actively uses it or only Open-Meteo / DuckDuckGo / recipe-scrapers etc.
- **SMTP (Gmail)** — `ziggyhome.notifications@gmail.com` outbound via SMTP for invites (relay) and tests (hub).
- **Telegram** — bot token configured; see Section 6 for the "Telegram interface" gap.
- **Google Calendar / Gmail** — `google-api-python-client` + `google-auth-oauthlib` are in requirements; `scripts/setup_gmail.py` sets up OAuth. Wired to which routes? `[?]`
- **Spotify (`spotipy`)** and **Yahoo Finance (`yfinance`)** — listed but actual integration points need confirmation.

### Hardware drivers & assumptions
- Broadlink RM4 (direct via `python-broadlink`)
- Tadiran AC (Gree IR protocol) — per founder memory; consistent with recent commits
- ZHA-capable Zigbee coordinator (handled by HA)
- Optional `RPi.GPIO` / `gpiozero` (Linux only — guarded with `platform_system == "Linux"`)
- Audio input device required only for the Voice thread

---

## Section 5 — Gap Analysis for Commercial Launch

### Ziggy Cloud (user accounts, device registry, OTA, telemetry, admin auth)
| Capability | Status |
|---|---|
| User accounts | **Present** — relay has `users` table with role gating; hub has its own user table mirrored from relay via `INITIAL_ADMIN_EMAIL` env bootstrap |
| Device registry | **Partial** — relay has `homes` table (id, tunnel_url, status, relay_secret); per-home device registry lives on the hub side in `user_files/device_registry.json`, not synced cloud-side |
| OTA endpoint | **Missing** — no relay-side image distribution or rollout mechanism; updates are image-pull only |
| Telemetry ingestion | **Missing** — no cloud-side log/event aggregation |
| Admin auth | **Present** — relay JWT + `role='relay_admin'` gating |

### WireGuard remote access relay with subscription-gated kill switch
- **Present (different stack):** Cloudflare Tunnel per home — same shape, different transport.
- **Kill switch:** Home `status` can be set to `suspended` and `proxy.py` returns 403, but it isn't tied to billing because billing doesn't exist.
- **Missing:** WireGuard specifically (if that's a hard requirement), and any subscription gating logic.

### HA version pinning with controlled update mechanism
- **Missing.** Docker pulls `:stable`; the hub has a *risk analyzer* (`ha_update_checker.py`) but no installer, no staging environment, no per-home rollout control.

### Remote SSH support tunnel with audit logging + user notification
- **Missing.** The relay does outbound SSH *to* Oracle VM for provisioning; there is no inbound support-SSH-tunnel pattern, no audit log of operator access, no user notification when support views their hub.

### Daily encrypted backups with per-user keys and DR flow
- **Missing entirely.** No backup pipeline anywhere.

### Subscription billing + enforcement (Paddle/Stripe), graceful local-kit degradation
- **Missing entirely.** No payment integration, no entitlement check, no degraded mode logic.

### Admin dashboard for managing all deployed devices and users
- **Present (early state).** `CloudAdmin.jsx` (476 L) talks to the relay's home/user/invite endpoints. `AdminConsole.jsx` is the consumer admin landing page. **Gaps:** no fleet-wide device search, no per-home logs viewer, no remote-restart button, no health-watchlist, no usage charts.

### Onboarding (QR on first boot, app discovery, sensor naming UI, account linking)
- **Mobile pairing:** present — `mobile_router.py` `POST /api/mobile/pair-code` + `POST /api/mobile/pair`, with `MobileOnboarding.jsx` flow. Pair code is 6-char alphanumeric, 5-min TTL.
- **QR on first boot of the hub:** **missing** — no boot-time QR rendering on a hub display.
- **Sensor naming UI:** **partial** — `DeviceDetail.jsx` allows custom names per entity (`PATCH /api/ha/entity/{entity_id}/name`); no guided wizard.
- **Account linking:** **present** via invites (relay → email → register-with-token).

### Voice pipeline v1 (PTT, HE+EN STT via Whisper, local routing + cloud LLM fallback, app push + on-screen response, no TTS)
| Requirement | Status |
|---|---|
| Push-to-talk | **Present** — both PTT and wake-word are implemented, toggle via `wakeword_enabled` setting |
| Hebrew Whisper STT | **Present** — local `ivrit-ai/whisper-large-v3-turbo-ct2`, OpenAI Whisper API fallback |
| English Whisper STT | **Present** — same pipeline, language='en' |
| Local command routing | **Present** — `intent_parser.quick_parse` |
| Cloud LLM fallback for Q&A | **Present** — `chat_handler.py` uses GPT |
| App push for response | **Present** — web push + planned mobile push |
| On-screen response | **Present** — AIChat shows messages |
| **No TTS** | **NOT MET** — `tts_engine: azure` is the current default; Piper TTS is loaded on the voice thread. `[?]` Founder confirm whether to disable. |

### Kill switch for cancelled subscriptions
- **Mechanism exists** (`homes.status='suspended'`); **trigger doesn't** (no billing system).

### Legal surfaces (terms, privacy, in-app cancellation, data export, account deletion)
- **Missing.** No /terms, /privacy, /export, no `/api/account/delete`. The hub-side `DELETE /api/auth/users/{username}` deletes the row but doesn't purge any associated state (tasks, automations, push subs).

---

## Section 6 — Risks, Smells, and Surprises

### Surprises that worried me while reading

#### S1. **Live production secrets are tracked in `config/settings.yaml`.**
The `.gitignore` *attempts* to exclude it at line 50 with the literal string
```
c o n f i g / s e t t i n g s . y a m l
```
(a space between every character). That is not a valid pattern — it silently does not match anything. Meanwhile the file in the working tree contains:
- OpenAI API key (with a comment in `.env` saying "ROTATE THIS KEY (it was exposed in git history)" — so this is a *known* problem, but the file is still tracked)
- Home Assistant long-lived token (exp 2073-06-09)
- Telegram bot token + allowed user IDs
- MQTT username + password
- Azure speech key
- SerpAPI key
- Email SMTP password (`mcdwuvurgjnzttgg`)
- Bcrypt-ish user password hashes + salts for two users
- **20 active session tokens** in plaintext per user

`git log -- config/settings.yaml` will tell you exactly which secrets have been written to history; the user said they are aware of the OpenAI exposure. The full scope ought to be re-checked.

#### S2. **`.gitignore` line 49 is `*.json`.** That is a *very* broad rule. It currently doesn't matter for files that are already tracked (`package.json`, `frontend/package-lock.json`, etc. remain in git because they were added before this rule), but any *new* `.json` config you intend to commit will be silently skipped. This is the kind of footgun that bites in six months when somebody adds a new schema file and can't figure out why CI doesn't see it.

#### S3. **`docker/home-template/` referenced in `docker-compose.yml` doesn't exist.** The compose file comments "For production cloud homes, see docker/home-template/docker-compose.yml" — but only `docker/mosquitto.conf` is in the tree. The real production-home template is generated inline by `relay/app/provisioner.py:189-210`. The comment is misleading.

#### S4. **`interfaces/telegram_interface.py` does not exist** but `README.md:228` says to run `python interfaces/telegram_interface.py`. Telegram surface today is:
- `services/communication_manager.py` — knows how to *send* Telegram messages (one-way)
- `core/handlers/comm_handler.py` — exposes the send intent
- `core/session_manager.py` — has Telegram-aware multi-session bookkeeping (suggesting a bot *was* designed)
…but there is no incoming-message handler / button-flow code in this repo. **The README oversells what's built.**

#### S5. **Dockerfile silently swallows pip-install failures.** The line is
```
pip install … 2>/dev/null || pip install … -r requirements.txt 2>/dev/null || true
```
That `|| true` is a footgun — the container can build and start with broken dependencies. Combined with the inline list installing `anthropic` and `httpx` that aren't in `requirements.txt`, you have two paths to a working image and they install different things.

#### S6. **HA token + OpenAI key are loaded at module import.** Both `services/home_automation.py` and `services/ha_subscriber.py` read the token once. Rotating either credential requires restarting the hub process. That's fine for now; it'll bite you when you have 50 cloud homes and you want to push a rotation.

### Single points of failure
- **The relay is on a single Fly.io VM** (1 shared CPU / 512 MB / `ams` region). If it falls over, every cloud home's user-facing access path falls over with it. There is no failover region in `fly.toml`.
- **The Oracle ARM VM** hosting per-home docker stacks is single-host. No HA, no automated migration.
- **`config/settings.yaml`** is read-modify-write all over the place (admin_router, auth_router, device_router, presence_router, ha_router, …). Corruption of that file is a "lose all configuration" event.

### Missing error handling in critical paths
- **`ir_listener._discovery_lock`** is declared `None` at module level and used as if it were always initialized (per the services-A agent).
- **`asyncio.run()` inside a worker thread spawned from a sync caller** in `services/device_groups.py:355-367` — concurrent callers can deadlock the request thread on `t.join(timeout=8.0)`.
- **WS frame parsing** in `ha_subscriber.py` logs JSON errors and continues — fine; but partial frame loss is not detected (just one lost event silently).
- **In-memory anomaly timers** (`_last_on`, `_last_off`, `_all_away_since`, `_no_motion_since`) — **not persisted**. A restart clears the 24-hour-no-motion timer for ANOM-05 and the user gets a 24-hour grace period they didn't ask for. TODOS.md mentions persisting snooze state; the timers themselves are not noted as a TODO.

### Security concerns
- **CORS `allow_origins=["*"]`** on the hub (with `allow_credentials=False`). Fine in isolation; concerning because some routes trust `X-Relay-*` headers — but those are middleware-set against a server-side secret, so cross-origin JS can't forge them. Still worth a deliberate audit before public launch.
- **`POST /api/ha/service`** is unrestricted — any logged-in user can call any HA service, including `homeassistant.restart` and `shell_command.*` (per the routers agent). **No domain whitelist.**
- **`GET /api/debug/registry`** in `device_router.py` is missing the explicit `Depends` per the routers agent — confirm. If true, registry stats leak to unauthenticated callers (low-impact data, but it shouldn't be public).
- **`POST /api/homes/register-hub`** on the relay is public, secured only by possession of the home's relay_secret. If the secret leaks (and it sits in `settings.yaml`, the same file with everything else), an attacker can hijack `tunnel_url`.
- **`GET /api/homes/{home_id}/health`** on the relay may lack the ownership check `get_home` enforces — would allow cross-tenant home discovery. `[?]` Confirm.
- **Relay password hashing is HMAC-SHA256**, not bcrypt/argon2/scrypt. `passlib[bcrypt]` is in `relay/requirements.txt` but unused.
- **Session tokens stored in plaintext in `settings.yaml`.** If the file leaks, all live sessions are compromised.
- **Login fallback when users-list is empty silently returns a super_admin token** (`auth_router.py:142-144`). Intentional anti-lockout but a foot-gun if `settings.yaml` is wiped in production.
- **Mobile WS** accepts the socket before validating the device token (`mobile_router.py:186-215` per the routers agent). Low impact (closes after auth check) but a small DoS amplifier.
- **VAPID `Contact` is hardcoded to `mailto:silentyouval@gmail.com`** in `services/push_notify.py`. Per-deployment configuration needed before shipping to other users.
- **Custom IR command IDs normalize by stripping all non-alphanumeric chars** — `test_cmd!` and `test_cmd?` both become `test_cmd`. Silent overwrites possible.

### "Will break in production with 50 users"
- **Read-modify-write of `settings.yaml`** from many routers under load — at any non-trivial concurrency you'll get torn writes. No locking, no atomic-rename, no journal.
- **Session-token list capped at 20 per user, kept in `settings.yaml`** — every login mutates the same global file. With 50 users * average 3 devices each, that's regular churn of the file holding HA tokens.
- **Voice rate-limit deque never prunes** (`intent_router.py:46-61` per the routers agent) — unbounded memory growth over weeks for hot users.
- **`device_groups.py` worker-thread fan-in** — under concurrent dashboard loads, all callers queue on `t.join(timeout=8.0)`.
- **The relay's `provisioner.py`** runs `docker compose up -d` synchronously on a single Oracle VM. Provisioning is not horizontally scalable.

### "Made sense for one Pi, won't scale to a fleet"
- All per-home state (automation history, IR codes, push subs, anomaly history) lives on the home. The relay knows nothing about it. A fleet-wide search ("which homes have a Tadiran AC?") is impossible without polling every hub.
- HA itself is per-home and pulls `:stable` on container restart. A breaking HA release will cascade across every home that restarts during the window.
- No remote logging — to debug a customer issue you need to be inside their hub's `logs/` directory.

### Looks abandoned mid-implementation
- `mobile_router` WS — Phase 1 ping/pong only, no real fan-out
- `mobile_push.py` — APNs+FCM scaffolding with no credentials
- `services/map_renderer.py` GPT-4o enrichment — explicitly "on hold" per TODOS.md
- Pattern "group" type in `pattern_detector.py` — disabled, needs 10+ occurrences over 4+ weeks (which is fine, but flag)
- `routines/` directory has only a 49-byte stub; routine metadata is in `user_files/routine_meta.json`. README still references a `core/routine_file.py` that isn't there.
- `core/result_utils.py` is a 248-byte stub
- `memory/state/` is an empty placeholder
- Repo-root orphans: `backend_test.py`, `backend_system_test.py`, `backend_error_test.py` (~24 KB total), `microphone_test.py` (0 bytes), `room_final.html` + 5 `room_review*.html`, `get_folders_structure.py`, `x.mp3` (6.9 KB), `test_result.md`
- Empty / nearly-empty top-level dirs that look superseded: `ui/`, `routers/` (root), `utils/`

### Test coverage gaps
- **No integration test for the intent pipeline.** `intent_parser`, `action_parser`, and every handler in `core/handlers/` have **zero unit-test coverage**.
- Existing tests focus on the anomaly engine (23 tests), IR protocol (45 tests), presence engine (22 tests), IR manager (18 tests), zone machine + presence + debug bus + canvas API + push self-suppress + WiFi safety + LAN presence. Good unit coverage of the back-end engines; zero coverage of the dispatch layer that ties them together.
- **The relay has no tests.**
- **The frontend has Vitest configured** (`vite.config.js`) and a `test-setup.js` shim, but I see no `.test.jsx` or `.spec.jsx` files in `frontend/src/`.

---

## Section 7 — Open Questions for the Founder

Grouped so you can answer efficiently.

### Intent questions — what was this code meant to do?
1. **`ui/`, `routers/` (root), `utils/`** are all but empty. Are these the husks of an older layout that was migrated to `backend/routers/` and `frontend/`? Safe to delete, or is something I haven't found still importing from them?
2. **`backend_test.py`, `backend_system_test.py`, `backend_error_test.py`** at the repo root — manual integration scripts, abandoned, or intended to be moved into `tests/`?
3. **`room_final.html` + `room_review[1-4].html` + `room_review2.html`** at repo root — discarded UI iterations, or still referenced somewhere?
4. **`microphone_test.py` (0 bytes)** and **`x.mp3` (6.9 KB)** — junk, or intentionally placeholders?
5. **`memory/state/` and `routines/sample_routine.py`** look like stubs for designs that moved into `user_files/state_memory.json` and `user_files/routine_meta.json`. Is the old layout truly retired?
6. **`services/system_tools.py` vs `core/handlers/system_handler.py`** — both exist; the handler appears to delegate to `psutil` and `socket` directly. Is `system_tools.py` still used by anything other than the handler?

### History questions — is this still in use, or superseded by something newer?
7. **The Telegram interface** — the README documents `python interfaces/telegram_interface.py`. There is no such file. Was a Telegram bot ever fully built and removed, never built but planned, or built in a different repo? `core/session_manager.py` clearly anticipates Telegram contexts. What is the real intent?
8. **The Flask `interfaces/dashboard.py`** — does this still get used in operations, or is it superseded by the React debug page?
9. **`memory/state/state_manager.py` stub** — leftover from when state memory was being designed before `state_memory.py` landed in services?
10. **`anthropic` Python package** is installed in the Dockerfile but not in `requirements.txt` and I see no imports of `anthropic` in `core/` or `services/`. Was an Anthropic path tried and removed, or is it speculative?

### Decision questions — there are two ways this could be wired; which is current?
11. **HA-native automations vs Ziggy-side `local_automation_actions`** — for a motion → light rule today, which path is canonical? Is the long-term direction to consolidate on one, or to keep both?
12. **Wake-word: `hey_mycroft` vs "Hey Ziggy"** — settings still say `hey_mycroft`. The dataset directory `oww_data/hey_ziggy/` has training material but no visible compiled model. Is the trained "Hey Ziggy" model present somewhere I missed, or is the training pipeline staged but not yet run?
13. **TTS** — `tts_engine: azure` is the current default and Piper is loaded on the voice thread. The mobile direction (per memory) is push + on-screen response only. Should TTS be disabled? If yes, on the web side only or also the voice loop?
14. **Voice STT path** — local Hebrew Whisper vs OpenAI Whisper API. For commercial launch, is the plan to run local always (privacy + cost) or rely on OpenAI?
15. **Subscription billing** — Paddle vs Stripe? Per-home or per-user pricing? Does the kill switch need to be soft (no remote access but local PWA keeps working) or hard?
16. **Relay scaling** — single Fly.io VM is the current shape. Is fleet HA expected before commercial launch, or is one VM acceptable for the early-access window?
17. **HA version management** — what is the launch plan? Pin a known-good HA tag and require an explicit operator action per release? Auto-update with a 24-hour staging window? Per-home opt-in?
18. **Backups** — who owns each home's data after launch? Per-user, per-home, or both? Encryption keys held by Ziggy, by the user, or split?

### Missing context questions — config / env / secrets referenced but not present
19. `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` are referenced by `backend/server.py:148-169` for cloud bootstrap. Are these set in the per-home docker-compose template at provisioning time? (I saw the template is generated inline by the provisioner, but couldn't confirm these specific vars are in it.)
20. `SERPAPI_API_KEY` is in `.env` and `.env.example` — is it actively used today, or is it a legacy from a prior web-search implementation now replaced by `ddgs` (DuckDuckGo)?
21. `gmail_credentials.json` and `gmail_token.json` are git-ignored — are they used in production (`setup_gmail.py` setup) or only in your personal hub?
22. The relay env vars (`PROVISION_SSH_KEY`, `CF_API_TOKEN`, `FLY_API_TOKEN`, `RELAY_JWT_SECRET`, `RELAY_ADMIN_EMAIL`/`PASSWORD`, `SMTP_USER`/`PASS`) — are these set as Fly secrets today? What rotation cadence?
23. The mobile-push credentials (`settings.mobile_push.apns.*`, `.fcm.*`) — do these exist in any environment today, or is the entire mobile-push path "later"?

---

## Section 8 — Future Cleanup List (Out of Scope)

Not acted on. Captured for the backlog. Each is `effort / value`.

1. Move every secret out of `config/settings.yaml` (env vars + secrets manager). — **high / high**
2. Fix the corrupted `.gitignore` line 50 and add a `git rm --cached config/settings.yaml` after rotation. — **low / high**
3. Replace `*.json` in `.gitignore` with a tighter pattern (`user_files/*.json`, `frontend/user_files/`, `config/*credentials*.json`). — **low / medium**
4. Add an atomic write (`tempfile + os.replace`) wrapper around `save_settings()` and put it behind a file-lock. — **medium / high**
5. Migrate user records + session tokens out of `settings.yaml` into a dedicated SQLite store. — **medium / high**
6. Replace relay password hashing with `passlib[bcrypt]` (already a dependency) or argon2. — **low / high**
7. Add domain whitelist + audit log to `POST /api/ha/service`. — **low / high**
8. Pin every dependency in `requirements.txt`; remove the silently-failing pip-install fallback in the Dockerfile; drop the inline package list and rely on `requirements.txt` only. — **low / high**
9. Add `python-bidi` and `anthropic` (if it really is used) to `requirements.txt`. — **low / low**
10. Persist anomaly engine in-memory timers (`_last_on`, etc.) — partial work tracked in TODOS.md (snooze only). — **medium / medium**
11. Persist the rate-limit deque or back it with `cachetools.TTLCache`. — **low / medium**
12. Initialize `ir_listener._discovery_lock` at module load instead of leaving as `None`. — **low / high**
13. Split `interfaces/voice_interface.py` (1146 L) into model loaders / audio capture / dispatcher modules. — **high / medium**
14. Split `frontend/src/components/ui/DeviceControls.jsx` (1527 L) by domain. — **medium / medium**
15. Add an integration test for the intent pipeline (`tests/test_intent_pipeline.py`): fast-path, confidence-gate downgrade, Hebrew normalization, multi-intent envelope. — **medium / high**
16. Add unit-test stubs for every handler in `core/handlers/` (even table-driven mocks beat zero). — **medium / high**
17. Write at least smoke tests for the relay (`relay/tests/`). — **medium / high**
18. Implement a real `useApi` cancel-on-unmount or migrate to TanStack Query. — **medium / low**
19. Audit i18n key coverage between `en.js` and `he.js`; add a CI check that fails on missing keys. — **low / medium**
20. Add `Content-Security-Policy` header on the hub's static-file responses. — **low / medium**
21. Remove repo-root junk: `microphone_test.py`, `x.mp3`, `room_review*.html`, `test_result.md`, and the empty `ui/` / `routers/` (root) / `utils/` / `memory/state/` directories. **(After founder confirmation per Section 7.)** — **low / low**
22. Delete `core/result_utils.py` if confirmed unused. — **low / low**
23. Update the README: 17→29 routers, remove the Telegram-interface command, fix the `core/routine_file.py` reference, fix the `docker/home-template/` reference. — **low / medium**
24. Make `VAPID Contact` and the email branded-wrapper sender name configurable per deployment. — **low / medium**
25. Add the relay's `home_id` ownership check to `GET /api/homes/{home_id}/health`. — **low / high**
26. Move WS auth check before `ws.accept()` in `backend/routers/mobile_router.py`. — **low / medium**
27. Atomic write of `settings.yaml` (see #4) + JSON state files in `user_files/`. — **medium / high**
28. Add a real OTA mechanism (image tag → staged → all-homes rollout with health check + rollback). — **high / high (commercial launch blocker)**
29. Add a daily encrypted backup pipeline. — **high / high (commercial launch blocker)**
30. Add a billing/entitlement integration (Paddle or Stripe) + soft-degrade path. — **high / high (commercial launch blocker)**
31. Add a fleet-wide search / log surface on the relay so support can debug without per-home SSH. — **medium / high**
32. Disable Piper TTS on the voice thread (per the no-TTS mobile direction) **after founder confirms**. — **low / medium**
33. Tighten the wake-word pipeline to actually load a compiled "Hey Ziggy" model once the training output is produced. — **medium / medium**
34. Consider migrating `device_groups.py`'s sync-from-async pattern to a proper async-aware cache or an explicit cache-refresh task. — **medium / medium**
35. Build the "QR on hub first-boot" onboarding surface (the only missing piece on the onboarding checklist). — **medium / medium**

---

*End of audit. ~308 source files read in part or whole. Where I could not determine intent from code alone, I flagged the question for you rather than invent an answer. The codebase is a real product in mid-flight: the core HA + IR + voice + automation stack is well-engineered and largely production-grade; the commercial-launch wrapper (billing, OTA, backups, multi-tenant safety on the relay, secret hygiene) is the next frontier.*
