"""Acting THROUGH Ziggy must not stamp a 30-minute manual override.

The manual-override registry exists for out-of-band changes (wall switch,
HA app, physical remote). But only the engines ever called
register_ziggy_call, so a tap in Ziggy's own UI, a chat command, or a voice
command reached HA unattributed — the subscriber then marked the entity
"manually overridden" and the automation executor refused to touch it for
30 minutes. A user could turn the AC on from the app and Leave Home would
skip switching it off.

Design: a second attribution tier. `note_ziggy_write` marks ANY write
leaving Ziggy (suppresses the override stamp); `register_ziggy_call` keeps
its engine-write meaning (the circadian hook's own-write detection), so a
user dragging the brightness slider still counts as a hand change for the
Smart Light Schedule.
"""
import asyncio
import time

import pytest

from services import manual_overrides as mo


@pytest.fixture(autouse=True)
def _clean():
    def wipe():
        mo._recent_ziggy_calls.clear()
        mo._ziggy_expected.clear()
        mo._overrides.clear()
        getattr(mo, "_recent_ziggy_writes", {}).clear()
    wipe()
    yield
    wipe()


# ── the new attribution tier ─────────────────────────────────────────────────

def test_write_note_records_and_expires():
    assert mo.was_recent_ziggy_write("switch.plug") is False
    mo.note_ziggy_write("switch.plug")
    assert mo.was_recent_ziggy_write("switch.plug") is True
    # force-expire → no longer attributed
    mo._recent_ziggy_writes["switch.plug"] = time.time() - 1
    assert mo.was_recent_ziggy_write("switch.plug") is False


def test_write_note_accepts_entity_list():
    mo.note_ziggy_write(["light.a", "light.b"])
    assert mo.was_recent_ziggy_write("light.a") is True
    assert mo.was_recent_ziggy_write("light.b") is True


def test_write_note_is_not_an_engine_call():
    """The circadian hook must still see a user's app-slider change as a hand
    change — note_ziggy_write must NOT satisfy was_ziggy_initiated."""
    mo.note_ziggy_write("light.a")
    assert mo.was_ziggy_initiated("light.a") is False


def test_none_and_empty_are_ignored():
    mo.note_ziggy_write(None)
    mo.note_ziggy_write("")
    mo.note_ziggy_write([])
    assert mo.was_recent_ziggy_write("") is False


# ── every HA write leaving home_automation is attributed ─────────────────────

class _FakeResp:
    status_code = 200
    text = "[]"
    def json(self):
        return []


def test_call_service_notes_the_write(monkeypatch):
    import services.home_automation as ha
    monkeypatch.setattr(ha._session, "post", lambda *a, **k: _FakeResp())
    ha.call_service("switch", "turn_on", {"entity_id": "switch.plug"})
    assert mo.was_recent_ziggy_write("switch.plug") is True


def test_call_service_notes_entity_lists(monkeypatch):
    import services.home_automation as ha
    monkeypatch.setattr(ha._session, "post", lambda *a, **k: _FakeResp())
    ha.call_service("light", "turn_off", {"entity_id": ["light.a", "light.b"]})
    assert mo.was_recent_ziggy_write("light.a") is True
    assert mo.was_recent_ziggy_write("light.b") is True


def test_toggle_light_notes_the_write(monkeypatch):
    import services.home_automation as ha
    monkeypatch.setattr(ha._session, "post", lambda *a, **k: _FakeResp())
    ha.toggle_light("light.a", True)
    assert mo.was_recent_ziggy_write("light.a") is True


def test_set_light_brightness_notes_the_write(monkeypatch):
    import services.home_automation as ha
    monkeypatch.setattr(ha._session, "post", lambda *a, **k: _FakeResp())
    ha.set_light_brightness("light.a", 60)
    assert mo.was_recent_ziggy_write("light.a") is True


def test_set_ac_temperature_notes_the_write(monkeypatch):
    import services.home_automation as ha
    monkeypatch.setattr(ha._session, "post", lambda *a, **k: _FakeResp())
    ha.set_ac_temperature("climate.bedroom_ac", 24)
    assert mo.was_recent_ziggy_write("climate.bedroom_ac") is True


# ── the subscriber gate ──────────────────────────────────────────────────────

def _event(entity_id, prev, new):
    return {"event": {"data": {
        "entity_id": entity_id,
        "old_state": {"state": prev, "attributes": {}},
        "new_state": {"state": new, "attributes": {}, "last_changed": ""},
    }}}


def test_subscriber_skips_override_for_ziggy_write():
    """A state change caused by a write Ziggy itself sent must not create an
    override — this is the app-tap / chat-command case."""
    from services.ha_subscriber import _process_event
    mo.note_ziggy_write("switch.test_attr_plug")
    asyncio.run(_process_event(_event("switch.test_attr_plug", "off", "on")))
    assert mo.is_overridden("switch.test_attr_plug") is False


def test_subscriber_marks_override_for_out_of_band():
    """Control case: an unattributed change (wall switch) still marks manual."""
    from services.ha_subscriber import _process_event
    asyncio.run(_process_event(_event("switch.test_attr_plug2", "off", "on")))
    assert mo.is_overridden("switch.test_attr_plug2") is True
