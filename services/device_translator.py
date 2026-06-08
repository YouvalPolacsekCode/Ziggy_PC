"""Bidirectional translation between Ziggy-native devices and HA/IR transports.

This is the edge-side seam the brain talks through. It owns:

  - Wrapping a device_registry row in a ZiggyDevice (HA-isms stay inside)
  - Resolving a ZiggyDeviceId back to a concrete registry row
  - Expanding selectors ("all_lights", {"room": "bedroom"}) into device sets
    USING THE LIVE LOCAL REGISTRY — never by asking the brain to enumerate
  - route_command(ziggy_id, capability, params): edge-side execution that
    delegates the hybrid HA-vs-IR decision to services.command_router
  - query_state(ziggy_id): edge-side state read from ha_subscriber's live
    cache (cheap) with a REST fallback

Design constraints
------------------
1. The brain must NOT see HA entity_ids, HA service names, or IR codeset
   names. Everything crossing the seam is in ZiggyDevice / ZiggySelector
   terms.
2. command_router stays untouched — it already does the right thing once
   handed a registry entry. This module is the thin adapter above it.
3. NOTHING in this pass rips entity_id out of internal modules. The seam
   is the new entry point; the modules below it continue to speak HA.
   See REMAINING_ENTITY_ID_USERS at the bottom of this file for the
   documented list.
"""
from __future__ import annotations

from typing import Iterable, Optional

from core.logger_module import log_error
from services import device_registry, ha_client
from services.device_schema import (
    CAP_CLOSE,
    CAP_LOCK,
    CAP_MUTE,
    CAP_OPEN,
    CAP_PAUSE,
    CAP_PLAY,
    CAP_SET_BRIGHTNESS,
    CAP_SET_COLOR,
    CAP_SET_FAN_MODE,
    CAP_SET_HVAC_MODE,
    CAP_SET_SOURCE,
    CAP_SET_TEMPERATURE,
    CAP_STOP,
    CAP_TOGGLE,
    CAP_TURN_OFF,
    CAP_TURN_ON,
    CAP_UNLOCK,
    CAP_VOLUME_DOWN,
    CAP_VOLUME_UP,
    ZiggyDevice,
    ZiggySelector,
)


# ── ID encoding ─────────────────────────────────────────────────────────────
#
# Ziggy IDs are opaque prefixed strings. The brain never parses them.
_PREFIX_HA = "ha:"
_PREFIX_IR = "ir:"
_PREFIX_UNCONFIGURED = "unconfigured:"


def ziggy_id_for(entry: dict) -> str:
    """Compute a stable ZiggyDeviceId from a registry row.

    For HA-backed devices the id embeds the entity_id; for IR-only devices
    the id embeds the ir_device_id. The brain treats both forms as opaque.
    """
    eid = entry.get("entity_id")
    if eid:
        return f"{_PREFIX_HA}{eid}"
    ir_id = entry.get("ir_device_id")
    if ir_id:
        return f"{_PREFIX_IR}{ir_id}"
    room = entry.get("room") or ""
    dtype = entry.get("device_type") or "unknown"
    return f"{_PREFIX_UNCONFIGURED}{room}:{dtype}"


def to_ha_entity_id(ziggy_id: str) -> Optional[str]:
    """Resolve a Ziggy id to an HA entity_id (None if IR-only / unconfigured)."""
    if ziggy_id.startswith(_PREFIX_HA):
        return ziggy_id[len(_PREFIX_HA):]
    # An HA-backed device may also have an IR fallback registered elsewhere;
    # callers that need the IR side ask via to_ir_device_id() instead.
    return None


def to_ir_device_id(ziggy_id: str) -> Optional[str]:
    """Resolve to the IR codeset id (None if no IR codeset is linked).

    HA-backed devices may carry an ir_device_id as a fallback for hybrid
    routing — return that when present so callers don't have to know which
    branch they took.
    """
    if ziggy_id.startswith(_PREFIX_IR):
        return ziggy_id[len(_PREFIX_IR):]
    if ziggy_id.startswith(_PREFIX_HA):
        entry = lookup_entry(ziggy_id)
        if entry:
            return entry.get("ir_device_id")
    return None


def lookup_entry(ziggy_id: str) -> Optional[dict]:
    """Resolve a Ziggy id back to the underlying device_registry row."""
    if ziggy_id.startswith(_PREFIX_HA):
        return device_registry.get_device_info(ziggy_id[len(_PREFIX_HA):])
    if ziggy_id.startswith(_PREFIX_IR):
        ir_id = ziggy_id[len(_PREFIX_IR):]
        for d in device_registry.get_all():
            if d.get("ir_device_id") == ir_id and not d.get("entity_id"):
                return d
        return None
    if ziggy_id.startswith(_PREFIX_UNCONFIGURED):
        rest = ziggy_id[len(_PREFIX_UNCONFIGURED):]
        if ":" not in rest:
            return None
        room, dtype = rest.split(":", 1)
        for d in device_registry.get_all():
            if d.get("room") == room and d.get("device_type") == dtype:
                return d
    return None


# ── Capability inference ────────────────────────────────────────────────────
#
# Each HA domain implies a set of Ziggy capabilities. The mapping below is
# the single source of truth for "what verbs can the brain emit for a device
# of this type". Driven by services.domain_registry where possible — fall
# back to defaults when a domain isn't registered.

_DOMAIN_CAPABILITIES: dict[str, tuple[str, ...]] = {
    "light":         (CAP_TURN_ON, CAP_TURN_OFF, CAP_TOGGLE, CAP_SET_BRIGHTNESS, CAP_SET_COLOR),
    "switch":        (CAP_TURN_ON, CAP_TURN_OFF, CAP_TOGGLE),
    "input_boolean": (CAP_TURN_ON, CAP_TURN_OFF, CAP_TOGGLE),
    "climate":       (CAP_TURN_ON, CAP_TURN_OFF, CAP_SET_TEMPERATURE, CAP_SET_HVAC_MODE, CAP_SET_FAN_MODE),
    "fan":           (CAP_TURN_ON, CAP_TURN_OFF, CAP_TOGGLE),
    "media_player":  (CAP_TURN_ON, CAP_TURN_OFF, CAP_PLAY, CAP_PAUSE, CAP_STOP,
                      CAP_SET_SOURCE, CAP_VOLUME_UP, CAP_VOLUME_DOWN, CAP_MUTE),
    "tv":            (CAP_TURN_ON, CAP_TURN_OFF, CAP_SET_SOURCE,
                      CAP_VOLUME_UP, CAP_VOLUME_DOWN, CAP_MUTE),
    "cover":         (CAP_OPEN, CAP_CLOSE, CAP_STOP),
    "lock":          (CAP_LOCK, CAP_UNLOCK),
    # Sensor-type domains are read-only — they expose state but no verbs.
    "sensor":        (),
    "binary_sensor": (),
}


def capabilities_for(entry: dict) -> tuple[str, ...]:
    """Return the capability verb tuple for a registry row.

    For HA-backed devices, infers from the entity_id domain. For IR-only
    devices, uses the device_type to choose a default set — the actual
    learned IR codeset may not contain every verb in the set, but
    command_router will fail individual verbs with a clean error rather
    than us advertising fewer verbs than we have.
    """
    eid = entry.get("entity_id") or ""
    if eid and "." in eid:
        domain = eid.split(".", 1)[0]
        if domain in _DOMAIN_CAPABILITIES:
            return _DOMAIN_CAPABILITIES[domain]
    dtype = (entry.get("device_type") or "").lower()
    if dtype in _DOMAIN_CAPABILITIES:
        return _DOMAIN_CAPABILITIES[dtype]
    # Sensible default — any unknown controllable device can probably toggle
    return (CAP_TURN_ON, CAP_TURN_OFF, CAP_TOGGLE)


# ── Ziggy ⇄ registry-row conversion ─────────────────────────────────────────

def to_ziggy(entry: dict) -> ZiggyDevice:
    """Wrap a device_registry row in a ZiggyDevice."""
    return ZiggyDevice(
        id=ziggy_id_for(entry),
        room=entry.get("room"),
        device_type=(entry.get("device_type") or "unknown"),
        name=(entry.get("name") or entry.get("entity_id") or entry.get("ir_device_id") or "unknown"),
        capabilities=capabilities_for(entry),
        status=(entry.get("status") or "unknown"),
        ha_entity_id=entry.get("entity_id"),
        ir_device_id=entry.get("ir_device_id"),
        tags=tuple(entry.get("tags") or ()),
    )


# ── Enumeration ─────────────────────────────────────────────────────────────

def list_devices(
    *,
    device_type: str | None = None,
    room: str | None = None,
) -> list[ZiggyDevice]:
    """Edge-side device enumeration. Reads the live device_registry.

    The brain should call this rather than its own enumeration — only the
    edge has the live registry. Filters are applied after wrapping so
    capability inference is consistent.
    """
    dtype_norm = (device_type or "").lower() or None
    room_norm = ((room or "").lower().replace(" ", "_").strip()) or None
    out: list[ZiggyDevice] = []
    for raw in device_registry.get_all():
        if dtype_norm and (raw.get("device_type") or "").lower() != dtype_norm:
            continue
        if room_norm and (raw.get("room") or "") != room_norm:
            continue
        out.append(to_ziggy(raw))
    return out


# ── Selector expansion ──────────────────────────────────────────────────────
#
# This is the "expansion lives on the edge" guarantee from Task 3. The brain
# can emit a high-level selector ("all_lights"); the edge resolves it to a
# concrete device list from the LIVE registry.

def expand_selector(selector: ZiggySelector) -> list[ZiggyDevice]:
    """Expand a ZiggySelector into a concrete list of ZiggyDevices.

    Accepted forms:
      "all"                                  → every connected/ir-only device
      "all_lights" / "all_<type>"            → every device of that type
      {"id": "ha:light.x"}                   → degenerate single-device selector
      {"type": "light"}                      → all devices of that type
      {"room": "bedroom"}                    → all devices in that room
      {"room": "bedroom", "type": "light"}   → bedroom lights
    """
    if isinstance(selector, str):
        s = selector.strip().lower()
        if s == "all":
            return [d for d in list_devices() if d.status in ("connected", "ir_only")]
        if s.startswith("all_"):
            dtype = s[len("all_"):]
            # Tolerate plurals: "all_lights" → "light".
            dtype = dtype.rstrip("s") or dtype
            return [d for d in list_devices(device_type=dtype) if d.status in ("connected", "ir_only")]
        # Anything else is treated as a single Ziggy id.
        entry = lookup_entry(selector)
        return [to_ziggy(entry)] if entry else []

    if isinstance(selector, dict):
        if "id" in selector:
            entry = lookup_entry(selector["id"])
            return [to_ziggy(entry)] if entry else []
        return [
            d for d in list_devices(
                device_type=selector.get("type"),
                room=selector.get("room"),
            )
            if d.status in ("connected", "ir_only")
        ]

    return []


# ── Verb → HA service translation ───────────────────────────────────────────
#
# When command_router._execute_wifi calls HA, it does
# `call_service(domain, command, payload)`. For verbs that map 1:1 to HA
# service names (turn_on/turn_off/toggle/open/close/play/pause/stop/lock/
# unlock) we pass the verb through verbatim. For verbs that don't (e.g.
# Ziggy "set_temperature" → HA "set_temperature" — happens to match; Ziggy
# "set_brightness" → HA "turn_on" with a brightness_pct payload) the verb
# is rewritten before delegation.
#
# Today most map directly. The interesting ones are documented inline.

_VERB_TO_HA_SERVICE = {
    # 1:1 mappings — these names already match HA service names.
    CAP_TURN_ON:         "turn_on",
    CAP_TURN_OFF:        "turn_off",
    CAP_TOGGLE:          "toggle",
    CAP_SET_TEMPERATURE: "set_temperature",
    CAP_SET_HVAC_MODE:   "set_hvac_mode",
    CAP_SET_FAN_MODE:    "set_fan_mode",
    CAP_SET_SOURCE:      "select_source",
    CAP_VOLUME_UP:       "volume_up",
    CAP_VOLUME_DOWN:     "volume_down",
    CAP_MUTE:            "volume_mute",
    CAP_PLAY:            "media_play",
    CAP_PAUSE:           "media_pause",
    CAP_STOP:            "media_stop",
    CAP_OPEN:            "open_cover",
    CAP_CLOSE:           "close_cover",
    CAP_LOCK:            "lock",
    CAP_UNLOCK:          "unlock",
    # Aliased: set_brightness uses HA's turn_on with a brightness_pct payload.
    # The caller is expected to pass {"brightness_pct": N} in params.
    CAP_SET_BRIGHTNESS:  "turn_on",
    # set_color likewise rides turn_on with an rgb_color payload.
    CAP_SET_COLOR:       "turn_on",
}


def _capability_to_command_router_command(capability: str) -> str:
    """Translate a Ziggy verb to the command-router command string.

    command_router speaks HA service names natively (turn_on/turn_off/…) and
    has its own alias table for IR codesets. For verbs that already match HA,
    return verbatim; for the alias cases (set_brightness, set_color), return
    "turn_on" so the existing router path executes correctly.
    """
    return _VERB_TO_HA_SERVICE.get(capability, capability)


# ── Edge-side command execution ─────────────────────────────────────────────

def route_command(
    ziggy_id: str,
    capability: str,
    params: dict | None = None,
) -> dict:
    """Edge-side execution of a Ziggy capability on a Ziggy device.

    The brain calls this once; the edge handles:
      - looking up the registry row,
      - translating the verb to the command-router's command vocabulary,
      - delegating the hybrid HA-vs-IR routing decision to command_router.

    Return shape matches command_router.route_command (ok, message, plus
    debugging fields like _routed_via / _attempts).
    """
    entry = lookup_entry(ziggy_id)
    if not entry:
        return {
            "ok": False,
            "message": f"Unknown Ziggy device id: {ziggy_id}",
            "_routed_via": None,
            "_attempts": [],
        }

    # The router needs hybrid linkage to choose between Wi-Fi and IR; ask the
    # router itself to enrich the entry so we don't recreate that logic here.
    try:
        from services.command_router import resolve_hybrid_entry, route_command as _route
        enriched = resolve_hybrid_entry(entry.get("entity_id") or "", entry)
    except Exception as e:
        log_error(f"[device_translator] router import failed: {e}")
        return {"ok": False, "message": f"router import failed: {e}"}

    command = _capability_to_command_router_command(capability)
    return _route(enriched, command, params)


# ── Edge-side state query ───────────────────────────────────────────────────

def query_state(ziggy_id: str) -> dict:
    """Edge-side state read.

    For HA-backed devices: prefer ha_subscriber's live state cache; fall
    back to a REST get_state. For IR-only devices: return the assumed
    state tracked by ir_manager (the actual device has no Wi-Fi link to
    query).
    """
    entry = lookup_entry(ziggy_id)
    if entry is None:
        return {"ok": False, "message": f"Unknown Ziggy device id: {ziggy_id}"}

    entity_id = entry.get("entity_id")
    if entity_id:
        # Live cache hit is cheaper than a REST round-trip.
        try:
            from services.ha_subscriber import state_cache
            cached = state_cache.get(entity_id)
            if cached is not None:
                return {
                    "ok": True,
                    "state": cached.get("state"),
                    "attributes": cached.get("attributes") or {},
                    "source": "cache",
                }
        except Exception:
            pass
        result = ha_client.get_state(entity_id)
        if result.get("ok"):
            data = result.get("data") or {}
            return {
                "ok": True,
                "state": data.get("state"),
                "attributes": data.get("attributes") or {},
                "source": "rest",
            }
        return {"ok": False, "message": result.get("message", "state unavailable")}

    # IR-only path
    ir_id = entry.get("ir_device_id")
    if ir_id:
        try:
            from services.ir_manager import get_ir_device
            ir = get_ir_device(ir_id) or {}
            return {
                "ok": True,
                "state": ir.get("assumed_state", "unknown"),
                "attributes": {"transport": "ir"},
                "source": "ir_assumed",
            }
        except Exception as e:
            log_error(f"[device_translator] ir state read failed: {e}")
            return {"ok": False, "message": str(e)}

    return {"ok": False, "message": "device has no transport configured"}


# ── REMAINING_ENTITY_ID_USERS ───────────────────────────────────────────────
#
# Modules and code paths that still speak HA entity_id directly, as of this
# pass. None of them are bugs — the user explicitly allowed leaving them in
# place: "You do NOT have to rip entity_id out of every internal module in
# this pass". When the brain moves remote, each of these will need to be
# either kept on the edge OR migrated to ZiggyDeviceId.
#
# EDGE-LOCAL (keep as-is — they belong on the edge anyway):
#   services/ha_subscriber.py        — live state cache keyed by entity_id
#   services/anomaly_engine.py       — runs on edge, reacts to entity_id events
#   services/command_router.py       — edge transport layer (HA vs IR)
#   services/ha_*.py                 — HA REST/WS clients
#   services/device_registry.py      — owns the entity_id ↔ Ziggy device mapping
#   services/ha_client.py            — by definition HA-aware
#   services/ir_manager.py           — IR codeset storage, edge-only
#   services/ir_listener.py          — Broadlink physical-remote listener
#   services/automation_history.py   — logs already-resolved entity_ids
#   services/pattern_logger.py       — events.jsonl logs entity_ids
#   services/state_memory.py         — last-known-state per entity_id
#
# BRAIN-SIDE THAT STILL TOUCHES entity_id (would need migration if brain
# moved remote — they are the "everything you said the cloud phase needs
# to clean up later" set):
#   core/intent_parser.py            — receives entity_id-shaped tool arguments
#                                       from the GPT call (tools_schema builds
#                                       control_device tool from DOMAIN_REGISTRY)
#   core/action_parser.py            — passes params verbatim to handlers
#   core/handlers/light_handler.py   — params["entity_id"] read directly
#   core/handlers/climate_handler.py — same
#   core/handlers/tv_handler.py      — same
#   core/handlers/sensor_handler.py  — same
#   core/handlers/ir_handler.py      — uses ir_device_id, OK on the edge
#   core/handlers/automation_handler.py — passes entity_id-shaped configs through
#   core/handlers/device_handler.py    — generic control_device by entity_id
#   core/handlers/anomaly_handler.py   — references entity_id in messages
#   core/conversation_context.py       — stores entity_id for pronoun resolution
#   backend/routers/ha_router.py       — exposes entity-id-shaped responses
#   backend/routers/intent_router.py   — relays handler return shapes
#
# The path forward in a later pass: rewrite the handler layer to consume
# ZiggyDeviceId via device_translator.route_command/query_state. tools_schema
# and intent_parser then learn to emit Ziggy ids instead of entity_ids.
