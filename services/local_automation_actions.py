"""
Stores ziggy_intent action steps for automations/routines locally.
HA handles triggers and HA service calls; this module executes the Ziggy-side steps.
"""
from __future__ import annotations

import json
import os
from typing import Any

STORE_FILE = "user_files/local_automation_actions.json"
META_FILE = "user_files/automation_meta.json"


def _load() -> dict:
    if not os.path.exists(STORE_FILE):
        return {}
    with open(STORE_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def _save(data: dict) -> None:
    os.makedirs(os.path.dirname(STORE_FILE), exist_ok=True)
    with open(STORE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _load_meta() -> dict:
    if not os.path.exists(META_FILE):
        return {}
    with open(META_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_meta(data: dict) -> None:
    os.makedirs(os.path.dirname(META_FILE), exist_ok=True)
    with open(META_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def save_automation_meta(automation_id: str, meta: dict) -> None:
    """Persist trigger + name for fast list display without an HA config round-trip."""
    store = _load_meta()
    store[automation_id] = meta
    _save_meta(store)


def get_automation_meta(automation_id: str) -> dict:
    return _load_meta().get(automation_id, {})


def delete_automation_meta(automation_id: str) -> None:
    store = _load_meta()
    store.pop(automation_id, None)
    _save_meta(store)


# All step types that Ziggy's own executor can run.
# call_service, delay, notify, send_intent are now handled natively so that
# time-triggered automations stored in automations.json don't need HA.
_LOCAL_TYPES = {"ziggy_intent", "ir_command", "call_service", "delay", "notify", "send_intent", "message"}


def save_ziggy_actions(automation_id: str, actions: list[dict]) -> None:
    """
    Persist the FULL action list locally so the UI can reconstruct it faithfully.
    HA only stores service-call placeholders for local types; we store the real data here.
    """
    store = _load()
    if actions:
        store[automation_id] = actions
    else:
        store.pop(automation_id, None)
    _save(store)


def get_ziggy_actions(automation_id: str) -> list[dict]:
    """Return only local-type steps (for execution)."""
    return [a for a in _load().get(automation_id, []) if a.get("type") in _LOCAL_TYPES]


def get_all_saved_actions(automation_id: str) -> list[dict]:
    """Return the full stored action list (for UI reconstruction)."""
    return _load().get(automation_id, [])


def delete_ziggy_actions(automation_id: str) -> None:
    store = _load()
    store.pop(automation_id, None)
    _save(store)


# Guards against re-entrant / duplicate triggering of the same automation.
# If the user taps "Run" multiple times before the first execution completes,
# subsequent requests are dropped rather than queued up and run back-to-back.
_running_automations: set[str] = set()


async def execute_ziggy_actions(automation_id: str, label: str = "") -> list[dict]:
    """Run all stored steps for an automation/routine in sequence.

    Called as a FastAPI BackgroundTask after the HTTP response is sent so that:
    - Delay steps don't block the HTTP connection
    - Client disconnection / proxy timeouts can't cancel the sequence
    - The full IR/delay/capability chain executes reliably to completion

    label — human-readable name shown in the result toast; falls back to meta
             store, then automation_id if neither is available.
    """
    import asyncio
    from core.logger_module import log_info, log_error
    from core.action_parser import handle_intent

    if automation_id in _running_automations:
        log_info(f"[Executor] {automation_id} already running — duplicate trigger ignored")
        return []

    _running_automations.add(automation_id)
    steps = get_ziggy_actions(automation_id)
    results: list[dict] = []
    prev_kind: str | None = None

    try:
        # ── Evaluate conditions before running any steps ──────────────────────
        conditions = get_automation_meta(automation_id).get("conditions") or []
        if conditions:
            from services.home_automation import get_state as _get_state
            for cond in conditions:
                entity_id = cond.get("entity_id", "")
                if not entity_id:
                    continue
                operator = cond.get("operator", "is")
                expected = str(cond.get("value", "on"))
                state_res = _get_state(entity_id)
                if not state_res.get("ok"):
                    log_info(
                        f"[Executor] {automation_id} condition check: "
                        f"{entity_id} unreachable — skipping automation"
                    )
                    return []
                actual = state_res.get("data", {}).get("state", "")
                if operator == "is":
                    passed = actual == expected
                elif operator == "is_not":
                    passed = actual != expected
                elif operator in ("above", "below"):
                    try:
                        passed = float(actual) > float(expected) if operator == "above" else float(actual) < float(expected)
                    except (ValueError, TypeError):
                        passed = False
                else:
                    passed = True
                if not passed:
                    log_info(
                        f"[Executor] {automation_id} condition not met: "
                        f"{entity_id} = '{actual}' (need {operator} '{expected}') — skipped"
                    )
                    return []
            log_info(f"[Executor] {automation_id} all {len(conditions)} condition(s) passed")

        for i, step in enumerate(steps):
            kind = step.get("type", "")
            try:
                log_info(f"[Executor] {automation_id} step {i+1}/{len(steps)}: {kind}")

                # ── HA service call executed directly by Ziggy ───────────────────
                if kind == "call_service":
                    from services.home_automation import call_service as ha_call, get_state
                    entity_id = step.get("entity_id", "")
                    svc_key = step.get("ha_service") or step.get("service_value") or ""
                    if not svc_key:
                        svc_key = step.get("service", "homeassistant.turn_on").split(".")[-1]
                    domain = entity_id.split(".")[0] if "." in entity_id else "homeassistant"
                    payload: dict = {"entity_id": entity_id}
                    payload.update(step.get("service_data") or {})

                    # Block immediately if HA reports the entity as clearly unreachable.
                    # "off" is intentionally excluded: HA state can be stale (TV shown as
                    # "on" while physically off, or vice versa), so we try anyway and retry.
                    if entity_id and svc_key not in ("turn_on", "turn_off"):
                        state_res = get_state(entity_id)
                        entity_state = state_res.get("data", {}).get("state", "unknown")
                        if entity_state in ("unavailable", "unknown"):
                            log_error(
                                f"[Executor] {entity_id} is '{entity_state}' — "
                                f"skipping {domain}.{svc_key}"
                            )
                            result = {
                                "ok": False,
                                "message": f"{entity_id} is '{entity_state}' — {domain}.{svc_key} skipped.",
                            }
                            results.append(result)
                            prev_kind = kind
                            continue

                    # Retry up to 3 times with a 5-second gap. Handles devices that are
                    # still booting after an IR power command, and stale HA state readings.
                    log_info(f"[Executor] Calling {domain}.{svc_key} on {entity_id} | data={payload}")
                    result = {"ok": False, "message": "not attempted"}
                    for attempt in range(3):
                        result = ha_call(domain, svc_key, payload)
                        if result.get("ok"):
                            break
                        if attempt < 2:
                            log_info(
                                f"[Executor] {domain}.{svc_key} failed "
                                f"(attempt {attempt + 1}/3) — retrying in 5s…"
                            )
                            await asyncio.sleep(5)

                # ── Timed pause ──────────────────────────────────────────────────
                elif kind == "delay":
                    secs = max(0, int(step.get("seconds", step.get("delay_seconds", 0))))
                    log_info(f"[Executor] Waiting {secs}s…")
                    await asyncio.sleep(secs)
                    result = {"ok": True, "message": f"Waited {secs}s"}

                # ── Notification ─────────────────────────────────────────────────
                elif kind == "notify":
                    msg = step.get("message", "")
                    try:
                        from interfaces.telegram_interface import send_message as tg_send
                        await tg_send(msg)
                        result = {"ok": True, "message": "Notification sent"}
                    except Exception as e:
                        result = {"ok": False, "message": f"Notify failed: {e}"}

                # ── Natural-language command through Ziggy's intent pipeline ─────
                elif kind in ("send_intent", "message"):
                    text = step.get("text", "")
                    if text:
                        result = await handle_intent(
                            {"intent": "chat", "params": {"text": text}, "source": "automation"}
                        )
                    else:
                        result = {"ok": False, "message": "send_intent step has no text"}

                # ── IR blaster command ───────────────────────────────────────────
                elif kind == "ir_command":
                    from services.ir_manager import send_ir_command, send_ac_temperature, send_sequence
                    device_id = step.get("ir_device_id", "")
                    command   = step.get("ir_command", "")
                    sequence  = step.get("ir_sequence") or ""

                    # When two IR commands are consecutive (no explicit delay step between
                    # them), give the Broadlink blaster a short breathing gap so it doesn't
                    # drop the second command due to rate-limiting.
                    if prev_kind == "ir_command":
                        await asyncio.sleep(0.6)

                    if not device_id:
                        result = {"ok": False, "message": "IR command step has no device_id."}
                    elif sequence:
                        result = await send_sequence(device_id, sequence)
                    elif step.get("ir_temperature") is not None:
                        result = await send_ac_temperature(
                            device_id, int(step["ir_temperature"]), mode=step.get("ir_mode")
                        )
                    elif command:
                        result = send_ir_command(device_id, command)
                    else:
                        result = {"ok": False, "message": "IR command step has no command or sequence selected."}

                # ── Ziggy virtual device capability ──────────────────────────────
                elif kind == "ziggy_intent":
                    vd_id = step.get("virtual_device_id")
                    if vd_id:
                        from services.virtual_devices import trigger_virtual_device
                        result = await trigger_virtual_device(vd_id, runtime_params=step.get("runtime_params"))
                    else:
                        result = await handle_intent({
                            "intent": step.get("capability", ""),
                            "params": step.get("params", {}),
                            "source": "automation",
                        })

                else:
                    result = {"ok": False, "message": f"Unknown step type: {kind}"}

            except asyncio.CancelledError:
                log_error(f"[Executor] {automation_id} step {i+1} cancelled (server shutdown?)")
                raise
            except Exception as exc:
                log_error(f"[Executor] {automation_id} step {i+1} ({kind}) error: {exc}")
                result = {"ok": False, "message": str(exc)}

            results.append(result)
            prev_kind = kind

        log_info(f"[Executor] {automation_id} complete — {len(results)} steps")

        # Push result to all connected frontend clients so the UI can show a toast.
        try:
            from backend.ws_manager import manager
            if not label:
                meta = _load_meta().get(automation_id, {})
                label = meta.get("name") or automation_id
            failed = [r for r in results if not r.get("ok")]
            await manager.broadcast({
                "type": "execution_result",
                "label": label,
                "ok": len(failed) == 0,
                "steps_total": len(results),
                "steps_failed": len(failed),
                "errors": [r.get("message", "") for r in failed][:3],
            })
        except Exception as _ws_err:
            log_error(f"[Executor] WS broadcast failed: {_ws_err}")

        return results

    finally:
        _running_automations.discard(automation_id)
