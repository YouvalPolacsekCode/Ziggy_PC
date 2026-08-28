"""Proactive down-device detector — the fixer finding silent devices on its own.

Encodes the truths proven in the 2026-08-28 live fleet scan:
- reachability signal is HA `last_reported` (moves on ANY report), NOT `last_updated`
  (moves only on a state change → false "silent");
- config/diagnostic sub-entities (child_lock, do_not_disturb, …) are noise;
- a media_player `unavailable` is just "off", not down;
- non-controllable domains aren't device-down candidates.
"""
import datetime

from services.down_device_detector import scan_down_devices

UTC = datetime.timezone.utc
NOW = datetime.datetime(2026, 8, 28, 18, 0, tzinfo=UTC)


def _iso(days=0, hours=0):
    return (NOW - datetime.timedelta(days=days, hours=hours)).isoformat()


def _st(eid, state="off", last_reported=None, last_updated=None, name=None):
    return {"entity_id": eid, "state": state,
            "attributes": {"friendly_name": name or eid},
            "last_reported": last_reported, "last_updated": last_updated}


def test_flags_long_silent_light():
    states = [_st("light.0xAAA", "off", last_reported=_iso(days=14), name="Entry Light")]
    down = scan_down_devices(states, NOW, stale_hours=48)
    assert len(down) == 1
    d = down[0]
    assert d["entity_id"] == "light.0xAAA"
    assert d["name"] == "Entry Light"
    assert round(d["silent_hours"]) == 14 * 24


def test_recently_reporting_device_not_flagged():
    states = [_st("light.0xBBB", "on", last_reported=_iso(hours=1))]
    assert scan_down_devices(states, NOW, stale_hours=48) == []


def test_uses_last_reported_not_last_updated():
    # last_updated is ancient (unchanged state) but it reported 1h ago → NOT down.
    states = [_st("light.0xEEE", "off", last_reported=_iso(hours=1),
                  last_updated=_iso(days=14))]
    assert scan_down_devices(states, NOW, stale_hours=48) == []


def test_config_subentity_hidden_is_not_flagged():
    states = [_st("switch.0xAAA_child_lock", "off", last_reported=_iso(days=14),
                  name="Entry Light Child lock")]
    down = scan_down_devices(states, NOW, stale_hours=48,
                             should_hide=lambda e: e.endswith("_child_lock"))
    assert down == []


def test_config_suffix_excluded_without_should_hide():
    states = [_st("switch.0xAAA_do_not_disturb", "off", last_reported=_iso(days=14))]
    assert scan_down_devices(states, NOW, stale_hours=48) == []


def test_media_player_unavailable_is_normal_off():
    states = [_st("media_player.tv", "unavailable", last_reported=_iso(days=14),
                  name="Living Room TV")]
    assert scan_down_devices(states, NOW, stale_hours=48) == []


def test_main_switch_silent_is_flagged():
    states = [_st("switch.0xCCC", "off", last_reported=_iso(days=14), name="Outdoor Watering")]
    down = scan_down_devices(states, NOW, stale_hours=48)
    assert len(down) == 1 and down[0]["entity_id"] == "switch.0xCCC"


def test_falls_back_to_last_updated_when_no_last_reported():
    states = [_st("light.0xDDD", "off", last_reported=None, last_updated=_iso(days=10))]
    down = scan_down_devices(states, NOW, stale_hours=48)
    assert len(down) == 1


def test_non_controllable_domain_ignored():
    states = [_st("sensor.temp", "20", last_reported=_iso(days=14), name="Temp")]
    assert scan_down_devices(states, NOW, stale_hours=48) == []


def test_result_sorted_worst_first():
    states = [
        _st("light.0x1", "off", last_reported=_iso(days=3), name="A"),
        _st("light.0x2", "off", last_reported=_iso(days=14), name="B"),
        _st("light.0x3", "off", last_reported=_iso(days=7), name="C"),
    ]
    down = scan_down_devices(states, NOW, stale_hours=48)
    assert [d["name"] for d in down] == ["B", "C", "A"]
