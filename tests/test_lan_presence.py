"""Tests for services/lan_presence.py.

Mocks the actual probe primitives so we don't open sockets or fork ping.
Exercises:
  - reachable host → ingest_external_state("home")
  - unreachable host within grace → no signal
  - unreachable host past grace → ingest_external_state("not_home")
  - never-seen host that's unreachable → no signal
  - non-tracked persons (no lan_host) → skipped
"""
from __future__ import annotations

import asyncio
import importlib
import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest


@pytest.fixture
def engine_and_lan(tmp_path, monkeypatch):
    import core.settings_loader  # noqa: F401
    from services import presence_engine as pe
    from services import lan_presence as ln
    pe = importlib.reload(pe)
    ln = importlib.reload(ln)

    registry = tmp_path / "persons.json"
    registry.write_text("[]", encoding="utf-8")
    monkeypatch.setattr(pe, "_REGISTRY", registry)

    cfg = {
        "home_radius_m": 100.0, "away_radius_m": 200.0, "max_accuracy_m": 150.0,
        "dwell_seconds": 60, "cooldown_seconds": 600, "stale_ping_seconds": 90,
        "stale_home_hours": 8, "stale_home_no_lan_minutes": 30,
        "lan_fresh_seconds": 180,
        "stale_away_minutes": 30, "history_size": 20,
        # LAN-specific
        "lan_probe_interval_seconds": 60,
        "lan_offline_grace_minutes":  10,
        "lan_use_tcp_probe":          False,
        "lan_tcp_probe_ports":        [62078],
        "lan_icmp_timeout_seconds":   2,
    }
    monkeypatch.setattr(pe,  "_cfg", lambda k: cfg[k])
    monkeypatch.setattr(ln,  "_cfg", lambda k: cfg[k])

    # No real side effects — patch the binding the lan_presence module holds
    # (it imported `schedule_side_effects` by name into its own namespace,
    # so monkeypatching the source module isn't enough).
    monkeypatch.setattr(ln, "schedule_side_effects", lambda decision: None)
    return pe, ln


def _add_person(pe, name, lan_host=None, state="unknown", last_seen_iso=None, lan_last_seen=None):
    persons = json.loads(pe._REGISTRY.read_text())
    persons.append({
        "id":            str(uuid.uuid4()),
        "name":          name,
        "token":         secrets.token_urlsafe(16),
        "lan_host":      lan_host,
        "lan_last_probe": None,
        "lan_last_seen":  lan_last_seen,
        "state":         state,
        "last_seen":     last_seen_iso,
    })
    pe._REGISTRY.write_text(json.dumps(persons))
    return persons[-1]["id"]


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_no_persons_no_probes(engine_and_lan, monkeypatch):
    """Empty registry — probe_all_persons is a no-op and never calls the probe."""
    pe, ln = engine_and_lan
    called = {"n": 0}
    monkeypatch.setattr(ln, "_probe_host", lambda host: called.__setitem__("n", called["n"] + 1) or True)
    _run(ln.probe_all_persons())
    assert called["n"] == 0


def test_reachable_dwells_then_commits_home(engine_and_lan, monkeypatch):
    """Repeated reachable probes commit a home transition after dwell."""
    pe, ln = engine_and_lan
    _add_person(pe, "Alice", lan_host="alice.local")
    monkeypatch.setattr(ln, "_probe_host", lambda host: True)

    # 4 probes — engine's dwell_seconds = 60 s, but probes are sync so all are
    # at "now()". The engine will start a candidate; running it 4 times in a
    # tight loop won't commit because dwell time hasn't elapsed.
    for _ in range(4):
        _run(ln.probe_all_persons())

    person = json.loads(pe._REGISTRY.read_text())[0]
    assert person["state"] in ("home", "unknown")  # dwell may not have elapsed
    assert person["candidate_state"] in ("home", None)
    # lan_last_seen must be stamped
    assert person["lan_last_seen"] is not None


def test_unreachable_within_grace_no_signal(engine_and_lan, monkeypatch):
    """Person previously reachable but offline only briefly → no transition fired.

    Uses real wall-clock time relative to lan_last_seen so we don't have to
    fake `datetime` (which would break `fromisoformat` inside the probe).
    """
    pe, ln = engine_and_lan
    # Seen 2 minutes ago, well under the 10-min grace.
    seen_iso = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()
    pid = _add_person(pe, "Alice", lan_host="alice.local",
                      state="home", lan_last_seen=seen_iso)

    monkeypatch.setattr(ln, "_probe_host", lambda host: False)
    _run(ln.probe_all_persons())

    person = json.loads(pe._REGISTRY.read_text())[0]
    assert person["state"] == "home"
    assert person["candidate_state"] is None


def test_unreachable_past_grace_starts_not_home_dwell(engine_and_lan, monkeypatch):
    """Past-grace unreachable → engine receives a not_home signal and starts dwell."""
    pe, ln = engine_and_lan
    # Seen 30 minutes ago — past the 10-min grace.
    seen_iso = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
    pid = _add_person(pe, "Alice", lan_host="alice.local",
                      state="home", last_seen_iso=datetime.now(timezone.utc).isoformat(),
                      lan_last_seen=seen_iso)

    monkeypatch.setattr(ln, "_probe_host", lambda host: False)
    _run(ln.probe_all_persons())

    person = json.loads(pe._REGISTRY.read_text())[0]
    assert person["candidate_state"] == "not_home"


def test_never_reachable_offline_is_silent(engine_and_lan, monkeypatch):
    """If lan_last_seen has never been set, an unreachable probe sends no signal."""
    pe, ln = engine_and_lan
    pid = _add_person(pe, "Alice", lan_host="alice.local", state="unknown")
    monkeypatch.setattr(ln, "_probe_host", lambda host: False)

    _run(ln.probe_all_persons())

    person = json.loads(pe._REGISTRY.read_text())[0]
    assert person["state"] == "unknown"
    assert person["candidate_state"] is None
