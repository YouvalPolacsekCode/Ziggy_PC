from __future__ import annotations
from core.intent_utils import ok, err, normalize_tv_source
from services.media_manager import set_tv_power, set_tv_source


async def handle_control_tv(params: dict, *, source: str = "unknown") -> dict:
    alias = params.get("device")
    action = params.get("turn_on")
    if action is None:
        action_text = (params.get("action") or "").lower()
        if "off" in action_text:
            action = False
        elif "on" in action_text:
            action = True
        else:
            return err("Please specify whether to turn the TV on or off.")
    status_code, text = set_tv_power(turn_on=action, alias=alias)
    if status_code == 200:
        return ok(f"{'Turning on' if action else 'Turning off'} the TV.")
    return err("Couldn't control the TV.", details=text)


async def handle_set_tv_source(params: dict, *, source: str = "unknown") -> dict:
    raw = params.get("source") or ""
    if not raw.strip():
        return err("Please specify a TV source (e.g., HDMI 2 or Netflix).")
    normalized = normalize_tv_source(raw)
    alias = params.get("device")
    status_code, text = set_tv_source(source=normalized, alias=alias)
    if status_code == 200:
        return ok(f"Switching TV to {normalized}.")
    return err(f"Couldn't switch TV to {normalized}.", details=text)


HANDLERS = {
    "control_tv": handle_control_tv,
    "set_tv_source": handle_set_tv_source,
}
