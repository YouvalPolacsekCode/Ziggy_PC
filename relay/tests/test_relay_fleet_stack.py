"""Stack integrity in the fleet judge.

Why: Matter/Thread ran on the Canary as an optional compose profile. The OTA
updater rebuilt from base + prod only, dropped otbr and matter-server on
2026-08-14, and nothing compared "should run" with "is running" for a month.
The hub's updater now reports both; the relay must call the gap out.
"""
from __future__ import annotations

from relay.app.fleet_health import evaluate, vitals, LEVEL_DOWN, LEVEL_DEGRADED


import datetime as _dt

NOW = 1_000_060.0
HOME = {"home_id": "h1", "name": "Test Home"}
SEEN = _dt.datetime.fromtimestamp(NOW - 60, _dt.timezone.utc).isoformat()


def _payload(stack=None):
    payload = {"ha_version": "2026.6.1", "deploy": {"release_tag": "release-2026.09.18", "cohort": "production"},
               "health": {"level": "ok", "devices": {"total": 10, "offline": 0}}}
    if stack is not None:
        payload["stack"] = stack
    return payload


def _eval(stack=None):
    return evaluate(HOME, _payload(stack), SEEN, now=NOW)


def _codes(res):
    return [i["code"] for i in res.get("issues", [])]


def test_full_stack_is_quiet():
    res = _eval({"expected": ["ziggy", "homeassistant", "mosquitto", "zigbee2mqtt", "otbr", "matter-server"],
                 "running": ["ziggy", "homeassistant", "mosquitto", "zigbee2mqtt", "otbr", "matter-server"],
                 "profiles": "zigbee-z2m,matter"})
    assert not any(c.startswith("stack_") or c.startswith("matter_") for c in _codes(res))


def test_declared_matter_not_running_is_degraded():
    res = _eval({"expected": ["ziggy", "homeassistant", "mosquitto", "zigbee2mqtt", "otbr", "matter-server"],
                 "running": ["ziggy", "homeassistant", "mosquitto", "zigbee2mqtt"],
                 "profiles": "matter"})
    issue = next(i for i in res["issues"] if i["code"] == "stack_service_missing")
    assert issue["level"] == LEVEL_DEGRADED
    assert "otbr" in issue["message"] and "matter-server" in issue["message"]
    assert issue["kind"] == "human"                       # never auto-repaired


def test_core_service_down_is_down():
    res = _eval({"expected": ["ziggy", "homeassistant", "mosquitto", "zigbee2mqtt"],
                 "running": ["ziggy", "homeassistant"], "profiles": ""})
    issue = next(i for i in res["issues"] if i["code"] == "stack_service_down")
    assert issue["level"] == LEVEL_DOWN
    assert res["level"] == LEVEL_DOWN


def test_matter_state_present_but_undeclared_is_called_out():
    """The Canary's exact shape on 2026-09-18: matter-data on disk, no profile declared."""
    res = _eval({"expected": ["ziggy", "homeassistant", "mosquitto", "zigbee2mqtt"],
                 "running": ["ziggy", "homeassistant", "mosquitto", "zigbee2mqtt"],
                 "profiles": "", "matter_data_present": True})
    assert "matter_enabled_not_declared" in _codes(res)


def test_running_but_undeclared_service_is_context_not_a_fault():
    """Every 2026 hub: zigbee2mqtt runs under a profile imaging never wrote to
    ziggy.env. The house works, so the home stays OK — but the risk is named."""
    res = _eval({"declared": ["ziggy", "homeassistant", "mosquitto"],
                 "expected": ["homeassistant", "mosquitto", "zigbee2mqtt", "ziggy"],
                 "running": ["homeassistant", "mosquitto", "zigbee2mqtt", "ziggy"],
                 "undeclared_running": ["zigbee2mqtt"], "profiles": ""})
    issue = next(i for i in res["issues"] if i["code"] == "stack_undeclared_services")
    assert issue["kind"] == "context"
    assert "zigbee2mqtt" in issue["message"]
    assert res["level"] == "ok"


def test_old_hub_without_stack_report_is_not_judged():
    res = _eval(None)
    assert not any(c.startswith("stack_") for c in _codes(res))


def test_vitals_carry_stack_counts():
    v = vitals({"stack": {"expected": ["a", "b", "c"], "running": ["a", "b"], "profiles": "matter"}})
    assert (v["stack_expected"], v["stack_running"], v["stack_profiles"]) == (3, 2, "matter")
    assert vitals({})["stack_expected"] is None
