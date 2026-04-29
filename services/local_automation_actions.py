"""
Stores ziggy_intent action steps for automations/routines locally.
HA handles triggers and HA service calls; this module executes the Ziggy-side steps.
"""
from __future__ import annotations

import json
import os
from typing import Any

STORE_FILE = "user_files/local_automation_actions.json"


def _load() -> dict:
    if not os.path.exists(STORE_FILE):
        return {}
    with open(STORE_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def _save(data: dict) -> None:
    os.makedirs(os.path.dirname(STORE_FILE), exist_ok=True)
    with open(STORE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


_LOCAL_TYPES = {"ziggy_intent", "ir_command"}


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


async def execute_ziggy_actions(automation_id: str) -> list[dict]:
    """Run all local (ziggy_intent / ir_command) steps stored for an automation. Returns list of results."""
    from core.action_parser import handle_intent
    steps = get_ziggy_actions(automation_id)
    results = []
    for step in steps:
        kind = step.get("type")

        if kind == "ir_command":
            from services.ir_manager import send_ir_command, send_ac_temperature, send_sequence
            device_id = step.get("ir_device_id", "")
            command = step.get("ir_command", "")
            sequence = step.get("ir_sequence") or ""
            if not device_id:
                result = {"ok": False, "message": "IR command step has no device_id."}
            elif sequence:
                result = await send_sequence(device_id, sequence)
            elif step.get("ir_temperature") is not None:
                result = await send_ac_temperature(device_id, int(step["ir_temperature"]), mode=step.get("ir_mode"))
            elif command:
                result = send_ir_command(device_id, command)
            else:
                result = {"ok": False, "message": "IR command step has no command or sequence selected."}

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
            result = {"ok": False, "message": f"Unknown local step type: {kind}"}

        results.append(result)
    return results
