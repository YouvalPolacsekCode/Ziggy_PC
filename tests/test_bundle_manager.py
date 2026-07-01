"""Unit tests for Pro-Mode bundle manifest / list / delete (Item 2).

These exercise services.bundle_executor's manifest persistence and sweep-delete
against an isolated (temp-file) KV store, with the HA-touching teardown paths
stubbed out — so no HA or network is required.
"""
import importlib

import pytest


@pytest.fixture
def kv(tmp_path, monkeypatch):
    """Redirect the file-backed KV store to a temp file per test."""
    laa = importlib.import_module("services.local_automation_actions")
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "state.json"))
    return laa


def _make_bundle_executor(monkeypatch, sweep_log):
    be = importlib.import_module("services.bundle_executor")
    # Stub the HA-touching teardown so delete_bundle stays offline.
    monkeypatch.setattr(be, "_teardown_automation",
                        lambda aid: sweep_log.append(("automation", aid)))
    import services.template_sensors as ts
    monkeypatch.setattr(
        ts, "delete_occupancy_sensor_by_entry_id",
        lambda entry_id: sweep_log.append(("occupancy_sensor", entry_id)) or {"ok": True},
    )
    return be


def test_persist_and_list(kv):
    be = importlib.import_module("services.bundle_executor")
    created = [
        {"kind": "automation", "id": "auto1", "name": "Night lights", "bundle_id": "b1"},
        {"kind": "occupancy_sensor", "room": "bedroom", "entry_id": "e1", "bundle_id": "b1"},
        {"kind": "kv_state", "namespace": "modes", "key": "sleep", "bundle_id": "b1"},
    ]
    be._persist_manifest("b1", "Sleep setup", created)

    bundles = be.list_bundles()
    assert len(bundles) == 1
    b = bundles[0]
    assert b["bundle_id"] == "b1"
    assert b["name"] == "Sleep setup"
    assert b["total"] == 3
    assert b["counts"] == {"automation": 1, "occupancy_sensor": 1, "kv_state": 1}


def test_persist_merges_without_duplicates(kv):
    be = importlib.import_module("services.bundle_executor")
    be._persist_manifest("b1", "x", [{"kind": "automation", "id": "auto1"}])
    # Re-apply same automation + a new one → merged, no dupes.
    be._persist_manifest("b1", "x", [
        {"kind": "automation", "id": "auto1"},
        {"kind": "automation", "id": "auto2"},
    ])
    bundles = be.list_bundles()
    assert bundles[0]["total"] == 2


def test_delete_bundle_sweeps_all_kinds(kv, monkeypatch):
    sweep = []
    be = _make_bundle_executor(monkeypatch, sweep)
    created = [
        {"kind": "automation", "id": "auto1", "name": "n"},
        {"kind": "occupancy_sensor", "room": "bedroom", "entry_id": "e1"},
        {"kind": "kv_state", "namespace": "modes", "key": "sleep"},
    ]
    be._persist_manifest("b1", "Sleep setup", created)
    # Seed the KV flag the bundle "created" so we can prove it's cleared.
    kv.set_local_state("modes", "sleep", True)

    res = be.delete_bundle("b1")
    assert res["ok"] is True
    assert len(res["removed"]) == 3
    assert not res["errors"]

    # Automation + occupancy teardown were invoked.
    assert ("automation", "auto1") in sweep
    assert ("occupancy_sensor", "e1") in sweep
    # KV flag cleared, and the manifest itself is gone.
    assert kv.get_local_state("modes", "sleep") is None
    assert be.list_bundles() == []


def test_delete_missing_bundle_is_not_found(kv, monkeypatch):
    be = _make_bundle_executor(monkeypatch, [])
    res = be.delete_bundle("nope")
    assert res["ok"] is False
    assert res["removed"] == []
    assert "no such bundle" in res["errors"][0]["error"]


def test_partial_failure_keeps_manifest(kv, monkeypatch):
    sweep = []
    be = _make_bundle_executor(monkeypatch, sweep)

    def boom(aid):
        raise RuntimeError("HA down")
    monkeypatch.setattr(be, "_teardown_automation", boom)

    be._persist_manifest("b1", "x", [
        {"kind": "automation", "id": "auto1"},
        {"kind": "kv_state", "namespace": "modes", "key": "sleep"},
    ])
    res = be.delete_bundle("b1")
    assert res["ok"] is False
    assert res["errors"]
    # KV flag still swept (best-effort), but manifest retained for retry.
    assert len(be.list_bundles()) == 1
