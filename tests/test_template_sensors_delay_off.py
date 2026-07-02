"""Unit tests for delay_off_seconds plumbing in create_occupancy_sensor (Item 5).

HA HTTP is fully stubbed — no HA/network. We assert the flow body Ziggy submits
adapts to whether HA's form advertises the delay_off field, and that a rejection
falls back to a bare create rather than failing.
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


def _install_flow(ts, monkeypatch, *, has_delay_field, posts):
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


def test_delay_applied_when_field_present(ts, monkeypatch):
    posts = []
    _install_flow(ts, monkeypatch, has_delay_field=True, posts=posts)
    res = ts.create_occupancy_sensor("bedroom", ["binary_sensor.bed_motion"], delay_off_seconds=45)
    assert res["ok"] and res["delay_off_applied"] is True
    assert posts[-1]["delay_off"] == {"hours": 0, "minutes": 0, "seconds": 45}


def test_delay_skipped_when_field_absent(ts, monkeypatch):
    posts = []
    _install_flow(ts, monkeypatch, has_delay_field=False, posts=posts)
    res = ts.create_occupancy_sensor("bedroom", ["binary_sensor.bed_motion"], delay_off_seconds=45)
    assert res["ok"] and res["delay_off_applied"] is False
    assert "delay_off" not in posts[-1]


def test_zero_delay_never_advanced(ts, monkeypatch):
    posts = []
    _install_flow(ts, monkeypatch, has_delay_field=True, posts=posts)
    res = ts.create_occupancy_sensor("bedroom", ["binary_sensor.bed_motion"], delay_off_seconds=0)
    assert res["ok"] and res["delay_off_applied"] is False
    assert "delay_off" not in posts[-1]


def test_fallback_when_ha_rejects_delay(ts, monkeypatch):
    posts = []
    form = {"step_id": "binary_sensor",
            "data_schema": [{"name": "name"}, {"name": "state"},
                            {"name": "device_class"}, {"name": "delay_off"}]}
    monkeypatch.setattr(ts, "_start_template_flow",
                        lambda show_advanced=False: ("flow123", None, form))
    monkeypatch.setattr(ts, "_ha_delete", lambda path, timeout=10.0: 200)

    def fake_post(path, body, timeout=10.0):
        posts.append(body)
        # Reject the first (delay_off) submission; accept the bare retry.
        if "delay_off" in body:
            return 400, {"type": "form", "errors": {"base": "invalid"}}
        return 200, {"type": "create_entry", "result": {"entry_id": "entry_abc"}}
    monkeypatch.setattr(ts, "_ha_post", fake_post)

    res = ts.create_occupancy_sensor("bedroom", ["binary_sensor.bed_motion"], delay_off_seconds=30)
    assert res["ok"] is True
    assert res["delay_off_applied"] is False
    # First attempt had delay_off, retry did not.
    assert "delay_off" in posts[0] and "delay_off" not in posts[1]
