"""Unit tests for occupancy-sensor KV reconciliation (Item 4).

HA's config_entries fetch is stubbed so no HA/network is required.
"""
import importlib

import pytest


@pytest.fixture
def env(tmp_path, monkeypatch):
    laa = importlib.import_module("services.local_automation_actions")
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "state.json"))
    rec = importlib.import_module("services.ha_reconciler")
    # Reset the throttle between tests.
    monkeypatch.setattr(rec, "_last_reconcile_ts", 0.0)
    return laa, rec


def _seed(laa):
    from services.template_sensors import _KV_NAMESPACE
    laa.set_local_state(_KV_NAMESPACE, "bedroom", {
        "entry_id": "live1", "entity_id": "binary_sensor.bedroom_occupied", "name": "Bedroom"})
    laa.set_local_state(_KV_NAMESPACE, "test_bedroom", {
        "entry_id": "dead1", "entity_id": "binary_sensor.test_bedroom_occupied", "name": "Test"})


def test_prunes_orphans_keeps_live(env, monkeypatch):
    laa, rec = env
    _seed(laa)
    # Only "live1" exists in HA → "dead1" (test_bedroom) is orphaned.
    monkeypatch.setattr(rec, "_live_config_entry_ids", lambda timeout=4.0: {"live1", "other"})

    res = rec.reconcile_occupancy_sensors()
    assert res["ok"] is True
    assert res["checked"] == 2
    assert [p["room"] for p in res["pruned"]] == ["test_bedroom"]

    from services.template_sensors import _KV_NAMESPACE
    assert laa.get_local_state(_KV_NAMESPACE, "test_bedroom") is None
    assert laa.get_local_state(_KV_NAMESPACE, "bedroom") is not None


def test_ha_unreachable_prunes_nothing(env, monkeypatch):
    laa, rec = env
    _seed(laa)
    monkeypatch.setattr(rec, "_live_config_entry_ids", lambda timeout=4.0: None)

    res = rec.reconcile_occupancy_sensors()
    assert res["ok"] is False
    assert res["reason"] == "ha_unreachable"
    assert res["pruned"] == []

    from services.template_sensors import _KV_NAMESPACE
    # Nothing pruned — both records survive an HA outage.
    assert laa.get_local_state(_KV_NAMESPACE, "test_bedroom") is not None
    assert laa.get_local_state(_KV_NAMESPACE, "bedroom") is not None


def test_throttle(env, monkeypatch):
    laa, rec = env
    _seed(laa)
    calls = {"n": 0}

    def fake_live(timeout=4.0):
        calls["n"] += 1
        return {"live1"}
    monkeypatch.setattr(rec, "_live_config_entry_ids", fake_live)

    first = rec.maybe_reconcile_occupancy(min_interval=1000)
    second = rec.maybe_reconcile_occupancy(min_interval=1000)
    assert first.get("pruned") is not None
    assert second.get("skipped") == "throttled"
    assert calls["n"] == 1  # HA hit only once thanks to the throttle
