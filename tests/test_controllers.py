"""Stateless button/scene controllers (Aqara H1M and friends).

A controller emits events and holds no state, so it produces no user-facing HA
entity — Z2M registers each button as an MQTT *device trigger* instead. Ziggy's
device list is built from visible HA states, so before this module such a device
paired perfectly and then appeared nowhere (see the WXKG22LM on Canary).

These tests lock the three things that gap needs: parsing Z2M's retained
discovery into a controller model, presenting it as a normal device card, and
compiling a button into an HA trigger that actually fires.
"""
from __future__ import annotations

import pytest

from services import controllers as C


IEEE = "0x54ef441001782d71"
TOPIC_BASE = f"homeassistant/device_automation/{IEEE}"


def _disc(subtype: str, *, name: str = IEEE, model: str = "WXKG22LM") -> tuple[str, dict]:
    """One retained Z2M device-trigger discovery message, as published on Canary."""
    return (
        f"{TOPIC_BASE}/action_{subtype}/config",
        {
            "automation_type": "trigger",
            "type": "action",
            "subtype": subtype,
            "topic": f"zigbee2mqtt/{IEEE}/action",
            "payload": subtype,
            "device": {
                "identifiers": [f"zigbee2mqtt_{IEEE}"],
                "manufacturer": "Aqara",
                "model": "Wireless remote switch H1M (double rocker)",
                "model_id": model,
                "name": name,
            },
        },
    )


def _h1m(**kw) -> list[tuple[str, dict]]:
    return [_disc(s, **kw) for s in ("single_left", "single_right", "double_left", "hold_left")]


# ── Discovery parsing ──────────────────────────────────────────────────────

def test_parses_z2m_device_triggers_into_one_controller():
    got = C.parse_discovery(_h1m())
    assert len(got) == 1
    c = got[0]
    assert c["ieee"] == IEEE
    assert c["model_id"] == "WXKG22LM"
    assert c["manufacturer"] == "Aqara"
    assert [a["subtype"] for a in c["actions"]] == [
        "single_left", "double_left", "hold_left", "single_right",
    ], "actions sort by button then gesture so the UI reads left-to-right"


def test_each_action_carries_the_topic_and_payload_needed_to_trigger():
    c = C.parse_discovery(_h1m())[0]
    a = next(a for a in c["actions"] if a["subtype"] == "single_left")
    assert a["topic"] == f"zigbee2mqtt/{IEEE}/action"
    assert a["payload"] == "single_left"


def test_ignores_non_trigger_discovery_messages():
    noise = [
        (f"homeassistant/sensor/{IEEE}/battery/config", {"name": "Battery"}),
        (f"homeassistant/select/{IEEE}/click_mode/config", {"name": "Click mode"}),
    ]
    assert C.parse_discovery(noise + _h1m()) == C.parse_discovery(_h1m())


def test_empty_retained_payload_removes_the_trigger():
    """Z2M clears a discovery topic by publishing an empty retained payload."""
    msgs = _h1m() + [(f"{TOPIC_BASE}/action_hold_left/config", None)]
    c = C.parse_discovery(msgs)[0]
    assert "hold_left" not in [a["subtype"] for a in c["actions"]]


def test_malformed_discovery_does_not_sink_the_batch():
    msgs = [("homeassistant/device_automation/x/y/config", {"automation_type": "trigger"})] + _h1m()
    assert len(C.parse_discovery(msgs)) == 1


# ── Naming ─────────────────────────────────────────────────────────────────

def test_unnamed_controller_falls_back_to_a_human_model_name():
    """Z2M names an un-renamed device by its raw address; never show that."""
    c = C.parse_discovery(_h1m())[0]
    assert c["name"] == "Wireless remote switch H1M (double rocker)"
    assert IEEE not in c["name"]


def test_user_given_name_wins():
    c = C.parse_discovery(_h1m(name="Hallway Switch"))[0]
    assert c["name"] == "Hallway Switch"


# ── Device-card projection ─────────────────────────────────────────────────

def test_controller_becomes_a_device_group_the_frontend_can_render():
    g = C.controller_groups(C.parse_discovery(_h1m()))[0]
    assert g["card_kind"] == "controller"
    assert g["group_id"] == f"controller_{IEEE}"
    assert g["kind"] == "controller"
    assert g["primary_entity_id"] is None, "a controller has no entity — that is the point"
    assert g["status"] == "connected"
    assert len(g["actions"]) == 4


def test_controller_group_carries_no_phantom_room():
    """Room assignment is user-driven; a device must never invent one."""
    assert C.controller_groups(C.parse_discovery(_h1m()))[0]["room"] is None


# ── Trigger compilation ────────────────────────────────────────────────────

def test_button_compiles_to_an_mqtt_trigger_that_refires_on_every_press():
    t = C.trigger_for(IEEE, "single_left", C.parse_discovery(_h1m()))
    assert t == {
        "platform": "mqtt",
        "topic": f"zigbee2mqtt/{IEEE}/action",
        "payload": "single_left",
    }


def test_unknown_button_is_refused_rather_than_silently_dead():
    with pytest.raises(C.UnknownAction):
        C.trigger_for(IEEE, "quadruple_left", C.parse_discovery(_h1m()))


def test_unknown_controller_is_refused():
    with pytest.raises(C.UnknownController):
        C.trigger_for("0xdeadbeef", "single_left", C.parse_discovery(_h1m()))


# ── Labelling (the Ziggy-language layer) ───────────────────────────────────

@pytest.mark.parametrize("subtype,expected", [
    ("single_left",  "Left button — single press"),
    ("double_right", "Right button — double press"),
    ("hold_both",    "Both buttons — long press"),
    ("single",       "Single press"),
    ("triple_left",  "Left button — triple press"),
])
def test_actions_are_labelled_in_plain_language(subtype, expected):
    assert C.action_label(subtype) == expected


def test_unrecognised_action_still_gets_a_readable_label():
    assert C.action_label("shake") == "Shake"


def test_no_label_leaks_zigbee_vocabulary():
    """Ziggy is the only product surface — no entity_ids, no z2m jargon."""
    for a in C.parse_discovery(_h1m())[0]["actions"]:
        assert "_" not in a["label"]
        assert IEEE not in a["label"]


# ── Z2M bridge/devices: the complete button list ───────────────────────────
# Discovery only registers a button the FIRST TIME it is physically pressed, so
# a freshly paired remote would otherwise present zero buttons. The exposes
# block lists every action the device can ever emit — that is the real source.

ALL_ACTIONS = [
    "single_left", "single_right", "single_both",
    "double_left", "double_right", "double_both",
    "triple_left", "triple_right", "triple_both",
    "hold_left", "hold_right", "hold_both",
]


def _bridge_device(friendly: str = IEEE, *, actions=None, extra_exposes=None) -> dict:
    """One entry of Z2M's retained bridge/devices, matching Canary's real shape."""
    exposes = [
        {"type": "numeric", "name": "battery", "property": "battery", "access": 1},
        {"type": "enum", "name": "click_mode", "property": "click_mode", "access": 7,
         "values": ["fast", "multi"]},
    ]
    if actions is not None:
        exposes.append({"type": "enum", "name": "action", "property": "action",
                        "access": 1, "values": list(actions)})
    exposes.extend(extra_exposes or [])
    return {
        "ieee_address": IEEE,
        "friendly_name": friendly,
        "type": "EndDevice",
        "supported": True,
        "disabled": False,
        "interview_completed": True,
        "manufacturer": "Aqara",
        "model_id": "WXKG22LM",
        "definition": {
            "model": "WXKG22LM",
            "vendor": "Aqara",
            "description": "Wireless remote switch H1M (double rocker)",
            "exposes": exposes,
        },
    }


def test_bridge_devices_yields_every_button_not_just_the_pressed_ones():
    got = C.parse_bridge_devices([_bridge_device(actions=ALL_ACTIONS)])
    assert len(got) == 1
    assert sorted(a["subtype"] for a in got[0]["actions"]) == sorted(ALL_ACTIONS)


def test_device_without_an_action_expose_is_not_a_controller():
    """A bulb must not become a controller card."""
    assert C.parse_bridge_devices([_bridge_device(actions=None)]) == []


def test_bridge_trigger_topic_follows_the_z2m_friendly_name():
    c = C.parse_bridge_devices([_bridge_device(friendly="Hallway Switch", actions=ALL_ACTIONS)])[0]
    a = next(a for a in c["actions"] if a["subtype"] == "single_left")
    assert a["topic"] == "zigbee2mqtt/Hallway Switch/action"
    assert a["payload"] == "single_left"


def test_bridge_uses_the_description_for_an_unnamed_device():
    c = C.parse_bridge_devices([_bridge_device(actions=ALL_ACTIONS)])[0]
    assert c["name"] == "Wireless remote switch H1M (double rocker)"


def test_uninterviewed_device_is_skipped():
    d = _bridge_device(actions=ALL_ACTIONS)
    d["interview_completed"] = False
    assert C.parse_bridge_devices([d]) == []


def test_disabled_device_is_skipped():
    d = _bridge_device(actions=ALL_ACTIONS)
    d["disabled"] = True
    assert C.parse_bridge_devices([d]) == []


def test_bridge_ignores_the_coordinator():
    coord = {"ieee_address": "0x70d0", "friendly_name": "Coordinator",
             "type": "Coordinator", "interview_completed": True}
    assert C.parse_bridge_devices([coord]) == []


def test_nested_action_expose_is_found():
    """Multi-endpoint remotes nest exposes one level under a composite."""
    nested = {"type": "composite", "features": [
        {"type": "enum", "name": "action", "property": "action",
         "access": 1, "values": ["single", "double"]}]}
    c = C.parse_bridge_devices([_bridge_device(actions=None, extra_exposes=[nested])])[0]
    assert sorted(a["subtype"] for a in c["actions"]) == ["double", "single"]


# ── Merging the two sources ────────────────────────────────────────────────

def test_merge_prefers_the_complete_bridge_action_list():
    """Discovery knows 4 buttons, the bridge knows all 12 — keep 12."""
    merged = C.merge(
        C.parse_bridge_devices([_bridge_device(actions=ALL_ACTIONS)]),
        C.parse_discovery(_h1m()),
    )
    assert len(merged) == 1
    assert len(merged[0]["actions"]) == len(ALL_ACTIONS)


def test_merge_keeps_a_discovery_only_controller():
    """A non-Z2M MQTT controller has no bridge entry — it must still appear."""
    merged = C.merge([], C.parse_discovery(_h1m()))
    assert [c["ieee"] for c in merged] == [IEEE]


def test_merge_prefers_a_real_name_over_a_model_fallback():
    merged = C.merge(
        C.parse_bridge_devices([_bridge_device(actions=ALL_ACTIONS)]),
        C.parse_discovery(_h1m(name="Hallway Switch")),
    )
    assert merged[0]["name"] == "Hallway Switch"


def test_merged_controller_can_trigger_a_never_pressed_button():
    """The regression that matters: hold_both was never pressed, must still work."""
    merged = C.merge(
        C.parse_bridge_devices([_bridge_device(actions=ALL_ACTIONS)]),
        C.parse_discovery(_h1m()),
    )
    t = C.trigger_for(IEEE, "hold_both", merged)
    assert t["payload"] == "hold_both"
    assert t["platform"] == "mqtt"


# ── Home Assistant identity ────────────────────────────────────────────────
# A controller has no HA *entity*, but MQTT discovery does create an HA
# *device* — and that device row is where the user's own name and room
# assignment live. Without reading it back, the card shows the model name and
# "No Room" while HA holds "Wall switch" in the living room, and rename / room
# assignment fail outright because they need the HA device_id to PATCH.

HA_DEVICE = {
    "id": "dfa43c28740c4a9fe1680b012a50eda2",
    "name": IEEE,
    "name_by_user": "Wall switch",
    "identifiers": [["mqtt", f"zigbee2mqtt_{IEEE}"]],
    "area_id": "living_room",
    "manufacturer": "Aqara",
    "model": "Wireless remote switch H1M (double rocker)",
}


def test_ha_registry_index_maps_address_to_device():
    idx = C.index_ha_devices([HA_DEVICE])
    assert idx[IEEE]["device_id"] == "dfa43c28740c4a9fe1680b012a50eda2"
    assert idx[IEEE]["name"] == "Wall switch"
    assert idx[IEEE]["area_id"] == "living_room"


def test_index_ignores_devices_without_a_z2m_identifier():
    assert C.index_ha_devices([{"id": "x", "identifiers": [["hue", "abc"]]}]) == {}


def test_index_tolerates_flat_identifier_tuples():
    """HA serialises identifiers as lists; be forgiving about the shape."""
    idx = C.index_ha_devices([{**HA_DEVICE, "identifiers": [f"zigbee2mqtt_{IEEE}"]}])
    assert IEEE in idx


def test_index_prefers_user_name_over_ha_default_name():
    idx = C.index_ha_devices([HA_DEVICE])
    assert idx[IEEE]["name"] == "Wall switch"
    assert idx[IEEE]["name"] != IEEE


def test_index_skips_a_name_that_is_just_the_address():
    idx = C.index_ha_devices([{**HA_DEVICE, "name_by_user": None}])
    assert idx[IEEE]["name"] is None, "a raw address is not a name"


def test_apply_ha_registry_adopts_name_room_and_device_id():
    c = C.apply_ha_registry(C.parse_bridge_devices([_bridge_device(actions=ALL_ACTIONS)]),
                            C.index_ha_devices([HA_DEVICE]))[0]
    assert c["name"] == "Wall switch"
    assert c["room"] == "living_room"
    assert c["ha_device_id"] == "dfa43c28740c4a9fe1680b012a50eda2"


def test_user_name_in_ha_beats_the_model_fallback():
    c = C.apply_ha_registry(C.parse_discovery(_h1m()), C.index_ha_devices([HA_DEVICE]))[0]
    assert c["name"] == "Wall switch"


def test_controller_unknown_to_ha_keeps_working_with_no_room():
    """HA WS down, or a controller HA hasn't discovered — still usable."""
    c = C.apply_ha_registry(C.parse_bridge_devices([_bridge_device(actions=ALL_ACTIONS)]), {})[0]
    assert c["ha_device_id"] is None
    assert c["room"] is None
    assert c["actions"], "buttons must survive an HA outage"


def test_group_carries_the_ha_device_id_so_rename_and_room_can_patch():
    g = C.controller_groups(
        C.apply_ha_registry(C.parse_bridge_devices([_bridge_device(actions=ALL_ACTIONS)]),
                            C.index_ha_devices([HA_DEVICE])))[0]
    assert g["ha_device_id"] == "dfa43c28740c4a9fe1680b012a50eda2"
    assert g["room"] == "living_room"
    assert g["name"] == "Wall switch"


def test_group_without_ha_identity_still_renders():
    g = C.controller_groups(C.parse_bridge_devices([_bridge_device(actions=ALL_ACTIONS)]))[0]
    assert g["ha_device_id"] is None
    assert g["room"] is None
