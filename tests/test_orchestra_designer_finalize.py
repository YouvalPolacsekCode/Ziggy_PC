"""orchestra_designer.finalize_bundle — the post-model pipeline, no LLM."""
from services import orchestra_designer as OD

HOME = {"rooms": [
    {"id": "kitchen", "name": "Kitchen", "entities": {"light": [{"entity_id": "light.k"}], "motion": [{"entity_id": "binary_sensor.km"}]}},
    {"id": "living_room", "name": "Living Room", "entities": {"light": [{"entity_id": "light.l"}], "motion": [{"entity_id": "binary_sensor.lm"}]}},
    {"id": "entry", "name": "Entry", "entities": {"light": [{"entity_id": "light.e"}], "motion": []}},
]}


def test_rooms_mentioned_en_he_and_living_area():
    assert OD._rooms_mentioned("make the kitchen smart", HOME) == {"kitchen"}
    assert OD._rooms_mentioned("תכין לי מטבח חכם", HOME) == {"kitchen"}
    assert OD._rooms_mentioned("my living area", HOME) == {"living_room", "kitchen"}


def test_finalize_keeps_recipes_and_strips_junk():
    bundle = {"name": "N", "rationale": "R", "language": "en", "decline": None,
              "artifacts": {
                  "recipes": [{"recipe": "smart_room", "room": "kitchen"}, {"recipe": "bogus"}],
                  "kv_state": [{"namespace": "modes", "key": "manual_override", "default": False}],
                  "voice_intents": [{"phrase": "cozy"}],
                  "automations": [
                      {"name": "kitchen empty notify", "source": "custom",
                       "trigger": {"type": "state", "entity_id": "binary_sensor.km", "state": "off", "for_minutes": 10},
                       "conditions": [], "actions": [{"type": "notify", "message": "empty"}]},
                      {"name": "kitchen motion", "source": "custom",
                       "trigger": {"type": "state", "entity_id": "binary_sensor.km", "state": "on"},
                       "conditions": [{"entity_id": "binary_sensor.km", "operator": "is", "value": "on"}],
                       "actions": [{"type": "call_service", "entity_id": "light.k", "service": "turn_on"},
                                   {"type": "call_service", "entity_id": "light.e", "service": "turn_off"},
                                   {"type": "call_service", "entity_id": "light.ghost", "service": "turn_off"}]},
                  ]}}
    res = OD.finalize_bundle(bundle, outcome="make the kitchen smart", home=HOME, lang="en")
    assert res["ok"]
    b = res["bundle"]
    arts = b["artifacts"]
    assert arts["recipes"] == [{"recipe": "smart_room", "room": "kitchen"}]
    assert "kv_state" not in arts and "voice_intents" not in arts
    # the ghost entity dropped the whole "kitchen motion" rule; notify-only rule dropped too
    assert arts["automations"] == []
    whys = " | ".join(n["why"] for n in b["left_out"])
    assert "notification" in whys and "kv_state" in " ".join(n["what"] for n in b["left_out"])
    assert b["bundle_id"].startswith("bundle_") and b["decline"] is None


def test_finalize_scope_and_tautology():
    bundle = {"name": "N", "rationale": "R", "language": "en", "decline": None,
              "artifacts": {"recipes": [], "automations": [
                  {"name": "kitchen motion", "source": "custom",
                   "trigger": {"type": "state", "entity_id": "binary_sensor.km", "state": "on"},
                   "conditions": [{"entity_id": "binary_sensor.km", "operator": "is", "value": "on"}],
                   "actions": [{"type": "call_service", "entity_id": "light.k", "service": "turn_on"},
                               {"type": "call_service", "entity_id": "light.e", "service": "turn_off"}]}]}}
    res = OD.finalize_bundle(bundle, outcome="make the kitchen smart", home=HOME, lang="en")
    a = res["bundle"]["artifacts"]["automations"][0]
    assert a["conditions"] == []
    assert [x["entity_id"] for x in a["actions"]] == ["light.k"]
    assert any("entry" in n["why"] for n in res["bundle"]["left_out"])


def test_finalize_declines_when_nothing_survives():
    bundle = {"name": "N", "rationale": "R", "language": "he", "decline": None,
              "artifacts": {"recipes": [], "automations": [
                  {"name": "x", "source": "custom", "trigger": {"type": "state", "entity_id": "binary_sensor.km", "state": "on"},
                   "actions": [{"type": "notify", "message": "m"}]}]}}
    res = OD.finalize_bundle(bundle, outcome="תכין לי מטבח חכם", home=HOME, lang="he")
    assert res["ok"] and res["bundle"]["decline"]
    assert "Home Assistant" not in res["bundle"]["decline"]


def test_prompt_mentions_recipes_modes_buttons_and_left_out():
    p = OD._SYSTEM_PROMPT_TMPL
    for word in ("smart_room", "motion_light", "welcome_home", "leave_home", "controller",
                 "sleep, movie, cleaning, guest, vacation", "left_out", "respect_hold"):
        assert word in p
    assert "voice_intents" not in p.split("# BUNDLE SCHEMA")[1].split("# CAPABILITY")[0]
