"""Removing an integration, and proving it actually went.

Two real incidents produced this file.

1. Ziggy had no way to remove an integration at all. Deleting its devices one
   at a time goes through delete_ha_entity, whose safety guard (added after a
   2026-07-26 incident) refuses to delete a config entry still backing devices
   you are not removing. With four air conditioners on one Gree entry, every
   single delete saw three others and blocked. The devices lost their
   entities, the entry survived, and the customer's next pairing attempt was
   refused with "already set up" — a zombie entry nobody could clear.

2. The deletion was reported as successful because the caller checked ONE
   layer. `climate-units` returned zero, so it looked clean. The devices were
   still in the registry and so was the entry. A 2xx is not proof, and neither
   is an empty count of whichever layer you happened to query.

So removal here is explicitly layered: entry, then devices, then entities, and
`verify_removed` reads all three back from HA rather than trusting the delete.
"""
from __future__ import annotations

import asyncio

import services.ha_integrations as hi


ENTRIES = [
    {"entry_id": "gree-1", "domain": "gree",  "title": "Gree Climate", "state": "loaded"},
    {"entry_id": "mqtt-1", "domain": "mqtt",  "title": "MQTT",         "state": "loaded"},
]
DEVICES = [
    {"id": "d1", "name": "7cb8e631196e", "config_entries": ["gree-1"]},
    {"id": "d2", "name": "7cb8e6311bd0", "config_entries": ["gree-1"]},
    {"id": "m1", "name": "Bridge",       "config_entries": ["mqtt-1"]},
]
ENTITIES = [
    {"entity_id": "climate.a", "device_id": "d1", "config_entry_id": "gree-1"},
    {"entity_id": "climate.b", "device_id": "d2", "config_entry_id": "gree-1"},
]


def _wire(monkeypatch, entries=None, devices=None, entities=None):
    state = {"entries": entries if entries is not None else ENTRIES,
             "devices": devices if devices is not None else DEVICES,
             "entities": entities if entities is not None else ENTITIES}

    async def fake_ws(msg):
        t = msg.get("type")
        if t == "config_entries/get":
            return ({"success": True, "result": state["entries"]},)
        if t == "config/device_registry/list":
            return ({"result": state["devices"]},)
        if t == "config/entity_registry/list":
            return ({"result": state["entities"]},)
        raise AssertionError(f"unexpected ws {t}")

    monkeypatch.setattr(hi, "_ws", fake_ws)
    return state


# ── Listing ─────────────────────────────────────────────────────────────────

def test_lists_entries_with_how_much_they_own(monkeypatch):
    """Device count is what makes "remove this" an informed decision."""
    _wire(monkeypatch)
    out = asyncio.run(hi.list_integrations())
    by_id = {e["entry_id"]: e for e in out["integrations"]}
    assert by_id["gree-1"]["device_count"] == 2
    assert by_id["mqtt-1"]["device_count"] == 1


# ── Removal ─────────────────────────────────────────────────────────────────

def test_removes_the_whole_entry_in_one_call(monkeypatch):
    """One operation, not N per-device deletes — the N-call route is exactly
    what the shared-entry guard blocks."""
    _wire(monkeypatch)
    called = []
    monkeypatch.setattr(hi, "_delete_entry", lambda eid: called.append(eid) or True)
    out = asyncio.run(hi.remove_integration("gree-1", verify=False))
    assert called == ["gree-1"], "one delete on the entry, not one per device"
    assert out["ok"] is True


def test_refuses_to_remove_infrastructure(monkeypatch):
    """Deleting the MQTT entry would take Zigbee2MQTT and every Zigbee device
    in the house with it."""
    _wire(monkeypatch)
    monkeypatch.setattr(hi, "_delete_entry", lambda eid: (_ for _ in ()).throw(
        AssertionError("must not delete infrastructure")))
    out = asyncio.run(hi.remove_integration("mqtt-1"))
    assert out["ok"] is False
    assert "protected" in (out.get("error") or "").lower()


def test_unknown_entry_is_refused(monkeypatch):
    _wire(monkeypatch)
    out = asyncio.run(hi.remove_integration("nope"))
    assert out["ok"] is False


# ── Verification is the point ───────────────────────────────────────────────

def test_verify_passes_only_when_every_layer_is_clear(monkeypatch):
    _wire(monkeypatch, entries=[ENTRIES[1]], devices=[DEVICES[2]], entities=[])
    out = asyncio.run(hi.verify_removed("gree-1"))
    assert out["removed"] is True
    assert out["entry"] is False and out["devices"] == 0 and out["entities"] == 0


def test_verify_fails_when_the_entry_survives(monkeypatch):
    """The exact production state: entities gone, devices gone, entry alive.
    Counting entities alone would call this a success."""
    _wire(monkeypatch, entries=ENTRIES, devices=[DEVICES[2]], entities=[])
    out = asyncio.run(hi.verify_removed("gree-1"))
    assert out["removed"] is False
    assert out["entry"] is True


def test_verify_fails_when_orphan_devices_remain(monkeypatch):
    """The other half of the same production state: the entry is gone but its
    devices are still in the registry, so the home still lists them."""
    _wire(monkeypatch, entries=[ENTRIES[1]], devices=DEVICES, entities=[])
    out = asyncio.run(hi.verify_removed("gree-1"))
    assert out["removed"] is False
    assert out["devices"] == 2


def test_verify_fails_when_entities_linger_without_their_device(monkeypatch):
    """An entity whose device was already removed still has to be counted —
    otherwise the layer reads empty and the whole check says clean."""
    _wire(monkeypatch, entries=[ENTRIES[1]], devices=[DEVICES[2]], entities=ENTITIES)
    out = asyncio.run(hi.verify_removed("gree-1"))
    assert out["removed"] is False
    assert out["entities"] == 2


def test_remove_reports_the_verification_not_the_http_status(monkeypatch):
    """A 2xx from HA is not proof. If the entry is still there afterwards the
    call must say so rather than returning ok on the strength of the delete."""
    _wire(monkeypatch)   # entry still present on read-back
    monkeypatch.setattr(hi, "_delete_entry", lambda eid: True)
    out = asyncio.run(hi.remove_integration("gree-1", verify=True))
    assert out["ok"] is False
    assert out["verified"]["removed"] is False


# ── Rescan: the way to pick up units that weren't answering ─────────────────

def test_reload_finds_the_entry_for_a_domain(monkeypatch):
    """Gree is single-instance: once the entry exists, starting its flow again
    is refused with "already set up". A customer with six air conditioners
    paired three and had no way to reach the rest — the pairing screen was a
    dead end. Reloading the entry re-runs the integration's own discovery."""
    _wire(monkeypatch)
    called = []

    async def fake_reload(entry_id):
        called.append(entry_id)
        return True

    monkeypatch.setattr(hi, "_reload_entry", fake_reload)
    out = asyncio.run(hi.rescan_domain("gree"))
    assert out["ok"] is True
    assert called == ["gree-1"]


def test_rescan_reports_what_changed(monkeypatch):
    """The answer the user needs is "did that find anything new", so the count
    before and after must both be reported."""
    _wire(monkeypatch)

    async def fake_reload(entry_id):
        return True

    monkeypatch.setattr(hi, "_reload_entry", fake_reload)
    out = asyncio.run(hi.rescan_domain("gree", settle_s=0))
    assert out["devices_before"] == 2
    assert "devices_after" in out


def test_rescan_on_a_domain_with_no_entry_is_refused(monkeypatch):
    _wire(monkeypatch)
    out = asyncio.run(hi.rescan_domain("electrasmart"))
    assert out["ok"] is False
