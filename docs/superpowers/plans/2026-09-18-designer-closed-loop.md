# Designer Closed Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make everything Ziggy's designer can *say* into something it can *build*, *show*, *edit* and *explain* — fixed home modes, an engine-owned light hold, a catalog derived from the converters, recipe-first bundles, honest previews.

**Architecture:** Two new engine objects (`services/modes.py`, `services/light_hold.py`) with file-backed KV state, mirrored into HA over retained MQTT discovery where HA must condition on them; one new condition type (`mode`) and two step types (`set_mode`, `respect_hold` on `call_service`) evaluated by Ziggy's executor and deferred from HA through the existing `ziggy_deferred` bridge; the designer's catalog computed from converter introspection with bidirectional drift tests; recipes as first-class bundle artifacts; the app shows and flips both objects.

**Tech Stack:** Python 3.11 / FastAPI / pytest; React 18 + Zustand + Vite; MQTT discovery via `room_presence_engine._publish`.

**Spec:** `docs/superpowers/specs/2026-09-18-designer-closed-loop-design.md`

## Global Constraints

- Never mention Home Assistant / entity / integration / Zigbee / MQTT / ids in any user-facing string; Hebrew per `frontend/src/lib/i18n/HEBREW_STYLE_GUIDE.md` (gender-free by construction; Ziggy masculine 1st person).
- Modes are exactly `("sleep", "movie", "cleaning", "guest", "vacation")`. No other flag is creatable by anyone.
- Light hold rule: hold → cleared by manual-on → released after room empty 30 min → second strike holds until 06:30. "Manual" = not engine-initiated (`manual_overrides.was_ziggy_initiated` is False).
- Every new background behaviour starts from `backend/server.py` or a `services/ziggy_scheduler.py` tick (never `core/ziggy_main.py`).
- Run tests with `/Users/YouvalPolacsek/ziggy_pc/.venv/bin/python -m pytest -q -p no:cacheprovider`. Baseline on `origin/main` has 22 pre-existing failures (listed in the scratchpad `baseline_failed.txt`); none may grow.
- Commit after every task; message style `feat(scope): …` with the Co-Authored-By trailer.
- KV store: `services.local_automation_actions.set_local_state / get_local_state / _load_state` (file `user_files/automation_state.json`). Tests redirect it with `monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "state.json"))`.

---

## Phase 0 — Modes

### Task 1: `services/modes.py` — the fixed mode set

**Files:**
- Create: `services/modes.py`
- Test: `tests/test_modes.py`

**Interfaces:**
- Produces:
  - `MODES: tuple[str, ...]`, `DEFAULT_HOURS: dict[str, float|None]` (`movie 3, cleaning 2, sleep None→morning, guest None, vacation None`)
  - `list_modes() -> list[dict]` — each `{id, on, since, until, by, label_en, label_he, effect_en, effect_he, default_hours}`
  - `is_on(mode: str) -> bool`
  - `get(mode) -> dict`
  - `async set_mode(mode: str, on: bool, *, by: str, hours: float|None = None, now: float|None = None) -> dict`
  - `expire_due(now: float|None = None) -> list[str]` (ids expired)
  - `blocks_motion_lighting() -> bool`, `blocks_off_when_empty() -> bool`, `blocks_everyone_left() -> bool`
  - `next_morning_epoch(now: float|None = None) -> float` (uses `settings.light_hold.morning`, default `"06:30"`, local time)
  - Hooks (module-level, monkeypatchable): `_publish_hook(mode, on)`, `_broadcast_hook(payload)`, `_side_effect_hook(mode, on)` — default implementations imported lazily from `modes_mqtt`, `backend.ws_manager`, and this module's `_apply_side_effect`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_modes.py
import asyncio, time
import pytest
from services import local_automation_actions as laa
from services import modes as M

@pytest.fixture(autouse=True)
def _kv(tmp_path, monkeypatch):
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "state.json"))
    monkeypatch.setattr(M, "_publish_hook", lambda mode, on: None)
    monkeypatch.setattr(M, "_broadcast_hook", lambda payload: None)
    monkeypatch.setattr(M, "_side_effect_hook", lambda mode, on: None)

def _run(coro): return asyncio.get_event_loop().run_until_complete(coro)

def test_fixed_set_and_all_off_by_default():
    assert M.MODES == ("sleep", "movie", "cleaning", "guest", "vacation")
    assert [m["id"] for m in M.list_modes()] == list(M.MODES)
    assert not any(m["on"] for m in M.list_modes())

def test_unknown_mode_rejected():
    with pytest.raises(ValueError):
        _run(M.set_mode("party", True, by="test"))

def test_movie_defaults_to_three_hours():
    now = 1_700_000_000.0
    rec = _run(M.set_mode("movie", True, by="test", now=now))
    assert rec["on"] and rec["until"] == pytest.approx(now + 3 * 3600)
    assert M.is_on("movie")

def test_explicit_hours_win():
    now = 1_700_000_000.0
    rec = _run(M.set_mode("cleaning", True, by="test", hours=1, now=now))
    assert rec["until"] == pytest.approx(now + 3600)

def test_guest_has_no_expiry():
    rec = _run(M.set_mode("guest", True, by="test"))
    assert rec["until"] is None

def test_sleep_expires_at_next_morning(monkeypatch):
    monkeypatch.setattr(M, "next_morning_epoch", lambda now=None: 42.0)
    rec = _run(M.set_mode("sleep", True, by="test", now=1.0))
    assert rec["until"] == 42.0

def test_expire_due_turns_off_and_reports():
    now = 1_700_000_000.0
    _run(M.set_mode("movie", True, by="test", hours=1, now=now))
    assert M.expire_due(now + 10) == []
    assert M.expire_due(now + 3601) == ["movie"]
    assert not M.is_on("movie")

def test_blockers():
    _run(M.set_mode("sleep", True, by="t"))
    assert M.blocks_motion_lighting() and not M.blocks_off_when_empty()
    _run(M.set_mode("cleaning", True, by="t"))
    assert M.blocks_off_when_empty()
    _run(M.set_mode("guest", True, by="t"))
    assert M.blocks_everyone_left()

def test_hooks_fire_on_change():
    seen = {}
    M._publish_hook = lambda mode, on: seen.setdefault("pub", []).append((mode, on))
    M._broadcast_hook = lambda p: seen.setdefault("ws", []).append(p["type"])
    M._side_effect_hook = lambda mode, on: seen.setdefault("fx", []).append((mode, on))
    _run(M.set_mode("vacation", True, by="t"))
    assert seen == {"pub": [("vacation", True)], "ws": ["mode_changed"], "fx": [("vacation", True)]}

def test_labels_are_hebrew_and_english():
    for m in M.list_modes():
        assert m["label_he"] and m["label_en"] and m["effect_he"] and m["effect_en"]
        assert "Home Assistant" not in m["effect_en"]
```

- [ ] **Step 2: Run to verify failure** — `pytest tests/test_modes.py -q` → ImportError `services.modes`.

- [ ] **Step 3: Implement `services/modes.py`**

Key points (write the module in full):
- `_NS = "home_modes"`; `_META` dict with labels/effects (Hebrew: שינה / סרט / ניקיון / אורחים / חופשה; effects e.g. "תנועה לא מדליקה אורות" / "Motion won't turn lights on"; cleaning "האורות לא נכבים כשהחדר מתרוקן"; guest "״כולם יצאו״ לא מופעל"; vacation "הבית נראה מאוכלס בערב").
- `get(mode)` reads `laa.get_local_state(_NS, mode) or {"on": False, "since": None, "until": None, "by": None}`; `list_modes()` merges meta + state and **applies expiry lazily** (if `until` and `until <= now` → treat as off; do not write).
- `set_mode`: validate; compute `until` (`None` when off; `hours` → `now+hours*3600`; else `DEFAULT_HOURS[mode]` hours, `sleep` → `next_morning_epoch(now)`, else `None`); persist; call `_publish_hook`, `_broadcast_hook({"type":"mode_changed","mode":mode,"on":on,"until":until,"by":by})`, `_side_effect_hook` — each wrapped in try/except with `log_error`; emit `bus.emit("modes", BASIC, "mode_set", mode=…, on=…, by=…, until=…)`; return the record.
- `expire_due(now)`: for each mode with `on` and `until <= now` → `set_mode(mode, False, by="expiry")` run via `asyncio` if a loop is running else `asyncio.run`; simpler: make `expire_due` async too? Keep sync: it writes state directly (`_write(mode, off)`) then fires hooks synchronously via the same helper `_after_change(...)` (hooks are sync callables; `_broadcast_hook` default schedules `manager.broadcast` with `asyncio.get_running_loop().create_task` when a loop is running, else ignores). Return the ids.
- `next_morning_epoch(now)`: read `settings.get("light_hold", {}).get("morning", "06:30")`; build today's HH:MM in local time; if `<= now` add one day.
- `_apply_side_effect(mode, on)`: `vacation` → `services.fake_occupancy_scheduler.start(automation_id="ziggy_mode_vacation", label="Vacation", window_start="19:00", window_end="23:00", duration_days=30, room_pool=services.automation_templates._dimmable_lights_by_room(cap_map), tv_ir_device_id=(services.automation_templates._first_tv_ir_device() or {}).get("id"))` when on; `stop("ziggy_mode_vacation")` when off. `cap_map` from `services.capability_matcher.detect_capabilities()` — wrap in try/except; if no room pool, log and skip. Other modes: no side effect (their effects are conditions/guards elsewhere).

- [ ] **Step 4: Run** `pytest tests/test_modes.py -q` → all pass.
- [ ] **Step 5: Commit** `feat(modes): fixed home mode set with expiry and hooks`

---

### Task 2: `services/modes_mqtt.py` — HA mirror + hide from device lists

**Files:**
- Create: `services/modes_mqtt.py`
- Modify: `services/entity_filter.py:46-90` (add `r"^binary_sensor\.ziggy_mode_"` to `_HIDDEN_PATTERNS`), `services/modes.py` (`_publish_hook` default → `modes_mqtt.publish_state`)
- Test: `tests/test_modes_mqtt.py`

**Interfaces:**
- Produces: `UNIQUE_ID(mode) -> str` (`ziggy_mode_<mode>`), `discovery_payload(mode) -> dict`, `announce() -> bool` (all modes: config + availability + state), `publish_state(mode, on) -> bool`, `entity_id(mode) -> str|None`. Publishing goes through `_publish(topic, payload: bytes)` (monkeypatchable) which defaults to `room_presence_engine._publish`.

- [ ] **Step 1: Tests**

```python
# tests/test_modes_mqtt.py
import json
from services import modes_mqtt as MM
from services import entity_filter

def test_discovery_payload_shape():
    p = MM.discovery_payload("sleep")
    assert p["unique_id"] == "ziggy_mode_sleep"
    assert p["state_topic"] == "ziggy/modes/sleep/state"
    assert p["availability_topic"] == MM.AVAILABILITY_TOPIC
    assert p["device"]["identifiers"] == ["ziggy_modes"]

def test_announce_publishes_every_mode_retained(monkeypatch):
    sent = []
    monkeypatch.setattr(MM, "_publish", lambda t, p: sent.append((t, p)) or True)
    monkeypatch.setattr(MM, "_state_of", lambda mode: mode == "guest")
    assert MM.announce()
    topics = [t for t, _ in sent]
    for m in ("sleep", "movie", "cleaning", "guest", "vacation"):
        assert f"homeassistant/binary_sensor/ziggy_mode_{m}/config" in topics
        assert f"ziggy/modes/{m}/state" in topics
    assert dict(sent)["ziggy/modes/guest/state"] == b"ON"
    assert dict(sent)["ziggy/modes/sleep/state"] == b"OFF"

def test_entity_id_none_when_not_discovered(monkeypatch):
    monkeypatch.setattr(MM, "_lookup", lambda uid: None)
    assert MM.entity_id("movie") is None

def test_mode_entities_hidden_from_device_lists():
    assert entity_filter.is_hidden_entity("binary_sensor.ziggy_mode_sleep")
```

- [ ] **Step 2: Run → fail.** 
- [ ] **Step 3: Implement** mirroring `services/presence_mqtt.py` exactly (device block `{"identifiers": ["ziggy_modes"], "name": "Ziggy Modes", "manufacturer": "Ziggy"}`, `device_class` omitted, names `"Sleep mode"` etc.). `_state_of(mode)` defaults to `modes.is_on`. `_lookup(uid)` defaults to `room_presence_engine.lookup_mqtt_entity_id(uid, attempts=2, delay=0.3)`. In `modes.py` set `_publish_hook = lambda mode, on: modes_mqtt.publish_state(mode, on)` (lazy import inside).
- [ ] **Step 4: Run** both test files → pass.
- [ ] **Step 5: Commit** `feat(modes): mirror modes into HA as retained binary_sensors`

---

### Task 3: `mode` condition + `set_mode` step

**Files:**
- Modify: `services/local_automation_actions.py` (`_eval_single_condition` ~L172; step dispatcher ~L560 next to `notify`; `SUPPORTED_STEP_TYPES`-style list at ~L93 add `"set_mode"`), `services/ha_automations.py` (`_condition_to_ha` L188; `_action_to_ha` L273; `_HA_PLACEHOLDER_TYPES` L342)
- Test: `tests/test_mode_condition_and_step.py`

**Interfaces:**
- Consumes: `modes.is_on`, `modes.set_mode`, `modes_mqtt.entity_id`.
- Produces: condition `{"type":"mode","mode":"sleep","is":false}`; step `{"type":"set_mode","mode":"movie","on":true,"hours":3}`; HA placeholder action `{"event":"ziggy_deferred","event_data":{"step":"set_mode","mode":…}}`.

- [ ] **Step 1: Tests**

```python
# tests/test_mode_condition_and_step.py
import asyncio, pytest
from services import local_automation_actions as laa
from services import ha_automations as HA
from services import modes as M

@pytest.fixture(autouse=True)
def _kv(tmp_path, monkeypatch):
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "s.json"))
    for h in ("_publish_hook", "_broadcast_hook", "_side_effect_hook"):
        monkeypatch.setattr(M, h, lambda *a, **k: None)

def test_mode_condition_local_eval():
    ok, why = laa._eval_single_condition({"type": "mode", "mode": "sleep", "is": False})
    assert ok and "sleep" in why
    asyncio.run(M.set_mode("sleep", True, by="t"))
    ok, _ = laa._eval_single_condition({"type": "mode", "mode": "sleep", "is": False})
    assert not ok

def test_mode_condition_compiles_to_state_when_discovered(monkeypatch):
    monkeypatch.setattr("services.modes_mqtt.entity_id", lambda m: "binary_sensor.ziggy_mode_sleep")
    c = HA._condition_to_ha({"type": "mode", "mode": "sleep", "is": False})
    assert c == {"condition": "state", "entity_id": "binary_sensor.ziggy_mode_sleep", "state": "off"}

def test_mode_condition_compiles_to_none_when_undiscovered(monkeypatch):
    monkeypatch.setattr("services.modes_mqtt.entity_id", lambda m: None)
    assert HA._condition_to_ha({"type": "mode", "mode": "sleep", "is": False}) is None

def test_set_mode_step_is_deferred_placeholder():
    a = {"type": "set_mode", "mode": "movie", "on": True, "hours": 2}
    assert HA._action_to_ha(a) == {"event": "ziggy_deferred", "event_data": {"step": "set_mode", "mode": "movie"}}
    assert HA.ha_defers_action(a) is True

def test_set_mode_step_executes(monkeypatch):
    calls = []
    async def fake_set(mode, on, *, by, hours=None, now=None):
        calls.append((mode, on, by, hours)); return {"on": on}
    monkeypatch.setattr(M, "set_mode", fake_set)
    laa.save_ziggy_actions("auto_x", [{"type": "set_mode", "mode": "movie", "on": True, "hours": 2}])
    asyncio.run(laa.execute_ziggy_actions("auto_x", "X"))
    assert calls == [("movie", True, "automation:auto_x", 2)]
```

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement.** Evaluator branch returns `(is_on == want, f"mode {mode}={'on' if is_on else 'off'} (want {want})")`. HA compile: `"state": "on" if want else "off"`. `_action_to_ha` branch before `return None`. Add `"set_mode"` to `_HA_PLACEHOLDER_TYPES`. Executor branch: `await M.set_mode(step["mode"], bool(step.get("on", True)), by=f"automation:{automation_id}", hours=step.get("hours"))`; result `{"ok": True, "message": f"mode {mode} {'on' if on else 'off'}"}`.
- [ ] **Step 4: Run → pass.** Also `pytest tests/test_leave_home_quiet_duration.py tests/test_bundle_executor_alias.py -q` still pass.
- [ ] **Step 5: Commit** `feat(modes): mode condition + set_mode step across both evaluators`

---

### Task 4: Modes API, legacy facade, startup, scheduler tick

**Files:**
- Create: `backend/routers/modes_router.py`
- Modify: `services/mode_service.py` (facade over `modes`), `backend/routers/mode_router.py` (unchanged surface; behaviour now via facade), `backend/server.py` (register `modes_router`; announce `modes_mqtt` in the same block as `presence_mqtt` ~L248), `services/ziggy_scheduler.py` (per-minute `modes.expire_due()` next to the fake-occupancy tick ~L486)
- Test: `tests/test_modes_router.py`, extend `tests/test_prod_entrypoint_starts_services.py`

**Interfaces:**
- Produces: `GET /api/modes` → `{"modes": [...]}`; `POST /api/modes/{mode}` body `{"on": bool, "hours": float|null}` → record; 400 on unknown mode. Legacy `GET /api/mode` → `{"mode": "night"|"vacation"|"home", …}`; `POST /api/mode {"mode": "night"}` → `set_mode("sleep", True)`, `"vacation"` → vacation on, `"home"`/`"away"` → both off.

- [ ] **Step 1: Tests**

```python
# tests/test_modes_router.py
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.routers import auth_deps
from backend.routers import modes_router as MR
from backend.routers import mode_router as LegacyMR
from services import local_automation_actions as laa
from services import modes as M

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "s.json"))
    for h in ("_publish_hook", "_broadcast_hook", "_side_effect_hook"):
        monkeypatch.setattr(M, h, lambda *a, **k: None)
    app = FastAPI()
    app.include_router(MR.router); app.include_router(LegacyMR.router)
    app.dependency_overrides[auth_deps.get_current_user] = lambda: {"username": "youval", "role": "owner"}
    return TestClient(app)

def test_list_and_set(client):
    assert [m["id"] for m in client.get("/api/modes").json()["modes"]] == list(M.MODES)
    r = client.post("/api/modes/movie", json={"on": True, "hours": 1})
    assert r.status_code == 200 and r.json()["on"] and r.json()["by"] == "youval"
    assert client.post("/api/modes/party", json={"on": True}).status_code == 400

def test_legacy_facade(client):
    assert client.get("/api/mode").json()["mode"] == "home"
    client.post("/api/mode", json={"mode": "night"})
    assert M.is_on("sleep") and client.get("/api/mode").json()["mode"] == "night"
    client.post("/api/mode", json={"mode": "home"})
    assert not M.is_on("sleep")
```

Add to `tests/test_prod_entrypoint_starts_services.py`:

```python
    def test_modes_announce_and_expiry_run_in_prod(self):
        assert "modes_mqtt" in _startup_source()
        import inspect
        from services import ziggy_scheduler
        assert "expire_due" in inspect.getsource(ziggy_scheduler.run_scheduler)
```

- [ ] **Step 2: Run → fail.** 
- [ ] **Step 3: Implement.** `modes_router` with `SetBody(on: bool, hours: float|None=None)`; `mode_service.get_mode()` returns `{"mode": derived, "changed_at": …, "changed_by": …}` from `modes`; `set_mode(new_mode, changed_by)` maps as above and still broadcasts legacy `mode_changed` with `mode` key (the new broadcast carries `mode`+`on`; keep both fields in one payload: `{"type":"mode_changed","mode":…, "on":…, "until":…, "legacy_mode": derived}`). Register router in `server.py` next to `mode_router`; announce thread named `ModesMQTT`; scheduler tick `from services import modes as _modes; _modes.expire_due()` wrapped in try/except.
- [ ] **Step 4: Run** the three test files → pass.
- [ ] **Step 5: Commit** `feat(modes): /api/modes, legacy /api/mode facade, startup announce, expiry tick`

---

### Task 5: Mode side effects — guest guards "everyone left"

**Files:**
- Modify: `services/presence_side_effects.py:65-80` (before firing `all_persons_left`), `services/ziggy_scheduler.py:33-49` (`_sweep_presence_expiry` → `_fire_presence_automation("person_leaves", …)` — guard the all-away composite), `services/local_automation_actions.py` (executor: a step list whose automation id is `ziggy_leave_home` … **no** — guard at the trigger, not the executor)
- Test: `tests/test_modes_side_effects.py`

- [ ] **Step 1: Tests**

```python
# tests/test_modes_side_effects.py
import asyncio, pytest
from services import local_automation_actions as laa
from services import modes as M
from services import presence_side_effects as PSE

@pytest.fixture(autouse=True)
def _kv(tmp_path, monkeypatch):
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "s.json"))
    for h in ("_publish_hook", "_broadcast_hook", "_side_effect_hook"):
        monkeypatch.setattr(M, h, lambda *a, **k: None)

def test_guest_mode_blocks_all_persons_left(monkeypatch):
    fired = []
    monkeypatch.setattr("core.automation_file.list_automations",
                        lambda: [{"id": "leave", "enabled": True, "trigger": {"type": "all_persons_left"}}])
    async def fake_exec(aid, *a, **k): fired.append(aid)
    monkeypatch.setattr("services.local_automation_actions.execute_ziggy_actions", fake_exec)
    monkeypatch.setattr("services.presence_engine.is_all_away", lambda *a, **k: True)
    asyncio.run(PSE._fire_automations("Youval", "not_home"))
    assert fired == ["leave"]
    fired.clear()
    asyncio.run(M.set_mode("guest", True, by="t"))
    asyncio.run(PSE._fire_automations("Youval", "not_home"))
    assert fired == []

def test_vacation_starts_and_stops_fake_occupancy(monkeypatch):
    calls = []
    monkeypatch.setattr("services.fake_occupancy_scheduler.start", lambda **kw: calls.append(("start", kw["automation_id"])) or {"ok": True})
    monkeypatch.setattr("services.fake_occupancy_scheduler.stop", lambda aid: calls.append(("stop", aid)) or True)
    monkeypatch.setattr("services.automation_templates._dimmable_lights_by_room", lambda cap_map: [{"id": "living_room", "entity_id": "light.a"}])
    monkeypatch.setattr("services.capability_matcher.detect_capabilities", lambda: {})
    M._apply_side_effect("vacation", True)
    M._apply_side_effect("vacation", False)
    assert calls == [("start", "ziggy_mode_vacation"), ("stop", "ziggy_mode_vacation")]
```

- [ ] **Step 2: Run → fail.** 
- [ ] **Step 3: Implement.** In `_fire_automations` and the scheduler's all-away branch: `if modes.blocks_everyone_left(): log_info("[Presence] guest mode on — everyone-left automations held"); bus.emit(...); skip`. Also `ziggy_leave_home` is a *state-trigger* HA automation on some homes — add the `{"type":"mode","mode":"guest","is":False}` condition in the Leave Home recipe (Task 12) so HA-compiled ones respect it once re-saved.
- [ ] **Step 4: Run → pass.** 
- [ ] **Step 5: Commit** `feat(modes): guest holds everyone-left; vacation drives the lived-in simulation`

---

## Phase 1 — Light hold

### Task 6: `services/light_hold.py` — state machine

**Files:**
- Create: `services/light_hold.py`
- Test: `tests/test_light_hold.py`

**Interfaces:**
- Produces:
  - `is_held(entity_id) -> bool`, `get(entity_id) -> dict|None`, `list_active() -> list[dict]`
  - `on_manual_off(entity_id, *, now=None) -> dict`, `on_manual_on(entity_id, *, now=None) -> None`, `on_engine_on(entity_id, *, now=None) -> None`
  - `release(entity_id, *, by: str, now=None) -> bool`
  - `tick(now=None) -> list[str]` (released ids)
  - `settings() -> dict` (`enabled`, `empty_minutes`, `morning`)
  - Injectable: `_room_and_occupancy(entity_id) -> tuple[str|None, str|None]` (default: `device_registry` room → `smart_room_recipe.resolve_occupancy_entity` → first `presence`/`motion` in `home_context` room), `_occupancy_off_since(occ_entity) -> float|None` (default: `ha_subscriber.state_cache[occ]["last_changed"]` when state is `off`, else None), `_broadcast_hook(payload)`.
  - Record schema exactly as spec §7.1; KV namespace `light_holds`.

- [ ] **Step 1: Tests**

```python
# tests/test_light_hold.py
import pytest
from services import local_automation_actions as laa
from services import light_hold as LH

T0 = 1_700_000_000.0
LIGHT = "light.kitchen"

@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "s.json"))
    monkeypatch.setattr(LH, "_room_and_occupancy", lambda eid: ("kitchen", "binary_sensor.kitchen_occ"))
    monkeypatch.setattr(LH, "_broadcast_hook", lambda p: None)
    monkeypatch.setattr(LH, "settings", lambda: {"enabled": True, "empty_minutes": 30, "morning": "06:30"})
    monkeypatch.setattr(LH, "_next_morning", lambda now: now + 8 * 3600)
    LH._occupancy_off_since = lambda occ: None   # room occupied

def test_manual_off_holds():
    rec = LH.on_manual_off(LIGHT, now=T0)
    assert rec["state"] == "held" and rec["strikes"] == 1 and LH.is_held(LIGHT)
    assert LH.list_active()[0]["entity_id"] == LIGHT

def test_manual_on_clears_everything():
    LH.on_manual_off(LIGHT, now=T0)
    LH.on_manual_on(LIGHT, now=T0 + 60)
    assert not LH.is_held(LIGHT) and LH.get(LIGHT) is None

def test_room_empty_thirty_minutes_releases():
    LH.on_manual_off(LIGHT, now=T0)
    LH._occupancy_off_since = lambda occ: T0 + 100
    assert LH.tick(now=T0 + 100 + 29 * 60) == []
    assert LH.tick(now=T0 + 100 + 31 * 60) == [LIGHT]
    assert not LH.is_held(LIGHT)
    assert LH.get(LIGHT)["last_release"] == "empty"      # memory kept for strike 2

def test_second_strike_holds_until_morning():
    LH.on_manual_off(LIGHT, now=T0)
    LH._occupancy_off_since = lambda occ: T0
    LH.tick(now=T0 + 31 * 60)                 # released by empty
    LH._occupancy_off_since = lambda occ: None
    LH.on_engine_on(LIGHT, now=T0 + 40 * 60)   # motion relit it
    rec = LH.on_manual_off(LIGHT, now=T0 + 41 * 60)
    assert rec["state"] == "held_until_morning" and rec["strikes"] == 2
    assert rec["until"] == pytest.approx(T0 + 41 * 60 + 8 * 3600)
    # room emptying does NOT release a morning hold
    LH._occupancy_off_since = lambda occ: T0 + 42 * 60
    assert LH.tick(now=T0 + 42 * 60 + 60 * 60) == []
    assert LH.tick(now=T0 + 41 * 60 + 8 * 3600 + 1) == [LIGHT]
    assert LH.get(LIGHT) is None

def test_manual_on_between_resets_strikes():
    LH.on_manual_off(LIGHT, now=T0)
    LH._occupancy_off_since = lambda occ: T0
    LH.tick(now=T0 + 31 * 60)
    LH.on_manual_on(LIGHT, now=T0 + 35 * 60)   # user turned it on themselves
    LH.on_engine_on(LIGHT, now=T0 + 36 * 60)
    assert LH.on_manual_off(LIGHT, now=T0 + 37 * 60)["strikes"] == 1

def test_no_room_falls_back_to_time_only(monkeypatch):
    monkeypatch.setattr(LH, "_room_and_occupancy", lambda eid: (None, None))
    LH.on_manual_off(LIGHT, now=T0)
    assert LH.tick(now=T0 + 29 * 60) == []
    assert LH.tick(now=T0 + 31 * 60) == [LIGHT]

def test_explicit_release():
    LH.on_manual_off(LIGHT, now=T0)
    assert LH.release(LIGHT, by="youval", now=T0 + 5) is True
    assert not LH.is_held(LIGHT) and LH.get(LIGHT) is None

def test_disabled_setting_never_holds(monkeypatch):
    monkeypatch.setattr(LH, "settings", lambda: {"enabled": False, "empty_minutes": 30, "morning": "06:30"})
    assert LH.on_manual_off(LIGHT, now=T0) == {} and not LH.is_held(LIGHT)
```

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** per spec §7.1. `tick` for `held`: `off_since = _occupancy_off_since(occ)`; release when `off_since and now - off_since >= empty_minutes*60`; when `occ is None` use `now - since`. Every state change → `_broadcast_hook({"type":"light_hold_changed","entity_id":…,"state":state_or_None,"until":…})` and `bus.emit("light_hold", BASIC, event, …)`. `settings()` reads `core.settings_loader.settings.get("light_hold", {})` with defaults. `_next_morning(now)` = `modes.next_morning_epoch(now)`.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** `feat(light-hold): engine-owned manual-off memory with the agreed release rule`

---

### Task 7: Hook the hold into HA events and the scheduler

**Files:**
- Modify: `services/ha_subscriber.py:~300` (after the manual-override block, lights only), `services/ziggy_scheduler.py` (per-minute `light_hold.tick()`), `config/settings.example.yaml` (`light_hold:` block)
- Test: `tests/test_light_hold_hooks.py`

**Interfaces:**
- Produces: `light_hold.on_state_change(entity_id, prev_s, new_s, engine_initiated: bool)` — the single entry the subscriber calls; routes to `on_manual_off` / `on_manual_on` / `on_engine_on`.

- [ ] **Step 1: Tests**

```python
# tests/test_light_hold_hooks.py
import inspect, pytest
from services import local_automation_actions as laa
from services import light_hold as LH

@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "s.json"))
    monkeypatch.setattr(LH, "_room_and_occupancy", lambda eid: ("k", "binary_sensor.k"))
    monkeypatch.setattr(LH, "_broadcast_hook", lambda p: None)
    LH._occupancy_off_since = lambda occ: None

def test_router_maps_transitions():
    LH.on_state_change("light.a", "on", "off", engine_initiated=False)
    assert LH.is_held("light.a")
    LH.on_state_change("light.a", "off", "on", engine_initiated=False)
    assert not LH.is_held("light.a")

def test_engine_off_is_not_a_hold():
    LH.on_state_change("light.a", "on", "off", engine_initiated=True)
    assert not LH.is_held("light.a")

def test_non_light_ignored():
    LH.on_state_change("switch.a", "on", "off", engine_initiated=False)
    assert LH.get("switch.a") is None

def test_subscriber_and_scheduler_wired():
    from services import ha_subscriber, ziggy_scheduler
    assert "light_hold" in inspect.getsource(ha_subscriber._process_event)
    assert "light_hold" in inspect.getsource(ziggy_scheduler.run_scheduler)
```

- [ ] **Step 2: Run → fail.** 
- [ ] **Step 3: Implement.** In `_process_event`, inside the light block: `engine = was_ziggy_initiated(entity_id)`; call `light_hold.on_state_change(entity_id, prev_s, new_s, engine_initiated=engine)` in try/except. Scheduler: `light_hold.tick()` beside `modes.expire_due()`. Settings example block with comments.
- [ ] **Step 4: Run → pass.** 
- [ ] **Step 5: Commit** `feat(light-hold): observe HA light transitions; release on the minute tick`

---

### Task 8: Executor hold gate + HA deferral for `respect_hold`

**Files:**
- Modify: `services/local_automation_actions.py:~440` (call_service branch, after the override gate), `services/ha_automations.py` (`_action_to_ha`, `ha_defers_action`)
- Test: `tests/test_executor_hold_gate.py`

- [ ] **Step 1: Tests**

```python
# tests/test_executor_hold_gate.py
import asyncio, pytest
from services import local_automation_actions as laa
from services import ha_automations as HA
from services import light_hold as LH

@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "s.json"))
    monkeypatch.setattr(LH, "_room_and_occupancy", lambda eid: ("k", None))
    monkeypatch.setattr(LH, "_broadcast_hook", lambda p: None)

def test_respect_hold_turn_on_compiles_to_deferred_event():
    a = {"type": "call_service", "entity_id": "light.a", "service": "light.turn_on", "respect_hold": True}
    assert HA._action_to_ha(a) == {"event": "ziggy_deferred", "event_data": {"step": "call_service", "entity_id": "light.a"}}
    assert HA.ha_defers_action(a) is True

def test_plain_call_service_still_native():
    a = {"type": "call_service", "entity_id": "light.a", "service": "light.turn_on"}
    assert HA._action_to_ha(a)["service"] == "light.turn_on"
    assert HA.ha_defers_action(a) is False

def test_held_light_turn_on_is_skipped(monkeypatch):
    sent = []
    monkeypatch.setattr("services.home_automation.call_service", lambda d, s, p: sent.append((d, s)) or {"ok": True})
    LH.on_manual_off("light.a", now=1.0)
    laa.save_ziggy_actions("auto_h", [{"type": "call_service", "entity_id": "light.a", "service": "light.turn_on", "service_value": "turn_on", "respect_hold": True}])
    res = asyncio.run(laa.execute_ziggy_actions("auto_h", "H"))
    assert sent == []
    assert any(r.get("skipped") and r.get("reason") == "held" for r in (res or {}).get("results", res if isinstance(res, list) else []))

def test_turn_off_never_gated(monkeypatch):
    sent = []
    monkeypatch.setattr("services.home_automation.call_service", lambda d, s, p: sent.append((d, s)) or {"ok": True})
    LH.on_manual_off("light.a", now=1.0)
    laa.save_ziggy_actions("auto_o", [{"type": "call_service", "entity_id": "light.a", "service": "light.turn_off", "service_value": "turn_off", "respect_hold": True}])
    asyncio.run(laa.execute_ziggy_actions("auto_o", "O"))
    assert sent == [("light", "turn_off")]
```

(Adjust the `res` shape assertion to whatever `execute_ziggy_actions` returns — read its return statement first; the test must inspect the per-step results list.)

- [ ] **Step 2: Run → fail.** 
- [ ] **Step 3: Implement.** Executor: after the override gate, `if step.get("respect_hold") and svc_key == "turn_on" and light_hold.is_held(entity_id): result = {"ok": True, "skipped": True, "reason": "held", "message": f"{entity_id} held off by hand — left alone."}; bus.emit("light_hold", BASIC, "turn_on_held", …); continue`. `_action_to_ha`: at the top of the `call_service` branch, `if a.get("respect_hold"): return {"event": "ziggy_deferred", "event_data": {"step": "call_service", "entity_id": entity_id}}`. `ha_defers_action`: `if kind == "call_service" and a.get("respect_hold"): return True`.
- [ ] **Step 4: Run → pass**; also `tests/test_leave_home_quiet_duration.py`.
- [ ] **Step 5: Commit** `feat(light-hold): respect_hold turn-ons run through Ziggy and honour the hold`

---

### Task 9: Light-hold API, why-not verdict, speech

**Files:**
- Create: `backend/routers/light_hold_router.py`
- Modify: `backend/server.py` (register), `services/why_not.py` (`gather_facts` adds `"hold"`; `judge` adds `light_held` first when device state is `off` and hold present), `core/agent/health_speech.py` (`_WHY_NOT_LINES["light_held"]` he/en), `services/light_hold.py` (`_broadcast_hook` default → `manager.broadcast` via running loop)
- Test: `tests/test_light_hold_router.py`, extend `tests/test_why_not.py`

- [ ] **Step 1: Tests**

```python
# tests/test_light_hold_router.py
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.routers import auth_deps, light_hold_router as R
from services import local_automation_actions as laa
from services import light_hold as LH

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "s.json"))
    monkeypatch.setattr(LH, "_room_and_occupancy", lambda eid: ("k", None))
    monkeypatch.setattr(LH, "_broadcast_hook", lambda p: None)
    app = FastAPI(); app.include_router(R.router)
    app.dependency_overrides[auth_deps.get_current_user] = lambda: {"username": "y"}
    return TestClient(app)

def test_list_and_release(client):
    LH.on_manual_off("light.a", now=1.0)
    holds = client.get("/api/light-holds").json()["holds"]
    assert holds[0]["entity_id"] == "light.a" and holds[0]["state"] == "held"
    assert client.post("/api/light-holds/light.a/release").json()["released"] is True
    assert client.get("/api/light-holds").json()["holds"] == []
```

Append to `tests/test_why_not.py`:

```python
def test_light_held_outranks_automation_verdicts_and_phrases_cleanly():
    f = _facts(device={"state": "off", "reachable": True, "last_intended": "on"},
               automations=[{"id": "a", "name": "Kitchen on entry", "enabled": True, "runs": []}],
               hold={"state": "held", "since": 1.0, "until": None})
    v = W.judge(f)
    assert v[0] == "light_held"
    for lang in ("he", "en"):
        s = HS.describe_why_not(v, f, "Kitchen Light", "kitchen", lang)
        assert s and not _BANNED.search(s)
    assert "06:30" in HS.describe_why_not(["light_held"], _facts(hold={"state": "held_until_morning", "until_text": "06:30"}), "Kitchen Light", "kitchen", "en")
```

- [ ] **Step 2: Run → fail.** 
- [ ] **Step 3: Implement.** Router: `GET /api/light-holds` → `{"holds": light_hold.list_active()}`; `POST /api/light-holds/{entity_id}/release` → `{"released": light_hold.release(entity_id, by=user["username"])}`. `gather_facts`: `hold = light_hold.get(entity_id)` → include `state`, `since`, `until`, `until_text` (`HH:MM` local). Speech lines: en `"You turned {label} off yourself, so I'm holding it off until the {room} empties. Say 'release it' or tap Release on the light."` / until-morning `"…holding it off until {until_text}."`; he `"כיבית את {label} בעצמך, אז אני משאיר אותו כבוי עד ש{room} יתרוקן. אפשר להגיד ״שחרר״ או ללחוץ שחרור על האור."` / `"…עד {until_text}."` (`describe_why_not` picks the variant by `facts["hold"]["state"]`).
- [ ] **Step 4: Run → pass.** 
- [ ] **Step 5: Commit** `feat(light-hold): API + why-not verdict + Hebrew/English phrasing`

---

## Phase 2 — Catalog truth

### Task 10: Computed support flags, `sun` condition, bidirectional drift

**Files:**
- Modify: `services/automation_catalog.py` (whole support model), `services/local_automation_actions.py` (`sun` condition via `sun.sun` state in `ha_subscriber.state_cache`: `below_horizon`/`above_horizon`), `services/ha_automations.py` (`_condition_to_ha` `sun` → `{"condition":"sun","after":"sunset"}` / `{"before":"sunrise"}`; introspectable)
- Test: `tests/test_automation_catalog_drift.py`

**Interfaces:**
- Produces: `automation_catalog.get_catalog()` unchanged shape; `ziggy_supported` now computed; new helpers `_introspect_condition_types() -> set[str]`, `_introspect_action_types() -> set[str]`; `detect_drift()` returns the two old keys plus `converter_supports_but_catalog_declines`, `catalog_entry_missing_for_converter`; `sun` condition shape `{"type":"sun","after":"sunset"|"sunrise"?, "before": …?}`.

- [ ] **Step 1: Tests**

```python
# tests/test_automation_catalog_drift.py
from services import automation_catalog as C
from services import ha_automations as HA
from services import local_automation_actions as laa

def _by_id(kind): return {c["id"]: c for c in C.get_catalog()["ha_capabilities"][kind]}

def test_no_drift_in_any_direction():
    d = C.detect_drift()
    assert d == {k: [] for k in d}, d

def test_support_is_computed_from_converters():
    t = _by_id("triggers")
    for tid in ("state", "numeric_state", "time", "sunrise", "sunset", "zone", "time_pattern", "controller"):
        assert t[tid]["ziggy_supported"] is True, tid
    for tid in ("template", "calendar", "tag", "device", "event"):
        assert t[tid]["ziggy_supported"] is False, tid
    assert t["webhook"]["ziggy_supported"] is False and "policy" in t["webhook"]["ziggy_note"].lower()
    c = _by_id("conditions")
    for cid in ("state", "numeric_state", "time_window", "sun", "mode", "presence"):
        assert c[cid]["ziggy_supported"] is True, cid
    a = _by_id("actions")
    for aid in ("call_service", "delay", "notify", "wait_for_state", "set_mode", "turn_off_all_lights", "ir_command"):
        assert a[aid]["ziggy_supported"] is True, aid

def test_gaps_only_list_true_gaps():
    ids = {(g["kind"], g["id"]) for g in C.get_gaps()}
    assert ("trigger", "zone") not in ids and ("condition", "sun") not in ids
    assert ("trigger", "calendar") in ids

def test_sun_condition_both_evaluators(monkeypatch):
    assert HA._condition_to_ha({"type": "sun", "after": "sunset"}) == {"condition": "sun", "after": "sunset"}
    monkeypatch.setattr("services.ha_subscriber.state_cache", {"sun.sun": {"state": "below_horizon"}})
    ok, _ = laa._eval_single_condition({"type": "sun", "after": "sunset"})
    assert ok
    ok, _ = laa._eval_single_condition({"type": "sun", "before": "sunset"})
    assert not ok
```

- [ ] **Step 2: Run → fail.** 
- [ ] **Step 3: Implement.** Catalog: rename the `time_window` id? No — keep `time_window` as the catalog id and map it to converter type `time` in the introspection (`_ALIAS = {"time_window": "time"}`). Introspect conditions from `_eval_single_condition` source (`ctype == "x"`) ∩ `_condition_to_ha` source (`c.get("type") == "x"` plus implicit `state`/`numeric_state` from the entity branch → add them explicitly to the set). Introspect actions from `_action_to_ha` (`kind == "x"`) ∪ executor step names constant (`laa.SUPPORTED_STEP_TYPES` — expose the existing list under that name if it has another). `webhook`: computed True by converter, but a `policy_declined: True` field on the entry forces `ziggy_supported=False` with the note "Converter exists; declined pending security review of inbound webhooks." — the drift check treats `policy_declined` as an explicit, allowed decline. Add entries: `controller` trigger (shape `{"controller_id": "<ieee>", "action": "single|double|hold|…"}`; example "When the Aqara switch's left button is pressed"), `mode` condition, `sun` condition (now supported), `set_mode` and `turn_off_all_lights` actions, `manual` trigger (ziggy-native, `ziggy_via: "app Run button"`), and `ziggy_native.triggers` = `person_arrives, person_leaves, all_persons_left, zone_entered, zone_left` with descriptions. Update `_count_supported`. `sun` evaluator: `state = state_cache.get("sun.sun",{}).get("state")`; `after sunset` ⇔ `below_horizon`; `before sunset`/`after sunrise` ⇔ `above_horizon`; unknown state → `(False, "sun state unknown")`.
- [ ] **Step 4: Run** new test + `tests/test_capability_catalog_shipped.py` → pass.
- [ ] **Step 5: Commit** `feat(catalog): support flags derived from the converters; drift is bidirectional; sun condition`

---

## Phase 3 — Recipes and the designer

### Task 11: `services/recipes/` package + Smart Room mode conditions and `respect_hold`

**Files:**
- Create: `services/recipes/__init__.py`, `services/recipes/smart_room.py`, `services/recipes/motion_light.py`, `services/recipes/welcome_home.py`, `services/recipes/leave_home.py`
- Modify: `services/smart_room_recipe.py:247-400` (drop `kv_state`/`voice_intents`; Day/Night conditions += mode sleep/movie false; Off += mode cleaning false; `_turn_on_actions` sets `respect_hold: True`), `tests/test_smart_room_recipe.py` (update `test_full_recipe_shape` expectations; leave the pre-existing failing `test_needs_occupancy_when_none` as is)
- Test: `tests/test_recipes.py`

**Interfaces:**
- Produces: `services.recipes.REGISTRY: dict[str, Callable]` mapping `smart_room|motion_light|welcome_home|leave_home` → `build(params: dict, *, home: dict, language: str) -> dict` returning `{"ok": bool, "automations": [...], "occupancy_sensors": [], "error"?: str, "decline"?: str}` where each automation is the executor's custom shape with a stable `alias`.
  - `motion_light`: params `room`, `lights?`, `sensors?`, `brightness_pct=100`, `linger_minutes=5`, `night_only=False`; one automation per room: trigger `state` on sensors `on`; conditions `[mode sleep false, mode movie false] (+ time window if night_only)`; actions `[turn_on lights (respect_hold, brightness), wait_for_state sensors off (timeout 4 h, on_timeout continue), delay linger, turn_off lights]`; `mode: restart`; alias `Ziggy Motion Light <Room>`.
  - `welcome_home`: params `lights` (required), `only_after_dark=True`; trigger `{"type":"person_arrives","person":"*"}`; conditions `[sun after sunset]` when after-dark; actions turn_on (respect_hold); alias `Ziggy Welcome Home`.
  - `leave_home`: params `ac=True`, `notify=True`, `quiet_minutes=30`; server-side port of `leaveHome.jsx` payload: motion ids from home (all rooms' motion+presence), trigger `state off for quiet_minutes` on the list, conditions each sensor off for quiet + `presence all_away` + `mode guest is False`; actions `turn_off_all_lights`, climate off / IR off when present, notify; alias `Leave Home`, `auto_id` fixed `ziggy_leave_home`.

- [ ] **Step 1: Tests**

```python
# tests/test_recipes.py
import pytest
from services import recipes as R

def _home():
    return {"rooms": [
        {"id": "kitchen", "entities": {"light": [{"entity_id": "light.k"}], "motion": [{"entity_id": "binary_sensor.km"}], "presence": []}, "occupancy_sensor": None},
        {"id": "living_room", "entities": {"light": [{"entity_id": "light.l"}], "motion": [{"entity_id": "binary_sensor.lm"}], "presence": []}, "occupancy_sensor": None},
    ], "persons": [{"name": "Youval"}]}

def _conds(a): return [(c.get("type"), c.get("mode"), c.get("is")) for c in a["conditions"]]

def test_registry_names():
    assert set(R.REGISTRY) == {"smart_room", "motion_light", "welcome_home", "leave_home"}

def test_motion_light_shape():
    out = R.REGISTRY["motion_light"]({"room": "kitchen", "linger_minutes": 5}, home=_home(), language="en")
    assert out["ok"]
    a = out["automations"][0]
    assert a["alias"] == "Ziggy Motion Light Kitchen" and a["mode"] == "restart"
    assert a["trigger"] == {"type": "state", "entity_id": ["binary_sensor.km"], "state": "on"}
    assert ("mode", "sleep", False) in _conds(a) and ("mode", "movie", False) in _conds(a)
    kinds = [s["type"] for s in a["actions"]]
    assert kinds == ["call_service", "wait_for_state", "delay", "call_service"]
    assert a["actions"][0]["respect_hold"] is True and a["actions"][0]["service"] == "light.turn_on"
    assert a["actions"][2]["seconds"] == 300

def test_welcome_home_after_dark():
    out = R.REGISTRY["welcome_home"]({"lights": ["light.l"]}, home=_home(), language="he")
    a = out["automations"][0]
    assert a["trigger"] == {"type": "person_arrives", "person": "*"}
    assert {"type": "sun", "after": "sunset"} in a["conditions"]
    assert a["actions"][0]["respect_hold"] is True

def test_leave_home_guard_and_guest():
    out = R.REGISTRY["leave_home"]({"quiet_minutes": 30}, home=_home(), language="en")
    a = out["automations"][0]
    assert a["auto_id"] == "ziggy_leave_home"
    assert a["trigger"]["type"] == "state" and a["trigger"]["for_minutes"] == 30
    assert ("mode", "guest", False) in _conds(a)
    assert {"type": "presence", "value": "all_away"} in a["conditions"]
    assert a["actions"][0] == {"type": "turn_off_all_lights"}

def test_smart_room_wrapper_carries_mode_conditions(monkeypatch):
    from services import smart_room_recipe as sr
    monkeypatch.setattr(sr, "_light_color_caps", lambda: {"light.l": ["brightness"]})
    out = R.REGISTRY["smart_room"]({"room": "living_room", "occupancy_entity": "binary_sensor.lm"}, home=_home(), language="en")
    day, night, off = out["automations"]
    assert ("mode", "sleep", False) in _conds(day) and ("mode", "movie", False) in _conds(night)
    assert ("mode", "cleaning", False) in _conds(off)
    assert all(s.get("respect_hold") for s in day["actions"])

def test_unknown_room_is_an_honest_error():
    out = R.REGISTRY["motion_light"]({"room": "attic"}, home=_home(), language="en")
    assert not out["ok"] and out["error"]
```

Update in `tests/test_smart_room_recipe.py::test_full_recipe_shape`: conditions now `[time…, mode sleep false, mode movie false]`, `a["kv_state"] == []`, `a["voice_intents"] == []`, `off["conditions"]` contains cleaning false.

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement.** Smart Room wrapper calls `smart_room_recipe.build_smart_room_bundle(room, occupancy_entity=…, home=home, language=…, options=…)` and returns its automations (or `needs_occupancy` → `{"ok": False, "error": "needs_occupancy", "room": …}`). Note the Smart Room Off rule's `ha_native_body` — add the compiled cleaning-mode condition into the native body's `conditions` when `modes_mqtt.entity_id("cleaning")` resolves; otherwise leave the native body as is and rely on the Ziggy-side condition (the Off rule's actions are turn_offs executed natively by HA, so the Ziggy condition only gates deferred steps — document this limit in the module docstring; the mirror announce at boot makes the resolved case the normal one).
- [ ] **Step 4: Run** `tests/test_recipes.py tests/test_smart_room_recipe.py` → pass except the pre-existing `test_needs_occupancy_when_none`.
- [ ] **Step 5: Commit** `feat(recipes): recipe registry; Smart Room honours modes and holds`

---

### Task 12: `services/bundle_lint.py` + designer prompt/schema

**Files:**
- Create: `services/bundle_lint.py`
- Modify: `services/orchestra_designer.py` (`_SYSTEM_PROMPT_TMPL` schema + rules; `_validate_bundle` accepts `recipes`, rejects `kv_state`/`voice_intents` by dropping them with a note; run `lint` after `_strip_hallucinated_entities`; `_strip_hallucinated_entities` also validates blueprint inputs whose key ends with `_entity`/`_target` as real entity ids), `services/home_context.py` (ensure `controllers` carry `room` and `actions[].subtype`; verify — already `_controllers_compact`)
- Test: `tests/test_bundle_lint.py`, extend `tests/test_orchestra_designer*.py` if exists else add cases to `tests/test_bundle_lint.py`

**Interfaces:**
- Produces: `bundle_lint.lint(bundle: dict, home: dict, *, allowed_rooms: set[str]|None) -> tuple[dict, list[dict]]`; notes are `{"what": str, "why": str}`; `allowed_rooms` = rooms named in the outcome (`room_alias_bank.resolve_room` over words) ∪ trigger rooms.

- [ ] **Step 1: Tests**

```python
# tests/test_bundle_lint.py
from services import bundle_lint as L

HOME = {"rooms": [
    {"id": "kitchen", "entities": {"light": [{"entity_id": "light.k"}], "motion": [{"entity_id": "binary_sensor.km"}]}},
    {"id": "entry",   "entities": {"light": [{"entity_id": "light.e"}], "motion": []}},
]}

def _b(**auto):
    base = {"name": "x", "source": "custom", "trigger": {"type": "state", "entity_id": "binary_sensor.km", "state": "on"},
            "conditions": [], "actions": [{"type": "call_service", "entity_id": "light.k", "service": "turn_on"}], "mode": "single"}
    base.update(auto)
    return {"name": "B", "artifacts": {"automations": [base]}}

def test_tautology_dropped():
    b = _b(conditions=[{"entity_id": "binary_sensor.km", "operator": "is", "value": "on"}])
    out, notes = L.lint(b, HOME)
    assert out["artifacts"]["automations"][0]["conditions"] == [] and notes == []

def test_out_of_scope_room_action_dropped_with_note():
    b = _b(actions=[{"type": "call_service", "entity_id": "light.k", "service": "turn_on"},
                    {"type": "call_service", "entity_id": "light.e", "service": "turn_off"}])
    out, notes = L.lint(b, HOME, allowed_rooms={"kitchen"})
    assert [a["entity_id"] for a in out["artifacts"]["automations"][0]["actions"]] == ["light.k"]
    assert notes and "entry" in notes[0]["why"]

def test_automation_left_with_no_actions_is_dropped():
    b = _b(actions=[{"type": "call_service", "entity_id": "light.e", "service": "turn_off"}])
    out, notes = L.lint(b, HOME, allowed_rooms={"kitchen"})
    assert out["artifacts"]["automations"] == [] and len(notes) == 2

def test_notify_only_automation_dropped():
    b = _b(actions=[{"type": "notify", "message": "hi"}])
    out, notes = L.lint(b, HOME)
    assert out["artifacts"]["automations"] == [] and "notification" in notes[0]["why"]

def test_blueprint_uuid_input_dropped():
    b = {"name": "B", "artifacts": {"automations": [{"name": "w", "source": "blueprint",
         "blueprint": {"id": "welcome_home", "inputs": {"person_entity": "fb074d1b-f42f-4e40-a222-ae402a2c963b", "light_target": "light.k"}}}]}}
    out, notes = L.lint(b, HOME)
    assert out["artifacts"]["automations"] == [] and notes

def test_legacy_kinds_stripped():
    b = {"name": "B", "artifacts": {"automations": [], "kv_state": [{"key": "x"}], "voice_intents": [{"phrase": "p"}]}}
    out, notes = L.lint(b, HOME)
    assert "kv_state" not in out["artifacts"] and "voice_intents" not in out["artifacts"]
```

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** lint; rewrite the designer prompt: schema per spec §9.1, rules (prefer recipes; fixed modes; buttons via `home_context.controllers`; scope; no tautology; `left_out`), catalog gaps text unchanged; `design_bundle` computes `allowed_rooms` from the outcome text (tokens → `resolve_room`, plus every room mentioned by its Hebrew name — `core.agent.directory.room_he` map inverse) and calls `lint`; merges lint notes into `bundle["left_out"]`; a bundle with no recipes/automations left → decline with the joined notes.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** `feat(designer): recipes-first schema, fixed modes, bundle lint, honest left-outs`

---

### Task 13: Executor recipes phase + honest preview/apply summaries

**Files:**
- Modify: `services/bundle_executor.py` (phase 0 `recipes` → `REGISTRY[name](params, home=load_home_context(lang), language=lang)` → each automation saved with `save_automation(data, auto_id=_slug(alias) or auto_id)`; manifest rows `{"kind":"automation","from":"recipe:<name>",…}`), `core/handlers/automation_handler.py` (`handle_design_automation_set`: summary from `recipes` + `automations` + `occupancy_sensors` only; append `left_out` as "Left out: …" / "הושאר בחוץ: …"; `handle_apply_automation_bundle` unchanged), `backend/routers/automation_router.py` (nothing)
- Test: `tests/test_bundle_executor_recipes.py`

- [ ] **Step 1: Tests**

```python
# tests/test_bundle_executor_recipes.py
import asyncio, pytest
from services import bundle_executor as BE
from services import local_automation_actions as laa

@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "s.json"))
    monkeypatch.setattr("services.home_context.load_home_context", lambda lang="en": {"rooms": []})

def test_recipe_artifacts_are_built_and_saved(monkeypatch):
    saved = []
    monkeypatch.setattr(BE, "save_automation", lambda data, auto_id=None: saved.append((auto_id, data["name"])) or {"ok": True, "id": auto_id or "x"})
    monkeypatch.setitem(BE_registry(), "motion_light", lambda params, *, home, language: {"ok": True, "automations": [
        {"name": "Kitchen motion light", "alias": "Ziggy Motion Light Kitchen", "trigger": {"type": "state"}, "actions": [{"type": "notify", "message": "m"}], "conditions": [], "mode": "restart"}]})
    res = BE.execute_bundle({"bundle_id": "b1", "artifacts": {"recipes": [{"recipe": "motion_light", "room": "kitchen"}]}})
    assert res["ok"] and saved == [("ziggy_motion_light_kitchen", "Kitchen motion light")]
    assert res["created"][0]["from"] == "recipe:motion_light"

def test_recipe_error_is_one_row_and_others_apply(monkeypatch):
    monkeypatch.setattr(BE, "save_automation", lambda data, auto_id=None: {"ok": True, "id": "c"})
    monkeypatch.setitem(BE_registry(), "welcome_home", lambda params, *, home, language: {"ok": False, "error": "no lights"})
    res = BE.execute_bundle({"bundle_id": "b2", "artifacts": {
        "recipes": [{"recipe": "welcome_home"}],
        "automations": [{"name": "c", "source": "custom", "trigger": {"type": "time", "time": "07:00"}, "actions": [{"type": "notify", "message": "x"}]}]}})
    assert not res["ok"] and len(res["errors"]) == 1 and len(res["created"]) == 1

def BE_registry():
    from services import recipes
    return recipes.REGISTRY
```

And for the handler, in the same file:

```python
def test_preview_summary_counts_only_buildable(monkeypatch):
    from core.handlers import automation_handler as AH
    monkeypatch.setattr("services.orchestra_designer.design_bundle", lambda outcome, language=None: {"ok": True, "bundle": {
        "bundle_id": "b", "name": "N", "rationale": "R", "language": "en", "decline": None,
        "artifacts": {"recipes": [{"recipe": "smart_room", "room": "kitchen"}], "automations": []},
        "left_out": [{"what": "button", "why": "no controller paired"}]}})
    res = asyncio.run(AH.handle_design_automation_set({"outcome": "make the kitchen smart"}))
    assert "1 recipe" in res["message"] and "voice" not in res["message"] and "Left out" in res["message"]
    assert res["data"]["kind"] == "automation_bundle_preview"
```

- [ ] **Step 2: Run → fail.** 
- [ ] **Step 3: Implement.** 
- [ ] **Step 4: Run** + `tests/test_bundle_executor_alias.py tests/test_bundle_manager.py` → pass.
- [ ] **Step 5: Commit** `feat(executor): recipe artifacts; preview and apply never overstate`

---

## Phase 4 — Agent

### Task 14: Tools, context, persona

**Files:**
- Modify: `core/agent/tools.py` (schemas `set_mode`, `release_light_hold`; executors; dispatch; `_REHEARSAL_BLOCKED` entries), `core/agent/context.py` (`modes_text()`, `holds_text(directory)`; `build_context` keys `modes_text`, `holds_text`; `house_mode` kept for the legacy line), `core/agent/persona.py` (`_HOW_YOU_ACT` lines: modes; buttons and arrival/departure → `design_automation`; a held light; prompt sections `MODES:` and `HELD LIGHTS:`)
- Test: extend `tests/test_agent_v2.py`, `tests/test_agent_persona.py`

- [ ] **Step 1: Tests**

```python
# append to tests/test_agent_v2.py
def test_new_tools_registered():
    names = {s["function"]["name"] for s in t.TOOL_SCHEMAS}
    assert {"set_mode", "release_light_hold"} <= names

def test_set_mode_tool_executes(monkeypatch, tmp_path):
    from services import local_automation_actions as laa, modes as M
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "s.json"))
    for h in ("_publish_hook", "_broadcast_hook", "_side_effect_hook"):
        monkeypatch.setattr(M, h, lambda *a, **k: None)
    res = asyncio.run(t.execute_tool("set_mode", {"mode": "movie", "on": True, "hours": 2}, FAKE_DIR, lang="he"))
    assert res["ok"] and M.is_on("movie") and "סרט" in res["message"]
    res = asyncio.run(t.execute_tool("set_mode", {"mode": "party", "on": True}, FAKE_DIR, lang="en"))
    assert not res["ok"]

def test_release_hold_tool(monkeypatch, tmp_path):
    from services import local_automation_actions as laa, light_hold as LH
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "s.json"))
    monkeypatch.setattr(LH, "_room_and_occupancy", lambda e: ("k", None))
    monkeypatch.setattr(LH, "_broadcast_hook", lambda p: None)
    LH.on_manual_off("light.0xa4c13852e1286e50", now=1.0)
    res = asyncio.run(t.execute_tool("release_light_hold", {"entity_id": "light.0xa4c13852e1286e50"}, FAKE_DIR, lang="en"))
    assert res["ok"] and not LH.is_held("light.0xa4c13852e1286e50")

# append to tests/test_agent_persona.py
def test_prompt_carries_modes_and_holds_sections():
    from core.agent.persona import build_system_prompt
    p = build_system_prompt({"lang": "en", "channel": "chat", "modes_text": "movie ON until 23:40", "holds_text": "Kitchen Light held off"})
    assert "MODES" in p and "movie ON until 23:40" in p and "HELD LIGHTS" in p
    assert "set_mode" in p and "design_automation" in p
```

- [ ] **Step 2: Run → fail.** 
- [ ] **Step 3: Implement.** Tool messages: he `"הפעלתי מצב {label_he}"` / `"כיביתי מצב {label_he}"` (+ `" עד {HH:MM}"` when timed); en `"{Label} mode on until 23:40."`. Context: `modes_text` = `" · ".join(f"{id} {'ON' if on else 'off'}{' until HH:MM' if until}")`; `holds_text` = one line per active hold with the device's name from the directory. Persona additions (EN, mirrored in the same block since `_HOW_YOU_ACT` is language-neutral): `"- Put the house in a mode ('guest mode', 'movie mode for two hours', 'מצב אורחים', 'מצב שינה') → set_mode. Modes are: sleep, movie, cleaning, guest, vacation — never invent another.\n- A light that should have come on but is HELD (see HELD LIGHTS) was turned off by hand; say so and offer release_light_hold.\n- A wireless button / switch, or arriving/leaving home → design_automation (it knows buttons, arrivals and departures)."`
- [ ] **Step 4: Run → pass.** 
- [ ] **Step 5: Commit** `feat(agent): set_mode and release_light_hold; modes and holds in context and persona`

---

### Task 15: Capability catalog entries

**Files:**
- Modify: `docs/capability-catalog.json`, `services/data/capability-catalog.json` (same content), `docs/CAPABILITY_CATALOG.md` is generated — leave it.
- Test: `tests/test_capability_catalog_shipped.py` (existing) + one new assertion file `tests/test_capability_catalog_new_entries.py`

- [ ] **Step 1: Test**

```python
# tests/test_capability_catalog_new_entries.py
import json
from pathlib import Path
def test_new_capabilities_present_in_both_copies():
    for p in ("docs/capability-catalog.json", "services/data/capability-catalog.json"):
        ids = {c["id"] for c in json.loads(Path(p).read_text())["capabilities"]}
        assert {"home-modes", "light-hold", "buttons-from-chat"} <= ids
```

- [ ] **Step 2–3:** Add three entries (status `canary-only`, layer `Automations`, audience `user-facing`, pitch/what_it_does in the catalog's plain voice, surfaces listing the new files, `known_gaps` honest: modes are home-wide; hold works for lights only; buttons need a paired Zigbee controller). Append in both JSON files identically; keep `counts` consistent (bump `canary-only` by 3 and totals).
- [ ] **Step 4: Run** both catalog tests → pass.
- [ ] **Step 5: Commit** `docs(catalog): home modes, light hold, buttons-from-chat`

---

## Phase 5 — App

### Task 16: API client, store, ModeChips on Home + Hub

**Files:**
- Create: `frontend/src/components/home/ModeChips.jsx`
- Modify: `frontend/src/lib/api.js` (`getModes`, `setModeState(id, on, hours)`, `getLightHolds`, `releaseLightHold(entityId)`), `frontend/src/stores/deviceStore.js` (`modes: []`, `lightHolds: {}`, `fetchModes`, `applyModeChanged(msg)`, `fetchLightHolds`, `applyLightHoldChanged(msg)`), `frontend/src/App.jsx` or wherever `useWsMessages` consumers dispatch `entity_removed` (route `mode_changed`/`light_hold_changed` to the store), `frontend/src/pages/Dashboard.jsx` (row after the greeting block), `frontend/src/components/hub/sections.jsx` (`ModeSwitcherSection` renders `<ModeChips />`), `frontend/src/lib/i18n/en.js` + `he.js`

- [ ] **Step 1:** i18n keys: `modes.title` "Modes"/"מצבים"; `modes.sleep` "Sleep"/"שינה"; `modes.movie` "Movie"/"סרט"; `modes.cleaning` "Cleaning"/"ניקיון"; `modes.guest` "Guests"/"אורחים"; `modes.vacation` "Vacation"/"חופשה"; `modes.until` "until {t}"/"עד {t}"; `modes.pickDuration` "For how long?"/"לכמה זמן?"; `modes.hours1/2/3` "1 hour"/"שעה", "2 hours"/"שעתיים", "3 hours"/"3 שעות"; `modes.untilOff` "Until I turn it off"/"עד שאכבה"; `modes.effect.<id>` = the module's effect strings.
- [ ] **Step 2:** `ModeChips`: reads `useDeviceStore(s => s.modes)`; on mount `fetchModes()`; chip = `<button aria-pressed>` with label, filled when on, caption `until HH:MM`; tap on `movie`/`cleaning` when off opens a bottom `Modal` with the four durations; tap when on → off. Optimistic update, toast on failure (`useUIStore.addToast`). Uses existing `Modal` and Tailwind tokens (`var(--accent)`, `var(--line)`, `var(--ink)`), 40px min tap height, RTL-safe (`dir="auto"`, logical margins).
- [ ] **Step 3:** Dashboard: insert `<ModeChips />` directly under the greeting `<div>` (before the health banner). Hub: replace the button grid with `<ModeChips dense />`.
- [ ] **Step 4:** `cd frontend && npm run build` succeeds; `npx vitest run src/lib` passes.
- [ ] **Step 5: Commit** `feat(app): mode chips on Home and Hub`

---

### Task 17: Held pill on light tiles + Release

**Files:**
- Modify: `frontend/src/components/device/DeviceCard.jsx` (state line: when `lightHolds[entity_id]` → pill text `t('lightHold.held')`; add `data-held`), `frontend/src/pages/DeviceDetail.jsx` (a row: reason text + `Release` button → `releaseLightHold`), i18n (`lightHold.held` "Held"/"מוחזק", `lightHold.untilEmpty` "Held off until the room empties — you turned it off yourself."/"נשאר כבוי עד שהחדר יתרוקן — כיבית אותו בעצמך.", `lightHold.untilTime` "Held off until {t} — you turned it off twice tonight."/"נשאר כבוי עד {t} — כיבית אותו פעמיים הערב.", `lightHold.release` "Release"/"שחרור")

- [ ] Steps: implement; `npm run build`; commit `feat(app): held light pill and release`.

---

### Task 18: Wizard — `mode` condition, `set_mode` action

**Files:**
- Modify: `frontend/src/lib/automations/types.js` (`getConditionTypes` += `{value:'mode', label: t('automations.cond.modeType')}`; `getActionTypes` += `{value:'set_mode', label: t('automations.actionSetMode')}`; export `getModeOptions()` from the fixed list), `ConditionRow.jsx` (mode select + is on/off), `ActionRow.jsx` (mode select + on/off + optional hours), `frontend/src/lib/automations/summaries.js` (human summary for both), i18n.
- Test: `frontend/src/lib/__tests__/automationTypes.test.js` — asserts the vocabularies include `mode` and `set_mode`.
- [ ] Steps: test → implement → `npx vitest run` → build → commit `feat(app): mode condition and set_mode action in the builder`.

---

### Task 19: BundlePreviewCard — recipes, left-outs, no voice

**Files:**
- Modify: `frontend/src/components/automations/BundlePreviewCard.jsx` (render `artifacts.recipes` rows with `t('automations.proCard.recipe.<name>')` one-liners; render `bundle.left_out` as a muted "Left out" list; remove the voice-intents section and its count from the header), `frontend/src/pages/AIChat.jsx` (no change expected; verify the card still mounts), i18n (`proCard.recipe.smart_room` "Smart Room — lights follow who's in the room"/"חדר חכם — האור עוקב אחרי מי שבחדר", `…motion_light` "Motion light"/"אור לפי תנועה", `…welcome_home` "Lights on when you arrive"/"אור כשמגיעים הביתה", `…leave_home` "Everything off when everyone leaves"/"הכל נכבה כשכולם יוצאים", `proCard.leftOut` "Left out"/"הושאר בחוץ").
- [ ] Steps: implement → build → commit `feat(app): preview card shows recipes and left-outs, drops voice`.

---

### Task 20: Full verification

- [ ] Backend: full `pytest` — failures ⊆ the baseline 22 list.
- [ ] Frontend: `npm run build` + `npx vitest run`.
- [ ] `graphify update .` is hook-driven on commit; no action.
- [ ] `node .gitnexus/run.cjs detect-changes --scope all --repo .` if the runner exists; note the output in the final report.
- [ ] Commit any fixups.

---

## Phase 6 — Canary and acceptance

### Task 21: Land on `origin/main`, converge Canary, sweep, rebuild via chat

- [ ] Merge `worktree-designer-closed-loop` into `main` (fast-forward local `main` to `origin/main` first), push `origin main`.
- [ ] Wait for Canary (`ziggy-update.timer`, ~2–12 min); verify by fetching a code marker from the running container (`grep -l "light_hold" /app/services/*.py`), not the SHA.
- [ ] Check `/api/modes` and `/api/light-holds` answer over SSH → `docker exec` → `curl` with a session token is NOT available; use `python3 -c` inside the container calling the service modules directly.
- [ ] Sweep `bundle_e0f8dbf3604b` via `services.bundle_executor.delete_bundle("bundle_e0f8dbf3604b")` inside the container (this is the existing undo path; it removes the four automations, both flags, and the fused sensor).
- [ ] Report to the operator with the acceptance script (spec §14) — the chat rebuild and the walk test are theirs to run in their home.

---

## Self-review

- **Spec coverage:** §6 modes → T1–T5, T14, T16; §7 hold → T6–T9, T11, T17; §8 catalog → T10; §9 designer → T11–T13, T19; §10 agent → T14–T15; §11 app → T16–T19; §12 error handling folded into each module's steps; §13 tests are each task's Step 1; §14 → T21. `mode_service` facade → T4. Entity filter → T2. Settings example → T7.
- **Placeholders:** none; every step names files, shapes and assertions.
- **Type consistency:** `modes.set_mode(mode, on, *, by, hours=None, now=None)` used identically in T1, T3, T4, T14; `light_hold.on_manual_off/on_manual_on/on_engine_on/tick/release/is_held/get/list_active` consistent across T6–T9, T14; recipe builder signature `build(params, *, home, language)` in T11 and T13; `left_out` list of `{what, why}` in T12, T13, T19.
