# Self-Heal Flaky Devices — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) tracking.

**Goal:** Detect devices whose reported state / on-off command handling is unreliable, auto-recover them with an escalating ladder, notify the user, and roll flaky-device events up to the relay — plus rewire the device refresh button into a real poll+heal, with a super-admin diagnostic feed.

**Architecture:** A new `services/self_heal.py` engine is fed state changes from a one-line hook in `ha_subscriber._process_event`. A tiny non-invasive `services/command_ledger.py` records Ziggy's last intended command + origin per entity (written by `home_automation.call_service`/`toggle_light`); self-heal correlates "commanded X → device reverted within ~2s, not self-heal-origin" into revert events, fires on strengthened gates, escalates a recovery ladder, and reuses existing push/ws/telemetry/debug_bus/SQLite plumbing.

**Tech Stack:** Python 3.11 async, FastAPI, SQLite (`user_files/home_map.db`), React (frontend refresh button).

## Global Constraints

- Ziggy is the only product surface; never leak HA/entity_id/z2m terms in user-facing copy (spec + `feedback_ziggy_product_surface`).
- Device that lies to a direct poll ⇒ no ground truth ⇒ detection is heuristic and recovery MUST fail safe (give up + flag, never loop).
- Origin tag `self_heal` on heal-issued commands is the loop guard — such commands never count as evidence.
- Gates: sustained mismatch ≥3 in 600s **or** >3 (strictly) revert cycles in 60s; revert window 2s; cooldown 1800s; max 2 jolt cycles. All in `settings["self_heal"]`, tunable.
- No shadow mode (auto-heal live). Diagnostic feed is super_admin-only.
- Real-hardware validation on the kitchen bulb is the acceptance gate before trusting fleet-wide.

---

### Task 1: `services/command_ledger.py` — intended-command ledger

**Files:** Create `services/command_ledger.py`; Test `tests/test_command_ledger.py`

**Produces:** `record(entity_id, intended_state, origin="ziggy", ttl=None)`, `get_last(entity_id) -> dict|None` (`{"state","origin","ts"}`).

Non-invasive standalone module (no imports of home_automation/self_heal → no cycles). In-memory dict, thread-safe, TTL default 30s.

- [ ] Test: record then get_last returns state/origin; expired entry returns None; unknown returns None.
- [ ] Implement.
- [ ] Run tests, commit.

### Task 2: Command path records intent — `services/home_automation.py`

**Modify:** `call_service(domain, service, data, origin="ziggy")` and `toggle_light(entity_id, turn_on=True, origin="ziggy")`. Add `force_poll(entity_id)` helper = `call_service("homeassistant","update_entity",{"entity_id":entity_id})`.

Intent inference: `turn_on`→"on", `turn_off`→"off", `toggle`→flip current (`_state_from_cache`); light domain same. Record via `command_ledger.record(entity_id, intended, origin)` for controllable entity_ids only. Backward-compatible defaults so existing callers are unaffected.

**Consumes:** Task 1.
- [ ] Test: `call_service("light","turn_on",{"entity_id":"light.x"})` records intended "on" origin "ziggy"; `origin="self_heal"` propagates; toggle infers from cache.
- [ ] Implement, run tests, commit.

### Task 3: `services/self_heal.py` — detection engine

**Files:** Create `services/self_heal.py`; Test `tests/test_self_heal.py`

**Produces:**
- `async observe(entity_id, old_state: dict, new_state: dict, ts: float|None=None)`
- `config()` → thresholds dict (from `settings["self_heal"]` + defaults)
- `_revert_events: dict[str,list[float]]`, `_cooldown`, `_healing: set`
- SQLite `self_heal_history`, `self_heal_snooze` (mirror anomaly tables) via own `_connect()`.
- `get_log(limit=100)`, `snooze(entity_id, minutes)`, `_is_snoozed(entity_id)`.

Detection: on observe, read `command_ledger.get_last`; a **revert event** = `last and (now-last.ts)<=revert_window and new_s != last.state and last.origin!="self_heal"` and domain controllable. Append ts to `_revert_events[eid]`, prune to window. Fire when `count(last mismatch_window)>=mismatch_count` OR `count(last retry_window)>retry_count`, and not snoozed / not in cooldown / not already `_healing`. On fire → `asyncio.create_task(_run_recovery(eid, intended=last.state))`.

Feature-flag gate: `settings["features"].get("self_heal", True)`.

- [ ] Tests (with fake command_ledger + monkeypatched recovery): single revert → no fire; 3 reverts in window → fire; >3 in 60s → fire; self_heal-origin reverts ignored; snoozed → no fire; cooldown blocks re-fire.
- [ ] Implement detection (recovery stubbed), run tests, commit.

### Task 4: Recovery ladder + notify + telemetry — `services/self_heal.py`

**Produces:** `async _run_recovery(entity_id, intended)`, `async manual_refresh_heal(entity_id) -> dict`, `_notify(...)`, `_report_telemetry(...)`.

Ladder (re-check state via `home_automation.get_light_state`/cache after each; stop on success; every command `origin="self_heal"`):
1. re-assert intended (`toggle_light`/`call_service` turn_on/off).
2. `force_poll(entity_id)`; re-check.
3. gentle jolt: `set_light_color`(brief) then re-assert intended.
Repeat 1-3 up to `max_jolt_cycles` (2). On success → history row outcome=recovered, `_notify` recovered, telemetry throttled. On give-up → outcome=failed, `_notify` failed, telemetry, set cooldown.

Notify: `push_notify_fire_and_forget(title, body, url="/", category="self_heal")` + `manager.broadcast({"type":"self_heal_recovered"|"self_heal_failed","entity_id","message"})`. Copy is device-friendly ("Kitchen light was unreliable — I nudged it back on"); no HA terms.

Telemetry: `telemetry_client.post_once(extra={"flaky_device":{model,manufacturer,anon_id(salted-hash IEEE),symptom,attempts,outcome,ts}})` in a thread.

- [ ] Tests: ladder stops on early success; escalates to give-up after 2 cycles; recovered/failed notify dispatched (mock push/ws); telemetry payload shape + anon_id; all issued commands tagged self_heal.
- [ ] Implement, run tests, commit.

### Task 5: Hook into subscriber — `services/ha_subscriber.py`

**Modify:** `_process_event`, after anomaly evaluate, add guarded:
```python
try:
    from services import self_heal
    await self_heal.observe(entity_id, old_state, new_state)
except Exception:
    pass
```
- [ ] Manual/unit check that observe is invoked; commit.

### Task 6: Router — `backend/routers/self_heal_router.py` + wire in `server.py`

**Endpoints:** `GET /api/self-heal/log` (super_admin) → `get_log`; `POST /api/self-heal/refresh` (auth) `{entity_id}` → `manual_refresh_heal`; `POST /api/self-heal/snooze` (auth) `{entity_id, minutes}`.
Register in `backend/server.py` `include_router(self_heal_router, dependencies=_auth)`.
- [ ] Test endpoints (TestClient, mocked engine); commit.

### Task 7: Frontend refresh → sync&heal — `lib/api.js`, `pages/DeviceDetail.jsx`

`api.js`: add `selfHealRefresh(entityId)` (POST /api/self-heal/refresh) and `getSelfHealLog()`.
`DeviceDetail.jsx::handleRefresh`: call `selfHealRefresh(entityId)`, then `load({background:false})`, toast outcome ("Recovered" / "Still not responding" / synced). Keep spinner.
- [ ] Implement; `npm run build` sanity; commit.

### Task 8: Settings defaults — `config/settings.yaml`

Add `features.self_heal: true` and `self_heal:` thresholds block (documented). Code has same defaults so absence is safe.
- [ ] Add, commit.

### Task 9: Deploy to Canary

Commit+push branch; on hub `sudo git pull --ff-only`; rebuild with GIT_SHA (`sudo env GIT_SHA=$SHA docker compose ... up -d --build ziggy`); verify `/health`=200, `ZIGGY_GIT_SHA`=SHA, OTA bundle 200; smoke `GET /api/self-heal/log`.
- [ ] Deploy, verify, report for real-hardware test.

## Self-Review
- Spec coverage: detection (T3), stronger gate (T3 config), ladder (T4), notify+telemetry (T4), hook (T5), refresh→heal (T4/T6/T7), diagnostic feed (T4 history + T6 log endpoint), no badge (omitted), settings (T8), validation gate (T9 handoff). ✓
- Loop guard (self_heal origin) consistent across T1-T4. ✓
- No placeholders in code tasks. ✓
