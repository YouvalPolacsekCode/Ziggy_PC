"""Per-zone state-machine tests — the zone_transitions side of Decision.

Mocks the zones_registry to return a deterministic zone list so we don't
depend on the on-disk user_files/zones.json.
"""
from __future__ import annotations

import importlib
import json
import math
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import pytest


@pytest.fixture
def engine(tmp_path, monkeypatch):
    import core.settings_loader  # noqa: F401
    from services import presence_engine as pe
    pe = importlib.reload(pe)

    registry = tmp_path / "persons.json"
    registry.write_text("[]", encoding="utf-8")
    monkeypatch.setattr(pe, "_REGISTRY", registry)

    monkeypatch.setattr(pe, "_cfg", lambda k: {
        "home_radius_m": 100.0, "away_radius_m": 200.0, "max_accuracy_m": 150.0,
        "dwell_seconds": 60, "cooldown_seconds": 600, "stale_ping_seconds": 90,
        "stale_home_hours": 8, "stale_home_no_lan_minutes": 30,
        "lan_fresh_seconds": 180,
        "stale_away_minutes": 30, "history_size": 20,
    }[k])

    # Primary home zone centred at (0, 0); extras come from monkeypatched registry.
    monkeypatch.setattr(pe, "_home_zone", lambda: (0.0, 0.0, 100.0))

    return pe


def _add_person(pe, name="Youval"):
    persons = json.loads(pe._REGISTRY.read_text())
    p = {
        "id":              str(uuid.uuid4()),
        "name":            name,
        "token":           secrets.token_urlsafe(16),
        "state":           "unknown",
        "last_seen":       None,
        "zone_states":     {},
    }
    persons.append(p)
    pe._REGISTRY.write_text(json.dumps(persons))
    return p["id"], p["token"]


def _mock_zones(monkeypatch, zones):
    """Make `services.zones_registry.list_zones()` return the given list."""
    import services.zones_registry as zr
    monkeypatch.setattr(zr, "list_zones", lambda: list(zones))


def _offset(meters_north, meters_east, lat0=0.0):
    dlat = meters_north / 111_111.0
    dlon = meters_east  / (111_111.0 * math.cos(math.radians(lat0)))
    return lat0 + dlat, 0.0 + dlon


def _t0():
    return datetime(2026, 5, 21, 12, 0, 0, tzinfo=timezone.utc)


# ── 1. enter zone after dwell ────────────────────────────────────────────────

def test_enter_zone_fires_after_dwell(engine, monkeypatch):
    pid, tok = _add_person(engine)
    _mock_zones(monkeypatch, [
        {"id": "z1", "name": "Near Home", "lat": 0.0, "lon": 0.0, "radius_m": 1000},
    ])

    t = _t0()
    # First ping inside Near Home (50 m east) → candidate starts.
    lat, lon = _offset(0, 50)
    d = engine.ingest_ping(tok, lat, lon, accuracy=10, now=t)
    assert d.zone_transitions == []

    # Still inside, 30 s later → still dwelling.
    t += timedelta(seconds=30)
    d = engine.ingest_ping(tok, lat, lon, accuracy=10, now=t)
    assert d.zone_transitions == []

    # Past dwell — commits.
    t += timedelta(seconds=40)
    d = engine.ingest_ping(tok, lat, lon, accuracy=10, now=t)
    assert len(d.zone_transitions) == 1
    zt = d.zone_transitions[0]
    assert zt.zone_name == "Near Home"
    assert zt.direction == "entered"

    # Subsequent identical pings do not re-fire.
    for _ in range(5):
        t += timedelta(seconds=30)
        d = engine.ingest_ping(tok, lat, lon, accuracy=10, now=t)
        assert d.zone_transitions == []


# ── 2. leave zone uses hysteresis ───────────────────────────────────────────

def test_leave_zone_requires_hysteresis_factor(engine, monkeypatch):
    """Default zone_hysteresis_factor=1.5 → leave only when dist > radius*1.5."""
    pid, tok = _add_person(engine)
    _mock_zones(monkeypatch, [
        {"id": "z1", "name": "Near Home", "lat": 0.0, "lon": 0.0, "radius_m": 1000},
    ])
    t = _t0()
    # Enter (dwell-committed).
    for _ in range(4):
        lat, lon = _offset(0, 50)
        engine.ingest_ping(tok, lat, lon, accuracy=10, now=t)
        t += timedelta(seconds=30)

    # At 1200 m — outside radius (1000) but inside the 1500 m exit radius.
    # Hysteresis says we're still "in".
    t += timedelta(seconds=601)  # past cooldown to avoid that suppression mixing in
    for _ in range(5):
        lat, lon = _offset(0, 1200)
        d = engine.ingest_ping(tok, lat, lon, accuracy=10, now=t)
        t += timedelta(seconds=30)
        assert all(zt.direction != "left" for zt in d.zone_transitions)

    # At 1800 m — past the exit radius. Need dwell + cooldown still.
    fired_left = 0
    for _ in range(6):
        lat, lon = _offset(0, 1800)
        d = engine.ingest_ping(tok, lat, lon, accuracy=10, now=t)
        t += timedelta(seconds=30)
        for zt in d.zone_transitions:
            if zt.direction == "left":
                fired_left += 1
    assert fired_left == 1


# ── 3. cooldown suppresses quick re-entry ───────────────────────────────────

def test_zone_cooldown_suppresses_quick_re_enter(engine, monkeypatch):
    pid, tok = _add_person(engine)
    _mock_zones(monkeypatch, [
        {"id": "z1", "name": "Work", "lat": 0.0, "lon": 0.0, "radius_m": 200},
    ])
    t = _t0()
    # Enter.
    for _ in range(4):
        lat, lon = _offset(0, 50)
        engine.ingest_ping(tok, lat, lon, accuracy=10, now=t)
        t += timedelta(seconds=30)

    # Walk far (>300m, past 200*1.5) — but cooldown only 600s. Should suppress.
    fired = 0
    for _ in range(6):
        lat, lon = _offset(0, 1500)
        d = engine.ingest_ping(tok, lat, lon, accuracy=10, now=t)
        t += timedelta(seconds=30)
        fired += len(d.zone_transitions)
    assert fired == 0  # cooldown blocks the leave commit


# ── 4. independent zones evaluated in parallel ──────────────────────────────

def test_two_zones_evaluated_independently(engine, monkeypatch):
    pid, tok = _add_person(engine)
    _mock_zones(monkeypatch, [
        {"id": "near", "name": "Near Home", "lat": 0.0, "lon": 0.0, "radius_m": 2000},
        {"id": "work", "name": "Work",      "lat": 0.0, "lon": 0.05, "radius_m": 200},  # ~5.5 km east of (0,0)
    ])

    t = _t0()
    # Park inside Near Home (300 m east) but far from Work (~5 km away).
    fired_near, fired_work = 0, 0
    for _ in range(5):
        lat, lon = _offset(0, 300)
        d = engine.ingest_ping(tok, lat, lon, accuracy=10, now=t)
        t += timedelta(seconds=30)
        for zt in d.zone_transitions:
            if zt.zone_name == "Near Home" and zt.direction == "entered":
                fired_near += 1
            if zt.zone_name == "Work" and zt.direction == "entered":
                fired_work += 1
    assert fired_near == 1
    assert fired_work == 0


# ── 5. zone_states persisted on the person record ───────────────────────────

def test_zone_state_persists_across_pings(engine, monkeypatch):
    pid, tok = _add_person(engine)
    _mock_zones(monkeypatch, [
        {"id": "z1", "name": "Near Home", "lat": 0.0, "lon": 0.0, "radius_m": 1000},
    ])
    t = _t0()
    for _ in range(4):
        lat, lon = _offset(0, 50)
        engine.ingest_ping(tok, lat, lon, accuracy=10, now=t)
        t += timedelta(seconds=30)

    persons = json.loads(engine._REGISTRY.read_text())
    p = persons[0]
    assert p["zone_states"]["z1"]["state"] == "in"
    assert p["zone_states"]["z1"]["last_transition_to"] == "in"
    assert p["zone_states"]["z1"]["last_transition_at"] is not None
