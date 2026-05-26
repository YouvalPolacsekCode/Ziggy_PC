"""
Vendor-specific WiFi command adapters for media_player entities.

Backend mirror of frontend/src/lib/mediaPlayerVendors.js — if you edit one,
edit the other. (Kept duplicated rather than imported across the JS/Python
boundary because the two are evaluated in completely different runtimes
and bundling them via codegen would be more friction than the small drift
risk justifies.)

Used by services.ir_manager.send_ir_command as a fallback when a
hybrid IR/HA device has a linked HA entity that can fire the command
over WiFi even though the IR codeset hasn't learned it. The most common
case: an IR macro like "open Netflix" sends [power_on, home, netflix],
but the user only learned the IR `power_on` code — `home` and `netflix`
are also reachable through the LG webOS HA service.
"""
from __future__ import annotations

from typing import Optional


def _attrs_of(entity_state: dict) -> dict:
    """state_cache entries are {state, attributes, last_changed}; raw
    HA REST responses are similar. Pull the attributes safely from either."""
    if not entity_state:
        return {}
    return entity_state.get("attributes") or {}


# Each adapter:
#   detect(state_entry)  → bool      (does this entity belong to this vendor?)
#   commands             → { ziggy_cmd: {"domain", "service", "data": {...}} }
#
# `data` MUST NOT include `entity_id` — the caller fills it in.
_ADAPTERS: list[dict] = [

    # ─── LG webOS ────────────────────────────────────────────────────────
    {
        "name": "webostv",
        "detect": lambda e: (
            _attrs_of(e).get("sound_output") is not None
            or any("lg" in str(s or "").lower() for s in (_attrs_of(e).get("source_list") or []))
        ),
        "commands": {
            "back":         {"domain": "webostv", "service": "button", "data": {"button": "BACK"}},
            "home":         {"domain": "webostv", "service": "button", "data": {"button": "HOME"}},
            "menu":         {"domain": "webostv", "service": "button", "data": {"button": "MENU"}},
            "exit":         {"domain": "webostv", "service": "button", "data": {"button": "EXIT"}},
            "info":         {"domain": "webostv", "service": "button", "data": {"button": "INFO"}},
            "nav_up":       {"domain": "webostv", "service": "button", "data": {"button": "UP"}},
            "nav_down":     {"domain": "webostv", "service": "button", "data": {"button": "DOWN"}},
            "nav_left":     {"domain": "webostv", "service": "button", "data": {"button": "LEFT"}},
            "nav_right":    {"domain": "webostv", "service": "button", "data": {"button": "RIGHT"}},
            "nav_ok":       {"domain": "webostv", "service": "button", "data": {"button": "ENTER"}},
            "channel_up":   {"domain": "webostv", "service": "button", "data": {"button": "CHANNELUP"}},
            "channel_down": {"domain": "webostv", "service": "button", "data": {"button": "CHANNELDOWN"}},
        },
    },

    # ─── Samsung Tizen ───────────────────────────────────────────────────
    {
        "name": "samsungtv",
        "detect": lambda e: (
            any("samsung" in str(s or "").lower() for s in (_attrs_of(e).get("source_list") or []))
        ),
        "commands": {
            "back":         {"domain": "samsungtv", "service": "send_key", "data": {"key": "KEY_RETURN"}},
            "home":         {"domain": "samsungtv", "service": "send_key", "data": {"key": "KEY_HOME"}},
            "menu":         {"domain": "samsungtv", "service": "send_key", "data": {"key": "KEY_MENU"}},
            "exit":         {"domain": "samsungtv", "service": "send_key", "data": {"key": "KEY_EXIT"}},
            "info":         {"domain": "samsungtv", "service": "send_key", "data": {"key": "KEY_INFO"}},
            "nav_up":       {"domain": "samsungtv", "service": "send_key", "data": {"key": "KEY_UP"}},
            "nav_down":     {"domain": "samsungtv", "service": "send_key", "data": {"key": "KEY_DOWN"}},
            "nav_left":     {"domain": "samsungtv", "service": "send_key", "data": {"key": "KEY_LEFT"}},
            "nav_right":    {"domain": "samsungtv", "service": "send_key", "data": {"key": "KEY_RIGHT"}},
            "nav_ok":       {"domain": "samsungtv", "service": "send_key", "data": {"key": "KEY_ENTER"}},
            "channel_up":   {"domain": "samsungtv", "service": "send_key", "data": {"key": "KEY_CHUP"}},
            "channel_down": {"domain": "samsungtv", "service": "send_key", "data": {"key": "KEY_CHDOWN"}},
        },
    },

    # ─── Sony Bravia (legacy braviatv integration) ───────────────────────
    # Modern `bravia` uses a paired remote.* — handled by frontend's
    # basename-match fallback, which the backend doesn't need to mirror
    # for the IR-macro use case (macros only target the IR device, not
    # the linked remote entity).
    {
        "name": "braviatv",
        "detect": lambda e: False,  # left for future use
        "commands": {},
    },
]


def find_adapter(entity_state: dict) -> Optional[dict]:
    """Return the first adapter that recognises this entity, else None."""
    if not entity_state:
        return None
    for a in _ADAPTERS:
        try:
            if a["detect"](entity_state):
                return a
        except Exception:
            # Defensive — a buggy detector shouldn't kill the macro.
            continue
    return None


def vendor_command_for(entity_state: dict, ziggy_cmd: str) -> Optional[dict]:
    """Return the vendor service spec ({domain, service, data}) for this
    ziggy command, or None if no adapter has a mapping. `data` does NOT
    include `entity_id` — caller must add it."""
    adapter = find_adapter(entity_state)
    if not adapter:
        return None
    spec = (adapter.get("commands") or {}).get(ziggy_cmd)
    return spec


# Ziggy's IR command vocabulary doesn't 1:1 match the vendor adapter keys
# above. Map the IR-style command names the user might learn (or include
# in a macro) to the canonical vendor-adapter keys. Extend as needed.
_IR_TO_VENDOR_KEY = {
    "home":         "home",
    "back":         "back",
    "menu":         "menu",
    "exit":         "exit",
    "info":         "info",
    "nav_up":       "nav_up",
    "nav_down":     "nav_down",
    "nav_left":     "nav_left",
    "nav_right":    "nav_right",
    "nav_ok":       "nav_ok",
    "ok":           "nav_ok",
    "channel_up":   "channel_up",
    "channel_down": "channel_down",
    "chan_up":      "channel_up",
    "chan_down":    "channel_down",
}


def ir_cmd_to_vendor_key(ir_cmd: str) -> Optional[str]:
    """Translate an IR-style command name (as stored in IR sequences) to
    the canonical vendor-adapter key. Returns None for IR commands that
    have no WiFi equivalent (e.g., `power_on` for a TV that's already on
    WiFi — the macro should keep using IR for those)."""
    if not ir_cmd:
        return None
    return _IR_TO_VENDOR_KEY.get(ir_cmd.lower())
