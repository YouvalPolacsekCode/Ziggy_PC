# Ziggy Capability Catalog

**84 capabilities** built from **58 shared mechanisms**.

| Status | Count |
|---|---|
| 🟢 `live-prod` | 67 |
| 🟠 `orphaned` | 6 |
| 🟡 `canary-only` | 4 |
| 🔵 `flagged` | 4 |
| ⚫ `abandoned` | 3 |

*Generated from `docs/capability-catalog.json`. Do not edit by hand.*

## Capabilities

## Accounts & onboarding

### 🟢 Guided home setup wizard  `guided-home-setup`

> From an empty box to a working home in one guided flow — on a phone, in a browser, or with no screen at all.

The first phone to scan the code on the box becomes the owner. From there a step-by-step wizard — the same flow on a phone app or in a plain browser — gets a screenless hub onto Wi-Fi through its own hotspot, asks for a language before any account exists, has the customer name the sensors that came in the box in plain words, and offers five ready-made starter automations. The founder learns within seconds when a new home actually finishes setup. An earlier fifteen-step 'bring your own hardware' wizard and an earlier wall-tablet dashboard were both built and then parked in favor of this flow.

- **Status:** `live-prod` — frontend/src/pages/MobileOnboarding.jsx and WebOnboarding.jsx (b7cb9da); first-boot claim hardened in 7ee278e after adversarial review found a non-atomic-owner bug; headless Wi-Fi captive portal shipped 7ee278e; starter pack GET /api/onboarding/starter-pack (4fbaba3); completion telemetry POST /api/onboarding/complete (1f41ab0).
- **Layer:** Accounts & onboarding · **Audience:** user-facing
- **Built from:** `scheduler-tick-loop`
- **Composes with:** `buttons-and-remotes` (via scheduler-tick-loop), `device-and-automation-runtime` (via scheduler-tick-loop), `fleet-health-and-repair` (via scheduler-tick-loop), `ha-update-advisor` (via scheduler-tick-loop)
- **Surfaces:** `frontend/src/pages/MobileOnboarding.jsx`, `frontend/src/pages/WebOnboarding.jsx`, `backend/routers/first_boot_router.py`, `scripts/linux/wifi-onboarding/portal_server.py`, `services/starter_pack.py`, `backend/routers/onboarding_sensors_router.py`
- **Known gaps:** An earlier fifteen-step self-install wizard for bring-your-own-hardware customers is parked/deleted in favor of the mobile-first flow.

### 🟢 Household sign-in  `household-sign-in`

> Everyone in the house gets their own account, stays signed in, and can delete themselves without asking anyone.

Every household member signs in with their own account rather than sharing one password, and credentials live in their own local store rather than riding along in the settings file. Old accounts get modern password hashing transparently on their next login, with no forced reset. Anyone can remove their own account from inside the app. Reaching the hub through the cloud relay from outside the LAN still resolves to the same identity.

- **Status:** `live-prod` — backend/routers/auth_router.py (9be2d62, multi-user auth); credential store services/auth_db.py (23c5455) with an on-boot YAML migration; transparent bcrypt rehash logging '[Auth] Hash upgraded' (5de1a9a), also built independently on the relay side (8f7ca83, aaef183) for cloud accounts; self-service deletion (19cdf86, tests/test_auth_self_delete.py).
- **Layer:** Accounts & onboarding · **Audience:** user-facing
- **Built from:** `websocket-auth-gate`
- **Composes with:** `realtime-state-sync` (via websocket-auth-gate)
- **Surfaces:** `backend/routers/auth_router.py`, `services/auth_db.py`, `services/auth_hashing.py`, `backend/middleware/relay_auth.py`, `frontend/src/pages/LoginPage.jsx`
- **Tests:** `tests/test_auth_self_delete.py`

### 🟢 Invite someone into your home  `household-invites`

> Send a link and a family member joins your home with exactly the access you chose — no separate account setup on their end.

The owner sends an invite link; the recipient sets their own password and lands inside the household with the role picked for them. For a brand-new hub-based home, the same invite also tracks and displays the hub's own shipping/setup status (being prepared, then online) while the recipient waits.

- **Status:** `live-prod` — backend/routers/invite_router.py mounted at backend/server.py:602, UI at frontend/src/pages/AcceptInvite.jsx; ship-aware polling for hub homes added in 14b0055, using relay/app/routers/invites.py and relay/app/routers/provision.py loosened to accept the home's own owner, not just admins.
- **Layer:** Accounts & onboarding · **Audience:** user-facing
- **Built from:** `invite-token`
- **Surfaces:** `backend/routers/invite_router.py`, `frontend/src/pages/AcceptInvite.jsx`, `relay/app/routers/invites.py`

### 🟢 Wall tablet mode  `wall-tablet-mode`

> A tablet mounted on the wall gets exactly the powers a shared house screen should have — and stops pretending to be a family member.

A wall-mounted tablet is recognised as shared house furniture, not a household member: it can be given a narrow policy (dim lights, yes; unlock the door, no) and it is excluded from presence tracking so it can't show up as a person who never leaves the house. Coming back out is a labelled exit button in the wall header, confirmed in the app and held behind the tablet's PIN when one is set, with the old long-press on the Ziggy mark still working for anyone who learned it. An earlier, separate wall-screen dashboard was built and then abandoned before this policy layer existed.

- **Status:** `live-prod` — services/wall_policy.py + backend/middleware/wall_capability.py (9c49ca0), shipped in release-2026.08.10; presence exclusion fixed live after a real tablet appeared in a customer's household as 'Silentyouval 2' (e051f9a). Re-checked at commit 0d0fda3: the /hub screen still has no route in frontend/src/App.jsx and backend/server.py registers no dashboard_router (line 713 names it only in a comment explaining that it is dead). | Also this pass: services/wall_policy.py + backend/middleware/wall_capability.py (9c49ca0), shipped in release-2026.08.10; presence exclusion fixed live after a real tablet appeared in a customer's household as 'Silentyouval 2' (e051f9a). Visible PIN-confirmed exit added in commit 20fb993, an ancestor of release-2026.09.18-4: frontend/src/wall/WallChrome.jsx with frontend/src/wall/__tests__/exitWall.test.jsx, and the Settings card copy updated in frontend/src/pages/Settings.jsx (WallModeCard).
- **Layer:** Accounts & onboarding · **Audience:** user-facing
- **Surfaces:** `services/wall_policy.py`, `backend/middleware/wall_capability.py`, `frontend/src/pages/Settings.jsx`
- **Known gaps:** An earlier, unrelated wall-tablet dashboard (an editable section-based /hub screen) is still half-built and unreachable: nothing routes to it and its backend router is registered nowhere. Work keeps landing in it anyway — the 2026-09-19 mode chips added a section to it (cc4d842) — so check that a route exists before building anything else there.; For a while a tablet could be genuinely stuck in wall mode: the only exit was an undocumented two-second press on the Ziggy mark, which a touch browser's own long-press handling could cancel before the timer fired, and the Settings toggle was out of reach because a wall-mode device rewrites its start page to the wall view on every boot. Fixed on 2026-09-06 by making the exit a visible button — do not remove it in the name of a cleaner wall header.

## Alerts & safety

### 🟢 Alerts — the home watcher  `alerts-inbox`

> One place that tells you what needs attention in your home right now, in plain language.

A rule engine evaluates the home on every state change and raises an alert when something looks wrong — lights on with nobody home, the AC running in an empty room, a door left open, a device left on for hours, a low battery, several devices dropping at once, an occupancy sensor stuck reporting one state, a device that has left the home's radio network altogether, or an automation still pointing at a device that no longer exists. Every alert lands in a single Alerts screen, names the real room rather than a technical id, can be snoozed for a chosen duration, and — where there is an obvious fix — cleared with one tap that runs the fix. A daily budget caps how many warnings reach the phone (twelve a day out of the box; critical alerts always get through): past it the alert is still recorded and still shown in the app, the phone just stays quiet. An owner-only Rules tab can tune or disable individual rules or the whole watcher, devices meant to stay powered (fridges, routers) are exempted by name, and Ziggy's own occupancy conclusions are recognised as conclusions rather than hardware, so nobody is ever told to change the battery in a sensor that has none. The whole surface was renamed from 'Anomalies' to 'Alerts' in both languages because the old name read as diagnostic jargon to a homeowner.

- **Status:** `live-prod` — VERIFIED: services/anomaly_engine.py registers ANOM-01..ANOM-15. ANOM-14 is raised from services/radio_liveness.py (reconcile() every 5 min from services/ziggy_scheduler.py, a prod entrypoint) off Zigbee2MQTT's retained bridge/devices list; ANOM-15 from services/automation_integrity.py (hourly sweep, same scheduler) and badged on the card at frontend/src/components/automations/AutomationCard.jsx:52-119. Daily push budget gate at services/anomaly_engine.py:428 with `anomaly_engine.daily_push_budget` default 12 in config/settings.example.yaml:34. Ziggy's own sensors exempted via is_ziggy_virtual_sensor (services/anomaly_engine.py:319). Alerts screen routed at frontend/src/App.jsx:633 (path "alerts", /anomalies redirects); one-tap fix at backend/routers/map_router.py:332; snooze at map_router.py:319; rules admin at backend/routers/admin_router.py:360-420. Commit 1bb0764 is an ancestor of the newest tag release-2026.09.18-4 (checked with git merge-base --is-ancestor). Covered by tests/test_alert_budget.py, tests/test_radio_liveness.py, tests/test_automation_integrity.py, tests/test_anomaly_virtual_sensors.py, tests/test_anomaly_engine.py.
- **Layer:** Alerts & safety · **Audience:** user-facing
- **Shipped:** 2026-05-12 (`257b237`)
- **Built from:** `anomaly-rule-registry`, `web-push-channel`
- **Composes with:** `mobile-notifications` (via web-push-channel), `proactive-silent-device-detector` (via anomaly-rule-registry)
- **Entry points:** `GET /api/alerts`, `GET /api/map/anomalies/active`, `GET /api/map/anomalies/history`, `POST /api/map/anomalies/action/{room_id}/{rule_id}`, `POST /api/map/anomalies/snooze/{room_id}/{rule_id}`
- **Surfaces:** `ziggy_pc/services/anomaly_engine.py`, `ziggy_pc/services/ha_subscriber.py`, `ziggy_pc/backend/routers/map_router.py`, `ziggy_pc/backend/routers/alerts_router.py`, `ziggy_pc/backend/routers/admin_router.py`, `ziggy_pc/frontend/src/pages/Anomalies.jsx`, `ziggy_pc/frontend/src/lib/i18n/en.js`
- **Tests:** `ziggy_pc/tests/test_anomaly_engine.py`
- **Known gaps:** The engine's in-memory timers are not persisted — a restart hands the home a free 24-hour grace period on the 'left on' rule.; Active alerts live purely in memory (ha_subscriber's dict); only history and snoozes survive a hub restart.; ANOM-11 through ANOM-15 run in the engine but have no entry in the Rules tab's admin metadata (backend/routers/admin_router.py stops at ANOM-10), so an owner cannot tune or disable the five newest rules from Settings.; On 2026-09-17 the Canary sent roughly 134 pushes in one day and all but one were false; the single true alert — a bulb that had left the network — drowned in them. The daily push budget exists because of that day, but it only silences the phone: a rule that misfires still fills the app's Alerts list, so the budget is a blast shield, not a fix.; Until 2026-09-18 the latched-sensor and silent-device sweeps judged Ziggy's own occupancy conclusions as if they were hardware, and after release-2026.09.06 homes were told to refit the battery in a sensor that has no battery. They are now skipped by name — do not reintroduce a sweep that treats a Ziggy-made sensor as a device to repair.; A device that leaves the radio network never becomes 'unavailable' while Zigbee2MQTT availability tracking is off, which is how every imaged hub ships — that is why the coordinator's membership list had to become the ground truth. Ziggy now asks Z2M once per boot to turn availability tracking on, and that only takes effect at Z2M's next restart, so a freshly imaged hub relies on ANOM-14 alone until then.; A dedicated sensor-alert poller (services/sensor_alerts.py) exists, is correctly wired, and ships disabled in every home by deliberate decision — the automation builder already covers the same job through a UI customers can reach.

### 🟠 Camera AI descriptions (uncommitted)  `camera-ai-vision`

> Meant to let Ziggy look through a camera and tell you what it sees, in chat or in an alert — none of it exists outside one machine.

Turned on per camera by explicit opt-in consent, Ziggy would take a single downscaled still, describe the scene in the user's own language, and never store the image. The design reaches three places: the Cameras screen, an alert that names what the camera saw ('motion in the hallway — a person at the door'), and a chat tool to ask what's happening at a named camera, all with rate limits and a fallback to the plain alert on any failure. None of it has ever been committed to the repository on any branch — the modules exist only as untracked files and uncommitted diffs on one working copy, so no home has this feature today, and losing that machine loses the feature entirely.

- **Status:** `orphaned` — `git ls-files services/vision.py` and `git log --all -- services/vision.py` both return nothing on any branch including origin/main. services/vision_alerts.py is untracked ('?? services/vision_alerts.py' in git status); the camera_look tool in core/agent/tools.py and the consent copy in frontend/src/lib/i18n/en.js exist only as uncommitted diffs.
- **Layer:** Alerts & safety · **Audience:** user-facing
- **Built from:** `camera-proxy`
- **Composes with:** `cameras-screen` (via camera-proxy)
- **Surfaces:** `ziggy_pc/services/vision.py`, `ziggy_pc/services/vision_alerts.py`, `ziggy_pc/tests/test_camera_vision.py`, `ziggy_pc/core/agent/tools.py`, `ziggy_pc/core/agent/directory.py`, `ziggy_pc/backend/routers/camera_router.py`
- **Tests:** `ziggy_pc/tests/test_camera_vision.py`
- **Known gaps:** Never committed on any branch — nothing survives if the working tree is lost.; Alert enrichment is scoped to only two rules (door open, motion during quiet hours), and every failure path — no camera, not opted in, rate-limited, timeout — silently falls back to the plain alert rather than losing it.; The chat tool depends on a [cameras] section in the agent directory that is itself an uncommitted diff.

### 🟢 Cameras screen  `cameras-screen`

> Every camera in the house on one screen, with a tap to go live.

Ziggy lists every camera it can see, shows a still from each, and streams a live view fullscreen on demand — both proxied through the hub so the app never needs a Home Assistant address or token. A motion log alongside it shows the last 24 hours of motion, occupancy, presence and recording events, pulled straight from Home Assistant's own history rather than a separate store.

- **Status:** `live-prod` — Route frontend/src/App.jsx:470 (path "cameras"); GET /api/cameras, /api/cameras/{id}/snapshot, /api/cameras/{id}/stream and /api/cameras/motion in backend/routers/camera_router.py; proxy URL helpers in services/camera_utils.py.
- **Layer:** Alerts & safety · **Audience:** user-facing
- **Shipped:** 2026-05-15 (`9be2d62`)
- **Built from:** `camera-proxy`
- **Composes with:** `camera-ai-vision` (via camera-proxy)
- **Entry points:** `GET /api/cameras`, `GET /api/cameras/{entity_id}/snapshot`, `GET /api/cameras/{entity_id}/stream`, `GET /api/cameras/motion`
- **Surfaces:** `ziggy_pc/frontend/src/pages/Cameras.jsx`, `ziggy_pc/frontend/src/stores/cameraStore.js`, `ziggy_pc/backend/routers/camera_router.py`, `ziggy_pc/services/camera_utils.py`

### 🟢 Habit-learned suggestions  `habit-learned-suggestions`

> Ziggy notices what you do every day and offers to automate it for you.

Every action Ziggy carries out is written to a private on-device log, filtered at write time to drop retries and immediately-undone actions. A detector accumulates evidence across weeks — how often, on how many distinct days, how tightly timed — and only surfaces a habit once it clears an evidence gate, appearing as a suggested automation the user can configure, dismiss or snooze. A dismissed habit is remembered so the same pattern never resurfaces as if it were new, and habits merge with ready-made device templates into one ranked Suggestions feed.

- **Status:** `live-prod` — PatternEngine thread started in backend/server.py:218-231, gated on pattern_learning.enabled (default true); pipeline services/pattern_logger.py -> pattern_detector.py -> suggestion_engine.py -> suggestion_manager.py; unified feed at GET /api/suggestions/feed (backend/routers/suggestion_router.py:137). tests/test_pattern_suggestions_flagship.py locks the flagship suggestion end-to-end.
- **Layer:** Alerts & safety · **Audience:** user-facing
- **Shipped:** 2026-04-29 (`2348842`)
- **Entry points:** `GET /api/suggestions/pending`, `GET /api/suggestions/feed`, `POST /api/suggestions/analyze`, `POST /api/suggestions/{sug_id}/reject`
- **Surfaces:** `ziggy_pc/services/pattern_logger.py`, `ziggy_pc/services/pattern_detector.py`, `ziggy_pc/services/suggestion_engine.py`, `ziggy_pc/services/suggestion_manager.py`, `ziggy_pc/backend/routers/suggestion_router.py`, `ziggy_pc/frontend/src/pages/Actions.jsx`, `ziggy_pc/frontend/src/pages/AdminSettings.jsx`
- **Tests:** `ziggy_pc/tests/test_pattern_suggestions_flagship.py`
- **Known gaps:** Was dead in production for months because the scheduler was only started from core/ziggy_main.py, which the container never runs — Suggestions could only ever be empty until it was rewired into backend/server.py.; A designed local-LLM quality gate that double-checks whether a habit is worth surfacing never actually runs on a customer hub — the hub's LLM traffic goes through the relay, not local Ollama, so only the heuristic copy path executes.; The 'group' habit shape (several actions always done together) is gated behind a threshold no real home reaches, so in practice only time-based and sequence habits ever surface.; An earlier standalone Suggestions page was superseded by the Suggested tab inside Actions and nothing in the app links to it any more, but push notifications for new suggestions still deep-link to that abandoned route.

### 🔵 Proactive silent-device detection (ANOM-13)  `proactive-silent-device-detector`

> Ziggy finds a device that has quietly stopped talking before you notice yourself.

A background detector tracks how long ago each device last reported anything and flags one that has gone quiet, feeding the same Alerts inbox as every other rule. Before it says anything it now climbs a repair ladder — wake the device with a real poll, ask the radio to interview it again, offer to open pairing so the owner can re-add it, and finally a battery-or-wall-switch instruction — and the alert reports what was already tried, in plain words, never naming the radio or the entity behind it. It reached every home in a release and is switched off there: on a home where the radio does not report availability, a light nobody touched all day looks exactly like a dead one, and the sweep filled the Canary with alerts about lights that were simply untouched. Acting on the radio is a second, separate opt-in, so even where the sweep is on it will not touch a customer's devices unless the owner allows it.

- **Status:** `flagged` — VERIFIED: the sweep is wired from services/ziggy_scheduler.py:462 (sweep_down_devices) — a prod entrypoint — but returns immediately unless the settings flag `anomaly_engine.anom13_down_sweep_enabled` is true, and config/settings.example.yaml:31 ships it false (commit 17d4b921, an ancestor of release-2026.09.18-4). The repair ladder is gated separately by `anomaly_engine.auto_repair_ladder`, also false at config/settings.example.yaml:37; ladder invoked at services/anomaly_engine.py:1335 for ANOM-13 and :1538 for ANOM-12. services/down_device_detector.py and services/repair_ladder.py are both tracked in git ls-files. Original rule commit f99e6ff4 (2026-08-28) is an ancestor of release-2026.09.18-4. Covered by tests/test_anomaly_down_sweep.py and tests/test_repair_ladder.py.
- **Layer:** Alerts & safety · **Audience:** user-facing
- **Shipped:** 2026-08-28 (`dd5d70a`)
- **Built from:** `anomaly-rule-registry`
- **Composes with:** `alerts-inbox` (via anomaly-rule-registry)
- **Surfaces:** `ziggy_pc/services/down_device_detector.py`, `ziggy_pc/services/anomaly_engine.py`, `ziggy_pc/services/repair_ladder.py`, `ziggy_pc/services/ziggy_scheduler.py`, `ziggy_pc/config/settings.example.yaml`
- **Known gaps:** Real-life validation was done and it failed: the sweep called the Canary's Kitchen Light 'hasn't responded in 1 day' while the light was fine, and produced roughly 130 false alerts in a day. It is shipped but off, and it must not be turned back on until there is a real liveness signal underneath it rather than a last-reported timestamp.; For Zigbee devices the question is now answered without guessing — the coordinator's own membership list (ANOM-14) knows whether a device is still on the network — so what remains for this heuristic is Wi-Fi and other non-radio devices, where nothing equivalent exists.; The repair ladder is opt-in on its own flag because a false alert must never re-interview a customer's devices; with it off the alert still fires, it simply cannot try to wake anything first, so the 'here is what I already tried' line is empty on every customer home today.; The ladder's third rung never acts in the background by design — it records that the owner is needed and becomes an instruction in the alert, so a device that genuinely needs re-pairing still waits for a person.

## Automations

### 🟢 Build your own automation  `build-your-own-automation`

> Make a rule from scratch in plain language, or bring one in from the community.

A step-by-step builder lets you choose a trigger (time, sunrise/sunset, a device changing state, a press on a wireless button, entering a zone, a room becoming occupied), optional conditions — including "only if the house is (not) in Sleep, Movie, Cleaning, Guests or Vacation" — and a list of things to do: device commands, notifications, media, delays, infrared commands, and switching a home mode. It refuses to save a rule that could not do anything, naming exactly what is missing, instead of letting you create one that fires forever and changes nothing. Community-made automation patterns can also be pasted in and filled out as a simple form, and Ziggy watches your own usage and offers to turn a repeated habit into a ready-to-save automation.

- **Status:** `live-prod` — The builder itself is carried from automations-and-bundles.history.json (history-angle salvage, not independently re-verified); the 2026-09 additions were checked here. The no-empty-rule refusal (commit 570d4f79, frontend/src/lib/automations/completeness.js with services/ha_automations.py behind it) and the wireless-button trigger (commit b96514b9, frontend/src/components/automations/wizard/TriggerEditor.jsx over services/controllers.py) are ancestors of release-2026.09.18-4. The mode condition and the set_mode action (commit 1e63c571, frontend/src/lib/automations/types.js) are on main only, so they reach the canary and not yet a customer home. Commit 5bf59b9 is cited in the source record for the secure-context fix.
- **Layer:** Automations · **Audience:** user-facing
- **Surfaces:** `frontend/src/components/CustomActionBuilder.jsx`, `frontend/src/components/automations/wizard/AutomationWizard.jsx`, `frontend/src/components/automations/wizard/TriggerEditor.jsx`, `frontend/src/components/automations/wizard/ConditionRow.jsx`, `frontend/src/components/automations/wizard/ActionRow.jsx`, `frontend/src/lib/automations/types.js`, `services/blueprint_registry.py`, `services/pattern_detector.py` …and 1 more
- **Known gaps:** An action step that just hands a sentence to the assistant is still offered in the builder and still generated by suggestions, but it silently does nothing on a home running the newer v2 assistant, with no warning in the UI.; Adding a trigger or condition used to be dead over a plain (non-https) address on the local network because a browser security API refused to run — fixed by a manual fallback (commit 5bf59b9).; Blueprint import shows every field as "ready" regardless of whether the entities it needs actually exist — there is no device-matching for pasted community patterns, unlike the curated Library.; "Only after dark" exists in both of Ziggy's evaluators and is offered to the chat designer, but the app's builder still lists only device-state, time and mode conditions — sunrise and sunset are available as triggers and not as conditions, so a rule that should run only after sunset has to be faked with clock times.

### 🟡 Home modes  `home-modes`

> Put the whole house in a mood — Sleep, Movie, Cleaning, Guests, Vacation — and everything that reacts to motion or to people leaving knows it.

Five fixed modes a household can flip from the Home screen, from chat ("movie mode for two hours"), from a wireless button, or from an automation step. Each has one defined effect the engine enforces: Sleep and Movie stop motion from turning lights on (Sleep ends at the morning time, Movie after three hours); Cleaning stops "off when empty" rules for two hours; Guests stops "everyone left" from running while people without tracked phones are in the house; Vacation switches on the lived-in evening simulation. A timed mode ends itself on a background tick rather than waiting for someone to notice it lapsed. Any automation can both check a mode ("only if the house is not in Sleep") and switch one, offered as a condition and as an action in the app's builder as well as from chat, and the ready-made room recipes carry those checks themselves. The same mode is mirrored to the rules that run natively so the two evaluators never disagree; the old single house-mode setting is now just a face over these five, and the flags the chat designer used to invent (which nothing ever read) are gone.

- **Status:** `canary-only` — On main and NOT in release-2026.09.18-4 — canary only. services/modes.py holds the five and their effects; services/modes_mqtt.py publishes the retained mirror from a startup thread in backend/server.py; backend/routers/modes_router.py is registered there too, with services/mode_service.py keeping the legacy single-mode contract alive as a facade (commit 17d25a09, which also added the expiry tick in services/ziggy_scheduler.py). The mode condition and set_mode step exist in both evaluators (commit dd93d28f, services/ha_automations.py + services/local_automation_actions.py) and in the builder (commit 1e63c571, frontend/src/lib/automations/types.js, ConditionRow.jsx, ActionRow.jsx); the recipes carry them via services/recipes/_common.py. Tests: tests/test_modes*.py, tests/test_mode_condition_and_step.py, tests/test_prod_entrypoint_starts_services.py.
- **Layer:** Automations · **Audience:** user-facing
- **Shipped:** 2026-09-18
- **Built from:** `bundle-recipe-registry`, `bundle-executor`
- **Composes with:** `actions-page-and-library` (via bundle-executor, bundle-recipe-registry), `buttons-from-chat` (via bundle-executor, bundle-recipe-registry), `leaving-and-arriving` (via bundle-executor, bundle-recipe-registry), `more-ready-made-routines` (via bundle-executor, bundle-recipe-registry), `smart-room` (via bundle-executor, bundle-recipe-registry), `design-from-chat` (via bundle-executor) …and 1 more
- **Surfaces:** `services/modes.py`, `services/modes_mqtt.py`, `services/mode_service.py`, `backend/routers/modes_router.py`, `services/ha_automations.py`, `services/local_automation_actions.py`, `services/recipes/_common.py`, `frontend/src/components/home/ModeChips.jsx` …and 4 more
- **Known gaps:** Modes are home-wide; a per-room Sleep (one bedroom asleep, the rest of the house awake) is not a thing yet — Smart Room's occupancy edge still covers the sleeping-person case on its own.; Vacation starts the lived-in simulation only when at least one room has a dimmable light; otherwise it just holds the flag.; A rule that runs natively can only check a mode once Ziggy's mirrored mode switch has been discovered. It is re-announced at every boot, and a condition is never compiled against a switch that isn't there — but until it appears, only Ziggy's own evaluator enforces the mode, so a natively-run rule can ignore it.

### 🟢 More ready-made routines  `more-ready-made-routines`

> Motion lights, an overnight watch, a window/AC guard, and one-tap routines like Good Night.

Beyond Smart Room and Leave Home, the Library offers Motion Light (lights follow movement and re-extend if you keep moving), Night Watch (arms overnight, alerts on motion, disarms at sunrise), and Window Open / AC Off (pauses the AC when a window opens and resumes once it's shut, or just sends a one-tap turn-off notice). Six seeded on-demand routines — Good Night, Good Morning, Movie Night, Leaving, Away/Vacation and Shabbat — run a named list of steps with one tap; Away/Vacation can also make the house look lived-in by cycling lights and a TV on a randomized evening schedule while you're gone.

- **Status:** `live-prod` — Carried from automations-and-bundles.history.json and presence.reconciled.json (history/reconciled-angle salvage, not independently re-verified in this pass). Cited sources: services/routine_templates.py, services/bundle recipe files for motion-light/night-watch/window-open, and services/fake_occupancy.py, plus commit ec809e4 for the Good Night step rewrite noted in the source records.
- **Layer:** Automations · **Audience:** user-facing
- **Built from:** `bundle-recipe-registry`, `bundle-executor`, `voice-intent-registry-store`
- **Composes with:** `actions-page-and-library` (via bundle-executor, bundle-recipe-registry), `buttons-from-chat` (via bundle-executor, bundle-recipe-registry), `home-modes` (via bundle-executor, bundle-recipe-registry), `leaving-and-arriving` (via bundle-executor, bundle-recipe-registry), `smart-room` (via bundle-executor, bundle-recipe-registry), `chat-with-ziggy` (via voice-intent-registry-store) …and 2 more
- **Surfaces:** `services/routine_templates.py`, `services/fake_occupancy.py`, `frontend/src/pages/Actions.jsx`
- **Known gaps:** The seeded routines originally tried to route one step through the chat pipeline, which silently did nothing; Good Night and Leaving were rewritten to use a native "turn everything off" step.; A separate mechanism lets a bundle register its own spoken phrase ("good morning") at apply time, but only the older chat engine ever listens for it — it is invisible on a home running the newer v2 assistant.; The lived-in simulator is manual-activation only; it never checks whether you're actually away, and an evening window that wraps past midnight isn't supported.

### 🟢 See what your automations actually did  `automation-history-and-reliability`

> Know when an action last ran, what it did, and trust that a rule which can't do anything never gets saved.

Opening an action shows a history of its recent runs, colour-coded by outcome, with each run's steps translated into plain labels instead of raw technical terms. An action that would do nothing can no longer exist: one with no steps — or whose only step never picked a device — is refused when you save it, for every way of creating it, and pressing Run on one refuses with the reason instead of reporting success. Ziggy also re-checks every hour that each rule still points at devices that exist; one that names a device you re-paired or removed is marked broken on its card and raises a single alert naming what to pick again. Deleting an action no longer trusts a simple success response — Ziggy reloads and double-checks that it is really gone before it tells you it worked.

- **Status:** `live-prod` — VERIFIED: commits 570d4f79 (no-empty-rule guard) and 1bb0764f (hourly integrity sweep) are both ancestors of release-2026.09.18-4. The guard lives in services/ha_automations.py (has_executable_actions, refused in the service so no caller can bypass it), returns 422 from backend/routers/automation_router.py, and blocks the last wizard step via frontend/src/lib/automations/completeness.js; the same router resolves who owns a manual Run (Ziggy's executor, else the bridge, else 422). The sweep is services/automation_integrity.py, run from a services/ziggy_scheduler.py tick and annotated onto the list response, badged in frontend/src/components/automations/AutomationCard.jsx. The run-history UI and the delete re-check are still carried from automations-and-bundles.history.json and were not re-proved here.
- **Layer:** Automations · **Audience:** user-facing
- **Surfaces:** `frontend/src/components/AutomationHistory.jsx`, `frontend/src/components/automations/AutomationCard.jsx`, `frontend/src/lib/automations/completeness.js`, `backend/routers/automation_router.py`, `services/ha_automations.py`, `services/automation_integrity.py`, `services/bundle_executor.py`
- **Known gaps:** Run history in the app only covers automations compiled into the smart-home bridge; a Ziggy-native one (e.g. everyone-left, a zone crossing) has no trace and the tab shows empty even though it ran.; Ziggy keeps its own append-only run journal that also records WHY an automation chose not to fire, which is the only real explanation for a mystery non-firing — but no screen in the app surfaces it; it's read by hand during incidents.; A customer's balcony rule was rebuilt in the wizard on 2026-09-05 with zero actions: it fired on every motion event for two days, and eight presses of Run all reported success, while the light stayed off. Saving one is now impossible, but a rule already saved empty before that fix still sits in the home and still fires silently — only pressing Run reveals it; nothing sweeps for it.; The hourly broken-device check judges real device entities only — an infrared target, a scene or one of Ziggy's own virtual sensors can vanish without being flagged — and it deliberately judges nothing at all when the device list can't be read, so during an outage every rule looks healthy.

### 🟢 Smart Room  `smart-room`

> Make a room look after itself without waking the person asleep in it.

A deterministic recipe — not a model guess — turns a room's occupancy into three rules: bright light on entry by day, warm and dim by night, and off once the room empties. It only reacts to the room going from empty to occupied, so a second person walking into an already-occupied room never re-triggers it. Rooms with a door sensor get a sharper version that treats "door open" as instantly occupied and holds occupancy through a closed door if motion was seen right after it shut (the shower case), and a room can carry more than one sensor — a bedroom and its en-suite can each run their own version. A room without a door now stays "occupied" for five minutes after the last movement instead of thirty seconds, because the old default was switching lights off on people who had simply gone still. On the canary it also obeys the house mood and your own hand: motion won't light the room in Sleep or Movie, the room won't go dark on you while Cleaning is on, and a light you switched off yourself is left alone rather than relit.

- **Status:** `live-prod` — The recipe itself ships: services/smart_room_recipe.py is reached from the Library and the chat designer, and the five-minute door-less occupancy hold (commit 6395ef32, frontend/src/components/automations/OccupancySensorForm.jsx + services/template_sensors.py) is an ancestor of release-2026.09.18-4. The mode conditions and hold-respecting turn-ons are NOT: commits 541a701f (services/recipes/smart_room.py, _NO_MOTION_LIGHTING on the day/night rules, _NOT_CLEANING on the off rule) and 7925074 (services/hold_migration.py) are on main only, so they run on the canary and on no customer home yet. The original recipe mechanics and the door-aware/multi-sensor occupancy are carried from automations-and-bundles.history.json and presence.reconciled.json without re-verification.
- **Layer:** Automations · **Audience:** user-facing
- **Shipped:** 2026-07-18 (`a0d8594`)
- **Built from:** `bundle-recipe-registry`, `bundle-executor`, `presence-state-machine`
- **Composes with:** `leaving-and-arriving` (via bundle-executor, bundle-recipe-registry, presence-state-machine), `actions-page-and-library` (via bundle-executor, bundle-recipe-registry), `buttons-from-chat` (via bundle-executor, bundle-recipe-registry), `home-modes` (via bundle-executor, bundle-recipe-registry), `more-ready-made-routines` (via bundle-executor, bundle-recipe-registry), `design-from-chat` (via bundle-executor) …and 3 more
- **Surfaces:** `services/smart_room_recipe.py`, `services/recipes/smart_room.py`, `services/room_presence_engine.py`, `services/presence_mqtt.py`, `frontend/src/components/automations/OccupancySensorForm.jsx`, `frontend/src/components/SmartRoomWizard.jsx`
- **Known gaps:** Ships fixed evening/morning clock times (19:00-06:30) instead of real sunrise/sunset, which drifts from reality in Israeli summer, and nobody has yet confirmed on real hardware that a still, sleeping person doesn't re-trigger the lights.; A separate, unapplied fix exists for the several-second lag before a radar-only sensor notices someone enter (fusing it with a cheap infrared sensor would make the light instant) — measured on a real hub, never rolled out.; A presence sensor that freezes in one state (worse than a dead one, because everything downstream keeps trusting it) is flagged as its own anomaly, separate from the room recipe itself.; Smart Room rules installed before 2026-09-19 predate the light-hold flag, so they still relight a light you switched off. They are upgraded in place by an hourly background pass rather than by the customer re-saving them, and a rule the customer built themselves in the wizard is deliberately never touched.

### 🟢 The Actions page and Library  `actions-page-and-library`

> One page for everything your home does, with a shelf of ready-made things to add.

Everything the home can do lives on one page split into Automatic ("it starts itself") and On-demand ("you start it") tabs, with a curated Library of ready-made options reachable from a header button. Each Library card shows a plain-language description and whether your home has the devices to run it — the Add button only lights up when it can actually work, so tapping it never opens a dead form. An installed action opens as a compact, faded summary of its settings with a pencil to edit, and every delete anywhere on the page goes through the same confirm-before-you-lose-it dialog.

- **Status:** `live-prod` — Carried from automations-and-bundles.history.json, a history-angle salvage extraction that was not independently re-verified in this compression pass. Cited sources: services/automation_templates.py, services/routine_templates.py, and the Actions page components under frontend/src/pages/, plus commits e5b0e49 and fb8fbf3 referenced in the source records.
- **Layer:** Automations · **Audience:** user-facing
- **Shipped:** 2026-06
- **Built from:** `bundle-recipe-registry`, `bundle-executor`
- **Composes with:** `buttons-from-chat` (via bundle-executor, bundle-recipe-registry), `home-modes` (via bundle-executor, bundle-recipe-registry), `leaving-and-arriving` (via bundle-executor, bundle-recipe-registry), `more-ready-made-routines` (via bundle-executor, bundle-recipe-registry), `smart-room` (via bundle-executor, bundle-recipe-registry), `design-from-chat` (via bundle-executor) …and 1 more
- **Surfaces:** `frontend/src/pages/Actions.jsx`, `services/automation_templates.py`, `services/routine_templates.py`, `services/capability_gating.py`
- **Known gaps:** An earlier read-only "look, don't touch" view lock on installed actions was tried, disliked by the operator, and reverted the same day — do not re-add it.; Six older templates and eleven bundled community blueprints were retired or hidden during a 2026-07-19 curation pass but are still loaded and parsed on every page request, a pure carrying cost.; A brief attempt to give quick-ask shortcuts a third tab on this page was rolled back when the page was simplified to two tabs; a custom quick-ask manager was parked and never finished.

### 🟢 The house reacts to you leaving or arriving  `leaving-and-arriving`

> Walk out and the house shuts down behind you; drive home and it's already cooling.

When everyone has genuinely left — confirmed by phone location, whole-house stillness, and the front door — the lights and air conditioning turn off and you get a notification, with an optional security alert if a sensor trips while nobody is home. Crossing a wide ring on the way back starts the air conditioning minutes before you arrive, and any confirmed arrival or departure can notify the rest of the household and trigger its own automations.

- **Status:** `live-prod` — Carried from automations-and-bundles.history.json and presence.reconciled.json (history/reconciled-angle, not independently re-verified) for the wizard, the pre-cool ring and the notification fan-out. Re-checked here: the guests guard sits in the presence fan-out (services/presence_side_effects.py, holding all_persons_left automations when services/modes.py blocks_everyone_left is true) and, separately, as an explicit condition in the chat-composed version (services/recipes/leave_home.py, commit 541a701f — on main, not in release-2026.09.18-4). The 2026-08-14 fix for turning off the AC on someone still in the room (commit 707e631) and the 9bdd487 fix for a false 1am trigger on app-open are cited directly in the source records.
- **Layer:** Automations · **Audience:** user-facing
- **Built from:** `bundle-executor`, `bundle-recipe-registry`, `presence-state-machine`, `presence-side-effect-fanout`, `zones-registry`
- **Composes with:** `smart-room` (via bundle-executor, bundle-recipe-registry, presence-state-machine), `actions-page-and-library` (via bundle-executor, bundle-recipe-registry), `buttons-from-chat` (via bundle-executor, bundle-recipe-registry), `home-location-and-places` (via presence-state-machine, zones-registry), `home-modes` (via bundle-executor, bundle-recipe-registry), `more-ready-made-routines` (via bundle-executor, bundle-recipe-registry) …and 4 more
- **Surfaces:** `services/ha_automations.py`, `services/presence_side_effects.py`, `services/local_automation_actions.py`, `frontend/src/components/LeaveHomeWizard.jsx`, `frontend/src/components/PrecoolWizard.jsx`
- **Known gaps:** Once killed the air conditioning on someone sitting in the room because the whole-house-quiet guard was a single instant snapshot rather than a sustained check — fixed 2026-08-14.; An earlier version wired to room motion/occupancy sensors instead of real presence turned off all the lights on someone simply sitting still (motion sensors go quiet after a few minutes); it was disabled and rebuilt on the presence engine, but the wizard template still lists motion as an option.; Opening the app while already at home used to fire the arrival ring at 1am, because the phone's operating system synthesizes an entry event for any ring you're already inside when you register it.; Guests mode only holds back the phone-based "everyone left". A Leave Home set up around a quiet house or the front door fires on a different trigger and runs regardless of guests — only the newer chat-composed version carries an explicit "not in Guests" condition, so a household with untracked visitors can still have the house shut down around them.

## Backup

### 🟢 Nightly encrypted home backup and disaster recovery  `home-backup-and-recovery`

> Every night your whole home setup is encrypted and copied off-site, so a dead hub costs you a box, not your house.

Every home backs itself up nightly to encrypted off-site storage, including its paired Zigbee devices so a restore doesn't force re-pairing the whole house (Matter/Thread state backup exists but only works on the canary's hardware today). Each home's backup is locked with a key only that home holds, wrapped so the company itself cannot read it; a founder-sealed copy of the wrap exists for the day a hub dies, unlockable only with a master key and every unlock attempt logged. A hub can be wiped back to a clean slate first taking a local snapshot of the old state. Restoring a whole home onto a replacement hub is built end-to-end but has never actually been run — the 18-step disaster-recovery rehearsal designed to prove it was overtaken by real deployments and its sign-off sheet is still blank.

- **Status:** `live-prod` — Commit 684f023: three real homes backing up nightly to B2 (David: 9.7 MB across 5 encrypted archives); key-seal step in imaging (scripts/factory/_seal_step.sh) completed on two customer hubs; Zigbee bundle only reliably included since f9129ce (earlier backups silently shipped without it, 'fatal for the pre-paired-kit DR model'). Restore is more conservative: scripts/factory/ziggy-restore-device.sh (e784411) exists with 29 tests but docs/ACCEPTANCE_TEST_BACKUP_DR.md's 18-row sign-off is entirely blank and memory project_beta_image_readiness calls restore 'unproven on hardware' — treated here as orphaned rather than canary-only, the more conservative of the two labels the source records disagreed on.
- **Layer:** Backup · **Audience:** operator
- **Built from:** `key-escrow-vault`, `protected-state-guard`, `audit-log-store`
- **Composes with:** `fleet-ops-console` (via audit-log-store), `founder-remote-support` (via audit-log-store), `safe-update-guarantee` (via protected-state-guard)
- **Surfaces:** `services/backup_engine.py`, `scripts/factory/_seal_step.sh`, `relay/app/routers/backup_keys.py`, `scripts/factory/ziggy-restore-device.sh`, `scripts/linux/ziggy-customer-reset.sh`, `frontend/src/pages/CloudAdmin.jsx`
- **Tests:** `docs/ACCEPTANCE_TEST_BACKUP_DR.md`
- **Known gaps:** Restoring a dead hub from backup has never been executed on real hardware — it is built, unit-tested, and unproven.; The relay's own database (which holds every home's wrapped key) has a backup pipeline but nothing schedules it — it is CLI-only.; A weekly-snapshot-promotion design (for a hub offline a month) was specified but never implemented on the hub side.; A paper-only master-key recovery procedure exists as documentation only, with no code or verification tooling.; Cancelling a subscription is supposed to stop new backups and erase old ones after 90 days; both depend on the billing system, which is orphaned (see subscription-billing), so neither can currently trigger.

## Chat & voice

### 🟡 Buttons, arrivals and departures from chat  `buttons-from-chat`

> Tell Ziggy what the wireless switch should do, or what should happen when you get home, and it builds it — no wizard needed.

The chat designer now knows the same things the app's builder knows: a paired wireless button and the presses it sends, arriving and leaving home on Ziggy's own presence engine, the five home modes, and the tested recipes (Smart Room, Motion Light, Welcome Home, Leave Home). It prefers a recipe when one fits, composes a rule only for what no recipe covers, drops anything it can't make honest — a condition that restates its trigger, an action in a room you didn't mention, a rule that only sends a notification — and lists every such thing under "Left out" on the preview card instead of announcing more than it built. What the preview promises is what apply produces: the plan names the recipes it will install, and applying reports back exactly those, so the card can never claim a routine the home did not get.

- **Status:** `canary-only` — canary-only: services/orchestra_designer.py prompt + services/bundle_lint.py + services/recipes/ with catalog support flags computed from the converters under a bidirectional drift test (tests/test_automation_catalog_drift.py). The defining commits — e50aea7, 541a701, 819a0cc (recipes-first schema, lint, honest left-outs), a0c4467 (recipe artifacts; preview and apply never overstate) and 1ebc3a0 (preview card shows recipes and left-outs) — are all in `git log release-2026.09.18-4..HEAD`, i.e. in no customer release tag. Replaces the 2026-09-18 behaviour where chat declined GPS arrivals and button presses that the app built in two taps.
- **Layer:** Chat & voice · **Audience:** user-facing
- **Shipped:** 2026-09-18 (`819a0cc`)
- **Built from:** `bundle-recipe-registry`, `bundle-executor`, `ha-truth-directory`, `intent-dispatcher`
- **Composes with:** `design-from-chat` (via bundle-executor, ha-truth-directory, intent-dispatcher), `actions-page-and-library` (via bundle-executor, bundle-recipe-registry), `assistant-agent-v2` (via ha-truth-directory, intent-dispatcher), `home-modes` (via bundle-executor, bundle-recipe-registry), `leaving-and-arriving` (via bundle-executor, bundle-recipe-registry), `more-ready-made-routines` (via bundle-executor, bundle-recipe-registry) …and 7 more
- **Surfaces:** `services/orchestra_designer.py`, `services/bundle_lint.py`, `services/recipes/__init__.py`, `services/automation_catalog.py`, `frontend/src/components/automations/BundlePreviewCard.jsx`, `frontend/src/pages/AIChat.jsx`
- **Known gaps:** Inbound webhooks stay declined on purpose until a security review; calendar, NFC-tag and template triggers remain genuine gaps.; Blueprint bodies (wait_for_trigger, choose, repeat) are still the only route to branching inside one rule; the designer builds one rule per case instead.; The home modes and held lights the designer can now reason about are themselves canary-only, so a customer home asked for a mode-aware routine today would be promised something its build cannot honour.

### 🟢 Chat and voice with Ziggy  `chat-with-ziggy`

> Type or say what you want in Hebrew or English and your home does it.

The chat and voice screen is the product's front door: say or type a sentence and Ziggy either performs the action, answers a question about the house, or asks one short clarifying question when it genuinely cannot tell what you meant. Replies come back as one short plain sentence in the language you used — no markdown, no jargon, no device ids — often beside a small tappable card: the device it just changed, the house as room tiles with chips you can press, an automation you can open. Tapping a card takes you to that object's own screen with the conversation docked beside it on a wide screen, and a pill back to chat on a phone. Conversations are real saved threads that survive a reload, keep running if you walk away, title themselves once they have something to be called, and are listed in a side drawer. On a phone Ziggy is a floating bubble on every screen that opens the same thread, input and mic as a bottom sheet. You can hold the mic to talk instead of typing and Ziggy speaks back in a natural Hebrew or English voice, with a "Said wrong?" button on any reply that came out mispronounced. Naming a saved routine ("good night") still runs it directly, before any brain is consulted at all.

- **Status:** `live-prod` — VERIFIED live-prod: intent_router is registered on the uvicorn-served app at backend/server.py:623 and carries POST /api/chat, /api/intent, /api/voice, /api/voice/transcribe, /api/direct-intent and the durable-thread CRUD at backend/routers/intent_router.py:499-526. Commits f245e42 (dual-path chat + threads), a0cac3e (thread ownership), fe08fde (threads in the chat page), 13f0767 (live titles), 6a7cd75 (Hebrew spoken-text stage + "Said wrong?"), 85b4a13 and c3ecf18 (interactive cards) and b428053 (phone bubble) are all ancestors of release-2026.09.18-4. Threads persist in the hub's own SQLite file (services/chat_threads.py). tests/test_chat_threads.py, tests/test_chat_threads_api.py, tests/test_chat_runner.py, tests/test_speech_text.py, tests/test_health_speech.py and tests/test_rehearsal.py pass (210 passed together with the agent suites, run 2026-09-19).
- **Layer:** Chat & voice · **Audience:** user-facing
- **Shipped:** 2026-05 (`c678d70`)
- **Built from:** `intent-dispatcher`, `voice-intent-registry-store`, `llm-relay-chat-client`, `assistant-engine-flag`
- **Composes with:** `assistant-agent-v2` (via assistant-engine-flag, intent-dispatcher), `home-fixer` (via assistant-engine-flag, llm-relay-chat-client), `buttons-from-chat` (via intent-dispatcher), `cloud-brain-relay` (via llm-relay-chat-client), `design-from-chat` (via intent-dispatcher), `household-organizer` (via intent-dispatcher) …and 2 more
- **Entry points:** `POST /api/chat`, `POST /api/intent`, `POST /api/voice`, `POST /api/voice/transcribe`, `POST /api/voice/tts/speak`, `POST /api/voice/tts/flag`, `GET/POST/PATCH/DELETE /api/threads`
- **Surfaces:** `frontend/src/pages/AIChat.jsx`, `frontend/src/components/chat/ChatCards.jsx`, `frontend/src/components/chat/ChatBubble.jsx`, `frontend/src/components/chat/ChatSheet.jsx`, `frontend/src/components/chat/ThreadList.jsx`, `backend/routers/intent_router.py`, `services/chat_threads.py`, `services/chat_runner.py` …and 9 more
- **Tests:** `tests/test_home_automation_intent.py`, `tests/test_voice_intents.py`, `tests/test_chat_threads.py`, `tests/test_chat_threads_api.py`, `tests/test_chat_runner.py` …and 2 more
- **Known gaps:** Only about 80% of a stress-test batch got a real answer before this was measured (78f4649); the reply-shape and confidence-gate rules still have no automated regression.; Phrase shortcuts now run before either brain, so naming a routine works on every home — but they match only an exact normalized phrase, and they match nothing at all on a fresh home until routines are actually added.; Hands-free wake word, a spoken 'chat mode', and the mic mute switch were all built but have no path that runs in a shipped home (the wake-word model was never trained, and the code lives on a thread the production container never starts).; Quick-ask shortcut chips still render on the dashboard and wall panel, but the page that used to create or edit them was removed in a 2026-06 refactor and is still not routed in the app, so nobody can add a new one.; Rehearsal mode — a full conversation where Ziggy reasons, replies and speaks for real but nothing reaches the house — ships off (`assistant.rehearsal`), and its in-chat toggle was deliberately removed on 2026-09-12 because it read as a feature rather than a safety net. A banner while it is on is now the only sign, and it is switched from settings; do not re-add the toggle.; "Said wrong?" records the line and re-rolls the cached audio, but the real fix is still a person adding that word to the pronunciation dictionary. Pointing whole Hebrew sentences with vowels was tried and made the voice measurably worse — do not re-try it.; A saved conversation belongs to the person who started it and cannot be shared or handed to someone else in the household; a security review found that any signed-in member could read and continue anyone's thread, and that was closed the same day (a0cac3e).; Email reading/sending and casting a photo album or calendar to a screen are still offered by the assistant but dead-end on missing configuration.; The original Telegram bot surface (Ziggy's first remote interface) was removed from the codebase in commit 50ac3f9; the project's own setup docs still mention it.

### 🟢 Design an automation by describing an outcome  `design-from-chat`

> Say what you want your home to do and review the whole plan before it happens.

Outcome-shaped requests ("make my kitchen smart", "design a morning routine") are routed to an automation designer instead of a plain chat reply. It decomposes what you asked for into a bundle of automations, sensors, stored state and spoken phrases, checked against the devices you actually own, and shows the whole plan as a card with accept and discard — nothing is created until you accept it. Once accepted, the whole bundle can later be deleted or edited as one unit; while it thinks, a short status line explains what it's doing instead of a blank spinner.

- **Status:** `live-prod` — VERIFIED live-prod (carried forward from chat-and-assistant.verified.json id=pro-mode-design-in-chat, re-checked here): design_automation_set and apply_automation_bundle are declared in core/tools_schema.py, and `git show release-2026.09.18-4:core/agent/tools.py` contains both design_automation and design_smart_room, reachable on every home because backend/routers/intent_router.py:97-117 defaults to the agent. Commits 9a17dd1 and cc79597 remain ancestors of the newest release tag; frontend/src/pages/AIChat.jsx renders the returned preview card. The bundle-delete/edit and thinking-label pieces are still carried from automations-and-bundles.history.json (an unverified history-angle extraction) and were not independently re-checked.
- **Layer:** Chat & voice · **Audience:** user-facing
- **Shipped:** 2026-06-25 (`cc79597`)
- **Built from:** `intent-dispatcher`, `bundle-executor`, `ha-truth-directory`
- **Composes with:** `buttons-from-chat` (via bundle-executor, ha-truth-directory, intent-dispatcher), `assistant-agent-v2` (via ha-truth-directory, intent-dispatcher), `actions-page-and-library` (via bundle-executor), `chat-with-ziggy` (via intent-dispatcher), `external-assistant-access` (via ha-truth-directory), `home-fixer` (via ha-truth-directory) …and 7 more
- **Entry points:** `intent design_automation_set`, `POST /api/automations/bundles/design`
- **Surfaces:** `core/tools_schema.py`, `core/handlers/automation_handler.py`, `core/agent/tools.py`, `frontend/src/pages/AIChat.jsx`
- **Tests:** `tests/test_smart_room_recipe.py`
- **Known gaps:** Routing is unreliable by design record: the model reads a rule as two literal example phrases instead of a whole class of requests, so "make the kitchen smart" has been seen to miss; several rounds of prompt-widening have not been re-validated end to end.; "Make a room smart" can land on either of two things — the free-form designer or a separate, more deterministic recipe (day-bright/night-dim/off-when-empty, never on a sleeping person). Both now ship on every home, so which one you get is down to how the sentence is read, not to which build you are on.; The confirmation card used to auto-focus Accept, so a stray Enter keystroke could apply a bundle nobody clicked; a room with no occupancy sensor cannot be made smart from chat at all.

### 🟢 The fixer — why it broke, and the fix  `home-fixer`

> Ask why the lights went off, or why the new device won't connect, and get a straight answer plus the fix.

Ask Ziggy why something happened, or why it didn't, and it answers from what the home actually recorded rather than guessing: what turned a light off (an automation, a person, the device itself), why a light did not come on when you walked in (the device is unreachable, you had switched it off and Ziggy is honouring that, a sensor went quiet, an automation never triggered or stopped on its conditions), which devices have gone silent, and why a new device won't finish connecting — a wedged radio, a device that stalled halfway through introducing itself, or a pairing window that simply isn't open. Where there is a safe fix, Ziggy takes it and tells you; reconnecting the home notifies you with a short window to undo; anything that changes configuration or pairing needs your explicit yes first, and anything touching the machine itself is refused outright. Every answer comes back as a card you can tap, in plain Hebrew or English with no engine words in it.

- **Status:** `live-prod` — VERIFIED: the diagnose-and-repair tools (check_home_health, diagnose_device, refresh_device, recover_connectivity, list_down_devices, diagnose_pairing, explain_device_change, explain_missing_action, repair_history) are declared in core/agent/tools.py and reach every home because the agent is now the default brain (backend/routers/intent_router.py:97-117 returns "v2"; intent_router registered on the uvicorn app at backend/server.py:623). Commits cea7bf2, dd5d70a, 2594407, 14ecb12, 2e2b51b and c768f04 are all ancestors of release-2026.09.18-4 (git tag --contains). State-changing fixes are gated below the model by core/agent/authz.py, whose principal is seeded at startup via services/permissions/reconcile.py:199-200, reached from backend/server.py:291. Results render as why_not / home_health / down_devices / repair_history / needs_approval cards (frontend/src/components/chat/ChatCards.jsx:1242-1256). tests/test_agent_fixer_tools.py, tests/test_why_not.py, tests/test_cause_tracer.py, tests/test_pairing_doctor.py and tests/test_agent_autonomy_gate.py pass (77 passed, run 2026-09-19).
- **Layer:** Chat & voice · **Audience:** user-facing
- **Shipped:** 2026-09-06 (`cea7bf2`)
- **Built from:** `ha-truth-directory`, `assistant-engine-flag`, `llm-relay-chat-client`
- **Composes with:** `assistant-agent-v2` (via assistant-engine-flag, ha-truth-directory), `chat-with-ziggy` (via assistant-engine-flag, llm-relay-chat-client), `buttons-from-chat` (via ha-truth-directory), `cloud-brain-relay` (via llm-relay-chat-client), `design-from-chat` (via ha-truth-directory), `external-assistant-access` (via ha-truth-directory)
- **Entry points:** `POST /api/chat`, `POST /api/actions/{name}`, `tool explain_device_change`, `tool explain_missing_action`, `tool diagnose_pairing`
- **Surfaces:** `core/agent/tools.py`, `core/agent/health_speech.py`, `core/agent/authz.py`, `services/cause_tracer.py`, `services/why_not.py`, `services/pairing_doctor.py`, `services/down_device_detector.py`, `frontend/src/components/chat/ChatCards.jsx`
- **Tests:** `tests/test_agent_fixer_tools.py`, `tests/test_why_not.py`, `tests/test_cause_tracer.py`, `tests/test_pairing_doctor.py`, `tests/test_agent_autonomy_gate.py` …and 1 more
- **Known gaps:** The permission ladder is a guardrail, not a wall: when the home's policy store was never set up, or the check itself errors, the fix runs anyway instead of being refused. That is deliberate — an older home must not lose repairs it always had — but it means the 'ask me first' tiers only bite once the store exists.; Ziggy finding a silent device on its own is off by default (`anom13_down_sweep_enabled`, and the acting half behind `auto_repair_ladder`): run unattended every hour it called untouched lights dead, told two homes to refit the battery on Ziggy's own virtual sensors, and produced roughly 130 pushes a day on the Canary, so it was disabled on 2026-09-17 until there is a real liveness signal. Asking Ziggy what is not responding still works.; The lookback is short: 'why didn't it?' reads the last three hours and 'what changed it?' the last twenty-four, so a fault older than that reads as 'nothing happened' — the same shape as the balcony automation that had been silently broken for days.; The pairing answer is read-only by design: it tells you which of the five causes you have, but will not restart the radio or finish the introduction for you.; A device that has genuinely self-recovered can still be reported as down on the first look, because the verdict is provisional and nothing re-checks it before answering.

### 🟢 Ziggy's brain — one agent behind every answer  `assistant-agent-v2`

> Ziggy turns off the lamp you actually named, not the nearest guess.

One tool-calling agent now handles every chat and voice turn, in place of the old split of command parser, chat classifier and automation designer. It is handed a live, accurate list of every device with its real name, real room and current state, so "turn off the living room lamp" hits the lamp and not the entry light, and when two devices could match it asks one short question instead of guessing. Each turn also carries the state of the house around it — which mode the home is in, which lights are being held off, and what you just did with your thumbs in the app — so "why is the kitchen light on?" can answer "you turned it on at 21:04". One written persona keeps the voice the same in Hebrew and English, replies can come back as a tappable card instead of a wall of prose, and asking what Ziggy can do is answered from its own published capability record rather than invented. Saying "claude ziggy" flips the conversation into a deeper technician mode for as long as you want it.

- **Status:** `live-prod` — VERIFIED live-prod: backend/routers/intent_router.py:97-117 resolves the engine as per-request override > ZIGGY_ASSISTANT_ENGINE > settings `assistant.engine` > "v2", i.e. the agent is the default everywhere, and config/settings.example.yaml:453-455 now ships `assistant: engine: v2`. Commit ea9e6d4b ("engine v2 by default for every home") is an ancestor of release-2026.09.18-4, and `git show release-2026.09.18-4:backend/routers/intent_router.py` returns "v2" at line 118. 35 tools are declared in core/agent/tools.py; the loop runs up to six tool rounds (core/agent/runner.py:36). tests/test_agent_v2.py, tests/test_agent_persona.py, tests/test_agent_tools_v3.py, tests/test_actions_registry.py, tests/test_chat_diagnostic_mode.py and tests/test_agent_runner_loop.py pass (run 2026-09-19).
- **Layer:** Chat & voice · **Audience:** user-facing
- **Shipped:** 2026-07-18 (`ea9e6d4`)
- **Built from:** `ha-truth-directory`, `assistant-engine-flag`, `intent-dispatcher`
- **Composes with:** `buttons-from-chat` (via ha-truth-directory, intent-dispatcher), `chat-with-ziggy` (via assistant-engine-flag, intent-dispatcher), `design-from-chat` (via ha-truth-directory, intent-dispatcher), `home-fixer` (via assistant-engine-flag, ha-truth-directory), `external-assistant-access` (via ha-truth-directory), `household-organizer` (via intent-dispatcher) …and 1 more
- **Entry points:** `core.agent.runner.run_agent`, `POST /api/chat`, `POST /api/voice`, `GET /api/actions`
- **Surfaces:** `core/agent/runner.py`, `core/agent/tools.py`, `core/agent/directory.py`, `core/agent/persona.py`, `core/agent/context.py`, `core/agent/output.py`, `core/actions/registry.py`, `services/capability_lookup.py` …and 3 more
- **Tests:** `tests/test_agent_v2.py`, `tests/test_agent_persona.py`, `tests/test_agent_tools_v3.py`, `tests/test_actions_registry.py`, `tests/test_chat_diagnostic_mode.py` …and 2 more
- **Known gaps:** The hand-picked tool set has grown from about 20 to 35, and every tool is at the same time an app action and a tool an outside assistant can call — but notes and files, calendar events, media casting and memory recall are still outside it, even though they work over the app's direct-action path.; The older brain has not gone away: it is still selectable per request, by environment variable or by setting `assistant.engine: v1`, and it is the silent fallback if the agent fails to load — so a home can be running last year's behaviour with nothing on screen saying so.; Letting Ziggy look through a camera and describe what it sees is still not real: the action registry reserves a slot for it, but the module behind it has never been committed on any branch and exists only on one machine.; Deeper technician answers are gated on the home's `diagnostics` entitlement, so on a home without it the trigger phrase does nothing.; Setting a home mode and releasing a held light are the newest two tools and are not in any release tag yet — they run on the Canary only.

## Climate & light

### 🟡 A light you switched off stays off  `light-hold`

> Turn a light off yourself and motion won't put it straight back on — Ziggy remembers you decided.

When a person turns a light off — wall switch, the app, chat or voice; anything that isn't one of Ziggy's own engines — Ziggy holds it off so Smart Room and Motion Light leave it alone. Turning it on yourself clears the hold. The room being empty for thirty minutes releases it. If a rule then relights it and you switch it off again, Ziggy concludes "off tonight" and holds it until the morning time. The light's tile shows "Held" with a Release action, and asking "why didn't the kitchen light come on?" gets the honest answer — you turned it off yourself — with the option to release it right there in the conversation.

- **Status:** `canary-only` — VERIFIED: engine at services/light_hold.py (shipped by commit bb8959ba), reached from the production entrypoint, not from ziggy_main — services/ziggy_scheduler.py:514 runs the release tick every minute and lines 523-526 run services/hold_migration.py shortly after boot then hourly, while backend/server.py:718,722 mounts backend/routers/light_hold_router.py. Manual-off/on attribution hook at services/ha_subscriber.py:318-322 (engine tier via services/manual_overrides.py `was_ziggy_initiated`); automation attribution hook at services/ha_subscriber.py:400-404. Shipped on by default and NOT flag-gated: `light_hold.enabled: true` at config/settings.example.yaml:603-606. Chat surface at core/agent/tools.py:426 (`release_light_hold`) and verdict `light_held` at services/why_not.py:23,194,218; tile at frontend/src/components/device/DeviceCard.jsx:588,696. Status confirmed canary-only mechanically: `git tag --contains bb8959ba` is empty while the newest tag release-2026.09.18-4 is an ancestor of HEAD, and both commits are on origin/main. Field-corrected 2026-09-19 (commit 7925074e) after the operator's office lamp was relit seconds after a manual off: an automation Home Assistant executed natively set no attribution tier and read as the person, erasing the hold (light_hold.note_automation_fired closes that), and the already-installed recipes predated respect_hold (services/hold_migration.py). Covered by tests/test_light_hold.py, test_light_hold_attribution.py, test_light_hold_hooks.py, test_light_hold_router.py, test_hold_migration.py, test_executor_hold_gate.py, test_why_not_hold.py.
- **Layer:** Climate & light · **Audience:** user-facing
- **Shipped:** 2026-09-18 (`bb8959ba`)
- **Built from:** `bundle-executor`, `ziggy-write-attribution-tiers`
- **Composes with:** `actions-page-and-library` (via bundle-executor), `buttons-from-chat` (via bundle-executor), `design-from-chat` (via bundle-executor), `home-modes` (via bundle-executor), `leaving-and-arriving` (via bundle-executor), `more-ready-made-routines` (via bundle-executor) …and 3 more
- **Surfaces:** `services/light_hold.py`, `services/ha_subscriber.py`, `services/local_automation_actions.py`, `backend/routers/light_hold_router.py`, `frontend/src/components/device/DeviceCard.jsx`, `services/why_not.py`, `services/hold_migration.py`
- **Known gaps:** A rule the customer built themselves in the wizard still switches a held light on — only Ziggy's own recipes ask about the hold, and the background upgrade pass deliberately leaves wizard-built rules alone rather than silently adding a condition the customer never asked for. It no longer erases the hold when it fires, so the hold survives until the room empties.; Recipe automations installed before 2026-09-19 are upgraded in place by a background pass that runs shortly after startup and then hourly, rather than by the customer re-saving them; until that pass runs, they relight a held light.; A rule that never came from Ziggy — written by hand straight into the home's underlying engine — leaves no steps Ziggy can read, so its relight is still read as a person and clears the hold. That is the honest answer when Ziggy genuinely cannot tell who acted, but it is a real hole.; Crediting a turn-on to a rule rather than to a person is a twenty-second window after that rule fires. Switch the light on yourself inside it and Ziggy credits the rule, so your hold quietly stays in place instead of clearing. The error leans the safe way on purpose, but it can surprise.; A light with no room assigned has nothing to watch for "empty", so its hold simply times out thirty minutes after you switched it off, whether or not anyone is still in the room.; Lights only — a fan or a plug switched off by hand is still governed by the older 30-minute manual-override window.; Hold-aware turn-ons run through Ziggy rather than natively in Home Assistant, one extra hop; measured on the Canary as part of acceptance.

### 🟢 Save and recall a light's look  `light-presets`

> Save a light exactly as it looks right now and get it back in one tap.

On a light's card you can save its current brightness and colour as a named pill — up to six per light — and recall it with a tap; the pill that matches the light's live state is highlighted. Marking one as the default means a plain "turn on" for that light, from the app, chat, voice, or an automation, quietly wakes it in that exact look, and Ziggy also fixes the physical bulb's own power-on behaviour so a wall-switch power cut boots straight back into it instead of a brief default-brightness flash.

- **Status:** `live-prod` — Carried from climate-and-lighting.history.json (history-angle salvage, not independently re-verified). Cited sources: a device-presets store at user_files/device_presets.json in the source records, and a specific fix for reading a bulb's power-on-behaviour setting around a Home Assistant API quirk (trimmed `options` attribute) documented directly in the source.
- **Layer:** Climate & light · **Audience:** user-facing
- **Built from:** `device-presets-store`
- **Surfaces:** `services/device_presets.py`, `frontend/src/components/LightCard.jsx`
- **Known gaps:** A default preset loses to the Smart Light Schedule on a scheduled light, because the schedule's own turn-on step runs last — the card is honest about this ("On the schedule — default won't apply") but there is no per-light opt-out that lets both coexist.; The power-on-behaviour fix only reaches bulbs that expose the right underlying setting (mainly IKEA-style bulbs); anything else is silently skipped, and a bulb that's off when the default is saved only self-heals on its next power-on.; Presets are per-device only by design — no whole-room or whole-home saved looks, and no presets for climate or fan devices despite the storage format being generic enough for it.

### 🟢 Smart Climate Control  `smart-climate-control`

> Pick a comfortable range and Ziggy keeps the room there, whatever the AC is.

Ziggy watches a room's real temperature and switches a device on and off around the comfort band you set, never sending a target temperature to the device — Ziggy owns the cutoff itself. Because of that, the same setup drives a smart AC, an infrared-controlled AC, a fan, or a plug-in heater alike, with cooling and an optional heating edge, and it only ever turns off something it turned on. If a room has several thermometers, it can watch their average instead of picking one arbitrarily.

- **Status:** `live-prod` — Carried from automations-and-bundles.history.json and climate-and-lighting.history.json (two independent history-angle extractions that agree, neither independently re-verified in this pass). Cited sources: a per-room thermostat engine and user_files/smart_climate_config.json referenced in both source records; a real shipped-dead incident is cited directly (commit 4e98a0d broke both this and Smart Room with an ErrorBoundary crash for a period, fixed at fb8fbf3 on 2026-08-07).
- **Layer:** Climate & light · **Audience:** user-facing
- **Built from:** `smart-climate-engine`, `ziggy-write-attribution-tiers`
- **Composes with:** `light-hold` (via ziggy-write-attribution-tiers), `smart-light-schedule` (via ziggy-write-attribution-tiers)
- **Surfaces:** `services/smart_climate_engine.py`, `frontend/src/components/SmartClimateWizard.jsx`
- **Known gaps:** Hardware gate open per project memory (project_smart_climate_control.md): the Canary hub had zero climate entities and zero registered infrared ACs at last check, so the device picker was empty for every room and real switching has never been operator-validated.; An earlier one-shot version simply set a smart AC to cool at a fixed 22 degrees C, fighting the Israeli 24-degree default and always claiming success even when nothing was reachable — replaced by the current engine, but its catalog entry is still declared.; The set of sensors a room averages is captured at save time; adding a new thermometer to the room later requires re-saving to pick it up.

### 🟢 Smart Light Schedule  `smart-light-schedule`

> Your lights follow the day on their own — bright and crisp at midday, warm and soft by bedtime.

You pick a day-peak look and a night-floor look plus your wake time and bedtime; Ziggy continuously works out the right warmth and brightness for the current minute and eases the lights there, all afternoon, instead of holding harsh midday light until sunset. A light turned on mid-day joins the ramp instantly, and if you adjust a scheduled light by hand, Ziggy backs off for a grace window and then quietly hands it back — or you can tap Sync now to snap everything back in line immediately.

- **Status:** `live-prod` — Carried from automations-and-bundles.history.json and climate-and-lighting.history.json (two independent history-angle extractions that agree, neither independently re-verified in this pass). Cited sources: a circadian ramp engine file and user_files/circadian_config.json referenced in both source records; a real timezone bug (the ramp ran on container UTC for two days, fixed 2026-07-22 at commit 41f6dce) and a self-sabotage bug (Ziggy mistook its own delayed Zigbee confirmations for a hand change, fixed at commit 95370eb) are both cited directly in the sources.
- **Layer:** Climate & light · **Audience:** user-facing
- **Built from:** `circadian-ramp-engine`, `ziggy-write-attribution-tiers`
- **Composes with:** `light-hold` (via ziggy-write-attribution-tiers), `smart-climate-control` (via ziggy-write-attribution-tiers)
- **Surfaces:** `services/circadian_engine.py`, `frontend/src/components/LightScheduleWizard.jsx`, `backend/routers/automation_router.py`
- **Known gaps:** The whole-day ramp was replaced from an earlier design that wrote four fixed Home Assistant automations at sunrise/noon/sunset/bedtime, which held harsh midday light for about eight hours and only re-tinted lights that happened to already be on — that legacy path is superseded but leftover code and dead UI strings for it still ship.; Solar noon is a fixed config value (12:00), not a real computed solar noon, despite that being the original intent.; A day spent watching the schedule with no drift and no manual Sync tap has not yet been recorded as a passed real-life test.

## Cloud & billing

### 🟢 Founder remote support access  `founder-remote-support`

> Support can get into a customer's hub to help, see whose phone is actually connected, and every visit is written down.

An operator can open a time-boxed, on-the-record support session into a specific home over its tunnel, see which of the customer's phones are actually paired versus just claimed to be, and safely retire a home that is really gone (while a live one can't be deleted by accident). A hook to notify the customer when a support session opens exists but has never actually fired.

- **Status:** `live-prod` — relay/app/routers/support_session.py (f4a26cf) with relay/tests/test_relay_support_session.py and scripts/linux/ziggy-support-access.sh, hardened in 7ee278e after adversarial review found a critical ungated SSH ingress; home-delete guard in 733feac with tests/test_relay_home_delete_guard.py; mobile-device view in b171be5.
- **Layer:** Cloud & billing · **Audience:** operator
- **Built from:** `audit-log-store`, `push-notification-channel`
- **Composes with:** `fleet-health-and-repair` (via push-notification-channel), `fleet-ops-console` (via audit-log-store), `home-backup-and-recovery` (via audit-log-store)
- **Surfaces:** `relay/app/routers/support_session.py`, `scripts/linux/ziggy-support-access.sh`, `relay/app/routers/fleet.py`, `relay/app/routers/mobile_admin.py`, `docs/RUNBOOK_SUPPORT_TUNNEL.md`
- **Known gaps:** Revoke cannot actually end host SSH access today — the relay itself cannot SSH in, so key removal happens host-side.; The customer-notification webhook (ZIGGY_CUSTOMER_NOTIFY_URL) is unset everywhere; no customer has ever been notified that support opened their home.; Support access depends on the home's own Cloudflare tunnel being up — a home whose tunnel is down can't be reached this way.

### 🟢 Reach and share your home from anywhere  `remote-home-access`

> Open the app from anywhere in the world, at a name you can say out loud, and your house answers.

A Cloudflare tunnel makes every home reachable from outside its own LAN, bound at provisioning time to a friendly address like david.ziggy-home.com instead of a wall of hex. A family member can also be sent a presence-sharing link that starts reporting their phone as home without ever creating them an account. The cloud also tells each home what its own public address is, on every check-in, so a screen that has to hand out a link — connecting an outside assistant to the house, for one — offers the address that works from the internet instead of the raw tunnel name nobody outside can reach.

- **Status:** `live-prod` — relay/app/routers/proxy.py is the WS/HTTP tunnel catch-all (relay/app/main.py); friendly-alias binding shipped in 8a633de with David pinned to david.ziggy-home.com; relay/app/routers/public_presence.py mounted ahead of the catch-all. Refreshed 2026-09-19: the home's public address (homes.public_hostname) now rides both the signed manifest (relay/app/routers/ota.py:302, 270f1755) and the five-minute telemetry reply (relay/app/routers/telemetry.py:186-191, 511e9c9b), is cached by services/entitlements.py public_url() and read by backend/routers/external_tokens_router.py:25-45 when it builds the address shown in Settings. Both commits are ancestors of release-2026.09.18-4.
- **Layer:** Cloud & billing · **Audience:** user-facing
- **Built from:** `relay-hmac-signature`
- **Composes with:** `cloud-brain-relay` (via relay-hmac-signature), `hub-connection-resilience` (via relay-hmac-signature), `hub-provisioning-and-imaging` (via relay-hmac-signature)
- **Surfaces:** `relay/app/routers/proxy.py`, `relay/app/provisioner.py`, `relay/app/routers/public_presence.py`, `docs/ARCHITECTURE_RELAY.md`
- **Known gaps:** A bare cfargotunnel.com URL was not routable from Fly for months until an explicit hostname-pin endpoint landed.; Presence-link sharing is single-tenant by construction — it 503s once more than one active home exists, a live constraint with three homes provisioned.; A home only learns its public address if the cloud has one recorded against it; where that is blank the app still falls back to showing the raw tunnel address — honest about what exists, but not routable from outside.

### 🟠 Subscription billing (Stripe)  `subscription-billing`

> A customer subscribes, and the cloud knows who has paid, what price they locked in, and what to do when they stop.

A full Stripe-backed billing system was built: checkout and webhooks, a kill switch that turns off cloud extras (not the house) when payment lapses, founder-pricing slots for the first thirty customers, Israeli VAT-compliant invoice numbering, a 90-day grace period before cancelled backups are erased, an app banner explaining what still works without the cloud, and an iOS pricing-string guard to keep the app inside Apple's in-app-purchase rules. Each plan now also carries the list of extras it unlocks — diagnostic conversations, letting Ziggy apply a repair on its own, and Ziggy explaining what it changed — and the cloud hands every home its plan name and that list on the same five-minute check-in the home already makes, so a hub can gate those features without ever holding billing details of its own. The resolver deliberately fails open: a home with no plan, or a plan the cloud does not recognise, gets everything, because a billing hiccup must never strip a paying home of something it relies on.

- **Status:** `orphaned` — Still orphaned. Nine commits (0f28331..959f23a, 2026-05-28) built the whole Stripe pipeline and it is mounted in relay/app/main.py, but no Stripe price or key is configured anywhere in the repo — relay/app/billing/plans.py still raises PlanMisconfiguredError at call time, so every real checkout fails and every home stays permanently 'active'. No pricing page was ever built; marketing copy in frontend/src/lib/i18n/en.js still promises 'No subscription, no foreign servers reading your sensors.' New since the last build (all three commits are ancestors of release-2026.09.18-4, the newest tag): per-plan feature sets and entitlements_for() in relay/app/billing/plans.py:48-133 (8b156122), carried in the signed OTA manifest at relay/app/routers/ota.py:293-302 and — the channel that actually reaches homes — in the telemetry reply at relay/app/routers/telemetry.py:180-194 (511e9c9b), cached hub-side by services/entitlements.py and read by backend/routers/intent_router.py:152-154 (diagnostic mode) and services/repair_ladder.py:178-182 (auto-repair). The telemetry post itself runs from services/ziggy_scheduler.py:114, a production entrypoint, so the delivery path is live even though billing is not. Relay deployment to Fly was not verified in this pass; relay code ships by deploy, not by release tag.
- **Layer:** Cloud & billing · **Audience:** user-facing
- **Surfaces:** `relay/app/billing/stripe_provider.py`, `relay/app/billing/plans.py`, `relay/app/billing/invoice.py`, `relay/app/billing/retention.py`, `frontend/src/components/SubscriptionGateBanner.jsx`, `scripts/ios_pricing_string_guard.py`, `relay/app/routers/ota.py`, `relay/app/routers/telemetry.py` …and 2 more
- **Known gaps:** The 90-day post-cancellation deletion job has no scheduler wired to it anywhere in the repo — the deletion promise is not currently kept by anything.; Founder-pricing-slot reservation is unreachable because it lives inside the same broken checkout call.; The iOS pricing-string CI guard has no CI to run in — the repo has no .github/workflows.; Every home resolves to the full feature set today — all three plans grant everything and the resolver fails open — so nothing a customer can see is actually gated by their plan yet; the plumbing is wired but has never been exercised in anger.; The signed update manifest was the intended carrier for plan and entitlements, but it is only served to homes that have cloud release rows, which the git-tag update fleet does not have — the five-minute check-in reply is the channel that actually reaches homes, and the manifest path has delivered this to none of them.; The hub-side cache fails open too: a home that has never reached the cloud, or whose cache file is unreadable, behaves as fully entitled — the right default, but it means an entitlement can never be proven to have been withheld.

## Daily life

### 🟢 Tasks, notes and dates, kept on the hub  `household-organizer`

> A shared to-do list, notes and countdowns that live on your hub, not in the cloud.

Anyone in the home can add a task with a due date, priority and checklist, ask Ziggy by chat or voice to add/list/complete/postpone one ("remind me to call mom tomorrow"), and get a push notification when it's due. Ziggy can also save and read back notes and files, and track named dated events so you can ask "how many days until the trip". Everything is stored on the hub itself, so it survives a restart and needs no cloud account.

- **Status:** `live-prod` — Chat/voice access to tasks, notes and events is VERIFIED live-prod (chat-and-assistant.verified.json id=assistant-notes-tasks-reference): core/action_parser.py merges the file/task/event/reference handlers, reached from POST /api/chat on the router registered at backend/server.py:605, present in release-2026.08.14-8. The Tasks page UI, the due-date reminder loop and the countdown feature are carried from tasks-events-weather.code.json — a code-only extraction pass that was not independently re-verified in this compression, citing backend/routers/task_router.py, services/task_manager.py and services/event_manager.py.
- **Layer:** Daily life · **Audience:** user-facing
- **Shipped:** 2026-03
- **Built from:** `intent-dispatcher`
- **Composes with:** `assistant-agent-v2` (via intent-dispatcher), `buttons-from-chat` (via intent-dispatcher), `chat-with-ziggy` (via intent-dispatcher), `design-from-chat` (via intent-dispatcher), `live-answers` (via intent-dispatcher)
- **Entry points:** `POST /api/chat`, `GET/POST /api/tasks`, `intent add_task`, `intent get_next_event`
- **Surfaces:** `core/handlers/task_handler.py`, `core/handlers/file_handler.py`, `core/handlers/event_handler.py`, `services/task_manager.py`, `services/event_manager.py`, `core/task_file.py`, `backend/routers/task_router.py`, `frontend/src/pages/Tasks.jsx`
- **Known gaps:** The notes/files half has had no frontend surface or feature commit in a long time and is only reachable through chat's direct-intent path, not the v2 assistant.; The task list has real correctness bugs in the source extraction: creating a task under concurrent load can attach details to the wrong record, and editing a task can never clear a field back to empty.; Date countdowns and the Tasks page track two completely separate, unlinked event files, and a countdown marked to repeat never actually recurs.

### 🟢 Weather and live web answers  `live-answers`

> Ask about the weather, the news or a price and get a real, current answer.

A dashboard tile always shows the current temperature and sky for your city, refreshed automatically. Asking Ziggy about the weather, the news or anything else that needs current outside information is detected and sent down a live web-search path rather than left to the model to make up — weather questions are automatically filled in with your home's city so you don't have to say it.

- **Status:** `live-prod` — The chat/voice half is VERIFIED live-prod (chat-and-assistant.verified.json id=live-web-answers): _LIVE_DATA_PATTERNS detector in core/handlers/chat_handler.py, reached from the router registered at backend/server.py:605; commit 78f4649 is an ancestor of release-2026.08.14-8. The dashboard weather tile is carried from tasks-events-weather.code.json (unverified code-angle extraction), citing services/weather.py and a weather_router — not independently re-checked here.
- **Layer:** Daily life · **Audience:** user-facing
- **Shipped:** 2026-06-23 (`78f4649`)
- **Built from:** `intent-dispatcher`
- **Composes with:** `assistant-agent-v2` (via intent-dispatcher), `buttons-from-chat` (via intent-dispatcher), `chat-with-ziggy` (via intent-dispatcher), `design-from-chat` (via intent-dispatcher), `household-organizer` (via intent-dispatcher)
- **Entry points:** `core.handlers.chat_handler.handle_chat_with_gpt`, `GET /api/weather`
- **Surfaces:** `core/handlers/chat_handler.py`, `core/agent/tools.py`, `services/web_manager.py`, `core/handlers/web_handler.py`, `backend/routers/weather_router.py`, `frontend/src/wall/modules/CoreModules.jsx`
- **Known gaps:** Live web answers require a search-provider API key; without one, every current-events question answers "couldn't find that."; The weather endpoint is, by the source extraction, the one route in this area reachable without authentication, contrary to a comment saying otherwise.; A per-tile city override on the dashboard is silently dropped before it reaches the server, so every tile effectively shows the same default city.

## Devices

### 🟢 Add a Device  `add-a-device`

> Add anything to your home from one screen, whatever kind of thing it is.

One wizard covers joining Zigbee, Wi-Fi and Israeli Switcher devices to the home. You pick a device type, Ziggy searches or opens a join window, and when it finds something you name it and give it a room. Slow-pairing devices such as TVs that show a PIN get an honest wait instead of a premature timeout, and a Switcher account token is asked for once and reused for every later Switcher device.

- **Status:** `live-prod` — frontend/src/components/PairingWizard.jsx PROTOCOLS list; backend/routers/pairing_router.py registered at backend/server.py:608; Zigbee via services/ha_zigbee.py (commit 754c77e); Wi-Fi config-flow via commit e05ba33; Switcher via services/switcher_pairing.py + services/switcher_account.py; slow-pairing fix commit 19f4c56 with tests/test_config_flow_pairing.py.
- **Layer:** Devices · **Audience:** user-facing
- **Built from:** `device-and-room-registry`
- **Composes with:** `buttons-and-remotes` (via device-and-room-registry), `device-lifecycle-management` (via device-and-room-registry), `home-screen` (via device-and-room-registry), `interactive-floor-plan` (via device-and-room-registry), `ir-wifi-merged-device` (via device-and-room-registry), `matter-commissioning` (via device-and-room-registry) …and 6 more
- **Surfaces:** `frontend/src/components/PairingWizard.jsx`, `backend/routers/pairing_router.py`, `services/ha_zigbee.py`, `services/switcher_pairing.py`, `services/switcher_account.py`, `frontend/src/components/ConfigFlowRunner.jsx`
- **Tests:** `tests/test_config_flow_pairing.py`
- **Known gaps:** Protocol-first, not brand-first: you must know whether a device is Zigbee or Wi-Fi; the brand-name catalog designed to hide that (picking 'Roborock' instead of a radio protocol) was never built (docs/superpowers/specs/2026-07-06-device-pairing-and-ir-enrichment-design.md §3.2).; Z-Wave has a tab in the wizard but no hub ships a Z-Wave radio, so it fails every time it's tried (backend/routers/pairing_router.py:131).; A half-driven Wi-Fi discovery flow is consumed and the device disappears from the list until a rescan.

### 🟢 Buttons and remotes are devices  `buttons-and-remotes`

> A wall button or scene remote finally shows up in Ziggy — name it, give it a room, and make any press run whatever you like.

A wireless button, scene switch or cube holds no state, so it used to be invisible: it would pair perfectly and then appear nowhere in the app, unnameable and unusable. Each one now gets its own card in a "Buttons & Remotes" section of the device list, showing how many buttons it has and naming each press in plain words — single, double, long press, left, right. You rename it and put it in a room from its Info tab, and every press it can send is offered as the starting trigger for an automation, either in the builder or by simply telling Ziggy what that button should do.

- **Status:** `live-prod` — VERIFIED: services/controllers.py (commit b96514b9) is re-read every two minutes by the _controllers_refresh_tick job in services/ziggy_scheduler.py — a production entrypoint, not core/ziggy_main.py — and served by backend/routers/device_router.py (GET /api/controllers, and folded into /api/devices/grouped and the room grouping). `git tag --contains b96514b9` lists release-2026.09.17 through the newest tag release-2026.09.18-4. A press compiles to a trigger in services/ha_automations.py (_controller_trigger_to_ha) and is validated against the house in core/handlers/automation_handler.py (_resolve_controller_trigger); the card and picker are frontend/src/lib/domainRegistry.js (domain "controller", group "controllers"), frontend/src/stores/deviceStore.js and frontend/src/components/automations/wizard/TriggerEditor.jsx. Five follow-up fixes — 888472d8, 950e69e8, db8646ab, 0c563cf8, 9ba1b214 — made rename and room assignment actually stick.
- **Layer:** Devices · **Audience:** user-facing
- **Built from:** `device-and-room-registry`, `scheduler-tick-loop`
- **Composes with:** `add-a-device` (via device-and-room-registry), `device-and-automation-runtime` (via scheduler-tick-loop), `device-lifecycle-management` (via device-and-room-registry), `fleet-health-and-repair` (via scheduler-tick-loop), `guided-home-setup` (via scheduler-tick-loop), `ha-update-advisor` (via scheduler-tick-loop) …and 10 more
- **Surfaces:** `services/controllers.py`, `services/ha_automations.py`, `backend/routers/device_router.py`, `backend/routers/pairing_router.py`, `core/handlers/automation_handler.py`, `frontend/src/lib/domainRegistry.js`, `frontend/src/stores/deviceStore.js`, `frontend/src/pages/Devices.jsx` …and 2 more
- **Tests:** `tests/test_controllers.py`, `tests/test_controller_triggers.py`, `tests/test_controller_rooms.py`, `tests/test_controller_chat_automation.py`, `frontend/src/lib/__tests__/controllerVisibility.test.js`
- **Known gaps:** Only remotes announced by the home's own Zigbee bridge are found — the list is read from that bridge's retained announcements, so a button on any other radio stays invisible exactly the way every button used to be.; The list is cached for 60 seconds and refreshed on a two-minute tick. Renaming or re-rooming a remote drops that cache, but pairing one does not, so a brand-new remote can take up to two minutes to appear on the device list.; Room and name were briefly offered in two places at once — the card's ⋮ menu and the Info tab — and the menu route silently did nothing, because it went looking for the kind of record a stateless remote never has. The ⋮ route was removed and Info is now the single place; do not re-add the second path.; A remote is not a row in the device registry, so the 'left the hub' watch that covers ordinary devices does not cover it — a remote that leaves simply stops appearing.

### 🟢 Devices that need attention, and delete that really deletes  `device-lifecycle-management`

> Ziggy tells you when something has genuinely dropped off, and removing a device is always a clean start.

Devices the hub can no longer see are flagged for attention with an option to remove them, guarded against a false mass-alarm that would otherwise flag every healthy device at once during a startup race. Ziggy now asks the radio itself rather than trusting the hub's own memory: a device the wireless coordinator no longer lists reads "Left the hub — pair it again" and raises its own alert, and a leftover copy of it still sitting in the hub can no longer argue it back to life — only the device genuinely rejoining clears the flag. Any device page also offers a "Not responding? Fix it" button that hands the problem to chat with the device already named. Deleting a device tears down everything that made it configured, including telling a wireless radio to let it go, without ever taking down a hub-wide connection shared by other devices; removing one half of a linked infrared-plus-network device removes the other half too.

- **Status:** `live-prod` — VERIFIED: lost-device guard services/device_registry.py:420 _mass_loss_veto, motivated by the 19-hour false alarm in memory project_false_lost_devices_incident.md; delete-final commit 8310a04 hardened by 78a21c2 and 0fdb811; shared-connection guard 78a21c2 introduces _partition_config_entries(). Radio ground truth added by commit 1bb0764f — services/radio_liveness.py, reconciled from a services/ziggy_scheduler.py tick (a production entrypoint) — and hardened by 13cdf0bf so a retained ghost entity in the hub cannot restore a departed device (services/device_registry.py, lost_reason=left_hub, apply_radio_liveness); ANOM-14 is registered in services/anomaly_engine.py and surfaced as string devices.statusLeftHub in frontend/src/pages/Devices.jsx. `git tag --contains 1bb0764f` lists release-2026.09.18-2 through the newest tag release-2026.09.18-4. Device-page repair hand-off commit e87d3ae2 (frontend/src/lib/fixerPrompt.js, string deviceDetail.askFixer), shipped since release-2026.09.06. Tests: tests/test_radio_liveness.py, tests/test_device_delete_cascade.py.
- **Layer:** Devices · **Audience:** user-facing
- **Built from:** `device-and-room-registry`
- **Composes with:** `add-a-device` (via device-and-room-registry), `buttons-and-remotes` (via device-and-room-registry), `home-screen` (via device-and-room-registry), `interactive-floor-plan` (via device-and-room-registry), `ir-wifi-merged-device` (via device-and-room-registry), `matter-commissioning` (via device-and-room-registry) …and 6 more
- **Surfaces:** `services/device_registry.py`, `backend/routers/device_router.py`, `frontend/src/pages/Devices.jsx`, `frontend/src/pages/DeviceDetail.jsx`
- **Tests:** `tests/test_device_delete_cascade.py`
- **Known gaps:** A link between an infrared remote and its network twin dangles if the network side is re-added under a different identifier.; The self-heal loop that clears false 'lost' flags originally lived in core/ziggy_main.py, which the production container never runs; it is now ticked by services/ziggy_scheduler.py.; A device the radio says has departed is deliberately never auto-pruned — it sits in the list reading 'Left the hub' until it is paired again or removed by hand. That is the intended behaviour, but it means a device you gave away stays on the list until you clear it.; The radio check only covers devices on the wireless mesh. A network or infrared device that quietly stops answering still relies on the older 'gone silent' watch, which judges by how long ago it last reported rather than by asking anything.

### 🟡 Matter device commissioning  `matter-commissioning`

> Add a Matter bulb or sensor by scanning its code, no extra app needed.

You scan or type the setup code on a Matter device and Ziggy brings it onto the home's own low-power network in the background, polling for the outcome instead of timing out and inviting a retry that used to break the pairing.

- **Status:** `canary-only` — commit 8b2eb99 'feat(matter): async fire-and-poll pairing UI + imaging matter-enable step'; the imaging step is ENABLE_MATTER-gated and OFF by default (scripts/factory/ziggy-image-device.sh); memory project_matter_thread_support.md records it needs a second radio dongle only the Canary has.
- **Layer:** Devices · **Audience:** user-facing
- **Built from:** `device-and-room-registry`
- **Composes with:** `add-a-device` (via device-and-room-registry), `buttons-and-remotes` (via device-and-room-registry), `device-lifecycle-management` (via device-and-room-registry), `home-screen` (via device-and-room-registry), `interactive-floor-plan` (via device-and-room-registry), `ir-wifi-merged-device` (via device-and-room-registry) …and 6 more
- **Surfaces:** `backend/routers/pairing_router.py`, `frontend/src/components/PairingWizard.jsx`, `docs/MATTER_THREAD.md`
- **Known gaps:** Requires a second radio dongle per hub; only the Canary has one.; Bluetooth adapter degrades after rapid pairing attempts; the fix is a manual adapter down/up plus a service restart.

### 🟢 Saved light positions  `saved-light-positions`

> Capture a light you like and get it back in one tap, and have it wake that way automatically.

A preset is a still brightness-and-colour position captured on a light's own card, up to six per light, recalled with one tap. Mark one as the default and the light wakes in it from the card, from voice, or after a power cut; Ziggy also tells the bulb itself to remember its own last state so a wall-switch power cycle no longer flashes at 1% before jumping to where it belongs.

- **Status:** `live-prod` — Presets commit c6b7d10 'named saved-position presets'; default-wake commits 673776c and 83a9006 'kill the 1% flash'; memory project_preset_power_on_behavior.md records it live on Canary, David and the imaging branch.
- **Layer:** Devices · **Audience:** user-facing
- **Built from:** `device-and-room-registry`
- **Composes with:** `add-a-device` (via device-and-room-registry), `buttons-and-remotes` (via device-and-room-registry), `device-lifecycle-management` (via device-and-room-registry), `home-screen` (via device-and-room-registry), `interactive-floor-plan` (via device-and-room-registry), `ir-wifi-merged-device` (via device-and-room-registry) …and 6 more
- **Surfaces:** `services/device_presets.py`, `backend/routers/device_presets_router.py`, `frontend/src/components/device/DeviceControls`
- **Known gaps:** A light on the Smart Light Schedule ignores its default preset; the UI only warns about the conflict (string deviceControls.presetDefaultShadowed).

### 🟠 Virtual devices  `virtual-devices`

> Turn a one-off action, like casting a playlist or launching a show, into a tappable thing.

A virtual device is a saved capability with its settings filled in, such as a YouTube caster pointed at the living room screen. It behaves like a device you can tap in a room or call from an automation, but nothing physical exists behind it. The list of what can become one comes from Ziggy's own capability catalog.

- **Status:** `orphaned` — Re-verified at commit 0d0fda3b and unchanged: backend/routers/virtual_device_router.py is still imported and registered in backend/server.py and is still reachable from the room sheet, but frontend/src/pages/VirtualDevices.jsx has no route — frontend/src/App.jsx redirects /virtual-devices to /settings (the 2026-06 settings refactor; the redirect has since moved off the line the previous citation named). There remains no way to create or edit one.
- **Layer:** Devices · **Audience:** user-facing
- **Built from:** `capability-catalog-store`
- **Surfaces:** `services/virtual_devices.py`, `backend/routers/virtual_device_router.py`, `frontend/src/pages/Rooms.jsx`, `frontend/src/pages/VirtualDevices.jsx`
- **Known gaps:** Creating or editing a virtual device has no reachable UI; only the room sheet can list, trigger and toggle ones that already exist.

### ⚫ Zigbee stack migration (ZHA to Zigbee2MQTT)  `zha-to-z2m-migration`

> Move a whole home's Zigbee devices onto newer radio software without re-pairing a single one.

A one-shot operator tool that remapped every stored reference to a Zigbee device — room assignments, settings, infrared links, automations — from the old radio software's naming to the new one's. It shipped with a seven-step runbook and a profile-gated container so the cutover could be rehearsed before it was made for real.

- **Status:** `abandoned` — scripts/migrate_zha_to_z2m.py (commit 2ef1dd2, last touched 2026-06) and docs/RUNBOOK_ZHA_TO_Z2M_CUTOVER.md remain in the tree, and memory project_z2m_migration.md confirms the job it was built for is done: 'Z2M is live and working. All Zigbee devices are now via MQTT' — every hub in the fleet is now imaged Zigbee2MQTT-only. It is retired by its own success: it ran, it completed the cutover, and there is nothing left for it to migrate — not by being broken or left unfinished.
- **Layer:** Devices · **Audience:** operator
- **Built from:** `device-and-room-registry`
- **Composes with:** `add-a-device` (via device-and-room-registry), `buttons-and-remotes` (via device-and-room-registry), `device-lifecycle-management` (via device-and-room-registry), `home-screen` (via device-and-room-registry), `interactive-floor-plan` (via device-and-room-registry), `ir-wifi-merged-device` (via device-and-room-registry) …and 6 more
- **Surfaces:** `scripts/migrate_zha_to_z2m.py`, `docs/RUNBOOK_ZHA_TO_Z2M_CUTOVER.md`
- **Known gaps:** The fleet has fully migrated to Zigbee2MQTT, so there is no home left for this tool to act on; it is dead weight now, not a live capability.; The stack detector it introduced for the cutover is still load-bearing elsewhere in Zigbee pairing; only the one-shot migration script itself is retired.

### 🟢 Ziggy knows what a device actually is  `smart-device-cards`

> A twelve-part gadget shows up as one card with the right control on top, not battery voltages and firmware helpers.

A rich device that reports a dozen readings and switches gets folded into a single card with one headline control, using a curated catalog of known device shapes plus your own corrections when it guesses wrong. Ziggy hides entities that are really plumbing (signal strength, firmware update helpers) so only real devices show in the list, shows its own fused presence sensors as ordinary devices, and lets you promote a hidden reading to its own tile or switch the whole app's icon style between emoji, line art and 3D. A device's own page now carries exactly one on/off rather than three, keeps its identity card under Info, and is the single place to set its room or link an infrared remote to its network twin — the ⋮ menu was taken off every card so one setting never has two routes with different plumbing behind them.

- **Status:** `live-prod` — Device classification system commit 7f80b16, live on Canary and David per memory project_device_classification.md; noise filter commit 25fb197 extended by 55da7fb/5f8c77f; tile curation commit dc296ec; icon styles commit 6e61188; fused sensors surfaced by commit 446d03f. Device-page consolidation commits e0fe9524 (identity card belongs to Info), e08fae4e (one on/off per page), 1dea5f1b (room assignment on Info only) and ac131a37 (no ⋮ menu on any card; infrared Wi-Fi linking moves to Info), all in frontend/src/pages/DeviceDetail.jsx and frontend/src/pages/Devices.jsx; `git tag --contains ac131a37` lists release-2026.09.17 through the newest tag release-2026.09.18-4.
- **Layer:** Devices · **Audience:** user-facing
- **Built from:** `entity-prefs-and-classification-store`, `device-and-room-registry`, `template-sensor-factory`
- **Composes with:** `rooms` (via device-and-room-registry, template-sensor-factory), `add-a-device` (via device-and-room-registry), `buttons-and-remotes` (via device-and-room-registry), `device-lifecycle-management` (via device-and-room-registry), `home-screen` (via device-and-room-registry), `interactive-floor-plan` (via device-and-room-registry) …and 6 more
- **Surfaces:** `services/device_groups.py`, `services/device_profiles.py`, `services/device_overrides.py`, `services/entity_filter.py`, `services/entity_prefs.py`, `services/template_sensors.py`, `frontend/src/lib/deviceIcons.jsx`, `frontend/src/pages/DeviceDetail.jsx`
- **Known gaps:** The profile catalog seeds with exactly one entry (irrigation_valve); everything else rides the heuristic until a user corrects it.; A correction is meant to improve every home that owns the same device, but no sharing path exists in code yet.; Icon sets are incomplete for a few device kinds and fall back to a neighbouring icon.; A full redesign of this page and every other screen was built, shipped to the branch and reverted the same day (design pass 4ea9d85f, revert bb92e196, retry b3f6b18e) — the pre-redesign look is deliberate, not neglect.

## Fleet & releases

### 🟢 Fleet health, alerting and auto-repair  `fleet-health-and-repair`

> The cloud watches every home, notices the ones that have gone quiet or lost their automations, and quietly fixes what's safe to fix.

Every home reports in on a schedule; a pure rules engine in the cloud turns that report into a health verdict, treating silence as worse than any bad report. Common problems — a home with zero automations, a device that lies about its state, a full disk, Home Assistant going deaf — are either auto-repaired through an explicit allow-list of safe verbs or surfaced as an alert, and the same verdicts drive the console, the CLI and the auto-repairer so they can never disagree. Health now also judges the home's own software stack: what the hub says it should be running versus what is running, so a missing core piece reads as down, any other missing declared piece as degraded, and a piece running that the hub never declared is called out by name before the next rebuild drops it. The operator screen prints what each home actually runs — release tag, update track, drift, disk and uptime — because a drifted hub cannot receive fixes at all. An end-to-end hub smoke test was built early on and is now superseded by the ship-time readiness gate.

- **Status:** `live-prod` — VERIFIED: relay/app/fleet_health.py evaluate()/summarize(), built after a real 19-hour false 'device removed' incident (ea967b7, memory project_false_lost_devices_incident); auto-repair via relay/app/remediator.py with a ZIGGY_AUTO_REMEDIATE kill switch (9cebd0f); scripts/fleet-health.py is the CLAUDE.md-mandated pre-change check; automation-wipe detection (719a49e) after Canary ran 5.5h with an empty automations.yaml and looked green. Since then: the CLI prints release tag/cohort/drift/disk/uptime from each home's vitals (commit 81222238) and identifies itself so the tunnel stops rejecting it (commit 134c23a9, verified by /api/ops/whoami returning 200 on all three hubs); stack verdicts stack_service_down / stack_service_missing / stack_undeclared_services live in relay/app/fleet_health.py:312-350 fed by services/telemetry_client.py, with relay/tests/test_relay_fleet_stack.py pinning them (commits ab687d73, 13cdf0bf, in release-2026.09.18-4).
- **Layer:** Fleet & releases · **Audience:** operator
- **Built from:** `fleet-verdict-engine`, `push-notification-channel`, `ha-registry-snapshot-cache`, `scheduler-tick-loop`, `release-tag`
- **Composes with:** `device-and-automation-runtime` (via ha-registry-snapshot-cache, scheduler-tick-loop), `buttons-and-remotes` (via scheduler-tick-loop), `fleet-ops-console` (via fleet-verdict-engine), `founder-remote-support` (via push-notification-channel), `guided-home-setup` (via scheduler-tick-loop), `ha-update-advisor` (via scheduler-tick-loop) …and 4 more
- **Surfaces:** `relay/app/fleet_health.py`, `relay/app/remediator.py`, `scripts/fleet-health.py`, `services/telemetry_client.py`, `backend/routers/ops_router.py`, `services/ha_outage_alert.py`, `services/self_heal.py`, `scripts/linux/disk-guard.sh` …and 1 more
- **Tests:** `tests/test_relay_fleet_health.py`, `tests/test_prod_entrypoint_starts_services.py`
- **Known gaps:** An earlier standalone smoke-test script (scripts/smoke-test-hub.sh) is orphaned, superseded by the kit-ready ship gate.; A first-generation fleet-status CLI (scripts/fleet.yml) still lists one stale legacy home record; CLAUDE.md now points operators at ./scripts/fleet-health.py instead.; The repair half of the CLI could never have reached a home before 2026-09-06: every repair verb goes through the relay proxy to the hub's tunnel, which answered the script's default caller identity with a 403 page. Only the read side had ever worked, and nothing said so (commit 134c23a9).; For a month nothing compared what a home's software stack should be running with what it was running — health covered Ziggy's own background services and Home Assistant reachability only. That is how the canary ran without Matter/Thread from 2026-08-14 until 2026-09-18, reporting green the whole time.; The stack verdict is only as good as the hub's last update check — a hub whose updater has stopped keeps reporting the last stack it saw, which is exactly the hub you most want the truth about.

### 🟢 Home Assistant update advisor  `ha-update-advisor`

> Before Home Assistant itself updates, Ziggy tells you what it might break — and can eventually apply it overnight with a rollback.

Ziggy checks for new Home Assistant core versions, builds a risk profile against the home's actual devices and integrations, and surfaces plain warnings before anyone takes the update. An overnight auto-apply-with-rollback path exists behind the same mechanism but ships turned off by default.

- **Status:** `live-prod` — backend/routers/update_router.py registered at backend/server.py:649, page at /ops/ha-update; risk rules in services/ha_update_checker.py scheduled at boot. The overnight auto-install path (services/ha_installer.py, services/ziggy_scheduler.py) is gated on ha.auto_install, which config/settings.example.yaml sets false with the comment 'Ships dormant.' No memory record shows it ever flipped on for a real home.
- **Layer:** Fleet & releases · **Audience:** operator
- **Built from:** `scheduler-tick-loop`
- **Composes with:** `buttons-and-remotes` (via scheduler-tick-loop), `device-and-automation-runtime` (via scheduler-tick-loop), `fleet-health-and-repair` (via scheduler-tick-loop), `guided-home-setup` (via scheduler-tick-loop)
- **Surfaces:** `services/ha_update_checker.py`, `backend/routers/update_router.py`, `services/ha_installer.py`, `frontend/src/pages/HAUpdate.jsx`
- **Known gaps:** The unattended overnight-upgrade-with-rollback half of this is flagged off by default fleet-wide; only the advisory check is actually live.

### 🟢 New home provisioning and factory imaging  `hub-provisioning-and-imaging`

> Turning a blank mini PC into a shippable, supportable customer home is one script, gated so nothing ships that can't be fixed later.

A factory-imaging script turns a bare mini PC into a Ziggy hub in sixteen steps, always resolving to the newest release rather than a hand-pinned version. A newer one-command wrapper adds tunnel setup, a self-healing static network address (so the hub keeps its address even if it moves), and relay registration in a single operator run. Imaging now also records which optional radios the hub runs — Zigbee, Matter/Thread — in the hub's own settings, so a later rebuild keeps them instead of silently shipping a home without its radio. Nothing is allowed to ship until a hard gate proves the hub can actually take a future fix and back itself up. An earlier cloud-hosted 'homes on a free Oracle VM' architecture, and a costed Hetzner escape-hatch plan for it, were both built and then deleted when the mini-PC hub became the sole model.

- **Status:** `live-prod` — scripts/factory/ziggy-image-device.sh has imaged three real homes (memory project_beta_image_readiness, project_david_ziggy02_imaging, project_tslil_ziggy03_imaging); scripts/factory/kit-ready-check.sh is a hard gate ('KIT-READY GATE FAILED — do not ship') checking OTA enrollment and a real first backup. Its step_update_channel now writes ZIGGY_COMPOSE_PROFILES=zigbee-z2m into /etc/ziggy/ziggy.env for a Zigbee build (commit 13cdf0bf) and scripts/factory/ziggy-matter-enable.sh declares the matter profile when it enables Matter (commit ab687d73), both in release-2026.09.18-4. The newer one-command orchestrator (scripts/new-home.sh) has 44 green tests but per memory project_new_home_automation is 'NOT yet validated on real hardware' — every home built so far used the older per-home runbooks, not this script.
- **Layer:** Fleet & releases · **Audience:** operator
- **Built from:** `release-tag`, `cohort-selector`, `relay-hmac-signature`
- **Composes with:** `release-channel` (via cohort-selector, release-tag), `cloud-brain-relay` (via relay-hmac-signature), `fleet-health-and-repair` (via release-tag), `hub-connection-resilience` (via relay-hmac-signature), `remote-home-access` (via relay-hmac-signature), `safe-update-guarantee` (via release-tag)
- **Surfaces:** `scripts/factory/ziggy-image-device.sh`, `scripts/factory/kit-ready-check.sh`, `scripts/new-home.sh`, `scripts/linux/ziggy-network-pin.sh`, `relay/app/provisioner.py`
- **Known gaps:** The newest one-command orchestrator is unvalidated on real hardware; real homes were built with older, since-superseded runbooks.; The static-address pin is deliberately non-fatal — a hub can ship unpinned and nothing fails the gate.; One ship-gate check is mutating (it deletes all HA areas to blank the home), so it must never be run against a live customer home.; An earlier cloud-VM hosting model (Oracle free tier) and its Hetzner migration plan are both deleted architecture; stale references to them remain in a memory note and in relay/docker-compose.yml.; Imaging exported the radio profile for its own session only until 2026-09-18, so every hub imaged before that date was left undeclared. They repair themselves on their next update check rather than needing a visit, but no hub was ever re-imaged to prove the new path end to end.

### 🟢 The fleet operations console  `fleet-ops-console`

> One screen answers: is anything broken across the fleet, how is each home doing, and can I fix it from here.

A staff-only web console shows every home's traffic-light health, lets an operator drill into one home's members, telemetry, updates, backups and paired phones, and is gated to a founder identity rather than the generic admin role every customer already has on their own hub. It replaced three earlier console builds within about a month, each abandoned because it computed its own competing notion of 'healthy'.

- **Status:** `live-prod` — frontend/src/components/admin/ops/FleetOps.jsx (add15d7) routed at /ops/cloud, gated by a founder-identity check (64572ab) after David and Tslil each found they had a fleet console on their own hub; per-home HomeCard drill-in (9bdd79c).
- **Layer:** Fleet & releases · **Audience:** operator
- **Built from:** `fleet-verdict-engine`, `audit-log-store`
- **Composes with:** `fleet-health-and-repair` (via fleet-verdict-engine), `founder-remote-support` (via audit-log-store), `home-backup-and-recovery` (via audit-log-store)
- **Surfaces:** `frontend/src/components/admin/ops/FleetOps.jsx`, `frontend/src/pages/CloudAdmin.jsx`, `frontend/src/pages/OpsConsole.jsx`
- **Known gaps:** Three earlier surfaces (FleetConsole.jsx, FleetHealthPanel.jsx, a browser-computed traffic light in fleetHealth.js) are dead code left in the tree, unreachable from any route.; A cloud-hosted release catalog and cohorts admin page still exists and is still routed, but ship.sh never publishes to it — it shows nothing current.

### 🟢 The release channel  `release-channel`

> One command sends a fix to every home, and every home takes it on its own within two minutes.

An operator runs one script that stamps a dated, signable release tag on code already proven on the canary home. Every hub checks for a newer tag every two minutes, pulls it, rebuilds, and rolls itself back automatically if the new version doesn't come up clean. A rebuild now keeps the optional pieces a home actually runs — its Zigbee radio service, Matter/Thread — instead of quietly dropping them, and a hub found running a piece it never declared writes that declaration into its own settings on the next check rather than waiting for a human. Every check also leaves a heartbeat behind, so a week with nothing to deploy can no longer be mistaken for a dead updater. Signed-tag enforcement exists as an opt-in, off-by-default hardening; two earlier update mechanisms (a Windows/PowerShell path and a hardcoded git-pull-from-main script) were superseded and are no longer used.

- **Status:** `live-prod` — VERIFIED: scripts/ship.sh tags release-YYYY.MM.DD and scripts/linux/ziggy-update.timer fires every 2 min; memory project_release_channel_live records 2026-08-10 as the first day it worked in production, after three latent bugs (SIGPIPE on >20 commits, a tag rev-parse bug, and one that would have deleted every home's automations). Declared compose profiles now join every compose invocation (commit ab687d73) and a running-but-undeclared profile is written into /etc/ziggy/ziggy.env by the updater itself (commit f502fc76) — both shipped in release-2026.09.18-4, exercised by tests/test_updater_protects_ha_config.sh scenarios 8-9 (20 assertions in all). Liveness is judged on the updater's own heartbeat file rather than the age of the last deploy (commit 69cdefad, backend/routers/edge_health_router.py:_updater_heartbeat_age_s).
- **Layer:** Fleet & releases · **Audience:** operator
- **Built from:** `release-tag`, `cohort-selector`
- **Composes with:** `hub-provisioning-and-imaging` (via cohort-selector, release-tag), `fleet-health-and-repair` (via release-tag), `safe-update-guarantee` (via release-tag)
- **Surfaces:** `scripts/ship.sh`, `scripts/linux/ziggy-update.sh`, `scripts/linux/ziggy-update.timer`, `relay/app/routers/ota.py`
- **Tests:** `tests/test_updater_protects_ha_config.sh`
- **Known gaps:** A moved/force-pushed release tag once wedged a hub's fetch forever; the updater now fetches with --force, but hubs on older builds do not survive that.; Signed-release-tag enforcement is opt-in and OFF on every fleet home today.; An earlier cloud-side release catalog/cohorts admin page was built and then bypassed — ship.sh only tags git, it never publishes to the relay.; A Windows/PowerShell update path and a hardcoded git-pull-from-main updater both predate this and are abandoned.; The heartbeat line added on 2026-09-06 crash-looped the canary the same morning: the systemd state probe exits non-zero for a non-running unit, and under the script's strict pipeline settings the run died at the heartbeat stage — before the fetch, so the hub could not receive its own fix. It had to be rescued by a one-time hand sync of the tree to an exact commit (commit e55a455c).; Optional parts of the stack were silently dropped by the first rebuild after they were enabled until 2026-09-18: Matter/Thread went live on the canary on 2026-08-14 and was gone within one update cycle, unnoticed for a month (commits ab687d73, 13cdf0bf).

### 🟢 Updates never wipe your home's own automations  `safe-update-guarantee`

> Updating your hub never deletes the routines and rooms you built — that used to be a real risk.

Every update backs up the home's own automations, scripts and scenes before touching anything, restores them afterward, and refuses to restore a smaller/emptier file over a real one. A rebuild can no longer silently demote a real home to a bare dev configuration either. The backup no longer takes a fresh copy every two minutes when nothing has changed: an unchanged home reuses its last snapshot and keeps only the newest thirty, so each hub trims its own pile on the next check instead of quietly filling the disk.

- **Status:** `live-prod` — VERIFIED: scripts/linux/ziggy-update.sh backup_protected/restore_protected with an EXIT trap (commit a74476b); topology preserved via the COMPOSE_FILES wrapper (8ede2ac, 'every rebuild silently demoted the hub to the dev topology'); snapshot de-duplication and a ZIGGY_BACKUP_KEEP=30 cap added in commit f5786586, shipped in release-2026.09.17 and every tag since. tests/test_updater_protects_ha_config.sh has grown to 20 assertions across nine scenarios, most added after a real incident (the pile-up is scenario 7); the restore path and the shrink guard were left untouched by the pruning change.
- **Layer:** Fleet & releases · **Audience:** user-facing
- **Built from:** `release-tag`, `protected-state-guard`
- **Composes with:** `fleet-health-and-repair` (via release-tag), `home-backup-and-recovery` (via protected-state-guard), `hub-provisioning-and-imaging` (via release-tag), `release-channel` (via release-tag)
- **Surfaces:** `scripts/linux/ziggy-update.sh`, `docker/ha-config/.gitignore`, `scripts/canary/hub-bootstrap.sh`
- **Tests:** `tests/test_updater_protects_ha_config.sh`
- **Known gaps:** This is a real fix for a real past incident: a bug that would have deleted every home's automations was caught only just before it reached production.; The backup ran unconditionally on every two-minute tick until 2026-09-17, by which point the canary carried 23,511 snapshots (826 MB) of files that had not changed in weeks, with its disk at 76%. Nothing alerted on it; it was found by hand.; Only the newest thirty snapshots are kept now, so the protection is a short rewind, not an archive — anything older than roughly the last thirty updates is gone.

## IR & AC

### 🟢 Crack your AC's full remote language  `crack-ac-remote-language`

> Walk through your remote once and Ziggy learns its whole language, including buttons you never pressed.

A guided walk asks you to set the AC to a known baseline, then step the temperature ladder, cycle modes and fan levels, toggle swing and power, confirming each press. From that one session Ziggy derives the AC's protocol on its own, checksum, temperature encoding, mode and fan layout, without a human doing the byte-mapping. Once a device demonstrably speaks a cracked protocol, Ziggy can compose brand-new commands for any temperature or mode you never taught it, not just replay recordings, and nothing is trusted until you confirm on the real hardware that the AC obeyed. Israel's most common brand, Tadiran, is fully proven this way, and a card cracked in one home can also be shared to the fleet so the next home with the same AC works instantly.

- **Status:** `live-prod` — Tadiran protocol services/ir_protocol.py:820-1060, commits aacd6da/5290143/2f63a10/d0bf192 from the 2026-07-27 hardware walk; walk wizard route registered backend/server.py:684, ancestor of release-2026.08.14-8; trial-then-validate gate services/ir_walk_session.py:274-337; fleet registry services/ir_card_registry.py with relay endpoint relay/app/routers/protocol_cards.py.
- **Layer:** IR & AC · **Audience:** user-facing
- **Built from:** `protocol-card-engine`, `ir-device-and-blaster-registry`, `ir-tx-bridge`
- **Composes with:** `ir-in-automations` (via ir-device-and-blaster-registry, ir-tx-bridge), `teach-ziggy-a-remote` (via ir-device-and-blaster-registry, ir-tx-bridge), `voice-chat-media-control` (via ir-tx-bridge)
- **Surfaces:** `frontend/src/pages/IrWalkWizard.jsx`, `backend/routers/ir_walk_router.py`, `services/ir_walk_session.py`, `services/ir_walk_analyzer.py`, `services/ir_protocol.py`, `services/ir_protocol_cards.py`, `services/ir_card_registry.py`
- **Tests:** `tests/test_ir_walk_analyzer.py`
- **Known gaps:** Shipped to the fleet but the guided walk itself has never been driven end-to-end on real hardware (memory project_ir_state_engine_status.md) — per the repo's real-life validation rule, it is not proven yet.; Electra (Toshiba-family) and Midea/Tornado cards exist and mirror the hand decoders but ship with both validation flags false, so Ziggy will never compose a frame for them until someone walks a real unit.; The shared fleet pool is effectively empty; no walk has ever been validated on real hardware, so nothing has been pushed to it.

### 🟢 One card for a device you can reach two ways  `ir-wifi-merged-device`

> Your TV is one device whether Ziggy talks to it over the network or by remote.

A television or similar device reachable both over the network and by infrared appears as a single card: the network side gives true live state and rich controls, the infrared side handles power-on and anything the network side can't do. When the TV switches off and drops off the network, Ziggy reads that as 'off and still controllable' rather than 'disconnected' — it stays out of the offline count and still offers a working remote. When both paths exist Ziggy prefers the true network state over the inferred infrared one.

- **Status:** `live-prod` — commit 8310a04 introduced the resilient merged card; commit e9d666e fixed all three off-handling facets; memory project_ir_wifi_merged_off.md records it live on Canary, David and imaging (commit 50564a1). Near-duplicate records for this same feature appeared in both the devices-and-pairing and ir-and-ac salvage extractions and are merged here.
- **Layer:** IR & AC · **Audience:** user-facing
- **Built from:** `device-and-room-registry`, `device-state-engine`
- **Composes with:** `add-a-device` (via device-and-room-registry), `buttons-and-remotes` (via device-and-room-registry), `device-lifecycle-management` (via device-and-room-registry), `home-screen` (via device-and-room-registry), `interactive-floor-plan` (via device-and-room-registry), `matter-commissioning` (via device-and-room-registry) …and 7 more
- **Surfaces:** `services/device_registry.py`, `backend/routers/device_router.py`, `frontend/src/pages/Devices.jsx`, `frontend/src/pages/DeviceDetail.jsx`
- **Known gaps:** The merge is keyed on the network device's identifier; if that changes on re-add, the link dangles and must be redone.

### 🟢 Remote control from chat, voice and automations  `ir-in-automations`

> Ask Ziggy to turn on the AC and it presses the button for you.

Infrared commands are first-class actions everywhere in Ziggy: chat and voice can send a button, set an AC temperature, punch in a channel, run a macro or start a learn cycle; automations can pick an infrared button as an action; the away-simulation routine cycles a TV through its blaster; and the per-room climate engine drives a dumb AC over infrared whenever no smart unit exists for that room. When rehearsal mode is on, a chat or voice turn that would press a button instead reports what it would have done and the blaster stays silent, so the owner can rehearse the way Ziggy talks about the house without the house reacting.

- **Status:** `live-prod` — core/handlers/ir_handler.py:339-343 registers ir_send_command/ir_set_ac_temperature/ir_learn_command/ir_send_channel/ir_play_sequence; consumed by services/fake_occupancy_scheduler.py and services/smart_climate_engine.py; i18n automations.actionIR at frontend/src/lib/i18n/en.js:1298. VERIFIED 2026-09-19 for the rehearsal behaviour: the short-circuit was added by commit bbf0f45 at services/ir_manager.py:939-945, and `git tag --contains bbf0f45` places it in release-2026.09.06 and every later release tag. It is inert unless the persisted flag `assistant.rehearsal` is on, which defaults to False (services/rehearsal.py:37-44), and it is request-scoped, so only the routes that call activate_if_enabled are affected: backend/routers/intent_router.py:259,395,616,731, backend/routers/actions_router.py:44 and backend/routers/mcp_router.py:135. Regression-covered by tests/test_rehearsal.py:81.
- **Layer:** IR & AC · **Audience:** user-facing
- **Built from:** `ir-device-and-blaster-registry`, `ir-tx-bridge`
- **Composes with:** `crack-ac-remote-language` (via ir-device-and-blaster-registry, ir-tx-bridge), `teach-ziggy-a-remote` (via ir-device-and-blaster-registry, ir-tx-bridge), `voice-chat-media-control` (via ir-tx-bridge)
- **Surfaces:** `core/handlers/ir_handler.py`, `services/smart_climate_engine.py`, `services/fake_occupancy_scheduler.py`, `services/local_automation_actions.py`
- **Known gaps:** Rehearsal mode is deliberately asymmetric, and the asymmetry surprises people: it silences infrared sent from chat, voice, the Actions page and the assistant's own tools, but not infrared sent by a schedule, by Smart Climate or by the away simulation. A home can be rehearsing and still really cycling its AC at the same time — that is the intended design, so that the operator can rehearse the voice for a day while the house behaves normally.; Tapping an on-demand action in the app counts as a rehearsed turn exactly like a chat message does, so with the flag on a deliberate button press in the app will also quietly do nothing to the real device.

### 🟢 Teach Ziggy a remote  `teach-ziggy-a-remote`

> Point your old remote at the little sensor and Ziggy learns each button.

A guided flow pairs an infrared sensor, names the device (TV, AC, fan, soundbar, set-top box) and records each button as you press it on the real remote. Setup shows the four buttons you actually need with the rest tucked behind More, and beyond the built-in catalog you can teach arbitrary extra buttons and chain several into a named macro like 'movie mode'. Any press Ziggy hears that matches nothing waits in a queue so you can bind it to a device and command later. Ziggy also finds the little sensors on your network by itself and re-finds them if your router hands them a new address.

- **Status:** `live-prod` — Learning wizard POST /api/ir/learn (backend/routers/ir_router.py:639); Top-4/More layout commit ef850bc; macros restored by commit ef4d66c; unassigned queue services/ir_unassigned.py; blaster discovery commit d1600a3 and self-heal commits abb0114/726d197 validated per memory project_broadlink_dhcp_drift.md.
- **Layer:** IR & AC · **Audience:** user-facing
- **Built from:** `ir-device-and-blaster-registry`, `ir-listener-loop`, `ir-tx-bridge`
- **Composes with:** `crack-ac-remote-language` (via ir-device-and-blaster-registry, ir-tx-bridge), `ir-in-automations` (via ir-device-and-blaster-registry, ir-tx-bridge), `remote-device-state-tracking` (via ir-listener-loop), `voice-chat-media-control` (via ir-tx-bridge)
- **Surfaces:** `frontend/src/components/IRWizard.jsx`, `backend/routers/ir_router.py`, `services/ir_manager.py`, `services/ir_unassigned.py`, `services/ir_blasters.py`
- **Known gaps:** Interrupted learn cycles can silently wedge the receive side of a Broadlink sensor — sending keeps working, hearing goes dead — until it's power-cycled.; Discovery must run from a host that can broadcast on the LAN; the bridged container can't, so it depends on the self-heal path.; A deep inspector for an unrecognised signal exists on the backend but nothing in the app calls it.

### 🟢 Ziggy remembers what a remote-controlled device is doing  `remote-device-state-tracking`

> See what your air conditioner is set to even though it can't tell you.

Devices driven by infrared can't report back, so Ziggy models their state, what each button does, its value ranges, a sensible starting guess, and tracks how sure it is (freshly heard from your own remote, remembered from a command Ziggy sent, or stale), shown as a coloured dot on the card. A listener on the sensor's receive channel matches every real remote press against learned codes through a cascade from exact bytes down to a fuzzy pulse compare, because two presses of the same button never come back byte-identical. It also knows AC remotes send their whole state in every frame rather than a button code, so it never misattributes an AC snapshot to a learned button, and it broadcasts every state change to every open screen the instant Ziggy acts.

- **Status:** `live-prod` — State engine commit daeb8d9 wired by 454a6c5, confidence chip by c116b95; physical-remote detection validated on real RM4 hardware per memory feedback_ir_fingerprint_validated.md ('all works great', commit f17a17d); stateful-AC guard commits 96c4612 and 3bdfdd6; live broadcast took four commits (272863f, 0fbd98c, 48a7622, 6271695) to cover manual and automation-driven sends alike. VERIFIED 2026-09-19: commit bbf0f45 added a rehearsal short-circuit to the raw direct-send helper at services/ir_listener.py:1319-1326 and to services/ir_manager.py:939-945, in both cases returning before the modelled state is updated; gated by `assistant.rehearsal`, default False (services/rehearsal.py:37-44); covered by tests/test_rehearsal.py:74.
- **Layer:** IR & AC · **Audience:** user-facing
- **Built from:** `device-state-engine`, `ir-listener-loop`, `live-state-broadcast`
- **Composes with:** `external-assistant-access` (via live-state-broadcast), `home-screen` (via live-state-broadcast), `household-lists` (via live-state-broadcast), `household-music` (via live-state-broadcast), `ir-wifi-merged-device` (via device-state-engine), `teach-ziggy-a-remote` (via ir-listener-loop) …and 1 more
- **Surfaces:** `services/device_state.py`, `services/device_state_compat.py`, `services/ir_listener.py`, `services/ir_protocol.py`, `frontend/src/pages/Devices.jsx`
- **Known gaps:** Only works on infrared sensors with a receive channel; the beta-kit Avatto units are transmit-only, so those homes get no live state.; Legacy per-device fields are still written as mirrors alongside the new engine so old consumers keep working, leaving two representations of the same truth.; A rehearsed command is short-circuited above the modelled-state write, so rehearsing 'turn on the AC' correctly leaves the card still reading off. This ordering is load-bearing: if that check is ever moved below the send, rehearsal starts writing phantom state for presses that never physically happened, and the confidence dot would claim Ziggy knows something it invented.

## Language

### 🟢 Hebrew voice lab  `hebrew-voice-lab`

> Hear exactly how Ziggy will sound in Hebrew, mark every word it gets wrong, and prove the fix before a customer hears it.

A local review bench renders the Hebrew lines Ziggy actually says through the real voice, then walks the operator through a sitting: rate each line, click the word that came out wrong, compare two variants blind, and read forty spoken commands aloud to score the listening side. Verdicts are saved as you go and the page resumes where you stopped, so a candidate fix can be re-rendered and compared against the old one instead of argued about. The word-level findings become the shipped pronunciation dictionary, and the same text-preparation stage can be copied out to the other projects that speak Hebrew.

- **Status:** `live-prod` — VERIFIED: the bench is in the tree at 0d0fda3 (scripts/voice_lab/ — README.md, corpus.yaml, prep.py, render.py, serve.py + review.html, report.py, stt_bakeoff.py, sync_speech_text.py), designed in docs/superpowers/specs/2026-09-05-hebrew-voice-lab-design.md (commit 970c90e0) and covered by tests/test_voice_lab_prep.py. It has been run for real: the header of services/speech_text.py records the 2026-09-05 sitting — 17 of the operator's 22 mispronounced lines fixed by text rules alone — and a single sitting finding shipped as a one-word fix (commit ec051012, הדוּד). Operator-side only: the README states 'Nothing here runs on a hub', so it is deliberately not reachable from backend/server.py.
- **Layer:** Language · **Audience:** operator
- **Shipped:** 2026-09
- **Surfaces:** `scripts/voice_lab/corpus.yaml`, `scripts/voice_lab/prep.py`, `scripts/voice_lab/render.py`, `scripts/voice_lab/serve.py`, `scripts/voice_lab/review.html`, `scripts/voice_lab/report.py`, `scripts/voice_lab/stt_bakeoff.py`, `scripts/voice_lab/sync_speech_text.py` …and 1 more
- **Tests:** `tests/test_voice_lab_prep.py`
- **Known gaps:** Vowel-pointing a whole sentence makes the voice WORSE, not better — the engine reads a pointed bet as v and drops vowels — so pointing is applied only to a hand-verified per-word dictionary. Do not re-try full-sentence nikud.; A sitting needs a pronunciation model downloaded by hand and a Cartesia key, and every output (renders, recordings, verdicts) is gitignored under voice_lab_out/, so the raw evidence behind a decision lives only on the machine that ran the sitting.; The listening half — a forty-line spoken script and a word-error-rate bake-off across candidate transcribers — exists and runs, but no bake-off result is recorded anywhere in the tree, so the current transcriber choice is still unmeasured.

### 🟢 The whole app works in Hebrew — natively, right to left  `hebrew-and-rtl-product`

> Flip one switch and every screen, wizard and toast reads in fluent, gender-neutral Israeli Hebrew, right to left.

Every screen exists in both Hebrew and English; choosing Hebrew flips the whole app to right-to-left with no flicker and no missing-string placeholders. A dedicated rewrite replaced textbook, machine-translated Hebrew with warm, direct Israeli phrasing across the whole product, stopped defaulting to male grammar, and stripped smart-home-engineer jargon — 'entity', 'trigger', 'Home Assistant' — from anything a homeowner reads; 'anomaly' became 'alert' and automations became 'Automatic action'. Ziggy signs his own name in Hebrew too: the app draws the approved זיגי wordmark while the interface is in Hebrew and ZIGGY otherwise, from fixed artwork that is never rebuilt out of live type and never mirrored under right-to-left. Rooms, devices and automations you name yourself are translated live wherever they're shown, without ever renaming what you actually typed, and even the very first pairing screen — before any language has been chosen — greets you bilingually. A written style guide governs the interface wording, now says plainly that how Ziggy himself talks is owned by the assistant's own character module, and sits beside a pre-launch audit so the standard doesn't silently drift.

- **Status:** `live-prod` — VERIFIED at 0d0fda3. frontend/src/lib/i18n/index.js:39 applyToDocument() sets document.documentElement.dir='rtl'/lang='he' and persists to localStorage; en.js and he.js now hold 4608 shared keys with zero either-side-only keys (measured at HEAD; was 4373 at last build). Nativization pass commit d43b429; vocabulary sweep 231fbeb; live name translation 261e84c (nameDict.js); Hebrew room-key fix 5a79a96 with tests/test_device_room_key_hebrew.py; bilingual first-boot page be72e31. Hebrew brand artwork frontend/public/brand/ziggy-hebrew.svg drawn by frontend/src/components/ui/Logo.jsx:71 (variant 'wordmark' resolves to 'hebrew' when lang==='he'), shipped in commit ebd7c03, which is contained in release-2026.09.18-4 (verified with `git tag --contains`); tests/…/Logo.test.jsx covers the variant. The style-guide-defers-to-persona rule was added to frontend/src/lib/i18n/HEBREW_STYLE_GUIDE.md in commit 20227bf.
- **Layer:** Language · **Audience:** user-facing
- **Shipped:** 2026-05 (`d43b429`)
- **Built from:** `i18n-dictionary`
- **Surfaces:** `ziggy_pc/frontend/src/lib/i18n/index.js`, `ziggy_pc/frontend/src/lib/i18n/en.js`, `ziggy_pc/frontend/src/lib/i18n/he.js`, `ziggy_pc/frontend/src/lib/i18n/HEBREW_STYLE_GUIDE.md`, `ziggy_pc/HEBREW_NATIVIZATION_AUDIT.md`, `ziggy_pc/frontend/src/lib/i18n/nameDict.js`, `ziggy_pc/frontend/src/components/ui/Logo.jsx`, `ziggy_pc/frontend/public/brand/ziggy-hebrew.svg` …and 2 more
- **Tests:** `ziggy_pc/tests/test_device_room_key_hebrew.py`, `ziggy_pc/tests/test_first_boot_router.py`, `ziggy_pc/frontend/src/components/__tests__/Logo.test.jsx`
- **Known gaps:** en.js still carries 114 duplicate keys where JS's 'last definition wins' silently picks stale copy (he.js has 3), re-counted at HEAD against 4608 shared keys. No repo-wide parity or duplicate-key test guards either file — the parity happens to be perfect today by hand, not by CI.; RTL is still delivered mainly by the document dir flip. There is not a single Tailwind rtl: variant anywhere in the frontend; CSS logical properties (marginInlineStart and friends) have since appeared in about 38 files, so direction-awareness is now inconsistent rather than absent — a hardcoded left/right in any of the other components still stays wrong under Hebrew and nothing catches it.; Per-action and state labels ('Turn On', 'Heating', 'Cooling', 'Eco') in the device-category registry are still raw hardcoded English and bypass the translation resolver entirely (frontend/src/lib/domainRegistry.js:90,141) — the one item the pre-launch audit left open, still open a year later.; The style guide is unenforced and has drifted: the retired term אקלים appears 10 times in he.js and the unstandardized spelling הכול 10 times, both after the guide was written.; Ziggy's spoken voice and the interface's wording are now governed by two separate documents — the style guide for strings, the assistant's character module for replies — with nothing but a paragraph of prose keeping them in step. A rule fixed in one can silently fail to reach the other.; The same Hebrew room-key fix had to be reapplied on four separate long-lived branches — evidence of exactly the branch drift the release rules warn about.

### 🟢 Ziggy understands and speaks Hebrew  `hebrew-conversation-and-voice`

> Say תדליק את האור בסלון and it just works — and Ziggy answers back in a real Israeli voice.

Hebrew room and device words — including the Israeli-specific דוד/בוילר for a water heater — are recognised and mapped to the same actions an equivalent English command would trigger, so chat and voice both work natively in Hebrew. Ziggy now composes his Hebrew instead of translating it: one locked character description carries the rules — warm and direct rather than textbook, 24-hour clock, devices named the way you'd name them — and he speaks about himself in the masculine while addressing you without gendering you, staying in whichever language the conversation is already in. Before a Hebrew reply reaches the voice it passes a spoken-text stage that puts the pauses back where the synthesizer ran straight through, says clock times the way Israelis say them, counts in the noun's gender (שתי דקות) and applies a per-word pronunciation dictionary. When a word still comes out wrong, a 'Said wrong?' line under the reply lets you say how it should sound; Ziggy records it and throws away the cached audio, so the next play re-renders instead of repeating the mistake forever.

- **Status:** `live-prod` — VERIFIED at 0d0fda3. Hebrew room/device normalization runs on every parse (core/intent_parser.py:290-291). The single-agent brain is now the default for every home — backend/routers/intent_router.py:95-117 returns "v2" with no config at all, and config/settings.example.yaml:453-454 ships `assistant.engine: v2` — so native Hebrew composition (core/agent/persona.py `_HEBREW_VOICE`, core/agent/output.py render_device_confirmation/spoken_summary) is the customer-facing path, not a flag. The spoken-text stage services/speech_text.py is called from backend/routers/tts_router.py:24,182 on the uvicorn-served app (backend/server.py:673 includes tts_router) and defaults ON via `voice.speech_text.enabled`; 'Said wrong?' posts to /api/voice/tts/flag (tts_router.py:207-231) from frontend/src/pages/AIChat.jsx:154. Commits 6a7cd75, 20227bf and 970c90e are all contained in release-2026.09.18-4 (verified with `git tag --contains`). Cartesia Hebrew TTS remains pinned to sonic-3.5 in interfaces/tts/cartesia_tts.py. Tests: tests/test_speech_text.py, tests/test_agent_persona.py, tests/test_voice_lab_prep.py.
- **Layer:** Language · **Audience:** user-facing
- **Shipped:** 2026-05 (`6a7cd75`)
- **Built from:** `hebrew-room-alias-bank`
- **Surfaces:** `ziggy_pc/core/intent_parser.py`, `ziggy_pc/services/room_alias_bank.py`, `ziggy_pc/core/agent/persona.py`, `ziggy_pc/core/agent/output.py`, `ziggy_pc/services/speech_text.py`, `ziggy_pc/interfaces/tts/cartesia_tts.py`, `ziggy_pc/backend/routers/tts_router.py`, `ziggy_pc/backend/routers/intent_router.py` …and 5 more
- **Tests:** `ziggy_pc/tests/test_speech_text.py`, `ziggy_pc/tests/test_agent_persona.py`, `ziggy_pc/tests/test_voice_lab_prep.py`
- **Known gaps:** DO NOT RE-TRY: pointing a whole Hebrew sentence with nikud before sending it to the synthesizer makes pronunciation WORSE, not better — the engine reads a pointed בּ as v and drops vowels. This was measured over the operator's own mispronounced lines in the 2026-09-05 Voice Lab sittings; pointing is now applied only to a small dictionary of words verified one at a time, and plain text rules alone fixed 17 of the 22 bad lines.; The 'Said wrong?' loop is only half a loop. Flagging a line evicts the cached audio and appends the sentence to user_files/tts_flags.jsonl — nothing reads that file, and nothing adds the word to the pronunciation dictionary. Somebody has to hand-edit `voice.speech_text.words` in the home's settings file, and no screen exposes it, so a customer's correction only lands if an operator goes and looks.; The synthesizer is not deterministic: the same sentence can come out right one render and wrong the next, which is why the fix has to be a cache eviction rather than a re-render of one bad word.; The older translate-after-the-fact path is still in the tree and still reachable — a home that explicitly sets `assistant.engine: v1` falls back to generating an English reply and machine-translating it (backend/routers/intent_router.py:358-368), which is the roughly 600 ms of latency CLAUDE.md's TODO list names.; TTS must stay pinned to the sonic-3.5 model — the previous model rejects Hebrew outright with a language_not_supported error. Sonic 3.6 shipped 2026-08-27 and was probed in the Voice Lab but is not adopted.; The Voice Lab itself (scripts/voice_lab/) is dev-only and never runs on a hub: judging a voice needs a human ear, so improving Hebrew pronunciation still requires the operator to sit down and listen. The Hebrew STT bake-off it was built to settle produced numbers but no change to what production actually uses.; A one-off script meant to measure Hebrew tool-selection accuracy at an 85% bar was written and run twice as a snapshot, then never turned into a real test; the design decision it was meant to settle was made a different way (normalize-then-parse), leaving validate_hebrew_intent.py abandoned at the repo root.

## Media

### 🟢 A TV remote that adapts to your TV  `tv-remote-adaptive`

> Back, home, menu and the arrow pad work on your TV however Ziggy can reach it.

Home Assistant has no standard back/home/menu/arrow-pad command, so for each button Ziggy tries the TV's native command, a learned infrared code, a paired remote entity, and finally a brand adapter for LG webOS, Samsung and Sony Bravia in that order; the user just presses a button. A device that looks like a streaming stick or media app rather than a real TV instead gets a player-style remote: artwork, title, position and duration, pause, skip, scrub and volume.

- **Status:** `live-prod` — frontend/src/lib/remoteNav.js documents the 4-layer resolution consumed by TVRemote.jsx and MediaTransportRemote.jsx; brand adapters in frontend/src/lib/mediaPlayerVendors.js (webostv/samsungtv/braviatv). Not feature-flagged.
- **Layer:** Media · **Audience:** user-facing
- **Built from:** `vendor-command-adapters`
- **Composes with:** `voice-chat-media-control` (via vendor-command-adapters)
- **Surfaces:** `frontend/src/lib/remoteNav.js`, `frontend/src/lib/mediaPlayerVendors.js`, `frontend/src/components/device/remotes/TVRemote.jsx`, `frontend/src/components/device/remotes/MediaTransportRemote.jsx`
- **Known gaps:** Only three brand adapters exist even though the module's own comments name Roku, Apple TV and Android TV as motivating cases.; Brand detection is attribute heuristics, so a mis-detected TV can silently lose the adapter layer of navigation.

### 🟢 Ask Ziggy to control your screen or speaker  `voice-chat-media-control`

> Say 'put the front door camera on the TV' and Ziggy just does it.

Chat and voice can cast a YouTube link or search phrase to a screen, find a podcast episode and start playing it on a speaker, throw a live camera feed onto a TV or browser tab (via a Ziggy-proxied URL so the Home Assistant token never reaches the browser), open a named streaming app on the TV, or start a Spotify playlist through Home Assistant's own integration. Ziggy resolves 'the screen I'm looking at' by matching what you said against every open Ziggy screen and every real media device in the home. When a TV is switched off and unreachable over the network, turning it on falls back from the normal command to a brand-specific one and finally to the infrared power code from that room's blaster.

- **Status:** `live-prod` — media_stream_youtube/media_play_podcast_episode/media_cast_camera_live/media_start_movie_in_app/media_spotify_playlist tools in core/tools_schema.py, none behind the media_music flag; TV IR-power fallback in services/media_manager.py:63-124; display resolution in services/display_registry.py + services/target_resolver.py.
- **Layer:** Media · **Audience:** user-facing
- **Built from:** `ir-tx-bridge`, `vendor-command-adapters`
- **Composes with:** `crack-ac-remote-language` (via ir-tx-bridge), `ir-in-automations` (via ir-tx-bridge), `teach-ziggy-a-remote` (via ir-tx-bridge), `tv-remote-adaptive` (via vendor-command-adapters)
- **Surfaces:** `core/handlers/media_handler.py`, `services/media_manager.py`, `core/tools_schema.py`, `services/display_registry.py`, `services/target_resolver.py`
- **Known gaps:** Search-by-phrase YouTube casting shells out to yt-dlp, which is not in requirements.txt, so on a real hub only pasted links actually work.; In-app title search for streaming apps was scaffolded and abandoned; the app opens but never jumps to the named title.; Casting to a plain browser tab is dead on arrival: the backend push channel exists but no client ever registers as a display, so every such cast silently falls through to the Home Assistant path instead.; The Spotify playlist path predates the flagged Household Music system and has no idea whose account it's using; it overlaps that newer system with completely different plumbing.

### 🔵 Household Music  `household-music`

> Everyone in the house links their own Spotify or YouTube Music, and Ziggy plays it on the speaker you choose.

A household picks which of its speakers, Chromecasts, Sonos units and smart TVs Ziggy is allowed to play music through, and each person connects their own Spotify (one-click) or YouTube Music (advanced) account privately on the hub. A Play Media step in the automation and routine builders can then start a chosen account's playlist, a search phrase, or a pasted link on a chosen speaker, and a small panel on the wall tablet shows what's playing with pause and skip. Every message about it speaks plain household language, no Home Assistant terms, no raw device identifiers, in Hebrew too.

- **Status:** `flagged` — VERIFIED at 0d0fda3b: still inert by default. The `media_music` flag is false in both `config/settings.yaml:23` and the shipped `config/settings.example.yaml:207` (commented there as off by default, toggled from Settings → Feature flags), and every entry point under `core/media/` refuses through `core/media/flag.py` (`DEFAULT = False`; `require_enabled()` raises `FeatureDisabledError`). The screens are routed but sit behind that flag: `frontend/src/App.jsx:645` for settings/music and `frontend/src/App.jsx:697` for the super-admin media diagnostics view. This is a built, unshipped feature, not a live one. Earlier citations `config/settings.yaml:57` and `config/settings.example.yaml:189` had drifted and were re-checked in this pass.
- **Layer:** Media · **Audience:** user-facing
- **Built from:** `household-music-engine`, `live-state-broadcast`
- **Composes with:** `external-assistant-access` (via live-state-broadcast), `home-screen` (via live-state-broadcast), `household-lists` (via live-state-broadcast), `remote-device-state-tracking` (via live-state-broadcast), `ziggy-wall` (via live-state-broadcast)
- **Surfaces:** `Settings → Music`, `backend/routers/media_router.py`, `core/media/audio_devices.py`, `core/media/profiles.py`, `services/local_automation_actions.py`, `frontend/src/components/hub/sections.jsx`
- **Known gaps:** No test file anywhere covers core/media.; The speaker-type detector is hardcoded, so a mis-detected speaker can never be corrected by a user; a promised per-entry override never landed.; The first build of this feature (an audio-routing wizard with saved favourites and a browse-and-search picker) was replaced wholesale before ever being committed, and 'kid-safe' / favourites-only profile flags were written on the reading side but nothing ever checks them before playing.; Has no voice or chat verb ('play some music' still uses the older, separate voice-play-Spotify path); it is automation-only by design.

## Mobile app

### 🟢 Pairing a phone to your home  `pair-phone-to-home`

> Type a six-character code, or scan the QR, and the phone is yours.

On the computer the owner generates a short code that expires in five minutes; in the app you type it or scan the QR. The phone gets its own credentials, is bound to a household member, and appears in a Paired Phones list the owner can revoke at any time — revoking kicks the phone's live connection immediately rather than waiting for a token to expire. A first-ever phone can claim a brand-new hub with a long-lived code printed at kit-imaging time and become the owner, and a wall-mounted tablet adopts itself through the exact same flow instead of a second pairing system.

- **Status:** `live-prod` — ziggy_mobile 32cee75 'pair flow verified end-to-end against local Vite + Python'; ziggy_pc/backend/routers/mobile_router.py defines /pair-code, /pair, /register, /devices; claim-tier logic in services/mobile_app.py (45125db); wall-tablet reuse in dc57a9d. tests/test_mobile_app_claim.py, test_mobile_router_is_first_pair.py and test_mobile_router_audit_events.py all pass at release-2026.08.14-8.
- **Layer:** Mobile app · **Audience:** user-facing
- **Shipped:** 2026-05-28 (`32cee75`)
- **Built from:** `pair-code-store`, `mobile-device-registry`, `capacitor-web-shell`
- **Composes with:** `adopt-a-lan-only-home` (via capacitor-web-shell), `live-house-state-on-phone` (via mobile-device-registry), `mobile-build-and-store-readiness` (via capacitor-web-shell), `mobile-notifications` (via mobile-device-registry), `mobile-presence-detection` (via mobile-device-registry), `native-voice-dictation` (via capacitor-web-shell) …and 1 more
- **Entry points:** `POST /api/mobile/pair-code`, `POST /api/mobile/pair`, `POST /api/mobile/register`, `GET /api/mobile/devices`, `DELETE /api/mobile/devices/{device_id}`
- **Surfaces:** `ziggy_pc/frontend/src/pages/MobileOnboarding.jsx`, `ziggy_pc/backend/routers/mobile_router.py`, `ziggy_pc/services/mobile_app.py`, `ziggy_pc/frontend/src/components/PairWithPhone.jsx`, `ziggy_mobile/package.json`, `ziggy_mobile/ios/App/App/Info.plist`
- **Tests:** `ziggy_pc/tests/test_mobile_app_claim.py`, `ziggy_pc/tests/test_mobile_router_is_first_pair.py`, `ziggy_pc/tests/test_mobile_router_audit_events.py`
- **Known gaps:** No rate limit on code redemption — docs/MOBILE_ROUTE_AUDIT.md flags /api/mobile/pair as a brute-force risk, deferred to v1.1.; The long-lived zgy_mb_ device token never expires; a designed short-TTL-plus-refresh scheme (MOBILE_ROUTE_AUDIT.md §3.1) was never built, so revoking a device is the only kill switch.; The mobile-auth audit trail (pair attempts, revokes, WS rejections) lives in a 500-entry in-memory ring buffer — it is not a persistent log and is lost on every hub restart, which happens on every update.; The barcode scanner implementation was swapped once already, so MobileOnboarding.jsx still probes two different plugin names to cover both eras.

### 🟠 Pairing the app with a hub on your own Wi-Fi (orphaned)  `adopt-a-lan-only-home`

> Meant to let the app find and pair with a brand-new hub over the home network alone — diagnosed broken and never fixed.

For a fresh hub with no internet address yet, the app is supposed to scan its first-boot QR and talk to it directly over the home Wi-Fi. Diagnosed on real hardware, it does not work: the app's WebView origin is locked to https://localhost so cross-origin requests to the hub's LAN address are blocked by CORS, plain-http addresses are refused outright by the app's config, and a fresh install used to land on an empty dashboard instead of the setup wizard. Only that last piece — the wizard trigger — was ever fixed; the two network-access blockers remain exactly as diagnosed.

- **Status:** `orphaned` — mobile-lan-adoption diagnosis on a Galaxy S24+, 2026-07-16; grep -rn CapacitorHttp across ziggy_pc/frontend/src and ziggy_mobile returns zero hits in both trees. The built app's generated capacitor.config.json still has "cleartext": false and androidScheme https. Only the onboarding-wizard-trigger half landed, in ziggy_pc commit 019d94a (UnauthenticatedGate, release-2026.08.14-8:frontend/src/App.jsx:210).
- **Layer:** Mobile app · **Audience:** user-facing
- **Built from:** `capacitor-web-shell`
- **Composes with:** `mobile-build-and-store-readiness` (via capacitor-web-shell), `native-voice-dictation` (via capacitor-web-shell), `pair-phone-to-home` (via capacitor-web-shell), `ziggy-mobile-app` (via capacitor-web-shell)
- **Surfaces:** `ziggy_mobile/capacitor.config.ts`, `ziggy_pc/frontend/src/App.jsx`, `ziggy_pc/frontend/src/pages/MobileOnboarding.jsx`
- **Known gaps:** Blocks the whole app-first onboarding story for a customer whose hub is not yet reachable from the internet.; The recommended fix — routing API and WebSocket calls through CapacitorHttp instead of the WebView's own network stack — appears nowhere in either repository.; The LAN-presence self-heal path is equally unproven behind a tunnel, since every request would arrive from the container gateway rather than the phone's real address.

### 🟢 Talk to Ziggy from the app  `native-voice-dictation`

> Tap the mic and speak — your phone turns it into a Ziggy command, faster than in a browser.

In the app, speech goes through the phone's own built-in dictation rather than the browser's, starting roughly half a second faster and delivering words as you speak them more reliably than recording audio inside a web view. The web version of Ziggy is untouched and keeps using the browser's own speech APIs.

- **Status:** `live-prod` — ziggy_mobile commit dd4a3d9 wired @capacitor-community/speech-recognition; AndroidManifest.xml declares RECORD_AUDIO plus a <queries> block for android.speech.RecognitionService; consumed at release-2026.08.14-8:frontend/src/pages/AIChat.jsx:1127 via window.Capacitor?.Plugins?.SpeechRecognition, with a Samsung stop()-hang workaround at line 1479.
- **Layer:** Mobile app · **Audience:** user-facing
- **Shipped:** 2026-06-22 (`dd4a3d9`)
- **Built from:** `capacitor-web-shell`
- **Composes with:** `adopt-a-lan-only-home` (via capacitor-web-shell), `mobile-build-and-store-readiness` (via capacitor-web-shell), `pair-phone-to-home` (via capacitor-web-shell), `ziggy-mobile-app` (via capacitor-web-shell)
- **Surfaces:** `ziggy_mobile/android/app/src/main/AndroidManifest.xml`, `ziggy_mobile/ios/App/Podfile`, `ziggy_pc/frontend/src/pages/AIChat.jsx`
- **Known gaps:** The native plugin can't be delivered by the OTA channel — a phone on an older binary silently falls back to browser dictation.; Recognition is the platform's own, so Hebrew coverage depends on the phone, not on Ziggy.; Native dictation stops on a silence pause and has to be hand-restarted, and stop()/removeListener can hang on Samsung; the fix is native-only and still needs on-device validation.

### 🟢 The app updates itself  `mobile-ota-updates`

> New Ziggy screens land on your phone by the next time you open it — no app-store wait.

The app asks your own Ziggy hub whether it has a newer interface build, downloads it as a small zip in the background, and swaps it in on the next cold start with no reinstall and no store round trip. If the new interface fails to come up, the app automatically reverts to the version that worked. A code change pushed to the main branch reaches a phone within two launches, with no paid cloud service in the loop. Settings shows which build the screen in front of you is actually running next to the one the hub is serving right now, so a fix that simply hasn't arrived stops looking like a bug that was never fixed.

- **Status:** `live-prod` — ziggy_mobile commit 48cfa8d added @capgo/capacitor-updater; ziggy_pc/backend/routers/mobile_router.py serves /api/mobile/version + /bundles/{sha}.zip; watchdog at frontend/src/lib/nativeOtaWatchdog.js. tests/test_mobile_ota_bundle_version.py passes at release-2026.08.14-8. Staleness indicator added in commit c58f5ee, an ancestor of release-2026.09.18-4: frontend/src/components/settings/BuildInfo.jsx compares the content hash of the loaded bundle with the one in the hub's freshly-fetched index.html and reads the hub's own sha from /api/version.
- **Layer:** Mobile app · **Audience:** user-facing
- **Shipped:** 2026-06-22 (`48cfa8d`)
- **Built from:** `capgo-ota-channel`
- **Entry points:** `GET|POST /api/mobile/version`, `GET /api/mobile/bundles/{sha}.zip`
- **Surfaces:** `ziggy_mobile/capacitor.config.ts`, `ziggy_pc/frontend/src/lib/nativeOtaWatchdog.js`, `ziggy_pc/backend/routers/mobile_router.py`
- **Tests:** `ziggy_pc/tests/test_mobile_ota_bundle_version.py`
- **Known gaps:** Shipped broken twice, silently. A runtime-patched hub's advertised SHA stayed 'dev' so nothing downloaded (commit eacc87f); later _bundle_version() returned a git SHA that doesn't move when only the frontend changes, so every phone concluded it was current and the new UI never arrived (35ad4df, 2026-08-09).; updateUrl is hardcoded to app.ziggy-home.com, so a home reached only over LAN cannot serve its own bundle.; The plugin's own launch-time auto-check is disabled because it DNS-fails before the WebView's network is bound, so the whole channel depends on the JS watchdog running at all.; Only the web half updates itself; anything native (permissions, plugins, icons) still needs a rebuilt app binary.; Staleness is now visible but not self-correcting: Settings says plainly when the loaded build and the served build differ, and stops a stale copy being debugged as a live bug, but nothing forces the refresh — the person still has to act on what it tells them.

### 🟢 The phone stays live with the house  `live-house-state-on-phone`

> Lights, locks and automation results update on your phone the moment they happen.

The app holds an authenticated WebSocket connection to the hub. A bridge wraps the existing browser broadcast so a filtered subset of events — device state changes, failed commands, automation results, physical-remote presses, Ziggy's chat replies — also fans out to phones, while noisy debug traffic stays on the web side so phones don't burn battery on events they can't use.

- **Status:** `live-prod` — services/mobile_ws_bridge.py _MOBILE_RELEVANT_TYPES allowlist, wired at backend/server.py:106; shipped in commit a68de7f. tests/test_mobile_router_audit_events.py passes.
- **Layer:** Mobile app · **Audience:** user-facing
- **Shipped:** 2026-05-28 (`a68de7f`)
- **Built from:** `mobile-device-registry`
- **Composes with:** `mobile-notifications` (via mobile-device-registry), `mobile-presence-detection` (via mobile-device-registry), `pair-phone-to-home` (via mobile-device-registry)
- **Entry points:** `WS /api/mobile/ws`
- **Surfaces:** `ziggy_pc/services/mobile_ws_bridge.py`, `ziggy_pc/services/mobile_ws_manager.py`, `ziggy_pc/backend/routers/mobile_router.py`, `ziggy_pc/backend/server.py`
- **Tests:** `ziggy_pc/tests/test_mobile_router_audit_events.py`
- **Known gaps:** The designed push-fallback for an offline phone (named in services/mobile_ws_manager.py's own header comment as a Phase-3 item) was never built — an event that misses an offline phone is simply lost, not queued or redelivered as a push.

### 🟢 Touch and motion  `app-motion-and-gestures`

> Press, swipe and drag anywhere in the app and it answers like a native one — and one switch turns all of it off.

Every screen answers touch: controls press in, states arrive instead of cutting, a room tile grows into the room and shrinks back into the tile it came from, sheets have detents and follow the flick of a finger, a device opens as a sheet over where you were and becomes its full page when dragged to the top, and a brightness slider can be scrubbed straight from a card, with haptics on a phone. Going back moves like going back rather than replaying the same entrance. A phone's reduced-motion setting is respected, and adding ?motion=off to the address restores the app exactly as it looked before — that is the rollback, with no downgrade and no release.

- **Status:** `live-prod` — VERIFIED: commit e2ad847 (2026-09-12) and the returns pass eaa2c30 are both ancestors of release-2026.09.18-4, the newest release tag; mounted app-wide at frontend/src/App.jsx:1357 (frontend/src/motion/MotionRoot.jsx), default ON in every home (frontend/src/motion/flag.js readInitial returns true and every rule is scoped under data-motion="on"), with the shared-element morph used on the home and rooms surfaces (frontend/src/pages/Dashboard.jsx:212 and frontend/src/pages/Rooms.jsx:1196-1207).
- **Layer:** Mobile app · **Audience:** user-facing
- **Surfaces:** `frontend/src/motion/MotionRoot.jsx`, `frontend/src/motion/morph.js`, `frontend/src/motion/gestures.js`, `frontend/src/motion/flag.js`, `frontend/src/pages/Dashboard.jsx`, `frontend/src/pages/Rooms.jsx`
- **Known gaps:** Never tested by a real thumb on a real phone. Every judgement behind it is from screenshots, measured frame counts and a pixel-identical comparison against the layer switched off — not from anyone using it.; The on-screen motion toggle, tuner and rehearsal chip were deliberately removed (commit 8e4b759), so ?motion=off is the only remaining way to turn the layer off. It had to be made to stick in the browser's storage, because as a link-only switch the rollback forgot itself on the next tap.; Turning it off is per browser and per device: a home hitting a problem has to add ?motion=off on every screen in the house, not flip one setting on the hub.; The forward morph was scaling about its centre rather than its top-left in development only (a teardown running from a cancelled first pass), which means every visual judgement made in dev before commit eaa2c30 was of a different animation from the one that ships.

### 🟢 Ziggy Home — the phone app  `ziggy-mobile-app`

> Your whole Ziggy home, installed on your phone, opening instantly even with no signal.

One cross-platform app wraps the same Ziggy web interface used in a browser, installable from a home-screen icon. The interface ships bundled inside the app so a cold open paints immediately instead of pulling the whole UI over the network, and it still opens on a poor connection. An internal diagnostics screen shows whether the app is really talking to the home, for support use, though nothing links to it. An earlier design that loaded the UI live from the server on every launch shipped for two weeks and was abandoned because it hung on mobile data.

- **Status:** `live-prod` — ziggy_mobile commit 32cee75 initial Capacitor shell; bundled-UI fix 48cfa8d; capacitor.config.ts has no server.url (store mode); android/app/build.gradle applicationId com.ziggyhome.app versionCode 10. Verified against built app-release.aab (2026-08-03) and app-debug.apk (2026-08-09); diagnostics route confirmed at release-2026.08.14-8:frontend/src/App.jsx:489.
- **Layer:** Mobile app · **Audience:** user-facing
- **Shipped:** 2026-05-28 (`32cee75`)
- **Built from:** `capacitor-web-shell`
- **Composes with:** `adopt-a-lan-only-home` (via capacitor-web-shell), `mobile-build-and-store-readiness` (via capacitor-web-shell), `native-voice-dictation` (via capacitor-web-shell), `pair-phone-to-home` (via capacitor-web-shell)
- **Entry points:** `ziggy_mobile/android/app/src/main/java/com/ziggyhome/app/MainActivity.java`, `ziggy_mobile/ios/App/App/AppDelegate.swift`, `ziggy_pc/frontend/src/App.jsx:489`
- **Surfaces:** `ziggy_mobile/capacitor.config.ts`, `ziggy_mobile/android/app/build.gradle`, `ziggy_mobile/android/app/src/main/java/com/ziggyhome/app/MainActivity.java`, `ziggy_mobile/ios/App/App/AppDelegate.swift`, `ziggy_pc/frontend/src/lib/nativeApiBase.js`, `ziggy_pc/frontend/src/pages/MobileDiagnostics.jsx`
- **Known gaps:** Android is the only platform ever installed on real hardware — no iOS .ipa has ever been archived.; The dev-loop server.url block sits commented in capacitor.config.ts; a careless uncomment ships a build that refetches the whole SPA on every launch, which is the abandoned original design (commit f69032a).; Path-relative camera URLs 404 inside the app because the bundle is served from https://localhost.; The internal diagnostics page at /mobile-diagnostics has no navigation link into it anywhere in the app — reachable only by typing the URL.

## Notifications

### 🟢 Ziggy notifies your actual phone  `mobile-notifications`

> Alerts about your home land on your phone as a real notification — not just a browser tab you left open.

The app registers for the platform's push service after pairing, and every notification Ziggy already sends — anomaly alerts, presence, reminders, automation results — fans out to registered phones as well as browsers, showing a badge and sound like any other app. Each person can mute individual alert categories and set quiet hours; some notifications carry buttons that run an action with one tap, no app open required; and a person is never pushed a notification about their own arrival. Before this, the only channel was browser web-push, which an Android WebView cannot receive at all, so the phone got nothing.

- **Status:** `live-prod` — services/mobile_push.py + services/push_notify.py fan out via FCM (commit 6271695) and web-push (f415445); memory project_mobile_push_fcm.md records a real delivery on an SM-S926B on 2026-07-31 (Firebase project ziggy-df6c5); preferences in services/push_preferences.py; action buttons in services/push_actions.py. tests/test_push_self_suppress.py and tests/test_push_stats.py pass.
- **Layer:** Notifications · **Audience:** user-facing
- **Shipped:** 2026-07-31 (`6271695`)
- **Built from:** `fcm-push-channel`, `web-push-channel`, `mobile-device-registry`
- **Composes with:** `mobile-presence-detection` (via fcm-push-channel, mobile-device-registry), `alerts-inbox` (via web-push-channel), `live-house-state-on-phone` (via mobile-device-registry), `pair-phone-to-home` (via mobile-device-registry)
- **Entry points:** `POST /api/mobile/register`, `GET /api/push/vapid-public-key`, `POST /api/push/subscribe`, `PATCH /api/push/preferences`, `POST /api/push/action/{token}`
- **Surfaces:** `ziggy_pc/services/mobile_push.py`, `ziggy_pc/services/push_notify.py`, `ziggy_pc/services/push_preferences.py`, `ziggy_pc/services/push_actions.py`, `ziggy_pc/services/push_stats.py`, `ziggy_pc/backend/routers/push_router.py`, `ziggy_pc/backend/routers/push_action_router.py`, `ziggy_mobile/android/app/src/main/java/com/ziggyhome/app/ZiggyMessagingService.java`
- **Tests:** `ziggy_pc/tests/test_push_self_suppress.py`, `ziggy_pc/tests/test_push_stats.py`
- **Known gaps:** The iPhone half (APNs) is fully written in services/mobile_push.py, but aioapns is not installed and no home has credentials configured — blocked on the same paid Apple Developer account as App Store submission.; The native FCM fan-out ignores per-user category preferences and quiet hours entirely — only the browser path is gated, so a muted category or a quiet-hours window silences the browser but not the phone.; Notification action buttons never reach FCM — the 'Turn off' button exists on browser push only.; Action-button tokens live in a process-local dict, so every hub restart (which happens on every update) invalidates every outstanding button.; Requires config/firebase-service-account.json per home, which is deliberately gitignored — a fresh clone builds an app where push silently does nothing.

## Platform

### 🟢 Cloud brain, no vendor key on the hub  `cloud-brain-relay`

> Your home keeps working, and chat degrades gracefully, if a subscription ever lapses.

Every hub reaches Ziggy's language model through a cloud relay that holds the single vendor API key and signs each request per home, so a customer's hub never carries a key that could leak. Before any cloud request, Ziggy checks a cached subscription state; if billing has lapsed, chat returns a plain message and falls back to a local no-cloud path, while sensors, automations, infrared control and speech-to-text all keep running untouched. Chat and the automation designer now run on a newer reasoning-class model through that same relay, with the gateway quietly translating the older request shape the rest of the code still speaks. If the model a home is configured for ever stops existing upstream, Ziggy retries once on a known-good model and keeps talking instead of going silent, and homes imaged with the old example configuration — which froze chat on a 2024 model — are moved onto the current one unless an operator pinned the old one on purpose.

- **Status:** `live-prod` — VERIFIED live-prod (chat-and-assistant.verified.json, ids=relay-llm-proxy-chat and local-first-when-cloud-lapses). integrations/openai_client.py:92 get_chat_client is the resolution point for every chat-family call; require_cloud_llm_active is checked at three separate call sites. Commits fc71948 and 8db8dda are ancestors of release-2026.08.14-8. Supporting: tests/test_edge_subscription_state.py, tests/test_openai_chat_client_routing.py and tests/test_billing_e2e.py all pass (31 passed, run 2026-08-29). Refreshed 2026-09-19: chat and automation_design default to gpt-5.5 in integrations/llm_gateway.py:59-69 (bc478816), the reasoning-parameter shim is at integrations/llm_gateway.py:158-175, the one-shot rescue retry to _FALLBACK_MODEL='gpt-4o' at integrations/llm_gateway.py:248-266, and the stale-example unpin via _RETIRED_DEFAULTS at integrations/llm_gateway.py:81-114 (b2117eb4); config/settings.example.yaml:342-343 now ships gpt-5.5. Both commits are ancestors of release-2026.09.18-4. Covered by tests/test_llm_gateway_shim.py. Relay-side routing is unchanged and imposes no model allow-list (relay/app/routers/llm.py).
- **Layer:** Platform · **Audience:** operator
- **Shipped:** 2026-05-28 (`8db8dda`)
- **Built from:** `llm-relay-chat-client`, `relay-hmac-signature`
- **Composes with:** `chat-with-ziggy` (via llm-relay-chat-client), `home-fixer` (via llm-relay-chat-client), `hub-connection-resilience` (via relay-hmac-signature), `hub-provisioning-and-imaging` (via relay-hmac-signature), `remote-home-access` (via relay-hmac-signature)
- **Entry points:** `integrations.openai_client.get_chat_client`, `integrations.openai_client.require_cloud_llm_active`
- **Surfaces:** `core/brain_edge_contract.py`, `integrations/llm_gateway.py`, `integrations/openai_client.py`, `relay/app/config_guard.py`, `relay/app/routers/llm.py`, `services/home_context.py`, `services/subscription_state.py`
- **Tests:** `tests/test_edge_subscription_state.py`, `tests/test_openai_chat_client_routing.py`, `tests/test_billing_e2e.py`
- **Known gaps:** An offline local model server and offline speech recognition were also built for zero-internet operation, but nothing in the shipped container starts a local model server today; it is admin-configurable but non-functional.; Camera-vision-over-relay is uncommitted and has shipped to no hub.; TTS is still not proxied — each hub calls Cartesia/ElevenLabs directly with a local key.; The brain/edge split is an in-process software contract, not an actual deployment boundary yet.; The gate is duplicated at three separate call sites rather than one chokepoint, because gating the shared client singleton would have also killed voice transcription on a cancelled hub — a fourth call site could be added later and forgotten.; Reasoning is forced off whenever the assistant hands the model its tools — the chat endpoint refuses the two together — so the brain answers at its shallowest setting in exactly the turns that do something to the house. Having both needs a different upstream endpoint that nothing here uses yet.; The rescue model the gateway falls back to is the 2024 model it just replaced, and nothing surfaces that a home has fallen back — only a log line. A home could run for weeks on the old brain with no visible sign.

### 🟢 Device pairing, control and native automation runtime  `device-and-automation-runtime`

> Ziggy pairs any device without leaving the app, only shows controls a device can actually honour, and runs your automations natively with run history you can see.

Devices are paired (Zigbee, Matter/Thread, and others) from inside Ziggy itself, and each device's card shows only the controls it can actually perform. Automations run as native Home Assistant automations with real run history, and Ziggy still performs the parts only it can do when an automation fires directly on the hub. An automation that would do nothing can no longer be made at all: the save path itself refuses a rule with no executable steps, whoever is asking — the app, Ziggy, or a script — and pressing Run first works out who actually holds the steps, running them with Ziggy's own executor or handing the run to the hub, and refusing plainly when nobody holds any, instead of reporting a cheerful success. Every command from the app passes through an explicit allow-list so the app can drive devices but never the hub itself. Underneath, the device model stays honest on its own: settings survive a power cut, a hand flip of a switch is recognised as the owner (not fought), deleted devices stop reappearing, rooms stay real once assigned, and sunrise/sunset match the home's actual location.

- **Status:** `live-prod` — services/ha_zigbee.py / services/ha_pairing.py (pairing); services/ha_automations.py + services/ha_ws.py (native run + trace history); services/ha_subscriber._run_deferred_automation_actions, built after 'Leave Home' previously turned nothing off (039e89c); backend/routers/ha_router._ha_service_allowed, built after an audit found any authenticated user could call homeassistant.restart; services/state_memory.py, services/manual_overrides.py, services/ha_reconciler.py, services/ha_areas.py, services/ha_config.py. VERIFIED 2026-09-19: services/ha_automations.py:89 has_executable_actions gates services/ha_automations.py:734 save_automation, and services/ha_automations.py:133 resolve_run_target returns 'ziggy' | 'ha' | 'none' so a manual Run can refuse (commit 570d4f7, an ancestor of release-2026.09.18-4; tests/test_automation_has_actions.py).
- **Layer:** Platform · **Audience:** user-facing
- **Built from:** `ha-registry-snapshot-cache`, `scheduler-tick-loop`
- **Composes with:** `fleet-health-and-repair` (via ha-registry-snapshot-cache, scheduler-tick-loop), `buttons-and-remotes` (via scheduler-tick-loop), `guided-home-setup` (via scheduler-tick-loop), `ha-update-advisor` (via scheduler-tick-loop), `realtime-state-sync` (via ha-registry-snapshot-cache)
- **Surfaces:** `services/ha_zigbee.py`, `services/ha_automations.py`, `backend/routers/ha_router.py`, `services/ha_subscriber.py`, `services/manual_overrides.py`, `services/ha_reconciler.py`
- **Known gaps:** A customer's balcony motion rule sat in his home for two days firing on every motion with zero actions — the trace shows the trigger step and nothing after it — and eight presses of Run each reported success. Three surfaces were lying at once. Do not re-introduce a save path that treats 'no actions yet' as a faint warning rather than a refusal, and do not let Run report success without first establishing who owns the steps.; Blueprint-sourced rules keep their steps only on the hub side, so the run-owner check has to ask the hub for them; a rule whose steps live in neither place is the only case that now refuses.; Mode conditions, a set-mode step, hold-respecting turn-ons and a sun condition have all landed on the automation converter but are in no release tag as of 0d0fda3 (commits dd93d28, 9b0b00a, e50aea7), so homes on the release channel are still running the older converter.

### 🟢 Hub connection self-healing and cloud registration  `hub-connection-resilience`

> If your hub's address changes, or you point the app at a different hub, Ziggy finds and reconnects on its own.

When the Home Assistant hub's network address drifts, Ziggy heals the connection itself on the next reconnect attempt rather than needing a restart, and switching Ziggy to point at a different hub reconnects immediately rather than waiting out a backoff timer. A freshly provisioned home also registers itself with the fleet automatically once its cloud settings are configured.

- **Status:** `live-prod` — services/ha_url_resolver.heal_url called from services/ha_subscriber._try_heal_url (5fe3c34, 'land the DHCP self-heal modules ha_subscriber already calls'); hot-swap kick_reconnect at services/ha_subscriber.py:498 (previously referenced but missing, so changes silently waited out a 60s backoff); backend/server.py:343 _register_with_relay, signs with core/relay_signing.sign.
- **Layer:** Platform · **Audience:** operator
- **Built from:** `relay-hmac-signature`
- **Composes with:** `cloud-brain-relay` (via relay-hmac-signature), `hub-provisioning-and-imaging` (via relay-hmac-signature), `remote-home-access` (via relay-hmac-signature)
- **Surfaces:** `services/ha_url_resolver.py`, `services/ha_subscriber.py`, `services/ha_runtime.py`, `backend/server.py`

### 🟢 Live state sync across every screen  `realtime-state-sync`

> Change something on one device and every other screen in the house follows immediately, and only signed-in apps can watch.

The hub keeps a live WebSocket subscription to Home Assistant, and every state change is broadcast to every connected app instantly through a single connection manager. Actions travel the same way: whatever runs — a tile you tapped, something Ziggy did in chat, or an outside assistant acting on your behalf — is announced to every open screen as it happens, so a phone, a wall panel and a browser tab never disagree about what just occurred. Taps you make in the app are also written into a short journal Ziggy reads, so it knows what you did a minute ago without being told. The live socket itself rejects any connection that isn't authenticated before the app ever sees a message.

- **Status:** `live-prod` — services/ha_subscriber.py run_subscriber() launched at boot from backend/server.py (the real uvicorn entrypoint); backend/ws_manager.py ConnectionManager is the single broadcast singleton; unauthenticated sockets are rejected with close code 4401 before the manager sees them (backend/server.py). VERIFIED 2026-09-19: every action run through the shared registry announces a ziggy_action message to that same manager (core/actions/registry.py announce), and app tile taps are recorded through services/ui_journal.py from backend/routers/ha_router.py:404-408 — commit 6ac684f, an ancestor of release-2026.09.18-4.
- **Layer:** Platform · **Audience:** user-facing
- **Built from:** `ws-connection-manager`, `websocket-auth-gate`, `ha-registry-snapshot-cache`
- **Composes with:** `device-and-automation-runtime` (via ha-registry-snapshot-cache), `fleet-health-and-repair` (via ha-registry-snapshot-cache), `household-sign-in` (via websocket-auth-gate)
- **Surfaces:** `services/ha_subscriber.py`, `backend/ws_manager.py`, `backend/server.py`

### 🟢 Outside assistants can run your home  `external-assistant-access`

> Connect Claude, Cursor or another assistant to your home with a code you create, and take the code away again in one tap.

Everything Ziggy can do — look at devices, check who is home, run a room, build an automation — is one shared list of named actions, whether you tap it in the app, ask Ziggy in chat, or drive it from an outside assistant. In Settings → External assistants you create a named access code, paste it together with your home's address into a tool like Claude or Cursor, and that tool then acts as you: reading actions answer freely, anything that would change the house comes back asking you to confirm first, and rehearsal mode keeps a conversation from touching real devices at all. Each code is listed with when it was last used and can be revoked on its own, the code itself is shown exactly once, and a wall tablet is refused outright because there is no person standing behind it.

- **Status:** `live-prod` — VERIFIED: commit 3333499 is an ancestor of the newest release tag release-2026.09.18-4 (git tag --contains), so this is on every home on the release channel. Wired unconditionally at backend/server.py:622 (app.include_router(mcp_router), deliberately outside the global sign-in dependency because it verifies its own bearer), with the code mint/list/revoke surface at backend/routers/external_tokens_router.py and storage in services/external_tokens.py (sha256 hashes only, same SQLite file as services/auth_db.py). The shared action list is core/actions/registry.py (also served to the app at backend/routers/actions_router.py, commit 6ac684f, in release-2026.09.06-3 and newer); every call runs as person:<username> from source "mcp" at backend/routers/mcp_router.py:135-136 after rehearsal.activate_if_enabled(). Owner-facing surface is the External assistants section of frontend/src/pages/Settings.jsx with a complete Hebrew string set in frontend/src/lib/i18n/he.js:2554-2572. tests/test_mcp_router.py and tests/test_external_tokens.py ship with it (not re-run in this pass).
- **Layer:** Platform · **Audience:** user-facing
- **Shipped:** 2026-09-06 (`3333499`)
- **Built from:** `ha-truth-directory`, `live-state-broadcast`
- **Composes with:** `assistant-agent-v2` (via ha-truth-directory), `buttons-from-chat` (via ha-truth-directory), `design-from-chat` (via ha-truth-directory), `home-fixer` (via ha-truth-directory), `home-screen` (via live-state-broadcast), `household-lists` (via live-state-broadcast) …and 3 more
- **Entry points:** `backend.routers.mcp_router.router`, `core.actions.registry.run_action`
- **Surfaces:** `backend/routers/mcp_router.py`, `backend/routers/external_tokens_router.py`, `services/external_tokens.py`, `core/actions/registry.py`, `backend/routers/actions_router.py`, `services/ui_journal.py`, `frontend/src/pages/Settings.jsx`
- **Tests:** `tests/test_mcp_router.py`, `tests/test_external_tokens.py`, `tests/test_actions_registry.py`
- **Known gaps:** The connection address only exists once the home has a public address from the cloud side; until then the panel tells the owner the home is not reachable from outside yet and no outside assistant can connect at all, even though codes can still be created.; The 60-calls-a-minute limit per code is counted in memory, so a hub restart hands every code a fresh allowance.; An outside assistant sees exactly the action list Ziggy's own newer brain has, so anything only the older engine still knows how to do — notes, casting, memory recall — is invisible to it as well.; Only plain request-and-answer is offered; a client that insists on a streaming connection is turned away, and sessions are stateless, so nothing an outside assistant does carries over between calls beyond what the home itself remembers.; An access code never expires on its own. There is no expiry at all in the store — only a revoked-at stamp — so a code handed to a tool on a laptop stays valid until someone opens the list and takes it back, with only a name and a last-used time to judge by.; Assistants that expect to sign themselves in cannot: there is no sign-in handshake, so the code is pasted by hand into each tool. Talking to the home this way in real time by voice was not built either.; The address handed to an outside assistant falls back to the hub's raw tunnel address when the relay has not published a public one for that home. It is honest about what exists, but it is not reachable from the open internet, so the assistant simply fails to connect and the person has nothing on screen explaining why.; Sixty calls a minute per code, counted in memory only, so a hub restart quietly hands every code a fresh allowance.

### 🟢 Platform engineering safeguards  `platform-engineering-safeguards`

> A set of house rules the codebase enforces on itself: secrets never leak into git, every shipped feature actually runs in a real home, errors read like sentences, and a stuck app has a one-visit fix.

Settings are automatically stripped of secrets before anything is written to a tracked file. Every background service that matters (scheduler, HA subscriber, reminders, sensor alerts, pattern learning, climate, presence, home modes) is started from the actual production entrypoint, enforced by a dedicated test, because four features were once found completely dead in the untested path. Failures surface as a plain sentence instead of a stack trace, an operator can flip on a live debug console, and a stuck app cache has a one-visit reset link. Voice trouble now arrives with evidence attached: the phone's own speech timeline is written into the hub's log whatever the debug level is set to, so a report like 'the mic stopped after the first answer' can be read back instead of guessed at.

- **Status:** `live-prod` — core/settings_loader._strip_secret_paths; backend/server.py:74-263 _startup() launches every background service, enforced by tests/test_prod_entrypoint_starts_services.py (commit 36551c9) after CLAUDE.md recorded four features that never ran in production because they were only started in core/ziggy_main.py; core/errors.py ZiggyError/ErrorCode wired at backend/server.py:71; backend/routers/debug_router.py; GET /reset returns Clear-Site-Data at backend/server.py:861. VERIFIED 2026-09-19: frontend speech steps (stt_*/tts_*) are written to the hub log regardless of the debug bus level at backend/routers/debug_router.py:266-274 (commit abe7b73, an ancestor of release-2026.09.18-4); the entrypoint test was extended at commit 17d25a0 to also pin the home-modes boot announce and the expiry tick, but that commit is in no release-* tag as of 0d0fda3.
- **Layer:** Platform · **Audience:** internal
- **Surfaces:** `core/settings_loader.py`, `backend/server.py`, `core/errors.py`, `backend/routers/debug_router.py`
- **Tests:** `tests/test_prod_entrypoint_starts_services.py`
- **Known gaps:** The entrypoint test reads the startup function's source text for known symbols, so a service that is started by some other spelling would still pass it — the tripwire catches the known failure shape, not every one.

## Presence

### 🟢 Home location and named places  `home-location-and-places`

> Drop a pin on your home, name the places that matter, and use them in automations.

An admin saves the home's coordinates and radius from Settings or straight from the current device position; saving it also creates a wide "near home" ring automatically, so head-start automations like pre-cooling always have something to fire on. Beyond home, a household can define extra named places — work, school, anywhere — each with its own radius, and every person tracks their own state per place independently.

- **Status:** `live-prod` — VERIFIED at 0d0fda3, and every cited file is present in release-2026.09.18-4: named places live in services/zones_registry.py over user_files/zones.json; the wide approach ring is auto-created and re-centred whenever the home is saved (backend/routers/presence_router.py:465-467, APPROACH_ZONE_NAME at services/zones_registry.py:134); the home coordinates resolve at services/presence_engine.py:372-395; the routes are registered on the production entrypoint at backend/server.py:659. This replaces an earlier citation of services/zones_manager.py, a filename that has never existed in this repository — a salvage artefact from the reconciled extraction.
- **Layer:** Presence · **Audience:** user-facing
- **Built from:** `zones-registry`, `presence-state-machine`
- **Composes with:** `leaving-and-arriving` (via presence-state-machine, zones-registry), `smart-room` (via presence-state-machine), `whos-home` (via presence-state-machine)
- **Surfaces:** `frontend/src/pages/Settings.jsx`, `services/zones_registry.py`, `services/presence_engine.py`, `backend/routers/presence_router.py`
- **Known gaps:** A named place is identified by its name, so renaming one in the UI silently orphans every automation that referenced it.; If no Ziggy home is ever configured, the engine falls back through Home Assistant's own zone before giving up entirely.

### 🔵 Household permissions and wall-panel guardrails  `household-permissions`

> Decide what each person in the house is allowed to do — and stop a wall tablet being talked into unlocking a door.

A People page lets you give each household member an access level, shows a live matrix of what that actually permits on this specific home, and offers a "try a command" panel that shows the real allow/deny decision with its reasoning. Separately, a wall tablet's restrictions are enforced at the one point every command converges on, so typing a restricted request into the tablet's own assistant is refused exactly like tapping the equivalent locked button. Ziggy's own repair agent is held to the same rules, decided below the conversation so a cleverly worded message cannot argue its way past them: read-only checks it simply does, a reconnect it does and then tells you about with a short window to undo, and anything that runs a command, changes settings or pairs a device waits for a human yes — with the machine hosting your home off-limits to it entirely. When it acts on behalf of a person it can never exceed what that person is allowed themselves.

- **Status:** `flagged` — The People page is described in presence.reconciled.json as built and tested but not enforced by default — project memory (project_permission_platform.md) records the engine as complete with 83 passing tests but not wired into command paths, with enforcement still behind a default-off flag. The wall-tablet gate is a separate, VERIFIED live-prod mechanism (chat-and-assistant.verified.json id=wall-tablet-natural-language-gate): core/action_parser.py:65-96 runs before multi-intent fan-out, ancestor of release-2026.08.14-8, commit 634902e. | Mode gap re-checked at 0d0fda3: services/mode_service.py is now a facade over services/modes.py; services/automation_catalog.py:186 and :234 expose a `mode` condition and a `set_mode` action; services/presence_side_effects.py holds everyone-left automations while guest mode is on (commit 4766c791, which no release-* tag contains — `git tag --contains` is empty), and that guard is wrapped in a try/except that logs and continues. | Also this pass: The People page is described in presence.reconciled.json as built and tested but not enforced by default — project memory (project_permission_platform.md) records the engine as complete with 83 passing tests but not wired into command paths, with enforcement still behind a default-off flag. The wall-tablet gate is a separate, VERIFIED live-prod mechanism (chat-and-assistant.verified.json id=wall-tablet-natural-language-gate): core/action_parser.py:65-96 runs before multi-intent fan-out, ancestor of release-2026.08.14-8, commit 634902e. VERIFIED (2026-09 pass): the AI-autonomy half IS now enforced in shipped code — commit a487ac1 is an ancestor of release-2026.09.18-4 and registers principal agent:ziggy with its autonomy table and envelope grants from services/permissions/reconcile.py:199 (core/agent/authz.py seed_agent_principal), bootstrapped on every boot from the production entrypoint at backend/server.py:291 (ensure_bootstrapped); gates are called at core/agent/tools.py:492, 747 and 764 and at services/repair_ladder.py:186-194 (commit 2f3cfb7, also an ancestor of the newest tag), both documented and coded to fail open when the store is unseeded; tests/test_agent_autonomy_gate.py.
- **Layer:** Presence · **Audience:** user-facing
- **Built from:** `persons-registry`, `policy-decision-engine`
- **Composes with:** `track-my-location` (via persons-registry), `whos-home` (via persons-registry)
- **Surfaces:** `backend/routers/permissions_router.py`, `core/action_parser.py`, `frontend/src/pages/People.jsx`, `services/consent.py`, `services/permissions/`, `services/wall_policy.py`
- **Known gaps:** The four-way house mode a wall tablet sets is no longer a dead end: it is now a thin shim over five fixed modes — Sleep, Movie, Cleaning, Guests, Vacation — that automations can both test and set, and Guests really does stop "everyone left" from running while people without tracked phones are in the house. None of that is in a release tag yet, so a customer home still has the old mode that drives nothing; and the guest check deliberately fails open, so if it errors the departure automations run exactly as before.; AI autonomy ladder, permission delegation, conditional obligations and the consent ledger are all built and tested but have no UI and are called from nowhere the live assistant actually runs.; The core enforcement engine is off by default in production; only the read/display surfaces (People & Access, kid allowlist) are actually live.; The wall-tablet safety gate fails open on an internal error by design, relying on a second, independent check at the network layer as backup.; Today the People page shows a policy that is displayed but not enforced for most command paths — a household member sees an access level that doesn't actually gate anything yet.; A separate four-way "home mode" (home/away/night/vacation), settable from any wall tablet and visible on all of them, exists but drives nothing: no trigger, condition or action in the automation vocabulary can reference it.; Permission delegation, conditional obligations and the consent ledger are still built and tested with no UI and no live caller. The AI autonomy ladder is the one piece of that group that is now genuinely enforced, and only on the repair agent's own remediations.; The core enforcement engine is off by default for commands a person types or taps; only the read/display surfaces (People & Access, kid allowlist) and the agent gate are actually live.; The agent gate deliberately fails open: if the policy store was never seeded on this home, or it errors, the repair agent keeps the unattended powers it has always had rather than losing a fix the household depends on. A home whose store failed to bootstrap is therefore silently ungated, and nothing surfaces that.

### 🟠 Stopping the phone from killing Ziggy (orphaned)  `battery-killer-coaching`

> Meant to walk you into the hidden setting that stops your phone freezing Ziggy — the walk-through never actually fires.

Samsung and Xiaomi phones freeze background apps in ways the standard Android battery dialog cannot reach, which is what silently breaks arrival and departure automations. The plugin correctly requests the standard battery-optimization exemption and, for OEMs with a hidden 'autostart' switch, is meant to deep-link straight into that exact settings screen — eleven brands' worth of deep links are fully written. But the JavaScript caller checks response field names the native plugin never actually returns, so the branch that opens the autostart screen can never be reached from any shipped build.

- **Status:** `orphaned` — ZiggyPresencePlugin.kt:485-489 (getAntiKillStatus) resolves manufacturer/battery_optimization_exempt/autostart_whitelisted(hardcoded null)/has_oem_deep_link; release-2026.08.14-8:frontend/src/lib/native.js:128-133 (ensureBackgroundAllowed) tests before?.batteryOptimized, before?.exempt and after.canBeKilled — none of those three key names is ever emitted, so stillKillable is always false and openManufacturerAutostartSettings() is unreachable from any shipped bundle.
- **Layer:** Presence · **Audience:** user-facing
- **Shipped:** 2026-05-28 (`32cee75`)
- **Built from:** `ziggy-presence-plugin`
- **Composes with:** `drove-past-home-guard` (via ziggy-presence-plugin), `mobile-presence-detection` (via ziggy-presence-plugin)
- **Surfaces:** `ziggy_mobile/plugins/ziggy-presence/android/src/main/kotlin/app/ziggy/presence/OemAutostart.kt`, `ziggy_mobile/plugins/ziggy-presence/android/src/main/kotlin/app/ziggy/presence/ZiggyPresencePlugin.kt`, `ziggy_pc/frontend/src/lib/native.js`
- **Known gaps:** The same key mismatch also defeats the 'already exempt' short-circuit, so the standard battery dialog is re-requested on every app start instead of once.; autostart_whitelisted is always null on Android because the state is unreadable — even if the deep link opened, nothing could confirm the user flipped the switch.; iOS returns hardcoded exempt/whitelisted stubs, so this must never be treated as a real check on iPhone.; There are no user-facing strings for battery optimisation or autostart anywhere in the app, so nothing explains the system dialog when it does appear.

### ⚫ Telling driving past from arriving (abandoned)  `drove-past-home-guard`

> Driving past your street shouldn't start your whole home — the guard built for this is switched off.

A fully-written feature holds an arrival for a few minutes when the phone believes it is in a car, releasing at once if you stop driving or discarding it if you were only passing through and leave the ring. It is implemented end-to-end on both Android and iOS, including a matching suppression rule on the hub side — but Android strips the ACTIVITY_RECOGNITION permission from every shipped build to avoid a Google Play Health-apps policy review, so the on-device 'am I driving' signal never leaves false and the guard can never actually fire on a real phone.

- **Status:** `abandoned` — ziggy_mobile/android/app/src/main/AndroidManifest.xml:70 strips ACTIVITY_RECOGNITION with tools:node="remove" (added in commit 27bcc58, comment cites Google Play's Health-apps policy); confirmed absent from the built merged manifest at android/app/build/intermediates/merged_manifest/debug/processDebugMainManifest/AndroidManifest.xml. release-2026.08.14-8:frontend/src/App.jsx:929 still calls startActivityRecognition() into a dead permission.
- **Layer:** Presence · **Audience:** user-facing
- **Shipped:** 2026-08-01 (`27bcc58`)
- **Built from:** `ziggy-presence-plugin`, `home-geofence-registry`
- **Composes with:** `mobile-presence-detection` (via home-geofence-registry, ziggy-presence-plugin), `battery-killer-coaching` (via ziggy-presence-plugin)
- **Surfaces:** `ziggy_mobile/android/app/src/main/AndroidManifest.xml`, `ziggy_mobile/plugins/ziggy-presence/android/src/main/kotlin/app/ziggy/presence/ZiggyPresencePlugin.kt`, `ziggy_mobile/plugins/ziggy-presence/ios/Sources/ZiggyPresencePlugin/ZiggyPresencePlugin.swift`, `ziggy_pc/frontend/src/App.jsx`, `ziggy_pc/services/mobile_app.py`
- **Known gaps:** Reinstating it needs a Google Play Health-apps policy declaration, per the manifest comment.; The onboarding step still asks for the Motion permission and promises it 'lets Ziggy tell the difference between you arriving home and you driving past' — a promise Android cannot keep.; The kill-proof cold-delivery path bypasses the guard entirely, so exactly the case that matters most — app killed, driving home — is unguarded regardless of whether the permission exists.; The hub's own drive-past suppression (services/mobile_app.py: LAN-unreachable-AND-driving suppresses the enter) is starved of the same missing 'driving' signal, so it is equally inert on Android.

### 🟢 Track your location, and invite the household  `track-my-location`

> Grant location once and Ziggy knows when you're home — send a link to invite someone else.

A logged-in household member turns on "Track my location" in Settings and their phone or browser starts reporting position. Creating a person for someone else mints a private link — no account or app install needed — that opens a small page asking for location once and then keeps reporting; the link itself is the credential.

- **Status:** `live-prod` — Carried from presence.reconciled.json (reconciled-angle salvage, not independently re-verified). Cited sources: services/presence_engine.py person-registration path and a presence-invite router referenced in the source records.
- **Layer:** Presence · **Audience:** user-facing
- **Built from:** `persons-registry`, `presence-side-effect-fanout`
- **Composes with:** `whos-home` (via persons-registry, presence-side-effect-fanout), `household-permissions` (via persons-registry), `leaving-and-arriving` (via presence-side-effect-fanout)
- **Surfaces:** `backend/routers/presence_router.py`, `frontend/src/pages/Settings.jsx`, `services/presence_engine.py`
- **Known gaps:** iOS Safari suspends location tracking once the browser tab is backgrounded, so GPS-only presence for a self-tracked user decays to unknown after about 30 minutes.; The invite-link path cannot detect someone leaving at all — phone browsers stop the location watch the moment the page is backgrounded, so it only works well for confirming arrival, and is effectively superseded by the native app.; An invited person's link can only be replaced by deleting and recreating them; there's no rotate option.

### 🟢 Who's home right now  `whos-home`

> See at a glance who is home and who is out, without a single false alarm from a napping phone.

Every household member gets their own home/away state, decided from their phone's location and from whether the phone answers on the home Wi-Fi. The decision is deliberately slow to flip — a contradicting reading has to persist, a phone dozing on the sofa is woken with a silent push and given a grace window before Ziggy calls it a departure — and the state decays to "unknown" rather than lying when a phone goes quiet. Everything that cares about "is anyone home" — the dashboard, chat answers, anomaly checks, automations — reads this one answer.

- **Status:** `live-prod` — VERIFIED at 0d0fda3, all four surfaces present in release-2026.09.18-4: the decision engine is swept from the production scheduler tick (services/ziggy_scheduler.py:40-43), the Wi-Fi probe runs from services/ziggy_scheduler.py:411, and backend/server.py:659 registers the presence routes — nothing here depends on core/ziggy_main.py. The live presence console is frontend/src/pages/DebugPage.jsx (its "presence" channel); the previously cited frontend/src/components/PresenceDebug.jsx has never existed in this repository's history and was a salvage artefact. The production incidents behind the gaps below remain documented in project memory (project_presence_lan_host_pinning.md, project_presence_departure_evidence.md).
- **Layer:** Presence · **Audience:** user-facing
- **Built from:** `presence-state-machine`, `persons-registry`, `presence-side-effect-fanout`
- **Composes with:** `leaving-and-arriving` (via presence-side-effect-fanout, presence-state-machine), `track-my-location` (via persons-registry, presence-side-effect-fanout), `home-location-and-places` (via presence-state-machine), `household-permissions` (via persons-registry), `smart-room` (via presence-state-machine)
- **Surfaces:** `services/presence_engine.py`, `services/lan_presence.py`, `backend/routers/presence_router.py`, `frontend/src/pages/DebugPage.jsx`
- **Known gaps:** For months the loudest source of arrival/departure notifications was a bug, not real movement: a pinned phone address going stale manufactured a false departure and re-arrival roughly every 30 minutes, fixed by probing before trusting a self-reported address.; An admin escape hatch to manually force someone home or away exists on the backend but has no button anywhere in the app — during real incidents, operators edited the household file by hand instead.; A phone with no push-capable app can never answer the wake-up probe, so its departure decision runs on a timer alone; two abandoned fixes (a six-hour departure hold, and identifying phones by hardware address) were tried and dropped in favor of the probe-based design.

### 🟢 Ziggy knows when you arrive and leave  `mobile-presence-detection`

> Your home reacts when you actually cross the doorstep, not when you remember to tell it.

Custom native code watches invisible rings around the home — a tight one at the house and a wider approach ring further out — and wakes Ziggy the moment you cross either, even with the app closed, by posting straight to the hub from native code with no app running at all. When the hub is unsure whether you are home or approaching, it can wake the phone itself with a silent push, get one location fix back, and switch to a precise tracking stream for the last few kilometres of a drive home. The phone also reports its own Wi-Fi address on every message so the hub can find and verify it on the home network without anyone typing an IP, and 'Near Home' crossings start pre-cooling and similar automations before you actually arrive.

- **Status:** `live-prod` — ziggy_mobile/plugins/ziggy-presence (addGeofence, NativeDelivery.kt, getLanIp) is registered in the built app's capacitor.plugins.json; hub side in ziggy_pc/services/mobile_app.py, services/mobile_push.py, services/lan_presence.py, services/ziggy_scheduler.py:417. tests/test_presence_probe_before_deciding.py, test_presence_lan_host_selfheal.py and test_lan_presence.py all pass at release-2026.08.14-8.
- **Layer:** Presence · **Audience:** user-facing
- **Shipped:** 2026-07-21 (`83a4f24`)
- **Built from:** `ziggy-presence-plugin`, `home-geofence-registry`, `native-delivery-channel`, `fcm-push-channel`, `mobile-webhook`, `mobile-device-registry`
- **Composes with:** `drove-past-home-guard` (via home-geofence-registry, ziggy-presence-plugin), `mobile-notifications` (via fcm-push-channel, mobile-device-registry), `battery-killer-coaching` (via ziggy-presence-plugin), `live-house-state-on-phone` (via mobile-device-registry), `pair-phone-to-home` (via mobile-device-registry)
- **Entry points:** `POST /api/mobile/webhook/{webhook_id}`
- **Surfaces:** `ziggy_mobile/plugins/ziggy-presence/android/src/main/kotlin/app/ziggy/presence/ZiggyPresencePlugin.kt`, `ziggy_mobile/plugins/ziggy-presence/ios/Sources/ZiggyPresencePlugin/ZiggyPresencePlugin.swift`, `ziggy_mobile/plugins/ziggy-presence/android/src/main/kotlin/app/ziggy/presence/NativeDelivery.kt`, `ziggy_mobile/android/app/src/main/java/com/ziggyhome/app/ZiggyMessagingService.java`, `ziggy_pc/frontend/src/App.jsx`, `ziggy_pc/services/mobile_app.py`, `ziggy_pc/services/mobile_push.py`, `ziggy_pc/services/lan_presence.py` …and 1 more
- **Tests:** `ziggy_pc/tests/test_presence_probe_before_deciding.py`, `ziggy_pc/tests/test_presence_expiry_last_fix_at_home.py`, `ziggy_pc/tests/test_presence_lan_host_selfheal.py`, `ziggy_pc/tests/test_lan_presence.py`
- **Known gaps:** Android-only for the kill-proof cold-delivery path and the hub-initiated probe — iOS has no configureDelivery (absent from ZiggyPresencePlugin.swift's pluginMethods list) and no APNs equivalent to wake a killed app, so a killed iPhone still relies on the JS bridge waking up.; The probe was silently dead for four days (2026-08-10 to 2026-08-14) after a rebuild stripped production topology, and presence went back to guessing in that window.; Two independent reporters fire on the same geofence crossing — an older bridge (mobilePresenceBridge.jsx) still posts the raw zone-centre coordinates verbatim, which the newer code's own comment says 'would read as still home and defeat leave-detection entirely'.; A geofence event carries the ring's centre, not the phone, and a Samsung force-kill silently unregisters the OS-side rings until an FCM probe or an app open re-arms them.; A separate 'phone sensor' ingest path was designed to feed presence and anomaly detection and was left a stub — nothing reads the values it stores.

## Release

### 🟠 Building and shipping the app  `mobile-build-and-store-readiness`

> Everything needed to build the app locally is one command; getting it onto an app store has never gotten past a Mac and a cable.

A doctor script checks the whole toolchain and names the exact install command for anything missing; a setup script then builds the Ziggy web interface, copies it into the app, and generates both native projects — this is genuinely how every shipped Android build was produced. Automatic CI builds on push were also set up for both platforms, an iPhone pricing-string guard exists to stop Apple's 30% cut from becoming a rejection reason, and a full iOS privacy-manifest pass fixed everything else Apple's review checks. None of that release machinery has ever produced a real release: both CI pipelines stop at a guard step, the pricing guard is never invoked, and distribution today is a wireless developer connection from one Mac to one phone.

- **Status:** `orphaned` — ziggy_mobile/scripts/{doctor,setup,sync-frontend,build-android,build-ios}.sh produced app-release.aab (2026-08-03) and app-debug.apk (2026-08-09) on disk, so the local toolchain genuinely works. Both .github/workflows/build-{android,ios}.yml stop at a 'Verify www/ exists' step because www/ is gitignored (added in 32cee75, never fixed since). No iOS .ipa has ever been archived; ios_pricing_string_guard.py is invoked by no CI workflow and no ship.sh step. Play Store publishing is blocked on account identity verification (mobile-dev-accounts memory).
- **Layer:** Release · **Audience:** operator
- **Built from:** `capacitor-web-shell`
- **Composes with:** `adopt-a-lan-only-home` (via capacitor-web-shell), `native-voice-dictation` (via capacitor-web-shell), `pair-phone-to-home` (via capacitor-web-shell), `ziggy-mobile-app` (via capacitor-web-shell)
- **Surfaces:** `ziggy_mobile/scripts/doctor.sh`, `ziggy_mobile/scripts/setup.sh`, `ziggy_mobile/scripts/sync-frontend.sh`, `ziggy_mobile/scripts/build-android.sh`, `ziggy_mobile/scripts/build-ios.sh`, `ziggy_mobile/.github/workflows/build-android.yml`, `ziggy_mobile/.github/workflows/build-ios.yml`, `ziggy_mobile/ios/App/App/PrivacyInfo.xcprivacy` …and 2 more
- **Known gaps:** The local build toolchain genuinely works and is how every shipped artifact to date was made — the gap is entirely downstream of it.; Both native CI workflows have never once produced a build; they guard on a gitignored www/ directory that is never populated in CI.; The iOS privacy manifest and pricing guard are committed and correctly wired but have never accompanied a real submission — no .ipa exists anywhere.; Distribution today is stage one of a planned three (adb sideload → private tester track → public listing); only stage one has ever happened.; Release signing depends on an untracked keystore.properties, so CI could not sign a release build even if it got past the www/ guard.

## Rooms & dashboard

### 🟢 Home screen  `home-screen`

> Open the app and see, at a glance, whether the home is calm or awake.

The phone home screen greets by time of day, says who is home, and reports in one line whether the house is quiet or how many rooms are active, folding in what's playing on a media device when there is one. On canary homes a row of home-mode chips now sits with the greeting, so the whole house can be put into a mode from the first screen. Below it sit a swipeable rooms carousel, pinned shortcuts and quick device controls (both per person, following you to any screen you sign into), an alerts strip and a collapsible recent-activity feed reading the hub's event log.

- **Status:** `live-prod` — frontend/src/pages/Dashboard.jsx (now 1633 lines), index route at frontend/src/App.jsx:596, rebuilt across commits 1ada9de/5613e04/de8feae; rooms carousel iterated across 9 commits ending in 7171988; pinned shortcuts/quick controls in backend/routers/ui_prefs_router.py; activity feed backend/routers/activity_router.py:29 reading user_files/events.jsonl. The 2026-09-11 design pass (301f404, 4ea9d85) was reverted by bb92e19 and re-landed as b3f6b18, which is what ships in release-2026.09.18-4. The mode chip row (frontend/src/components/home/ModeChips.jsx, rendered at frontend/src/pages/Dashboard.jsx:1282) arrived with commit cc4d842 and is NOT in release-2026.09.18-4 — it is on main and canary only.
- **Layer:** Rooms & dashboard · **Audience:** user-facing
- **Built from:** `ui-prefs-store`, `live-state-broadcast`, `device-and-room-registry`
- **Composes with:** `rooms` (via device-and-room-registry, ui-prefs-store), `ziggy-wall` (via device-and-room-registry, live-state-broadcast), `add-a-device` (via device-and-room-registry), `buttons-and-remotes` (via device-and-room-registry), `device-lifecycle-management` (via device-and-room-registry), `external-assistant-access` (via live-state-broadcast) …and 10 more
- **Surfaces:** `frontend/src/pages/Dashboard.jsx`, `backend/routers/ui_prefs_router.py`, `backend/routers/activity_router.py`
- **Known gaps:** Only the first media device found is mentioned in the summary line.; The pinned-shortcuts and quick-controls lists are easy to confuse in code; a different surface (the wall's Pinned card) once read the wrong one and silently fell through.; A whole-app design pass on 2026-09-11 rebuilt this screen, was reverted the same afternoon (bb92e19) and re-landed fifteen minutes later as a tighter second cut (b3f6b18). What customers see today is that second cut — the first one is not the reference.; That design pass silently swapped the icons people had chosen for a generic line set, and restoring the default was not enough: it had already written the new style into every browser's stored preferences, so a third preference version had to rewrite the stored value back (0bbeff6). A design pass must never write to the icon-style preference; it was only safe to undo because the bad version was live for about an hour.

### ⚫ Interactive floor plan  `interactive-floor-plan`

> Draw your home's layout once and see your devices on it.

A 2D floor-plan editor draws rooms as polygons you drag into position, with live device pins overlaid on top and room summaries of what's on. A further step was meant to turn the flat plan into an isometric picture of the home with a large model adding furniture and polish, cached once per layout.

- **Status:** `abandoned` — The editor lost its only route when a 2026 redesign (commit 8340fca) removed the render call, though the backend (backend/server.py:619) still answers requests nothing sends. CLAUDE.md's own Known TODOs lists the AI-drawn visual as on hold ('GPT-4o struggles to enrich isometric SVG') and its UI button is commented out in code (TODOS.md:94). Two merged records (the floor-plan editor and the AI-drawn visual) disagreed on status; the more conservative, abandoned, is used.
- **Layer:** Rooms & dashboard · **Audience:** user-facing
- **Built from:** `device-and-room-registry`
- **Composes with:** `add-a-device` (via device-and-room-registry), `buttons-and-remotes` (via device-and-room-registry), `device-lifecycle-management` (via device-and-room-registry), `home-screen` (via device-and-room-registry), `ir-wifi-merged-device` (via device-and-room-registry), `matter-commissioning` (via device-and-room-registry) …and 6 more
- **Surfaces:** `frontend/src/pages/HomeMap.jsx`, `frontend/src/pages/HomeMapBuilder.jsx`, `frontend/src/pages/HomeMapCanvas.jsx`, `backend/routers/map_router.py`, `services/map_renderer.py`
- **Known gaps:** Both halves are unreachable in the current app: the floor-plan page has no route, and the AI-render button on the page that would hold it is commented out.

### 🟢 Room-level alerts  `room-alerts`

> Ziggy tells you when a room's state doesn't add up, and offers to fix it.

Alerts are computed per room, everyone out with lights still on, a door open while the air conditioning runs, motion in an empty room at night, and surface with a one-tap fix and a per-room snooze. They also feed a severity strip on the home screen.

- **Status:** `live-prod` — Endpoints /api/map/anomalies/{active,history,snooze,action} at backend/routers/map_router.py:267-333, registered backend/server.py:619, consumed by frontend/src/pages/Anomalies.jsx and frontend/src/pages/Dashboard.jsx:829; commit 29670ca 'real room names in alerts'.
- **Layer:** Rooms & dashboard · **Audience:** user-facing
- **Built from:** `device-and-room-registry`
- **Composes with:** `add-a-device` (via device-and-room-registry), `buttons-and-remotes` (via device-and-room-registry), `device-lifecycle-management` (via device-and-room-registry), `home-screen` (via device-and-room-registry), `interactive-floor-plan` (via device-and-room-registry), `ir-wifi-merged-device` (via device-and-room-registry) …and 6 more
- **Surfaces:** `backend/routers/map_router.py`, `frontend/src/pages/Anomalies.jsx`, `frontend/src/pages/Dashboard.jsx`
- **Known gaps:** These endpoints live under /api/map/* purely because the alert engine was originally built as part of the (now orphaned) floor-plan work; the alerts themselves are unaffected by that.

### 🟢 Rooms  `rooms`

> Make a room, give it a photo, and put your devices in it, and it stays exactly how you left it.

Rooms are created, renamed, photographed, reordered and deleted from the Rooms page; each room opens to its devices grouped by kind, its automatic actions and its scenes. Every room always shows a picture: your own upload first, then the one picked in the room editor, then a curated photo matching the room, then the house default. Room membership is real only when a person set it: Ziggy never guesses a room from a device's name or auto-places a new device, and a deleted room cannot come back on its own. A room with several thermometers can show their average instead of whichever one was found first, a fused presence sensor drives an occupied chip on the tile, tapping a sensor reading opens that sensor's own page, and the room's menu is where you combine its motion and presence sensors into one reliable Smart Presence reading. One action resets every room's layout without unpairing a single device; the same routine runs as a gate before a hub ships to a customer.

- **Status:** `live-prod` — Room ownership fix cbf10ba hardened by 4e98a0d and 2e85ac2, tests/test_room_ownership.py and tests/test_room_area_convergence.py; reset action commit bff46a0 with ship gate scripts/factory/kit-ready-check.sh step 7; average temperature commit 1057567; occupancy chip commit 5c69027; clickable sensor tiles commit 3195e55; Smart Presence menu entry commit fa2cdf2; automatic room photos restored in frontend/src/lib/roomPhotos.js by commit 0228a83, an ancestor of release-2026.09.18-4.
- **Layer:** Rooms & dashboard · **Audience:** user-facing
- **Built from:** `device-and-room-registry`, `ui-prefs-store`, `template-sensor-factory`
- **Composes with:** `home-screen` (via device-and-room-registry, ui-prefs-store), `smart-device-cards` (via device-and-room-registry, template-sensor-factory), `add-a-device` (via device-and-room-registry), `buttons-and-remotes` (via device-and-room-registry), `device-lifecycle-management` (via device-and-room-registry), `interactive-floor-plan` (via device-and-room-registry) …and 6 more
- **Surfaces:** `frontend/src/pages/Rooms.jsx`, `services/device_registry.py`, `services/rooms_admin.py`, `services/room_alias_bank.py`
- **Tests:** `tests/test_room_ownership.py`, `tests/test_room_area_convergence.py`
- **Known gaps:** The room-ownership model was rewritten three times in eleven days as each stricter rule stranded real devices; Hebrew room names briefly stranded every device assigned to them (fixed commit 5a79a96) because the room key was derived by stripping non-ASCII characters.; An infrared device with no chosen room used to invent a room from the device's own name, which then got promoted into a permanent area on the next startup; fixed (commit 5139025) so an empty room stays empty.; The eighteen preset room photos are remote Unsplash URLs; a hub with no internet shows no preset photos at all.; A design pass dropped the automatic photo fallback because the same stock sofa was landing on four tiles of a seven-room home — and with it gone every room drew the identical house glyph instead, which moved the repetition rather than fixing it. The fallback was restored the same day (0228a83). Do not delete it again without a real answer to the repetition; the plain-tile renderer is still there behind a null photo, so a better default can replace it without touching the tiles.

### 🔵 Shared household lists  `household-lists`

> One shopping list and one day's agenda the whole house sees, on every screen.

A shopping list and a today's agenda live on the hub rather than in a tablet's browser, so every wall panel and phone in the home sees the same items and it survives a cache wipe or a factory-reset tablet. Items and events can be added, ticked, renamed, cleared or completed, and every change broadcasts instantly to every surface.

- **Status:** `flagged` — Backend is live, services/wall_lists.py with endpoints at backend/routers/wall_router.py:337-449, forwarded to phones by services/mobile_ws_bridge.py, but the design spec explicitly lists a phone-app UI as out of scope for v1 (docs/superpowers/specs/2026-08-08-ziggy-wall-dashboard-design.md §2), so the only usable surface today is the wall card.
- **Layer:** Rooms & dashboard · **Audience:** user-facing
- **Built from:** `live-state-broadcast`
- **Composes with:** `external-assistant-access` (via live-state-broadcast), `home-screen` (via live-state-broadcast), `household-music` (via live-state-broadcast), `remote-device-state-tracking` (via live-state-broadcast), `ziggy-wall` (via live-state-broadcast)
- **Surfaces:** `services/wall_lists.py`, `backend/routers/wall_router.py`, `frontend/src/wall/modules/ListModules.jsx`
- **Known gaps:** Built app-ready and already forwarded to phones over the websocket, but the phone-app screen to read it was never built; reachable only from the wall.

### 🟢 Ziggy Wall  `ziggy-wall`

> The tablet on your wall shows your whole home, live, and you can touch anything on it, safely.

An always-on, room-first dashboard at /wall for the tablet on the kitchen or hallway wall: every room and its devices, plus cards for scenes, weather, cameras, lists, media and more, arranged by holding a card to move it and pulling a corner to resize. It reads the same live state as every phone in the house within about a second. Tapping a device opens the app's real device page as an overlay rather than a cut-down copy. A fixed rooms rail and a Talk-to-Ziggy bar never move even while the board is rearranged, and an idle screen dims to a clock after inactivity. An ordinary tablet becomes a wall panel with one setting and no second pairing, and it silently provisions its own restricted identity. Getting back out is a labelled Exit button, in the wall header and again at the foot of the rooms panel, which asks before it leaves and sits behind the panel's PIN when one is set — so a child cannot tap their way off the wall while an adult always has a way out, and the panel's pairing and permissions survive the trip. Each panel carries its own permission set (which rooms, which locks, which media) configured from Settings, is refused at the hub for anything it isn't allowed, and can never count as a person being home no matter how long it stays on.

- **Status:** `live-prod` — Introduced by commit 9c49ca0 (2026-08-08), contained in release-2026.08.10 and every later release tag; wall mode commit 52e8942; self-adopt pairing dc57a9d fixed by 227dd82; device-page overlay a9b975d/7da8cce; permissions services/wall_policy.py + backend/middleware/wall_capability.py hardened by commit 634902e (77 pytest cases in tests/test_wall_dashboard.py); presence exclusion commit e051f9a. Visible exit added by commits 20fb993 and 2907c90 — frontend/src/wall/WallChrome.jsx ExitWallButton/ExitWallSheet, the rail's row variant in frontend/src/wall/RoomsRail.jsx:351, the PIN gate at frontend/src/pages/Wall.jsx:99-110, covered by frontend/src/wall/__tests__/exitWall.test.jsx — and all of it, plus the four wall fixes that were unreleased at the last catalog build (916812a, dd93ee8, 91e51f3, 0aa7d83), is an ancestor of release-2026.09.18-4.
- **Layer:** Rooms & dashboard · **Audience:** user-facing
- **Built from:** `wall-layout-engine`, `wall-capability-policy`, `live-state-broadcast`, `device-and-room-registry`
- **Composes with:** `home-screen` (via device-and-room-registry, live-state-broadcast), `add-a-device` (via device-and-room-registry), `buttons-and-remotes` (via device-and-room-registry), `device-lifecycle-management` (via device-and-room-registry), `external-assistant-access` (via live-state-broadcast), `household-lists` (via live-state-broadcast) …and 10 more
- **Surfaces:** `frontend/src/pages/Wall.jsx`, `frontend/src/wall/WallChrome.jsx`, `frontend/src/wall/WallGrid.jsx`, `frontend/src/wall/RoomsRail.jsx`, `frontend/src/wall/DevicePageModal.jsx`, `frontend/src/wall/ZiggyBar.jsx`, `services/wall_policy.py`, `backend/routers/wall_router.py`
- **Tests:** `tests/test_wall_dashboard.py`
- **Known gaps:** Real touch drag/resize on a physical panel and an overnight soak were never completed per the design spec (docs/superpowers/specs/2026-08-08-ziggy-wall-dashboard-design.md §14.7).; For its first month the only way out of wall mode was an undocumented two-second press on the logo confirmed by a browser dialog, and on a touch screen the browser's own long-press handling could cancel the pointer before the timer fired. The Settings toggle was no escape either, because a wall-mode device rewrites '/' to /wall on boot. Tablets got stuck. Do not make the exit invisible again (fixed 20fb993, 2907c90); the logo long-press survives only as a second way in.; A bookmark or home-screen shortcut to any page other than /wall, /ops or /presence still bounces to the home screen on a cold start — those three are the whole deep-link list in frontend/src/lib/bootRedirect.js, so a new kiosk target has to be added there or it will not survive a boot.; The mic in Talk-to-Ziggy is unavailable over plain http://<hub-ip>, which is how the wall is reached today; the bar falls back to tap-to-type and explains why once.; The first cut of tablet permissions keyed identity on a self-asserted header, and separately gated only URLs so a typed command could bypass a locked-out capability; both were fixed (634902e) by binding identity to a real hashed credential and moving enforcement into the intent handler itself.

## Mechanisms

Reusable building blocks. `used_by` answers *where else is this used?*

### action

#### Protected live-state guard  `protected-state-guard`

The backup-and-restore pair wrapped around any move of the code tree, installed as an exit trap, that protects a home's own automations/scripts/scenes from being replaced by the release copy — and refuses to restore a saved file that is smaller than the live one.

- **Used by:** `home-backup-and-recovery`, `safe-update-guarantee`
- **Surfaces:** `scripts/linux/ziggy-update.sh`, `scripts/linux/ziggy-customer-reset.sh`

### alert-channel

#### Android push channel (Firebase Cloud Messaging)  `fcm-push-channel`

The two-way Android push path: on the hub, a Firebase service-account key sends both ordinary notifications and silent data-only messages; on the phone, Ziggy's own messaging service (which replaces Capacitor's stock one) intercepts the silent operational types natively — re-arming geofences, taking a fix, starting or stopping precision tracking — and forwards every ordinary alert straight through to the standard notification pipeline.

- **Used by:** `mobile-notifications`, `mobile-presence-detection`
- **Health:** ⚠️ Requires config/firebase-service-account.json per home; absent, every send returns fcm_not_configured. Only one service may own MESSAGING_EVENT, so this depends on a manifest strip of Capacitor's own service — a Capacitor upgrade that renames that class would silently restore stock behaviour and kill the probes. Was already dead for four days in August 2026 after a rebuild stripped production topology.
- **Surfaces:** `ziggy_pc/services/mobile_push.py`, `ziggy_mobile/android/app/src/main/java/com/ziggyhome/app/ZiggyMessagingService.java`, `ziggy_mobile/android/app/src/main/AndroidManifest.xml`

#### Browser push channel (VAPID)  `web-push-channel`

The original delivery path: VAPID-signed web push to browser subscriptions stored on the hub, pruning endpoints that report themselves gone. It is the only channel that carries action buttons, and it is the channel the alert engine and habit-suggestion notifications both fire through.

- **Used by:** `alerts-inbox`, `mobile-notifications`
- **Health:** ⚠️ Android WebViews cannot receive web push at all — a phone that appeared as 'one subscription' was actually the owner's desktop Chrome. Made fire-and-forget after a single dead endpoint blocked the event loop for up to 30 s.
- **Surfaces:** `ziggy_pc/backend/routers/push_router.py`, `ziggy_pc/services/push_notify.py`

#### Kill-proof native delivery channel  `native-delivery-channel`

A JS-free HTTP path from native Android code to the hub's /api/mobile/webhook, holding its own persisted webhook URL and per-device bearer token in Android's app storage, so geofence receivers and the foreground service can all report with no app, no web view and no JavaScript running.

- **Used by:** `mobile-presence-detection`
- **Health:** ⚠️ Single synchronous POST with an 8 s timeout and no retry or queue — one network blip is a lost presence event. No iOS equivalent exists.
- **Surfaces:** `ziggy_mobile/plugins/ziggy-presence/android/src/main/kotlin/app/ziggy/presence/NativeDelivery.kt`, `ziggy_pc/frontend/src/App.jsx`

#### Push/alert delivery channel  `push-notification-channel`

The path an alert takes from a home to a person: per-attempt delivery is counted on the hub and rolled into telemetry so the fleet console can prove alerts actually arrived, and an optional outbound webhook can notify a customer directly when something like a support session touches their home.

- **Used by:** `fleet-health-and-repair`, `founder-remote-support`
- **Surfaces:** `services/push_stats.py`, `relay/app/routers/support_session.py`, `services/ha_outage_alert.py`

### bridge

#### Camera snapshot/stream proxy  `camera-proxy`

Ziggy-hosted URLs that relay a still frame or a live stream from Home Assistant's camera system, so the frontend and any AI-vision code never handle a Home Assistant address or token directly.

- **Used by:** `camera-ai-vision`, `cameras-screen`
- **Surfaces:** `ziggy_pc/backend/routers/camera_router.py`, `ziggy_pc/services/camera_utils.py`

#### Capacitor web shell and plugin bridge  `capacitor-web-shell`

The Capacitor runtime and its configuration that host Ziggy's React interface inside a native WebView, decide whether the UI is served from disk or a URL, and expose every official and custom plugin on the JS bridge. By convention native features are reached through the runtime plugin registry rather than imported packages, so the identical source runs in a browser (every native call silently no-ops) and in the app (where it resolves).

- **Used by:** `adopt-a-lan-only-home`, `mobile-build-and-store-readiness`, `native-voice-dictation`, `pair-phone-to-home`, `ziggy-mobile-app`
- **Health:** ⚠️ Silent by design: a phone on a binary that predates a plugin gets an undefined plugin and the feature simply does nothing, with no user-visible signal. server.url is a single-line switch between a store-safe bundled build and a network-loading build, with the dev variant sitting commented in the same file.
- **Surfaces:** `ziggy_mobile/capacitor.config.ts`, `ziggy_mobile/package.json`, `ziggy_mobile/ios/App/Podfile`, `ziggy_pc/frontend/src/lib/native.js`

#### Infrared send bridge  `ir-tx-bridge`

The path that actually fires an infrared command at a blaster, retrying once through an IP self-heal if the sensor's network address has drifted. Every outbound command funnels through this one call — a single button, an AC temperature, a channel number, each step of a macro — so the rehearsal check sitting at its head silences all of them at once, and sits above both the send and the modelled-state update rather than beside them.

- **Used by:** `crack-ac-remote-language`, `ir-in-automations`, `teach-ziggy-a-remote`, `voice-chat-media-control`
- **Health:** ⚠️ The rehearsal short-circuit is request-scoped rather than global: it silences only callers running inside a chat, voice, Actions or assistant-tool request. Anything driven by a scheduler keeps firing at the real blaster while the home is nominally rehearsing. The raw direct-send helper carries its own duplicate copy of the same check, so the two guards must be kept in step.
- **Surfaces:** `services/ir_manager.py`

#### Live state broadcast  `live-state-broadcast`

The WebSocket fan-out that pushes every state change to every open Ziggy screen, phone, wall panel or browser tab, within about a second of it happening; the mechanism every real-time surface in the app relies on.

- **Used by:** `external-assistant-access`, `home-screen`, `household-lists`, `household-music`, `remote-device-state-tracking`, `ziggy-wall`
- **Surfaces:** `backend/ws_manager.py`

#### Per-home HMAC signature  `relay-hmac-signature`

A timestamped HMAC over the exact request bytes, keyed on that home's own secret, with a five-minute skew window and constant-time comparison — the single authentication scheme for every hub-to-cloud call: registration, telemetry, update manifests, backup status and the AI proxy.

- **Used by:** `cloud-brain-relay`, `hub-connection-resilience`, `hub-provisioning-and-imaging`, `remote-home-access`
- **Surfaces:** `relay/app/audit.py`, `core/relay_signing.py`

#### Presence transition fanout  `presence-side-effect-fanout`

The one place a confirmed home/away change becomes a push notification, an automation run, and a live update to every open screen, regardless of which signal (phone GPS, Wi-Fi check, native app) triggered it.

- **Used by:** `leaving-and-arriving`, `track-my-location`, `whos-home`
- **Health:** ⚠️ Carried from presence.reconciled.json; every ingestion path is documented as routing through this one fanout so behaviour stays identical regardless of signal source.
- **Surfaces:** `services/presence_side_effects.py`

#### Relay-proxied chat client  `llm-relay-chat-client`

The model client used for every chat-family call; when the hub has relay credentials it routes through Ziggy's cloud relay and signs each request with the home's own secret, so customer homes carry no vendor key. Falls back to a direct client when relay isn't configured.

- **Used by:** `chat-with-ziggy`, `cloud-brain-relay`, `home-fixer`
- **Health:** ⚠️ Built once per process, so a settings change needs a restart; the direct-client fallback is also how a misconfigured hub can silently stop being centrally metered.
- **Surfaces:** `integrations/openai_client.py`, `integrations/llm_gateway.py`, `relay/app/routers/llm.py`

#### TV brand command adapters  `vendor-command-adapters`

Brand-specific command sets for LG webOS, Samsung and Sony Bravia TVs, used as the last resort in both the on-screen remote's button cascade and the network-to-infrared TV power fallback.

- **Used by:** `tv-remote-adaptive`, `voice-chat-media-control`
- **Surfaces:** `frontend/src/lib/mediaPlayerVendors.js`

#### The phone's private inbox  `mobile-webhook`

The per-device URL the app posts everything into — locations, geofence crossings, activity changes — translated on the hub into the same presence primitives that browser pings and Wi-Fi reachability already feed. The path's id must match the device's own, so a valid token used on the wrong URL is refused and logged.

- **Used by:** `mobile-presence-detection`
- **Health:** ⚠️ No rate limiting on any mobile route. It is also the incidental carrier for LAN-address healing, so changes to this route affect presence accuracy as well as ingest.
- **Surfaces:** `ziggy_pc/backend/routers/mobile_router.py`, `ziggy_pc/services/mobile_app.py`

#### ziggy-presence Capacitor plugin  `ziggy-presence-plugin`

The custom Swift + Kotlin plugin that owns everything the browser cannot do about location — permissions, geofences, background location, motion activity, the phone's own LAN address and the Android anti-kill surface — behind one TypeScript contract, so Ziggy's web UI sees a single stable JavaScript surface.

- **Used by:** `battery-killer-coaching`, `drove-past-home-guard`, `mobile-presence-detection`
- **Health:** ⚠️ The two native implementations have diverged: iOS registers 14 methods and no configureDelivery; Android registers configureDelivery plus a whole native delivery path — and configureDelivery is absent from the TypeScript contract entirely, so JS must feature-detect it.
- **Surfaces:** `ziggy_mobile/plugins/ziggy-presence/src/definitions.ts`, `ziggy_mobile/plugins/ziggy-presence/android/src/main/kotlin/app/ziggy/presence/ZiggyPresencePlugin.kt`, `ziggy_mobile/plugins/ziggy-presence/ios/Sources/ZiggyPresencePlugin/ZiggyPresencePlugin.swift`

### condition

#### Assistant engine switch  `assistant-engine-flag`

The setting that decides whether the older or the newer conversational brain handles a given turn, checked per-request, then by environment variable, then by settings file, defaulting to the older engine everywhere it isn't explicitly turned on.

- **Used by:** `assistant-agent-v2`, `chat-with-ziggy`, `home-fixer`
- **Health:** ⚠️ Rolling back from the newer engine is a flag flip plus a restart with no data migration; if the newer engine fails to load, it silently falls back to the older one.
- **Surfaces:** `backend/routers/intent_router.py`

#### Live-socket auth gate  `websocket-auth-gate`

The check that rejects any WebSocket connection (app or mobile) that isn't authenticated before it ever reaches the broadcast manager, closing with code 4401 and logging a ws_auth_failed event.

- **Used by:** `household-sign-in`, `realtime-state-sync`
- **Surfaces:** `backend/server.py`, `backend/routers/mobile_router.py`

#### Update track / release resolution  `cohort-selector`

A per-hub label (canary or production) held in the machine's own environment file, deciding whether a hub follows the live main line or the newest tagged release. The relay resolves what a home should receive in the same order everywhere: an explicit per-home pin first, then its cohort, then the newest published release.

- **Used by:** `hub-provisioning-and-imaging`, `release-channel`
- **Surfaces:** `scripts/linux/ziggy-update.sh`, `scripts/factory/kit-ready-check.sh`, `relay/app/routers/ota.py`

#### Wall tablet capability policy  `wall-capability-policy`

The per-panel permission set (lights, climate, media, cameras, locks and more, optionally PIN-gated) bound to a real hashed device credential, enforced both at the API and inside the intent handler so a locked-out action can't be reached by typing around it; presence reporting is permanently denied for any device in wall mode.

- **Used by:** `ziggy-wall`
- **Surfaces:** `services/wall_policy.py`, `backend/middleware/wall_capability.py`

#### Ziggy's-own-write attribution  `ziggy-write-attribution-tiers`

Distinguishes a change Ziggy itself just made from a genuinely out-of-band change (a wall switch, a physical remote), in two deliberately separate tiers: an engine's own write (the ramp, the climate loop, the automation executor) and any write that merely left through Ziggy (an app tap, chat, voice). Which tier a feature reads decides whether a person tapping a tile counts as a hand override — the schedule treats it as one, a light hold treats it as a person deciding, and neither gets to lock the house against its owner.

- **Used by:** `light-hold`, `smart-climate-control`, `smart-light-schedule`
- **Health:** ⚠️ Re-verified 2026-09-19: the logic lives in services/manual_overrides.py (`register_ziggy_call`/`was_ziggy_initiated` for the engine tier, `note_ziggy_write`/`was_recent_ziggy_write` for the wider tier); the previously cited services/device_write_attribution.py has never existed in the tree. In-memory only, so a restart forgets every in-flight override. Neither tier can see an automation Home Assistant executes natively — it sets nothing at all and reads exactly like a wall switch, which is the bug that erased a light hold on the operator's own hub on 2026-09-19 (commit 7925074e). A real earlier bug had Ziggy mistaking its own delayed Zigbee write confirmations for a hand change and locking itself out of a light for the grace window, fixed at commit 95370eb.
- **Surfaces:** `services/manual_overrides.py`

### engine

#### AC protocol card engine  `protocol-card-engine`

A generic engine that runs a JSON description of one AC protocol family, timings, field layout, checksum, validators, in both decode and encode directions, plus the registries of built-in, user-cracked and fleet-shared cards; this is what turned adding AC brand support from writing code into writing data.

- **Used by:** `crack-ac-remote-language`
- **Surfaces:** `services/ir_protocol.py`, `services/ir_protocol_cards.py`, `services/ir_card_registry.py`, `services/ir_walk_analyzer.py`

#### Alert rule registry  `anomaly-rule-registry`

A decorator-based registry (rule id, scope, severity, cooldown, confidence) that lets a new watch rule be added as one function; evaluate() dispatches every registered rule by scope on each Home Assistant state change, debounced so rule evaluation never blocks the event handler. Results below a 0.50 confidence floor are recorded but never pushed, which is what keeps a watchful engine from becoming a nagging one.

- **Used by:** `alerts-inbox`, `proactive-silent-device-detector`
- **Health:** ⚠️ Rules must also be hand-added to a separate admin metadata table to appear in Settings; two of the twelve rules were never added there, so they are untunable from the UI even though they run.
- **Surfaces:** `ziggy_pc/services/anomaly_engine.py`, `ziggy_pc/services/ha_subscriber.py`

#### Bundle executor  `bundle-executor`

Takes a bundle description — automations, sensors, stored state, spoken phrases — and instantiates all of it against the real home in one pass, recording a manifest so the whole set can be undone as a unit.

- **Used by:** `actions-page-and-library`, `buttons-from-chat`, `design-from-chat`, `home-modes`, `leaving-and-arriving`, `light-hold`, `more-ready-made-routines`, `smart-room`
- **Health:** ⚠️ Carried from automations-and-bundles.history.json; source records note a recipe's own reconstruction logic must expose every field the context provides or a whole recipe silently breaks.
- **Surfaces:** `services/bundle_executor.py`

#### Bundle recipe registry  `bundle-recipe-registry`

A keyed registry of declarative recipes — Smart Room, Smart Light Schedule, Smart Climate, Leave Home and the rest — each with a step list, a field set, and logic to save new settings and reconstruct the installed state for editing.

- **Used by:** `actions-page-and-library`, `buttons-from-chat`, `home-modes`, `leaving-and-arriving`, `more-ready-made-routines`, `smart-room`
- **Health:** ⚠️ Adding a new ready-made action is one recipe file plus one registry line, by design, per the source extraction.
- **Surfaces:** `services/bundle_recipes/`

#### Circadian ramp engine  `circadian-ramp-engine`

The math and apply loop behind the Smart Light Schedule: continuously interpolates warmth and brightness between a night floor and day peak across wake, noon and bedtime, and writes the result to the actual lights.

- **Used by:** `smart-light-schedule`
- **Health:** ⚠️ Carried from climate-and-lighting.history.json; a real timezone bug (running on container UTC instead of home local time) shifted the whole ramp for two days before it was fixed.
- **Surfaces:** `services/circadian_engine.py`

#### Fleet health verdict engine  `fleet-verdict-engine`

A pure, unit-tested rules function that turns a home's stored telemetry into a headline level and a full issue list, each carrying its own suggested repair. Silence is evaluated first and outranks any payload claim, so the console, the CLI and the auto-repairer can never disagree about what is wrong.

- **Used by:** `fleet-health-and-repair`, `fleet-ops-console`
- **Surfaces:** `relay/app/fleet_health.py`, `scripts/fleet-health.py`

#### Household Music engine  `household-music-engine`

The internals behind the flagged Music feature, the four-class speaker classifier, per-member Spotify/YouTube Music OAuth adapters, the credentials store, and the orchestrator that turns a Play Media step into an actual playback command.

- **Used by:** `household-music`
- **Surfaces:** `core/media/audio_devices.py`, `core/media/profiles.py`, `core/media/secrets.py`, `services/media_manager.py`

#### Intent dispatcher  `intent-dispatcher`

The single convergence point for every command from chat, voice or the app: it applies the wall-tablet safety gate, fans a multi-part sentence out into several actions, dispatches each to the matching handler, and logs the event to the pattern store that suggestions later read from.

- **Used by:** `assistant-agent-v2`, `buttons-from-chat`, `chat-with-ziggy`, `design-from-chat`, `household-organizer`, `live-answers`
- **Health:** ⚠️ Fails open on a wall-policy exception; a handler exception is swallowed into a generic error message rather than surfaced.
- **Surfaces:** `core/action_parser.py`, `core/handlers/__init__.py`

#### Minute tick loop  `scheduler-tick-loop`

A single asyncio loop that wakes every minute and runs work at different cadences by tick modulo — every minute, every two, every five, hourly, and time-of-day windows — with each job individually guarded and blocking work handed to worker threads. It is Ziggy's own clock and housekeeping engine.

- **Used by:** `buttons-and-remotes`, `device-and-automation-runtime`, `fleet-health-and-repair`, `guided-home-setup`, `ha-update-advisor`
- **Surfaces:** `services/ziggy_scheduler.py`

#### Policy decision point  `policy-decision-engine`

The gather-filter-combine funnel behind household permissions: collect applicable grants, evaluate their conditions, resolve conflicts by deny-overrides, attach obligations, and emit an explanation trace for why a decision came out the way it did.

- **Used by:** `household-permissions`
- **Surfaces:** `services/permissions/engine.py`, `services/permissions/service.py`

#### Presence decision engine  `presence-state-machine`

The core decision logic that turns any location or network sample into a home/away transition: hysteresis around the home radius, accuracy checks, a dwell window a contradicting reading must survive, and a cooldown that makes a transition fire exactly once.

- **Used by:** `home-location-and-places`, `leaving-and-arriving`, `smart-room`, `whos-home`
- **Health:** ⚠️ Holds no state between calls by design, so a restart can never replay a stale transition — carried from presence.reconciled.json, not independently re-verified in this pass.
- **Surfaces:** `services/presence_engine.py`

#### Self-hosted app OTA channel  `capgo-ota-channel`

The @capgo/capacitor-updater runtime plus its hub-side endpoints: one endpoint reports the current interface version and where to get it, another serves that bundle as a zip whose content hash is the credential, and the device stages the download, swaps it at the next cold start, and reverts if the app fails to signal readiness in time. No paid cloud service is in the loop.

- **Used by:** `mobile-ota-updates`
- **Health:** ⚠️ Its own launch-time check is disabled because it DNS-fails before the WebView network binds, so the whole channel hangs off one JS watchdog run. The version identity has twice been wrong in ways that silently stopped every update; bundles are lazily built and cached, so the first request after a rebuild is slow.
- **Surfaces:** `ziggy_mobile/capacitor.config.ts`, `ziggy_pc/frontend/src/lib/nativeOtaWatchdog.js`, `ziggy_pc/backend/routers/mobile_router.py`

#### Smart climate thermostat engine  `smart-climate-engine`

The per-room evaluate/drive loop behind Smart Climate Control: reads a room's live temperature, decides on/off per configured edge with hysteresis so it doesn't chatter at the boundary, and remembers what it last drove so a restart doesn't re-toggle a device.

- **Used by:** `smart-climate-control`
- **Health:** ⚠️ Carried from climate-and-lighting.history.json; never sends a target temperature to the device itself, by design — Ziggy alone owns the on/off cutoff.
- **Surfaces:** `services/smart_climate_engine.py`

#### Universal device state engine  `device-state-engine`

A confidence-tracked model of what a remote-controlled device is doing, live, estimated or stale, built from seven state templates and kept in sync with legacy per-device fields for backward compatibility.

- **Used by:** `ir-wifi-merged-device`, `remote-device-state-tracking`
- **Surfaces:** `services/device_state.py`, `services/device_state_compat.py`

#### Wall grid and module engine  `wall-layout-engine`

The twelve-column snap-grid math, the per-tablet saved layout, and the manifest of card types that together let a wall panel's board be held, dragged, resized and repopulated.

- **Used by:** `ziggy-wall`
- **Surfaces:** `frontend/src/lib/wallGrid.js`, `frontend/src/wall/WallGrid.jsx`, `frontend/src/wall/modules/registry.js`

#### WebSocket broadcast hub  `ws-connection-manager`

A singleton that tracks every connected app socket, fans messages out in parallel with a per-client timeout, serializes the payload once, evicts clients that can't keep up, and supports per-client subscription filters by message type and device.

- **Used by:** `realtime-state-sync`
- **Surfaces:** `backend/ws_manager.py`

#### Ziggy-made sensor factory  `template-sensor-factory`

Fuses several raw motion and door sensors into one reliable room-occupancy sensor and registers it like any other device, with its own tunable hold time.

- **Used by:** `rooms`, `smart-device-cards`
- **Surfaces:** `services/template_sensors.py`

### store

#### Backup key escrow vault  `key-escrow-vault`

Per-home backup data keys held by the cloud only in wrapped form, unwrappable solely with a master key that lives in a password manager and never on a server; a separate, dedicated key protects only the relay's own database snapshot so relay access alone can never decrypt a customer's wrapped key.

- **Used by:** `home-backup-and-recovery`
- **Surfaces:** `relay/app/routers/backup_keys.py`, `services/backup_keys.py`, `relay/app/db_backup.py`

#### Capability catalog  `capability-catalog-store`

A static registry of every action that can be turned into a virtual device or proposed by the automation designer, what it does, its category, and which settings are chosen once versus supplied each time.

- **Used by:** `virtual-devices`
- **Surfaces:** `services/capability_catalog.py`, `backend/routers/capability_router.py`

#### Cloud audit log  `audit-log-store`

An append-only record of cloud actions against homes — registrations, update decisions, backup seals and unseals, support sessions, repairs, proxied AI calls — with event, home, source address, outcome and detail, indexed for filtering.

- **Used by:** `fleet-ops-console`, `founder-remote-support`, `home-backup-and-recovery`
- **Surfaces:** `relay/app/audit.py`, `relay/app/routers/audit_log.py`

#### Device and room registry  `device-and-room-registry`

The canonical model of every device and every room, including which room each device belongs to and whether that placement was set by a person; nearly every device- and room-facing capability reads or writes through it.

- **Used by:** `add-a-device`, `buttons-and-remotes`, `device-lifecycle-management`, `home-screen`, `interactive-floor-plan`, `ir-wifi-merged-device`, `matter-commissioning`, `room-alerts`, `rooms`, `saved-light-positions`, `smart-device-cards`, `zha-to-z2m-migration`, `ziggy-wall`
- **Surfaces:** `services/device_registry.py`

#### Device classification and display preferences  `entity-prefs-and-classification-store`

The profile catalog, per-device user overrides and per-reading display preferences that together decide which control a device card leads with and what it shows.

- **Used by:** `smart-device-cards`
- **Surfaces:** `services/device_profiles.py`, `services/device_overrides.py`, `services/entity_prefs.py`

#### Device presets store  `device-presets-store`

Home-scoped storage of up to six named saved positions per light — brightness, colour temperature, colour — with at most one flagged as the default for that light.

- **Used by:** `light-presets`
- **Health:** ⚠️ Carried from climate-and-lighting.history.json; pure logic with no direct Home Assistant calls of its own.
- **Surfaces:** `user_files/device_presets.json`, `services/device_presets.py`

#### Device registry snapshot cache  `ha-registry-snapshot-cache`

One cached copy of the hub's rooms, devices and entities, fetched in a single session and shared by every concurrent caller with a short TTL; any write invalidates it along with derived indexes. This is Ziggy's canonical in-memory device model.

- **Used by:** `device-and-automation-runtime`, `fleet-health-and-repair`, `realtime-state-sync`
- **Surfaces:** `services/ha_areas.py`, `services/device_registry.py`

#### Flat two-language string dictionary  `i18n-dictionary`

Two flat key-to-text files, en.js and he.js, read through a t(key, params) helper and a useT() hook. A missing Hebrew key silently falls back to English rather than showing a raw key, and values interpolated into a translated string are wrapped in Unicode isolation marks so an English name or number inside a Hebrew sentence keeps its own direction.

- **Used by:** `hebrew-and-rtl-product`
- **Health:** ⚠️ No parity or duplicate-key test guards it; en.js has drifted to 114 duplicate keys where JS's 'last definition wins' silently picks stale copy.
- **Surfaces:** `ziggy_pc/frontend/src/lib/i18n/en.js`, `ziggy_pc/frontend/src/lib/i18n/he.js`, `ziggy_pc/frontend/src/lib/i18n/index.js`, `ziggy_pc/frontend/src/lib/i18n/nameDict.js`

#### Hebrew room and device alias bank  `hebrew-room-alias-bank`

A built-in table of Hebrew room names and device/action words mapped to canonical English equivalents, merged with any personal aliases from settings and matched longest-prefix-first so multi-word names win. It is the shared source of truth for both understanding a Hebrew command and speaking a Hebrew room or device name back.

- **Used by:** `hebrew-conversation-and-voice`
- **Health:** ⚠️ Deliberately hardcoded in Python rather than kept in settings.yaml, because a YAML formatter reordering settings could drop entries; the reverse direction (slug back to Hebrew) takes the first-seen entry as canonical, so which alias a room is spoken with depends on dictionary ordering rather than an explicit choice.
- **Surfaces:** `ziggy_pc/services/room_alias_bank.py`, `ziggy_pc/core/intent_parser.py`, `ziggy_pc/core/agent/directory.py`

#### Household member registry  `persons-registry`

The single source of presence truth for every household member — identity, invite token, phone network address, committed state, last known position and per-place status.

- **Used by:** `household-permissions`, `track-my-location`, `whos-home`
- **Health:** ⚠️ Carried from presence.reconciled.json; source records describe lazy field migration so old records never break the read path.
- **Surfaces:** `user_files/persons.json`, `services/presence_engine.py`

#### Infrared device and blaster registry  `ir-device-and-blaster-registry`

The stores for every taught infrared device, every physical blaster including discovery and address self-heal, and the queue of captured-but-unmatched signals waiting to be bound.

- **Used by:** `crack-ac-remote-language`, `ir-in-automations`, `teach-ziggy-a-remote`
- **Surfaces:** `services/ir_manager.py`, `services/ir_blasters.py`, `services/ir_unassigned.py`

#### Invite token  `invite-token`

A URL-safe random token carrying the invite type, intended email, role, home identity, inviter, timestamps and consumption state — persisted and single-use.

- **Used by:** `household-invites`
- **Surfaces:** `backend/routers/invite_router.py`, `relay/app/routers/invites.py`

#### Live device directory  `ha-truth-directory`

A freshly-built snapshot of every controllable device with its real display name, real room, current state and the exact identifier the assistant must use — rebuilt on every conversation turn from a full state fetch, with no cache.

- **Used by:** `assistant-agent-v2`, `buttons-from-chat`, `design-from-chat`, `external-assistant-access`, `home-fixer`
- **Health:** ⚠️ Built specifically to fix a verified failure where multiple rooms' lights were filed under one room name and a command hit the wrong light; a build failure degrades to an empty device list.
- **Surfaces:** `core/agent/directory.py`, `core/agent/tools.py`

#### Named places store  `zones-registry`

Holds every named circular place beyond home — its centre, radius and name — plus the reserved wide "near home" ring that is created and re-centred automatically whenever the home location is saved.

- **Used by:** `home-location-and-places`, `leaving-and-arriving`
- **Health:** ⚠️ Carried from presence.reconciled.json; a place's identity is its name, so a rename silently orphans anything that referenced the old one.
- **Surfaces:** `user_files/zones.json`, `services/zones_manager.py`

#### Pair codes  `pair-code-store`

Short six-character codes in two tiers: a five-minute one an owner mints for a second phone, and a thirty-day one bound to a kit's box id and printed at imaging time, idempotent so a sticker stays valid across restarts.

- **Used by:** `pair-phone-to-home`
- **Health:** ⚠️ Low entropy by design, which is why the pair route carries both a per-peer budget and a tighter invalid-attempt lockout, plus a LAN-only gate on the claim tier.
- **Surfaces:** `ziggy_pc/services/mobile_app.py`

#### Paired phone records  `mobile-device-registry`

The store of paired devices — auth token, webhook id, platform, push token and provider, bound person, claim-pending flag and last-seen snapshot — that push fan-out, presence probing, live WebSocket delivery and the device list all read.

- **Used by:** `live-house-state-on-phone`, `mobile-notifications`, `mobile-presence-detection`, `pair-phone-to-home`
- **Health:** ⚠️ services/mobile_push.py reads the device file by its own hand-built path rather than through mobile_app, so it does not honour the same directory override other stores do.
- **Surfaces:** `ziggy_pc/services/mobile_app.py`, `ziggy_pc/services/mobile_push.py`

#### Per-person interface preferences  `ui-prefs-store`

Server-stored, per-person UI choices, room photos, room order, pinned shortcuts, quick controls, the average-temperature toggle, that follow a person to whatever screen they sign into rather than living in one browser.

- **Used by:** `home-screen`, `rooms`
- **Surfaces:** `backend/routers/ui_prefs_router.py`

#### Phrase-to-action registry  `voice-intent-registry-store`

A file-backed lookup mapping a normalized spoken or typed phrase to a concrete action — re-run an intent, flip a mode, or run an automation — matched with no model call at all. Automations can register their own phrases when applied and remove them when deleted.

- **Used by:** `chat-with-ziggy`, `more-ready-made-routines`
- **Health:** ⚠️ Read only by the older conversational engine's fast-parse path, so it is dead on any home running the newer engine by default; matches only on an exact normalized phrase.
- **Surfaces:** `services/voice_intents.py`, `services/local_automation_actions.py`, `services/bundle_executor.py`

#### Release marker  `release-tag`

A dated, annotated git tag stamped on the exact code a release consists of — the single thing a production hub follows, the thing imaging resolves to decide what 'latest' means, and the thing drift is measured against.

- **Used by:** `fleet-health-and-repair`, `hub-provisioning-and-imaging`, `release-channel`, `safe-update-guarantee`
- **Surfaces:** `scripts/ship.sh`, `scripts/linux/ziggy-update.sh`, `scripts/canary/hub-bootstrap.sh`, `services/deploy_state.py`

### trigger

#### Home and approach rings  `home-geofence-registry`

Two operating-system-level circles registered around the home — a tight one (floored at 100 m, the iOS minimum) for arrive/leave and a wide approach ring — plus the on-device record of them, with a cold-restart path that re-registers the whole set with no app or JS running.

- **Used by:** `drove-past-home-guard`, `mobile-presence-detection`
- **Health:** ⚠️ A geofence event carries the ring's centre, not the phone. A Samsung force-kill silently unregisters the OS-side rings; only an FCM probe or an app open re-arms them.
- **Surfaces:** `ziggy_mobile/plugins/ziggy-presence/android/src/main/kotlin/app/ziggy/presence/ZiggyPresencePlugin.kt`, `ziggy_mobile/plugins/ziggy-presence/ios/Sources/ZiggyPresencePlugin/ZiggyPresencePlugin.swift`, `ziggy_pc/frontend/src/App.jsx`

#### Infrared receive listener  `ir-listener-loop`

A background loop on the blaster's receive channel that matches every captured press against learned codes through a cascade, exact bytes, jitter-tolerant fingerprint, protocol equivalence, fuzzy pulse compare, because two presses of the same button are never byte-identical on real hardware.

- **Used by:** `remote-device-state-tracking`, `teach-ziggy-a-remote`
- **Surfaces:** `services/ir_listener.py`

