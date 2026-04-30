"""
Short-term conversation context for pronoun/reference resolution.

Stores the last referenced device after a successful command so the intent
parser can resolve follow-up commands like "turn it back on" or "the light".

Expires automatically after EXPIRY_SECONDS of inactivity.
"""
from __future__ import annotations

import threading
from datetime import datetime, timedelta
from typing import Optional

EXPIRY_SECONDS = 300  # 5 minutes

_lock = threading.Lock()

# Single mutable context slot (last referenced device)
_room: Optional[str] = None
_device_type: Optional[str] = None
_entity_id: Optional[str] = None
_action: Optional[str] = None
_intent: Optional[str] = None
_updated_at: Optional[datetime] = None


def set_context(
    *,
    room: Optional[str] = None,
    device_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    action: Optional[str] = None,
    intent: Optional[str] = None,
) -> None:
    """Record the device referenced by the most recent successful command."""
    global _room, _device_type, _entity_id, _action, _intent, _updated_at
    with _lock:
        if room:        _room = room
        if device_type: _device_type = device_type
        if entity_id:   _entity_id = entity_id
        if action:      _action = action
        if intent:      _intent = intent
        _updated_at = datetime.utcnow()


def get_context() -> Optional[dict]:
    """Return the active context dict, or None if expired / empty."""
    with _lock:
        if _updated_at is None:
            return None
        if datetime.utcnow() - _updated_at > timedelta(seconds=EXPIRY_SECONDS):
            return None
        return {
            "room": _room,
            "device_type": _device_type,
            "entity_id": _entity_id,
            "action": _action,
            "intent": _intent,
        }


def clear_context() -> None:
    global _room, _device_type, _entity_id, _action, _intent, _updated_at
    with _lock:
        _room = _device_type = _entity_id = _action = _intent = _updated_at = None


def build_context_hint() -> str:
    """
    Return a one-line hint for the GPT system prompt describing the last
    referenced device, or an empty string if no context is active.
    """
    ctx = get_context()
    if not ctx or not ctx.get("room"):
        return ""
    room_name = ctx["room"].replace("_", " ")
    dtype = ctx.get("device_type") or "device"
    entity = ctx.get("entity_id") or ""
    entity_note = f" (entity: {entity})" if entity else ""
    return (
        f"\n\nConversation context — last referenced device: "
        f"{dtype} in the {room_name} room{entity_note}. "
        "If the user refers to 'it', 'that', 'the light', 'back', 'again', or similar pronouns "
        "without specifying a room or device, resolve them to this device and room."
    )
