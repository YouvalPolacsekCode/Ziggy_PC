# Smart Climate Control — Ziggy-as-thermostat wizard + engine

**Date:** 2026-07-20
**Branch:** feat/beta-image-readiness
**Status:** Design approved in conversation (2026-07-20). Replaces the one-shot
`smart_climate` template with a dedicated wizard + continuous engine, mirroring
Smart Light Schedule (`circadian_engine`) and Smart Room.

## 1. Problem (root-caused on the live Canary hub)

The current `smart_climate` template (`services/automation_templates.py::_smart_climate`)
is a single HA-style rule with real, evidenced defects:

- **Assumes a smart AC.** Its primary branch calls `climate.set_hvac_mode(cool)` +
  `climate.set_temperature(22)`. Live Canary has **zero `climate.*` entities** — the
  home's AC is the IR Tadiran on a Broadlink. So the primary branch never runs.
- **IR fallback is a bare power toggle.** The `else` branch sends the free-text
  intent `"Turn on AC"`, which resolves to `send_ir_command(dev, "power")` — a
  single toggle, **no cool mode, no temperature**. On an already-on unit a toggle
  turns it **off**. All "cool @ 22°C" precision is lost.
- **22°C fights the Israeli 24°C default** used everywhere else.
- **Room is fuzzy.** The trigger watches `first_entity(room_temperature)` — the
  first temp sensor in HA state order, with no room-awareness. On Canary that pool
  includes a **soil sensor** and hot-running motion-sensor temps (Office Motion
  reads 30°C). The action isn't tied to the trigger sensor's room.
- **The notification lies.** It always says "AC activated." even when no AC was
  reachable (the live Canary case — zero IR devices registered).
- **One direction, one threshold, no hysteresis** — cool-only at 26°, can flap.

## 2. Design (decisions from the conversation)

**Ziggy is the thermostat; the device is a dumb on/off actuator.** Ziggy watches
the room's real temperature and switches a device on/off with hysteresis. **No
temperature is ever sent to the device** — the only number that matters is the
room's true reading. This is what makes one wizard work identically for a smart
AC, an IR Tadiran, a fan, or a heater on a smart plug.

**Per room (one instance per room):**

- **One temperature reading** the user picks (the room's sensor).
- **Cooling edge** (default, shown first — cool-first Israeli default):
  room **≥ on (25°C)** → cooling device **on**; room **≤ off (24°C)** → **off**.
- **Heating edge** — revealed by a quiet **"+ Add heating for winter"**, off by
  default: room **≤ on (19°C)** → heating device **on**; room **≥ off (20°C)** → **off**.
- The **on/off gap is the anti-flap deadband** (default 1°C). Both numbers are
  user-editable. Cooling requires `on > off`; heating requires `on < off`.
- Each edge takes **its own device** (either edge optional). "AC cools, מפזר heats"
  works; a reversible Tadiran is simply dropped on both edges.

**Device drive — "any way it can":** the picker shows plain-language devices in
the chosen room; Ziggy owns the *how*. One entry per physical device. If a device
is reachable as both a smart entity and IR, it shows **once** and Ziggy **prefers
smart** (true state), IR as automatic fallback (existing policy). When Ziggy flips
a device on it sends **power on** and, best-effort, **cool-vs-heat mode** (so one
reversible AC can serve both edges) — **never a temperature**. Fans / plug-heaters
have no mode → pure on/off.

**Manual-respecting via edge-triggered hysteresis (no override-tracking needed).**
Ziggy acts only on *transitions* and only toggles **from its own last action
state** (`last`):

```
temp ≥ on   and last != "on"   → turn ON,  last = "on"
temp ≤ off  and last != "off"  → turn OFF, last = "off"
otherwise                       → no-op
```

Consequences (all desirable): Ziggy **only turns off what it turned on**; if the
user hand-changes the device, Ziggy won't fight it — it resumes on the next clean
band crossing. Hysteresis + `last` *is* the manual-respect, cleaner than the
light engine's override tracker because climate is inherently a state machine.

**Sync now (▶):** force-evaluate the band for *now*, ignoring `last`, drive the
device to the correct state, and reset `last`. Used on save and by the card's ▶
button — the deliberate "re-assert control" escape hatch.

## 3. Architecture (mirrors `circadian_engine`)

**New service `services/smart_climate_engine.py`** — Ziggy-driven:
- `decide(temp, edge_cfg, last) -> "on"|"off"|None` — pure hysteresis math
  (unit-testable, no I/O). Cooling vs heating chosen by `edge_cfg["dir"]`.
- `_drive(device, action, direction)` — actuate on/off. Dispatch by
  `device["kind"]`:
  - `climate` → `climate.set_hvac_mode(cool|heat)` then `climate.turn_on` / `climate.turn_off`.
  - `ir_ac` → best-effort `send_ir_command(id, "cool"|"heat")` for mode, then power on/off via `ir_manager` (no temperature frame).
  - `fan` / `switch` → `homeassistant.turn_on` / `turn_off`.
  Each write wrapped so our own actuation is not mistaken for a manual change.
- `evaluate_room(room, cfg, *, force=False)` — read the room's live sensor,
  run `decide` for each configured edge, `_drive` on a decision (or on `force`),
  persist updated `last`.
- `tick()` — periodic safety-net pass over all enabled rooms (~5 min).
- `on_temperature_changed(entity_id, value)` — ha_subscriber hook: when a
  configured room's sensor reports, `evaluate_room` that room immediately
  (event-driven; the tick is only a fallback).
- `sync_room(room)` — `evaluate_room(force=True)` (the ▶ button + apply-on-save).
- Config CRUD (`load_config`/`save_config`) → `user_files/smart_climate_config.json`.

**Config schema** (`smart_climate_config.json`), keyed by room:
```json
{
  "rooms": {
    "living_room": {
      "enabled": true,
      "sensor": "sensor.0x…_temperature",
      "cooling": {"device": {"kind":"ir_ac","id":"…","name":"…","room":"living_room"},
                  "on": 25, "off": 24},
      "heating": null,
      "last": {"cooling": "off", "heating": null}
    }
  }
}
```

**Startup** — spawned in **`backend/server.py::_startup`** (NOT `core/ziggy_main.py`;
prod runs `uvicorn backend.server:app`), next to the circadian engine's task,
guarded by any-room-enabled.

**ha_subscriber hook** — in `_process_event`, after the existing blocks: if the
changed entity is a temperature sensor configured for some room, call
`smart_climate_engine.on_temperature_changed(entity_id, new_value)`.

**API** (`backend/routers/automation_router.py`, mirroring the `/circadian` set):
- `GET  /api/automations/smart_climate` → `{rooms: {room: {enabled, sensor, cooling, heating, current:{temp, cooling_state, heating_state}}}}`
- `POST /api/automations/smart_climate` `{room, sensor, cooling, heating}` → save + `sync_room`.
- `DELETE /api/automations/smart_climate/{room}` → disable + clear that room.
- `POST /api/automations/smart_climate/{room}/sync` → `sync_room` (▶).

## 4. Frontend (mirrors `CircadianBundleWizard` + `CircadianGroupRow` + `CircadianViewModal`)

- **`SmartClimateWizard`** — steps: **(1) Room** (room picker) → **(2) Temperature
  reading** (that room's temp sensors, plain names) → **(3) Cooling**: device
  picker + on/off temps (defaults 25 / 24) → **"+ Add heating for winter"** reveals
  **(4) Heating**: device picker + on/off temps (defaults 19 / 20). Sensible
  defaults pre-filled so "just save" works. Device picker reuses the existing
  room/entity/device selection components (DeviceControls-adjacent).
- **Smart Climate card** (`SmartClimateGroupRow` in `Actions.jsx`) — sourced from
  the `/smart_climate` config endpoint, one row per configured room. Trigger chip
  **⚡ Automatic**. Actions: **▶ Sync now**, toggle (enable/disable), view, edit,
  delete. **Additive** beside `CircadianGroupRow` / `SmartRoomGroupRow` — the
  concurrent smart-room session also edits Actions.jsx grouping; keep changes
  scoped to the smart-climate path, do not touch their rows.
- **`SmartClimateViewModal`** (mirrors `CircadianViewModal` / `SmartRoomViewModal`)
  — read-only "what is this doing?": current room temp now, the cooling/heating
  bands, the device on each edge (plain name + how it's driven), and the current
  on/off state Ziggy believes it's in. A ▶ Sync now action.
- **Library card** — the existing "Smart Climate Control" Library item's **Add**
  opens `SmartClimateWizard` instead of the generic template configure. Card copy
  unchanged from the curated Library (A4): *"room too warm → AC starts"* (now also
  heats). Room-scoped ⇒ unique instance per room (A3), keyed by room.
- **i18n** — every user-facing string mirrored in `he.js`: warm, dugri,
  gender-free. No HA / entity_id / HA jargon anywhere (non-negotiable). Diff he.js
  before commit to confirm only new smart-climate lines changed.

## 5. Testing

- **Unit** (`tests/test_smart_climate_engine.py`): `decide` cooling crosses up at
  `on`, down at `off`; deadband between `off` and `on` is no-op (no flap);
  `last`-gating (Ziggy only toggles from its own state → won't fight a manual
  change; only turns off what it turned on); heating direction inverted; degenerate
  band (`on == off`) safe; `force` overrides `last`.
- **Engine wiring**: `evaluate_room` reads the live sensor + persists `last`;
  `sync_room` forces; disabled room is skipped.
- **Live Canary verification (I verify math/state; user validates hardware).**
  Feed the engine the real room sensor readings and confirm it computes the correct
  on/off decision per room; confirm config save/load + all four endpoints + wizard
  render. **Hardware gate is the user's:** driving a real AC needs an AC on the hub
  — Canary currently has **no `climate.*` and no registered IR AC**, so end-to-end
  actuation validation requires the Tadiran/Broadlink registered first (or a smart
  plug / fan as a stand-in actuator to prove the on/off loop). Flag this to the user.

## 6. Non-goals
- No temperature setpoint ever sent to a device (Ziggy owns the cutoff).
- No `auto`/dual-direction on a single edge — direction is per-device-slot.
- No schedule/time-of-day gating (a later refinement; combine with occupancy later).
- No new HA automations — this is a Ziggy-driven engine like the light schedule.
- Multi-sensor averaging per room is a later refinement (one reading for now).
