from __future__ import annotations
from core.intent_utils import ok, err
from core.logger_module import log_info
from services.home_automation import resolve_entity
from services.ha_automations import save_automation, list_automations, delete_automation, toggle_automation


def _resolve_action_entity(params: dict) -> tuple[str | None, str]:
    room = (params.get("action_room") or "").replace(" ", "_").lower()
    device_type = (params.get("action_device_type") or "light").lower()
    entity_id = params.get("action_entity_id") or resolve_entity(room, device_type)
    return entity_id, room


async def handle_create_automation(params: dict, *, source: str = "unknown") -> dict:
    entity_id, room = _resolve_action_entity(params)
    if not entity_id:
        device_type = params.get("action_device_type", "light")
        return err(f"No {device_type} configured for {room.replace('_', ' ')}.")

    trigger_type = params.get("trigger_type", "time")
    trigger: dict = {"type": trigger_type}
    if trigger_type == "time":
        trigger["time"] = params.get("trigger_time", "08:00")
    elif trigger_type == "state":
        trigger["entity_id"] = params.get("trigger_entity_id", entity_id)
        trigger["state"] = params.get("trigger_state", "on")
    elif trigger_type in ("sunrise", "sunset"):
        if params.get("trigger_offset"):
            trigger["offset"] = params["trigger_offset"]

    service_action = params.get("action_service", "turn_on")
    automation_data = {
        "name": params.get("name") or f"Ziggy: {service_action} {room.replace('_', ' ')}",
        "description": params.get("description", "Created by Ziggy voice command"),
        "trigger": trigger,
        "actions": [{"type": "call_service", "entity_id": entity_id,
                     "service": f"homeassistant.{service_action}"}],
    }

    result = save_automation(automation_data)
    if result.get("ok"):
        name = automation_data["name"]
        log_info(f"[Automation] Created '{name}' id={result.get('id')}")
        return ok(f"Done! Automation '{name}' has been created.")
    return err(f"Failed to create automation: {result.get('error', 'unknown error')}")


async def handle_list_automations(params: dict, *, source: str = "unknown") -> dict:
    autos = list_automations()
    if not autos:
        return ok("No automations found.")
    lines = [f"- {a['name']} ({'on' if a['enabled'] else 'off'})" for a in autos]
    word = "automation" if len(autos) == 1 else "automations"
    return ok(f"You have {len(autos)} {word}:\n" + "\n".join(lines), data={"automations": autos})


async def handle_delete_automation(params: dict, *, source: str = "unknown") -> dict:
    auto_id = params.get("automation_id") or params.get("id", "")
    if not auto_id:
        return err("Please specify the automation ID to delete.")
    ok_ = delete_automation(auto_id)
    return ok(f"Automation '{auto_id}' deleted.") if ok_ else err(f"Could not delete automation '{auto_id}'.")


async def handle_toggle_automation(params: dict, *, source: str = "unknown") -> dict:
    auto_id = params.get("automation_id") or params.get("id", "")
    enable = params.get("enable", True)
    if not auto_id:
        return err("Please specify the automation ID.")
    ok_ = toggle_automation(auto_id, enable)
    state = "enabled" if enable else "disabled"
    return ok(f"Automation '{auto_id}' {state}.") if ok_ else err(f"Could not toggle automation '{auto_id}'.")


HANDLERS = {
    "create_automation": handle_create_automation,
    "list_automations": handle_list_automations,
    "delete_automation": handle_delete_automation,
    "toggle_automation": handle_toggle_automation,
}
