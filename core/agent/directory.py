"""HA-truth device directory for the v2 agent.

The single source of truth for "what devices exist, what are they really called,
which room are they in, and what's their current state" — built from the SAME
place the frontend device list trusts:

  - names + state : live HA states (services.home_automation.get_all_states, REST)
  - canonical room: HA areas (services.ha_areas.get_areas), i.e. area_id truth
                    (aligns with commit 2b86e04 "canonicalize room refs to HA
                    area_id"). Falls back to the device registry room only when
                    HA has no area for the entity.

This is what fixes F1: the v1 command path resolved devices by (room, type) over
a STALE registry and never read the real friendly_name. Here the agent sees the
real name ("Living Room Lamp") and targets the exact entity_id.

Nothing here is user-facing raw: entity_ids are internal plumbing (the agent uses
them in tool calls); the reply layer never surfaces them.
"""
from __future__ import annotations

from typing import Any, Optional

from core.logger_module import log_error
from services.room_alias_bank import ROOM_ALIAS_BANK_HE


# Domains the agent can control / that count as a "device" in the directory.
CONTROLLABLE_DOMAINS = frozenset({
    "light", "switch", "climate", "media_player", "fan",
    "cover", "lock", "vacuum", "humidifier", "water_heater", "input_boolean",
})

# binary_sensor buckets that answer "is anyone in this room".
_PRESENCE_HINTS = ("motion", "occupancy", "presence", "pir", "mmwave")

# Switch/entity name fragments that are noise, not user devices — Zigbee config
# toggles that HA exposes as switches. Hidden from the directory.
_NOISE_FRAGMENTS = (
    "do_not_disturb", "selfidentification", "self_identification",
    "permit_join", "ai_sensitivity", "interference", "_led", "child_lock",
    "power_on_behavior", "_indicator",
)


# ── Hebrew room names (slug → canonical Hebrew), first-seen inversion ─────────
def _build_slug_to_he() -> dict[str, str]:
    out: dict[str, str] = {}
    for he_name, slug in ROOM_ALIAS_BANK_HE.items():
        out.setdefault(slug, he_name)  # first-seen is the canonical one
    return out


_SLUG_TO_HE = _build_slug_to_he()


def room_he(slug: Optional[str]) -> Optional[str]:
    """Canonical Hebrew name for a room slug, or the prettified slug if unknown."""
    if not slug:
        return None
    return _SLUG_TO_HE.get(slug) or slug.replace("_", " ")


def room_prep_he(slug: Optional[str]) -> str:
    """Hebrew 'in <room>' — e.g. living_room → 'בסלון'. Empty when unknown."""
    he = room_he(slug)
    return f"ב{he}" if he else ""


# ── Hebrew device noun (native phrasing, never the English proper name) ───────
def he_noun(entity_id: str, name: str) -> str:
    """A native Hebrew noun for a device so replies read 'המנורה' / 'המזגן'
    rather than leaking the English 'Living Room Lamp'."""
    dom = entity_id.split(".", 1)[0]
    low = (name or "").lower()
    if dom == "light":
        return "המנורה" if "lamp" in low else "האור"
    if dom == "climate":
        return "המזגן"
    if dom == "media_player":
        return "הטלוויזיה"
    if dom == "fan":
        return "המאוורר"
    if dom == "cover":
        return "התריס"
    if dom == "lock":
        return "המנעול"
    if dom in ("water_heater",) or "boiler" in low or "דוד" in low:
        return "הדוד"
    if dom in ("switch", "input_boolean"):
        return "המכשיר"
    if dom == "vacuum":
        return "השואב"
    return "המכשיר"


def _slugify_area(name: str) -> str:
    return (name or "").strip().lower().replace(" ", "_")


def _is_noise(entity_id: str) -> bool:
    low = entity_id.lower()
    return any(frag in low for frag in _NOISE_FRAGMENTS)


async def _entity_area_map() -> dict[str, str]:
    """entity_id → canonical room slug, from HA areas."""
    try:
        from services.ha_areas import get_areas
        areas = await get_areas()
    except Exception as e:
        log_error(f"[agent.directory] get_areas failed: {e}")
        return {}
    out: dict[str, str] = {}
    for area in areas or []:
        slug = _slugify_area(area.get("name", ""))
        for eid in area.get("entities", []) or []:
            out[eid] = slug
    return out


def _registry_room(entity_id: str) -> Optional[str]:
    """Fallback room from the device registry (used only when HA has no area)."""
    try:
        from services.device_registry import get_device_info
        info = get_device_info(entity_id) or {}
        return info.get("room")
    except Exception:
        return None


async def build_directory() -> dict[str, Any]:
    """Assemble the HA-truth directory.

    Returns:
        {
          "devices": [ {entity_id, name, room, room_he, domain, state, on,
                        he_noun}, ... ],   # controllable, user-facing
          "presence": [ {entity_id, room, state, on}, ... ],  # motion/occupancy
          "by_room": {slug: [device, ...]},
        }
    """
    from services.home_automation import get_all_states

    states = get_all_states()
    area_map = await _entity_area_map()

    devices: list[dict] = []
    presence: list[dict] = []

    for s in states or []:
        eid = s.get("entity_id") or ""
        if not eid or "." not in eid:
            continue
        dom = eid.split(".", 1)[0]
        attrs = s.get("attributes") or {}
        state = str(s.get("state", ""))
        name = attrs.get("friendly_name") or eid.split(".", 1)[1].replace("_", " ").title()
        room = area_map.get(eid) or _registry_room(eid)

        # Presence sensors (for room_occupancy) — motion / occupancy / presence.
        if dom == "binary_sensor":
            dc = (attrs.get("device_class") or "").lower()
            low = eid.lower()
            if dc in ("motion", "occupancy", "presence", "moving") or any(h in low for h in _PRESENCE_HINTS):
                presence.append({
                    "entity_id": eid, "room": room, "state": state,
                    "on": state == "on",
                })
            continue

        if dom not in CONTROLLABLE_DOMAINS:
            continue
        if _is_noise(eid):
            continue
        if state in ("unavailable",):
            # still list it, but mark; agent can tell the user it's offline
            pass

        devices.append({
            "entity_id": eid,
            "name": name,
            "room": room,
            "room_he": room_he(room),
            "domain": dom,
            "state": state,
            "on": state not in ("off", "unavailable", "unknown", "", "closed", "locked", "idle", "standby"),
            "he_noun": he_noun(eid, name),
        })

    # ── IR devices (Broadlink) — no HA entity; controlled via the ir_* tools ──
    devices.extend(_ir_devices())

    by_room: dict[str, list] = {}
    for d in devices:
        by_room.setdefault(d["room"] or "unknown", []).append(d)

    return {"devices": devices, "presence": presence, "by_room": by_room}


_IR_NOUN = {"tv": "הטלוויזיה", "ac": "המזגן", "fan": "המאוורר",
            "soundbar": "הרמקול", "projector": "המקרן"}


def _infer_ir_type(dev: dict) -> str:
    t = (dev.get("device_type") or dev.get("type") or "").lower()
    if t:
        return t
    name = (dev.get("name") or "").lower()
    if "tv" in name or "טלוויז" in name:
        return "tv"
    if "ac" in name or "מזגן" in name or "climate" in name:
        return "ac"
    if "fan" in name or "מאוורר" in name:
        return "fan"
    return "custom"


def _ir_devices() -> list[dict]:
    try:
        from services.ir_manager import list_ir_devices, get_device_state
    except Exception as e:
        log_error(f"[agent.directory] ir list import failed: {e}")
        return []
    out: list[dict] = []
    try:
        for dev in list_ir_devices():
            ir_type = _infer_ir_type(dev)
            room = (dev.get("room") or "").strip() or None
            try:
                state = get_device_state(dev)
            except Exception:
                state = "unknown"
            out.append({
                "entity_id": f"ir:{dev.get('id')}",
                "name": dev.get("name") or ir_type.upper(),
                "room": room,
                "room_he": room_he(room),
                "domain": ir_type,
                "state": state,
                "on": state == "on",
                "he_noun": _IR_NOUN.get(ir_type, "המכשיר"),
                "ir": True,
                "ir_id": dev.get("id"),
                "ir_type": ir_type,
            })
    except Exception as e:
        log_error(f"[agent.directory] ir list failed: {e}")
    return out


def format_directory_for_prompt(directory: dict) -> str:
    """Compact, LLM-friendly listing the agent resolves references against.

    One line per device:  <name> | room=<slug> | <domain> | <state> | id=<entity_id>
    The agent copies the id verbatim into control_device; it must NEVER echo the
    id to the user (enforced by the output contract + a post-filter).
    """
    devices = directory.get("devices") or []
    if not devices:
        return "NO DEVICES FOUND (home may still be starting up)."
    # Group by room for readability.
    by_room: dict[str, list] = {}
    for d in devices:
        by_room.setdefault(d.get("room") or "unknown", []).append(d)
    lines: list[str] = []
    for room in sorted(by_room.keys()):
        rhe = room_he(room) or room
        lines.append(f"[{room} / {rhe}]")
        for d in sorted(by_room[room], key=lambda x: x["name"]):
            tag = " [IR]" if d.get("ir") else ""
            lines.append(
                f"  {d['name']} | {d['domain']}{tag} | {'on' if d['on'] else 'off'} "
                f"| id={d['entity_id']}"
            )
    # Presence sensors summary
    pres = directory.get("presence") or []
    if pres:
        lines.append("[presence sensors]")
        for p in pres:
            lines.append(
                f"  room={p.get('room') or 'unknown'} | {'occupied' if p['on'] else 'clear'} "
                f"| id={p['entity_id']}"
            )
    return "\n".join(lines)


def get_device(directory: dict, entity_id: str) -> Optional[dict]:
    for d in directory.get("devices") or []:
        if d["entity_id"] == entity_id:
            return d
    return None


def room_occupancy(directory: dict, room_slug: str) -> dict:
    """Answer 'is anyone in <room>' from the room's presence sensors."""
    from services.room_alias_bank import resolve_room
    target = resolve_room((room_slug or "").lower().strip())
    sensors = [p for p in (directory.get("presence") or []) if (p.get("room") or "") == target]
    if not sensors:
        return {"room": target, "status": "unknown", "sensors": 0}
    occupied = any(p["on"] for p in sensors)
    return {"room": target, "status": "occupied" if occupied else "clear", "sensors": len(sensors)}
