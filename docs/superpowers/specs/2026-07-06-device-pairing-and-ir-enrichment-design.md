# Design: Device Pairing + Smart AC Control + IR Engine Enrichment

**Date:** 2026-07-06
**Status:** Draft for review
**Author:** Ziggy / Claude (brainstorming session)

## 1. Goal

Make Ziggy "pair-ready" for devices a customer already owns — robot vacuums and smart ACs — without shipping those devices in the kit, and enrich Ziggy's own IR engine so dumb ACs (the Israeli majority) set up in seconds. Everything is **additive**: we build on the existing pairing wizard, IR engine, and climate handler; we do not replace or refactor working flows.

Three sub-projects on a shared foundation:

- **Foundation** — a generic "pair via Home Assistant" path folded into the existing pair-device wizard.
- **SP1 — Vacuums** — catalog + capability presence (control is already wired).
- **SP2 — Smart ACs** — catalog pairing + close the climate control gap (mode/fan/swing) + smart-vs-IR routing.
- **SP3 — IR enrichment** — import a known-remote code library, add clean-room decoders, and add a "identify your AC remote" matching wizard beside the existing button-learning flow.

## 2. Hard constraints (non-negotiable)

### C1 — Zero Home Assistant exposure
The customer only ever sees **Ziggy** and **brand names**. Home Assistant is the hidden engine. Nothing HA-shaped may surface:
- No integration domain names (`electrasmart`, `midea-ac-py`, `roborock`), no `entity_id`s, no "config flow", "config entry", "integration", or HA area/device terminology in any UI string, voice reply, or error.
- The **device catalog is the translation layer**: it maps a customer-facing brand/model to a hidden HA integration domain, and maps HA's field labels / error codes / abort reasons to Ziggy-language copy before they reach the UI.
- New device names default to friendly customer-facing names, never the raw HA entity name.
- This is a design *requirement with test coverage*, not a polish pass. A dedicated "no-HA-leak" test asserts surfaced strings contain none of a denylist of HA terms.

### C2 — Additive only
No rewrites of working code. Concretely:
- AC control gap = **new** setter tools alongside the working on/off + temperature handler ([climate_handler.py](../../../core/handlers/climate_handler.py)). The existing `control_ac` / `set_ac_temperature` are untouched.
- IR enrichment = **new** library-code source + **new** decoders + **new** wizard step, beside the working learn/send path. Existing `POST /api/ir/learn`, `POST /api/ir/send`, `mark_command_learned()`, and `_direct_send()` are unchanged.
- Pairing = **generalize** the existing Switcher sub-flow into a generic one; the Switcher path keeps working.

## 3. Foundation — generic device pairing via the existing wizard

### 3.1 What already exists (reuse, don't rebuild)
- [PairingWizard.jsx](../../../frontend/src/components/PairingWizard.jsx) — React step state-machine with a protocol picker (zigbee/zwave/matter/ir_device/broadlink/wifi/switcher).
- [SwitcherPairingFlow.jsx](../../../frontend/src/components/SwitcherPairingFlow.jsx) — **the exact pattern we generalize**: backend returns a step descriptor (fields incl. credentials), frontend renders + submits, repeats until done.
- [pairing_router.py](../../../backend/routers/pairing_router.py) — already drives HA flows (`GET /api/ha/config_flows`, Switcher start/step, matter commission).
- [IntentParamForm.jsx](../../../frontend/src/components/ui/IntentParamForm.jsx) — reusable schema-driven field renderer.
- OAuth redirect: existing `target="_blank"` external-link pattern + [mobileApi.js](../../../frontend/src/lib/mobileApi.js) webview bridge.

### 3.2 New components
1. **`ha_config_flow` service (backend)** — thin generic wrapper over HA's `config_entries/flow` REST+WS API: `start_flow(domain)`, `get_step()`, `submit_step(flow_id, input)`, `handle_result()`. Returns step schema as plain dicts. Mirrors the `ha_ws.py` pattern. All HA-specific strings are translated out here (C1).
2. **Device catalog (data)** — curated map: customer-facing brand/model → hidden HA integration domain + presentation (display name, icon, category, credential-field labels/help, "what you'll need" hint). Uncatalogued integrations still function via raw schema (generic promise); catalogued ones get polish. This is also the C1 translation table.
3. **Generic pairing sub-flow (frontend)** — generalize `SwitcherPairingFlow` into `SmartDevicePairingFlow` that renders any backend step descriptor. Added as a new protocol entry ("smart device" / brand-first) in `PairingWizard`.
4. **Generic flow endpoints (backend)** — additive to `pairing_router.py`: start flow for a catalog brand, submit step, handle OAuth external step + callback, finalize.
5. **Pairing orchestrator (backend)** — a per-session state machine bridging the chat-initiated session to the wizard: start → collect step input → submit → advance (multi-step OTP / OAuth) → `create_entry` or `abort`. Wraps `ha_config_flow` and is exposed via the endpoints in (4).

### 3.3 v1 flow-type scope
- **In:** credential / API-key / phone-OTP form flows; **OAuth-redirect** flows (covers Tado's newer login).
- **Out (deferred fast-follow):** Matter commissioning (QR + Thread hardware). The existing `matter` protocol entry is left as-is; we do not extend it now.

### 3.4 Data flow
chat "add my Roborock" → intent → `orchestrator.start(domain)` → `ha_config_flow.start_flow` → step (form) → hand off to wizard sub-flow → user submits creds on screen → `submit_step` → next step (OTP/OAuth) or create → success → entity surfaced with a friendly name in Ziggy's device list.

### 3.5 Error handling
Map HA `invalid_auth` / `cannot_connect` / `already_configured` / abort reasons → friendly Ziggy copy (C1). Session timeouts. Credentials never logged, never in chat transcript.

## 4. SP1 — Vacuums

The `vacuum` domain is already fully wired ([domain_registry.py:279-300](../../../services/domain_registry.py#L279-L300)): start/stop/dock/pause/locate, fan speed, states, Hebrew names. Once an entity exists, control is free. Work items:

1. **Catalog entries** (customer-facing → hidden domain): Roborock → `roborock`, Ecovacs → `ecovacs`, Xiaomi → `xiaomi_miio`, Dreame/Mova → `dreame_vacuum` (vendored).
2. **Vendor `dreame-vacuum`** into base HA (present-but-unconfigured) so a customer who owns one can pair. Insertion points: cloud → SFTP seeding in [provisioner.py:302-312](../../../relay/app/provisioner.py#L302-L312); mini-PC → commit under `docker/ha-config/custom_components/`. Backups already include `custom_components/` ([backup_engine.py:124](../../../services/backup_engine.py#L124)).
3. **Pin & document** the vendored component version (deliberate updates — Dreame firmware occasionally breaks the protocol).

**YAGNI:** no vacuum map rendering (pure HA-side UI; Ziggy never shows it).

## 5. SP2 — Smart ACs

### 5a. Pairing (rides Foundation)
Catalog entries: Sensibo → `sensibo`, Electra → `electrasmart` (core), Tadiran → `gree`, Tornado → `midea-ac-py` (vendored), Tado → `tado`, Mitsubishi → `melcloud`, Daikin → `daikin`. Vendor `midea-ac-py` for Tornado, same mechanism as `dreame-vacuum`.

### 5b. Close the control gap (additive to the dedicated handler)
Today [climate_handler.py](../../../core/handlers/climate_handler.py) does on/off + temperature only; the mode/fan/swing chips in [domain_registry.py:102-123](../../../services/domain_registry.py#L102-L123) are display-only. Add, without touching the existing tools:
- **New tools** `set_ac_hvac_mode`, `set_ac_fan_mode`, `set_ac_swing_mode` → HA `climate.set_hvac_mode` / `set_fan_mode` / `set_swing_mode`.
- **New state-query tool** so "what mode is the AC in?" works (state already cached in [state_memory.py:24](../../../services/state_memory.py#L24)).
- **NL routing** (Hebrew + English) for "set AC to heat", "fan high", "turn on swing".

### 5c. Smart-vs-IR routing
When an AC is reachable both by a smart integration and by IR, **prefer the smart integration** (true bidirectional state) over IR (optimistic). IR remains the fallback for dumb units. Implemented as a small resolver in the AC action path; does not alter either underlying path.

## 6. SP3 — IR engine enrichment

Additive; does not replace the working IR flows. Three parts.

### 6a. Known-remote code library (SmartIR import)
- Source: SmartIR (`smartHomeHub/SmartIR`), **MIT-licensed** → legal to bundle and sell. **Must not use the "SmartIR" name** anywhere in product/marketing. Codes are crowdsourced "as-is" (no provenance warranty) — accepted risk, flagged for counsel.
- Codes are **Broadlink Base64** (`0x26` packets) — identical to what `parse_broadlink_raw()` / `_direct_send()` already consume; **no translation needed**.
- Import the Israeli-relevant files (Electra `1940s`, Tadiran `1340s`+`1560`, Tornado `1620s`, Gree `1180s`, plus others) into a **new code-library module**. Reproduce the MIT notice (`Copyright (c) 2019 Vassilis Panos`).
- Validate each imported code with `parse_broadlink_raw()` before storing.

### 6b. Clean-room encoders/decoders (IRremoteESP8266 reference)
- IRremoteESP8266 (LGPL) documents bit-layouts + checksums + timings for Electra, Toshiba, Midea, Gree. Because the layout is direction-agnostic, it is **also the decoder spec** for Ziggy's fingerprint / reflect-physical-remote-changes differentiator.
- Clean-room the **facts** (bit positions, checksum formulas, timings) into [ir_protocol.py](../../../services/ir_protocol.py). **Do not copy `.cpp` source.** This finishes/supersedes the branch decoders with correct checksums.
- Watch-items: Midea's bit-reversed checksum; Gree/Tadiran high-nibble block checksum (matches existing finding); Toshiba power-encoded-in-mode + inverted-pair/XOR validation; Electra byte-12 sum. HeatpumpIR (GPL-2.0) / ESPHome (GPLv3) are **facts cross-check only — no code copied.**

### 6c. "Identify your AC remote" matching wizard (new Step 3A in IRWizard)
Three tiers of AC IR setup, all persisting to the same `ir_codes[]` + `learned_commands[]` via `mark_command_learned()`:

1. **Brand pick + confirm (fastest):** customer picks brand → Ziggy fires a test power code from a library candidate via existing `_direct_send()` → "did your AC respond?" → narrow if multiple candidates → load full profile.
2. **Fingerprint from one press:** if RM4 can receive, customer presses power once on the physical remote → Ziggy decodes (existing fingerprint + 6b decoders) → identifies protocol → auto-loads matching library profile.
3. **Button-by-button learning (fallback, unchanged):** existing [IRWizard.jsx](../../../frontend/src/components/IRWizard.jsx) Step 3, for remotes not in the library.

**Additive hooks (no changes to existing learn/send):**
- New `StepMatchRemoteFromLibrary` component inserted before the existing learn step; on match-fail it advances to the current Step 3.
- New endpoints: `GET /api/ir/library/candidates?device_type=ac&brand=…`, `POST /api/ir/library/match-test`, `POST /api/ir/devices/{id}/load-profile`. All thin wrappers over existing send + `mark_command_learned()`.
- Storage, send path, blaster selection, device details, assumed-state/AC-memory: all unchanged.

## 7. Sequencing

1. **Foundation** (generalize wizard + `ha_config_flow` + catalog) — everything depends on it.
2. **SP1 Vacuums** — cheap proof of the Foundation.
3. **SP2 Smart ACs** — 5b (control gap) and 5a (pairing) can proceed in parallel; 5b is independently shippable.
4. **SP3 IR** — 6a (library import) first (fast, broad), then 6c (matching wizard), then 6b (decoders) per-brand.

Independently-shippable early wins: **5b** (AC control gap) and **6a** (library import).

## 8. Deployment note
SP1/SP2 vendoring touches the provisioner; SP2 5b and SP3 touch core handlers/engine — all auto-deploy to the canary home on push to `main`. Build on a feature branch, validate on real hardware (Tadiran + any smart AC), then the operator decides the push. No push without sign-off.

## 9. Testing
- Foundation: `ha_config_flow` unit tests vs recorded HA responses; generic sub-flow state-machine tests (single/multi-step/OAuth/abort/error); **no-HA-leak denylist test** on all surfaced strings; one e2e vs real HA.
- SP1: catalog resolves brand→domain; vendored-component boot smoke test.
- SP2: each setter maps to the right HA service; state-query returns cached attrs; routing prefers smart over IR; NL classification.
- SP3: imported codes pass `parse_broadlink_raw()`; decoder unit tests vs captured frames (extend [test_ir_protocol.py](../../../tests/test_ir_protocol.py)); matching wizard test (candidate → test-send → load profile) writes identical storage to learning.

## 10. Licensing summary
- SmartIR data: **MIT**, sellable; reproduce notice; never use the "SmartIR" name; crowdsourced-as-is risk flagged for counsel.
- IRremoteESP8266: **LGPL** — facts/clean-room only, no source copied.
- HeatpumpIR (GPL-2.0), ESPHome (GPLv3): facts cross-check only.
- Tuya/Xiaomi IR: not usable for protocol reuse (opaque blobs).

## 11. Out of scope (v1)
- Matter commissioning (fast-follow).
- Vacuum map rendering.
- Broad bonus HACS (LocalTuya / Xiaomi Miot) — separate future decision, not part of vacuum/AC scope.
- Any refactor of existing working flows.
