"""Durable chat threads — the server-side store that makes conversations persist,
resume, and survive navigation / page reload (like Claude/ChatGPT). Applies to ALL
Ziggy chats, not just the fixer.
"""
import pytest

from services import chat_threads as ct


@pytest.fixture(autouse=True)
def _tmp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(ct, "_DB_PATH", tmp_path / "threads.db")
    yield


def test_create_thread_is_empty_and_idle():
    tid = ct.create_thread()
    assert tid
    th = ct.get_thread(tid)
    assert th["thread_id"] == tid
    assert th["status"] == "idle"
    assert th["messages"] == []


def test_append_messages_are_ordered():
    tid = ct.create_thread()
    ct.append_message(tid, "user", "hello")
    ct.append_message(tid, "assistant", "hi there")
    msgs = ct.get_thread(tid)["messages"]
    assert [(m["role"], m["content"]) for m in msgs] == [("user", "hello"), ("assistant", "hi there")]


def test_title_auto_set_from_first_user_message():
    tid = ct.create_thread()
    ct.append_message(tid, "user", "why won't my kitchen light turn on?")
    assert ct.get_thread(tid)["title"].startswith("why won't my kitchen light")


def test_message_data_roundtrips():
    tid = ct.create_thread()
    ct.append_message(tid, "assistant", "here", data={"kind": "home_health", "severity": "ok"})
    m = ct.get_thread(tid)["messages"][0]
    assert m["data"] == {"kind": "home_health", "severity": "ok"}


def test_list_threads_newest_first_with_preview():
    a = ct.create_thread()
    ct.append_message(a, "user", "first thread")
    b = ct.create_thread()
    ct.append_message(b, "user", "second thread")
    ct.append_message(b, "assistant", "reply in second")
    listed = ct.list_threads()
    assert listed[0]["thread_id"] == b        # most recently updated first
    assert listed[0]["preview"]
    assert {x["thread_id"] for x in listed} == {a, b}


def test_set_status_and_get():
    tid = ct.create_thread()
    ct.set_status(tid, "running")
    assert ct.get_thread(tid)["status"] == "running"
    ct.set_status(tid, "idle")
    assert ct.get_thread(tid)["status"] == "idle"


def test_rename_and_delete():
    tid = ct.create_thread()
    ct.rename_thread(tid, "My chat")
    assert ct.get_thread(tid)["title"] == "My chat"
    ct.delete_thread(tid)
    assert ct.get_thread(tid) is None


def test_history_for_agent_is_role_content_only():
    tid = ct.create_thread()
    ct.append_message(tid, "user", "q1")
    ct.append_message(tid, "assistant", "a1", data={"kind": "x"})
    ct.append_message(tid, "user", "q2")
    hist = ct.get_history_for_agent(tid)
    assert hist == [{"role": "user", "content": "q1"},
                    {"role": "assistant", "content": "a1"},
                    {"role": "user", "content": "q2"}]


def test_get_missing_thread_is_none():
    assert ct.get_thread("th_nope") is None
    assert ct.get_history_for_agent("th_nope") == []


def test_owner_scoping():
    mine = ct.create_thread(owner="person:youval")
    other = ct.create_thread(owner="person:guest")
    ct.append_message(mine, "user", "m")
    ct.append_message(other, "user", "o")
    ids = {t["thread_id"] for t in ct.list_threads(owner="person:youval")}
    assert mine in ids and other not in ids
