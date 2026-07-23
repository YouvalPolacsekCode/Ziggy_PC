"""Smart Room recipe — deterministic composition of the "sleeping-wife" orchestra.

Replaces the LLM designer's naive single-motion_light output (for the Smart Room
surfaces) with a reliable, testable recipe keyed off the room's FUSED occupancy
sensor. See docs/superpowers/specs/2026-07-18-smart-room-recipe-design.md.

Behavior (mapped onto the room's real lights + a concrete occupancy entity):
  - Room becomes occupied (occupancy off→on EDGE) in the DAYTIME  → lights on, bright.
  - Room becomes occupied at NIGHT                                → lights on, warm & dim.
  - Someone already present (occupancy already on), partner enters → no edge fires → stays dark
    (this is the sleeping-wife guard; night auto-on is warm/dim, softening the residual case
     where the sensor briefly drops).
  - Room empty for N minutes (occupancy on→off for N)             → lights off.
  - Voice "good night" → lights off; "good morning" → lights on (records a room sleep KV mode too).

Why the occupancy EDGE (not a sleep-mode HA condition): the sleep KV flag is a
Ziggy-internal store HA can't gate on, and HA doesn't allow creating an
input_boolean helper via the config-entries flow. The off→on edge is a better
guard anyway — automatic, no manual toggle needed.

Returns the same bundle shape services.bundle_executor + BundlePreviewCard
consume. The recipe does NOT create the occupancy sensor — the caller ensures a
concrete `occupancy_entity` exists first (existing or freshly created via
OccupancySensorForm) so automations reference a real entity_id, never a
predicted one.
"""
from __future__ import annotations

import uuid
from typing import Any, Optional

from core.logger_module import log_error


DEFAULTS = {
    "off_delay_minutes": 5,
    "night_start":       "19:00",   # night window start (HH:MM)
    "night_end":         "06:30",   # night window end   (HH:MM)
    "day_brightness":    100,
    "night_brightness":  30,
    "night_kelvin":      2700,      # warm
}


def _room_label(room_slug: str, lang: str) -> str:
    if lang == "he":
        from core.agent.directory import room_he
        return room_he(room_slug) or room_slug.replace("_", " ")
    return (room_slug or "").replace("_", " ").title()


def _find_room(home: dict, room_slug: str) -> Optional[dict]:
    target = (room_slug or "").lower()
    for r in home.get("rooms") or []:
        if str(r.get("id", "")).lower() == target:
            return r
    return None


def _light_supports_color_temp(entity_id: str, caps: dict) -> bool:
    modes = caps.get(entity_id) or []
    return "color_temp" in modes


def _turn_on_actions(lights: list[str], brightness: int, kelvin: Optional[int], caps: dict,
                     schedule_owned: Optional[set] = None) -> list[dict]:
    """One call_service action per light. brightness_pct always (Zigbee lights
    dim); color_temp_kelvin only for lights that advertise color_temp support.

    Lights in `schedule_owned` are on the Smart Light Schedule — Smart Room only
    switches them ON and lets the schedule own brightness/colour (the engine
    snaps them to the current ramp on turn-on). Forcing a fixed brightness here
    would fight the schedule (light jumps to 100%/30% then the schedule drags it
    back). So for those we emit a plain turn_on with no brightness/colour data.
    """
    owned = schedule_owned or set()
    actions: list[dict] = []
    for eid in lights:
        if eid in owned:
            data: dict[str, Any] = {}          # schedule owns brightness + colour
        else:
            data = {"brightness_pct": int(brightness)}
            if kelvin is not None and _light_supports_color_temp(eid, caps):
                data["color_temp_kelvin"] = int(kelvin)
        actions.append({
            "type": "call_service", "entity_id": eid,
            "service": "light.turn_on", "service_data": data,
        })
    return actions


def _scheduled_lights_set() -> set:
    """Lights currently enrolled in the Smart Light Schedule (only when it's
    enabled). Best-effort — never let a schedule read break bundle building."""
    try:
        from services.circadian_engine import load_config
        cfg = load_config()
        if cfg.get("enabled"):
            return set(cfg.get("lights") or [])
    except Exception:
        pass
    return set()


def _turn_off_actions(lights: list[str]) -> list[dict]:
    return [{"type": "call_service", "entity_id": eid, "service": "light.turn_off"}
            for eid in lights]


def _light_color_caps() -> dict:
    """entity_id → supported_color_modes, from live HA state. Empty on error."""
    try:
        from services.home_automation import get_all_states
        out: dict = {}
        for s in get_all_states() or []:
            eid = s.get("entity_id", "")
            if eid.startswith("light."):
                out[eid] = (s.get("attributes") or {}).get("supported_color_modes") or []
        return out
    except Exception as e:
        log_error(f"[smart_room_recipe] color caps fetch failed: {e}")
        return {}


def resolve_occupancy_entity(home: dict, room_slug: str) -> Optional[str]:
    """Real fused-occupancy-sensor entity_id for the room, or None.

    IMPORTANT: use list_occupancy_sensors(), which stores the ACTUAL
    HA-assigned entity_id (looked up from the entity registry at creation) —
    NOT home_context.occupancy_sensor, whose entity_id is a naive slug
    PREDICTION (e.g. Hebrew names slugify to 'binary_sensor.נוכחות_...' which
    doesn't match HA's transliterated 'binary_sensor.nvkkhvt_...').
    """
    from services.room_alias_bank import resolve_room
    target = resolve_room((room_slug or "").lower().strip())
    try:
        from services.template_sensors import list_occupancy_sensors
        for rec in list_occupancy_sensors():
            rec_room = resolve_room(str(rec.get("room", "")).lower().strip())
            if rec_room == target and rec.get("entity_id"):
                return rec["entity_id"]
    except Exception as e:
        log_error(f"[smart_room_recipe] occupancy lookup failed: {e}")
    return None


def build_smart_room_bundle(
    room_slug: str,
    *,
    occupancy_entity: Optional[str] = None,
    home: Optional[dict] = None,
    language: str = "en",
    options: Optional[dict] = None,
) -> dict:
    """Compose the Smart Room bundle.

    Returns:
      {"ok": True, "bundle": {...}}                              — ready to preview/apply
      {"ok": False, "needs_occupancy": True, "room": slug}       — no occupancy sensor; caller must create one
      {"ok": False, "error": "...", "bundle"?: {decline}}        — can't build (no lights, etc.)
    """
    opt = {**DEFAULTS, **(options or {})}
    lang = "he" if language == "he" else "en"

    if home is None:
        from services.home_context import load_home_context
        home = load_home_context(lang)

    room = _find_room(home, room_slug)
    if not room:
        return {"ok": False, "error": f"unknown room {room_slug}"}

    label = _room_label(room_slug, lang)
    ents = room.get("entities") or {}
    lights = [e["entity_id"] for e in (ents.get("light") or []) if e.get("entity_id")]
    motion = [e["entity_id"] for e in (ents.get("motion") or []) if e.get("entity_id")]
    presence = [e["entity_id"] for e in (ents.get("presence") or []) + (ents.get("occupancy") or [])
                if e.get("entity_id")]

    # No light → nothing to control. Honest decline.
    if not lights:
        decline = (f"אין תאורה חכמה ב{label} שאפשר לשלוט בה, אז אין ממה להרכיב חדר חכם."
                   if lang == "he" else
                   f"There are no smart lights in the {label} to control, so there's nothing to build.")
        return {"ok": False, "error": "no_lights",
                "bundle": {"name": label, "language": lang, "decline": decline, "artifacts": {}}}

    # Occupancy source, in precedence order:
    #   explicit arg  >  an existing Ziggy merged sensor  >  ANY raw room
    #   presence/occupancy sensor  >  a raw motion sensor.
    # No fused sensor is required — a single raw sensor is a perfectly valid
    # trigger. We only ask the user to create/merge one when the room has NO
    # presence signal at all (then the wizard offers choose-or-create).
    # Prefer presence/occupancy (holds steady while still) over motion (flaps),
    # so the "off when empty" rule doesn't misfire on a bare PIR.
    occ = (occupancy_entity
           or resolve_occupancy_entity(home, room_slug)
           or (presence[0] if presence else None)
           or (motion[0] if motion else None))
    if not occ:
        # Nothing to trigger on — the wizard offers choose-an-existing / create-merged.
        return {"ok": False, "needs_occupancy": True, "room": room_slug,
                "sensors": {"motion": motion, "presence": presence},
                "has_presence": bool(presence)}

    caps = _light_color_caps()
    has_presence = bool(presence)
    # Lights on the Smart Light Schedule: Smart Room switches them on, the
    # schedule owns their brightness/colour (no fixed brightness forced here).
    sched_owned = _scheduled_lights_set()

    # English room title for the HA alias — see _alias() below.
    en_label = _room_label(room_slug, "en")

    def _alias(part: str) -> str:
        # STABLE ENGLISH alias so HA derives a predictable entity object-id
        # (ziggy_smart_room_<room>_<part>) that MATCHES the config-id _slug()
        # produces. Hebrew names slug to a uuid → id mismatch → empty view/edit
        # + duplicate-on-re-apply. Mirrors the Circadian bundle's approach.
        # The user never sees this alias: members are hidden behind the group
        # card and the preview shows the Hebrew `name` instead.
        return f"Ziggy Smart Room {en_label} {part}"

    # ── Automations ─────────────────────────────────────────────────────────
    autos: list[dict] = [
        {
            "name": (f"אור נדלק ב{label} ביום" if lang == "he" else f"{label} lights on — daytime"),
            "alias": _alias("Day"),
            "source": "custom",
            "trigger": {"type": "state", "entity_id": occ, "state": "on"},
            # Daytime window = after night_end (06:30) and before night_start (19:00).
            "conditions": [{"type": "time", "after": opt["night_end"], "before": opt["night_start"]}],
            "actions": _turn_on_actions(lights, opt["day_brightness"], None, caps, sched_owned),
            "mode": "single",
        },
        {
            "name": (f"אור נדלק ב{label} בלילה" if lang == "he" else f"{label} lights on — night (warm/dim)"),
            "alias": _alias("Night"),
            "source": "custom",
            "trigger": {"type": "state", "entity_id": occ, "state": "on"},
            "conditions": [{"type": "time", "after": opt["night_start"], "before": opt["night_end"]}],
            "actions": _turn_on_actions(lights, opt["night_brightness"], opt["night_kelvin"], caps, sched_owned),
            "mode": "single",
        },
        {
            "name": (f"אור נכבה ב{label} כשאין אף אחד" if lang == "he" else f"{label} lights off — empty"),
            "alias": _alias("Off"),
            "source": "custom",
            "trigger": {"type": "state", "entity_id": occ, "state": "off",
                        "for_minutes": int(opt["off_delay_minutes"])},
            "actions": _turn_off_actions(lights),
            "mode": "single",
        },
    ]

    # ── Sleep KV + voice ("good night"/"good morning") ─────────────────────────
    # The KV mode records intent; suppression itself is handled by the occupancy
    # edge (no manual toggle needed). Voice turns the lights off/on directly.
    kv = [{"namespace": "modes", "key": f"{room_slug}_sleep", "default": False}]
    gn = "לילה טוב" if lang == "he" else "good night"
    gm = "בוקר טוב" if lang == "he" else "good morning"
    voice = [
        {"phrase": gn, "action_description": (f"turn off the {label} lights and set {room_slug} sleep on")},
        {"phrase": gm, "action_description": (f"turn on the {label} lights and set {room_slug} sleep off")},
    ]

    guard_note = ("" if has_presence else
                  (" (בלי חיישן נוכחות ייעודי — ההגנה מסתמכת על חיישן התפוסה בלבד)"
                   if lang == "he" else
                   " (no dedicated presence sensor — the guard relies on the occupancy sensor alone)"))
    rationale = (
        (f"האור נדלק כשנכנסים ל{label} ריק — בהיר ביום, חמים ועמום בלילה — וכבה כשאין אף אחד. "
         f"מי שכבר בחדר (ישן) לא מדליק אור כי אין מעבר מ'ריק' ל'תפוס'.{guard_note}")
        if lang == "he" else
        (f"Lights come on when you enter an empty {label} — bright by day, warm & dim at night — and off "
         f"when it's empty. Someone already in the room (sleeping) won't trigger the lights, because there's "
         f"no empty→occupied change.{guard_note}")
    )

    bundle = {
        "bundle_id": f"bundle_{uuid.uuid4().hex[:12]}",
        "name": (f"{label} חכם" if lang == "he" else f"Smart {label}"),
        "language": lang,
        "rationale": rationale,
        "decline": None,
        "recipe": "smart_room",
        "occupancy_entity": occ,      # the fused presence sensor all rules trigger on
        "has_presence": has_presence,
        "artifacts": {
            "occupancy_sensors": [],       # caller already ensured OCC exists
            "kv_state": kv,
            "automations": autos,
            "voice_intents": voice,
        },
    }
    return {"ok": True, "bundle": bundle}
