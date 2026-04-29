from __future__ import annotations
import json
from core.intent_utils import ok, err
from core.memory import list_memory, append_chat, get_chat_history
from core.task_file import load_task_json
from core.logger_module import log_error
from integrations.openai_client import get_client


async def handle_chat_with_gpt(params: dict, *, source: str = "unknown") -> dict:
    text = str(params.get("text") or params.get("message") or params or "").strip()

    memory_context = list_memory()
    task_context = load_task_json()
    append_chat("user", text)
    chat_history = get_chat_history()

    user_name = memory_context.get("user_name", "Youval")
    system_prompt = (
        f"You are Ziggy, the smart home assistant. The user's name is {user_name} (Hebrew: יובל). "
        "Always use this exact spelling when addressing them by name in Hebrew. "
        "Use the user's memory and tasks to answer contextually.\n\n"
        f"User memory:\n{json.dumps(memory_context)}\n\n"
        f"Task list:\n{json.dumps(task_context)}"
    )

    try:
        response = get_client().chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "system", "content": system_prompt}, *chat_history],
            temperature=0.6,
            max_tokens=250,
        )
        reply = response.choices[0].message.content.strip()
        append_chat("assistant", reply)
        return ok(reply)
    except Exception as e:
        log_error(f"[chat_with_gpt] GPT error: {e}")
        return err("GPT error while chatting.", details=str(e))


HANDLERS = {
    "chat_with_gpt": handle_chat_with_gpt,
}
