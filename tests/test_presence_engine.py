"""Simulation tests for services/presence_engine.py.

Every test uses a temp persons.json + an injected `now` clock so we can
fast-forward time deterministically. No HTTP, no asyncio. Each scenario
asserts how many transitions fire — that is what the user feels as
notifications.
"""
from __future__ import annotations

import json
import uuid
import math
import secrets
import importlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest


# ── module reload + isolated registry ─────────────────────────────────────────

@pytest.fixture
def engine(tmp_path, monkeypatch):
    """Fresh module bound to a per-test persons.json under tmp_path."""
    # Make sure settings load before we import the engine module.
    import core.settings_loader as sl  # noqa: F401
    from services import presence_engine as pe
    pe = importlib.reload(pe)

    # Point persistence at a tmp file.
    registry = tmp_path / "persons.json"
    registry.write_text("[]", encoding="utf-8")
    monkeypatch.setattr(pe, "_REGISTRY", registry)

    # Tight, deterministic config — overrides settings.yaml values.
    overrides = {
        "home_radius_m":      100.0,
        "away_radius_m":      200.0,
        "max_accuracy_m":     150.0,
        "dwell_seconds":      60,
        "cooldown_seconds":   600,
        "stale_ping_seconds": 90,
        "stale_home_hours":   8,
        "stale_away_minutes": 30,
        "history_size":       20,
    }
    monkeypatch.setattr(pe, "_cfg", lambda k: overrides[k])

    # Fixed home zone — no HA calls.
    monkeypatch.setattr(pe, "_home_zone", lambda: (32.519379, 34.939105, 100.0))

    return pe


def _add_person(engine, name="Youval"):
    """Insert a person directly into the registry; return the token."""
    token = secrets.token_urlsafe(16)
    person = {
        "id":              str(uuid.uuid4()),
        "name":            name,
        "token":           token,
        "state":           "unknown",
        "last_seen":       None,
        "last_lat":        None,
        "last_lon":        None,
        "last_accuracy":   None,
        "last_distance_m": None,
        "candidate_state": None,
        "candidate_since": None,
        "last_transition_at": None,
        "last_transition_to": None,
        "last_decision":   None,
        "history":         [],
    }
    persons = json.loads(engine._REGISTRY.read_text())
    persons.append(person)
    engine._REGISTRY.write_text(json.dumps(persons), encoding="utf-8")
    return token


# Home centre coords from the fake zone above.
HOME_LAT = 32.519379
HOME_LON = 34.939105


def _offset(meters_north: float, meters_east: float) -> tuple[float, float]:
    """Return (lat, lon) offset from home by approximately the given metres."""
    dlat = meters_north / 111_111.0
    dlon = meters_east  / (111_111.0 * math.cos(math.radians(HOME_LAT)))
    return HOME_LAT + dlat, HOME_LON + dlon


def _ping(engine, token, dist_m, t, accuracy=10.0):
    """Helper — ping at `dist_m` metres east of home."""
    lat, lon = _offset(0, dist_m)
    return engine.ingest_ping(token, lat, lon, accuracy=accuracy, now=t)


def _t0():
    return datetime(2026, 5, 20, 12, 0, 0, tzinfo=timezone.utc)


# ── 1. normal arrive — one transition ─────────────────────────────────────────

def test_normal_arrive_fires_once(engine):
    """A person walks from far away to clearly inside the zone. After dwell expires,
    exactly one home transition fires."""
    token = _add_person(engine)
    t = _t0()

    # First ping — clearly away.
    d = _ping(engine, token, 1000, t)
    assert d.raw_state == "not_home"
    assert d.fired_transition is False

    # Second ping — at home, but dwell hasn't elapsed yet.
    t += timedelta(seconds=5)
    d = _ping(engine, token, 30, t)
    assert d.raw_state == "home"
    assert d.result == "candidate_started"
    assert d.fired_transition is False

    # Wait less than dwell — still no commit.
    t += timedelta(seconds=30)
    d = _ping(engine, token, 30, t)
    assert d.result == "candidate_progressing"
    assert d.fired_transition is False

    # Wait past dwell — fires.
    t += timedelta(seconds=40)
    d = _ping(engine, token, 30, t)
    assert d.fired_transition is True
    assert d.new_confirmed == "home"

    # Subsequent home pings do nothing.
    for _ in range(5):
        t += timedelta(seconds=30)
        d = _ping(engine, token, 30, t)
        assert d.fired_transition is False


# ── 2. normal leave — one transition ──────────────────────────────────────────

def test_normal_leave_fires_once(engine):
    token = _add_person(engine)
    t = _t0()

    # Establish home state quickly via the dwell.
    for _ in range(3):
        _ping(engine, token, 20, t); t += timedelta(seconds=30)
    _ping(engine, token, 20, t)  # dwell satisfied, commits

    # Confirm we're home.
    person = next(p for p in json.loads(engine._REGISTRY.read_text()) if p["token"] == token)
    assert person["state"] == "home"

    # Skip past the cooldown so a real leave can fire (otherwise the cooldown
    # rightly suppresses a leave that happens seconds after an arrival).
    t += timedelta(seconds=601)

    fired = 0
    for i in range(6):
        d = _ping(engine, token, 500, t)
        t += timedelta(seconds=20)
        if d.fired_transition:
            fired += 1
            assert d.new_confirmed == "not_home"
    assert fired == 1


# ── 3. GPS jitter at boundary — zero transitions ──────────────────────────────

def test_gps_jitter_near_boundary_does_not_flip(engine):
    """Phone parked at ~95 m alternating slightly across home_radius (100 m).
    Hysteresis means: once home, dist must exceed away_radius (200 m) to leave."""
    token = _add_person(engine)
    t = _t0()

    # Arrive normally.
    for _ in range(4):
        _ping(engine, token, 30, t); t += timedelta(seconds=30)
    person = next(p for p in json.loads(engine._REGISTRY.read_text()) if p["token"] == token)
    assert person["state"] == "home"

    # Now jitter between 95 m (inside home_radius) and 115 m (outside home but
    # well inside away_radius). With hysteresis the confirmed state must stay
    # "home" the whole time.
    transitions = 0
    for i in range(200):
        d = _ping(engine, token, 95 if i % 2 == 0 else 115, t)
        t += timedelta(seconds=15)
        if d.fired_transition:
            transitions += 1
    assert transitions == 0


# ── 4. duplicate location updates — no transitions ────────────────────────────

def test_duplicate_pings_dont_retrigger(engine):
    token = _add_person(engine)
    t = _t0()

    # Arrive.
    for _ in range(4):
        _ping(engine, token, 30, t); t += timedelta(seconds=30)

    # 50 identical home pings.
    transitions = 0
    for _ in range(50):
        d = _ping(engine, token, 30, t)
        t += timedelta(seconds=10)
        if d.fired_transition:
            transitions += 1
    assert transitions == 0


# ── 5. stale client timestamp — rejected ──────────────────────────────────────

def test_stale_client_ts_rejected(engine):
    token = _add_person(engine)
    t = _t0()

    # Establish away state.
    _ping(engine, token, 1000, t)

    # A ping arrives with a client_ts that's 5 minutes old → reject.
    t += timedelta(minutes=10)
    d = engine.ingest_ping(
        token, *_offset(0, 30), accuracy=10,
        client_ts=t - timedelta(seconds=300),
        now=t,
    )
    assert d.result == "rejected_stale"
    assert d.fired_transition is False


# ── 6. backend restart — no spurious transitions ──────────────────────────────

def test_restart_does_not_replay(engine):
    """Engine has no in-memory state — persons.json is the only state. A ping
    that arrives after a 'restart' (any later ping) at the same confirmed
    position must not fire a transition."""
    token = _add_person(engine)
    t = _t0()
    for _ in range(4):
        _ping(engine, token, 30, t); t += timedelta(seconds=30)

    # Verify persistence captured the committed state.
    persons = json.loads(engine._REGISTRY.read_text())
    person = next(p for p in persons if p["token"] == token)
    assert person["state"] == "home"
    assert person["last_transition_to"] == "home"

    # A new ping after a notional restart must not re-fire.
    t += timedelta(minutes=1)
    d = engine.ingest_ping(token, *_offset(0, 30), accuracy=10, now=t)
    assert d.fired_transition is False
    assert d.prev_confirmed == "home"
    assert d.result == "no_change"


# ── 7. frontend reconnect (re-ping at same position) — no transitions ─────────

def test_reconnect_repeats_same_position(engine):
    token = _add_person(engine)
    t = _t0()
    for _ in range(4):
        _ping(engine, token, 30, t); t += timedelta(seconds=30)

    # Frontend "reconnects" — sends the same position 5 times in a burst.
    fired = 0
    for _ in range(5):
        d = _ping(engine, token, 30, t)
        t += timedelta(seconds=1)
        if d.fired_transition:
            fired += 1
    assert fired == 0


# ── 8. multiple users — independent state ─────────────────────────────────────

def test_multiple_users_independent(engine):
    a = _add_person(engine, "Alice")
    b = _add_person(engine, "Bob")
    t = _t0()

    # Alice arrives home; Bob stays away.
    for _ in range(4):
        _ping(engine, a, 30, t); t += timedelta(seconds=30)
    _ping(engine, b, 1000, t)

    persons = json.loads(engine._REGISTRY.read_text())
    states = {p["name"]: p["state"] for p in persons}
    assert states["Alice"] == "home"
    # Bob never reached dwell on home, never committed not_home transition either
    # (his prev was unknown → not_home → not a fired transition by design? Actually
    # unknown → not_home is "raw_matches_confirmed_unknown" fails, so it goes through
    # the dwell). Verify Bob hasn't been marked home.
    assert states["Bob"] != "home"


# ── 9. rapid toggling — debounced by dwell ────────────────────────────────────

def test_rapid_toggle_inside_dwell_window_does_not_fire(engine):
    """Phone bounces home/away every few seconds. Only one transition should
    fire (when one side wins the dwell race), or zero if neither does."""
    token = _add_person(engine)
    t = _t0()

    fired = 0
    for i in range(40):
        dist = 30 if i % 2 == 0 else 500
        d = _ping(engine, token, dist, t)
        t += timedelta(seconds=5)
        if d.fired_transition:
            fired += 1

    # The candidate keeps getting reset, dwell never completes, no transition fires.
    assert fired == 0


# ── 10. poor accuracy — no transition ─────────────────────────────────────────

def test_poor_accuracy_blocks_transition(engine):
    token = _add_person(engine)
    t = _t0()
    # Establish home.
    for _ in range(4):
        _ping(engine, token, 30, t); t += timedelta(seconds=30)

    # Sample with terrible accuracy that would say "not_home" — must be ignored.
    fired = 0
    for _ in range(5):
        d = _ping(engine, token, 250, t, accuracy=400)
        t += timedelta(seconds=70)
        if d.fired_transition:
            fired += 1
        assert d.result in ("rejected_accuracy", "no_change")
    assert fired == 0


# ── 11. expiry sweep — fires once with cooldown ───────────────────────────────

def test_expiry_sweep_fires_once(engine):
    token = _add_person(engine)
    t = _t0()
    for _ in range(4):
        _ping(engine, token, 30, t); t += timedelta(seconds=30)

    # Advance > stale_home_hours so effective_state degrades.
    t += timedelta(hours=9)
    decisions = engine.sweep_expiry(now=t)
    fired = [d for d in decisions if d.fired_transition]
    assert len(fired) == 1
    assert fired[0].new_confirmed == "not_home"

    # Running the sweep again immediately must not fire again (last_transition_to
    # is already not_home — idempotent).
    decisions = engine.sweep_expiry(now=t + timedelta(seconds=1))
    assert all(not d.fired_transition for d in decisions)


# ── 12. cooldown — flipping back inside the cooldown window is suppressed ─────

def test_cooldown_suppresses_quick_reentry(engine):
    """Person arrives, then 'leaves' (dwell satisfied) within the cooldown
    window. The leave commit must be suppressed."""
    token = _add_person(engine)
    t = _t0()
    # Arrive — fires arrived.
    for _ in range(5):
        d = _ping(engine, token, 30, t); t += timedelta(seconds=30)
    # Confirm arrival fired in that loop.
    person = next(p for p in json.loads(engine._REGISTRY.read_text()) if p["token"] == token)
    assert person["state"] == "home"

    # Immediately walk far away — dwell will be satisfied but cooldown should fire.
    # (cooldown_seconds = 600, only 2.5 minutes have passed.)
    t += timedelta(seconds=5)
    fired = 0
    for _ in range(6):
        d = _ping(engine, token, 500, t)
        t += timedelta(seconds=20)
        if d.fired_transition:
            fired += 1
        if d.result == "suppressed_cooldown":
            assert "cooldown" in d.reason
    assert fired == 0


# ── 13. clock-skew (future) ping — rejected ───────────────────────────────────

def test_future_client_ts_rejected(engine):
    token = _add_person(engine)
    t = _t0()
    d = engine.ingest_ping(
        token, *_offset(0, 30), accuracy=10,
        client_ts=t + timedelta(minutes=10),
        now=t,
    )
    assert d.result == "rejected_clock_skew"


# ── 14. unconfigured zone — graceful ──────────────────────────────────────────

def test_no_zone_configured_no_crash(engine, monkeypatch):
    monkeypatch.setattr(engine, "_home_zone", lambda: None)
    token = _add_person(engine)
    d = _ping(engine, token, 30, _t0())
    assert d.result == "rejected_no_zone"
    assert d.fired_transition is False


# ── 15. wifi LAN hint forces home even if GPS says far ────────────────────────

def test_legacy_record_migrated_on_load(engine, tmp_path):
    """A legacy persons.json with only the original fields must be readable,
    and the new fields must be backfilled to None / [] on first load."""
    legacy_token = "legacy-tok"
    legacy = [{
        "id":        "legacy-id",
        "name":      "OldUser",
        "token":     legacy_token,
        "state":     "home",
        "last_seen": _t0().isoformat(),
        "last_lat":  HOME_LAT,
        "last_lon":  HOME_LON,
    }]
    engine._REGISTRY.write_text(json.dumps(legacy), encoding="utf-8")

    persons = engine._load()
    assert persons[0]["candidate_state"] is None
    assert persons[0]["last_transition_at"] is None
    assert persons[0]["history"] == []

    # The next ping at the same position must not crash and must not fire.
    t = _t0() + timedelta(seconds=10)
    d = engine.ingest_ping(legacy_token, HOME_LAT, HOME_LON, accuracy=10, now=t)
    assert d.fired_transition is False


def test_ingest_external_state_committed_via_dwell(engine):
    """Pre-decided home/not_home from upstream (HA Companion) goes through dwell
    and cooldown the same way GPS pings do."""
    token = _add_person(engine)
    person_id = next(p for p in json.loads(engine._REGISTRY.read_text()) if p["token"] == token)["id"]
    t = _t0()

    # 4 home pings via the external path — dwell should commit by sample 3 or 4.
    fired = 0
    for _ in range(4):
        d = engine.ingest_external_state(person_id, "home", source="ha", now=t)
        t += timedelta(seconds=30)
        if d.fired_transition:
            fired += 1
    assert fired == 1

    # Further home reports do nothing.
    for _ in range(5):
        d = engine.ingest_external_state(person_id, "home", source="ha", now=t)
        t += timedelta(seconds=30)
        assert d.fired_transition is False


def test_ingest_external_state_unknown_ignored(engine):
    """HA reporting `unknown` / `unavailable` must not cause a transition."""
    token = _add_person(engine)
    pid = next(p for p in json.loads(engine._REGISTRY.read_text()) if p["token"] == token)["id"]
    d = engine.ingest_external_state(pid, "unknown", source="ha", now=_t0())
    assert d.fired_transition is False
    assert d.result == "ignored_non_binary_state"


def test_list_lan_hosts_skips_blank(engine):
    """Only persons with a non-empty `lan_host` appear in the LAN probe list."""
    token_a = _add_person(engine, name="Alice")
    token_b = _add_person(engine, name="Bob")
    persons = json.loads(engine._REGISTRY.read_text())
    persons[0]["lan_host"] = "alice-iphone.local"
    persons[1]["lan_host"] = ""   # blank → ignored
    engine._REGISTRY.write_text(json.dumps(persons))

    hosts = engine.list_lan_hosts()
    assert len(hosts) == 1
    assert hosts[0]["name"] == "Alice"
    assert hosts[0]["lan_host"] == "alice-iphone.local"


def test_record_lan_probe_updates_timestamps(engine):
    """record_lan_probe stamps lan_last_probe always and lan_last_seen only on success."""
    token = _add_person(engine)
    pid = json.loads(engine._REGISTRY.read_text())[0]["id"]

    t = _t0()
    engine.record_lan_probe(pid, reachable=False, now=t)
    person = json.loads(engine._REGISTRY.read_text())[0]
    assert person["lan_last_probe"] == t.isoformat()
    assert person["lan_last_seen"] is None

    t2 = t + timedelta(seconds=30)
    engine.record_lan_probe(pid, reachable=True, now=t2)
    person = json.loads(engine._REGISTRY.read_text())[0]
    assert person["lan_last_probe"] == t2.isoformat()
    assert person["lan_last_seen"] == t2.isoformat()


def test_wifi_lan_hint_forces_home(engine):
    token = _add_person(engine)
    t = _t0()
    fired = 0
    # GPS would say "not_home" but wifi hint forces home through dwell.
    for _ in range(4):
        d = engine.ingest_ping(token, *_offset(0, 1000), accuracy=10,
                               wifi_home_hint=True, now=t)
        t += timedelta(seconds=30)
        if d.fired_transition:
            fired += 1
    assert fired == 1

    # Final state is committed home.
    person = next(p for p in json.loads(engine._REGISTRY.read_text()) if p["token"] == token)
    assert person["state"] == "home"
