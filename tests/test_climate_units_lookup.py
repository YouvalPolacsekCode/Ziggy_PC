"""Listing the air conditioners a brand pairing just produced.

One Gree/Tadiran config entry yields ONE HA device per physical unit, keyed by
MAC, each carrying a single climate entity. So Ziggy never has to ask "how many
ACs do you have?" — it counts them. This is what lets the post-pair screen say
"found 4 air conditioners" and hand the user four rooms to fill in.

The same lookup serves the late-arrival case: Gree keeps scanning and adds
units as they come back online (a unit whose Wi-Fi module was reset shows up by
itself), so "climate units with no room yet" is the query that notices them.
"""
from __future__ import annotations

import asyncio

import services.ha_pairing as hp


DEVICES = [
    {"id": "d1", "name": "Salon", "name_by_user": None, "area_id": None,
     "manufacturer": "Gree", "config_entries": ["gree-entry"]},
    {"id": "d2", "name": "AC", "name_by_user": None, "area_id": None,
     "manufacturer": "Gree", "config_entries": ["gree-entry"]},
    {"id": "d3", "name": "Alon", "name_by_user": "Alon's room", "area_id": "kids",
     "manufacturer": "Gree", "config_entries": ["gree-entry"]},
    {"id": "d9", "name": "Hub light", "name_by_user": None, "area_id": None,
     "manufacturer": "IKEA", "config_entries": ["other-entry"]},
]

ENTITIES = [
    {"entity_id": "climate.salon", "device_id": "d1"},
    {"entity_id": "climate.ac_2",  "device_id": "d2"},
    {"entity_id": "climate.alon",  "device_id": "d3"},
    {"entity_id": "light.hub",     "device_id": "d9"},
    # Infrastructure: a Zigbee2MQTT bridge control. Found on a real hub after
    # the lookup was widened past climate — it is not a device anyone puts in
    # a room, and offering it as one is noise at best.
    {"entity_id": "switch.zigbee2mqtt_bridge_permit_join", "device_id": "d2"},
    # A Gree AC also exposes five auxiliary switches. On a real hub this made
    # ONE air conditioner appear as SIX rows, all with the same MAC-derived
    # name, and the customer gave up after configuring one of them.
    {"entity_id": "switch.ac_2_panel_light", "device_id": "d2"},
    {"entity_id": "switch.ac_2_quiet_mode",  "device_id": "d2"},
    {"entity_id": "switch.ac_2_fresh_air",   "device_id": "d2"},
]


def _wire(monkeypatch):
    async def fake_ws(msg):
        t = msg.get("type")
        if t == "config/device_registry/list":
            return ({"result": DEVICES},)
        if t == "config/entity_registry/list":
            return ({"result": ENTITIES},)
        raise AssertionError(f"unexpected ws call {t}")
    monkeypatch.setattr(hp, "_ws", fake_ws)


def test_counts_every_unit_from_the_entry(monkeypatch):
    """Four physical ACs => four rows. This is the number the wizard shows."""
    _wire(monkeypatch)
    out = asyncio.run(hp.climate_units(entry_id="gree-entry"))
    assert out["ok"] is True
    assert len(out["units"]) == 3
    assert {u["entity_id"] for u in out["units"]} == {
        "climate.salon", "climate.ac_2", "climate.alon"}


def test_ignores_devices_from_other_integrations(monkeypatch):
    _wire(monkeypatch)
    out = asyncio.run(hp.climate_units(entry_id="gree-entry"))
    assert all(not u["entity_id"].startswith("light.") for u in out["units"])


def test_carries_the_name_the_unit_reported(monkeypatch):
    """HA names a Gree device from what the unit reports over the local
    protocol — often the name the owner set in the vendor app. When that's
    meaningful we pre-fill it rather than making the user retype it."""
    _wire(monkeypatch)
    out = asyncio.run(hp.climate_units(entry_id="gree-entry"))
    by_id = {u["entity_id"]: u for u in out["units"]}
    assert by_id["climate.salon"]["name"] == "Salon"
    # A user-set name wins over the device-reported one.
    assert by_id["climate.alon"]["name"] == "Alon's room"


def test_reports_which_units_still_need_a_room(monkeypatch):
    _wire(monkeypatch)
    out = asyncio.run(hp.climate_units(entry_id="gree-entry"))
    unassigned = [u["entity_id"] for u in out["units"] if not u["area_id"]]
    assert set(unassigned) == {"climate.salon", "climate.ac_2"}


def test_without_an_entry_id_returns_only_roomless_units(monkeypatch):
    """The late-arrival query: a unit that came back online after pairing has
    no room, and that's how Ziggy notices it needs one."""
    _wire(monkeypatch)
    out = asyncio.run(hp.climate_units())
    assert {u["entity_id"] for u in out["units"]} == {"climate.salon", "climate.ac_2"}


def test_one_row_per_physical_device_not_per_entity(monkeypatch):
    """A Gree AC publishes a climate entity plus five switches. The mapping
    screen asks "which room is this?" — a question about the box on the wall,
    so it must be asked once per box, not once per entity."""
    _wire(monkeypatch)
    out = asyncio.run(hp.paired_units(entry_id="gree-entry"))
    devs = [u["device_id"] for u in out["units"]]
    assert len(devs) == len(set(devs)), f"duplicate rows per device: {devs}"


def test_the_row_carries_the_devices_primary_entity(monkeypatch):
    """When a device has both a climate entity and switches, the row must be
    the climate one — that is what Identify pulses and what the room cares
    about."""
    _wire(monkeypatch)
    out = asyncio.run(hp.paired_units(entry_id="gree-entry"))
    row = next(u for u in out["units"] if u["device_id"] == "d2")
    assert row["entity_id"] == "climate.ac_2"
    assert row["domain"] == "climate"


def test_infrastructure_entities_are_not_offered_as_devices(monkeypatch):
    """Widening this lookup past climate started surfacing bridge plumbing as
    "a device needing a room". Ziggy already has one filter for system
    entities; this must use it rather than grow a second opinion."""
    _wire(monkeypatch)
    out = asyncio.run(hp.paired_units(entry_id="gree-entry"))
    ids = {u["entity_id"] for u in out["units"]}
    assert "switch.zigbee2mqtt_bridge_permit_join" not in ids


def test_never_leaks_the_ha_handler_vocabulary(monkeypatch):
    """The customer bought a Tadiran; HA calls the manufacturer 'Gree'. Neither
    that nor any HA term belongs in a payload the pairing UI renders."""
    _wire(monkeypatch)
    out = asyncio.run(hp.climate_units(entry_id="gree-entry"))
    blob = str(out["units"]).lower()
    for leak in ("gree", "manufacturer", "config_entries", "integration"):
        assert leak not in blob, f"leaked HA vocabulary: {leak}"
