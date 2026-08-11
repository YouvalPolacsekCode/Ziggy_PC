"""Push delivery counters — the answer to "is push actually working?".

The ops console shipped a row for this and the hub never sent the data, so every
home read "waiting for edge agent v1.5+" forever. Push is how a home reports a
door opening or a problem, which makes a silently broken delivery path
indistinguishable from a quiet house.
"""

import json

import pytest

from services import push_stats


@pytest.fixture(autouse=True)
def _isolated_store(tmp_path, monkeypatch):
    monkeypatch.setenv("ZIGGY_USER_FILES_DIR", str(tmp_path))
    yield


class TestCounting:
    def test_counts_successes_and_failures_per_provider(self):
        push_stats.record("fcm", True)
        push_stats.record("fcm", True)
        push_stats.record("fcm", False)
        push_stats.record("apns", True)
        push_stats.record("web", False)

        s = push_stats.summary()
        assert s["fcm_success_24h"] == 2
        assert s["fcm_failure_24h"] == 1
        assert s["apns_success_24h"] == 1
        assert s["web_failure_24h"] == 1

    def test_zero_is_a_real_answer(self):
        """'Nothing needed sending' is different from 'this hub can't tell you',
        which is the absence of the whole block."""
        s = push_stats.summary()
        assert s["fcm_success_24h"] == 0 and s["apns_failure_24h"] == 0

    def test_survives_a_restart(self, tmp_path):
        """Hubs restart on every update. An in-memory window would read
        near-zero forever on a healthy fleet — the exact 'no data' state this
        replaces."""
        push_stats.record("fcm", True)
        assert (tmp_path / "push_stats.json").exists()
        assert push_stats.summary()["fcm_success_24h"] == 1


class TestWindowAndBounds:
    def test_events_older_than_24h_drop_out(self):
        now = 1_786_400_000.0
        push_stats.record("fcm", True, now=now - (25 * 3600))
        push_stats.record("fcm", True, now=now)
        assert push_stats.summary(now=now)["fcm_success_24h"] == 1

    def test_the_file_cannot_grow_without_bound(self):
        for _ in range(push_stats.MAX_EVENTS + 250):
            push_stats.record("fcm", True)
        stored = json.loads((push_stats._path()).read_text())
        assert len(stored) <= push_stats.MAX_EVENTS

    def test_no_message_content_is_ever_stored(self):
        """Titles and bodies describe someone's private home. Only counts leave
        the hub."""
        push_stats.record("fcm", True)
        raw = (push_stats._path()).read_text()
        assert set(json.loads(raw)[0].keys()) == {"t", "p", "ok"}


class TestRobustness:
    def test_a_corrupt_file_does_not_break_sending(self):
        push_stats._path().parent.mkdir(parents=True, exist_ok=True)
        push_stats._path().write_text("{not json at all")
        push_stats.record("fcm", True)          # must not raise
        assert push_stats.summary()["fcm_success_24h"] == 1

    def test_unknown_providers_are_ignored_not_crashed_on(self):
        push_stats.record("carrier-pigeon", True)
        assert sum(push_stats.summary().values()) == 0

    def test_recording_never_raises(self, monkeypatch):
        monkeypatch.setattr(push_stats, "_save", lambda *_: (_ for _ in ()).throw(OSError()))
        push_stats.record("fcm", True)


class TestTelemetryCarriesIt:
    def test_counts_appear_in_the_telemetry_payload(self, monkeypatch):
        from services import telemetry_client

        push_stats.record("fcm", True)
        monkeypatch.setattr(telemetry_client, "_collect_sensors", lambda *a, **k: None)
        monkeypatch.setattr(telemetry_client, "_collect_sensor_counts", lambda *a, **k: {})
        monkeypatch.setattr(telemetry_client, "_collect_containers", lambda: None)
        monkeypatch.setattr(telemetry_client, "_collect_container_health", lambda: None)
        monkeypatch.setattr(telemetry_client, "_collect_last_automation_trigger", lambda: None)
        monkeypatch.setattr(telemetry_client, "_get_ha_version", lambda *a, **k: None)
        monkeypatch.setattr(telemetry_client, "_collect_health", lambda: None)

        payload = telemetry_client._build_payload({}, timeout_s=1)
        assert payload["fcm_success_24h"] == 1
        assert "apns_failure_24h" in payload
