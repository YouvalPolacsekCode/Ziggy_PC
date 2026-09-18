# Designer Closed Loop — Modes, Light Hold, and a Catalog That Tells the Truth

**Date:** 2026-09-18
**Status:** Approved by the operator in session ("build all of this… do this once, and right").
**Branch:** `worktree-designer-closed-loop` (from `origin/main` @ `f502fc7`, the `release-2026.09.18-4` line).

## 1. Why

On 2026-09-18 the operator asked Ziggy in chat to make the living area smart.
Ziggy's *advice* was excellent — three layers, an arrival window, a manual-off
memory, time scenes, a two-button switch as the human override. Then the
operator said "build all this" and the designer produced:

- two `modes` flags (`kitchen_light_manual_override`,
  `living_area_motion_lighting_paused`) that **no automation reads or writes**;
- an automation *named* "Kitchen empty clears bright-light override" whose only
  action is a push notification — it clears nothing and will page the phone
  every ten minutes the kitchen sits empty;
- a fused occupancy sensor that nothing references;
- tautological conditions (trigger on `X = on`, condition `X is on`);
- an "everything off" rule that reaches into the entry and storage room;
- five voice intents announced on the card, **zero** registered;
- a refusal to build GPS arrival ("I can't currently…") three days after it
  had built exactly that via the `welcome_home` blueprint in another thread;
- a refusal to bind the operator's Aqara button, although the app's own wizard
  has had a `controller` trigger since 2026-09.

Root cause is structural, not the model: **the designer recommends in a
vocabulary it cannot build in.** Its catalog offers state/time triggers,
`call_service`, `notify`, `delay`, and a KV write nobody reads. So it creates
the nouns (flags, sensors), leaves them unwired, and writes prose for the rest.
Every failure above has the same shape: *looks built, isn't.*

The catalog (`services/automation_catalog.py`) is hand-curated and had drifted
in the one direction its own drift detector cannot see — converter-supports /
catalog-declines — so Ziggy issues confident false refusals.

## 2. The invariant

> **Anything Ziggy is allowed to say, he can build. Anything he builds, you can
> see and change in the app. Anything he can't build, he says so — from the same
> list the builder uses.**

Say → build → see → edit → explain. One loop.

## 3. Decisions taken with the operator

| Question | Decision |
|---|---|
| Modes: fixed set or user/LLM-definable? | **Fixed set.** Invented flags are how the two dead variables were born. |
| Approach | **B** (make his vocabulary real product objects) with **A first** (catalog truth) and **C as discipline** (prefer a recipe; compose raw only from objects that exist; extend what exists). |
| Light periods (day/evening/night) as a home-level object? | **No.** A light has an *on look* (its default preset) and optionally a *mid look*. Smart Room's day/night split stays as Smart Room's own option. |
| Manual-off release rule | Hold → cleared by manual-on → released after the room is empty **30 min** → second strike (engine relit it and it was turned off again, no manual-on between) holds **until morning (06:30)**. |
| What counts as "manual" | Any turn-off Ziggy's *engines* didn't issue: wall switch, HA app, app tile, chat, voice. (`manual_overrides` already splits engine-tier from everything-else.) |
| Voice-intent artifacts | Retired from the designer. Only the older engine listened for them; v2 is the code default. Named routines already run by phrase. |

## 4. Scope

### In

1. **Catalog truth (A).** Support flags derived from what the converters actually
   handle; bidirectional drift is a test failure; `zone`, `webhook`,
   `controller`, `time_window`, `sun`, `mode` supported and documented.
2. **Modes** — `sleep`, `movie`, `cleaning`, `guest`, `vacation`. One module,
   one API, one HA mirror, one condition type, one action type, visible on the
   Home screen and in chat, each with one defined engine-enforced effect.
3. **Light hold** — engine-owned manual-off memory with the agreed release rule,
   visible on the light card, honoured by Smart Room and Motion Light,
   explained by `explain_missing_action`.
4. **Designer contract** — recipes as first-class artifacts (Smart Room, Leave
   Home, Welcome Home, Motion Light); `set_mode` / `turn_off_all_lights` in its
   action vocabulary; controllers in home context; bundle linter that strips
   tautologies, rejects out-of-scope rooms and flags nothing reads; preview and
   apply results that never overstate.
5. **Agent** — tools `set_mode`, `release_light_hold`; context sections for
   modes and held lights; persona routing for buttons, arrival/departure, modes.
6. **App** — mode chips on the Home screen (and the Hub section rewritten);
   held badge + release on light tiles; `mode` condition and `set_mode` action
   in the automation wizard; preview card shows recipes and left-outs, drops
   voice intents.
7. **Cleanup of 2026-09-18** — the bundle is swept via the existing bundle
   delete, then the same request is rebuilt through chat as the acceptance test.

### Out

- Light periods as a product object.
- Per-room modes (all modes are home-wide in v1).
- LLM-invented flags (`kv_state` leaves the designer schema).
- Voice-intent artifacts.
- Customer release (`ship.sh`). This lands on `origin/main` → Canary; the
  customer tag is the operator's call after real-life validation.

## 5. Architecture

```
chat ─► core/agent (persona, tools) ─┬─► set_mode / release_light_hold ─► services/modes, services/light_hold
                                     └─► design_automation ─► orchestra_designer ─► bundle (recipes | custom)
                                                                    │  catalog = automation_catalog (derived)
                                                                    │  lint    = bundle_lint
                                                                    ▼
                                                            bundle_executor ─► recipes/*.py ─► ha_automations.save_automation
                                                                                                   │
        HA runs triggers/conditions ◄── mirrored entities (binary_sensor.ziggy_mode_*) ◄── modes.announce()
        HA fires ─► ha_subscriber ─► deferred Ziggy steps (respect_hold actions) ─► executor ─► light_hold.is_held?
                                 └─► light_hold.on_state_change (manual off / manual on / engine on)
        scheduler tick (1 min) ─► light_hold.tick (room-empty release, morning release) ─► modes.tick (timed expiry)
app ─► /api/modes, /api/light-holds ─► WS mode_changed / light_hold_changed ─► Dashboard chips, DeviceCard badge
```

## 6. Modes

### 6.1 Object — `services/modes.py`

```python
MODES = ("sleep", "movie", "cleaning", "guest", "vacation")
# state per mode: {"on": bool, "since": epoch|None, "until": epoch|None, "by": str|None}
```

Persisted in the file-backed KV store, namespace `home_modes` (one key per
mode). Reads are cheap (file read); the module keeps no in-memory truth.

API:

- `list_modes() -> list[dict]` — every mode with `id`, `on`, `since`, `until`,
  `by`, `label_en`, `label_he`, `effect_en`, `effect_he`, `default_hours`.
- `is_on(mode) -> bool`
- `set_mode(mode, on, *, by, hours=None) -> dict` — validates the id, stamps
  `until` from `hours` or the mode's default (`movie` 3 h, `cleaning` 2 h,
  `sleep` until the next morning time, `guest`/`vacation` none), persists,
  publishes to HA, broadcasts `mode_changed`, runs the mode's side effect, logs
  to the debug bus.
- `tick(now)` — expires modes whose `until` has passed (called from the
  scheduler minute loop).
- `blocks_motion_lighting() -> bool` — `sleep or movie`.
- `blocks_off_when_empty() -> bool` — `cleaning`.
- `blocks_everyone_left() -> bool` — `guest`.

Side effects (engine-enforced, not user-built):

| Mode | Effect | Where enforced |
|---|---|---|
| sleep | motion won't turn lights on | recipes carry `mode` conditions; executor `light_hold`/motion gate |
| movie | same as sleep, timed (3 h) | same |
| cleaning | "off when empty" rules don't fire (2 h) | recipes carry `mode` condition on the Off rule |
| guest | "everyone left" doesn't fire | `presence_side_effects._fire_automations` and the scheduler's all-away path check `blocks_everyone_left()` before firing `all_persons_left` / `ziggy_leave_home` |
| vacation | lived-in simulation on | `set_mode("vacation", True)` starts `fake_occupancy_scheduler` with the default room pool (dimmable light per room, 19:00–23:00, 30 days); off stops it |

### 6.2 HA mirror — `services/modes_mqtt.py`

Same pattern as `services/presence_mqtt.py`: one retained MQTT-discovery
`binary_sensor` per mode, `unique_id = ziggy_mode_<id>`, availability topic
shared, announced at startup and on every change. Read-only in HA by design
(Ziggy is the only product surface). `entity_id(mode)` resolves the real HA id
via `room_presence_engine.lookup_mqtt_entity_id`; `None` means "not
discovered yet — do not compile a condition against it".

`services/entity_filter.py` hides `binary_sensor.ziggy_mode_*` from every
device list, like the room-occupancy adapters.

### 6.3 Condition type `mode`

Ziggy shape: `{"type": "mode", "mode": "sleep", "is": false}`.

- `local_automation_actions._eval_single_condition` — new branch, reads
  `modes.is_on`.
- `ha_automations._condition_to_ha` — compiles to a state condition on the
  mirrored entity when discovered; `None` (Ziggy re-checks) otherwise — the
  exact fallback the presence condition uses.

### 6.4 Action type `set_mode`

Ziggy step: `{"type": "set_mode", "mode": "movie", "on": true, "hours": 3}`.

- Executor: new step, calls `modes.set_mode(..., by="automation:<id>")`.
- `_action_to_ha`: compiles to a placeholder event
  (`{"event": "ziggy_deferred", "event_data": {"step": "set_mode"}}`) and is
  listed in `_HA_PLACEHOLDER_TYPES`, so HA fires and Ziggy performs it via the
  existing deferred-actions bridge.

### 6.5 API and app

- `GET /api/modes` → `{"modes": [...]}`; `POST /api/modes/{id}` body
  `{"on": bool, "hours": float|null}`. Auth: any household member. Wall
  tablets: allowed (low risk).
- `/api/mode` (legacy) stays as a compatibility facade: GET maps sleep→`night`,
  vacation→`vacation`, else `home`; POST maps the reverse. `mode_service.py`
  becomes that shim; nothing else reads it.
- WS `mode_changed` payload `{type, mode, on, until}`.
- Home screen: a horizontal chip row under the greeting — five chips, filled
  when on, with a small "until 06:30" caption; tap toggles; Movie/Cleaning
  offer a duration sheet (1 h / 2 h / 3 h / until I turn it off). Hub
  `ModeSwitcherSection` rewritten to the same chips.
- Agent context: `MODES: sleep off, movie ON until 23:40, …` replaces
  `HOUSE: mode=`. Tool `set_mode(mode, on, hours?)`.

### 6.6 Migration

- Smart Room stops emitting `kv_state` and `voice_intents`; its Day/Night rules
  gain `mode sleep is false` and `mode movie is false`; its Off rule gains
  `mode cleaning is false`. Installed Smart Rooms are not rewritten in place
  (re-save from the card picks the new shape up); orphan `modes.*_sleep` keys
  are harmless and swept by the Smart Room delete endpoint as today.
- `voice_intents.resolve_action_description` no longer binds to `kv_state`
  (nothing emits it); the `kv_mode` action kind stays executable for any
  existing registration.

## 7. Light hold

### 7.1 Object — `services/light_hold.py`

Persisted KV namespace `light_holds`, key = light entity id:

```python
{"state": "held" | "held_until_morning",
 "since": epoch, "until": epoch|None,          # until only for held_until_morning
 "room": slug|None, "occupancy_entity": str|None,
 "strikes": 1|2,
 "last_release": None | "empty" | "manual_on", # how the previous hold ended
 "engine_on_since_release": bool}
```

Settings (`settings.yaml`, all optional):

```yaml
light_hold:
  enabled: true
  empty_minutes: 30      # room empty this long → release
  morning: "06:30"       # second-strike hold ends here
```

Events (hooked from `ha_subscriber._process_event`, lights only, after the
manual-override block; `register_ziggy_call` = engine tier):

- **on → off, not engine-initiated** → `on_manual_off(eid)`:
  - if the previous hold ended by `empty` and an engine turned it on since →
    `strikes = 2`, `state = held_until_morning`, `until = next morning`;
  - else `strikes = 1`, `state = held`.
- **off → on, not engine-initiated** → `on_manual_on(eid)` → clear the record
  entirely (strikes reset).
- **off → on, engine-initiated** → if a record exists with `last_release ==
  "empty"`, set `engine_on_since_release = True`; if the light is currently
  `held`, log a `hold_violated` debug event (a recipe that did not route
  through the hold gate).

`tick(now)` (scheduler minute loop):

- `held`: room's occupancy entity has been `off` for ≥ `empty_minutes` (from
  `state_cache.last_changed`) → release, `last_release = "empty"`, keep the
  record (for strike tracking) with `state = None`.
- `held_until_morning`: `now ≥ until` → release, clear record.
- A light with no resolvable room/occupancy entity: release after
  `empty_minutes` regardless (no evidence either way; do not hold forever).

Room resolution: `device_registry` room → `smart_room_recipe.resolve_occupancy_entity`
(fused sensor) → first raw presence/motion sensor in that room (home context).

Public API: `is_held(eid)`, `get(eid)`, `list_active()`, `release(eid, by)`,
`on_manual_off`, `on_manual_on`, `on_engine_on`, `tick`.

### 7.2 Enforcement — one evaluator

Hold-aware turn-ons are executed by **Ziggy**, never natively by HA, so the
check lives in exactly one place:

- A `call_service` step may carry `"respect_hold": true`. In the executor, a
  `turn_on` on a held light is skipped with `{"ok": true, "skipped": true,
  "reason": "held"}` and a debug event.
- `_action_to_ha` compiles a `respect_hold` step to the placeholder event
  (`ziggy_deferred`), and `ha_defers_action` returns True for it, so an
  HA-triggered automation defers that step to Ziggy through the existing
  bridge (`_run_deferred_automation_actions`). Cost: one WS hop; measured on
  Canary as part of acceptance.
- Recipes set `respect_hold` on every light `turn_on`: Smart Room Day/Night,
  Motion Light, Welcome Home. Turn-offs are never held.

### 7.3 Visibility

- `GET /api/light-holds` → active holds with `entity_id`, `state`, `since`,
  `until`, `room`; `POST /api/light-holds/{entity_id}/release`.
- WS `light_hold_changed` `{type, entity_id, state|null, until}`; `deviceStore`
  keeps `lightHolds`.
- Light tile: a small "Held" pill in the state line ("Held off until the room
  empties" / "Held off until 06:30" in the detail sheet) with a **Release**
  action. Also in the device detail page.
- `why_not.gather_facts` adds `hold`; `judge` ranks `light_held` first when the
  device is off and held; `health_speech` phrases it: "You turned it off
  yourself at 20:14, so I'm holding it off until the room empties. Say
  'release it' or tap Release on the light." Agent context section
  `[held lights]`. Tool `release_light_hold(entity_id)`.

## 8. Catalog truth (A)

`services/automation_catalog.py`:

- The hand list keeps `id`, `description`, `shape`, `example`,
  `decline_message_*`. **`ziggy_supported` is computed**, not typed:
  - triggers: `id ∈ _introspect_converter_triggers()`; plus `manual` and the
    Ziggy-native presence triggers (`person_arrives`, `person_leaves`,
    `all_persons_left`, `zone_entered`, `zone_left`) listed under
    `ziggy_native.triggers`.
  - conditions: `id ∈ introspected _eval_single_condition types ∩
    _condition_to_ha types` (`state`, `numeric_state`, `time_window`, `sun`,
    `mode`, `presence`, `and/or/not`).
  - actions: `id ∈ executor step kinds` (`call_service`, `delay`, `notify`,
    `wait_for_state`, `set_mode`, `turn_off_all_lights`, `ir_command`).
- New supported entries: `controller` trigger, `mode` condition, `sun`
  condition (HA: `condition: sun`; Ziggy: `sun.sun` state from the cache),
  `set_mode` and `turn_off_all_lights` actions, `time_window` promoted from
  partial (both evaluators exist).
- `detect_drift()` gains `converter_supports_but_catalog_declines` and
  `catalog_entry_missing_for_converter`; `tests/test_automation_catalog_drift.py`
  asserts every list empty.
- `get_gaps()` unchanged in shape; now honest (`template`, `calendar`, `tag`,
  `device`, `event`, and `webhook` stays declined until a security review —
  documented as a *policy* decline, not a capability one).

## 9. Designer contract

### 9.1 Bundle schema (designer output)

```json
{
  "name": "...", "rationale": "...", "language": "en|he", "decline": null,
  "artifacts": {
    "recipes": [
      {"recipe": "smart_room",   "room": "<slug>", "options": {...}},
      {"recipe": "leave_home",   "options": {"ac": true, "notify": true}},
      {"recipe": "welcome_home", "lights": ["<entity>"], "only_after_dark": true},
      {"recipe": "motion_light", "room": "<slug>", "lights": [...], "linger_minutes": 5}
    ],
    "automations": [ {custom, same shape as today; conditions may be {"type":"mode",...}} ],
    "occupancy_sensors": []
  },
  "left_out": [ {"what": "...", "why": "..."} ]
}
```

`kv_state` and `voice_intents` leave the schema. Prompt rules added:

- PREFER a recipe whenever the outcome is a room going smart, leaving/arriving,
  or motion lighting. Compose custom rules only for what no recipe covers.
- Actions may target only rooms the user named or the trigger's room.
- Never condition on the trigger entity with the trigger's own value.
- Modes are a fixed set; use `{"type":"mode"}` conditions and `set_mode`
  actions; never invent a flag.
- Buttons: bind `controller` presses (from `home_context.controllers`) to a
  light look (`call_service` with `brightness_pct`), a mode, or
  `turn_off_all_lights`.
- Anything you cannot do goes in `left_out` with the catalog's decline text.

### 9.2 Lint — `services/bundle_lint.py`

Pure function `lint(bundle, home) -> (bundle, notes)`:

1. drop tautological conditions;
2. drop actions whose entity's room is outside the allowed set (note it);
3. drop custom automations with zero remaining actions (note it);
4. drop blueprint automations whose entity-shaped inputs (`*_entity`,
   `*_target`, `person_entity`) are not real entity ids (the 09-15 UUID);
5. notes append to `left_out`.

Run after `_strip_hallucinated_entities`.

### 9.3 Executor

New phase 0 for `recipes`: each recipe module exposes
`build(**params, language) -> bundle` and the executor inlines the recipe's
automations (stable aliases → in-place overwrite) before the custom ones.
Recipes: `services/recipes/smart_room.py` (thin wrapper around
`smart_room_recipe`), `services/recipes/leave_home.py` (server-side port of the
`leaveHome.jsx` payload: primary trigger + whole-house-quiet conditions +
`mode guest is false`), `services/recipes/welcome_home.py` (trigger
`person_arrives`, optional `sun below_horizon`, `respect_hold` turn-ons),
`services/recipes/motion_light.py` (server-side port of `motionLight.jsx`
stage shape with `respect_hold`).

Preview and apply honesty:

- `handle_design_automation_set` builds the summary line only from artifacts
  the executor can create; `left_out` is appended as "Left out: …".
- `BundlePreviewCard` renders `recipes` rows (name + one-line effect), shows
  `left_out`, drops the voice section, and the RESULTS state already lists
  per-artifact pass/fail.

## 10. Agent

- New tools: `set_mode(mode, on, hours?)`, `release_light_hold(entity_id)`.
- `design_automation` unchanged as a tool; `design_smart_room` unchanged.
- Context: `modes_text` ("sleep off · movie ON until 23:40 · …"), `holds_text`
  ("Kitchen Light held off until the room empties (since 20:14)").
- Persona `_HOW_YOU_ACT` additions: modes ("put the house in guest mode",
  "movie mode for two hours" → `set_mode`); button requests → `design_automation`
  (it now knows buttons); arrival/departure → `design_automation` (recipes);
  "why didn't the light come on" already → `explain_missing_action`, which now
  knows holds.
- `what_can_ziggy_do`: three capability entries added to
  `docs/capability-catalog.json` + `services/data/capability-catalog.json`:
  `home-modes`, `light-hold`, `buttons-from-chat` (status `canary-only` until
  the operator ships).

## 11. App

- `Dashboard.jsx`: `ModeChips` row under the greeting. `hub/sections.jsx`
  `ModeSwitcherSection` uses the same component.
- `DeviceCard.jsx` (light kinds): "Held" pill from `deviceStore.lightHolds`;
  `DeviceDetail` shows the reason and a Release button.
- Wizard: `getConditionTypes()` adds `mode`; `ConditionRow` renders a mode
  picker + on/off. `getActionTypes()` adds `set_mode`; `ActionRow` renders
  mode + on/off + hours.
- `BundlePreviewCard.jsx`: recipes rows, `left_out`, no voice section.
- `api.js`: `getModes`, `setModeState`, `getLightHolds`, `releaseLightHold`.
- i18n en/he for every new string; Hebrew per the locked style guide.

## 12. Error handling

- Modes: an MQTT publish failure never fails `set_mode` (state is persisted;
  the next announce repairs HA). A `mode` condition against an undiscovered
  entity compiles to `None` so HA never evaluates a false negative.
- Light hold: a missing room or occupancy entity degrades to a time-only
  release; a hold record for an entity that no longer exists is dropped on
  tick. All hooks are try/except-wrapped in `ha_subscriber` like their
  neighbours.
- Designer: lint never raises; an all-dropped bundle becomes an honest decline
  with `left_out` explaining why.
- Executor: a recipe build error is one `errors[]` row; other artifacts still
  apply; the manifest records only what exists.

## 13. Testing

Unit (pytest, no HA/LLM):

- `tests/test_modes.py` — set/expire/defaults, side-effect dispatch (guest
  blocks all-away, vacation starts/stops fake occupancy via monkeypatch),
  legacy facade mapping.
- `tests/test_modes_mqtt.py` — discovery payload, announce idempotence,
  entity id None ⇒ condition compiles to None.
- `tests/test_light_hold.py` — every transition in §7.1 with a fake clock and
  fake state cache: hold, manual-on clears, empty-30 releases, engine relight +
  second manual-off ⇒ until morning, morning releases, no-room fallback.
- `tests/test_executor_hold_gate.py` — `respect_hold` turn_on skipped when
  held; `_action_to_ha` placeholder; `ha_defers_action` True.
- `tests/test_automation_catalog_drift.py` — bidirectional drift empty;
  computed support flags for `zone/controller/mode/sun/time_window`.
- `tests/test_bundle_lint.py` — tautology, out-of-scope room, empty
  automation, UUID blueprint input, notes.
- `tests/test_recipes_*.py` — each recipe's shape; Smart Room mode conditions
  and `respect_hold`; Leave Home guest condition; Welcome Home after-dark.
- `tests/test_why_not.py` — `light_held` verdict + phrasing (no ids, no
  engine words).
- `tests/test_agent_v2.py` / `test_agent_persona.py` — new tools registered,
  context sections present, persona rules mention modes/buttons.
- `tests/test_prod_entrypoint_starts_services.py` — `modes_mqtt.announce` and
  the hold/modes ticks run under `backend/server.py`.

Frontend: `frontend/src/lib/__tests__/` vitest for the trigger/condition/action
vocabularies and the preview card summary; manual check of chips and badge in
the dev server.

Real-life (Canary, operator's home): §14.

## 14. Acceptance (Canary)

1. Push to `origin/main`; Canary converges; served build verified by a code
   marker, not the SHA.
2. Sweep `bundle_e0f8dbf3604b` via the bundle delete endpoint (removes the four
   automations, the two flags, the fused sensor).
3. In chat, the operator's exact 2026-09-18 request. Expected card: recipes
   `smart_room(living_room)`, `motion_light(kitchen)`, `leave_home`,
   `welcome_home`, custom button rules for the Aqara switch, no flags, no
   voice, `left_out` empty or honest.
4. Accept. Verify on the hub: automations exist with aliases; no
   `notify`-only rules; holds and modes endpoints answer.
5. Walk test: turn the kitchen light off from the app while in the kitchen;
   move; it stays off; light tile shows Held; `למה האור לא נדלק?` answers with
   the hold. Turn it on by hand; hold clears.
6. Movie mode from a chip: living-room motion does not light; expires.
7. Latency of a deferred Smart Room turn-on measured (< 1 s target).

## 15. Files

New: `services/modes.py`, `services/modes_mqtt.py`, `services/light_hold.py`,
`services/bundle_lint.py`, `services/recipes/{__init__,smart_room,leave_home,welcome_home,motion_light}.py`,
`backend/routers/modes_router.py`, `backend/routers/light_hold_router.py`,
`frontend/src/components/home/ModeChips.jsx`, tests as listed.

Changed: `services/automation_catalog.py`, `services/orchestra_designer.py`,
`services/bundle_executor.py`, `services/smart_room_recipe.py`,
`services/local_automation_actions.py`, `services/ha_automations.py`,
`services/ha_subscriber.py`, `services/ziggy_scheduler.py`,
`services/presence_side_effects.py`, `services/mode_service.py`,
`services/entity_filter.py`, `services/why_not.py`, `services/home_context.py`,
`core/agent/{tools,context,persona,health_speech}.py`,
`core/handlers/automation_handler.py`, `backend/server.py`,
`backend/routers/{mode_router,automation_router}.py`,
`frontend/src/{pages/Dashboard.jsx,components/hub/sections.jsx,components/device/DeviceCard.jsx,components/automations/BundlePreviewCard.jsx,components/automations/wizard/{ConditionRow,ActionRow}.jsx,lib/automations/types.js,lib/api.js,stores/deviceStore.js,lib/i18n/{en,he}.js}`,
`docs/capability-catalog.json`, `services/data/capability-catalog.json`,
`config/settings.example.yaml`.
