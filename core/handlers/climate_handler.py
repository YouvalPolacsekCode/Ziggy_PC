from __future__ import annotations
from core.intent_utils import ok, err, wrap, normalize_room
from core.result_utils import L
from core.conversation_context import set_context
from services.home_automation import get_sensor_state, set_ac_temperature, resolve_entity, call_service

# Israel-first default: an AC turned on without an explicit mode should cool.
# Most of the year in Israel "turn on the AC" means "cool the room"; defaulting
# to cool avoids the unit coming up in whatever mode it was last left in (often
# heat after winter). Overridden when the utterance names a mode.
_DEFAULT_AC_MODE = "cool"
_MODE_WORDS = {
    "cool": "cool", "cooling": "cool", "ac": "cool", "air con": "cool",
    "heat": "heat", "heating": "heat", "warm": "heat",
    "dry": "dry", "fan": "fan_only", "fan only": "fan_only",
    "auto": "auto", "מיזוג": "cool", "קירור": "cool", "חימום": "heat",
}


def _requested_mode(action_text: str) -> str | None:
    for word, mode in _MODE_WORDS.items():
        if word in action_text and mode != "cool":
            # Only treat non-cool words as an explicit override; a bare
            # "turn on the AC" keeps the cool-first default below.
            return mode
    return None


async def handle_control_ac(params: dict, *, source: str = "unknown") -> dict:
    room = normalize_room(params)
    action_text = (params.get("action") or "").lower()
    if any(k in action_text for k in ("get", "status", "query", "temperature")):
        return wrap(get_sensor_state(room, "temperature"))
    entity_id = resolve_entity(room, "ac") if room != "unknown" else None
    room_label = room.replace('_', ' ')
    if not entity_id:
        return err(
            L(
                f"No AC configured for {room_label}. "
                "Add an 'ac' entity under device_map in settings.yaml.",
                f"אין מזגן מוגדר ב{room_label}. "
                "יש להוסיף ישות 'ac' תחת device_map בהגדרות.",
            )
        )
    turn_on = params.get("turn_on")
    if turn_on is None:
        if "off" in action_text:
            turn_on = False
        elif "on" in action_text:
            turn_on = True
        else:
            return err(L(
                "Say 'turn on' or 'turn off' the AC, or 'set AC to 24 degrees'.",
                "אמרו 'הדלק' או 'כבה' את המזגן, או 'כוון את המזגן ל-24 מעלות'.",
            ))
    service = "turn_on" if turn_on else "turn_off"
    result = call_service("climate", service, {"entity_id": entity_id})
    if result.get("ok"):
        # Cool-first (Israel-first): on a bare turn-on, nudge the unit into the
        # default mode so it doesn't wake up in last winter's heat setting. An
        # explicit mode word in the utterance overrides. Best-effort — a failure
        # here must not turn a successful power-on into an error reply.
        if turn_on:
            mode = _requested_mode(action_text) or _DEFAULT_AC_MODE
            try:
                call_service("climate", "set_hvac_mode",
                             {"entity_id": entity_id, "hvac_mode": mode})
            except Exception:
                pass
        set_context(room=room, device_type="ac", entity_id=entity_id,
                    action="on" if turn_on else "off", intent="control_ac")
        return ok(L(
            f"{'Turning on' if turn_on else 'Turning off'} {room_label} AC.",
            f"{'מדליק' if turn_on else 'מכבה'} את המזגן ב{room_label}.",
        ))
    return err(L("Couldn't control the AC.", "לא הצלחתי לשלוט במזגן."),
               details=result.get("message"))


async def handle_set_ac_temperature(params: dict, *, source: str = "unknown") -> dict:
    room = normalize_room(params)
    entity_id = resolve_entity(room, "ac") if room != "unknown" else None
    room_label = room.replace('_', ' ')
    if not entity_id:
        return err(L(f"No AC configured for {room_label}.",
                     f"אין מזגן מוגדר ב{room_label}."))
    try:
        # 24°C is the Israeli AC default (comfortable + efficient) — used when
        # the utterance names no temperature.
        temp = int(params.get("temperature", 24))
    except Exception:
        return err(L("Please provide a valid temperature number.",
                     "אנא ציינו מספר תקין של מעלות."))
    try:
        set_ac_temperature(entity_id, temp)
        set_context(room=room, device_type="ac", entity_id=entity_id, action="temperature", intent="set_ac_temperature")
        return ok(L(f"Setting {room_label} AC to {temp}°C.",
                    f"מכוון את המזגן ב{room_label} ל-{temp}°C."))
    except Exception as e:
        return err(L("Couldn't set the AC right now.", "לא הצלחתי לכוון את המזגן כרגע."),
                   details=str(e))


HANDLERS = {
    "control_ac": handle_control_ac,
    "set_ac_temperature": handle_set_ac_temperature,
}
