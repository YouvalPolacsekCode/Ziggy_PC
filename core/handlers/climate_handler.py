from __future__ import annotations
from core.intent_utils import ok, err, wrap, normalize_room
from core.conversation_context import set_context
from services.home_automation import get_sensor_state, set_ac_temperature, resolve_entity, call_service


async def handle_control_ac(params: dict, *, source: str = "unknown") -> dict:
    room = normalize_room(params)
    action_text = (params.get("action") or "").lower()
    if any(k in action_text for k in ("get", "status", "query", "temperature")):
        return wrap(get_sensor_state(room, "temperature"))
    entity_id = resolve_entity(room, "ac") if room != "unknown" else None
    if not entity_id:
        return err(
            f"No AC configured for {room.replace('_', ' ')}. "
            "Add an 'ac' entity under device_map in settings.yaml."
        )
    turn_on = params.get("turn_on")
    if turn_on is None:
        if "off" in action_text:
            turn_on = False
        elif "on" in action_text:
            turn_on = True
        else:
            return err("Say 'turn on' or 'turn off' the AC, or 'set AC to 24 degrees'.")
    service = "turn_on" if turn_on else "turn_off"
    result = call_service("climate", service, {"entity_id": entity_id})
    if result.get("ok"):
        set_context(room=room, device_type="ac", entity_id=entity_id,
                    action="on" if turn_on else "off", intent="control_ac")
        return ok(f"{'Turning on' if turn_on else 'Turning off'} {room.replace('_', ' ')} AC.")
    return err("Couldn't control the AC.", details=result.get("message"))


async def handle_set_ac_temperature(params: dict, *, source: str = "unknown") -> dict:
    room = normalize_room(params)
    entity_id = resolve_entity(room, "ac") if room != "unknown" else None
    if not entity_id:
        return err(f"No AC configured for {room.replace('_', ' ')}.")
    try:
        temp = int(params.get("temperature", 24))
    except Exception:
        return err("Please provide a valid temperature number.")
    try:
        set_ac_temperature(entity_id, temp)
        set_context(room=room, device_type="ac", entity_id=entity_id, action="temperature", intent="set_ac_temperature")
        return ok(f"Setting {room.replace('_', ' ')} AC to {temp}°C.")
    except Exception as e:
        return err("Couldn't set the AC right now.", details=str(e))


HANDLERS = {
    "control_ac": handle_control_ac,
    "set_ac_temperature": handle_set_ac_temperature,
}
