"""Smart Light Schedule continuous ramp — engine unit tests.

Covers the pure ramp math (compute_target) at the anchors and in between, night
holding at the floor, degenerate configs, and the manual/enroll/sync behavior of
tick / on_light_turned_on / sync_now.
"""
from datetime import datetime
from unittest.mock import patch

import services.circadian_engine as ce

CFG = {
    "enabled": True,
    "lights": ["light.a", "light.b"],
    "peak":  {"kelvin": 5500, "pct": 100},
    "floor": {"kelvin": 2200, "pct": 30},
    "wake": "07:00", "noon": "12:00", "bedtime": "22:00",
}


def _at(h, m=0):
    return datetime(2026, 7, 20, h, m)


# ── ramp math ────────────────────────────────────────────────────────────────

def test_noon_is_peak():
    assert ce.compute_target(_at(12), CFG) == (5500, 100)


def test_wake_is_floor():
    assert ce.compute_target(_at(7), CFG) == (2200, 30)


def test_bedtime_and_after_is_floor():
    assert ce.compute_target(_at(22), CFG) == (2200, 30)
    assert ce.compute_target(_at(23, 30), CFG) == (2200, 30)


def test_predawn_is_floor():
    assert ce.compute_target(_at(3), CFG) == (2200, 30)


def test_morning_midpoint_between_floor_and_peak():
    # 09:30 is halfway wake(7)→noon(12)? no — (9.5-7)/(12-7)=0.5
    k, b = ce.compute_target(_at(9, 30), CFG)
    assert 2200 < k < 5500 and 30 < b < 100
    assert k == round(2200 + (5500 - 2200) * 0.5)   # 3850
    assert b == round(30 + (100 - 30) * 0.5)          # 65


def test_afternoon_eases_down_monotonically():
    # The whole point: after noon it falls continuously, not a plateau.
    k12, b12 = ce.compute_target(_at(12), CFG)
    k15, b15 = ce.compute_target(_at(15), CFG)
    k19, b19 = ce.compute_target(_at(19), CFG)
    assert k12 > k15 > k19 and b12 > b15 > b19          # strictly decreasing


def test_degenerate_config_no_divide_by_zero():
    bad = {**CFG, "wake": "12:00", "noon": "12:00", "bedtime": "12:00"}
    k, b = ce.compute_target(_at(12), bad)              # must not raise
    assert isinstance(k, int) and isinstance(b, int)


def test_brightness_clamped():
    cfg = {**CFG, "floor": {"kelvin": 2200, "pct": 0}}
    _, b = ce.compute_target(_at(3), cfg)
    assert b >= 1                                        # never 0 → HA would treat as off


# ── engine behavior ──────────────────────────────────────────────────────────

def test_tick_skips_off_and_manual(monkeypatch):
    ce._manual.clear()
    monkeypatch.setattr(ce, "load_config", lambda: CFG)
    monkeypatch.setattr(ce, "_live_on", lambda eids: ["light.a", "light.b"])
    ce._manual.add("light.b")                            # b is hand-controlled
    applied = {}
    monkeypatch.setattr(ce, "apply", lambda eids, k, b, **kw: applied.setdefault("eids", eids) or len(eids))
    ce.tick()
    assert applied["eids"] == ["light.a"]                # b skipped
    ce._manual.clear()


def test_turn_on_enrolls_and_applies(monkeypatch):
    ce._manual.clear(); ce._manual.add("light.a")
    monkeypatch.setattr(ce, "load_config", lambda: CFG)
    calls = {}
    monkeypatch.setattr(ce, "apply", lambda eids, k, b, **kw: calls.update(eids=eids, enroll=kw.get("enroll")))
    ce.on_light_turned_on("light.a")
    assert calls["eids"] == ["light.a"] and calls["enroll"] is True


def test_mark_manual_only_scheduled(monkeypatch):
    ce._manual.clear()
    monkeypatch.setattr(ce, "load_config", lambda: CFG)
    ce.mark_manual("light.a"); ce.mark_manual("light.unscheduled")
    assert "light.a" in ce._manual and "light.unscheduled" not in ce._manual
    ce._manual.clear()


def test_sync_now_clears_all_manual(monkeypatch):
    ce._manual.clear(); ce._manual.update({"light.a", "light.b"})
    monkeypatch.setattr(ce, "load_config", lambda: CFG)
    monkeypatch.setattr(ce, "_live_on", lambda eids: ["light.a"])
    monkeypatch.setattr(ce, "apply", lambda eids, k, b, **kw: len(eids))
    ce.sync_now()
    assert ce._manual == set()                           # all re-enrolled
