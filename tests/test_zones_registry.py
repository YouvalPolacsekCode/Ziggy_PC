"""Tests for services/zones_registry.py — extra named zones."""
from __future__ import annotations

import importlib
import json
from pathlib import Path

import pytest


@pytest.fixture
def zr(tmp_path, monkeypatch):
    from services import zones_registry as z
    z = importlib.reload(z)
    registry = tmp_path / "zones.json"
    registry.write_text("[]", encoding="utf-8")
    monkeypatch.setattr(z, "_REGISTRY", registry)
    return z


def test_create_and_list(zr):
    a = zr.create_zone("Near Home", 32.5, 34.9, 2000)
    b = zr.create_zone("Work",      32.1, 34.8, 300)
    zones = zr.list_zones()
    names = {z["name"] for z in zones}
    assert names == {"Near Home", "Work"}
    # IDs are stable across reads.
    assert zr.get_zone(a["id"])["name"] == "Near Home"
    assert zr.get_zone(b["id"])["name"] == "Work"


def test_duplicate_name_rejected(zr):
    zr.create_zone("Work", 32.1, 34.8, 300)
    with pytest.raises(ValueError, match="already exists"):
        zr.create_zone("work", 32.2, 34.9, 400)  # case-insensitive collision


def test_update_partial(zr):
    z1 = zr.create_zone("Work", 32.1, 34.8, 300)
    out = zr.update_zone(z1["id"], radius_m=500)
    assert out["radius_m"] == 500.0
    assert out["lat"] == 32.1
    # Untouched fields kept.
    saved = zr.get_zone(z1["id"])
    assert saved["radius_m"] == 500.0


def test_update_rename_collision(zr):
    a = zr.create_zone("Near Home", 32.5, 34.9, 2000)
    b = zr.create_zone("Work",      32.1, 34.8, 300)
    with pytest.raises(ValueError, match="already has that name"):
        zr.update_zone(b["id"], name="Near Home")


def test_delete(zr):
    z1 = zr.create_zone("Temp", 32.0, 34.0, 100)
    assert zr.delete_zone(z1["id"]) is True
    assert zr.get_zone(z1["id"]) is None
    assert zr.delete_zone(z1["id"]) is False  # idempotent


def test_min_radius_enforced(zr):
    z = zr.create_zone("Tiny", 32, 34, 10)
    assert z["radius_m"] == 50.0   # floor at 50 m


def test_zones_containing(zr):
    near = zr.create_zone("Near Home", 32.5, 34.9, 5000)
    work = zr.create_zone("Work",      32.1, 34.8, 300)
    # Point right at the Near Home centre — should match Near Home only.
    matches = zr.zones_containing(32.5, 34.9)
    assert [m["name"] for m in matches] == ["Near Home"]
    # Point far away — no matches.
    assert zr.zones_containing(0.0, 0.0) == []
