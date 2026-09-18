"""services/modes — the fixed home mode set (sleep, movie, cleaning, guest, vacation).

Locks: the set is fixed; expiry defaults; hooks fire on change; blockers read
the live state. No HA, no MQTT, no WS — hooks are monkeypatched.
"""
import asyncio

import pytest

from services import local_automation_actions as laa
from services import modes as M


@pytest.fixture(autouse=True)
def _kv(tmp_path, monkeypatch):
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "state.json"))
    monkeypatch.setattr(M, "_publish_hook", lambda mode, on: None)
    monkeypatch.setattr(M, "_broadcast_hook", lambda payload: None)
    monkeypatch.setattr(M, "_side_effect_hook", lambda mode, on: None)


def _run(coro):
    return asyncio.run(coro)


def test_fixed_set_and_all_off_by_default():
    assert M.MODES == ("sleep", "movie", "cleaning", "guest", "vacation")
    assert [m["id"] for m in M.list_modes()] == list(M.MODES)
    assert not any(m["on"] for m in M.list_modes())


def test_unknown_mode_rejected():
    with pytest.raises(ValueError):
        _run(M.set_mode("party", True, by="test"))


def test_movie_defaults_to_three_hours():
    now = 1_700_000_000.0
    rec = _run(M.set_mode("movie", True, by="test", now=now))
    assert rec["on"] and rec["until"] == pytest.approx(now + 3 * 3600)
    assert M.is_on("movie", now=now + 60)


def test_explicit_hours_win():
    now = 1_700_000_000.0
    rec = _run(M.set_mode("cleaning", True, by="test", hours=1, now=now))
    assert rec["until"] == pytest.approx(now + 3600)


def test_guest_has_no_expiry():
    rec = _run(M.set_mode("guest", True, by="test"))
    assert rec["until"] is None


def test_sleep_expires_at_next_morning(monkeypatch):
    monkeypatch.setattr(M, "next_morning_epoch", lambda now=None: 42.0)
    rec = _run(M.set_mode("sleep", True, by="test", now=1.0))
    assert rec["until"] == 42.0


def test_expire_due_turns_off_and_reports():
    now = 1_700_000_000.0
    _run(M.set_mode("movie", True, by="test", hours=1, now=now))
    assert M.expire_due(now + 10) == []
    assert M.expire_due(now + 3601) == ["movie"]
    assert not M.is_on("movie")


def test_is_on_is_lazy_about_expiry():
    """A read after `until` must say off even before the tick ran."""
    now = 1_700_000_000.0
    _run(M.set_mode("movie", True, by="test", hours=1, now=now))
    assert M.is_on("movie", now=now + 10)
    assert not M.is_on("movie", now=now + 3601)


def test_blockers():
    _run(M.set_mode("sleep", True, by="t"))
    assert M.blocks_motion_lighting() and not M.blocks_off_when_empty()
    _run(M.set_mode("cleaning", True, by="t"))
    assert M.blocks_off_when_empty()
    _run(M.set_mode("guest", True, by="t"))
    assert M.blocks_everyone_left()


def test_hooks_fire_on_change():
    seen = {}
    M._publish_hook = lambda mode, on: seen.setdefault("pub", []).append((mode, on))
    M._broadcast_hook = lambda p: seen.setdefault("ws", []).append(p["type"])
    M._side_effect_hook = lambda mode, on: seen.setdefault("fx", []).append((mode, on))
    _run(M.set_mode("vacation", True, by="t"))
    assert seen == {"pub": [("vacation", True)], "ws": ["mode_changed"], "fx": [("vacation", True)]}


def test_hook_failure_never_fails_the_set():
    def boom(*a, **k):
        raise RuntimeError("mqtt down")
    M._publish_hook = boom
    rec = _run(M.set_mode("guest", True, by="t"))
    assert rec["on"] and M.is_on("guest")


def test_labels_are_hebrew_and_english():
    for m in M.list_modes():
        assert m["label_he"] and m["label_en"] and m["effect_he"] and m["effect_en"]
        assert "Home Assistant" not in m["effect_en"]


def test_next_morning_is_tomorrow_when_past(monkeypatch):
    import datetime as dt
    # 2026-09-18 22:00 local → next 06:30 is 2026-09-19 06:30
    now = dt.datetime(2026, 9, 18, 22, 0).timestamp()
    nxt = dt.datetime.fromtimestamp(M.next_morning_epoch(now))
    assert (nxt.day, nxt.hour, nxt.minute) == (19, 6, 30)
    # 2026-09-18 03:00 → today 06:30
    now = dt.datetime(2026, 9, 18, 3, 0).timestamp()
    nxt = dt.datetime.fromtimestamp(M.next_morning_epoch(now))
    assert (nxt.day, nxt.hour, nxt.minute) == (18, 6, 30)
