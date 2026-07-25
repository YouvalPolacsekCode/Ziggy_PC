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
