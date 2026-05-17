from __future__ import annotations
import json
from core.intent_utils import ok, err
from core.memory import list_memory, append_chat, get_chat_history
from core.task_file import load_task_json
from core.logger_module import log_info, log_error
from core.response_templates import get_response_for
from integrations.openai_client import get_client

# ── Web search tool — GPT decides when to use it ──────────────────────────────

_WEB_SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": (
            "Search the web for current information. Use this when the user asks "
            "about recent events, live data, news, prices, scores, people, or "
            "anything that may have changed after your training cutoff. "
            "For stable knowledge you are confident about, answer directly."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The search query"},
            },
            "required": ["query"],
        },
    },
}


def _format_search_snippets(result: dict) -> str:
    if not result.get("ok") or not result.get("snippets"):
        return "No search results found."
    lines = [f"Web search results for: {result['query']}\n"]
    for i, s in enumerate(result["snippets"], 1):
        title = s.get("title", "")
        snippet = s.get("snippet", "")
        url = s.get("url", "")
        lines.append(f"{i}. {title}\n   {snippet}\n   {url}")
    return "\n".join(lines)


# ── Chat handler ───────────────────────────────────────────────────────────────

async def handle_chat_with_gpt(params: dict, *, source: str = "unknown") -> dict:
    text = str(params.get("text") or params.get("message") or params or "").strip()

    # Caller may inject session-scoped history (chat mode). If absent, use the
    # global short-term history (legacy / pending_action path).
    session_history: list[dict] | None = params.get("chat_history")
    use_session_history = session_history is not None

    memory_context = list_memory()
    task_context = load_task_json()

    if use_session_history:
        chat_history = session_history  # already ends with the current user message
    else:
        append_chat("user", text)
        chat_history = get_chat_history()

    user_name = memory_context.get("user_name", "Youval")
    system_prompt = (
        f"You are Ziggy, the smart home assistant. The user's name is {user_name} (Hebrew: יובל). "
        "Always use this exact spelling when addressing them by name in Hebrew. "
        "Use the user's memory and tasks to answer contextually.\n\n"
        "IMPORTANT: If the user's message looks like an incomplete smart home command or "
        "automation request — such as 'create a routine', 'add a task', 'create a note', "
        "'create an automation', 'set a reminder' — ask ONE specific clarifying question "
        "to get the missing details. Do NOT just greet them. Examples:\n"
        "  - 'create a routine' → 'Which room and device, and when should it trigger?'\n"
        "  - 'add a task' → 'What task would you like to add?'\n"
        "  - 'create a note' → 'What should I save in the note?'\n"
        "  - 'set a reminder' → 'What should I remind you about, and when?'\n"
        "For genuine conversation or questions, answer naturally.\n\n"
        f"User memory:\n{json.dumps(memory_context)}\n\n"
        f"Task list:\n{json.dumps(task_context)}"
    )

    messages = [{"role": "system", "content": system_prompt}, *chat_history]

    try:
        # First call — GPT may invoke web_search if it needs current data.
        response = get_client().chat.completions.create(
            model="gpt-4o",
            messages=messages,
            tools=[_WEB_SEARCH_TOOL],
            tool_choice="auto",
            temperature=0.6,
            max_tokens=400,
        )

        msg = response.choices[0].message

        if msg.tool_calls:
            call = msg.tool_calls[0]
            query = json.loads(call.function.arguments).get("query", text)
            log_info(f"[chat_with_gpt] Web search triggered: {query!r}")

            from services import web_manager
            search_result = web_manager.search_for_gpt(query)
            snippets_text = _format_search_snippets(search_result)

            # Extend conversation with tool call + result, then synthesize.
            messages.append({
                "role": "assistant",
                "content": msg.content,
                "tool_calls": [{
                    "id": call.id,
                    "type": "function",
                    "function": {
                        "name": call.function.name,
                        "arguments": call.function.arguments,
                    },
                }],
            })
            messages.append({
                "role": "tool",
                "content": snippets_text,
                "tool_call_id": call.id,
            })

            synthesis = get_client().chat.completions.create(
                model="gpt-4o",
                messages=messages,
                temperature=0.6,
                max_tokens=400,
            )
            reply = (synthesis.choices[0].message.content or "").strip()
        else:
            reply = (msg.content or "").strip()

        if not use_session_history:
            append_chat("assistant", reply)
        return ok(reply)

    except Exception as e:
        log_error(f"[chat_with_gpt] GPT error: {e}")
        return err("GPT error while chatting.", details=str(e))


async def handle_unrecognized_command(params: dict, *, source: str = "unknown") -> dict:
    text = params.get("text", "")
    if not text.strip():
        return ok("")
    return ok(get_response_for("command_fallback", text))


async def handle_unsupported_feature(params: dict, *, source: str = "unknown") -> dict:
    text = (params.get("text") or "").strip()
    is_hebrew = any('א' <= c <= 'ת' for c in text)
    if is_hebrew:
        return ok("הפונקציה הזו עדיין לא נתמכת. נסה: 'הדלק את האור בסלון', 'הוסף משימה', או 'מה הטמפרטורה בחדר שינה'.")
    return ok(
        "That feature isn't available yet. "
        "Try: 'turn on the living room light', 'add a task', or 'what's the temperature in the bedroom'."
    )


HANDLERS = {
    "chat_with_gpt": handle_chat_with_gpt,
    "unrecognized_command": handle_unrecognized_command,
    "unsupported_feature": handle_unsupported_feature,
}
