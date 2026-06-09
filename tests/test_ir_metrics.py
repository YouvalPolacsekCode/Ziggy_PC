"""
Tests for RX reliability instrumentation.

Pin the metrics contract:
  - capture / match / unmatched counters increment correctly
  - rolling-hour view ages out stale entries
  - placement_hint correctly classifies good/marginal/poor
  - persistence round-trips through the file backend
  - reset zeros counters cleanly
"""
from __future__ import annotations

import os
import time

import pytest

from services import ir_metrics


@pytest.fixture(autouse=True)
def isolate_metrics(tmp_path, monkeypatch):
    """Each test gets a fresh in-memory store and its own metrics file path."""
    monkeypatch.setattr(ir_metrics, "_stats", {})
    monkeypatch.setattr(ir_metrics, "_last_persist_at", 0.0)
    metrics_path = str(tmp_path / "ir_metrics.json")
    monkeypatch.setattr(ir_metrics, "METRICS_FILE", metrics_path)
    # Force-persist on every call so tests don't have to wait the throttle window
    monkeypatch.setattr(ir_metrics, "_PERSIST_INTERVAL_S", 0.0)
    yield
    if os.path.exists(metrics_path):
        os.unlink(metrics_path)


# ---------------------------------------------------------------------------
# Counter increments
# ---------------------------------------------------------------------------

class TestRecording:
    def test_capture_increments_total_and_last_timestamp(self):
        ir_metrics.record_capture("10.0.0.5")
        snap = ir_metrics.snapshot("10.0.0.5")["snapshot"]
        assert snap["captures_total"] == 1
        assert snap["last_capture_at"] is not None

    def test_match_increments_named_bucket(self):
        ir_metrics.record_capture("10.0.0.5")
        ir_metrics.record_match("10.0.0.5", "matched_fingerprint")
        snap = ir_metrics.snapshot("10.0.0.5")["snapshot"]
        assert snap["breakdown"]["matched_fingerprint"] == 1
        assert snap["matched_total"] == 1

    def test_unmatched_increments_unmatched_bucket(self):
        ir_metrics.record_capture("10.0.0.5")
        ir_metrics.record_unmatched("10.0.0.5")
        snap = ir_metrics.snapshot("10.0.0.5")["snapshot"]
        assert snap["breakdown"]["unmatched"] == 1
        assert snap["matched_total"] == 0

    def test_match_without_prefix_is_normalized(self):
        # record_match accepts "exact" or "matched_exact" interchangeably
        ir_metrics.record_capture("10.0.0.5")
        ir_metrics.record_match("10.0.0.5", "exact")
        snap = ir_metrics.snapshot("10.0.0.5")["snapshot"]
        assert snap["breakdown"]["matched_exact"] == 1

    def test_unknown_bucket_silently_ignored(self):
        ir_metrics.record_capture("10.0.0.5")
        ir_metrics.record_match("10.0.0.5", "matched_something_made_up")
        snap = ir_metrics.snapshot("10.0.0.5")["snapshot"]
        assert snap["matched_total"] == 0   # nothing got bumped

    def test_multiple_hosts_kept_separate(self):
        ir_metrics.record_capture("10.0.0.5")
        ir_metrics.record_capture("10.0.0.6")
        ir_metrics.record_capture("10.0.0.6")
        all_hosts = ir_metrics.snapshot()["hosts"]
        assert all_hosts["10.0.0.5"]["captures_total"] == 1
        assert all_hosts["10.0.0.6"]["captures_total"] == 2


# ---------------------------------------------------------------------------
# Rolling hour view
# ---------------------------------------------------------------------------

class TestRollingHour:
    def test_recent_captures_count_within_hour(self):
        for _ in range(5):
            ir_metrics.record_capture("10.0.0.5")
        snap = ir_metrics.snapshot("10.0.0.5")["snapshot"]
        assert snap["captures_in_hour"] == 5

    def test_stale_captures_age_out(self, monkeypatch):
        s = ir_metrics._get("10.0.0.5") if hasattr(ir_metrics, "_get") else None
        # Reach in: append timestamps from 2 hours ago + 1 fresh
        with ir_metrics._lock:
            stats = ir_metrics._stats.setdefault("10.0.0.5", ir_metrics.HostStats())
            for _ in range(3):
                stats.recent_captures.append(time.time() - 7200)  # 2h ago
        ir_metrics.record_capture("10.0.0.5")   # 1 fresh
        snap = ir_metrics.snapshot("10.0.0.5")["snapshot"]
        assert snap["captures_in_hour"] == 1     # 3 aged out


# ---------------------------------------------------------------------------
# Placement hints
# ---------------------------------------------------------------------------

class TestPlacementHint:
    def test_unknown_when_no_captures_short_uptime(self):
        ir_metrics.record_listener_started("10.0.0.5")
        snap = ir_metrics.snapshot("10.0.0.5")["snapshot"]
        assert snap["placement_hint"] == "unknown"

    def test_marginal_when_listener_up_but_no_captures(self):
        with ir_metrics._lock:
            stats = ir_metrics._stats.setdefault("10.0.0.5", ir_metrics.HostStats())
            stats.listener_started_at = time.time() - 7200   # 2h ago
        snap = ir_metrics.snapshot("10.0.0.5")["snapshot"]
        assert snap["placement_hint"] == "marginal"

    def test_good_when_high_match_rate(self):
        for _ in range(10):
            ir_metrics.record_capture("10.0.0.5")
        for _ in range(8):
            ir_metrics.record_match("10.0.0.5", "matched_fingerprint")
        snap = ir_metrics.snapshot("10.0.0.5")["snapshot"]
        assert snap["placement_hint"] == "good"
        assert snap["match_rate"] == 0.8

    def test_poor_when_low_match_rate(self):
        for _ in range(10):
            ir_metrics.record_capture("10.0.0.5")
        ir_metrics.record_match("10.0.0.5", "matched_fingerprint")
        for _ in range(9):
            ir_metrics.record_unmatched("10.0.0.5")
        snap = ir_metrics.snapshot("10.0.0.5")["snapshot"]
        assert snap["placement_hint"] == "poor"

    def test_marginal_in_between(self):
        for _ in range(10):
            ir_metrics.record_capture("10.0.0.5")
        for _ in range(5):
            ir_metrics.record_match("10.0.0.5", "matched_fingerprint")
        snap = ir_metrics.snapshot("10.0.0.5")["snapshot"]
        assert snap["placement_hint"] == "marginal"


# ---------------------------------------------------------------------------
# Empty / unknown host handling
# ---------------------------------------------------------------------------

class TestEmpty:
    def test_snapshot_for_unseen_host_returns_zeros(self):
        snap = ir_metrics.snapshot("never-heard-of-it")["snapshot"]
        assert snap["captures_total"] == 0
        assert snap["placement_hint"] == "unknown"
        assert snap["last_capture_at"] is None

    def test_all_hosts_snapshot_when_no_hosts(self):
        result = ir_metrics.snapshot()
        assert result == {"hosts": {}}


# ---------------------------------------------------------------------------
# Reset
# ---------------------------------------------------------------------------

class TestReset:
    def test_reset_single_host_zeros_counters(self):
        ir_metrics.record_capture("10.0.0.5")
        ir_metrics.record_match("10.0.0.5", "matched_fingerprint")
        n = ir_metrics.reset("10.0.0.5")
        assert n == 1
        snap = ir_metrics.snapshot("10.0.0.5")["snapshot"]
        assert snap["captures_total"] == 0
        assert snap["matched_total"] == 0

    def test_reset_all_hosts(self):
        ir_metrics.record_capture("10.0.0.5")
        ir_metrics.record_capture("10.0.0.6")
        n = ir_metrics.reset()
        assert n == 2
        result = ir_metrics.snapshot()["hosts"]
        for host_snap in result.values():
            assert host_snap["captures_total"] == 0

    def test_reset_unseen_host_returns_zero(self):
        assert ir_metrics.reset("never-heard-of-it") == 0


# ---------------------------------------------------------------------------
# Persistence round-trip
# ---------------------------------------------------------------------------

class TestPersistence:
    def test_load_persisted_restores_counters(self):
        ir_metrics.record_capture("10.0.0.5")
        ir_metrics.record_capture("10.0.0.5")
        ir_metrics.record_match("10.0.0.5", "matched_protocol")
        # Force a persist
        with ir_metrics._lock:
            ir_metrics._persist_locked()

        # Wipe in-memory and reload
        ir_metrics._stats.clear()
        ir_metrics.load_persisted()

        snap = ir_metrics.snapshot("10.0.0.5")["snapshot"]
        assert snap["captures_total"] == 2
        assert snap["matched_total"] == 1
        assert snap["breakdown"]["matched_protocol"] == 1

    def test_load_persisted_no_file_is_noop(self):
        # File doesn't exist → silent no-op, doesn't raise
        ir_metrics.load_persisted()
        assert ir_metrics.snapshot() == {"hosts": {}}
