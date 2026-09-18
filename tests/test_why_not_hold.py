"""why_not + health_speech: a light Ziggy is holding off explains itself."""
import re

from services import why_not as W
from core.agent import health_speech as HS

_BANNED = re.compile(r"home assistant|zigbee|coordinator|mqtt|entity|integration|"
                     r"light\.[a-z0-9_]|binary_sensor\.", re.I)


def _facts(**over):
    base = {
        "entity_id": "light.hall", "hours": 3, "room": "kitchen",
        "device": {"state": "off", "reachable": True, "reported_age_s": 30, "last_intended": None},
        "automations": [], "sensors": [], "occupancy": None, "repairs": [], "hold": None,
    }
    base.update(over)
    return base


def test_light_held_outranks_automation_verdicts_and_phrases_cleanly():
    f = _facts(device={"state": "off", "reachable": True, "last_intended": "on"},
               automations=[{"id": "a", "name": "Kitchen on entry", "enabled": True, "runs": []}],
               hold={"state": "held", "since": 1.0, "until": None, "until_text": None})
    v = W.judge(f)
    assert v[0] == "light_held"
    for lang in ("he", "en"):
        s = HS.describe_why_not(v, f, "Kitchen Light", "kitchen", lang)
        assert s and not _BANNED.search(s)
        assert "Kitchen Light" in s


def test_light_held_until_morning_names_the_time():
    f = _facts(hold={"state": "held_until_morning", "since": 1.0, "until": 2.0, "until_text": "06:30"})
    s = HS.describe_why_not(["light_held"], f, "Kitchen Light", "kitchen", "en")
    assert "06:30" in s
    s_he = HS.describe_why_not(["light_held"], f, "Kitchen Light", "kitchen", "he")
    assert "06:30" in s_he and not _BANNED.search(s_he)


def test_unreachable_still_beats_hold():
    f = _facts(device={"state": "unavailable", "reachable": False, "last_intended": None},
               hold={"state": "held", "since": 1.0, "until": None, "until_text": None})
    assert W.judge(f)[0] == "device_unreachable"


def test_a_light_that_is_on_is_not_held_verdict():
    f = _facts(device={"state": "on", "reachable": True, "last_intended": None},
               hold={"state": "held", "since": 1.0, "until": None, "until_text": None})
    assert "light_held" not in W.judge(f)


def test_gather_facts_carries_hold(monkeypatch, tmp_path):
    from services import local_automation_actions as laa, light_hold as LH
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "s.json"))
    monkeypatch.setattr(LH, "_room_and_occupancy", lambda e: ("kitchen", None))
    monkeypatch.setattr(LH, "_broadcast_hook", lambda p: None)
    LH.on_manual_off("light.hall", now=1.0)
    facts = W.gather_facts("light.hall", 3.0, directory={"devices": [], "presence": []})
    assert facts["hold"]["state"] == "held"
