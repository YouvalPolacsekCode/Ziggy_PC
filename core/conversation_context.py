"""
Short-term conversation context for pronoun/reference resolution.

Two slots:
  - Single-device: tracks the last room+device after a per-room command.
  - Bulk: tracks every device acted on by a bulk command so GPT can issue
    one tool call per device when asked to undo/repeat the action.

Both expire after EXPIRY_SECONDS of inactivity.
"""
from __future__ import annotations

import threading
from datetime import datetime, timedelta
from typing import Optional

EXPIRY_SECONDS = 300  # 5 minutes

_lock = threading.Lock()
_updated_at: Optional[datetime] = None

# Single-device slot
_room: Optional[str] = None
_device_type: Optional[str] = None
_entity_id: Optional[str] = None
_action: Optional[str] = None
_intent: Optional[str] = None

# Bulk slot — each entry: {room, device_type, action, tool, tool_params}
# tool / tool_params let GPT know exactly which existing function to call per device.
_bulk_devices: list[dict] = []


# ---------------------------------------------------------------------------
# Writers
# ---------------------------------------------------------------------------

def set_context(
    *,
    room: Optional[str] = None,
    device_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    action: Optional[str] = None,
    intent: Optional[str] = None,
) -> None:
    """Record the device referenced by the most recent per-room command."""
    global _room, _device_type, _entity_id, _action, _intent, _updated_at, _bulk_devices
    with _lock:
        if room:        _room = room
        if device_type: _device_type = device_type
        if entity_id:   _entity_id = entity_id
        if action:      _action = action
        if intent:      _intent = intent
        _bulk_devices = []          # single-device command clears bulk slot
        _updated_at = datetime.utcnow()


def set_bulk_context(devices: list[dict]) -> None:
    """Record every device touched by a bulk command.

    Each entry must have at least: room, device_type, action, tool, tool_params.
    Example entry produced by turn_off_all_lights:
      {
        "room": "office",
        "device_type": "light",
        "action": "off",
        "tool": "toggle_light",
        "tool_params": {"room": "office", "turn_on": false},
      }
    tool_params are the inverse params — what to call to UNDO the action.
    """
    global _bulk_devices, _room, _device_type, _entity_id, _action, _intent, _updated_at
    with _lock:
        _bulk_devices = list(devices)
        _room = _device_type = _entity_id = _action = _intent = None
        _updated_at = datetime.utcnow()


def clear_context() -> None:
    global _room, _device_type, _entity_id, _action, _intent, _updated_at, _bulk_devices
    with _lock:
        _room = _device_type = _entity_id = _action = _intent = _updated_at = None
        _bulk_devices = []


# ---------------------------------------------------------------------------
# Readers
# ---------------------------------------------------------------------------

def _is_expired() -> bool:
    return _updated_at is None or (datetime.utcnow() - _updated_at > timedelta(seconds=EXPIRY_SECONDS))


def get_context() -> Optional[dict]:
    with _lock:
        if _is_expired() or not _room:
            return None
        return {
            "room": _room, "device_type": _device_type,
            "entity_id": _entity_id, "action": _action, "intent": _intent,
        }


def get_bulk_context() -> list[dict]:
    with _lock:
        if _is_expired():
            return []
        return list(_bulk_devices)


def build_context_hint() -> str:
    """GPT system-prompt hint — describes last action so follow-up commands resolve correctly."""
    bulk = get_bulk_context()
    if bulk:
        lines = []
        for d in bulk:
            room = (d.get("room") or "").replace("_", " ")
            dtype = d.get("device_type") or "device"
            action = d.get("action") or "acted on"
            tool = d.get("tool") or ""
            tp = d.get("tool_params") or {}
            tp_str = ", ".join(f'{k}={v!r}' for k, v in tp.items())
            lines.append(f'  - {dtype} in {room}: {action} → restore by calling {tool}({tp_str})')
        body = "\n".join(lines)
        return (
            f"\n\nConversation context — last bulk action affected {len(bulk)} device(s):\n{body}\n"
            "IMPORTANT: Only use this restore context when the user references a PRIOR action with "
            "pronouns ('them', 'those', 'it', 'that') or words like 'back', 'undo', 'restore', 'again'. "
            "If the user gives an explicit fresh command ('turn on all lights', 'turn on everything') "
            "ignore this context and use the known rooms to issue the full set of tool calls."
        )

    ctx = get_context()
    if not ctx or not ctx.get("room"):
        # No prior device context — tell GPT not to guess when pronouns are used.
        return (
            "\n\nConversation context: none. "
            "If the user uses pronouns ('it', 'that', 'the light', 'the device') or a generic "
            "device name without specifying a room, do NOT guess a room — fall through as "
            "unrecognized so the user is prompted to clarify which room and device they mean."
        )
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
