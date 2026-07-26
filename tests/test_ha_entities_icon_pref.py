"""/api/ha/entities must surface the per-entity tile icon pref.

The device-detail icon picker saves a custom icon via entity_prefs, but the
Devices grid + picker read the store's `entities`, which come from
/api/ha/entities. That endpoint applied custom NAMES but never the icon pref,
so a chosen icon was saved yet never rendered ("clicking does nothing"). This
locks the icon (and is_tile) through onto the entities payload.
"""
import asyncio

import backend.routers.ha_router as hr


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_ha_entities_applies_icon_and_is_tile(monkeypatch):
    import services.ha_subscriber as sub
    monkeypatch.setattr(sub, "state_cache", {
        "light.lounge": {"state": "on", "attributes": {"friendly_name": "Lounge"},
                         "last_changed": ""},
        "switch.fan":   {"state": "off", "attributes": {"friendly_name": "Fan"},
                         "last_changed": ""},
    }, raising=False)
    # No entity filtering / no custom names in this test.
    monkeypatch.setattr(hr, "filter_entities", lambda raw, **kw: raw)
    monkeypatch.setattr(hr, "settings", {"entity_filter": {}, "entity_names": {}})

    import services.entity_prefs as ep
    monkeypatch.setattr(ep, "get_all", lambda: {
        "light.lounge": {"icon": "🛋️", "is_tile": True},
        # switch.fan has no pref → must stay iconless.
    })

    res = _run(hr.ha_entities())
    by_id = {e["entity_id"]: e for e in res["entities"]}
    assert by_id["light.lounge"]["icon"] == "🛋️"
    assert by_id["light.lounge"]["is_tile"] is True
    assert "icon" not in by_id["switch.fan"]


def test_ha_entities_survives_entity_prefs_failure(monkeypatch):
    import services.ha_subscriber as sub
    monkeypatch.setattr(sub, "state_cache", {
        "light.lounge": {"state": "on", "attributes": {}, "last_changed": ""},
    }, raising=False)
    monkeypatch.setattr(hr, "filter_entities", lambda raw, **kw: raw)
    monkeypatch.setattr(hr, "settings", {"entity_filter": {}, "entity_names": {}})
    import services.entity_prefs as ep
    monkeypatch.setattr(ep, "get_all", lambda: (_ for _ in ()).throw(RuntimeError("boom")))

    # Endpoint must still return the entities, just without pref decoration.
    res = _run(hr.ha_entities())
    assert res["entities"][0]["entity_id"] == "light.lounge"
    assert "icon" not in res["entities"][0]
