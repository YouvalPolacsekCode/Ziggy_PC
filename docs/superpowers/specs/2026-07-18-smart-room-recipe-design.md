# Smart Room Recipe — the sleeping-wife orchestra

**Date:** 2026-07-18
**Branch:** feat/beta-image-readiness
**Status:** Design approved in brainstorm (2026-07-18). Pending written-spec review → implementation.

> Smart-room creation currently emits **one naive automation** (`motion_light`: motion → on, off after 300s). This spec replaces that, for the Smart Room surfaces, with a **deterministic recipe** that reliably composes the full presence-aware, day/night, sleep-suppressing orchestra ("the sleeping-wife problem"), keyed off the room's **fused occupancy sensor**.

---

## 1. Why (root cause)

- The Pro-Mode designer (`services/orchestra_designer.py`) is LLM-driven with two conflicting prompt rules — *"PREFER pre-validated blueprints when one matches"* vs *"compose multi-artifact bundles."* For "make the bedroom smart" the LLM takes the shortcut: it matches the single `motion_light` blueprint and stops. Verified live — the bundle contained exactly one `motion_light` instance, no presence/day-night/sleep logic.
- The richer pattern **was designed** (plan `reveiw-trhe-code-in-spicy-sunbeam.md`, Session D3: *"lights on when entering an empty room, off when empty, suppressed when someone's sleeping"* + `bedroom_sleep` flag + good-night/morning voice) but never enforced in the designer.
- The capability catalog **already supports** every needed piece (state triggers with `for_minutes`, `sun` conditions, `numeric_state`, AND/OR groups); `bundle_executor` builds KV flags, occupancy sensors, conditioned automations, **and voice intents**. Nothing is missing — the composition just wasn't happening.
- Secondary: the dedicated flow (`SmartRoomWizard`) IS wired and deployed (verified in the built `Actions-*.js` bundle); the operator hit the **old phone bundle** (OTA not yet swapped) and fell to the generic wizard. That self-resolves on OTA swap; this spec makes the flow's *output* worth using.

## 2. Decisions (from brainstorm)

- **Fixed recipe, not LLM**, for the Smart Room surfaces — predictable, testable, always complete. The LLM designer stays only for free-form chat outcomes ("make my office cozy").
- The recipe **keys off the fused occupancy sensor** (motion + presence + door → `binary_sensor.{room}_occupied`), the "presence entity created from multiple sensors."
- The flow **reuses the existing presence-sensor creation** — `OccupancySensorForm` component + `createOccupancySensor` API + `template_sensors.create_occupancy_sensor`. It uses an existing occupancy sensor for the room if one exists, else opens that existing modal to create one. **No new sensor-picker is built.**
- Both the **Smart Room template** and **chat "build me a smart room"** produce the recipe.

## 3. The recipe (confirmed behavior)

Given a room `R`, its fused occupancy sensor `OCC` (`binary_sensor.{R}_occupied`), its raw motion + presence sensors, and its light(s) `L`:

| Situation | Behavior | How it's expressed |
|---|---|---|
| Daytime, room becomes occupied (was empty) | Lights on, normal | trigger `OCC` off→on; conditions: sleep off, `sun` above horizon; action turn_on `L` (bright) |
| Night, room becomes occupied (was empty) | Lights on, **warm & dim** | trigger `OCC` off→on; conditions: sleep off, `sun` below horizon; action turn_on `L` warm/dim |
| Night, someone **already present** (sleeping), partner enters | **Stay dark** | no `OCC` off→on **edge** fires (occupancy already on) → no trigger. Sleep-mode condition is the backstop if the sensor drops. |
| Sleep mode on | Motion never turns lights on | every "on" automation conditions on `modes.{R}_sleep == off` |
| Room empty for N minutes | Lights off | trigger `OCC` on→off `for_minutes: N` (default 5); action turn_off `L` |
| "good night" / "good morning" | Sleep on (+lights off) / off | voice intents set `modes.{R}_sleep` and act |

**The sleeping-wife guard = edge-triggering on the fused occupancy sensor's empty→occupied transition** (a partner walking into an already-occupied room creates no edge), with **sleep mode as the explicit backstop**.

### Artifacts the recipe emits (bundle shape, consumed by `bundle_executor`)
1. `occupancy_sensors`: `{room, sensors:[…room's motion/presence/door…], friendly_name}` — **only if the room has no existing occupancy sensor** (else reference the existing one; nothing created).
2. `kv_state`: `{namespace:"modes", key:"{R}_sleep", default:false}`.
3. `automations` (source=custom):
   - **On — day**: trigger state `OCC` off→on; conditions [`{R}_sleep` is off, `sun` above horizon]; action turn_on `L`.
   - **On — night**: trigger state `OCC` off→on; conditions [`{R}_sleep` is off, `sun` below horizon]; action turn_on `L` warm/dim.
   - **Off when empty**: trigger state `OCC` on→off `for_minutes:5`; action turn_off `L`.
   - **Sleep on**: (see voice) sets `{R}_sleep`=on + turn_off `L`.
   - **Sleep off**: sets `{R}_sleep`=off.
4. `voice_intents`: `"good night"` → sleep on + lights off; `"good morning"` → sleep off. (Room-scoped naming so multiple rooms don't collide — e.g. "bedroom good night" if needed; exact phrasing finalized in impl.)

### Capability degradations (recipe adapts to the room)
- **No presence (mmWave) sensor, only motion**: occupancy edge is motion-based; the "already present" guard weakens → rely on sleep mode. Preview says so.
- **Action layer can't set brightness/color_temp**: collapse day/night "on" automations to a single plain turn_on; drop the warm/dim distinction. (Impl must verify what `save_automation` actions support; degrade cleanly.)
- **No light in the room**: recipe declines with a Ziggy-native message (nothing to control).
- Every gap surfaces in the bundle `rationale`/`decline`, honestly — never a silent half-build.

## 4. Architecture

**New backend service:** `services/smart_room_recipe.py` — `build_smart_room_bundle(room, *, occupancy_entity=None, options=None) -> {ok, bundle}`. Pure composition over the room's real entities (from `home_context`/`device_registry` + `list_occupancy_sensors`). Returns the **same bundle shape** the executor and `BundlePreviewCard` already consume. Deterministic; unit-testable without the LLM.

**New endpoint:** `POST /api/automations/smart-room/design {room, occupancy_entity?, options?}` → `{ok, bundle}` (mirrors `/bundles/design` but recipe-backed, no LLM). Apply reuses the existing `/api/automations/bundles/apply`.

**Frontend `SmartRoomWizard` (rework):**
1. Pick room (real rooms).
2. **Presence entity:** if the room has an occupancy sensor (`list_occupancy_sensors`/home_context) → use it. Else show the existing `OccupancySensorForm` (in the same modal) to create one from the room's sensors, then continue.
3. Call `/api/automations/smart-room/design` → render the recipe in the existing `BundlePreviewCard` (tweak timings / exclude pieces) → Accept → `/bundles/apply` → Undo.

**Chat:** the v2 agent's smart-room path routes to the recipe. Simplest: the `design_automation` tool (currently → `handle_design_automation_set` LLM) detects a room-scoped "smart room/bedroom" outcome and calls `build_smart_room_bundle` instead, returning the same `automation_bundle_preview` envelope so the chat card renders the rich recipe. Free-form non-room outcomes keep the LLM designer.

**Retire for these surfaces:** the LLM `motion_light`-collapse path no longer powers Smart Room. The generic designer/`orchestra_designer` is untouched for other outcomes.

## 5. Testing

- **Unit** (`tests/test_smart_room_recipe.py`): given a room with motion+presence+light → bundle has occupancy sensor (or reuses existing), sleep KV, on-day + on-night + off-empty automations with the right triggers (OCC off→on / on→off for 5m) and conditions (sleep off + sun above/below), and 2 voice intents. Degradation cases: motion-only, no-light, no-brightness-support.
- **Integration**: `/api/automations/smart-room/design` returns the bundle; `/bundles/apply` creates all artifacts (0 errors); `/bundles/{id}` undo removes them.
- **Hardware gate (Canary)**: run the flow for the bedroom (which has presence + motion + light), apply, then physically verify: entering the empty bedroom turns lights on; a second person entering while presence is already on does NOT re-trigger; "good night" suppresses; empty room turns off. Per the real-life-validation gate, not "done" until the operator confirms the suppression works with a real still person.

## 6. Open questions (resolve in impl)
- Exact voice-phrase namespacing when multiple rooms each want "good night" (global vs per-room phrase).
- Whether `save_automation` actions accept `brightness_pct`/`color_temp` (drives the day/night warm-dim vs plain-on degradation).
- Default warm/dim level + off-delay (start 30% / 2700K / 5 min; tunable in the preview).
