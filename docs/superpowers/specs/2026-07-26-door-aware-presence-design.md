# Door-Aware Smart Presence — bathroom-grade occupancy

**Date:** 2026-07-26
**Branch:** feat/unified-bundle-wizards
**Status:** Design approved in brainstorm (2026-07-26). Building.

> Smart Room already keys everything off one "is anyone here" entity per room —
> the Smart Presence sensor (`OccupancySensorForm` → `template_sensors`).
> That entity is a plain OR of its sources, which is wrong for door-sensor
> rooms (bathroom): door open reads occupied forever, and a **closed** door
> with a still person inside reads *empty* → lights off mid-shower.
> This spec makes the presence entity itself door-aware. Smart Room, the
> "someone is in a room" trigger, the Devices-page card — all unchanged.

## 1. Decisions (from brainstorm)

- **Latch until door opens** ("wasp in a box"): door closed + motion seen
  *after* the close = occupied until the door opens again. No timer while
  latched — nobody showers into darkness.
- **Walk-out-and-close** is the case naive rules can't express: latch must arm
  only on motion evidence *after* the close (fresh motion edge, or motion/mmWave
  still held at grace expiry) — otherwise every exit-and-close leaves the light
  on forever. This needs event-ordering memory → lives in Ziggy, not an HA
  template.
- **Time of day**: unchanged — Smart Room's existing day/night brightness
  windows already handle it. Nothing new here.
- **Strictly additive**:
  - Existing presence entities keep their OR template untouched, forever.
    Door-aware backing applies only to sensors created (or deliberately
    re-created) with a door among the selected sources.
  - Smart Room recipe: zero code changes.
  - The creation form is pixel-identical when no door is selected.
  - New logic is a sidecar engine (same pattern as Smart Climate / Light
    Schedule).

## 2. Behavior (the state machine)

Per enrolled room: `doors[]`, `motions[]` (motion + mmWave presence),
`clear_delay_s` (quiet-while-open; the form's existing "wait before clear"),
`walkout_grace_s` (new; default 120).

| Event / timer | Result |
|---|---|
| Door opens | occupied **on** immediately; latch off; if all motion off (and the room has motion sensors) start quiet timer |
| Motion on (any) | occupied **on**; cancel timers; if door closed → **latched** |
| All motion off, door open | start quiet timer (`clear_delay_s`) → occupied **off** on expiry |
| Door closes | occupied on (touching a door is presence evidence); latch off; start walk-out grace |
| Walk-out grace expires | any motion currently on → **latched** (mmWave hold / person inside); else occupied **off** |
| Latched + door closed | occupied stays **on** regardless of quiet — until the door opens |
| Door-only room (no motion sources) | open → occupied on (no quiet timer); close → grace → off |

Startup recovery (Ziggy restart): door open → occupied = motion state (or on,
if no motion sensors); door closed + motion on → latched; door closed + quiet
→ clear. (A perfectly still person in a closed bathroom across a restart loses
the latch — accepted, rare, self-heals on any motion/door event.)

Known honest limitation: enter + close + zero motion within the grace = cleared.
In practice entry always trips the motion sensor; grace is configurable.

## 3. Architecture

**New `services/room_presence_engine.py`**
- `RoomStateMachine` — pure, injectable-clock state machine (unit-testable by
  feeding event sequences).
- Engine singleton: loads enrolled rooms from the existing
  `occupancy_sensors` KV namespace (records with `mode: "door_aware"`),
  processes sensor events + timers on one daemon thread, publishes over MQTT.
- **MQTT discovery** (broker already in-compose; Ziggy already has paho):
  - config: `homeassistant/binary_sensor/ziggy_presence_<room>/config` (retained)
  - state: `ziggy/presence/<room>/state` (retained)
  - availability: `ziggy/presence/availability` (retained; LWT → `offline` if
    Ziggy dies, so the entity honestly shows unavailable, never a stale
    "occupied").
  - Persistent client, auto-reconnect; connects only when ≥1 room is enrolled.
- Hook in `ha_subscriber._process_event` (same pattern as the climate /
  circadian hooks) with a cheap `watched_entities()` early-out.
- Started from `backend/server.py::_startup` (prod runs uvicorn — the
  Smart-Light-Schedule gotcha).

**`services/template_sensors.create_occupancy_sensor` branches**:
sources classified by HA device_class — `door`/`opening`/`garage_door`/`window`
→ door bucket; everything else → motion bucket. Door bucket non-empty →
door-aware path: publish discovery, resolve the real entity_id from the entity
registry (by unique_id, retry), enroll the engine, write the KV record with a
synthetic `entry_id` (`ziggy_mqtt_<room>`) + `mode: "door_aware"` +
`walkout_grace_seconds`. Same return shape; same idempotent replace-per-room
(replacing a template-backed sensor deletes its HA entry; replacing a
door-aware one clears its retained topics). No door → the legacy template path,
byte-for-byte.

**Delete / list / reconcile**:
- `delete_occupancy_sensor[_by_entry_id]` branches on the KV record's mode:
  door-aware → unenroll + publish empty retained config (removes the HA
  entity) + clear KV. Template → existing path.
- `ha_reconciler.reconcile_occupancy_sensors` **skips** `mode: "door_aware"`
  records — they have no HA config entry to check (otherwise it would prune
  them as orphans).
- `list_occupancy_sensors` / Devices-page merge / Smart Room's
  `resolve_occupancy_entity`: work unchanged (record still has
  `entity_id` + `entry_id`).

**Frontend `OccupancySensorForm`**: when the selection includes a door-class
sensor, the timing step gains one field — walk-out grace (default 120 s) —
plus a short plain-language note of the door behavior. Passes
`walkout_grace_seconds`; `OccupancySensorBody` + handler pass it through.
EN + HE strings.

## 4. Failure honesty

- MQTT publish fails at creation → `{"ok": False}` with a plain-language
  error; nothing half-created (retained topics cleared, no KV record).
- Entity never appears in HA's registry (MQTT integration missing) → same:
  clean up retained topics, honest error.
- Engine down / Ziggy down → entity goes `unavailable` via LWT; wall switches
  unaffected.

## 5. Testing

- `tests/test_room_presence_engine.py` — state-machine scenarios: enter/open;
  shower latch (close + fresh edges + stillness); walk-out-and-close clears at
  grace; mmWave hold latches at grace expiry; door-open quiet clear + re-entry;
  door-only room; close-from-outside; startup recovery.
- Create-path branching: door source → door-aware record, no HA template flow;
  no door → legacy path untouched (template flow called exactly as before).
- Reconciler leaves door-aware records alone.
- **Hardware gate (Canary)**: operator creates the bathroom presence entity
  (door + motion), runs Smart Room on the bathroom, and physically verifies:
  door-open lights, shower stillness holds, walk-out-and-close releases.
  Per the real-life-validation gate, not "done" until then.
