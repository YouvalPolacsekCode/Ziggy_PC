"""Background chat-turn runner.

Runs one assistant turn for a thread to completion — independent of the HTTP request
that started it — persisting the reply and broadcasting progress. This is what lets a
conversation keep running after the user navigates away or starts another thread, and
be picked back up (resumable), for ALL Ziggy chats.

`compute` is injected (async ``(text, prior_history) -> {reply, ok?, data?}``) so the
runner is engine-agnostic and unit-testable; the chat router wires in the real engine.
"""
from __future__ import annotations

from typing import Awaitable, Callable

from core.logger_module import log_error, log_info
from services import chat_threads as ct

ComputeFn = Callable[[str, list], Awaitable[dict]]


async def _default_broadcast(evt: dict) -> None:
    from backend.ws_manager import manager
    await manager.broadcast(evt)


def _err_text() -> str:
    return "משהו השתבש אצלי רגע — אפשר לנסות שוב."


def generate_title(thread_id: str) -> None:
    """Best-effort short TLDR title for a thread from its first exchange (cheap LLM).

    Sync (blocking LLM call) — call via asyncio.to_thread so it never blocks the loop.
    Overwrites the placeholder first-message title; a user rename later stays put because
    we only generate on the first exchange.
    """
    th = ct.get_thread(thread_id)
    if not th:
        return
    msgs = [m for m in th["messages"]
            if m["role"] in ("user", "assistant") and (m.get("content") or "").strip()]
    if len(msgs) < 2:
        return
    convo = "\n".join(f'{m["role"]}: {m["content"]}' for m in msgs[:6])[:2000]
    try:
        from integrations.llm_gateway import chat_completion
        resp = chat_completion("intent_parse", [
            {"role": "system", "content":
                "Give a very short title (3-5 words) summarizing this chat, in the SAME "
                "language as the chat. Reply with ONLY the title — no quotes, no trailing period."},
            {"role": "user", "content": convo},
        ], temperature=0.2, max_tokens=24)
        title = (resp.choices[0].message.content or "").strip().strip('"').strip("'").strip()
        if title:
            ct.rename_thread(thread_id, title[:60])
            log_info(f"[chat_runner] titled {thread_id}: {title[:60]}")
    except Exception as e:
        log_error(f"[chat_runner] title generation failed for {thread_id}: {e}")


async def run_turn(thread_id: str, text: str, *, compute: ComputeFn,
                   broadcast: Callable[[dict], Awaitable[None]] | None = None) -> None:
    """Run one assistant turn to completion: mark running → compute → persist → notify.

    Safe to launch as a detached ``asyncio.create_task`` — it owns the whole lifecycle
    (status + persisted reply + broadcast) so nothing is lost if the client disconnects.
    """
    emit = broadcast or _default_broadcast

    ct.set_status(thread_id, "running")
    await emit({"type": "thread_status", "thread_id": thread_id, "status": "running"})

    try:
        history = ct.get_history_for_agent(thread_id)
        # Exclude the just-appended current user turn from the prior history.
        prior = history
        if history and history[-1]["role"] == "user" and history[-1]["content"] == text:
            prior = history[:-1]

        result = await compute(text, prior)
        reply = (result or {}).get("reply", "") or ""
        data = (result or {}).get("data")

        ct.append_message(thread_id, "assistant", reply, data=data)
        ct.set_status(thread_id, "idle")
        await emit({
            "type": "thread_message",
            "thread_id": thread_id,
            "status": "idle",
            "message": {"role": "assistant", "content": reply, "data": data},
        })
        log_info(f"[chat_runner] thread {thread_id} turn done ({len(reply)} chars)")
    except Exception as e:  # never leave a thread stuck 'running'
        log_error(f"[chat_runner] thread {thread_id} turn failed: {e}")
        ct.append_message(thread_id, "assistant", _err_text(), data={"error": str(e)})
        ct.set_status(thread_id, "error")
        await emit({"type": "thread_status", "thread_id": thread_id, "status": "error"})
