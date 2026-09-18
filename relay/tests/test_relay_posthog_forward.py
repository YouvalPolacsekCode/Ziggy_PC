"""relay/app/posthog_forward.py — hub usage counters → PostHog, server-side.

Pins the projection in TRACKING_SPEC §4: one `feature_used` per non-zero
counter with `distinct_id = home_id`, one `hub_errors` when the hub logged
errors, EU host by default, off without a project key, and a failed batch
costing an audit row rather than a raised exception or a slow hub reply.
"""
from __future__ import annotations

import asyncio
import json

import pytest

from relay.app import posthog_forward as pf


HOME = "home-abc"


def _payload(**over):
    base = {
        "deploy": {"release_tag": "release-2026.09.12", "cohort": "production"},
        "usage_counters": {
            "window_s": 300,
            "counters": {"chat_message": 3, "voice_command": 0,
                         "device_toggled": 40, "error_5xx": 0},
            "features_enabled": ["smart_home"],
            "errors": {"count": 0, "top": []},
        },
    }
    base.update(over)
    return base


# ── build_events (pure) ──────────────────────────────────────────────────────

class TestBuildEvents:
    def test_one_feature_used_per_nonzero_counter(self):
        events = pf.build_events(HOME, _payload(), ts="2026-09-18T00:00:00+00:00")
        assert [e["event"] for e in events] == ["feature_used", "feature_used"]
        by_feature = {e["properties"]["feature"]: e for e in events}
        assert set(by_feature) == {"chat_message", "device_toggled"}
        chat = by_feature["chat_message"]
        assert chat["distinct_id"] == HOME
        assert chat["timestamp"] == "2026-09-18T00:00:00+00:00"
        assert chat["properties"] == {
            "feature": "chat_message", "count": 3, "home_id": HOME,
            "release_tag": "release-2026.09.12", "cohort": "production",
            "window_s": 300,
        }

    def test_hub_errors_event_when_count_positive(self):
        p = _payload()
        p["usage_counters"]["errors"] = {"count": 12, "top": ["ValueError", "KeyError"]}
        events = pf.build_events(HOME, p)
        errs = [e for e in events if e["event"] == "hub_errors"]
        assert len(errs) == 1
        assert errs[0]["distinct_id"] == HOME
        assert errs[0]["properties"]["count"] == 12
        assert errs[0]["properties"]["top"] == ["ValueError", "KeyError"]
        assert errs[0]["properties"]["release_tag"] == "release-2026.09.12"

    def test_no_hub_errors_event_when_zero(self):
        assert not [e for e in pf.build_events(HOME, _payload()) if e["event"] == "hub_errors"]

    def test_old_hub_without_counters_yields_nothing(self):
        assert pf.build_events(HOME, {"ha_version": "2026.6.1"}) == []
        assert pf.build_events(HOME, {"usage_counters": "garbage"}) == []

    def test_garbage_counter_values_are_skipped(self):
        p = _payload()
        p["usage_counters"]["counters"] = {"chat_message": "3", "x": True, "y": -1, "ok": 2}
        feats = [e["properties"]["feature"] for e in pf.build_events(HOME, p)]
        assert feats == ["ok"]

    def test_git_describe_falls_back_when_no_release_tag(self):
        p = _payload(deploy={"git_describe": "release-1-3-gabc"})
        assert pf.build_events(HOME, p)[0]["properties"]["release_tag"] == "release-1-3-gabc"


# ── config ───────────────────────────────────────────────────────────────────

class TestConfig:
    def test_off_without_key(self):
        assert pf.posthog_config({}) == (None, pf.DEFAULT_HOST)
        assert pf.posthog_config({"POSTHOG_PROJECT_KEY": "  "})[0] is None

    def test_eu_host_default_and_override(self):
        assert pf.posthog_config({"POSTHOG_PROJECT_KEY": "phc_x"}) == ("phc_x", "https://eu.i.posthog.com")
        key, host = pf.posthog_config({"POSTHOG_PROJECT_KEY": "phc_x",
                                       "POSTHOG_HOST": "https://ph.example.com/"})
        assert host == "https://ph.example.com"


# ── forward ──────────────────────────────────────────────────────────────────

class _Resp:
    def __init__(self, status):
        self.status_code = status


class _Client:
    def __init__(self, status=200, exc=None):
        self.status, self.exc, self.calls = status, exc, []

    async def post(self, url, *, json=None, timeout=None):
        self.calls.append({"url": url, "json": json, "timeout": timeout})
        if self.exc:
            raise self.exc
        return _Resp(self.status)


@pytest.fixture
def audit_rows(monkeypatch):
    rows = []

    async def fake_log_event(event, **kw):
        rows.append({"event": event, **kw})

    monkeypatch.setattr(pf, "log_event", fake_log_event)
    return rows


class TestForward:
    async def test_posts_batch_with_api_key_in_body(self, audit_rows):
        client = _Client(200)
        env = {"POSTHOG_PROJECT_KEY": "phc_test"}
        res = await pf.forward(HOME, _payload(), env=env, client=client)
        assert res == {"ok": True, "sent": 2}
        call = client.calls[0]
        assert call["url"] == "https://eu.i.posthog.com/batch"
        assert call["json"]["api_key"] == "phc_test"
        assert len(call["json"]["batch"]) == 2
        assert call["timeout"] == pf.FORWARD_TIMEOUT_S == 5.0
        assert audit_rows == []

    async def test_disabled_without_key_makes_no_call(self, audit_rows):
        client = _Client(200)
        res = await pf.forward(HOME, _payload(), env={}, client=client)
        assert res["reason"] == "disabled" and client.calls == []

    async def test_nothing_to_send_makes_no_call(self, audit_rows):
        client = _Client(200)
        res = await pf.forward(HOME, {"ha_version": "x"},
                               env={"POSTHOG_PROJECT_KEY": "k"}, client=client)
        assert res["reason"] == "nothing_to_send" and client.calls == []

    async def test_http_failure_writes_audit_row_and_does_not_raise(self, audit_rows):
        res = await pf.forward(HOME, _payload(), env={"POSTHOG_PROJECT_KEY": "k"},
                               client=_Client(500))
        assert res["ok"] is False and res["reason"] == "http_500"
        assert audit_rows[0]["event"] == "posthog_forward"
        assert audit_rows[0]["ok"] is False
        assert audit_rows[0]["home_id"] == HOME
        assert "http_500" in audit_rows[0]["detail"]

    async def test_network_exception_writes_audit_row_and_does_not_raise(self, audit_rows):
        res = await pf.forward(HOME, _payload(), env={"POSTHOG_PROJECT_KEY": "k"},
                               client=_Client(exc=TimeoutError("slow")))
        assert res["ok"] is False and res["reason"].startswith("TimeoutError")
        assert audit_rows and audit_rows[0]["ok"] is False

    async def test_schedule_forward_is_fire_and_forget(self, monkeypatch):
        seen = []

        async def fake_forward(home_id, payload):
            seen.append(home_id)

        monkeypatch.setattr(pf, "forward", fake_forward)
        monkeypatch.setenv("POSTHOG_PROJECT_KEY", "k")
        task = pf.schedule_forward(HOME, _payload())
        assert task is not None
        await task
        assert seen == [HOME]

    def test_schedule_forward_is_noop_without_key(self, monkeypatch):
        monkeypatch.delenv("POSTHOG_PROJECT_KEY", raising=False)
        assert pf.schedule_forward(HOME, _payload()) is None


# ── wiring: the telemetry router calls it after storing ─────────────────────

def test_telemetry_router_schedules_forward_after_store():
    import inspect
    from relay.app.routers import telemetry
    src = inspect.getsource(telemetry.post_telemetry)
    assert "schedule_forward(home_id, payload)" in src
    # After the INSERT, not before — a vendor must never gate the store.
    assert src.index("INSERT INTO telemetry_raw") < src.index("schedule_forward(")
