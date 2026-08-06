"""Unit tests for services.ha_outage_alert — "tell someone HA is gone".

Regression cover for the Canary outage of 2026-08-05: `ha_connected` was False
for 9h50m and NOTHING in the system acted on it. The flag was reported by
/health and telemetry and never escalated into a notification, so the only
alarm that fired was the owner noticing their lights didn't work.

Pure state machine — the clock is injected, no pushes are sent here.
"""
from __future__ import annotations

import pytest

from services import ha_outage_alert as A


@pytest.fixture(autouse=True)
def _reset():
    A._reset_state_for_tests()
    yield
    A._reset_state_for_tests()


T0 = 1_000_000.0
OVER = A.ALERT_AFTER_S + 1


class TestNoAlertTooEarly:
    def test_healthy_hub_never_alerts(self):
        assert A.note_ha_state(True, now=T0) is None
        assert A.note_ha_state(True, now=T0 + 10_000) is None

    def test_brief_blip_never_alerts(self):
        # HA restarts / WS hiccups are routine. Alerting on them trains the
        # owner to ignore the alert, which is worse than no alert.
        assert A.note_ha_state(False, now=T0) is None
        assert A.note_ha_state(False, now=T0 + A.ALERT_AFTER_S - 1) is None
        assert A.note_ha_state(True, now=T0 + A.ALERT_AFTER_S) is None


class TestAlertsOnSustainedOutage:
    def test_alerts_once_threshold_is_crossed(self):
        A.note_ha_state(False, now=T0)
        alert = A.note_ha_state(False, now=T0 + OVER)
        assert alert is not None
        assert alert["kind"] == "down"
        assert alert["downtime_s"] >= A.ALERT_AFTER_S
        assert alert["title"] and alert["body"]

    def test_alerts_exactly_once_per_outage(self):
        A.note_ha_state(False, now=T0)
        assert A.note_ha_state(False, now=T0 + OVER) is not None
        # 558 more failed retries must not become 558 more pushes.
        for i in range(1, 20):
            assert A.note_ha_state(False, now=T0 + OVER + i * 60) is None

    def test_body_mentions_how_long_it_has_been_down(self):
        A.note_ha_state(False, now=T0)
        alert = A.note_ha_state(False, now=T0 + 3 * 3600)
        assert "3" in alert["body"]


class TestRecovery:
    def test_recovery_is_announced_only_if_we_alerted(self):
        A.note_ha_state(False, now=T0)
        A.note_ha_state(False, now=T0 + OVER)          # down alert
        rec = A.note_ha_state(True, now=T0 + OVER + 60)
        assert rec is not None and rec["kind"] == "recovered"

    def test_no_recovery_message_without_a_down_alert(self):
        A.note_ha_state(False, now=T0)
        assert A.note_ha_state(True, now=T0 + 5) is None

    def test_recovery_announced_once(self):
        A.note_ha_state(False, now=T0)
        A.note_ha_state(False, now=T0 + OVER)
        assert A.note_ha_state(True, now=T0 + OVER + 60) is not None
        assert A.note_ha_state(True, now=T0 + OVER + 120) is None

    def test_a_second_outage_alerts_again(self):
        A.note_ha_state(False, now=T0)
        A.note_ha_state(False, now=T0 + OVER)
        A.note_ha_state(True, now=T0 + OVER + 60)      # recovered
        A.note_ha_state(False, now=T0 + OVER + 120)
        second = A.note_ha_state(False, now=T0 + OVER + 120 + OVER)
        assert second is not None and second["kind"] == "down"


class TestHealedUrlIsSurfaced:
    def test_recovery_payload_can_name_the_new_address(self):
        # When the self-healer moved us to a new HA address, the owner should
        # be told — silent self-repair that nobody can audit is its own hazard.
        A.note_ha_state(False, now=T0)
        A.note_ha_state(False, now=T0 + OVER)
        rec = A.note_ha_state(True, now=T0 + OVER + 60,
                              healed_url="http://host.docker.internal:8123")
        assert "host.docker.internal" in rec["body"]
