"""Tests for the relay's per-home health verdict.

Why this exists: on 2026-08-05 `GET /api/homes/{id}/health` returned
`{"ok": false}` for EVERY home in the fleet — including David's hub, which was
provably healthy (HA 2026.6.1, 34 sensors, 8 days uptime). The endpoint tried
to fetch `{tunnel_url}/api/health` directly from Fly, but most homes are
registered with a raw `*.cfargotunnel.com` URL, which is only routable from
inside Cloudflare's network. So the check timed out and cried wolf on
everything — making it useless as an alerting signal at exactly the moment
Canary needed one.

The telemetry the hubs *push* every 5 minutes never had that problem: the relay
held ten hours of Canary rows carrying `ha_version: null`. This verdict is
derived from that.
"""
from __future__ import annotations

import pytest

from relay.app.routers.homes import evaluate_home_health, TELEMETRY_STALE_S


NOW = 1_000_000.0


def _payload(**over):
    base = {"ha_version": "2026.6.1", "sensor_count": 34, "ziggy_version": "1.0"}
    base.update(over)
    return base


class TestHealthy:
    def test_fresh_telemetry_with_ha_is_ok(self):
        v = evaluate_home_health(_payload(), NOW - 60, now=NOW)
        assert v["ok"] is True
        assert v["ha_reachable"] is True
        assert v["ha_version"] == "2026.6.1"

    def test_one_missed_tick_is_still_ok(self):
        # Hubs post every 5 min; a single dropped post must not page anyone.
        v = evaluate_home_health(_payload(), NOW - (TELEMETRY_STALE_S - 60), now=NOW)
        assert v["ok"] is True


class TestHaUnreachable:
    def test_missing_ha_version_means_not_ok(self):
        # This is the exact Canary signature: hub alive and posting, HA gone.
        v = evaluate_home_health(_payload(ha_version=None, sensor_count=None),
                                 NOW - 60, now=NOW)
        assert v["ok"] is False
        assert v["ha_reachable"] is False
        assert "home assistant" in v["reason"].lower()

    def test_hub_is_still_reported_as_reachable(self):
        # Distinguishing "hub offline" from "hub up, HA down" is the whole
        # point — they need different remedies.
        v = evaluate_home_health(_payload(ha_version=None), NOW - 60, now=NOW)
        assert v["hub_reachable"] is True


class TestHubOffline:
    def test_stale_telemetry_means_hub_offline(self):
        v = evaluate_home_health(_payload(), NOW - (TELEMETRY_STALE_S + 60), now=NOW)
        assert v["ok"] is False
        assert v["hub_reachable"] is False
        assert "not reported" in v["reason"].lower()

    def test_no_telemetry_at_all(self):
        v = evaluate_home_health(None, None, now=NOW)
        assert v["ok"] is False
        assert v["hub_reachable"] is False
        assert v["reason"]

    def test_last_seen_seconds_is_reported(self):
        v = evaluate_home_health(_payload(), NOW - 300, now=NOW)
        assert v["last_seen_s"] == pytest.approx(300, abs=1)


class TestRobustness:
    def test_garbage_payload_does_not_raise(self):
        for bad in ("not a dict", 42, [], None):
            v = evaluate_home_health(bad, NOW - 60, now=NOW)
            assert v["ok"] is False

    def test_healthy_verdict_has_no_reason_noise(self):
        # An empty `reason` on a broken home was the original bug's tell
        # ({"ok": false, "reason": ""}). A false verdict must always explain.
        v = evaluate_home_health(_payload(ha_version=None), NOW - 60, now=NOW)
        assert v["reason"].strip()
