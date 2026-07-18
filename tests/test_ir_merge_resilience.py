"""Merged IR+WiFi card must survive the smart side going offline.

The whole point of linking an IR remote to a Wi-Fi device (e.g. a TV) is to
power the device ON via IR when it's off and unreachable over Wi-Fi. So when
the Wi-Fi entity drops out of HA (TV powered off), the merged card must keep
rendering its IR controls — never collapse to an empty card. Generic across
integrations: nothing here is TV/webOS-specific.
"""
import backend.routers.device_router as dr


def test_hybrid_card_renders_ir_controls_when_wifi_entity_offline(monkeypatch):
    # Wi-Fi entity is offline: not in the state cache.
    monkeypatch.setattr(dr, "get_all_states", lambda: [])
    import services.ha_subscriber as sub
    monkeypatch.setattr(sub, "state_cache", {}, raising=False)

    fake_ir = {
        "id": "ir_1", "name": "Living Room TV", "type": "tv",
        "ha_entity_id": "media_player.any_tv",
        "commands": {"power": "..."}, "learned_commands": ["power"],
        "assumed_state": "off", "capabilities": ["power"],
    }
    import services.ir_manager as irm
    monkeypatch.setattr(irm, "list_ir_devices", lambda enabled_only=True: [fake_ir])
    monkeypatch.setattr(irm, "get_ir_device", lambda _id: fake_ir)
    import services.entity_prefs as ep
    monkeypatch.setattr(ep, "get_all", lambda: {})

    # A HYBRID registry row: both the Wi-Fi entity_id AND the linked IR device.
    hybrid_row = {
        "entity_id": "media_player.any_tv",
        "ir_device_id": "ir_1",
        "device_type": "tv",
        "name": "Living Room TV",
        "status": "lost",
    }
    out = dr._enrich_devices_with_ha_state([hybrid_row])
    assert len(out) == 1
    card = out[0]
    # Must expose IR controls (power button) even though Wi-Fi is offline —
    # NOT an empty card.
    attrs = card.get("ha_attributes") or {}
    assert attrs.get("_is_ir") is True, "hybrid card lost its IR controls while offline"
    assert "power" in (attrs.get("commands") or {}), "IR power command missing"
    assert card.get("display_name") == "Living Room TV"
    # Identity preserved so it re-attaches live Wi-Fi state when the TV returns.
    assert card.get("entity_id") == "media_player.any_tv"
