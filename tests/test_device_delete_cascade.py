"""Delete-is-final: generic config-entry resolution + IR<->WiFi cascade.

These tests are integration-AGNOSTIC on purpose. The physical-device delete
path must nuke the HA config entry for ANY integration (webostv, samsungtv,
cast, androidtv, roku, shelly, tuya, ...) and must keep working when the device
is powered OFF — the exact case that stranded an LG webOS TV: when the TV is
off, webostv drops its entities from the registry but keeps the device +
config entry, so an entity-keyed lookup finds nothing and the entry survives.
"""
from backend.routers.device_router import _config_entries_to_delete


def _entity(entity_id, device_id=None, config_entry_id=None):
    return {"entity_id": entity_id, "device_id": device_id,
            "config_entry_id": config_entry_id}


def _device(device_id, config_entries):
    return {"id": device_id, "config_entries": config_entries}


def test_online_entity_resolves_its_own_config_entry():
    # Any online device: the entity carries its config_entry_id directly.
    ents = [_entity("media_player.samsung_tv", "dev1", "ce_samsung")]
    devs = [_device("dev1", ["ce_samsung"])]
    ids, device_id = _config_entries_to_delete("media_player.samsung_tv", ents, devs)
    assert ids == {"ce_samsung"}
    assert device_id == "dev1"


def test_online_entity_without_entry_falls_back_to_device_config_entries():
    # Some integrations don't stamp config_entry_id on the entity row; the
    # parent device always lists its config_entries.
    ents = [_entity("media_player.roku", "devR", None)]
    devs = [_device("devR", ["ce_roku"])]
    ids, device_id = _config_entries_to_delete("media_player.roku", ents, devs)
    assert ids == {"ce_roku"}
    assert device_id == "devR"


def test_offline_entity_absent_from_registry_uses_stored_hint():
    # TV powered off: the entity is GONE from the entity registry. Without a
    # stored config_entry_id hint (persisted at link/pair time), delete can't
    # find anything to remove — this is the bug. The hint makes it final.
    ents = []  # entity vanished while device is unreachable
    devs = []  # some integrations also drop the device while offline
    ids, device_id = _config_entries_to_delete(
        "media_player.lg_webos_tv", ents, devs, hint="ce_webos")
    assert ids == {"ce_webos"}


def test_offline_entity_without_hint_yields_nothing_to_delete():
    # Documents the failure mode we are fixing: no entity, no hint -> nothing
    # resolves, and the config entry would survive. The hint is the fix.
    ids, device_id = _config_entries_to_delete("media_player.gone", [], [])
    assert ids == set()
    assert device_id is None
