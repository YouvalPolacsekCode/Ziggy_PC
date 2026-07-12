from __future__ import annotations
from core.intent_utils import ok, err, normalize_tv_source
from core.result_utils import L
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
            return err(L("Please specify whether to turn the TV on or off.",
                         "אנא ציינו אם להדליק או לכבות את הטלוויזיה."))
    status_code, text = set_tv_power(turn_on=action, alias=alias)
    if status_code == 200:
        return ok(L(f"{'Turning on' if action else 'Turning off'} the TV.",
                    f"{'מדליק' if action else 'מכבה'} את הטלוויזיה."))
    return err(L("Couldn't control the TV.", "לא הצלחתי לשלוט בטלוויזיה."), details=text)


async def handle_set_tv_source(params: dict, *, source: str = "unknown") -> dict:
    raw = params.get("source") or ""
    if not raw.strip():
        return err(L("Please specify a TV source (e.g., HDMI 2 or Netflix).",
                     "אנא ציינו מקור לטלוויזיה (למשל HDMI 2 או נטפליקס)."))
    normalized = normalize_tv_source(raw)
    alias = params.get("device")
    status_code, text = set_tv_source(source=normalized, alias=alias)
    if status_code == 200:
        return ok(L(f"Switching TV to {normalized}.",
                    f"מעביר את הטלוויזיה ל{normalized}."))
    return err(L(f"Couldn't switch TV to {normalized}.",
                 f"לא הצלחתי להעביר את הטלוויזיה ל{normalized}."), details=text)


HANDLERS = {
    "control_tv": handle_control_tv,
    "set_tv_source": handle_set_tv_source,
}
