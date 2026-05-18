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
    # Good-night fast paths — these have no action vocab so they'd be blocked by the
    # confidence gate; bypass GPT entirely and map straight to turn_off_everything.
    (re.compile(r"^(good\s*night|goodnight|night\s+mode|לילה\s+טוב|לילה-טוב)$", re.IGNORECASE), "turn_off_everything"),
    # Going-to-sleep phrases that imply shutting everything down
    (re.compile(r"^(going\s+to\s+sleep|i'?m\s+going\s+to\s+sleep|off\s+to\s+bed|ללכת\s+לישון|הולך\s+לישון|הולכת\s+לישון)$", re.IGNORECASE), "turn_off_everything"),
]

_TRIGGER_PREFIX = "ziggy do"

# Fast-path patterns for features that will never be supported — return a
# friendly "not available" response without calling GPT at all.
# Vague multi-action phrases that look like commands but lack specific
# device/room intent — should ask for clarification rather than guess.
_VAGUE_MULTI_ACTION_PATTERNS = re.compile(
    r"\b(make\s+(the\s+house|everything|it\s+all)\s+(comfortable|cozy|nice|perfect|warm|cool)|"
    r"fix\s+(the\s+house|everything|the\s+place)|"
    r"set\s+(the\s+mood|the\s+scene|the\s+vibe)|"
    r"do\s+(the\s+thing|something|that\s+thing)(\s+from\s+(yesterday|before|earlier|last\s+time))?|"
    r"make\s+it\s+(perfect|nice|better|cozy))\b",
    re.IGNORECASE,
)

# Fast-path patterns for features that will never be supported — return a
# friendly "not available" response without calling GPT at all.
_UNSUPPORTED_PATTERNS = re.compile(
    r"\b(movie\s+mode|cinema\s+mode|party\s+mode|sleep\s+mode\s+tv|"
    r"open\s+youtube|play\s+youtube|launch\s+youtube|"
    r"open\s+netflix|launch\s+netflix|"
    r"open\s+spotify|launch\s+spotify|"
    r"order\s+(pizza|food|groceries|uber|taxi)|"
    r"call\s+an?\s+(uber|taxi|cab)|"
    r"send\s+(whatsapp|imessage|sms\s+to)|"
    r"control\s+my\s+(car|gate|garage\s+door\s+remote)|"
    r"set\s+(alarm\s+clock|my\s+alarm)|"
    r"wake\s+me\s+up\s+at)\b",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# Post-parse confidence gate
# ---------------------------------------------------------------------------

# Intents that change state (mutating). Read-only/query intents are always safe.
_MUTATION_INTENTS = frozenset({
    "toggle_light", "set_light_color", "adjust_light_brightness",
    "toggle_all_lights_in_room", "turn_off_all_lights", "turn_off_everything",
    "control_ac", "set_ac_temperature",
    "control_tv", "set_tv_source", "play_media",
    "ir_send_command", "ir_set_ac_temperature", "ir_play_sequence", "ir_send_channel",
    "control_device",
    "create_automation", "update_automation", "delete_automation", "toggle_automation",
    "assign_automation_to_room",
    "create_routine", "update_routine", "delete_routine",
    "add_task", "remove_task", "remove_all_tasks",
    "save_note", "append_to_note", "delete_note",
    "save_file", "delete_file",
    "send_email", "send_telegram_message",
})

# Device-action vocabulary that signals a genuine command.
# "make", "keep", "have", etc. are intentionally excluded — too ambiguous.
_ACTION_VOCAB_EN = re.compile(
    r"\b(turn\s+on|turn\s+off|switch\s+on|switch\s+off|put\s+on|"
    r"set|dim|brighten|lower|raise|increase|decrease|adjust|"
    r"lock|unlock|open|close|start|stop|pause|play|"
    r"enable|disable|add|create|remove|delete|restart|reboot|"
    r"send|list|show|get|check|read|run|execute|"
    r"\bon\b|\boff\b)\b",
    re.IGNORECASE,
)
_ACTION_VOCAB_HE = re.compile(
    r"(הדלק|כבה|פתח|סגור|הגדל|הקטן|הפעל|עצור|"
    r"תדליק|תכבה|תפתח|תסגור|תגדיל|תקטין|"
    r"כוון|תכוון|הגדר|תגדיר|הנמך|תנמיך|הגבה|תגביה|"
    r"החשך|הבהר|שנה|"
    r"הוסף|צור|מחק|הסר|שלח|הצג|בדוק|קרא)"
)


def _has_action_vocab(text: str) -> bool:
    """Return True if the text contains recognizable device-action vocabulary."""
    return bool(_ACTION_VOCAB_EN.search(text) or _ACTION_VOCAB_HE.search(text))

# Hebrew room name → English canonical slug, sorted longest-match first
# Merges personal he aliases (settings) + built-in bank, personal takes priority
def _build_rooms_he() -> list[tuple[str, str]]:
    from services.room_alias_bank import ROOM_ALIAS_BANK_HE
    merged = {**ROOM_ALIAS_BANK_HE, **settings.get("room_aliases_he", {})}
    return sorted(merged.items(), key=lambda kv: len(kv[0]), reverse=True)

_ROOMS_HE_SORTED = _build_rooms_he()

# Hebrew device type word → English equivalent, sorted longest-match first
_DEVICES_HE_SORTED = sorted(
    settings.get("device_aliases_he", {}).items(),
    key=lambda kv: len(kv[0]),
    reverse=True,
)


def _normalize_hebrew_rooms(text: str) -> str:
    """Replace Hebrew room names with English display names before sending to GPT."""
    from services.room_alias_bank import ROOM_ALIAS_BANK
    for he_name, en_slug in _ROOMS_HE_SORTED:
        if he_name in text:
            # Look up a human-readable key for this slug: personal alias first, then bank
            personal = settings.get("room_aliases", {})
            en_display = next((k for k, v in personal.items() if v == en_slug), None)
            if en_display is None:
                en_display = next((k for k, v in ROOM_ALIAS_BANK.items() if v == en_slug), en_slug)
            text = text.replace(he_name, en_display)
    return text


def _normalize_hebrew_devices(text: str) -> str:
    """Replace Hebrew device type words (אור, מזגן, …) with English equivalents before GPT."""
    for he_word, en_word in _DEVICES_HE_SORTED:
        if he_word in text:
            text = text.replace(he_word, en_word)
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
            from core.debug_bus import bus, VERBOSE
            bus.emit("intent", VERBOSE, "fast_path_match", intent=intent, input=text)
            return {"intent": intent, "params": {}, "source": "fast"}

    # Vague multi-action fast path — phrases like "make the house comfortable" or
    # "fix the living room" are too ambiguous to execute; ask for clarification.
    if _VAGUE_MULTI_ACTION_PATTERNS.search(lower):
        from core.debug_bus import bus, VERBOSE
        bus.emit("intent", VERBOSE, "vague_multi_action_fast_path", input=text)
        return {"intent": "unrecognized_command", "params": {"text": text}, "source": "fast"}

    # Unsupported-feature fast path — bypass GPT entirely for known-unavailable features.
    if _UNSUPPORTED_PATTERNS.search(lower):
        from core.debug_bus import bus, VERBOSE
        bus.emit("intent", VERBOSE, "unsupported_feature_fast_path", input=text)
        return {"intent": "unsupported_feature", "params": {"text": text}, "source": "fast"}

    return _parse_with_tools(text, chat_history=chat_history)


def _parse_with_tools(text: str, chat_history: list | None = None) -> dict:
    raw_text = text  # keep original for the confidence gate check
    text = _normalize_hebrew_rooms(text)
    text = _normalize_hebrew_devices(text)
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

        # Inject live device-room map so GPT knows which rooms have which devices
        # (needed for reliable multi-call enumeration like "turn on all lights").
        try:
            from services.device_registry import get_rooms_by_device_type
            room_map = get_rooms_by_device_type()
            if room_map:
                parts = []
                for dtype, rooms in sorted(room_map.items()):
                    parts.append(f"{dtype}: {', '.join(rooms)}")
                system = system + "\n\nConfigured devices by room: " + "; ".join(parts) + "."
        except Exception:
            pass

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

        import time as _time
        from core.debug_bus import bus as _dbus, BASIC, VERBOSE, TRACE
        _dbus.emit("intent", VERBOSE, "gpt_parse_start", input=text,
                   history_turns=len(chat_history) if chat_history else 0)
        t0 = _time.perf_counter()

        response = get_client().chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
            parallel_tool_calls=True,
        )
        duration_ms = round((_time.perf_counter() - t0) * 1000, 1)

        msg = response.choices[0].message

        if msg.tool_calls:
            calls = msg.tool_calls
            intents = []
            for call in calls:
                intent = call.function.name
                params = json.loads(call.function.arguments)
                intents.append({"intent": intent, "params": params, "source": "tools"})

            _dbus.emit("intent", VERBOSE, "gpt_parse_result",
                       input=text, duration_ms=duration_ms,
                       intents=[i["intent"] for i in intents],
                       multi=(len(intents) > 1))

            if len(intents) == 1:
                parsed = intents[0]
                # Confidence gate: if GPT routed to a state-mutating intent but the
                # raw input has no recognizable action vocabulary (e.g. "make the sky
                # lights jealous", "do the thing from yesterday", Hebrew nonsense),
                # downgrade to unrecognized_command so no action is taken.
                #
                # IMPORTANT: skip the gate when chat_history is non-empty. In a
                # multi-turn conversation the user may reply with just a parameter
                # value ("Office", "bedroom", "22 degrees") — that has no action
                # vocabulary but is a valid follow-up that GPT resolved correctly
                # from context. Blocking it here breaks the clarification flow.
                has_history = bool(chat_history)
                # Check both raw text (gibberish guard) AND normalized text
                # (Hebrew normalization converts תייצר→create, אוטומציה→automation
                # before GPT sees it, but raw_text still has the Hebrew originals).
                # A command like 'תייצר אוטומציה שמדליקה...' passes after normalization
                # because 'text' contains 'create' and 'automation' in English.
                if (not has_history
                        and parsed["intent"] in _MUTATION_INTENTS
                        and not _has_action_vocab(raw_text)
                        and not _has_action_vocab(text)):
                    _dbus.emit("intent", BASIC, "confidence_gate_blocked",
                               input=raw_text,
                               blocked_intent=parsed["intent"],
                               result="downgraded_to_unrecognized",
                               reason="no action vocabulary detected in raw input")
                    return {"intent": "unrecognized_command",
                            "params": {"text": raw_text}, "source": "confidence_gate"}
                return parsed

            # Multiple tool calls — filter out any that lack action vocabulary.
            # Skip the gate when there is chat history (same reason as above).
            has_history = bool(chat_history)
            filtered = [
                i for i in intents
                if has_history
                or i["intent"] not in _MUTATION_INTENTS
                or _has_action_vocab(raw_text)
            ]
            if not filtered:
                _dbus.emit("intent", BASIC, "confidence_gate_blocked",
                           input=raw_text, blocked_count=len(intents),
                           result="downgraded_to_unrecognized",
                           reason="no action vocabulary in multi-intent")
                return {"intent": "unrecognized_command",
                        "params": {"text": raw_text}, "source": "confidence_gate"}
            if len(filtered) == 1:
                return filtered[0]
            return {"intent": "__multi__", "intents": filtered, "params": {}, "source": "tools"}

        _dbus.emit("intent", VERBOSE, "gpt_no_tool_matched",
                   input=text, duration_ms=duration_ms,
                   suggestion="Check that the user's request maps to a known intent in tools_schema.py.")
        return {"intent": "unrecognized_command", "params": {"text": text}, "source": "tools"}

    except Exception as e:
        from core.debug_bus import bus as _dbus, BASIC
        _dbus.emit("intent", BASIC, "gpt_parse_error",
                   input=text, error=str(e), error_type=type(e).__name__,
                   result="exception",
                   suggestion="Check OpenAI API key and network connectivity.")
        return {"intent": "unrecognized_command", "params": {"text": text}, "source": "error"}
