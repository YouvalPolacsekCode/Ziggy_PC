"""You should never be pushed about your own arrival or departure.

`push_notify` has always taken `exclude_user_id` and honoured it — for WEB
push. When native fan-out was added it called `mobile_push.send_to_all`, whose
docstring says it sends to EVERY registered device, and the exclusion was not
passed. Browsers stayed correctly quiet while the phone — the surface people
actually read — buzzed twice a day saying "Youval arrived home" to Youval.

The trap underneath it: both stores name the owner `user_id`, and they mean
different things.

    push_subscriptions.json   user_id = "someone@example.com"   (email)
    mobile_devices.json       user_id = "1"                     (account row id)

Callers hold the email (a presence person's `linked_user`), so a filter that
compares it straight against a device's `user_id` matches nothing and suppresses
nothing — it would look like a fix and change no behaviour. Both shapes are
covered below for that reason.
"""

import asyncio

import pytest

from services import mobile_push


@pytest.fixture()
def devices(monkeypatch):
    """Two phones on account id 1 (Youval), one on id 2 (a partner)."""
    rows = [
        {"device_id": "a", "user_id": "1", "push_token": "t-youval-phone", "push_provider": "fcm"},
        {"device_id": "b", "user_id": "1", "push_token": "t-youval-tablet", "push_provider": "fcm"},
        {"device_id": "c", "user_id": "2", "push_token": "t-partner", "push_provider": "fcm"},
    ]
    monkeypatch.setattr(mobile_push, "_all_devices", lambda: rows)
    sent: list[str] = []

    async def _fake_send(device, *, title, body, data):
        sent.append(device["push_token"])
        return {"ok": True}

    monkeypatch.setattr(mobile_push, "_send", _fake_send)
    monkeypatch.setattr(
        "services.auth_db.get_user_by_username",
        lambda u: {"id": 1, "username": "youval@example.com"}
                  if (u or "").lower() == "youval@example.com" else None,
    )
    return sent


def _send(**kw):
    return asyncio.run(mobile_push.send_to_all(title="t", body="b", **kw))


def test_without_an_exclusion_everyone_still_gets_it(devices):
    _send()
    assert set(devices) == {"t-youval-phone", "t-youval-tablet", "t-partner"}


def test_the_subject_of_the_push_does_not_get_it_on_their_own_devices(devices):
    """The reported bug: 'Youval arrived home' reaching Youval's phone."""
    _send(exclude_user_id="youval@example.com")
    assert devices == ["t-partner"], (
        "the excluded user's own devices were pushed — self-suppression is "
        "web-only again"
    )


def test_exclusion_resolves_an_EMAIL_to_the_numeric_device_owner(devices):
    """The trap. Devices store '1'; callers pass an email.

    A filter comparing the two directly matches nothing, suppresses nothing,
    and looks exactly like a working fix.
    """
    assert mobile_push._device_belongs_to({"user_id": "1"}, "youval@example.com") is True
    assert mobile_push._device_belongs_to({"user_id": "2"}, "youval@example.com") is False


def test_exclusion_also_matches_a_device_registered_under_the_email(monkeypatch):
    """Older devices may carry the email directly — both shapes must work."""
    assert mobile_push._device_belongs_to(
        {"user_id": "Someone@Example.com"}, "someone@example.com") is True


def test_case_and_whitespace_do_not_defeat_suppression():
    assert mobile_push._device_belongs_to({"user_id": " someone@example.com "},
                                          "SOMEONE@EXAMPLE.COM") is True


def test_a_device_with_no_owner_is_never_suppressed(devices):
    """Unknown ownership must not silently swallow a household notification."""
    assert mobile_push._device_belongs_to({"user_id": ""}, "youval@example.com") is False
    assert mobile_push._device_belongs_to({}, "youval@example.com") is False


def test_an_auth_lookup_failure_sends_rather_than_silently_dropping(monkeypatch):
    """Failing open is right here: a missed notification is worse than a stray one."""
    def boom(_u):
        raise RuntimeError("auth db unavailable")
    monkeypatch.setattr("services.auth_db.get_user_by_username", boom)
    assert mobile_push._device_belongs_to({"user_id": "1"}, "youval@example.com") is False


def test_push_notify_passes_the_exclusion_through_to_native(monkeypatch):
    """The actual regression: the wrapper dropped the argument on the floor."""
    import services.push_notify as pn
    seen = {}

    async def fake_send_to_all(*, title, body, data=None, exclude_user_id=None):
        seen["exclude"] = exclude_user_id
        return []

    monkeypatch.setattr(mobile_push, "send_to_all", fake_send_to_all)
    monkeypatch.setattr(pn, "push_notify_sync", lambda *a, **k: None)
    asyncio.run(pn.push_notify("Youval arrived home", "", "/", "presence",
                               exclude_user_id="youval@example.com"))
    assert seen.get("exclude") == "youval@example.com", (
        "push_notify stopped forwarding exclude_user_id to the native path"
    )
