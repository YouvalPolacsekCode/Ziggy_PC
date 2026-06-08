from __future__ import annotations
import json
from core.intent_utils import ok, err
from core.memory import list_memory, append_chat, get_chat_history
from core.task_file import load_task_json
from core.logger_module import log_info, log_error
from core.response_templates import get_response_for
from integrations.openai_client import (
    CloudLLMUnavailable,
    require_cloud_llm_active,
)
from integrations.llm_gateway import chat_completion

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

def _is_hebrew(text: str) -> bool:
    return any('֐' <= c <= 'ת' for c in text or "")


async def handle_chat_with_gpt(params: dict, *, source: str = "unknown") -> dict:
    # Cloud LLM gate (Prompt 9 chunk 3). Cancelled / past_due / refunded
    # subscriptions return a graceful billing message instead of trying
    # cloud chat and surfacing a generic error. The local kit (sensors,
    # automations, IR, local voice) is unaffected.
    try:
        require_cloud_llm_active()
    except CloudLLMUnavailable as gate_err:
        log_info(f"[chat_with_gpt] cloud LLM gated: {gate_err}")
        return err(str(gate_err), details="cloud_llm_gated")

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
    input_is_hebrew = _is_hebrew(text)

    # Check recent history too — if the conversation has been in Hebrew, stay Hebrew.
    if not input_is_hebrew and session_history:
        recent = session_history[-4:] if len(session_history) >= 4 else session_history
        input_is_hebrew = any(_is_hebrew(m.get("content", "")) for m in recent if m.get("role") == "user")

    lang_rule = (
        "ALWAYS respond in Hebrew (עברית). Keep responses concise and natural. "
        "Device names, room names, and entity IDs can stay in English but all explanatory text must be Hebrew. "
    ) if input_is_hebrew else (
        "Respond in English. Keep responses concise and natural. "
    )

    system_prompt = (
        f"You are Ziggy, the smart home assistant. The user's name is {user_name} (Hebrew: יובל). "
        "Always use this exact spelling when addressing them by name in Hebrew. "
        f"{lang_rule}"
        "Use the user's memory and tasks to answer contextually.\n\n"
        "IMPORTANT: Follow these rules strictly:\n"
        "1. If the message looks like an incomplete smart home COMMAND (create routine, "
        "create automation, set reminder) — ask ONE specific clarifying question for the "
        "missing details. Do NOT just greet them. Examples:\n"
        "  - 'create a routine' → 'Which room and device, and when should it trigger?'\n"
        "  - 'add a task' → 'What task would you like to add?'\n"
        "  - 'create a note' → 'What should I save in the note?'\n"
        "  - 'set a reminder' → 'What should I remind you about, and when?'\n"
        "2. If the message expresses a PHYSICAL COMFORT state ('too hot', 'too cold', "
        "'I'm cold', 'I'm warm', 'קר לי', 'חם לי') — suggest adjusting the temperature "
        "or AC. Ask which room if not specified. Do NOT ask about tasks.\n"
        "3. If the message is vague ('do it', 'the usual', 'כמו אתמול') — ask what they "
        "mean. Do NOT ask about tasks or notes unprompted.\n"
        "4. NEVER respond with task-related questions unless the user explicitly mentioned tasks.\n"
        "For genuine conversation or questions, answer naturally.\n\n"
        f"User memory:\n{json.dumps(memory_context)}\n\n"
        f"Task list:\n{json.dumps(task_context)}"
    )

    messages = [{"role": "system", "content": system_prompt}, *chat_history]

    try:
        # First call — GPT may invoke web_search if it needs current data.
        response = chat_completion(
            "chat",
            messages,
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

            synthesis = chat_completion(
                "chat",
                messages,
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
