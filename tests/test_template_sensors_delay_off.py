"""Unit tests for delay_off_seconds plumbing in create_occupancy_sensor.

HA HTTP is fully stubbed — no HA/network. We assert the flow body Ziggy submits
adapts to whether HA's form advertises the delay_off field, and — since
2026-09-17 — that a hold the helper cannot provide is provided by Ziggy's own
engine instead of being silently dropped.

Why: Home Assistant 2026.6's template-helper form has NO delay_off (its only
advanced field is `availability`). Every door-less Smart Presence created since
July therefore lost its hold without anyone noticing, and the office lights went
off on a still person after one 90 s PIR timeout plus the rule's grace.
"""
import importlib

import pytest


@pytest.fixture
def ts(tmp_path, monkeypatch):
    laa = importlib.import_module("services.local_automation_actions")
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "state.json"))
    mod = importlib.import_module("services.template_sensors")
    # entity_id resolution needs no WS in tests.
    monkeypatch.setattr(mod, "_lookup_entry_entity_id", lambda entry_id: "binary_sensor.x_occupied")
    return mod


def _install_flow(ts, monkeypatch, *, has_delay_field, posts, aborted=None):
    """Stub the flow start + create POST. `posts` collects submitted bodies."""
    form = {"step_id": "binary_sensor",
            "data_schema": ([{"name": "name"}, {"name": "state"}, {"name": "device_class"}]
                            + ([{"name": "delay_off"}] if has_delay_field else []))}
    monkeypatch.setattr(ts, "_start_template_flow",
                        lambda show_advanced=False: ("flow123", None, form))

    def fake_post(path, body, timeout=10.0):
        posts.append(body)
        return 200, {"type": "create_entry", "result": {"entry_id": "entry_abc"}}
    monkeypatch.setattr(ts, "_ha_post", fake_post)
    monkeypatch.setattr(ts, "_ha_delete", lambda path, timeout=10.0: 200)
    if aborted is not None:
        monkeypatch.setattr(ts, "_abort_flow", lambda fid: aborted.append(fid))


def _install_engine(monkeypatch, enrolled: dict):
    from services import room_presence_engine as engine
    monkeypatch.setattr(engine, "enroll_room",
                        lambda rec, timeout=8.0: (enrolled.update(rec), {"ok": True, "occupied": False})[1])
    monkeypatch.setattr(engine, "lookup_mqtt_entity_id",
                        lambda uid, **kw: "binary_sensor.bedroom_occupied_ziggy")


def test_delay_applied_when_field_present(ts, monkeypatch):
    posts = []
    _install_flow(ts, monkeypatch, has_delay_field=True, posts=posts)
    res = ts.create_occupancy_sensor("bedroom", ["binary_sensor.bed_motion"], delay_off_seconds=45)
    assert res["ok"] and res["delay_off_applied"] is True
    assert posts[-1]["delay_off"] == {"hours": 0, "minutes": 0, "seconds": 45}


def test_field_absent_routes_hold_through_engine(ts, monkeypatch):
    """No delay_off on the form → abort the helper flow, enroll the engine with a
    door-less hold. The hold is REAL, not logged-and-forgotten."""
    posts, aborted, enrolled = [], [], {}
    _install_flow(ts, monkeypatch, has_delay_field=False, posts=posts, aborted=aborted)
    _install_engine(monkeypatch, enrolled)

    res = ts.create_occupancy_sensor("bedroom", ["binary_sensor.bed_motion"], delay_off_seconds=45)

    assert res["ok"] is True
    assert res["delay_off_applied"] is True
    assert res["mode"] == "door_aware"          # engine-backed record shape
    assert res["hold_only"] is True
    assert posts == []                          # never created the bare helper
    assert aborted == ["flow123"]               # and did not leak an open flow
    assert enrolled["doors"] == []
    assert enrolled["motions"] == ["binary_sensor.bed_motion"]
    assert enrolled["delay_off_seconds"] == 45


def test_omitted_delay_defaults_to_five_minutes_for_doorless_room(ts, monkeypatch):
    """The wizard/agent may leave the hold to Ziggy: a door-less room gets 300 s."""
    posts, aborted, enrolled = [], [], {}
    _install_flow(ts, monkeypatch, has_delay_field=False, posts=posts, aborted=aborted)
    _install_engine(monkeypatch, enrolled)
    res = ts.create_occupancy_sensor("bedroom", ["binary_sensor.bed_motion"])
    assert res["ok"] and res["hold_only"] is True
    assert enrolled["delay_off_seconds"] == 300


def test_omitted_delay_defaults_to_thirty_seconds_for_door_room(ts, monkeypatch):
    from services import room_presence_engine as engine
    monkeypatch.setattr(ts, "_classify_sources", lambda ents: (["binary_sensor.door"], ["binary_sensor.bed_motion"]))
    enrolled = {}
    _install_engine(monkeypatch, enrolled)
    res = ts.create_occupancy_sensor("bathroom", ["binary_sensor.door", "binary_sensor.bed_motion"])
    assert res["ok"] and res["hold_only"] is False
    assert enrolled["delay_off_seconds"] == 30


def test_zero_delay_never_advanced(ts, monkeypatch):
    posts = []
    _install_flow(ts, monkeypatch, has_delay_field=True, posts=posts)
    res = ts.create_occupancy_sensor("bedroom", ["binary_sensor.bed_motion"], delay_off_seconds=0)
    assert res["ok"] and res["delay_off_applied"] is False
    assert "delay_off" not in posts[-1]


def test_fallback_when_ha_rejects_delay(ts, monkeypatch):
    """Form advertises delay_off but HA rejects it → same answer: the engine."""
    posts, enrolled = [], {}
    form = {"step_id": "binary_sensor",
            "data_schema": [{"name": "name"}, {"name": "state"},
                            {"name": "device_class"}, {"name": "delay_off"}]}
    monkeypatch.setattr(ts, "_start_template_flow",
                        lambda show_advanced=False: ("flow123", None, form))
    monkeypatch.setattr(ts, "_ha_delete", lambda path, timeout=10.0: 200)
    monkeypatch.setattr(ts, "_abort_flow", lambda fid: None)
    _install_engine(monkeypatch, enrolled)

    def fake_post(path, body, timeout=10.0):
        posts.append(body)
        return 400, {"type": "form", "errors": {"base": "invalid"}}
    monkeypatch.setattr(ts, "_ha_post", fake_post)

    res = ts.create_occupancy_sensor("bedroom", ["binary_sensor.bed_motion"], delay_off_seconds=30)
    assert res["ok"] is True
    assert res["delay_off_applied"] is True
    assert res["hold_only"] is True
    assert len(posts) == 1 and "delay_off" in posts[0]
    assert enrolled["delay_off_seconds"] == 30
