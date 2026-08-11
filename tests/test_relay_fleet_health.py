"""Rules that decide whether an operator gets woken up.

Grounded in real fleet incidents:
  * 2026-08-09  power cut → all 23 devices falsely "lost", 19 h unnoticed
  * 2026-08-05  Canary hub fine, HA unreachable (needs a DIFFERENT remedy)
  * ongoing     a customer hub 105 files off its tag, updater never installed
"""

import pytest

from relay.app import fleet_health as fh


NOW = 1_786_400_000.0


def _iso(epoch: float) -> str:
    from datetime import datetime, timezone
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()


def _home(**kw):
    return {"id": "home-1", "name": "David's Home", "status": "active", **kw}


def _payload(**kw):
    """A healthy baseline payload; tests override just what they're testing."""
    base = {
        "ha_version": "2026.6.1",
        "ziggy_version": "1.0.0",
        "system_uptime_s": 86_400,
        "disk_pct_used": 40.0,
        "mem_pct": 50.0,
        "health": {
            "level": "ok", "primary": "ok", "ha_reachable": True,
            "coordinator_state": "loaded",
            "devices": {"total": 23, "offline": 0},
            "registry": {"total": 23, "lost": 0, "connected": 23},
        },
        "deploy": {"known": True, "drifted": False, "drift_reason": ""},
    }
    base.update(kw)
    return base


def _eval(payload=None, *, seen_s_ago=60.0, home=None):
    last_seen = _iso(NOW - seen_s_ago) if seen_s_ago is not None else None
    return fh.evaluate(home or _home(), payload, last_seen, now=NOW)


class TestHealthyBaseline:
    def test_healthy_home_is_ok_and_quiet(self):
        v = _eval(_payload())
        assert v["level"] == fh.LEVEL_OK
        assert v["issues"] == []
        assert v["headline"] == "All good."
        assert v["actionable"] == []


class TestSilenceIsTheMostImportantSignal:
    """A dead mini PC, a cut power line, a crashed container and a severed
    tunnel are indistinguishable — and none of them send a payload saying so."""

    def test_recent_report_is_not_silence(self):
        assert _eval(_payload(), seen_s_ago=300)["level"] == fh.LEVEL_OK

    def test_missed_several_posts_is_degraded(self):
        v = _eval(_payload(), seen_s_ago=fh.SILENCE_DEGRADED_S + 60)
        assert v["level"] == fh.LEVEL_DEGRADED
        assert any(i["code"] == "hub_reporting_late" for i in v["issues"])

    def test_an_hour_of_silence_is_down(self):
        v = _eval(_payload(), seen_s_ago=fh.SILENCE_DOWN_S + 60)
        assert v["level"] == fh.LEVEL_DOWN
        codes = [i["code"] for i in v["issues"]]
        assert "hub_silent" in codes
        assert "powered off" in v["headline"] or "hub may be" in v["headline"]

    def test_silence_outranks_a_stale_healthy_payload(self):
        """The last payload said 'all good' — it is also two days old."""
        v = _eval(_payload(), seen_s_ago=48 * 3600)
        assert v["level"] == fh.LEVEL_DOWN

    def test_never_reported_is_unknown_not_ok(self):
        v = _eval(None, seen_s_ago=None)
        assert v["level"] == fh.LEVEL_UNKNOWN
        assert any(i["code"] == "never_reported" for i in v["issues"])

    def test_suspended_home_is_not_alerted_on(self):
        v = _eval(None, seen_s_ago=None, home=_home(status="suspended"))
        assert v["suspended"] is True
        assert v["issues"] == []


class TestHomeAssistantAndRadio:
    def test_ha_unreachable_is_down(self):
        p = _payload()
        p["health"]["ha_reachable"] = False
        v = _eval(p)
        assert v["level"] == fh.LEVEL_DOWN
        assert any(i["code"] == "ha_unreachable" for i in v["issues"])

    def test_zigbee_coordinator_failure_is_down_and_actionable(self):
        p = _payload()
        p["health"]["coordinator_state"] = "setup_retry"
        v = _eval(p)
        assert v["level"] == fh.LEVEL_DOWN
        assert "recover-ha" in v["actionable"]

    def test_hub_alive_but_ha_dead_is_distinct_from_hub_silent(self):
        """Different remedies: restart HA vs go look at the box."""
        p = _payload()
        p["health"]["ha_reachable"] = False
        alive = _eval(p, seen_s_ago=60)
        dead = _eval(_payload(), seen_s_ago=fh.SILENCE_DOWN_S + 1)
        assert {i["code"] for i in alive["issues"]} != {i["code"] for i in dead["issues"]}


class TestTheFalseLostSignature:
    def test_whole_registry_lost_is_flagged_as_bad_reconcile(self):
        """The 2026-08-09 incident, exactly as it appeared on the wire."""
        p = _payload()
        p["health"]["registry"] = {"total": 23, "lost": 23, "connected": 0}
        v = _eval(p)
        assert v["level"] == fh.LEVEL_DEGRADED
        issue = next(i for i in v["issues"] if i["code"] == "devices_mass_lost")
        assert "removed from the hub" in issue["message"]
        assert "reconcile" in v["actionable"], "must map to the verb that fixes it"

    def test_a_couple_of_lost_devices_is_the_milder_issue(self):
        p = _payload()
        p["health"]["registry"] = {"total": 23, "lost": 2, "connected": 21}
        v = _eval(p)
        codes = [i["code"] for i in v["issues"]]
        assert "devices_lost" in codes and "devices_mass_lost" not in codes

    def test_tiny_home_with_all_lost_does_not_trip_the_mass_rule(self):
        p = _payload()
        p["health"]["registry"] = {"total": 2, "lost": 2, "connected": 0}
        v = _eval(p)
        assert not any(i["code"] == "devices_mass_lost" for i in v["issues"])


class TestDevicesOffline:
    def test_one_offline_device_is_minor(self):
        p = _payload()
        p["health"]["devices"] = {"total": 23, "offline": 1}
        v = _eval(p)
        assert v["level"] == fh.LEVEL_DEGRADED
        assert any(i["code"] == "devices_offline" for i in v["issues"])

    def test_most_devices_offline_reads_as_infrastructure(self):
        p = _payload()
        p["health"]["devices"] = {"total": 23, "offline": 20}
        v = _eval(p)
        assert any(i["code"] == "devices_offline_many" for i in v["issues"])
        assert "recover-ha" in v["actionable"]


class TestHostAndContainers:
    def test_broken_container_is_down(self):
        v = _eval(_payload(container_health=[
            {"name": "ziggy-zigbee2mqtt-1", "status": "exited (1)"},
            {"name": "ziggy-ziggy-1", "status": "Up 3 hours"},
        ]))
        assert v["level"] == fh.LEVEL_DOWN
        issue = next(i for i in v["issues"] if i["code"] == "container_unhealthy")
        assert issue["detail"]["container"] == "ziggy-zigbee2mqtt-1"

    def test_healthy_containers_raise_nothing(self):
        v = _eval(_payload(container_health=[
            {"name": "ziggy-ziggy-1", "status": "Up 19 hours"},
            {"name": "ziggy-homeassistant-1", "status": "running (healthy)"},
        ]))
        assert v["level"] == fh.LEVEL_OK

    def test_full_disk_is_down_because_databases_corrupt(self):
        v = _eval(_payload(disk_pct_used=96.0))
        assert v["level"] == fh.LEVEL_DOWN
        assert any(i["code"] == "disk_critical" for i in v["issues"])

    def test_filling_disk_is_a_warning(self):
        v = _eval(_payload(disk_pct_used=88.0))
        assert v["level"] == fh.LEVEL_DEGRADED

    def test_memory_pressure_flagged(self):
        assert any(i["code"] == "memory_pressure"
                   for i in _eval(_payload(mem_pct=95.0))["issues"])

    def test_recent_reboot_is_surfaced_as_context(self):
        """The power cut that started it all — worth seeing, since devices
        often fail to come back after one."""
        v = _eval(_payload(system_uptime_s=300))
        assert any(i["code"] == "recently_rebooted" for i in v["issues"])


class TestReleaseDrift:
    def test_drifted_hub_is_degraded_with_the_reason(self):
        v = _eval(_payload(deploy={
            "known": True, "drifted": True,
            "drift_reason": "uncommitted local changes (105 files) — updater is blocked",
            "git_sha": "dev", "cohort": "production",
        }))
        assert v["level"] == fh.LEVEL_DEGRADED
        issue = next(i for i in v["issues"] if i["code"] == "release_drift")
        assert "105 files" in issue["message"]

    def test_clean_hub_has_no_drift_issue(self):
        assert not any(i["code"] == "release_drift" for i in _eval(_payload())["issues"])


class TestOldHubsAreNotAssumedHealthy:
    def test_payload_without_health_block_is_unknown(self):
        """A hub on a pre-fleet-health build reports cpu/mem and nothing else.
        It must NOT be counted as ok — that is precisely the blind spot."""
        v = _eval({"ha_version": "2026.6.1", "cpu_pct": 5.0, "mem_pct": 40.0})
        assert v["level"] == fh.LEVEL_UNKNOWN
        assert any(i["code"] == "no_health_telemetry" for i in v["issues"])


class TestVersionConvergence:
    """The canary hub follows main and is therefore ahead of the newest tag
    nearly all the time. Reporting that as a fleet split put a permanent warning
    on the front page for a hub doing exactly what it was told."""

    def _home(self, name, tag):
        return {"name": name, "vitals": {"release_tag": tag}}

    def test_canary_running_past_the_tag_is_still_converged(self):
        roll = fh.version_rollup([
            self._home("Canary Home", "release-2026.08.11-5-1-gc97d6cd"),
            self._home("David's Home", "release-2026.08.11-5"),
            self._home("Tslil's Home", "release-2026.08.11-5"),
        ])
        assert roll["converged"] is True
        assert roll["majority"] == "release-2026.08.11-5"
        assert roll["ahead"] == {"Canary Home": 1}

    def test_a_genuine_split_is_still_reported(self):
        roll = fh.version_rollup([
            self._home("A", "release-2026.08.11-5"),
            self._home("B", "release-2026.07.23"),
        ])
        assert roll["converged"] is False
        assert roll["distinct"] == 2

    def test_a_home_with_no_version_blocks_convergence(self):
        """Unknown is not the same as fine."""
        roll = fh.version_rollup([
            self._home("A", "release-2026.08.11-5"),
            self._home("B", None),
        ])
        assert roll["converged"] is False

    @pytest.mark.parametrize("raw, expected", [
        ("release-2026.08.11-5-1-gc97d6cd", ("release-2026.08.11-5", 1)),
        ("release-2026.08.11-5-12-gabc1234", ("release-2026.08.11-5", 12)),
        ("release-2026.08.11-5", ("release-2026.08.11-5", 0)),
        ("release-2026.07.23", ("release-2026.07.23", 0)),
        (None, (None, 0)),
    ])
    def test_base_release_parsing(self, raw, expected):
        assert fh.base_release(raw) == expected

    def test_a_dated_tag_is_not_mistaken_for_a_describe_suffix(self):
        """release-2026.08.11-5 ends in '-5'; that is part of the tag, not a
        commit count, and must survive parsing intact."""
        assert fh.base_release("release-2026.08.11-5")[0] == "release-2026.08.11-5"


class TestSeverityAndRollup:
    def test_worst_issue_sets_the_level_but_all_are_reported(self):
        p = _payload(disk_pct_used=88.0)
        p["health"]["ha_reachable"] = False
        v = _eval(p)
        assert v["level"] == fh.LEVEL_DOWN
        assert len(v["issues"]) >= 2
        assert "+" in v["headline"] and "more" in v["headline"]

    def test_summary_rolls_up_worst_first(self):
        s = fh.summarize([
            {"home_id": "a", "level": fh.LEVEL_OK},
            {"home_id": "b", "level": fh.LEVEL_DEGRADED},
            {"home_id": "c", "level": fh.LEVEL_DOWN},
        ])
        assert s["level"] == fh.LEVEL_DOWN
        assert s["total"] == 3
        assert set(s["needs_attention"]) == {"b", "c"}

    def test_all_healthy_fleet_summarizes_ok(self):
        s = fh.summarize([{"home_id": "a", "level": fh.LEVEL_OK}])
        assert s["level"] == fh.LEVEL_OK
        assert s["needs_attention"] == []


class TestRobustness:
    @pytest.mark.parametrize("payload", [
        None, {}, {"health": None}, {"health": {"devices": "nonsense"}},
        {"container_health": ["not-a-dict"]}, {"disk_pct_used": "many"},
        {"health": {"registry": {"total": None, "lost": None}}},
    ])
    def test_garbage_payloads_never_raise(self, payload):
        v = _eval(payload)
        assert v["level"] in (fh.LEVEL_OK, fh.LEVEL_DEGRADED, fh.LEVEL_DOWN, fh.LEVEL_UNKNOWN)

    def test_malformed_timestamp_treated_as_never_seen(self):
        v = fh.evaluate(_home(), _payload(), "not-a-date", now=NOW)
        assert v["level"] == fh.LEVEL_UNKNOWN
