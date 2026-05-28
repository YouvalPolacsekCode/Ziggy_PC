# Onboarding Audit — Prompt 7 (Rescoped 2026-05-26)

**Author:** Claude Code, audit pass for Chunk 1 of Prompt 7.
**Date:** 2026-05-28.
**Scope:** First-boot QR + sensor-naming wizard + starter automation pack + completion telemetry. NOT billing / legal / dashboard / voice / backup.
**Status:** Read-only audit. No code written. Awaits founder approval before Chunk 2.

The audit looks at every file (tracked AND uncommitted) that touches onboarding, then maps existing state to the five rescoped deliverables and identifies what's missing, what's polished, what conflicts, and what wants a small refactor versus a careful extension.

---

## 1. Inventory — What Exists Today

### 1.1 Mobile pair-code flow (committed, in production today)

| Layer | File | State |
|---|---|---|
| Backend router | [backend/routers/mobile_router.py](../backend/routers/mobile_router.py) | **Solid.** `/api/mobile/pair-code`, `/api/mobile/pair`, `/api/mobile/register`, `/api/mobile/webhook/{id}`, `/api/mobile/ws`, `/api/mobile/devices`, `DELETE /api/mobile/devices/{id}`. Audit-event emissions on every auth path. Mounted in server.py:418. |
| Backend service | [services/mobile_app.py](../services/mobile_app.py) | **Solid.** Pair-code mint/consume (5 min TTL, 6-char A-Z2-9, persisted to `user_files/mobile_pair_codes.json`), device register/revoke (`user_files/mobile_devices.json`), webhook dispatch. |
| Backend WS fan-out | [services/mobile_ws_bridge.py](../services/mobile_ws_bridge.py) (untracked) | **Solid.** Wraps the PWA `bus.register_ws_callback` so allowlisted event types (`state_changed`, `command_failed`, `execution_result`, `ir_command_detected`, `ziggy_response`) reach paired phones too. Installed from server.py:85 hunk (also untracked). |
| Mobile-app pair UI | [frontend/src/pages/MobileOnboarding.jsx](../frontend/src/pages/MobileOnboarding.jsx) | **Working.** Pair → Notify → Location → Motion (stub) → Done. Capacitor-only; PWA users redirect home. Recent uncommitted hunk switches to `@capacitor/barcode-scanner` v2 and adds a manual "Continue" button on the Done step (race-condition mitigation). |
| Mobile-app pair API client | [frontend/src/lib/mobileApi.js](../frontend/src/lib/mobileApi.js) | **Solid.** `mintPairCode`, `pair`, `registerDevice`, `postWebhook`, `getDeviceToken`/`getDeviceId`/`getWebhookId`, device list + revoke. |
| PWA "pair my phone" panel | [frontend/src/components/PairWithPhone.jsx](../frontend/src/components/PairWithPhone.jsx) | **Working.** Mints a code from `/api/mobile/pair-code`, renders QR (`ziggy://pair?code=XXX`) using lazy-loaded `qrcode` lib, shows expiry countdown. |
| Native shell redirector | [frontend/src/App.jsx:115-141](../frontend/src/App.jsx) | **Working.** Uncommitted hunk adds a `lastPathRef` race guard so the post-pair `navigate('/')` doesn't bounce back to onboarding before the device token is committed in Capacitor Preferences. |
| i18n | [frontend/src/lib/i18n/en.js#L2978-3000](../frontend/src/lib/i18n/en.js), […/he.js#L2607-2629](../frontend/src/lib/i18n/he.js) | **Complete** for the existing `mobileOnboard.*` namespace (pair + permissions + done). |

**End-to-end on a fresh mini PC today:** PWA user logs in (after `/api/auth/setup`) → opens Settings → PairWithPhone panel → "Generate code" → QR shown. Mobile app launches, sees no device token, routes to `/mobile-onboarding` → user scans QR or types code → `/api/mobile/pair` redeemed → device record created → permissions granted → home. **The kit-out-of-box first-boot path (no PWA user yet, no logged-in browser) is NOT covered by today's flow.**

### 1.2 PWA-side wizard (uncommitted, half-wired)

| Layer | File | State |
|---|---|---|
| Backend service | [services/onboarding_state.py](../services/onboarding_state.py) (untracked) | **Solid.** Step ledger in `user_files/onboarding.json`. 15 step ids (`language` … `done`), 3 required (`account`, `home_name`, `rooms`). Thread-safe, atomic write. |
| Backend router | [backend/routers/onboarding_router.py](../backend/routers/onboarding_router.py) (untracked) | **Solid but UNMOUNTED.** Defines `/api/onboarding/state` (GET/PATCH), `/api/onboarding/complete` (POST), `/api/onboarding/reset` (POST super_admin), `/api/ha/probe`. **Not in server.py's include_router list — dead until wired.** |
| Backend HA probe | [services/ha_runtime.py](../services/ha_runtime.py) (untracked) | Referenced by the router's `/api/ha/probe`. (Not opened in this pass — flagged for Chunk 2 review if we wire the router.) |
| Frontend page | [frontend/src/pages/Onboarding.jsx](../frontend/src/pages/Onboarding.jsx) (untracked) | **Polished but UNROUTED.** 15 steps: language → account → home name → timezone → connect HA → coordinator → home zone → rooms → device categories → devices → notifications → suggested automations → voice → mobile → done. Calls existing APIs (`getRooms`, `createRoom`, `probeHA`, `getSuggestedTemplates`, `patchVoiceSettings`, `savePresenceZone`). **App.jsx has no `<Route path="onboarding" …>` — page is dead until wired.** |

This is **a self-install web wizard for technical users who pair Ziggy to an existing HA install themselves** — not the kit-out-of-box path. It overlaps with the rescoped Prompt 7 on rooms and starter automations, but diverges on assumptions (user types HA URL + token; user picks device types; user pairs sensors interactively). Co-existence story needs a decision (§4 below).

### 1.3 First-boot QR generation on the edge

**Does NOT exist.** No first-boot detection module, no LAN pair-QR page, no edge-side pair-code minter that runs without a logged-in user. The factory imaging spec ([PROMPT_FACTORY_IMAGING.md task 4 step 11](~/Documents/Claude/Projects/Ziggu/PROMPT_FACTORY_IMAGING.md)) expects to call cloud's `/api/mobile/pair-code` with `device_id` + `owner_email`, but:

- Today's `/api/mobile/pair-code` is **user-authenticated** (requires `get_current_user`). A factory script with no user context can't call it.
- The same gap applies to the *edge* version Prompt 7 §1 calls for: on a fresh box, there is no `user_id` to bind a pair-code to.

`scripts/factory/` exists but only contains restore helpers, not the imaging script. This is correct — PROMPT_FACTORY_IMAGING.md is explicitly run *after* Prompt 7.

### 1.4 Edge-to-app sensor reporting

**Does NOT exist.** No kit-manifest loader on the edge. No `/api/onboarding/sensors` endpoint exposing pre-paired sensors with `vendor_model` + `intended_room_label_he/en`. The factory imaging script *will* drop `intended_room_label_*` into HA's area/device names at pair time (per PROMPT_FACTORY_IMAGING §8: "Sensor gets named in HA per the manifest's intended room labels"), but Ziggy has no local-side reader for the manifest file itself.

The kit manifest format is **defined** in PROMPT_FACTORY_IMAGING.md §2 (`sensors[]` with `device_type`, `vendor_model`, `zigbee_mac`, `intended_room_label_he`, `intended_room_label_en`). Format is YAML, one file per kit. No location/path is locked yet — flagged for Chunk 2 decision.

### 1.5 Sensor naming wizard

**Does NOT exist** as an onboarding step. Related primitives that DO exist and we should chain through:

- [services/ha_areas.py](../services/ha_areas.py) — `create_area`, `rename_area`, `assign_device_to_area`, `sync_device_area_to_ha`. All operate via HA WebSocket against the device + entity + area registries with a shared 15s snapshot cache.
- [services/ha_zha.py — rename_device](../services/ha_zha.py) — surfaced via `PATCH /api/ha/devices/{device_id}/rename` in [backend/routers/pairing_router.py:99](../backend/routers/pairing_router.py).
- Existing PWA "Rooms" page already calls `getRooms` + `createRoom`. Onboarding.jsx StepRooms wires that for the web flow.

So naming → HA persistence is **a one-line chain** through existing tested code. The new piece is the mobile-side wizard UI + an endpoint that returns the *initial* (factory-set) sensor list with intended labels pre-filled.

### 1.6 Starter automation pack

**Does NOT exist** as a curated starter set, but the install pipeline is in place:

- [backend/routers/automation_router.py:189 — `POST /api/automations`](../backend/routers/automation_router.py) (`create_automation_endpoint`) accepts `{id, name, description, trigger, actions, rooms}` and persists via `save_automation` → HA.
- Onboarding.jsx StepSuggestedAutomations already calls `getSuggestedTemplates()` for the web wizard — fetches the existing `services/automation_templates` library. **But** in the web flow they're shown as inert previews ("Open Automations later to enable these"); the user does NOT one-tap install from the onboarding card.
- A "starter pack" matched to the *kit's* pre-paired sensors (motion + door + temp + IR + bulb) is the new piece. We can either curate a hardcoded mobile-side list referencing kit-known sensor IDs, or extend `automation_templates` with a `starter_pack: bool` flag and a kit-aware filter.

### 1.7 Onboarding completion telemetry

**Does NOT exist.** [services/telemetry_client.py](../services/telemetry_client.py) is the edge's only outbound channel to the cloud relay — it posts a periodic *snapshot* (every 5 min, signed HMAC over `relay_secret`) to `POST /api/devices/{home_id}/telemetry`. The relay accepts arbitrary JSON-object bodies and stores them verbatim in `telemetry_raw`. **There is no event-stream endpoint** — no `/api/devices/{id}/events`.

Three pragmatic ways to deliver an `onboarding_complete` event without inventing a new transport:

1. **Piggyback on the next telemetry tick.** Add an optional `onboarding_complete: {…}` field to `_build_payload`, set once after the wizard finishes, cleared after a successful POST. Cheapest path, but the founder won't see it for up to 5 minutes.
2. **Trigger an immediate one-shot telemetry post** after completion. Same payload shape, same relay endpoint, no schema change. Founder sees it in seconds.
3. **Add a `POST /api/devices/{id}/events` relay endpoint** (new, but minimal — analogous to the telemetry one, signed the same way, stored in a new `events` table). Cleanest long-term shape; one more thing to land.

§4 below recommends option **(2)** for v1 — zero relay-side changes, observable from existing admin tooling, and the founder explicitly wants a *quick* signal that a customer made it through.

### 1.8 Adjacent files in the uncommitted set (out of scope but worth noting)

- `backend/routers/dashboard_router.py`, `backend/routers/alerts_router.py`, `backend/routers/mode_router.py`, `backend/routers/weather_router.py`, `frontend/src/pages/Hub.jsx`, `frontend/src/components/hub/`, `services/dashboard_layouts.py`, `services/dashboard_tablets.py`, `services/mode_service.py`. — **Not in Prompt 7 scope.** These are parallel-session work on the wall-tablet "Hub" surface (separate Prompt). They share no code with onboarding and don't need changes from us.
- `services/ha_runtime.py` (untracked) — referenced by `onboarding_router.py`'s `/api/ha/probe`. Will need to be read carefully *if* we decide to wire the web onboarding router.

---

## 2. Mapping: Prompt 7 Deliverables → Existing State

| Deliverable | Existing pieces we'll chain through | What's missing |
|---|---|---|
| **1. First-boot auto-QR on edge** | `services/mobile_app.create_pair_code/consume_pair_code` (user-authed only). `backend/routers/edge_health_router.py` (LAN no-auth template). `qrencode` available in factory script env. | (a) First-boot detector. (b) No-auth pair-code mint bound to *device_id* not user_id, valid until a customer claims it. (c) LAN-reachable HTML page rendering the QR. (d) Decision: does the same pair flow create the owner account, or does it depend on the customer hitting `https://app.ziggy.tld` first? |
| **2. Edge-to-app sensor reporting** | HA registry snapshot via `services/ha_areas.get_registry_snapshot` (cached, deduped, fast). | (a) Kit-manifest reader (path + schema lock). (b) New endpoint that joins HA registry × manifest, returning `{sensors: [{device_id, vendor_model, type, current_state, intended_label_he, intended_label_en}]}`. (c) Mobile-side fetch + render. |
| **3. Sensor naming wizard** | HA persistence via `services/ha_areas.assign_device_to_area` + `services/ha_zha.rename_device`. i18n scaffold present (`mobileOnboard.*`). | (a) Wizard UI in MobileOnboarding.jsx (new step inserted between PAIR and NOTIFY, or between DONE-permissions and DONE-final). (b) New `/api/onboarding/sensors/confirm` endpoint that takes `[{device_id, name, room_name}]` and calls the HA primitives in batch. (c) Hebrew + English copy. (d) Decision: rename the HA *device* (covers all entities under it) or the individual entities. |
| **4. Starter automation pack** | `POST /api/automations` via [automation_router.py:189](../backend/routers/automation_router.py). `services/automation_templates` library. | (a) A small curated pack (4–6 starters) tagged to motion/door/temp/IR. (b) Mobile-side accept/skip UI. (c) Batch-install endpoint or the existing single-create call in a loop. |
| **5. Completion telemetry** | `services/telemetry_client.post_once` (HMAC-signed POST to relay). Relay accepts arbitrary JSON in `telemetry_raw`. | (a) An `onboarding_complete` builder + a trigger that posts *immediately* on wizard finish (extends `_build_payload` with an optional one-shot field). (b) Admin-dashboard read path (TBD in Prompt 10 — out of scope here, but the data lands in `telemetry_raw` regardless). |

---

## 3. Risks, Conflicts, Open Decisions

### 3.1 Central architectural question — owner-account on first boot

The current `/api/mobile/pair-code` flow assumes a PWA user already exists. The kit-out-of-box scenario has nobody yet. Options:

**A. Mobile app drives owner-account creation on first pair.** The LAN QR encodes `ziggy://pair?onboard=true&device_id=<id>&claim_code=<XYZ>`. Mobile app on consume detects `onboard=true`, opens a "create account" mini-form (email + password + home name), POSTs to a new `/api/auth/setup` proxy that the LAN pair endpoint forwards, then `/api/mobile/pair` redeems with the brand-new session. The mobile app owns owner-account UX.

**B. Web sets up owner first, mobile pairs second.** The box-top sticker has TWO QRs — one for the mobile app (today's flow, requires PWA user) and one for `https://app.ziggy.tld/onboard?device_id=…&token=…` (web). Customer opens the web URL on their phone browser, creates the account in the browser, *then* opens the mobile app and pairs. The PROMPT_FACTORY_IMAGING.md spec already calls for both QRs ("QR 1 — Mobile pair code", "QR 2 — Web onboarding fallback") — but with B, web is the *primary* path on a fresh box, not the fallback.

**Recommendation: A.** Reasons: (1) The customer's first interaction is the mobile app (Israeli kit target is mobile-first). (2) Asking them to switch between a sticker scan + a browser URL bar + an app is friction we don't need. (3) The mobile app *already* has the camera + the QR scanner + the keyboard for account creation — adding owner-account creation is a small UI step. (4) The current flow gracefully degrades for second/third devices in the same home (they hit "this home already has an owner; bind to existing account?").

**Trade-off of A:** A new `/api/onboarding/claim` endpoint with NO auth needs to live on the edge. We must design it conservatively: claim code is single-use, expires after 30 days *or* on first successful claim, and any subsequent pair-code mint goes through the normal user-authed path.

This is the single biggest open decision in Chunk 2 design. **I will not start coding Chunk 2 until the founder picks A or B.**

### 3.2 PWA `Onboarding.jsx` — wire it, gate it, or leave it parked?

`frontend/src/pages/Onboarding.jsx` and ~~`backend/routers/onboarding_router.py`~~ (deleted, see breadcrumb below) were polished but **completely unwired**. Three positions:

- **Wire it.** Add the route in App.jsx, mount the router in server.py:418-ish. PWA users on a self-install (no kit) go through it. Mobile-kit users skip it entirely.
- **Gate it.** Same as wire, but App.jsx checks `getAuthStatus().configured` + `/api/onboarding/state.completed` and routes unconditionally to `/onboarding` until done. This is the docstring's intent.
- **Park it.** Leave both files unwired. Treat the web wizard as a future cleanup item. The kit + mobile flow is the v1 commercial path; the web wizard is for the next quarter.

**Recommendation: Park it for Prompt 7 scope.** The rescoped Prompt 7 is mobile-kit centric. Wiring the PWA wizard now risks (a) confusing the kit-out-of-box flow with a second route the customer might land on, and (b) opening edge cases — the existing PWA login + manual HA-token flow already works for the founder + beta testers who aren't kit customers. Park it; surface it as a Future Cleanup; revisit if a self-install path becomes a v1.1 priority. **No code changes to the existing untracked files in this audit-only chunk.**

**Breadcrumb (PROMPT_SECURITY_HARDENING_V2, 2026-05-28):** the backend router file `backend/routers/onboarding_router.py` was deleted in this V2 batch (bucket E — no parked code in shipped tree without a role gate; per-route auth on the dead file was correct but the file was never mounted in `server.py`, making it an audit-time hazard). The companion frontend `frontend/src/pages/Onboarding.jsx` is **NOT** deleted in V2 — it stays parked because it's imported by `App.jsx`'s OTA routes mapping (verify before any future cleanup). To restore the backend file when the BYO-hardware (v1.1+) tier is in scope: `git show HEAD:backend/routers/onboarding_router.py` from the commit prior to the deletion, or browse the git history. Routes the deleted file defined: `GET/PATCH /api/onboarding/state`, `POST /api/onboarding/complete`, `POST /api/onboarding/reset` (super_admin), `POST /api/ha/probe`. Companion service `services/onboarding_state.py` is retained on disk — it has no router dependency and may be useful for the v1.1+ rewrite.

### 3.3 Will the mobile app's existing scanner read both QR sources?

Yes. The scanner accepts either:
- A raw 6-char code (typed or scanned)
- A URL containing `code=XXXX` ([MobileOnboarding.jsx:135](../frontend/src/pages/MobileOnboarding.jsx))

The current QR contract is `ziggy://pair?code=XXX`. For first-boot we'll extend to `ziggy://pair?code=XXX&device_id=DDD&claim=true&host=192.168.1.42:5050` so the app can:
- Hit the *local* edge directly via the LAN host (works without internet)
- Carry the claim flag so the app knows to drive owner-account UX
- Carry the device_id for the post-pair sensor-reporting fetch

Backward compatibility: the existing PWA-issued QR (`ziggy://pair?code=XXX` only) still works — `device_id` and `claim` are additive.

### 3.4 Manifest path and shape — needs to be locked together with PROMPT_FACTORY_IMAGING

PROMPT_FACTORY_IMAGING.md defines the manifest schema but not its on-device path. The factory script will write *something* per kit. Proposed lock for Chunk 2:

- Path: `/etc/ziggy/kit_manifest.yaml` (matches the `/etc/ziggy/device_id` convention from the factory spec §4 step 4).
- Owned by the `ziggy` user, mode 600.
- Read by a new `services/kit_manifest.py` module with lenient defaults (missing file → `{sensors: [], irs: []}` and Ziggy still boots; missing `intended_room_label_he` → fall back to `intended_room_label_en` then to device's HA name).

This path/shape decision is reversible — it lives entirely on-device. Surface it for approval but don't gate Chunk 2 on it.

### 3.5 Wizard insertion point in MobileOnboarding.jsx

The existing flow is:
```
PAIR → NOTIFY → LOCATION → MOTION → DONE
```

Proposed:
```
PAIR → CLAIM_OWNER (only when claim=true) → SENSORS → STARTER_PACK → NOTIFY → LOCATION → MOTION → DONE
```

`CLAIM_OWNER` only runs on the first device for a fresh kit (claim flag present). Second/third devices skip it. `SENSORS` and `STARTER_PACK` only run when the device pair returned an `is_first_pair: true` flag from the LAN backend — otherwise they're already configured and we don't want to re-prompt.

### 3.6 i18n debt — `mobile.onboarding.*` AND `mobileOnboard.*` namespaces

[en.js:1827-1837](../frontend/src/lib/i18n/en.js) has an older `mobile.onboarding.*` namespace; [en.js:2978-3000](../frontend/src/lib/i18n/en.js) has the current `mobileOnboard.*` namespace. The older one is unused (no current references in MobileOnboarding.jsx). **I won't touch this in Prompt 7.** I'll add new keys under `mobileOnboard.*` (the live namespace) for sensor wizard + starter pack + claim-owner copy. Flag the duplicate for the Future Cleanup list.

### 3.7 Telemetry payload size

`MAX_TELEMETRY_BYTES = 64 * 1024` ([relay/app/routers/telemetry.py:57](../relay/app/routers/telemetry.py)). The `onboarding_complete` block is tiny (<1 KB). Headroom is fine even on the maxed-out sensor list. No risk.

---

## 4. Recommended End-State Architecture (post Chunk 3)

```
Customer opens box, plugs in mini PC.
    │
    │  First-boot detector (services/first_boot.py) writes user_files/first_boot.json
    │  and mints a one-time claim-code bound to device_id.
    │
    ▼
Edge LAN page at  http://<edge-ip>:<port>/pair  (no auth, port 5050 — same as backend)
    │  Renders QR encoding ziggy://pair?code=XYZ&device_id=DDD&claim=true&host=…
    │  Identical contract on the box-top sticker (factory imaging produces the same QR).
    │
    ▼
Customer scans QR with Ziggy Home mobile app.
    │
    ▼
PAIR step (existing /api/mobile/pair, extended to read &claim and return is_first_pair).
    │
    ▼
CLAIM_OWNER step (new, only when claim=true)
    │  Mobile app collects email + password + home name.
    │  Calls /api/onboarding/claim → backend calls /api/auth/setup internally and
    │  rebinds the just-paired device's user_id to the new owner.
    │
    ▼
SENSORS step (new, only when is_first_pair=true)
    │  Fetch /api/onboarding/sensors → list with intended_room_label_he/en pre-filled.
    │  User confirms / renames each.
    │  POST /api/onboarding/sensors/confirm → loops services/ha_areas + ha_zha.rename_device.
    │
    ▼
STARTER_PACK step (new, only when is_first_pair=true)
    │  Curated 4–6 automations matched to motion / door / temp / IR.
    │  User accepts/skips each card.
    │  Accepted → POST /api/automations (existing endpoint).
    │
    ▼
NOTIFY → LOCATION → MOTION → DONE (existing — unchanged)
    │
    ▼
Wizard finish triggers:
    │  POST /api/onboarding/complete  (mark state, capture elapsed + summary)
    │  → services/telemetry_client.post_once(immediate=True, extra={"onboarding_complete": {…}})
    │
    ▼
Founder sees onboarding_complete in /api/admin/homes/{home_id}/telemetry on the relay.
```

**Backward compatibility (hard rule):** A manually-paired beta device that never had a kit manifest hits the same MobileOnboarding.jsx, but `is_first_pair=false` (existing field added to PairResponse) routes it straight through PAIR → NOTIFY → LOCATION → MOTION → DONE with no new steps. Existing manually-paired beta devices must continue to work — this is the constraint Prompt 7 explicitly calls out.

---

## 5. Proposed Plan for Chunks 2 + 3

### Chunk 2 — Edge-side foundations + backend support (no UI yet)

Commits land in this order, each independently revertable.

**2A.** `services/first_boot.py` — first-boot detector + state file `user_files/first_boot.json`. Idempotent boot hook (called from server startup, opt-in).

**2B.** `services/mobile_app.py` extension — add `create_claim_code(device_id)` returning a claim-tier pair-code (no `user_id` binding; persisted under a `claim_codes: []` array; consumed by the same `/api/mobile/pair` endpoint but flagged as a claim). Backward-compatible — existing user-authed mints unchanged.

**2C.** Backend router `backend/routers/first_boot_router.py` (new file, mounted alongside `edge_health_router`):
- `GET /pair` — no-auth HTML page serving the QR (server-side renders SVG using `qrencode` or `segno` — pick one in Chunk 2 design review).
- `GET /api/onboarding/first-boot/qr.json` — no-auth JSON for the mobile diagnostics page.

**2D.** `services/kit_manifest.py` — reads `/etc/ziggy/kit_manifest.yaml` (with graceful absence → `{sensors: [], irs: []}`).

**2E.** New endpoint `GET /api/onboarding/sensors` — joins `kit_manifest.sensors` × `services/ha_areas.get_registry_snapshot()` → returns `[{device_id, vendor_model, current_state, intended_label_he, intended_label_en, name (current HA name)}]`. Auth: device-token (existing `get_current_device` from mobile_router) — only the paired phone can read.

**2F.** Extend `/api/mobile/pair` response with `is_first_pair: bool`. Set true when the consumed code was a claim-tier code OR when this is the first device ever paired against this home (heuristic: `mobile_devices.json` had zero entries). Tested via unit test.

**2G.** `services/telemetry_client.post_once` gets an optional `extra: dict | None` parameter, merged into the payload top-level. No schema-level change required on the relay (it accepts arbitrary keys).

**2H.** New endpoint `POST /api/onboarding/claim` (no auth) — receives `{claim_code, username, password, home_name}`, atomically: (1) creates the owner account via the same code path as `/api/auth/setup` (refuses if a user already exists), (2) consumes the claim code, (3) rebinds the freshly-paired device to the new user, (4) returns a session token. **This is the security-sensitive endpoint and lands behind tests + audit-bus emissions identical in shape to the mobile_router ones.**

**Stop after 2H. Founder tests on a freshly-imaged mini PC (or a docker-compose dev box with the LAN QR page hit from a phone on the same Wi-Fi).**

### Chunk 3 — User-facing flow (mobile app + completion telemetry)

**3A.** MobileOnboarding.jsx — insert `CLAIM_OWNER` step component. New `claimOwner` API call in `lib/mobileApi.js`. Pre-filled defaults (home_name = `My Home`, validation on email + password).

**3B.** MobileOnboarding.jsx — insert `SENSORS` step (new component). Fetches `/api/onboarding/sensors`, renders one card per sensor with the intended label pre-filled, allows rename. Submits via new `/api/onboarding/sensors/confirm` endpoint (lands in 3B itself — keeps the commit cohesive).

**3C.** Backend `POST /api/onboarding/sensors/confirm` — takes `[{device_id, name, room_name}]`, calls `services/ha_zha.rename_device` + `services/ha_areas.assign_device_to_area` in a loop, returns `{ok: bool, failed: [...]}`. Idempotent (renaming to the same name is a no-op).

**3D.** Starter automation pack — curated YAML list at `data/starter_automations.yaml` (4–6 entries: motion-at-night-lights, front-door-notify, temp-anomaly, leave-home-off, arrival-welcome, low-battery-alert). New `services/starter_pack.py` filters the list by what sensors are actually present in the kit (motion present? → include motion automations; not present? → drop them).

**3E.** MobileOnboarding.jsx — insert `STARTER_PACK` step. Card per automation, accept/skip toggle, "Install selected" button at the bottom. Calls existing `POST /api/automations` in a loop.

**3F.** Completion telemetry — `POST /api/onboarding/complete` triggers `telemetry_client.post_once(extra={"onboarding_complete": {timestamp, elapsed_seconds, sensors_confirmed, automations_accepted, errors}})`. Also marks `user_files/onboarding.json.completed_at` if the parked PWA `onboarding_state.py` is wired later (additive, no-op if absent).

**3G.** i18n — add the new keys to en.js + he.js under `mobileOnboard.sensors.*`, `mobileOnboard.starter.*`, `mobileOnboard.claim.*`.

**3H.** End-to-end smoke test on a freshly-imaged mini PC (or docker-compose stand-in) with manual founder steps documented in a short `docs/ONBOARDING_E2E_TEST.md`.

**Stop after 3H. Push to origin.**

---

## 6. Future Cleanup (not in Prompt 7)

- `frontend/src/lib/i18n/en.js#L1827-1837` and `he.js#L1456-1466` — older `mobile.onboarding.*` namespace, dead. Delete in a follow-up.
- `frontend/src/pages/Onboarding.jsx` + `backend/routers/onboarding_router.py` + `services/onboarding_state.py` + `services/ha_runtime.py` — parked self-install PWA wizard. Either wire them in a future "Self-install for technical users" prompt, or formally delete after one full quarter without need.
- The two-namespace i18n drift suggests an i18n consolidation pass is overdue. Not for Prompt 7.

---

## 7. Assumptions I Am Making

Listed explicitly so the founder can correct any of them before Chunk 2 starts:

1. **The customer's first interaction is the mobile app, not a web browser.** If founder disagrees, switch to Option B in §3.1.
2. **Pre-paired sensors arrive with sensible HA names already.** The factory imaging script writes `intended_room_label_*` into HA's device/area names at pair time. Prompt 7 reads what's there + lets the customer correct.
3. **One owner per kit (v1).** Multi-occupant invites live in the existing `invite_router` and are out of scope here.
4. **Hebrew RTL works in the existing MobileOnboarding shell.** I'll inherit `dir="auto"` from the inputs already in place.
5. **The relay's `telemetry_raw` table is the surface the founder will read `onboarding_complete` from until Prompt 10 builds a dashboard view for it.** I'm not building admin-side UI in Prompt 7.
6. **`segno` is the QR library I'll use server-side** if it's already in the dependency set; otherwise `qrencode` shelled out, otherwise `qrcode` (pure-Python). I'll check before Chunk 2A and surface if a new dep is needed.

---

## 8. What I Need From the Founder Before Chunk 2

Three concrete decisions. I will not start coding without them.

1. **§3.1 — Option A (mobile app drives owner-account creation) vs. Option B (web sets up owner first).** I recommend A.
2. **§3.2 — Park the existing PWA `Onboarding.jsx` flow?** I recommend yes — leave the untracked files alone.
3. **§1.7 — Telemetry delivery method for `onboarding_complete`.** I recommend option 2 — extend `telemetry_client.post_once` with a one-shot fire that posts immediately. No relay change.

A green-light on those three unblocks Chunk 2 entirely. I'll stop and wait.
