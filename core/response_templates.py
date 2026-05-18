"""Bilingual (EN/HE) response strings for controlled Ziggy output."""
from __future__ import annotations


def _is_hebrew(text: str) -> bool:
    return any('֐' <= c <= 'ת' for c in text or "")


_RESPONSES: dict[str, dict[str, str]] = {
    "chat_mode_entered": {
        "en": "Chat mode on. Ask me anything. Say 'back to commands' when done.",
        "he": "מצב שיחה פעיל. שאל אותי כל דבר. אמור 'חזור לפקודות' כשתסיים.",
    },
    "chat_mode_exited": {
        "en": "Back to command mode.",
        "he": "חזרתי למצב פקודות.",
    },
    "command_fallback": {
        "en": "I didn't catch a command. Try: 'turn on the kitchen light', or say 'chat mode' to talk freely.",
        "he": "לא הבנתי פקודה. נסה: 'הדלק את האור במטבח', או אמור 'מצב שיחה' לשיחה חופשית.",
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
        "he": "אתה בטוח? אמור 'כן' לאישור או 'ביטול' לביטול.",
    },
    "cancelled": {
        "en": "Cancelled.",
        "he": "בוטל.",
    },
    "not_supported": {
        "en": "That's not something I can do right now.",
        "he": "זה משהו שאני לא יכול לעשות כרגע.",
    },
    "command_not_understood": {
        "en": "I didn't understand that command. Try saying it differently.",
        "he": "לא הבנתי את הפקודה. נסה לנסח אחרת.",
    },
    "task_added": {
        "en": "Got it, task added.",
        "he": "קיבלתי, המשימה נוספה.",
    },
    "reminder_set": {
        "en": "Reminder set.",
        "he": "תזכורת נקבעה.",
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
        "he": "לא הצלחתי להתחבר ל-Home Assistant כרגע.",
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
