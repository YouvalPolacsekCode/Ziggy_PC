# Self-healing flaky devices — design

**Date:** 2026-07-18
**Branch:** feat/beta-image-readiness
**Status:** Design approved, pending spec review

## Problem

Some cheap Zigbee devices have buggy firmware that decouples their real physical
state from what they report and how they respond to commands. Verified on real
hardware (2026-07-18) with a kitchen bulb — a Tuya `_TZ3210_mja6r5ix` TS0505B
(firmware `z.1.0`):

- It **mis-reports state**: when polled directly it answered `OFF` while
  physically lit. This is why the app showed the light as off while it was on.
- It **intermittently ignores the OFF command**: a direct `{"state":"OFF"}` was
  physically ignored once, then honored later.
- It **emits a spurious OFF report ~1s after every ON command** — no OFF command
  is ever sent, yet the device reports itself off. This is the "goes on and
  straight off" flicker seen when tapping the app toggle.
- Color, brightness, and blink commands worked reliably every time. Only the
  on/off state handling is broken.

Every software layer (app → Ziggy → Home Assistant → Zigbee2MQTT) faithfully
relayed the commands and the device's (wrong) reports. **This is a device fault,
not a Ziggy bug.** No firmware OTA is available for the device.

Because the device lies about its own state even to a direct poll, Ziggy has **no
ground truth**. Detection is therefore necessarily heuristic, and recovery must
fail safe (give up and flag, never loop).

Observed during debugging: a color/brightness "jolt" *correlated* with the device
becoming controllable again — but causality is **unproven**. The design treats
the recovery ladder as a hypothesis to be validated on real hardware, not a
known-good fix.

## Goal

When Ziggy detects a device misbehaving this way, it should **attempt recovery
automatically and keep the user informed** ("heal + tell you"). Flaky-device
events also roll up to the operator via the relay for fleet-wide hardware
visibility.

## Non-goals

- Recovering ground truth for a device that lies to a direct poll — impossible;
  we detect and flag instead.
- Automatic re-pairing / re-interviewing a device unattended (too disruptive).
- A device reliability badge in the UI (cut for now — YAGNI).
- An operator fleet dashboard UI (later follow-up; telemetry is captured now).

## Architecture & components

### New: `services/self_heal.py`
Owns the whole feature: detector, recovery ladder, per-device reliability state,
snooze/cooldown, notify, telemetry. Mirrors the structure of
`services/anomaly_engine.py` (in-memory hot state + SQLite persistence + reuse of
push/ws) but stays a separate module — anomaly rules are *pure state-cache*
checks that *suggest* actions to the user, whereas self-heal *correlates
commands* and *acts autonomously*. Different lifecycle; kept separate.

### Command ledger (extend `services/manual_overrides.py`)
Today `register_ziggy_call(entity_id)` stamps `_recent_ziggy_calls[entity_id]`
with a 5s TTL, and is written only from the automation executor
(`services/local_automation_actions.py`). Extend it to record:
- **intended state** (what Ziggy last commanded — e.g. `on`), and
- **origin**: `user` | `voice` | `automation` | `self_heal`.

Write it from the command path (`home_automation.toggle_light` / `call_service`
and the light handler) so taps and voice register, not just automations. TTL for
the self-heal correlation window is longer than the current 5s (see thresholds).

The `origin` tag is the **loop guard**: commands issued by self-heal itself are
tagged `self_heal` and are excluded from detection, so a heal-issued ON can never
be counted as evidence of flakiness.

### Hook: `services/ha_subscriber.py::_process_event`
After the existing state-cache update, add one call:
`self_heal.observe(entity_id, old_state, new_state, ts)`. This is the natural
place — it already has entity_id, old/new state dicts, and timestamps, and fires
on every change. Detection must correlate within ~1–2s, so it is event-driven,
not polled.

### Reused plumbing (no new infrastructure)
- **Notify:** `services/push_notify.py::push_notify_fire_and_forget(...)` (new
  `self_heal` category) + `backend/ws_manager.py::manager.broadcast({...})`.
- **Fleet telemetry:** `services/telemetry_client.py::post_once(extra={...})` —
  piggybacks a one-shot event on the signed hub→relay pipeline. **Zero relay
  changes** (the relay stores arbitrary JSON in `telemetry_raw` / `audit_log`).
- **Tracing / diagnostic feed:** `core/debug_bus.py::bus.emit("self_heal", ...)`.
- **Persistence:** SQLite in `user_files/home_map.db` (new `self_heal_history`
  and `self_heal_snooze` tables, mirroring the anomaly tables).
- **Feature flags:** `settings["features"]["self_heal"]` (master on/off) and the
  tunable thresholds under `settings["self_heal"]`.

## Detection (with strengthened gate)

A **single mismatch does nothing but record evidence.** Auto-heal fires only when
evidence is strong — **either** signal is sufficient:

1. **Sustained mismatch** — ≥3 events for the same device within ~10 min where:
   Ziggy commanded state X, and within ~2s the device reported a state
   contradicting X with **no intervening command** (origin check via the ledger);
   **or** the device's reported state contradicts a forced real poll.
2. **User is fighting it** — **>3** (i.e. 4+) user-origin toggles to the same
   target state for the same device within ~60s, each reverting within ~2s.

All thresholds live in `settings["self_heal"]` and are tunable:
- `mismatch_count` = 3, `mismatch_window_s` = 600
- `revert_window_s` = 2
- `retry_count` = 3 (strictly greater-than; 4th qualifying toggle triggers),
  `retry_window_s` = 60
- `cooldown_s` = 1800, `max_jolt_cycles` = 2

Detection applies only to controllable devices with an unambiguous intended state
(lights, switches, plugs). Sensors and read-only entities are excluded.

## Recovery ladder (gentle jolt allowed; no auto re-pair)

On trigger, escalate and **re-check after each step; stop the instant the device
matches intended state**. Every command issued here is tagged origin `self_heal`.

1. **Re-assert** the intended state (re-send, e.g. `ON`). Wait ~2s, re-check.
2. **Force a real poll** (`homeassistant.update_entity` service) to confirm the
   state is genuinely wrong rather than a reporting lag. Re-check.
3. **Gentle jolt** — a brief brightness/color nudge, then snap back to the
   intended state (the un-stick observed during debugging). Re-check.
4. **Give up → flag.** After `max_jolt_cycles` (2) without success: stop, mark
   the device unreliable in `self_heal_history`, notify the user, send fleet
   telemetry, and enter `cooldown_s` (30 min). **Never loops.**

## Notify + fleet telemetry

- **App notify** on both outcomes:
  - Recovered: ws `{"type":"self_heal_recovered", entity_id, ...}` +
    `push_notify` — *"Kitchen light was unreliable — I nudged it back on."*
  - Failed/flagged: ws `{"type":"self_heal_failed", ...}` + `push_notify` —
    *"Kitchen light isn't responding reliably — it may need replacing."*
  - Category `self_heal`, subject to existing per-user prefs + quiet hours.
- **Fleet telemetry** on flag (and throttled on recoveries):
  `post_once(extra={"flaky_device": {model, manufacturer, anon_id, symptom,
  attempts, outcome, ts}})`. `anon_id` is a salted hash of the IEEE (no raw
  device identity off-hub). Lands in relay `telemetry_raw` / `audit_log`. An
  operator dashboard view is a later follow-up.

## Refresh button → manual "sync & heal"

Today `pages/DeviceDetail.jsx::handleRefresh` (line ~504) only calls
`load({background:false})`, which re-fetches **Ziggy's cached state** — for a
lying device that just re-shows the same wrong value.

Rewire it to a new backend action that:
1. Forces a **real device poll** (not a cache re-read) via
   `homeassistant.update_entity`, then
2. if the poll reveals a mismatch or the device is known-flaky, runs the recovery
   ladder **once**, and
3. returns the outcome.

Button states: *Syncing… → Recovered / Still not responding.* This is the
user-initiated counterpart to automatic detection and shares the same ladder.

## Canary diagnostic feed (replaces shadow mode)

Auto-heal is **live from day one** (no shadow mode). To let the operator judge
false-positive rate / noise on the Canary before trusting it fleet-wide:

- Every detection, heal attempt, step, and outcome is written to
  `self_heal_history` **and** emitted to `debug_bus` under scope `self_heal`
  with rich fields (device, trigger reason, evidence counts, steps taken,
  outcome, timing).
- Surface a read-only log: `GET /api/self-heal/log` (super_admin) returning
  recent history rows, and make it filterable on the existing Debug page via
  `scope=self_heal`. Because it is super_admin-gated, it is effectively visible
  only to the operator (on the Canary) — no customer-facing surface yet.

## Testing

Unit tests (necessary but **not sufficient** — real-hardware validation is the
real gate):
- Detection state machine: mismatch counting, `>3` retry gate, windows,
  cooldown, snooze, and the origin-based loop guard (self-heal commands never
  count as evidence).
- Recovery ladder: escalation order, early-exit on success, give-up after
  `max_jolt_cycles`, self-heal origin tagging on every issued command.
- Telemetry payload shape + IEEE anonymization.
- Notify dispatch (recovered vs failed) with mocked push/ws.
- Refresh→heal endpoint: forces a real poll, runs the ladder once, returns
  outcome.

Fakes for the command ledger, state events, and the command sender; no live HA
needed for unit tests.

## Real-hardware validation gate

Per the project rule that nothing "works" until tested on real hardware, and
because the jolt's efficacy is unproven:

1. Deploy to the Canary. Exercise the **manual refresh→heal** on the known-flaky
   kitchen bulb repeatedly; measure whether the ladder reliably un-sticks it.
2. Watch the **Canary diagnostic feed** for several days to gauge false-positive
   rate / noise from automatic detection.
3. Tune thresholds from real data. Only then consider it validated and safe to
   carry into shipped beta kits.

## Related

- `project_beta_image_readiness`, `project_kit_prepair_zigbee` — sourcing lesson:
  keep `_TZ3210_mja6r5ix` bulbs out of shipped kits.
- `feedback_real_life_validation`, `feedback_ziggy_product_surface`.
