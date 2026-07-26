"""Guards the delete-device flow against nuking a SHARED config entry.

Incident 2026-07-26: deleting one Aqara Zigbee sensor deleted the shared `mqtt`
integration config entry, taking every Zigbee device offline. `_partition_config_entries`
must never mark a hub/bridge entry — or one still backing other devices — as
safe to delete.
"""
from backend.routers.device_router import _partition_config_entries


def _dev(dev_id, *config_entries):
    return {"id": dev_id, "config_entries": list(config_entries)}


def test_mqtt_shared_entry_is_never_deletable():
    # The incident: one mqtt entry backs 20 Zigbee devices; we delete one.
    devices = [_dev(f"d{i}", "mqtt_entry") for i in range(20)]
    safe, blocked = _partition_config_entries(
        {"mqtt_entry"}, devices, target_device_ids={"d0"},
        domain_by_entry={"mqtt_entry": "mqtt"})
    assert safe == set()
    assert blocked == {"mqtt_entry"}


def test_exclusive_single_device_entry_is_deletable():
    # A webOS TV: its own config entry backs only itself → deleting it is correct.
    devices = [_dev("tv", "webos_entry")]
    safe, blocked = _partition_config_entries(
        {"webos_entry"}, devices, target_device_ids={"tv"},
        domain_by_entry={"webos_entry": "webostv"})
    assert safe == {"webos_entry"}
    assert blocked == set()


def test_non_hub_entry_shared_with_other_devices_is_blocked():
    # A non-hub entry that still backs a device we're KEEPING must survive.
    devices = [_dev("keep", "shared"), _dev("drop", "shared")]
    safe, blocked = _partition_config_entries(
        {"shared"}, devices, target_device_ids={"drop"},
        domain_by_entry={"shared": "someintegration"})
    assert safe == set()
    assert blocked == {"shared"}


def test_hub_domain_blocked_even_if_backs_single_device():
    devices = [_dev("only", "zha_entry")]
    safe, blocked = _partition_config_entries(
        {"zha_entry"}, devices, target_device_ids={"only"},
        domain_by_entry={"zha_entry": "zha"})
    assert safe == set()
    assert blocked == {"zha_entry"}


def test_unknown_domain_missing_from_map_is_deletable_if_exclusive():
    # No domain info (e.g. config_entries/list failed) but the entry is exclusive
    # to the target device → still safe (matches the original behavior).
    devices = [_dev("x", "e1")]
    safe, blocked = _partition_config_entries(
        {"e1"}, devices, target_device_ids={"x"}, domain_by_entry={})
    assert safe == {"e1"} and blocked == set()
