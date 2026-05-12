import re
import json
from core.settings_loader import settings
from core.tools_schema import TOOLS, SYSTEM_PROMPT
from integrations.openai_client import get_client

# ---------------------------------------------------------------------------
# Fast path — answered locally, no API call
# ---------------------------------------------------------------------------
_FAST_PATTERNS = [
    (re.compile(r"\b(what time|what'?s the time|current time|time now|tell me the time)\b"), "get_time"),
    (re.compile(r"מה השעה|איזו שעה|מה השעה עכשיו"), "get_time"),
    (re.compile(r"\b(what'?s the date|today'?s date|current date|what date is it)\b"), "get_date"),
    (re.compile(r"מה התאריך|איזה תאריך"), "get_date"),
    (re.compile(r"\b(what day|which day|day of the week|what weekday)\b"), "get_day_of_week"),
    (re.compile(r"איזה יום|מה היום"), "get_day_of_week"),
]

_TRIGGER_PREFIX = "ziggy do"

# Hebrew room name → English canonical slug, sorted longest-match first
_ROOMS_HE_SORTED = sorted(
    settings.get("room_aliases_he", {}).items(),
    key=lambda kv: len(kv[0]),
    reverse=True,
)


def _normalize_hebrew_rooms(text: str) -> str:
    """Replace Hebrew room names with English display names before sending to GPT."""
    for he_name, en_slug in _ROOMS_HE_SORTED:
        if he_name in text:
            en_display = next(
                (k for k, v in settings.get("room_aliases", {}).items() if v == en_slug),
                en_slug,
            )
            text = text.replace(he_name, en_display)
    return text


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def quick_parse(text: str, chat_history: list | None = None) -> dict:
    if not isinstance(text, str) or not text.strip():
        return {"intent": "unrecognized_command", "params": {"text": ""}, "source": "noop"}

    text = text.strip()
    lower = text.lower()
    if lower.startswith(_TRIGGER_PREFIX):
        text = text[len(_TRIGGER_PREFIX):].strip()
        lower = text.lower()

    # Fast-path patterns never need history — they match exact phrases
    for pattern, intent in _FAST_PATTERNS:
        if pattern.search(lower):
            print(f"[Intent Parser] ⚡ Fast path: {intent}")
            return {"intent": intent, "params": {}, "source": "fast"}

    return _parse_with_tools(text, chat_history=chat_history)


def _parse_with_tools(text: str, chat_history: list | None = None) -> dict:
    text = _normalize_hebrew_rooms(text)
    try:
        # Append live IR device list so GPT knows which devices exist and picks
        # the right intent (ir_send_command vs control_tv / control_ac).
        system = SYSTEM_PROMPT
        try:
            from services.ir_manager import build_ir_context_hint
            ir_hint = build_ir_context_hint()
            if ir_hint:
                system = system + "\n\n" + ir_hint
        except Exception:
            pass  # IR manager not yet configured — ignore silently

        # Inject last-device context so GPT can resolve pronouns like
        # "it", "that", "turn it back on", "the light", etc.
        try:
            from core.conversation_context import build_context_hint
            ctx_hint = build_context_hint()
            if ctx_hint:
                system = system + ctx_hint
        except Exception:
            pass

        # Build message list. Include recent chat history so GPT can resolve
        # references like "the second one", "that automation", "assign it to X".
        # Cap at last 10 turns to stay within token budget.
        messages: list[dict] = [{"role": "system", "content": system}]
        if chat_history:
            messages.extend(chat_history[-10:])
        messages.append({"role": "user", "content": text})

        response = get_client().chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
        )

        msg = response.choices[0].message

        if msg.tool_calls:
            call = msg.tool_calls[0]
            intent = call.function.name
            params = json.loads(call.function.arguments)
            print(f"[Intent Parser] ✅ Tool: {intent} | params: {params}")
            return {"intent": intent, "params": params, "source": "tools"}

        print("[Intent Parser] ❓ No tool matched — unrecognized command")
        return {"intent": "unrecognized_command", "params": {"text": text}, "source": "tools"}

    except Exception as e:
        print(f"[Intent Parser] ⚠️ Error: {e}")
        return {"intent": "unrecognized_command", "params": {"text": text}, "source": "error"}
