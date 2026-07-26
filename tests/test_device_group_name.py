"""Device-card name derivation — a sensor's card should read as the DEVICE,
not "<device> <role>" (e.g. a contact sensor named "Kitchen Window" must not
show as "Kitchen Window Door")."""
from services.device_groups import _group_name


def _p(display):
    return {"display_name": display}


def test_ha_device_name_wins_verbatim():
    # When the user named the HA device, use it as-is (don't strip anything).
    assert _group_name([], _p("Kitchen Window Door"), "Kitchen Window") == "Kitchen Window"


def test_fallback_strips_door_role():
    assert _group_name([], _p("Kitchen Window Door"), None) == "Kitchen Window"


def test_fallback_strips_occupancy_and_motion():
    assert _group_name([], _p("Hallway Motion Occupancy"), None) == "Hallway Motion"
    assert _group_name([], _p("Garden Motion"), None) == "Garden"


def test_fallback_strips_metric_roles_too():
    assert _group_name([], _p("Boiler Power"), None) == "Boiler"
    assert _group_name([], _p("Fridge Temperature"), None) == "Fridge"


def test_does_not_over_strip_real_name():
    # "Window" is part of the device name, never a role — must survive.
    assert _group_name([], _p("Kitchen Window"), None) == "Kitchen Window"
    assert _group_name([], _p("Front Door"), "Front Door") == "Front Door"


def test_empty_falls_back_to_device_label():
    assert _group_name([], {"entity_id": "binary_sensor.x"}, None)  # non-empty
