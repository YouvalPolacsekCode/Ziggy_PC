"""
Intent dispatcher. Collects handler dicts from all domain modules and routes
each intent to the appropriate async function.

Adding a new intent: create a handler in core/handlers/<domain>_handler.py and
add the intent name → function mapping to its HANDLERS dict. No changes needed here.
"""
from __future__ import annotations

from core.intent_utils import err
from core.logger_module import log_info, log_error

from core.handlers import (
    light_handler,
    sensor_handler,
    climate_handler,
    tv_handler,
    ir_handler,
    task_handler,
    memory_handler,
    system_handler,
    file_handler,
    chat_handler,
    media_handler,
    web_handler,
    comm_handler,
    visual_handler,
    reference_handler,
    event_handler,
    pattern_handler,
    automation_handler,
    device_handler,
    anomaly_handler,
)

_ALL_HANDLERS: dict = {}
for _mod in [
    light_handler,
    sensor_handler,
    climate_handler,
    tv_handler,
    ir_handler,
    task_handler,
    memory_handler,
    system_handler,
    file_handler,
    chat_handler,
    media_handler,
    web_handler,
    comm_handler,
    visual_handler,
    reference_handler,
    event_handler,
    pattern_handler,
    automation_handler,
    device_handler,
    anomaly_handler,
]:
    _ALL_HANDLERS.update(_mod.HANDLERS)


async def handle_intent(intent_result: dict, **kwargs) -> dict:
    intent = intent_result.get("intent")
    source = intent_result.get("source") or kwargs.get("source", "unknown")

    # Multi-intent envelope — dispatch each sub-intent sequentially and combine
    if intent == "__multi__":
        sub_intents = intent_result.get("intents") or []
        results = []
        any_ok = False
        for sub in sub_intents:
            r = await handle_intent(sub, **kwargs)
            results.append(r)
            if r.get("ok"):
                any_ok = True
        messages = [r.get("message", "").rstrip(".") for r in results if r.get("message")]
        if not messages:
            return {"ok": any_ok, "message": "Done."}
        if len(messages) == 1:
            combined = messages[0] + "."
        elif len(messages) == 2:
            combined = f"{messages[0]} and {messages[1]}."
        else:
            combined = ", ".join(messages[:-1]) + f", and {messages[-1]}."
        return {"ok": any_ok, "message": combined}

    params = intent_result.get("params", {})
    log_info(f"[Intent Handler] intent={intent} source={source} params={params}")

    try:
        handler = _ALL_HANDLERS.get(intent)
        if handler:
            result = await handler(params, source=source)
            _log_event_safe(intent, params, result, source)
            return result
        log_info(f"[Intent Handler] Unrecognized intent: {intent}")
        return err("I'm not sure how to help with that yet.")
    except Exception as e:
        log_error(f"[Intent Handler] Exception handling '{intent}': {e}")
        return err("Something went wrong while handling your request.", details=str(e))


def _log_event_safe(intent: str, params: dict, result: dict, source: str) -> None:
    """Log the dispatched intent to the pattern event store. Never raises."""
    try:
        from services.pattern_logger import log_event
        log_event(intent, params, result, source)
    except Exception:
        pass
