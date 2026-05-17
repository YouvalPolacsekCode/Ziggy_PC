"""
Intent dispatcher. Collects handler dicts from all domain modules and routes
each intent to the appropriate async function.

Adding a new intent: create a handler in core/handlers/<domain>_handler.py and
add the intent name → function mapping to its HANDLERS dict. No changes needed here.
"""
from __future__ import annotations

import time

from core.intent_utils import err
from core.logger_module import log_info, log_error
from core.debug_bus import bus, BASIC, VERBOSE, TRACE

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
    request_id = intent_result.get("request_id") or kwargs.get("request_id")
    dry_run = intent_result.get("dry_run", False)

    # Multi-intent envelope — dispatch each sub-intent sequentially and combine
    if intent == "__multi__":
        sub_intents = intent_result.get("intents") or []
        bus.emit("intent", BASIC, "multi_intent_start",
                 request_id=request_id, count=len(sub_intents), source=source)
        results = []
        any_ok = False
        for sub in sub_intents:
            sub["request_id"] = request_id
            sub["dry_run"] = dry_run
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

    handler = _ALL_HANDLERS.get(intent)

    bus.emit("intent", BASIC, "intent_received",
             request_id=request_id,
             input=intent_result.get("_raw_input"),
             intent=intent,
             source=source,
             handler=handler.__module__ if handler else None,
             dry_run=dry_run)

    bus.emit("intent", VERBOSE, "intent_params",
             request_id=request_id,
             intent=intent,
             params=params)

    if dry_run:
        bus.emit("intent", BASIC, "dry_run_skipped",
                 request_id=request_id,
                 intent=intent,
                 params=params,
                 result="skipped",
                 message="Dry-run: intent parsed but not executed.")
        return {"ok": True, "dry_run": True, "intent": intent, "params": params,
                "message": f"[Dry-run] Would execute: {intent} with params {params}"}

    t0 = time.perf_counter()
    try:
        if handler:
            result = await handler(params, source=source)
            duration_ms = round((time.perf_counter() - t0) * 1000, 1)

            outcome = "ok" if result.get("ok") else "error"
            bus.emit("intent", BASIC, "intent_result",
                     request_id=request_id,
                     intent=intent,
                     result=outcome,
                     duration_ms=duration_ms,
                     message=result.get("message"),
                     ok=result.get("ok", False))

            bus.emit("intent", VERBOSE, "intent_result_detail",
                     request_id=request_id,
                     intent=intent,
                     result=outcome,
                     duration_ms=duration_ms,
                     response=result,
                     params=params)

            _log_event_safe(intent, params, result, source)
            return result

        log_info(f"[Intent Handler] Unrecognized intent: {intent}")
        bus.emit("intent", BASIC, "intent_unrecognized",
                 request_id=request_id,
                 intent=intent,
                 result="unrecognized",
                 message="No handler registered for this intent.",
                 suggestion="Check that the intent name matches a registered handler.")
        return err("I'm not sure how to help with that yet.")

    except Exception as e:
        duration_ms = round((time.perf_counter() - t0) * 1000, 1)
        log_error(f"[Intent Handler] Exception handling '{intent}': {e}")
        bus.emit("intent", BASIC, "intent_exception",
                 request_id=request_id,
                 intent=intent,
                 result="exception",
                 duration_ms=duration_ms,
                 error=str(e),
                 error_type=type(e).__name__)
        return err("Something went wrong while handling your request.", details=str(e))


def _log_event_safe(intent: str, params: dict, result: dict, source: str) -> None:
    """Log the dispatched intent to the pattern event store. Never raises."""
    try:
        from services.pattern_logger import log_event
        log_event(intent, params, result, source)
    except Exception:
        pass
