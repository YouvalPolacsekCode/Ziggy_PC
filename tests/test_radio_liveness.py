"""A device absent from Zigbee2MQTT's own device list has LEFT the hub.

Ground truth, not a heuristic: the coordinator's retained `bridge/devices`.
"""
from services import radio_liveness as rl

OFFICE = "light.0x0070d07effb79f92"       # left (IKEA reset) — Canary 2026-09-16
LAMP = "light.0xa4c138fe4ba31d47"          # present
RENAMED = "light.kitchen_ceiling"          # friendly-named Z2M device
WIFI = "light.shelly_hall"                 # not Zigbee at all

BRIDGE = [
    {"type": "Coordinator", "ieee_address": "0x70d07efffeb13c20"},
    {"type": "Router", "ieee_address": "0xa4c138fe4ba31d47"},
    {"type": "Router", "ieee_address": "0x00b0e8e8ff16f84c"},
]


def test_present_ieees_skips_coordinator():
    assert rl.present_ieees(BRIDGE) == {"0xa4c138fe4ba31d47", "0x00b0e8e8ff16f84c"}


def test_ieee_from_default_entity_id_and_from_ha_registry():
    assert rl.ieee_of_entity(OFFICE) == "0x0070d07effb79f92"
    ents = {RENAMED: {"entity_id": RENAMED, "device_id": "d1", "platform": "mqtt"},
            WIFI: {"entity_id": WIFI, "device_id": "d2", "platform": "shelly"}}
    devs = {"d1": {"id": "d1", "identifiers": [["mqtt", "zigbee2mqtt_0x00B0E8E8FF16F84C"]]},
            "d2": {"id": "d2", "identifiers": [["shelly", "abc"]]}}
    assert rl.ieee_of_entity(RENAMED, ents, devs) == "0x00b0e8e8ff16f84c"
    assert rl.ieee_of_entity(WIFI, ents, devs) is None


def _rows():
    return [
        {"entity_id": OFFICE, "status": "connected", "name": "Office Light"},
        {"entity_id": LAMP, "status": "connected", "name": "Office Lamp"},
        {"entity_id": RENAMED, "status": "connected", "name": "Kitchen"},
        {"entity_id": WIFI, "status": "connected", "name": "Hall"},
    ]


def _ieee_of():
    return {OFFICE: "0x0070d07effb79f92", LAMP: "0xa4c138fe4ba31d47", RENAMED: "0x00b0e8e8ff16f84c"}


def test_judge_marks_only_the_departed_zigbee_device():
    v = rl.judge(_rows(), rl.present_ieees(BRIDGE), _ieee_of())
    assert v["left"] == [OFFICE]
    assert v["back"] == []
    assert v["veto"] is False
    assert v["tracked"] == 3            # the Wi-Fi light is never judged


def test_judge_restores_a_device_that_rejoined():
    rows = _rows()
    rows[0]["status"] = "lost"; rows[0]["lost_reason"] = rl.LEFT_HUB
    present = rl.present_ieees(BRIDGE) | {"0x0070d07effb79f92"}
    v = rl.judge(rows, present, _ieee_of())
    assert v["left"] == [] and v["back"] == [OFFICE]


def test_judge_does_not_re_report_an_already_left_device():
    rows = _rows()
    rows[0]["status"] = "lost"; rows[0]["lost_reason"] = rl.LEFT_HUB
    v = rl.judge(rows, rl.present_ieees(BRIDGE), _ieee_of())
    assert v["left"] == [] and v["back"] == []


def test_mass_loss_is_vetoed():
    """Half the radio vanishing at once is Zigbee2MQTT restarting, not the house."""
    v = rl.judge(_rows(), {"0xa4c138fe4ba31d47"}, _ieee_of())
    assert v["left"] == [OFFICE, RENAMED]
    assert v["veto"] is True


def test_registry_apply_and_restore(tmp_path, monkeypatch):
    from services import device_registry as dr
    monkeypatch.setattr(dr, "REGISTRY_FILE", str(tmp_path / "reg.json"))
    with dr._lock:
        dr._registry = [{"entity_id": OFFICE, "status": "connected", "name": "Office Light"},
                        {"entity_id": LAMP, "status": "connected", "name": "Lamp"}]
    changed = dr.apply_radio_liveness([OFFICE], [])
    row = next(r for r in dr.get_all() if r["entity_id"] == OFFICE)
    assert changed == 1
    assert row["status"] == dr.LOST and row["lost_reason"] == rl.LEFT_HUB and row.get("left_at")
    assert next(r for r in dr.get_all() if r["entity_id"] == LAMP)["status"] == "connected"
    changed = dr.apply_radio_liveness([], [OFFICE])
    row = next(r for r in dr.get_all() if r["entity_id"] == OFFICE)
    assert changed == 1 and row["status"] == dr.CONNECTED and "lost_reason" not in row


def test_anomaly_helpers_raise_and_clear(monkeypatch):
    from services import anomaly_engine as ae
    monkeypatch.setattr(ae, "_cooldown_ok", lambda rid, rule_id, cd: True)
    monkeypatch.setattr(ae, "_is_snoozed", lambda rid, rule_id: False)
    fired, cleared = [], []
    monkeypatch.setattr(ae, "_push_anomaly", lambda active, rid, rule, res: fired.append((rid, rule.rule_id, res.message)))
    monkeypatch.setattr(ae, "_clear_anomaly", lambda active, rid, rule_id: cleared.append((rid, rule_id)))
    ae.raise_left_hub({}, OFFICE, "Office Light")
    assert fired and fired[0][1] == "ANOM-14"
    msg = fired[0][2].lower()
    assert "office light" in msg and "pair" in msg
    for bad in ("battery", "unavailable", "zigbee2mqtt", "0x00"):
        assert bad not in msg
    ae.clear_left_hub({}, OFFICE)
    assert cleared == [(OFFICE, "ANOM-14")]


def test_scheduler_and_prod_wiring():
    src = open("services/ziggy_scheduler.py", encoding="utf-8").read()
    assert "radio_liveness" in src
