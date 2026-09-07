"""A device-history request must cover the window it was asked for.

Home Assistant's /api/history/period/{start} defaults end_time to start + 1
day. We sent no end_time, so every window longer than a day came back as a
one-day slice taken from the START of the window — the recent end was simply
missing. On 2026-09-06 that made a perfectly healthy recorder look dead since
the previous week, because a 168 h request returned only day one of seven.
"""
from datetime import datetime, timedelta, timezone

from backend.routers.device_router import _history_window


def _parse(s):
    return datetime.fromisoformat(s)


def test_window_carries_an_explicit_end_time():
    start, params = _history_window(48)
    assert "end_time" in params, "without end_time HA truncates to one day"
    span = _parse(params["end_time"]) - _parse(start)
    assert timedelta(hours=47, minutes=59) <= span <= timedelta(hours=48, minutes=1)


def test_seven_day_window_spans_seven_days():
    start, params = _history_window(168)
    span = _parse(params["end_time"]) - _parse(start)
    assert span > timedelta(days=6), f"got {span}, expected ~7 days"


def test_window_is_clamped_and_defaults():
    # Unchanged from before the fix: falsy means "default 24h", the ceiling is
    # a week, and a negative window collapses to the 1h floor.
    for hours, expect in ((0, 24), (None, 24), (100000, 168), (-5, 1), ("junk", 24)):
        start, params = _history_window(hours)
        span = _parse(params["end_time"]) - _parse(start)
        assert abs(span - timedelta(hours=expect)) < timedelta(minutes=1), (hours, span)


def test_end_time_is_now_not_the_future():
    start, params = _history_window(24)
    assert _parse(params["end_time"]) <= datetime.now(timezone.utc) + timedelta(seconds=5)
