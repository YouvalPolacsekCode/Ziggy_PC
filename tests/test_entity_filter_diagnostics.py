"""Diagnostic Zigbee/Z2M sub-sensors must be hidden from the device list AND the
health 'offline' count.

Regression: `sensor.*_voltage` (and `_linkquality` / `_last_seen`) sit at state
'unknown' until they first report. They were NOT hidden, so the health check
counted their (online) parent device as "offline" — the Home banner said
"1 device offline" but tapping Review filtered the Devices page to nothing,
because the Devices page hides these diagnostics. Hiding them here makes the
count and the list agree.
"""
from services.entity_filter import _should_hide


def test_diagnostic_subsensors_hidden():
    for eid in (
        "sensor.0x00158d008c7d3183_voltage",
        "sensor.0xabc_linkquality",
        "sensor.0xabc_last_seen",
        "sensor.0xabc_battery",
    ):
        assert _should_hide(eid), f"{eid} should be hidden"


def test_real_devices_not_hidden():
    for eid in (
        "light.living_room",
        "sensor.bedroom_temperature",
        "binary_sensor.0xabc_occupancy",
        "switch.kitchen_plug",
        "climate.ac_living_room",
    ):
        assert not _should_hide(eid), f"{eid} should be visible"
