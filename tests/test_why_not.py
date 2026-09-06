"""services/why_not.judge + health_speech.describe_why_not — the negative causal question."""
import re

from services import why_not as W
from core.agent import health_speech as HS

_BANNED = re.compile(r"home assistant|zigbee|coordinator|mqtt|entity|integration|"
                     r"light\.[a-z0-9_]|binary_sensor\.", re.I)


def _facts(**over):
    base = {
        "entity_id": "light.hall", "hours": 3, "room": "hall",
        "device": {"state": "off", "reachable": True, "reported_age_s": 30, "last_intended": None},
        "automations": [], "sensors": [], "occupancy": None, "repairs": [],
    }
    base.update(over)
    return base


def test_unreachable_wins():
    f = _facts(device={"state": "unavailable", "reachable": False, "last_intended": None},
               automations=[{"id": "a", "name": "Hall on entry", "enabled": True, "runs": []}])
    assert W.judge(f)[0] == "device_unreachable"


def test_latched_sensor_before_automation_verdicts():
    f = _facts(sensors=[{"entity_id": "binary_sensor.hall_motion", "state": "on", "held_s": 40000,
                         "anomalies": ["ANOM-12"]}],
               automations=[{"id": "a", "name": "Hall on entry", "enabled": True, "runs": []}])
    v = W.judge(f)
    assert v[0] == "sensor_latched" and "automation_did_not_trigger" in v


def test_silent_sensor():
    f = _facts(sensors=[{"entity_id": "binary_sensor.x", "state": "off", "anomalies": ["ANOM-10"]}])
    assert "sensor_silent" in W.judge(f)


def test_disabled_and_stopped_and_failed():
    f = _facts(automations=[
        {"id": "a", "name": "A", "enabled": False, "runs": []},
        {"id": "b", "name": "B", "enabled": True, "runs": [{"status": "stopped"}]},
        {"id": "c", "name": "C", "enabled": True, "runs": [{"status": "failed"}]},
    ])
    v = W.judge(f)
    assert v[:3] == ["automation_disabled", "automation_stopped_on_conditions", "automation_failed"]


def test_no_automation_and_manual_override():
    f = _facts(device={"state": "off", "reachable": True, "last_intended": "on"})
    v = W.judge(f)
    assert "no_automation_for_device" in v and "manual_override" in v


def test_unknown_when_nothing_wrong():
    f = _facts(automations=[{"id": "a", "name": "A", "enabled": True, "runs": [{"status": "success"}]}])
    assert W.judge(f) == ["unknown"]


def test_describe_why_not_is_jargon_free_both_languages():
    f = _facts(automations=[{"id": "a", "name": "Hall on entry", "enabled": False, "runs": []}],
               repairs=[{"entity_id": "light.hall", "rung": "nudge", "outcome": "failed"}])
    for lang in ("he", "en"):
        for v in W.VERDICTS:
            msg = HS.describe_why_not([v], f, "המנורה" if lang == "he" else "hall lamp",
                                      "כניסה" if lang == "he" else "hall", lang)
            assert msg and not _BANNED.search(msg), (v, lang, msg)
    he = HS.describe_why_not(["automation_disabled"], f, "המנורה", "כניסה", "he")
    assert "Hall on entry" in he and "כבויה" in he


def test_repair_note_only_for_hardware_verdicts():
    f = _facts(repairs=[{"entity_id": "light.hall", "rung": "nudge", "outcome": "failed"}])
    assert "no luck" in HS.describe_why_not(["device_unreachable"], f, "lamp", "hall", "en")
    assert "no luck" not in HS.describe_why_not(["automation_disabled"], f, "lamp", "hall", "en")
