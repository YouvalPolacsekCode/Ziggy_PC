"""Telemetry must carry health + deploy drift, or the fleet stays blind.

Before this, the payload was cpu/mem/disk/uptime/versions only. A hub could be
fully degraded — or running a hand-copied build that the updater could no longer
touch — and the cloud saw nothing but healthy-looking resource numbers.
"""

import pytest

from services import deploy_state, telemetry_client


# ---------------------------------------------------------------------------
# Health block
# ---------------------------------------------------------------------------

class TestHealthBlock:
    def test_reports_cached_health_without_recomputing(self, monkeypatch):
        """compute_system_health has side effects (it schedules auto-recovery),
        so telemetry must read the cache, never call it."""
        from services import ha_health

        monkeypatch.setattr(ha_health, "get_last_health", lambda **_: {
            "level": "degraded",
            "primary": "devices_offline",
            "ha": {"reachable": True},
            "devices": {"total": 23, "offline": 1},
            "zigbee": {"coordinator_state": "loaded"},
            "recovery": {"in_progress": False, "manual_action": None},
        })
        monkeypatch.setattr(telemetry_client, "_collect_registry_counts", lambda: {})

        def _boom(**kwargs):
            raise AssertionError("telemetry must not recompute health")

        monkeypatch.setattr(ha_health, "compute_system_health", _boom)

        health = telemetry_client._collect_health()
        assert health["level"] == "degraded"
        assert health["primary"] == "devices_offline"
        assert health["ha_reachable"] is True
        assert health["devices"] == {"total": 23, "offline": 1}
        assert health["coordinator_state"] == "loaded"

    def test_survives_health_never_having_been_computed(self, monkeypatch):
        from services import ha_health
        monkeypatch.setattr(ha_health, "get_last_health", lambda **_: None)
        monkeypatch.setattr(telemetry_client, "_collect_registry_counts",
                            lambda: {"total": 3, "lost": 0, "connected": 3, "by_status": {}})
        health = telemetry_client._collect_health()
        assert health["registry"]["total"] == 3
        assert "level" not in health

    def test_registry_counts_expose_the_lost_pile(self, monkeypatch):
        """The incident's signature: every device marked lost. This is the
        number the fleet rules key off, and it was never on the wire."""
        from services import device_registry

        monkeypatch.setattr(device_registry, "get_all", lambda: [
            {"entity_id": f"light.{i}", "status": "lost"} for i in range(23)
        ])
        counts = telemetry_client._collect_registry_counts()
        assert counts == {
            "total": 23, "lost": 23, "connected": 0, "by_status": {"lost": 23},
        }

    def test_stale_health_is_withheld_rather_than_lied_about(self, monkeypatch):
        from services import ha_health
        ha_health._remember_health({"level": "ok"}, now=1000.0)
        monkeypatch.setattr("time.time", lambda: 1000.0 + 10_000)
        assert ha_health.get_last_health() is None
        assert ha_health.get_last_health(max_age_s=20_000)["level"] == "ok"


# ---------------------------------------------------------------------------
# Deploy / drift block
# ---------------------------------------------------------------------------

class TestDriftDetection:
    def test_clean_release_checkout_is_not_drifted(self, tmp_path, monkeypatch):
        _write_host_state(tmp_path, monkeypatch, {
            "release_tag": "release-2026.08.10",
            "git_describe": "release-2026.08.10",
            "git_sha": "abc1234",
            "branch": "main",
            "cohort": "production",
            "dirty": False,
            "dirty_files": 0,
            "updater_installed": True,
        })
        state = deploy_state.collect_deploy_state()
        assert state["drifted"] is False
        assert state["drift_reason"] == ""
        assert state["release_tag"] == "release-2026.08.10"

    def test_dirty_tree_is_drift_and_says_updates_are_blocked(self, tmp_path, monkeypatch):
        """David's hub: 105 modified files. A dirty tree doesn't just skip the
        updater, it BLOCKS it — the reason string has to say so."""
        _write_host_state(tmp_path, monkeypatch, {
            "release_tag": "release-2026.07.23",
            "git_sha": "4e181ad",
            "cohort": "production",
            "dirty": True,
            "dirty_files": 105,
            "updater_installed": True,
        })
        state = deploy_state.collect_deploy_state()
        assert state["drifted"] is True
        assert "105 files" in state["drift_reason"]
        assert "blocked" in state["drift_reason"]

    def test_unstamped_hand_copied_build_is_drift(self, tmp_path, monkeypatch):
        """ZIGGY_GIT_SHA=dev / version 0.0.0+local — the hand-push signature."""
        _write_host_state(tmp_path, monkeypatch, {
            "git_sha": "dev", "cohort": "production", "updater_installed": True,
        })
        state = deploy_state.collect_deploy_state()
        assert state["drifted"] is True
        assert "hand-copied" in state["drift_reason"]

    def test_missing_updater_is_drift(self, tmp_path, monkeypatch):
        _write_host_state(tmp_path, monkeypatch, {
            "release_tag": "release-2026.08.10", "git_sha": "abc1234",
            "cohort": "production", "dirty": False, "updater_installed": False,
        })
        state = deploy_state.collect_deploy_state()
        assert state["drifted"] is True
        assert "updater" in state["drift_reason"]

    def test_no_cohort_is_drift(self, tmp_path, monkeypatch):
        _write_host_state(tmp_path, monkeypatch, {
            "release_tag": "release-2026.08.10", "git_sha": "abc1234",
            "dirty": False, "updater_installed": True,
        })
        state = deploy_state.collect_deploy_state()
        assert state["drifted"] is True
        assert "cohort" in state["drift_reason"]

    def test_commits_ahead_of_tag_is_drift(self, tmp_path, monkeypatch):
        _write_host_state(tmp_path, monkeypatch, {
            "release_tag": "release-2026.07.23",
            "git_describe": "release-2026.07.23-81-g4e181ad",
            "git_sha": "4e181ad", "cohort": "production",
            "dirty": False, "updater_installed": True,
        })
        state = deploy_state.collect_deploy_state()
        assert state["drifted"] is True
        assert "ahead of release tag" in state["drift_reason"]

    def test_no_host_state_falls_back_to_env_and_flags_drift(self, tmp_path, monkeypatch):
        monkeypatch.setattr(deploy_state, "_user_files_dir", lambda: tmp_path)
        monkeypatch.setenv("ZIGGY_GIT_SHA", "anom12")
        state = deploy_state.collect_deploy_state()
        assert state["git_sha"] == "anom12"
        assert state["drifted"] is True
        assert "not on the release channel" in state["drift_reason"]

    def test_collector_never_raises(self, monkeypatch):
        monkeypatch.setattr(deploy_state, "_user_files_dir",
                            lambda: (_ for _ in ()).throw(OSError("boom")))
        assert deploy_state.collect_deploy_state()["known"] in (True, False)


def _write_host_state(tmp_path, monkeypatch, payload: dict):
    import json
    monkeypatch.setattr(deploy_state, "_user_files_dir", lambda: tmp_path)
    (tmp_path / "deploy_state.json").write_text(json.dumps(payload), encoding="utf-8")
