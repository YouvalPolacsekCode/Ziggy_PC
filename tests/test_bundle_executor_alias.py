"""Bundle executor — stable-alias overwrite contract.

A recipe artifact that carries an `alias` (Smart Room, Circadian…) OWNS its
automation id: re-applying the bundle must overwrite in place by passing an
explicit auto_id to save_automation. Without it, _dedupe_auto_id (meant for
Library re-adds) minted ziggy_smart_room_<room>_day_2 duplicates that fell out
of the room's group card and fired alongside the originals (found live on the
Canary, 2026-07-25). Alias-less (LLM-designed) artifacts keep the dedupe path.
"""

import services.bundle_executor as bx


def _run(monkeypatch, auto):
    calls = []

    def fake_save(data, auto_id=None):
        calls.append({"data": data, "auto_id": auto_id})
        return {"ok": True, "id": auto_id or "generated_id", "source": "ziggy"}

    monkeypatch.setattr(bx, "save_automation", fake_save)
    # Keep the manifest/KV registry out of the filesystem.
    monkeypatch.setattr(bx, "set_local_state", lambda *a, **k: None)
    monkeypatch.setattr(bx, "_persist_manifest", lambda *a, **k: None)

    result = bx.execute_bundle({
        "bundle_id": "bundle_test123",
        "name": "test",
        "artifacts": {"automations": [auto]},
    })
    return result, calls


def test_alias_artifact_overwrites_in_place(monkeypatch):
    result, calls = _run(monkeypatch, {
        "name": "אור נדלק במשרד ביום",          # Hebrew display name
        "alias": "Ziggy Smart Room Office Day",  # stable English identity
        "source": "custom",
        "trigger": {"type": "state", "entity_id": "binary_sensor.x", "state": "on"},
        "actions": [],
    })
    assert result["ok"] is True
    assert len(calls) == 1
    # The alias slug is passed EXPLICITLY → save_automation updates, never dedupes.
    assert calls[0]["auto_id"] == "ziggy_smart_room_office_day"


def test_aliasless_artifact_keeps_dedupe_path(monkeypatch):
    result, calls = _run(monkeypatch, {
        "name": "Some LLM-designed rule",
        "source": "custom",
        "trigger": {"type": "time", "time": "07:00"},
        "actions": [],
    })
    assert result["ok"] is True
    assert len(calls) == 1
    assert calls[0]["auto_id"] is None   # create path → dedupe applies


def test_native_body_reaches_save_automation(monkeypatch):
    """A recipe artifact carrying an HA-native body must have it forwarded.

    The Smart Room Off rule needs a self-healing HA body (periodic re-check +
    vacancy condition) that Ziggy's trigger translator can't express. If the
    executor drops `ha_native_body`, save_automation silently falls back to the
    plain edge trigger and the rule goes back to being blind to a vacancy that
    started before it existed.
    """
    native = {
        "triggers": [{"platform": "state", "entity_id": "binary_sensor.x", "to": "off", "for": "00:05:00"},
                     {"platform": "time_pattern", "minutes": "/1"}],
        "conditions": [{"condition": "state", "entity_id": "binary_sensor.x",
                        "state": "off", "for": "00:05:00"}],
    }
    _, calls = _run(monkeypatch, {
        "name": "אור נכבה במשרד",
        "alias": "Ziggy Smart Room Office Off",
        "source": "custom",
        "trigger": {"type": "state", "entity_id": "binary_sensor.x", "state": "off", "for_minutes": 5},
        "actions": [{"type": "call_service", "entity_id": "light.a", "service": "light.turn_off"}],
        "ha_native_body": native,
    })
    assert calls[0]["data"]["ha_native_body"] == native
    # …and the Ziggy shape is still carried alongside it, for the installed editor.
    assert calls[0]["data"]["trigger"]["for_minutes"] == 5
    assert calls[0]["data"]["actions"][0]["entity_id"] == "light.a"


def test_artifact_without_native_body_stays_clean(monkeypatch):
    """No empty ha_native_body key on ordinary artifacts — save_automation's
    needs_ha() treats any present-and-truthy body as 'HA must run this'."""
    _, calls = _run(monkeypatch, {
        "name": "Plain rule",
        "source": "custom",
        "trigger": {"type": "time", "time": "07:00"},
        "actions": [],
    })
    assert "ha_native_body" not in calls[0]["data"]
