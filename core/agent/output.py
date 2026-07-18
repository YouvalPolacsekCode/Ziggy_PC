"""Output contract for the v2 agent.

Two jobs:
  1. render_device_confirmation() — deterministic, terse, native-Hebrew
     confirmation for successful device actions, so the common command case
     ("turn off the lamp") needs only ONE model round-trip. Uses the Hebrew
     device noun + Hebrew room ("כיביתי את המנורה בסלון") — never the English
     proper name, never the room slug (fixes F4).
  2. sanitize_reply() — strip anything the user must never see (entity_ids, HA
     terms) and, for voice, strip markdown/symbols the TTS would read aloud.
"""
from __future__ import annotations

import re
from typing import Optional

from core.agent.directory import room_prep_he


# ── Deterministic device-action confirmation ─────────────────────────────────
_HE_VERB = {
    "on": "הדלקתי את", "off": "כיביתי את",
    "open": "פתחתי את", "close": "סגרתי את",
    "lock": "נעלתי את", "unlock": "שחררתי את",
    "set_temperature": "כיוונתי את", "set_brightness": "כיוונתי את",
    "set_color": "שיניתי את הצבע של",
}
_EN_VERB = {
    "on": "Turned on", "off": "Turned off",
    "open": "Opened", "close": "Closed",
    "lock": "Locked", "unlock": "Unlocked",
    "set_temperature": "Set", "set_brightness": "Set",
    "set_color": "Changed the colour of",
}


def _he_one(res: dict) -> Optional[str]:
    dev = res.get("device") or {}
    action = res.get("action")
    noun = dev.get("he_noun") or "המכשיר"
    prep = room_prep_he(dev.get("room"))
    val = res.get("value")
    if action == "set_temperature":
        return f"כיוונתי את המזגן {prep} ל-{val} מעלות".strip()
    if action == "set_brightness":
        return f"כיוונתי את {noun} {prep} ל-{val}%".strip()
    verb = _HE_VERB.get(action)
    if not verb:
        return None
    return f"{verb} {noun} {prep}".strip()


def _en_one(res: dict) -> Optional[str]:
    dev = res.get("device") or {}
    action = res.get("action")
    name = dev.get("name") or "device"
    val = res.get("value")
    if action == "set_temperature":
        return f"Set the {name} to {val}°C"
    if action == "set_brightness":
        return f"Set the {name} to {val}%"
    verb = _EN_VERB.get(action)
    if not verb:
        return None
    return f"{verb} the {name}"


def render_device_confirmation(results: list[dict], lang: str) -> Optional[str]:
    """Return a terse confirmation IFF every result is a successful device
    action we can phrase deterministically. Otherwise None (caller lets the
    model narrate)."""
    if not results:
        return None
    parts: list[str] = []
    for r in results:
        if not (r.get("ok") and r.get("device") and r.get("action")):
            return None
        one = _he_one(r) if lang == "he" else _en_one(r)
        if not one:
            return None
        parts.append(one.strip())
    if not parts:
        return None
    if lang == "he":
        joined = parts[0] if len(parts) == 1 else " ו".join([parts[0]] + [p.lstrip() for p in parts[1:]])
        return joined.rstrip(".") + "."
    joined = parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + f" and {parts[-1]}"
    return joined.rstrip(".") + "."


# ── Sanitizer ────────────────────────────────────────────────────────────────
# entity_id shape: domain.rest  (lowercase domain, then a dot, then id chars)
_ENTITY_RE = re.compile(r"\b(?:light|switch|climate|media_player|fan|cover|lock|"
                        r"vacuum|humidifier|water_heater|binary_sensor|sensor|"
                        r"input_boolean|automation)\.[a-z0-9_]+", re.IGNORECASE)
_HA_TERMS_RE = re.compile(r"\b(home assistant|hass|entity[_ ]id|integration)\b", re.IGNORECASE)
# Voice: structural markdown chars TTS would read literally.
_MD_RE = re.compile(r"[*_`#|>]+")


def sanitize_reply(text: str, *, channel: str = "chat") -> str:
    if not text:
        return text
    text = _ENTITY_RE.sub("", text)
    text = _HA_TERMS_RE.sub("", text)
    if channel == "voice":
        text = _MD_RE.sub("", text)
    # collapse whitespace the substitutions may have left
    text = re.sub(r"\s{2,}", " ", text).strip()
    return text
