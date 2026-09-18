"""services/light_hold — the manual-off memory, every transition of the agreed rule."""
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
    monkeypatch.setattr(LH, "_occupancy_off_since", lambda occ: None)   # room occupied


def test_manual_off_holds():
    rec = LH.on_manual_off(LIGHT, now=T0)
    assert rec["state"] == "held" and rec["strikes"] == 1 and LH.is_held(LIGHT)
    active = LH.list_active()
    assert active[0]["entity_id"] == LIGHT and active[0]["room"] == "kitchen"


def test_manual_on_clears_everything():
    LH.on_manual_off(LIGHT, now=T0)
    LH.on_manual_on(LIGHT, now=T0 + 60)
    assert not LH.is_held(LIGHT) and LH.get(LIGHT) is None


def test_room_empty_thirty_minutes_releases(monkeypatch):
    LH.on_manual_off(LIGHT, now=T0)
    monkeypatch.setattr(LH, "_occupancy_off_since", lambda occ: T0 + 100)
    assert LH.tick(now=T0 + 100 + 29 * 60) == []
    assert LH.tick(now=T0 + 100 + 31 * 60) == [LIGHT]
    assert not LH.is_held(LIGHT)
    assert LH.get(LIGHT)["last_release"] == "empty"      # memory kept for strike 2


def test_second_strike_holds_until_morning(monkeypatch):
    LH.on_manual_off(LIGHT, now=T0)
    monkeypatch.setattr(LH, "_occupancy_off_since", lambda occ: T0)
    LH.tick(now=T0 + 31 * 60)                  # released by empty
    monkeypatch.setattr(LH, "_occupancy_off_since", lambda occ: None)
    LH.on_engine_on(LIGHT, now=T0 + 40 * 60)   # motion relit it
    rec = LH.on_manual_off(LIGHT, now=T0 + 41 * 60)
    assert rec["state"] == "held_until_morning" and rec["strikes"] == 2
    assert rec["until"] == pytest.approx(T0 + 41 * 60 + 8 * 3600)
    assert LH.is_held(LIGHT, now=T0 + 42 * 60)
    # room emptying does NOT release a morning hold
    monkeypatch.setattr(LH, "_occupancy_off_since", lambda occ: T0 + 42 * 60)
    assert LH.tick(now=T0 + 42 * 60 + 60 * 60) == []
    assert LH.tick(now=T0 + 41 * 60 + 8 * 3600 + 1) == [LIGHT]
    assert LH.get(LIGHT) is None


def test_manual_on_between_resets_strikes(monkeypatch):
    LH.on_manual_off(LIGHT, now=T0)
    monkeypatch.setattr(LH, "_occupancy_off_since", lambda occ: T0)
    LH.tick(now=T0 + 31 * 60)
    LH.on_manual_on(LIGHT, now=T0 + 35 * 60)   # user turned it on themselves
    LH.on_engine_on(LIGHT, now=T0 + 36 * 60)
    assert LH.on_manual_off(LIGHT, now=T0 + 37 * 60)["strikes"] == 1


def test_engine_off_and_engine_on_without_history_do_nothing():
    LH.on_state_change(LIGHT, "on", "off", engine_initiated=True, now=T0)
    assert LH.get(LIGHT) is None
    LH.on_engine_on(LIGHT, now=T0)
    assert LH.get(LIGHT) is None


def test_no_room_falls_back_to_time_only(monkeypatch):
    monkeypatch.setattr(LH, "_room_and_occupancy", lambda eid: (None, None))
    LH.on_manual_off(LIGHT, now=T0)
    assert LH.tick(now=T0 + 29 * 60) == []
    assert LH.tick(now=T0 + 31 * 60) == [LIGHT]


def test_explicit_release():
    LH.on_manual_off(LIGHT, now=T0)
    assert LH.release(LIGHT, by="youval", now=T0 + 5) is True
    assert not LH.is_held(LIGHT) and LH.get(LIGHT) is None
    assert LH.release(LIGHT, by="youval") is False


def test_disabled_setting_never_holds(monkeypatch):
    monkeypatch.setattr(LH, "settings", lambda: {"enabled": False, "empty_minutes": 30, "morning": "06:30"})
    assert LH.on_manual_off(LIGHT, now=T0) == {} and not LH.is_held(LIGHT)


def test_state_change_router_maps_transitions():
    LH.on_state_change("light.a", "on", "off", engine_initiated=False, now=T0)
    assert LH.is_held("light.a")
    LH.on_state_change("light.a", "off", "on", engine_initiated=False, now=T0 + 1)
    assert not LH.is_held("light.a")
    LH.on_state_change("switch.a", "on", "off", engine_initiated=False, now=T0)
    assert LH.get("switch.a") is None


def test_hold_events_broadcast(monkeypatch):
    seen = []
    monkeypatch.setattr(LH, "_broadcast_hook", lambda p: seen.append((p["entity_id"], p["state"])))
    LH.on_manual_off(LIGHT, now=T0)
    LH.release(LIGHT, by="y")
    assert seen == [(LIGHT, "held"), (LIGHT, None)]
