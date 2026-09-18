"""The designer's catalog must tell the truth in BOTH directions.

On 2026-09-18 the catalog said `zone` was unsupported while the converter had
handled it for months, so chat refused arrivals that the app builds in two
taps. The old drift check only looked one way (catalog-yes / converter-no).
"""
from services import automation_catalog as C
from services import ha_automations as HA
from services import local_automation_actions as laa


def _by_id(kind):
    return {c["id"]: c for c in C.get_catalog()["ha_capabilities"][kind]}


def test_no_drift_in_any_direction():
    d = C.detect_drift()
    assert d == {k: [] for k in d}, d
    assert {"converter_supports_but_catalog_declines", "catalog_entry_missing_for_converter"} <= set(d)


def test_trigger_support_is_computed_from_the_converter():
    t = _by_id("triggers")
    for tid in ("state", "numeric_state", "time", "sunrise", "sunset", "zone", "time_pattern", "controller"):
        assert t[tid]["ziggy_supported"] is True, tid
    for tid in ("template", "calendar", "tag", "device", "event"):
        assert t[tid]["ziggy_supported"] is False, tid
    # webhook: converter exists, declined by POLICY (security review) — allowed drift
    assert t["webhook"]["ziggy_supported"] is False
    assert t["webhook"].get("policy_declined") is True


def test_condition_and_action_support():
    c = _by_id("conditions")
    for cid in ("state", "numeric_state", "time_window", "sun", "mode", "presence"):
        assert c[cid]["ziggy_supported"] is True, cid
    a = _by_id("actions")
    for aid in ("call_service", "delay", "notify", "wait_for_state", "set_mode", "turn_off_all_lights", "ir_command"):
        assert a[aid]["ziggy_supported"] is True, aid


def test_ziggy_native_triggers_listed():
    native = C.get_catalog()["ziggy_native"]
    ids = {n["id"] for n in native}
    assert {"person_arrives", "person_leaves", "all_persons_left", "zone_entered", "manual"} <= ids


def test_gaps_only_list_true_gaps():
    ids = {(g["kind"], g["id"]) for g in C.get_gaps()}
    assert ("trigger", "zone") not in ids and ("condition", "sun") not in ids
    assert ("trigger", "calendar") in ids and ("trigger", "webhook") in ids


def test_supported_only_keeps_partial_and_true():
    sup = C.get_supported_only()
    ids = {t["id"] for t in sup["ha_capabilities"]["triggers"]}
    assert "zone" in ids and "controller" in ids and "calendar" not in ids


def test_sun_condition_both_evaluators(monkeypatch):
    assert HA._condition_to_ha({"type": "sun", "after": "sunset"}) == {"condition": "sun", "after": "sunset"}
    assert HA._condition_to_ha({"type": "sun"}) is None
    monkeypatch.setattr("services.ha_subscriber.state_cache", {"sun.sun": {"state": "below_horizon"}})
    ok, _ = laa._eval_single_condition({"type": "sun", "after": "sunset"})
    assert ok
    ok, _ = laa._eval_single_condition({"type": "sun", "before": "sunset"})
    assert not ok
    monkeypatch.setattr("services.ha_subscriber.state_cache", {})
    ok, why = laa._eval_single_condition({"type": "sun", "after": "sunset"})
    assert not ok and "unknown" in why
