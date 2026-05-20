"""Tests for self-notification suppression in services/push_notify.py."""
from __future__ import annotations

import importlib
import json

import pytest


@pytest.fixture
def push(monkeypatch, tmp_path):
    """Reload push_notify with stubbed VAPID keys and an in-memory subs store."""
    from services import push_notify as pn
    pn = importlib.reload(pn)

    # Avoid real disk + VAPID generation.
    monkeypatch.setattr(pn, "get_vapid_keys", lambda: {"private_b64url": "stub", "public_b64url": "stub"})

    subs_store = {"subs": []}
    monkeypatch.setattr(pn, "load_subs",  lambda: list(subs_store["subs"]))
    monkeypatch.setattr(pn, "_save_subs", lambda s: subs_store.__setitem__("subs", list(s)))

    sent_titles: list[tuple[str, str]] = []
    def fake_send(sub, data, key):
        payload = json.loads(data)
        sent_titles.append((sub.get("user_id", ""), payload["title"]))
        return True
    monkeypatch.setattr(pn, "_send_one", fake_send)

    return pn, subs_store, sent_titles


def test_no_excluded_user_pushes_to_everyone(push):
    pn, store, sent = push
    store["subs"] = [
        {"endpoint": "e1", "keys": {}, "user_id": "alice@x"},
        {"endpoint": "e2", "keys": {}, "user_id": "bob@x"},
    ]
    pn.push_notify_sync("Test", "", "/", "general")
    assert {u for u, _ in sent} == {"alice@x", "bob@x"}


def test_exclude_user_id_skips_only_that_user(push):
    pn, store, sent = push
    store["subs"] = [
        {"endpoint": "e1", "keys": {}, "user_id": "alice@x"},
        {"endpoint": "e2", "keys": {}, "user_id": "bob@x"},
    ]
    pn.push_notify_sync("Alice arrived home", "", "/", "presence",
                        exclude_user_id="alice@x")
    # Only Bob should have received the push.
    assert sent == [("bob@x", "Alice arrived home")]


def test_exclude_is_case_insensitive(push):
    pn, store, sent = push
    store["subs"] = [
        {"endpoint": "e1", "keys": {}, "user_id": "Alice@Example.COM"},
        {"endpoint": "e2", "keys": {}, "user_id": "bob@x"},
    ]
    pn.push_notify_sync("Alice arrived home", "", "/", "presence",
                        exclude_user_id="alice@example.com")
    assert sent == [("bob@x", "Alice arrived home")]


def test_exclude_keeps_subscription_intact(push):
    """Self-suppressed subscriptions must NOT be removed from the store —
    we only skip sending. The subscription is still valid for next time."""
    pn, store, sent = push
    store["subs"] = [
        {"endpoint": "e1", "keys": {}, "user_id": "alice@x"},
        {"endpoint": "e2", "keys": {}, "user_id": "bob@x"},
    ]
    pn.push_notify_sync("Alice arrived home", "", "/", "presence",
                        exclude_user_id="alice@x")
    endpoints = {s["endpoint"] for s in store["subs"]}
    assert endpoints == {"e1", "e2"}


def test_exclude_none_is_noop(push):
    pn, store, sent = push
    store["subs"] = [{"endpoint": "e1", "keys": {}, "user_id": "alice@x"}]
    pn.push_notify_sync("Test", "", "/", "general", exclude_user_id=None)
    assert sent == [("alice@x", "Test")]
