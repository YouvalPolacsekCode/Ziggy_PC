# Smart Light Schedule — continuous adaptive ramp

**Date:** 2026-07-20
**Branch:** feat/beta-image-readiness
**Status:** Design approved in conversation (2026-07-20). Replaces the 4-event circadian bundle with a continuous, sun-aware ramp engine.

## 1. Problem (root-caused on the live Canary hub)

The current Smart Light Schedule (`services/circadian_builder.py`) is **4 discrete HA automations** — sunrise 2700K/70%, midday(12:00) 5500K/100%, sunset 3000K/80%, bedtime 2200K/30%. Live evidence:

- It fires correctly at all 4 events, but **holds midday's harsh 5500K/100% from noon until sunset (~8 h)**, then drops off a cliff. "Too bright until 19:30" is structural: there is no afternoon step.
- It's `choose(on-only)` (auto_on=False): only re-tints lights **already on** at the event moment. A light that was off, or turned on between events, never joins the schedule → lights end up at mismatched settings.
- Nothing re-applies between the 4 events, so any manual change or power-on default persists until the next event → "doesn't take effect / gets overridden."

## 2. Design (decisions from the conversation)

Replace the 4 static automations with a **continuous ramp**:

- **Two anchors** the user sets (everything between is interpolated, so no per-phase editing):
  - **Day peak** — brightest + coolest, at solar noon (default 5500K / 100%).
  - **Night floor** — dimmest + warmest, held at night (default 2200K / 30%).
- **Timing:** **wake time** (morning ramp begins) and **bedtime** (reaches the floor). Solar noon is the daytime peak; sunrise/sunset come from the hub's location automatically.
- **Continuous:** the light's target warmth + brightness is recomputed as a smooth function of the time of day — so after solar noon it **eases down every few minutes** all afternoon instead of holding 100%.
- **Applies on light turn-on:** the instant a scheduled light goes off→on, it's set to the current ramp point (it *joins* the schedule immediately).
- **Manual override respected ("until manually set"):** if the user changes a scheduled light by hand (brightness or color) while it's on, the engine **backs off that light** and stops adjusting it — until it's next switched off→on, or the user taps **Sync now**.
- **Sync-now (play) button** on the Smart Light Schedule card: re-enrolls **all** scheduled lights (clears their manual-override) and snaps them to the current ramp point. This is the deliberate escape hatch, since the continuous run will *not* auto-recapture a hand-changed light.

### The ramp function

Given `wake`, `noon` (solar noon, ~12:00 or midpoint of sunrise/sunset), `bed` times and anchors `floor=(Kf,Bf)`, `peak=(Kp,Bp)`:

```
t < wake  or  t >= bed   → floor                       (night)
wake <= t < noon         → lerp(floor → peak, (t-wake)/(noon-wake))   (morning rise)
noon <= t < bed          → lerp(peak → floor, (t-noon)/(bed-noon))    (afternoon/evening fall)
```

Linear interpolation on both Kelvin and brightness_pct (an ease curve is a later refinement). Only `color_temp`-capable lights are targeted; brightness applies to all.

## 3. Architecture

**New service `services/circadian_engine.py`** — Ziggy-driven, replaces the HA automations:
- `compute_target(now, cfg) -> (kelvin, pct)` — pure ramp math (unit-testable, no I/O).
- `current_target(cfg)` — compute for now, using live sun times when available.
- `apply(entity_ids, kelvin, pct, *, enroll=False)` — call `light.turn_on` via `home_automation`; wrap each in `manual_overrides.register_ziggy_call()` so our own writes are not mistaken for manual. `enroll=True` also `clear_override()` first (used by turn-on + Sync-now).
- `tick()` — the periodic pass: for each scheduled light that is **on** and **not** `is_overridden`, set it to `current_target`. Skips off + manually-overridden lights.
- `on_light_turned_on(entity_id)` — called from the ha_subscriber hook when a scheduled light goes off→on: `apply([eid], *current_target, enroll=True)`.
- `sync_now()` — enroll + apply current target to ALL scheduled lights (the play button).
- Config CRUD (`load_config`/`save_config`) → `user_files/circadian_config.json`: `{enabled, lights[], peak:{kelvin,pct}, floor:{kelvin,pct}, wake, bedtime}`.

**Background thread** — spawned in `core/ziggy_main.py` (`thread_wrapper("Circadian", …)`), calls `tick()` every ~10 min. Guarded by `cfg.enabled`.

**ha_subscriber hook** — in `_process_event`, after the existing manual-override block: if `entity_id` is a scheduled circadian light and `prev_s != "on"` and `new_s == "on"`, call `circadian_engine.on_light_turned_on(entity_id)`. Also extend manual detection to **attribute** changes (brightness/color_temp) for scheduled lights that stay "on" — the current code only marks manual on on/off transitions, so a user dimming an on-light wouldn't be caught. Compare against the last value the engine wrote (tracked in the engine) to distinguish our writes from the user's.

**API** (`backend/routers/automation_router.py`, replacing the circadian-bundle endpoints):
- `GET /api/automations/circadian` → `{enabled, lights, peak, floor, wake, bedtime, current:{kelvin,pct,phase}}`
- `POST /api/automations/circadian` `{lights, peak, floor, wake, bedtime}` → save config, migrate, apply now.
- `DELETE /api/automations/circadian` → disable + clear.
- `POST /api/automations/circadian/sync` → `sync_now()` (the play button).

**Migration:** on first save through the new path (and a one-time boot migration), delete the 4 legacy `ziggy_circadian_*` HA automations (`circadian_builder.delete_bundle`) and carry their lights/settings into the new config. `circadian_builder.py` is retired to a thin shim that the migration calls, then removed.

## 4. Frontend

- **`CircadianBundleWizard`** — replace the single bedtime field with: light picker (unchanged), **Day peak** (warmth + brightness sliders, value shown), **Night floor** (warmth + brightness sliders), **wake time** + **bedtime**. Sensible defaults pre-filled so "just save" works.
- **Smart Light Schedule card** (`CircadianGroupRow` in `Actions.jsx`) — sourced from the new `/circadian` config endpoint instead of grouping `ziggy_smart_light_schedule_*` HA entities. Add a **▶ Sync now** button → `POST /circadian/sync`. Keep toggle (enable/disable) + view + edit + delete.
  - *Concurrent-session note:* `Actions.jsx` grouping + `CircadianGroupRow`/`SmartRoomGroupRow` are also touched by the smart-room session — coordinate; keep changes additive and scoped to the circadian path.
- **View modal** (`CircadianViewModal`, mirrors `SmartRoomViewModal`) — opened when the schedule is set. Shows, read-only: the **current point right now** ("8:20pm → 2900K, 62% and easing down"), the day-peak / night-floor anchors, wake + bedtime, the list of lights on the schedule (with any currently hand-overridden ones flagged), and a **Sync now** action. It's the "what is this doing?" surface, distinct from Edit.

## 5. Testing

- **Unit** (`tests/test_circadian_engine.py`): `compute_target` at wake (=floor), noon (=peak), bed (=floor), and midpoints (monotonic between); night (before wake / after bed = floor); degenerate configs (wake==bed) don't divide-by-zero; non-color_temp light gets brightness only.
- **Manual-override**: `tick()` skips `is_overridden` and off lights; `on_light_turned_on` enrolls (clears override) + applies; `sync_now` re-enrolls all.
- **Migration**: legacy bundle present → new save deletes the 4 HA automations and seeds config from them.
- **Hardware gate (Canary)**: per the real-life-validation rule — set a schedule, watch a light ease down through the afternoon (not hold 100%); turn an off light on → it snaps to the current point; hand-dim a light → engine leaves it; tap Sync now → it rejoins.

## 6. Non-goals
- No `adaptive_lighting` HACS dependency (stays self-contained).
- Ease curves / per-room schedules / sleep-mode are later refinements.
- Sun-elevation-driven (vs time-driven) ramp is a later refinement; time + solar-noon is enough to kill the afternoon plateau.
