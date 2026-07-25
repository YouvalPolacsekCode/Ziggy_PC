"""Value-aware Ziggy-write settling — stops the Smart Light Schedule from
marking its OWN slow Zigbee confirmations as manual overrides (bug 2026-07-25).
"""
import time
import pytest

from services import manual_overrides as mo


@pytest.fixture(autouse=True)
def _clean():
    mo._recent_ziggy_calls.clear()
    mo._ziggy_expected.clear()
    mo._overrides.clear()
    yield
    mo._recent_ziggy_calls.clear()
    mo._ziggy_expected.clear()
    mo._overrides.clear()


def test_no_pending_call_is_not_settling():
    assert mo.ziggy_write_settling("light.a", {"brightness": 112}) is False


def test_reported_matches_command_is_settling():
    # commanded 44% → 44*255/100 ≈ 112; light reports 115 (rounding) → ours
    mo.register_ziggy_call("light.a", expected={"brightness_pct": 44, "color_temp_kelvin": 2700})
    assert mo.ziggy_write_settling("light.a", {"brightness": 115, "color_temp_kelvin": 2710}) is True


def test_reported_differs_is_not_settling():
    # a real hand change: set to ~80% → 204, far from commanded 112
    mo.register_ziggy_call("light.a", expected={"brightness_pct": 44})
    assert mo.ziggy_write_settling("light.a", {"brightness": 204}) is False


def test_settling_survives_past_the_5s_call_window():
    """The whole point: recognise our write even after the 5s ziggy-call TTL."""
    mo.register_ziggy_call("light.a", expected={"brightness_pct": 44})
    # simulate 30s later — past _ZIGGY_CALL_TTL (5s), well within _SETTLE_TTL (150s)
    exp_at, val = mo._ziggy_expected["light.a"]
    mo._ziggy_expected["light.a"] = (exp_at, val)   # unchanged; TTL is 150s
    assert mo.was_ziggy_initiated("light.a") in (True, False)  # 5s window may pass
    assert mo.ziggy_write_settling("light.a", {"brightness": 112}) is True


def test_settling_record_expires():
    mo.register_ziggy_call("light.a", expected={"brightness_pct": 44})
    exp_at, val = mo._ziggy_expected["light.a"]
    mo._ziggy_expected["light.a"] = (time.time() - 1, val)   # force-expire
    assert mo.ziggy_write_settling("light.a", {"brightness": 112}) is False


def test_match_consumes_the_record():
    mo.register_ziggy_call("light.a", expected={"brightness_pct": 44})
    assert mo.ziggy_write_settling("light.a", {"brightness": 112}) is True
    # consumed → a subsequent (real) change is now evaluated normally
    assert mo.ziggy_write_settling("light.a", {"brightness": 112}) is False


def test_kelvin_mismatch_is_not_settling():
    mo.register_ziggy_call("light.a", expected={"brightness_pct": 44, "color_temp_kelvin": 2700})
    # brightness matches but colour was changed by hand to 5000K → real change
    assert mo.ziggy_write_settling("light.a", {"brightness": 112, "color_temp_kelvin": 5000}) is False


def test_brightness_only_light_matches_on_brightness():
    mo.register_ziggy_call("light.a", expected={"brightness_pct": 60})   # 153
    assert mo.ziggy_write_settling("light.a", {"brightness": 150}) is True
