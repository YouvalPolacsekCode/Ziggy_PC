"""Background thread runner — runs an assistant turn to completion, persisting the
reply and broadcasting, so a thread survives the client navigating away (resumable).
"""
import pytest

from services import chat_threads as ct
from services import chat_runner as cr


@pytest.fixture(autouse=True)
def _tmp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(ct, "_DB_PATH", tmp_path / "threads.db")
    yield


@pytest.mark.asyncio
async def test_runs_turn_persists_reply_and_broadcasts():
    tid = ct.create_thread()
    ct.append_message(tid, "user", "hello")

    seen = []

    async def compute(text, prior):
        assert text == "hello"
        assert prior == []          # first turn → no prior history
        return {"reply": "hi there", "ok": True, "data": {"kind": "x"}}

    async def broadcast(evt):
        seen.append(evt)

    await cr.run_turn(tid, "hello", compute=compute, broadcast=broadcast)

    msgs = ct.get_thread(tid)["messages"]
    assert msgs[-1]["role"] == "assistant" and msgs[-1]["content"] == "hi there"
    assert msgs[-1]["data"] == {"kind": "x"}
    assert ct.get_thread(tid)["status"] == "idle"
    # running first, then a final thread_message carrying the reply
    types = [e["type"] for e in seen]
    assert types[0] == "thread_status" and seen[0]["status"] == "running"
    assert any(e["type"] == "thread_message" and e["thread_id"] == tid
               and e["message"]["content"] == "hi there" for e in seen)


@pytest.mark.asyncio
async def test_prior_history_excludes_current_user_turn():
    tid = ct.create_thread()
    ct.append_message(tid, "user", "q1")
    ct.append_message(tid, "assistant", "a1")
    ct.append_message(tid, "user", "q2")

    captured = {}

    async def compute(text, prior):
        captured["text"] = text
        captured["prior"] = prior
        return {"reply": "a2"}

    await cr.run_turn(tid, "q2", compute=compute, broadcast=_noop)

    assert captured["text"] == "q2"
    assert captured["prior"] == [{"role": "user", "content": "q1"},
                                 {"role": "assistant", "content": "a1"}]


@pytest.mark.asyncio
async def test_failure_marks_error_and_still_notifies():
    tid = ct.create_thread()
    ct.append_message(tid, "user", "boom")
    seen = []

    async def compute(text, prior):
        raise RuntimeError("engine exploded")

    async def broadcast(evt):
        seen.append(evt)

    await cr.run_turn(tid, "boom", compute=compute, broadcast=broadcast)

    assert ct.get_thread(tid)["status"] == "error"
    # an assistant message still lands so the UI isn't stuck "thinking"
    assert ct.get_thread(tid)["messages"][-1]["role"] == "assistant"
    assert any(e.get("status") == "error" for e in seen)


async def _noop(evt):
    return None


# ── live TLDR titles ────────────────────────────────────────────────────────
# A thread gets its real title a second or two after the first exchange. Without
# a push, the drawer keeps showing the placeholder until it's reopened.


def _fake_llm(title):
    class _M:
        content = title
    class _C:
        message = _M()
    class _R:
        choices = [_C()]
    return lambda *a, **k: _R()


def test_generate_title_returns_the_title_it_set(monkeypatch):
    import integrations.llm_gateway as gw
    monkeypatch.setattr(gw, "chat_completion", _fake_llm("Kitchen light trouble"))

    tid = ct.create_thread()
    ct.append_message(tid, "user", "the kitchen light is dead")
    ct.append_message(tid, "assistant", "let me look")

    assert cr.generate_title(tid) == "Kitchen light trouble"
    assert ct.get_thread(tid)["title"] == "Kitchen light trouble"


@pytest.mark.asyncio
async def test_a_new_title_is_pushed_to_the_open_app(monkeypatch):
    import integrations.llm_gateway as gw
    monkeypatch.setattr(gw, "chat_completion", _fake_llm("Kitchen light trouble"))

    tid = ct.create_thread()
    ct.append_message(tid, "user", "the kitchen light is dead")
    ct.append_message(tid, "assistant", "let me look")

    seen = []

    async def broadcast(evt):
        seen.append(evt)

    await cr.title_thread(tid, broadcast=broadcast)

    assert seen == [{"type": "thread_titled", "thread_id": tid,
                     "title": "Kitchen light trouble"}]


@pytest.mark.asyncio
async def test_nothing_is_pushed_when_no_title_could_be_made(monkeypatch):
    import integrations.llm_gateway as gw

    def boom(*a, **k):
        raise RuntimeError("LLM down")
    monkeypatch.setattr(gw, "chat_completion", boom)

    tid = ct.create_thread()
    ct.append_message(tid, "user", "hi")
    ct.append_message(tid, "assistant", "hey")

    seen = []

    async def broadcast(evt):
        seen.append(evt)

    await cr.title_thread(tid, broadcast=broadcast)

    assert seen == [], "a failed title must not push a placeholder over the real one"
