"""fleet_health: the `error_burst` issue and `errors_5m` vital.

The hub ships an error digest (count + top exception class names) inside
`usage_counters`. Ten or more ERROR-level records in one 5-minute window is a
loop or a dead integration, not a flaky bulb — so it becomes a `degraded`,
human-kind issue whose message names the exception types.
"""
from __future__ import annotations

from relay.app.fleet_health import (
    ERROR_BURST_MIN, LEVEL_DEGRADED, LEVEL_OK, evaluate, vitals,
)

NOW = 1_700_000_000.0
HOME = {"id": "h1", "name": "Test", "status": "active"}


def _iso(epoch: float) -> str:
    from datetime import datetime, timezone
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()


def _payload(count=None, top=None, window_s=300):
    p = {
        "health": {"ha_reachable": True, "devices": {"total": 5, "offline": 0}},
        "deploy": {"release_tag": "release-2026.09.12", "cohort": "production"},
        "system_uptime_s": 100_000,
    }
    if count is not None:
        p["usage_counters"] = {
            "window_s": window_s,
            "counters": {},
            "features_enabled": [],
            "errors": {"count": count, "top": top or []},
        }
    return p


def _issue(verdict, code):
    return next((i for i in verdict["issues"] if i["code"] == code), None)


class TestErrorBurst:
    def test_threshold_is_ten(self):
        assert ERROR_BURST_MIN == 10

    def test_ten_errors_is_a_degraded_human_issue(self):
        v = evaluate(HOME, _payload(count=10, top=["ValueError", "KeyError"]),
                     _iso(NOW - 60), now=NOW)
        issue = _issue(v, "error_burst")
        assert issue is not None
        assert issue["level"] == LEVEL_DEGRADED
        assert issue["kind"] == "human"
        assert issue["remedy"] is None
        assert issue["message"] == "10 errors in the last 5 min: ValueError, KeyError"
        assert issue["detail"] == {"count": 10, "top": ["ValueError", "KeyError"],
                                   "window_s": 300}
        assert v["level"] == LEVEL_DEGRADED

    def test_nine_errors_is_fine(self):
        v = evaluate(HOME, _payload(count=9, top=["ValueError"]), _iso(NOW - 60), now=NOW)
        assert _issue(v, "error_burst") is None
        assert v["level"] == LEVEL_OK

    def test_no_types_reported_still_reads_cleanly(self):
        v = evaluate(HOME, _payload(count=25), _iso(NOW - 60), now=NOW)
        assert _issue(v, "error_burst")["message"] == \
            "25 errors in the last 5 min: no exception types reported"

    def test_window_length_is_reflected(self):
        v = evaluate(HOME, _payload(count=30, top=["OSError"], window_s=600),
                     _iso(NOW - 60), now=NOW)
        assert _issue(v, "error_burst")["message"].startswith("30 errors in the last 10 min")

    def test_old_hub_without_counters_is_not_flagged(self):
        v = evaluate(HOME, _payload(), _iso(NOW - 60), now=NOW)
        assert _issue(v, "error_burst") is None

    def test_garbage_digest_is_ignored(self):
        p = _payload()
        p["usage_counters"] = {"errors": {"count": "lots", "top": "ValueError"}}
        v = evaluate(HOME, p, _iso(NOW - 60), now=NOW)
        assert _issue(v, "error_burst") is None
        p["usage_counters"] = {"errors": {"count": True}}
        assert _issue(evaluate(HOME, p, _iso(NOW - 60), now=NOW), "error_burst") is None

    def test_top_is_capped_at_three_names(self):
        v = evaluate(HOME, _payload(count=50, top=["A", "B", "C", "D"]), _iso(NOW - 60), now=NOW)
        assert _issue(v, "error_burst")["detail"]["top"] == ["A", "B", "C"]


class TestVitals:
    def test_errors_5m_reported(self):
        assert vitals(_payload(count=7))["errors_5m"] == 7
        assert vitals(_payload(count=0))["errors_5m"] == 0

    def test_errors_5m_is_none_not_zero_on_old_hubs(self):
        assert vitals(_payload())["errors_5m"] is None
        assert vitals(None)["errors_5m"] is None
