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
# - `device` is the routine-wizard variant of call_service (different field names).
# - `automation` runs another automation's action list inline.
# - `scene` is intentionally absent; scenes are no longer a Ziggy concept.
_LOCAL_TYPES = {
    "ziggy_intent", "ir_command", "call_service", "device",
    "delay", "notify", "send_intent", "message", "automation",
    # New step types (added):
    "wait_for_state",     # block until an entity reaches a target state (with timeout)
    "speak",              # TTS via configured media_players
    "notify_actionable",  # push notification with action buttons
    # Dynamic device command — surfaces the full HA service catalog through
    # the automation/routine builder. Carries {entity_id, command_id, params,
    # prefer_source?}; routed through services/command_router on hybrid
    # devices so the Wi-Fi/IR source decision matches the device-detail tile.
    "device_command",
}


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


def _eval_single_condition(cond: dict) -> tuple[bool, str]:
    """Evaluate one condition. Returns (passed, human_reason).

    Supported types:
      - time   : {"after": "HH:MM", "before": "HH:MM"} (overnight ok)
      - entity : {"entity_id": "...", "operator": "is"|"is_not"|"above"|"below", "value": ...,
                  "for_minutes": <optional stable-for window>}
      - and    : {"conditions": [...]}   all children must pass
      - or     : {"conditions": [...]}   at least one child must pass
      - not    : {"condition": {...}}    invert the child
    Backwards-compat: a plain entity-condition dict (no "type") is treated as entity.
    """
    from services.home_automation import get_state as _get_state
    from datetime import datetime as _dt

    ctype = cond.get("type")

    if ctype == "and":
        for child in cond.get("conditions", []) or []:
            ok, reason = _eval_single_condition(child)
            if not ok:
                return False, f"and-child failed: {reason}"
        return True, "and"

    if ctype == "or":
        children = cond.get("conditions", []) or []
        if not children:
            return True, "or (empty)"
        reasons: list[str] = []
        for child in children:
            ok, reason = _eval_single_condition(child)
            if ok:
                return True, f"or-matched: {reason}"
            reasons.append(reason)
        return False, "or-all-failed: " + " | ".join(reasons[:3])

    if ctype == "not":
        ok, reason = _eval_single_condition(cond.get("condition", {}) or {})
        return (not ok), f"not({reason})"

    if ctype == "time":
        now_hm = _dt.now().strftime("%H:%M")
        after  = (cond.get("after")  or "00:00")[:5]
        before = (cond.get("before") or "23:59")[:5]
        if after > before:  # overnight
            passed = now_hm >= after or now_hm < before
        else:
            passed = after <= now_hm < before
        return passed, f"time {now_hm} in [{after},{before})"

    # entity condition (default)
    entity_id = cond.get("entity_id", "")
    if not entity_id:
        return True, "no entity_id — skipped"
    operator = cond.get("operator", "is")
    expected = str(cond.get("value", "on"))
    state_res = _get_state(entity_id)
    if not state_res.get("ok"):
        return False, f"{entity_id} unreachable"
    actual = state_res.get("data", {}).get("state", "")
    if operator == "is":
        passed = actual == expected
    elif operator == "is_not":
        passed = actual != expected
    elif operator in ("above", "below"):
        try:
            passed = (float(actual) > float(expected)) if operator == "above" else (float(actual) < float(expected))
        except (ValueError, TypeError):
            passed = False
    else:
        passed = True

    # Optional "stable-for" window: state must have held for N minutes.
    if passed:
        for_mins = cond.get("for_minutes")
        if for_mins:
            try:
                import time as _time
                from services.ha_subscriber import state_cache
                last_changed_str = state_cache.get(entity_id, {}).get("last_changed") or ""
                if last_changed_str:
                    last_ts = _dt.fromisoformat(last_changed_str.replace("Z", "+00:00")).timestamp()
                    held = _time.time() - last_ts
                    need = int(for_mins) * 60
                    if held < need:
                        return False, f"{entity_id} held only {int(held)}s, need {need}s"
            except Exception:
                pass

    return passed, f"{entity_id}={actual} (op={operator}, expected={expected})"


async def execute_ziggy_actions(
    automation_id: str,
    label: str = "",
    trigger_reason: str = "",
) -> list[dict]:
    """Run all stored steps for an automation/routine in sequence.

    Called as a FastAPI BackgroundTask after the HTTP response is sent so that:
    - Delay steps don't block the HTTP connection
    - Client disconnection / proxy timeouts can't cancel the sequence
    - The full IR/delay/capability chain executes reliably to completion

    label — human-readable name shown in the result toast; falls back to meta
             store, then automation_id if neither is available.
    trigger_reason — why this run was kicked off (e.g. "manual", "scheduler-time",
             "presence:person_leaves"). Stored in history.
    """
    import asyncio
    import time as _time
    import uuid as _uuid
    from core.logger_module import log_info, log_error
    from core.action_parser import handle_intent
    from core.debug_bus import bus as _bus, BASIC, VERBOSE
    from services.automation_history import record_run

    request_id = f"auto_{_uuid.uuid4().hex[:8]}"
    started_at = _time.time()

    if automation_id in _running_automations:
        log_info(f"[Executor] {automation_id} already running — duplicate trigger ignored")
        _bus.emit("automation", BASIC, "automation_duplicate_trigger",
                  request_id=request_id, automation_id=automation_id, label=label,
                  result="skipped", message="Already running — duplicate trigger ignored.")
        record_run(
            automation_id, label=label or automation_id,
            started_at=started_at, finished_at=_time.time(),
            ok=False, steps_total=0, steps_failed=0,
            trigger_reason=trigger_reason, skipped_reason="already_running",
        )
        return []

    # Snooze check — skip if user has paused this automation.
    meta_for_snooze = get_automation_meta(automation_id) or {}
    snoozed_until = meta_for_snooze.get("snoozed_until")
    if snoozed_until:
        try:
            from datetime import datetime as _dt
            until_ts = _dt.fromisoformat(str(snoozed_until).replace("Z", "+00:00")).timestamp()
            if until_ts > _time.time():
                log_info(f"[Executor] {automation_id} snoozed until {snoozed_until} — skipped")
                _bus.emit("automation", BASIC, "automation_snoozed",
                          request_id=request_id, automation_id=automation_id,
                          until=snoozed_until, result="skipped")
                record_run(
                    automation_id, label=label or automation_id,
                    started_at=started_at, finished_at=_time.time(),
                    ok=False, steps_total=0, steps_failed=0,
                    trigger_reason=trigger_reason, skipped_reason=f"snoozed_until:{snoozed_until}",
                )
                return []
            else:
                # snooze expired — clear it so it doesn't keep gating future runs
                meta_for_snooze.pop("snoozed_until", None)
                save_automation_meta(automation_id, meta_for_snooze)
        except Exception:
            pass

    _running_automations.add(automation_id)
    steps = get_ziggy_actions(automation_id)
    _bus.emit("automation", BASIC, "automation_started",
              request_id=request_id, automation_id=automation_id,
              label=label, steps_count=len(steps))
    results: list[dict] = []
    prev_kind: str | None = None

    try:
        # ── Evaluate conditions before running any steps ──────────────────────
        conditions = get_automation_meta(automation_id).get("conditions") or []
        if conditions:
            failed_reason = ""
            for cond in conditions:
                passed, reason = _eval_single_condition(cond)
                if not passed:
                    failed_reason = reason
                    log_info(
                        f"[Executor] {automation_id} condition not met: {reason} — skipped"
                    )
                    record_run(
                        automation_id, label=label or automation_id,
                        started_at=started_at, finished_at=_time.time(),
                        ok=False, steps_total=0, steps_failed=0,
                        trigger_reason=trigger_reason,
                        skipped_reason=f"condition_failed: {failed_reason}",
                    )
                    return []
            log_info(f"[Executor] {automation_id} all {len(conditions)} condition(s) passed")

        for i, step in enumerate(steps):
            kind = step.get("type", "")
            try:
                log_info(f"[Executor] {automation_id} step {i+1}/{len(steps)}: {kind}")
                _bus.emit("automation", VERBOSE, "automation_step",
                          request_id=request_id, automation_id=automation_id,
                          step_index=i + 1, steps_total=len(steps),
                          step_type=kind, step_data={k: v for k, v in step.items() if k != "type"})

                # ── HA service call executed directly by Ziggy ───────────────────
                # `device` is the routine-wizard alias for call_service — same payload,
                # different field names (action/ha_service vs service_value/service).
                if kind in ("call_service", "device"):
                    from services.home_automation import call_service as ha_call, get_state
                    from services.manual_overrides import (
                        is_overridden, register_ziggy_call,
                    )
                    entity_id = step.get("entity_id", "")
                    svc_key = (
                        step.get("ha_service")
                        or step.get("service_value")
                        or step.get("action")
                        or ""
                    )
                    if not svc_key:
                        svc_key = step.get("service", "homeassistant.turn_on").split(".")[-1]
                    domain = entity_id.split(".")[0] if "." in entity_id else "homeassistant"
                    payload: dict = {"entity_id": entity_id}
                    payload.update(step.get("service_data") or {})

                    # Manual-override gate — if the user just changed this entity by hand,
                    # leave it alone for the override window. The step's `respect_override`
                    # flag (default True) lets advanced automations force-through.
                    if entity_id and step.get("respect_override", True) and is_overridden(entity_id):
                        log_info(
                            f"[Executor] {entity_id} manually overridden — "
                            f"skipping {domain}.{svc_key}"
                        )
                        result = {
                            "ok": True,
                            "skipped": True,
                            "message": f"{entity_id} manually overridden — left alone.",
                        }
                        results.append(result)
                        prev_kind = kind
                        continue

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
                        # Tag the call so the HA subscriber doesn't misclassify the
                        # resulting state_changed event as a manual override.
                        if entity_id:
                            register_ziggy_call(entity_id)
                        # to_thread the sync HA REST call so the event loop stays
                        # responsive during routine execution. A 5-step routine
                        # was previously blocking the loop for ~5 × HA-RTT — every
                        # other request stacked behind it. WS broadcasts froze too,
                        # which is why bursts felt laggy on every screen.
                        result = await asyncio.to_thread(ha_call, domain, svc_key, payload)
                        if result.get("ok"):
                            break
                        if attempt < 2:
                            log_info(
                                f"[Executor] {domain}.{svc_key} failed "
                                f"(attempt {attempt + 1}/3) — retrying in 5s…"
                            )
                            await asyncio.sleep(5)

                # ── Dynamic device command (from HA capability mirror) ───────────
                # Shape: {
                #   "type": "device_command",
                #   "entity_id": "water_heater.boiler",
                #   "command_id": "switcher.turn_on_with_timer" | "ir.power",
                #   "params": {...},
                #   "prefer_source": "wifi" | "ir" (optional),
                # }
                # On hybrid devices, routes through services/command_router so
                # the Wi-Fi/IR source decision matches the device-detail tile.
                elif kind == "device_command":
                    entity_id  = step.get("entity_id", "")
                    command_id = step.get("command_id", "")
                    params     = step.get("params") or {}
                    if not entity_id or not command_id:
                        result = {"ok": False, "message": "device_command needs entity_id and command_id"}
                    elif command_id.startswith("ir."):
                        # IR-namespaced — dispatch through ir_manager. send_ir_command
                        # is sync (broadlink socket I/O); to_thread keeps it off the
                        # event loop during routine bursts.
                        try:
                            from services.device_registry import get_device_info
                            from services.ir_manager import send_ir_command
                            entry = get_device_info(entity_id) or {}
                            ir_id = entry.get("ir_device_id") or ""
                            if not ir_id:
                                result = {"ok": False, "message": f"No IR codeset linked to {entity_id}"}
                            else:
                                result = await asyncio.to_thread(send_ir_command, ir_id, command_id[3:])
                        except Exception as ex:
                            result = {"ok": False, "message": f"IR dispatch failed: {ex}"}
                    else:
                        # HA service — let the router pick the source on hybrid devices.
                        # Both route_command (which may chain a sync HA POST) and the
                        # direct ha_call branch are sync — to_thread to free the loop
                        # for the duration of the HA round-trip.
                        try:
                            from services.device_registry import get_device_info
                            from services.command_router import route_command
                            from services.home_automation import call_service as ha_call
                            entry = get_device_info(entity_id) or {}
                            if "." not in command_id:
                                result = {"ok": False, "message": f"Invalid command_id '{command_id}'"}
                            else:
                                # Bind entity_id into params so the router builds a complete payload.
                                merged = dict(params)
                                merged["entity_id"] = entity_id
                                if entry.get("ir_device_id"):
                                    # Hybrid — only the service name is used by the router; the domain
                                    # is taken from the entity_id. command_id is "domain.service" form.
                                    _, svc = command_id.split(".", 1)
                                    result = await asyncio.to_thread(route_command, entry, svc, merged)
                                else:
                                    domain, svc = command_id.split(".", 1)
                                    result = await asyncio.to_thread(ha_call, domain, svc, merged)
                        except Exception as ex:
                            result = {"ok": False, "message": f"device_command failed: {ex}"}

                # ── Timed pause ──────────────────────────────────────────────────
                elif kind == "delay":
                    secs = max(0, int(step.get("seconds", step.get("delay_seconds", 0))))
                    log_info(f"[Executor] Waiting {secs}s…")
                    await asyncio.sleep(secs)
                    result = {"ok": True, "message": f"Waited {secs}s"}

                # ── Notification ─────────────────────────────────────────────────
                elif kind == "notify":
                    msg   = step.get("message", "")
                    title = step.get("title", "Ziggy")
                    try:
                        from services.push_notify import push_notify
                        await push_notify(title, msg, "/", "automation")
                        result = {"ok": True, "message": "Notification sent"}
                    except Exception as e:
                        result = {"ok": False, "message": f"Notify failed: {e}"}

                # ── Actionable notification (push with buttons) ──────────────────
                # step: {
                #   "type": "notify_actionable",
                #   "title": "...", "message": "...",
                #   "actions": [{"label": "Turn off", "action": <step-dict>}]
                # }
                elif kind == "notify_actionable":
                    msg   = step.get("message", "")
                    title = step.get("title", "Ziggy")
                    raw_actions = step.get("actions") or []
                    try:
                        from services.push_actions import register_action
                        from services.push_notify import push_notify
                        bound: list[dict] = []
                        for spec in raw_actions[:3]:  # web push caps at 2-3 actions
                            label_txt = spec.get("label") or spec.get("title") or "Run"
                            action_dict = spec.get("action") or {}
                            if not action_dict:
                                continue
                            tok = register_action(action_dict)
                            bound.append({"action": tok, "title": label_txt})
                        await push_notify(title, msg, "/", "automation", actions=bound)
                        result = {
                            "ok": True,
                            "message": f"Actionable notify sent ({len(bound)} button(s))",
                        }
                    except Exception as e:
                        result = {"ok": False, "message": f"Actionable notify failed: {e}"}

                # ── Speak / announce via TTS ────────────────────────────────────
                # step: {"type": "speak", "text": "Good morning"}
                elif kind == "speak":
                    text = (step.get("text") or step.get("message") or "").strip()
                    if not text:
                        result = {"ok": False, "message": "speak step has no text"}
                    else:
                        try:
                            from services.communication_manager import broadcast_announcement
                            target = step.get("rooms_or_all", "all")
                            tts_res = await asyncio.get_event_loop().run_in_executor(
                                None, broadcast_announcement, text, target
                            )
                            result = tts_res if isinstance(tts_res, dict) else {
                                "ok": bool(tts_res), "message": str(tts_res),
                            }
                        except Exception as e:
                            result = {"ok": False, "message": f"Speak failed: {e}"}

                # ── Wait for an entity to reach a target state ──────────────────
                # step: {"type": "wait_for_state", "entity_id": "binary_sensor.front_door",
                #        "state": "on", "timeout_seconds": 600, "on_timeout": "continue"|"abort"}
                elif kind == "wait_for_state":
                    entity_id = step.get("entity_id", "")
                    target    = str(step.get("state", "on"))
                    timeout   = int(step.get("timeout_seconds", 600))
                    on_timeout = (step.get("on_timeout") or "continue").lower()
                    if not entity_id:
                        result = {"ok": False, "message": "wait_for_state needs entity_id"}
                    else:
                        try:
                            from services.ha_subscriber import state_cache
                            from services.home_automation import get_state as _gs
                            deadline = asyncio.get_event_loop().time() + max(1, timeout)
                            matched = False
                            while asyncio.get_event_loop().time() < deadline:
                                current = state_cache.get(entity_id, {}).get("state")
                                if current is None:
                                    # state_cache may not yet be populated — fall back to REST once
                                    state_res = _gs(entity_id)
                                    current = state_res.get("data", {}).get("state")
                                if str(current) == target:
                                    matched = True
                                    break
                                await asyncio.sleep(1)
                            if matched:
                                result = {"ok": True, "message": f"{entity_id} reached '{target}'"}
                            elif on_timeout == "abort":
                                # Abort the whole automation on timeout.
                                results.append({
                                    "ok": False,
                                    "message": f"{entity_id} did not reach '{target}' within {timeout}s — aborting",
                                })
                                break
                            else:
                                result = {
                                    "ok": True,
                                    "message": f"{entity_id} did not reach '{target}' within {timeout}s — continuing",
                                    "timed_out": True,
                                }
                        except Exception as e:
                            result = {"ok": False, "message": f"wait_for_state failed: {e}"}

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

                # ── Run another automation inline ────────────────────────────────
                # Loads the target automation's saved actions and executes them
                # one-by-one in this routine's flow. Trigger/conditions of the
                # target are intentionally ignored — this is a manual "include".
                elif kind == "automation":
                    target_id = step.get("automation_id") or ""
                    if not target_id:
                        result = {"ok": False, "message": "Automation step has no automation_id."}
                    elif target_id == automation_id:
                        result = {"ok": False, "message": "Refusing to recursively run the same automation."}
                    else:
                        sub_results = await execute_ziggy_actions(target_id, label=f"sub:{target_id}")
                        sub_failed = [r for r in sub_results if not r.get("ok")]
                        result = {
                            "ok": not sub_failed,
                            "message": (
                                f"Ran {len(sub_results)} step(s) from {target_id}"
                                if not sub_failed
                                else f"{len(sub_failed)}/{len(sub_results)} step(s) failed in {target_id}"
                            ),
                        }

                else:
                    result = {"ok": False, "message": f"Unknown step type: {kind}"}

            except asyncio.CancelledError:
                log_error(f"[Executor] {automation_id} step {i+1} cancelled (server shutdown?)")
                _bus.emit("automation", BASIC, "automation_step_cancelled",
                          request_id=request_id, automation_id=automation_id,
                          step_index=i + 1, step_type=kind, result="cancelled")
                raise
            except Exception as exc:
                log_error(f"[Executor] {automation_id} step {i+1} ({kind}) error: {exc}")
                result = {"ok": False, "message": str(exc)}
                _bus.emit("automation", BASIC, "automation_step_error",
                          request_id=request_id, automation_id=automation_id,
                          step_index=i + 1, step_type=kind,
                          error=str(exc), error_type=type(exc).__name__,
                          result="exception")

            results.append(result)
            prev_kind = kind
            _bus.emit("automation", VERBOSE, "automation_step_done",
                      request_id=request_id, automation_id=automation_id,
                      step_index=i + 1, step_type=kind,
                      result="ok" if result.get("ok") else "error",
                      message=result.get("message"))

        failed = [r for r in results if not r.get("ok")]
        log_info(f"[Executor] {automation_id} complete — {len(results)} steps")
        _bus.emit("automation", BASIC, "automation_complete",
                  request_id=request_id, automation_id=automation_id,
                  label=label, steps_total=len(results), steps_failed=len(failed),
                  result="ok" if not failed else "partial_failure")

        # Persist run summary to per-automation history.
        try:
            record_run(
                automation_id,
                label=label or (_load_meta().get(automation_id, {}).get("name") or automation_id),
                started_at=started_at,
                finished_at=_time.time(),
                ok=(len(failed) == 0),
                steps_total=len(results),
                steps_failed=len(failed),
                trigger_reason=trigger_reason,
                errors=[r.get("message", "") for r in failed],
            )
        except Exception as _hist_err:
            log_error(f"[Executor] history record failed: {_hist_err}")

        # Push result to all connected frontend clients so the UI can show a toast.
        try:
            from backend.ws_manager import manager
            if not label:
                meta = _load_meta().get(automation_id, {})
                label = meta.get("name") or automation_id
            await manager.broadcast({
                "type": "execution_result",
                "automation_id": automation_id,
                "label": label,
                "ok": len(failed) == 0,
                "steps_total": len(results),
                "steps_failed": len(failed),
                "errors": [r.get("message", "") for r in failed][:3],
                "trigger_reason": trigger_reason,
            })
        except Exception as _ws_err:
            log_error(f"[Executor] WS broadcast failed: {_ws_err}")

        return results

    finally:
        _running_automations.discard(automation_id)
