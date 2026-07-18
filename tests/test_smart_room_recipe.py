"""Unit tests for the deterministic Smart Room recipe.

Locks the sleeping-wife orchestra shape without HA/LLM: occupancy edge-trigger,
day/night time-window + brightness, off-when-empty, degradations. The physical
suppression behavior is validated on the Canary (hardware gate).
"""
import pytest

from services import smart_room_recipe as sr


def _home(occ=True, lights=("light.bedroom",), presence=("binary_sensor.bed_presence",),
          motion=("binary_sensor.bed_motion",)):
    room = {
        "id": "bedroom",
        "entities": {
            "light":    [{"entity_id": e} for e in lights],
            "motion":   [{"entity_id": e} for e in motion],
            "presence": [{"entity_id": e} for e in presence],
        },
        "occupancy_sensor": ({"entity_id": "binary_sensor.bedroom_occupied", "exists": True} if occ else None),
    }
    return {"rooms": [room]}


def test_full_recipe_shape(monkeypatch):
    monkeypatch.setattr(sr, "_light_color_caps", lambda: {"light.bedroom": ["color_temp", "brightness"]})
    r = sr.build_smart_room_bundle("bedroom", home=_home(), language="en")
    assert r["ok"]
    a = r["bundle"]["artifacts"]
    autos = a["automations"]
    assert len(autos) == 3
    day, night, off = autos
    # day: occupancy edge on + daytime window + bright
    assert day["trigger"] == {"type": "state", "entity_id": "binary_sensor.bedroom_occupied", "state": "on"}
    assert day["conditions"] == [{"type": "time", "after": "06:30", "before": "19:00"}]
    assert day["actions"][0]["service_data"]["brightness_pct"] == 100
    # night: same edge, night window, warm + dim (color_temp because the light supports it)
    assert night["conditions"] == [{"type": "time", "after": "19:00", "before": "06:30"}]
    assert night["actions"][0]["service_data"]["brightness_pct"] == 30
    assert night["actions"][0]["service_data"]["color_temp_kelvin"] == 2700
    # off: occupancy off for 5 min
    assert off["trigger"] == {"type": "state", "entity_id": "binary_sensor.bedroom_occupied",
                              "state": "off", "for_minutes": 5}
    assert off["actions"][0]["service"] == "light.turn_off"
    # sleep KV + good night/morning voice
    assert a["kv_state"] == [{"namespace": "modes", "key": "bedroom_sleep", "default": False}]
    assert [v["phrase"] for v in a["voice_intents"]] == ["good night", "good morning"]


def test_night_dim_without_color_temp_support(monkeypatch):
    # A light with no color_temp support gets brightness only — no color key.
    monkeypatch.setattr(sr, "_light_color_caps", lambda: {"light.bedroom": ["onoff"]})
    r = sr.build_smart_room_bundle("bedroom", home=_home(), language="en")
    night = r["bundle"]["artifacts"]["automations"][1]
    assert night["actions"][0]["service_data"] == {"brightness_pct": 30}


def test_multiple_lights_get_one_action_each(monkeypatch):
    monkeypatch.setattr(sr, "_light_color_caps", lambda: {})
    r = sr.build_smart_room_bundle("bedroom", home=_home(lights=("light.a", "light.b")), language="en")
    day = r["bundle"]["artifacts"]["automations"][0]
    assert [x["entity_id"] for x in day["actions"]] == ["light.a", "light.b"]


def test_uses_explicit_occupancy_entity(monkeypatch):
    monkeypatch.setattr(sr, "_light_color_caps", lambda: {})
    r = sr.build_smart_room_bundle("bedroom", occupancy_entity="binary_sensor.custom_occ",
                                   home=_home(occ=False), language="en")
    assert r["ok"]
    assert r["bundle"]["artifacts"]["automations"][0]["trigger"]["entity_id"] == "binary_sensor.custom_occ"


def test_needs_occupancy_when_none(monkeypatch):
    monkeypatch.setattr(sr, "_light_color_caps", lambda: {})
    r = sr.build_smart_room_bundle("bedroom", home=_home(occ=False), language="en")
    assert not r["ok"] and r["needs_occupancy"] is True
    assert r["has_presence"] is True


def test_no_light_declines(monkeypatch):
    monkeypatch.setattr(sr, "_light_color_caps", lambda: {})
    r = sr.build_smart_room_bundle("bedroom", home=_home(lights=()), language="he")
    assert not r["ok"] and r["error"] == "no_lights"
    assert r["bundle"]["decline"]  # Ziggy-native Hebrew decline


def test_motion_only_notes_weaker_guard(monkeypatch):
    monkeypatch.setattr(sr, "_light_color_caps", lambda: {})
    r = sr.build_smart_room_bundle("bedroom", home=_home(presence=()), language="en")
    assert r["ok"]
    assert "no dedicated presence sensor" in r["bundle"]["rationale"]


def test_hebrew_names(monkeypatch):
    monkeypatch.setattr(sr, "_light_color_caps", lambda: {})
    r = sr.build_smart_room_bundle("bedroom", home=_home(), language="he")
    assert r["bundle"]["name"] == "חדר שינה חכם"
    assert [v["phrase"] for v in r["bundle"]["artifacts"]["voice_intents"]] == ["לילה טוב", "בוקר טוב"]
