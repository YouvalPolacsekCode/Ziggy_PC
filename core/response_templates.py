"""Bilingual (EN/HE) response strings for controlled Ziggy output."""
from __future__ import annotations


def _is_hebrew(text: str) -> bool:
    return any('֐' <= c <= 'ת' for c in text or "")


_RESPONSES: dict[str, dict[str, str]] = {
    "chat_mode_entered": {
        "en": "Chat mode on. Ask me anything. Say 'back to commands' when done.",
        "he": "מצב שיחה פעיל. אפשר לשאול אותי כל דבר. כדי לחזור — ״חזור לפקודות״.",
    },
    "chat_mode_exited": {
        "en": "Back to command mode.",
        "he": "חזרתי למצב פקודות.",
    },
    "command_fallback": {
        "en": "I didn't catch a command. Try: 'turn on the kitchen light', or say 'chat mode' to talk freely.",
        "he": "לא תפסתי את הפקודה. אפשר לנסות: ״הדלק את האור במטבח״, או להגיד ״מצב שיחה״ לשיחה חופשית.",
    },
    "clarify_room": {
        "en": "Which room?",
        "he": "איזה חדר?",
    },
    "clarify_device": {
        "en": "Which device?",
        "he": "איזה מכשיר?",
    },
    "confirm_destructive": {
        "en": "Are you sure? Say 'yes' to confirm or 'cancel' to abort.",
        "he": "בטוח? להגיד ״כן״ לאישור, ״ביטול״ כדי לעצור.",
    },
    "cancelled": {
        "en": "Cancelled.",
        "he": "בוטל.",
    },
    "not_supported": {
        "en": "That's not something I can do right now.",
        "he": "את זה אני עדיין לא יודע לעשות.",
    },
    "command_not_understood": {
        "en": "I didn't understand that command. Try saying it differently.",
        "he": "לא הבנתי. אפשר לנסח אחרת?",
    },
    "task_added": {
        "en": "Got it, task added.",
        "he": "קיבלתי, הוספתי.",
    },
    "reminder_set": {
        "en": "Reminder set.",
        "he": "קבעתי תזכורת.",
    },
    "good_night": {
        "en": "Good night. Turning everything off.",
        "he": "לילה טוב. מכבה הכל.",
    },
    "lights_on": {
        "en": "Lights on.",
        "he": "האור דולק.",
    },
    "lights_off": {
        "en": "Lights off.",
        "he": "האור כבוי.",
    },
    "no_device_found": {
        "en": "I couldn't find that device.",
        "he": "לא מצאתי את המכשיר.",
    },
    "connection_error": {
        "en": "Couldn't reach Home Assistant right now.",
        "he": "אין לי חיבור לבית כרגע. תכף אנסה שוב.",
    },
    "temperature_query": {
        "en": "Let me check the temperature.",
        "he": "רגע, בודק את הטמפרטורה.",
    },
    "home_status": {
        "en": "Here's what's happening at home:",
        "he": "הנה מה שקורה בבית:",
    },
}


def get_response(key: str, lang: str = "en") -> str:
    entry = _RESPONSES.get(key, {})
    return entry.get(lang) or entry.get("en") or f"[{key}]"


def get_response_for(key: str, text: str) -> str:
    """Auto-detect language from text and return the matching response."""
    lang = "he" if _is_hebrew(text) else "en"
    return get_response(key, lang)
