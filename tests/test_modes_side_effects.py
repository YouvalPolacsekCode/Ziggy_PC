"""Mode effects the engine enforces: guest holds 'everyone left'; vacation drives
the lived-in simulation."""
import asyncio

import pytest

from services import local_automation_actions as laa
from services import modes as M
from services import presence_side_effects as PSE


@pytest.fixture(autouse=True)
def _kv(tmp_path, monkeypatch):
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "s.json"))
    monkeypatch.setattr(laa, "STORE_FILE", str(tmp_path / "a.json"))
    for h in ("_publish_hook", "_broadcast_hook", "_side_effect_hook"):
        monkeypatch.setattr(M, h, lambda *a, **k: None)


def test_guest_mode_blocks_all_persons_left(monkeypatch):
    fired = []
    monkeypatch.setattr("core.automation_file.list_automations",
                        lambda: [{"id": "leave", "enabled": True, "trigger": {"type": "all_persons_left"}}])

    async def fake_exec(aid, *a, **k):
        fired.append(aid)

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
    monkeypatch.setattr("services.fake_occupancy_scheduler.start",
                        lambda **kw: calls.append(("start", kw["automation_id"], kw["duration_days"])) or {"ok": True})
    monkeypatch.setattr("services.fake_occupancy_scheduler.stop", lambda aid: calls.append(("stop", aid)) or True)
    monkeypatch.setattr("services.automation_templates._dimmable_lights_by_room",
                        lambda cap_map: [{"id": "living_room", "entity_id": "light.a"}])
    monkeypatch.setattr("services.automation_templates._first_tv_ir_device", lambda: None)
    monkeypatch.setattr("services.capability_matcher.detect_capabilities", lambda: {})
    M._apply_side_effect("vacation", True)
    M._apply_side_effect("vacation", False)
    assert calls == [("start", "ziggy_mode_vacation", 30), ("stop", "ziggy_mode_vacation")]


def test_vacation_without_dimmable_lights_is_a_noop(monkeypatch):
    calls = []
    monkeypatch.setattr("services.fake_occupancy_scheduler.start", lambda **kw: calls.append("start"))
    monkeypatch.setattr("services.automation_templates._dimmable_lights_by_room", lambda cap_map: [])
    monkeypatch.setattr("services.automation_templates._first_tv_ir_device", lambda: None)
    monkeypatch.setattr("services.capability_matcher.detect_capabilities", lambda: {})
    M._apply_side_effect("vacation", True)
    assert calls == []
