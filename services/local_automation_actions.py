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
STATE_FILE = "user_files/automation_state.json"


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


# ── Local automation state ───────────────────────────────────────────────────
# Small file-backed key/value store, keyed by `namespace`. Used by paired
# automations (e.g. Night Watch) to coordinate without touching a global flag.
# Each namespace owns its keys; no cross-namespace reads.

def _load_state() -> dict:
    if not os.path.exists(STATE_FILE):
        return {}
    with open(STATE_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_state(data: dict) -> None:
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def set_local_state(namespace: str, key: str, value: Any) -> None:
    store = _load_state()
    store.setdefault(namespace, {})[key] = value
    _save_state(store)


def get_local_state(namespace: str, key: str, default: Any = None) -> Any:
    return _load_state().get(namespace, {}).get(key, default)


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
    # User-cancellable delay + the Cancel-button action that aborts it.
    # Paired: a notify_actionable step carries a cancel_pending button, the
    # following wait_cancellable polls the flag and breaks out if tapped.
    "wait_cancellable",
    "cancel_pending",
    # Dynamic device command — surfaces the full HA service catalog through
    # the automation/routine builder. Carries {entity_id, command_id, params,
    # prefer_source?}; routed through services/command_router on hybrid
    # devices so the Wi-Fi/IR source decision matches the device-detail tile.
    "device_command",
    # Paired-automation snapshot/restore (e.g. Night Watch). Captures
    # per-entity {state, brightness} into a namespaced store so a later
    # stage can restore the pre-change configuration.
    "save_entity_states",    # {namespace, state_key, entity_ids} → snapshot
    "restore_entity_states", # {namespace, state_key}              → replay
    # Registers a multi-day "Away — Simulate Presence" activation with
    # services.fake_occupancy_scheduler. The step itself returns immediately;
    # the per-minute scheduler tick owns all subsequent execution.
    "fake_occupancy_start",
    # Music playback (Spotify / YT Music) on a speaker the user has enabled
    # in Settings → Music. Self-gated on media_music; refuses to run when off.
    "media_play",
    # Whole-home "off" scene primitives — reliable batched shutdowns that call
    # services.home_automation directly (NOT via the flaky text→intent hop).
    # Used by Good Night / Leaving and available in the routine wizard.
    "turn_off_all_lights",   # every light off (lights only)
    "turn_off_everything",   # lights + TV/media off
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

# Cancellation flags for in-flight automations. Set by `cancel_pending` (which
# the user triggers by tapping the Cancel button on an actionable push), read
# by `wait_cancellable`. Value is the timestamp the flag was raised so a stale
# flag from a previous run can be detected. The flag is cleared at the top of
# every execute_ziggy_actions invocation, and again inside wait_cancellable
# when it aborts — so a flag set after the wait has already passed won't carry
# over into a subsequent unrelated step or run.
_cancel_flags: dict[str, float] = {}


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

    # IR-device condition — gates on ir_manager's assumed_state for IR-only
    # devices that don't have an HA entity (most IR ACs). Shape:
    #   {"type": "ir_device_state", "ir_device_id": "...",
    #    "operator": "is"|"is_not", "value": "on"|"off"}
    if ctype == "ir_device_state":
        ir_id = cond.get("ir_device_id", "")
        if not ir_id:
            return True, "no ir_device_id — skipped"
        try:
            from services.ir_manager import get_ir_device, get_device_state
            dev = get_ir_device(ir_id)
            if not dev:
                return False, f"ir_device {ir_id} not found"
            actual = get_device_state(dev)  # "on" | "off" | "unknown"
        except Exception as e:
            return False, f"ir_device_state read failed: {e}"
        operator = cond.get("operator", "is")
        expected = str(cond.get("value", "on"))
        if operator == "is":
            passed = actual == expected
        elif operator == "is_not":
            passed = actual != expected
        else:
            passed = True
        return passed, f"ir:{ir_id}={actual} (op={operator}, expected={expected})"

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
    # Start with a clean cancel slate — a flag left over from a previous run
    # (e.g. user tapped Cancel after the wait completed) must not abort this one.
    _cancel_flags.pop(automation_id, None)
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
                            action_dict = dict(spec.get("action") or {})
                            if not action_dict:
                                continue
                            # `cancel_pending` runs through push_actions in a
                            # transient automation context, so we have to bind
                            # the *outer* automation_id here — that's the run
                            # the user is asking to cancel.
                            if (
                                action_dict.get("type") == "cancel_pending"
                                and not action_dict.get("target_automation_id")
                            ):
                                action_dict["target_automation_id"] = automation_id
                            tok = register_action(action_dict)
                            bound.append({"action": tok, "title": label_txt})
                        await push_notify(title, msg, "/", "automation", actions=bound)
                        result = {
                            "ok": True,
                            "message": f"Actionable notify sent ({len(bound)} button(s))",
                        }
                    except Exception as e:
                        result = {"ok": False, "message": f"Actionable notify failed: {e}"}

                # ── Cancel a pending wait on another automation run ──────────────
                # step: {"type": "cancel_pending", "target_automation_id": "..."}
                # Issued by the Cancel button on an actionable push. The
                # notify_actionable branch (above) injects the outer automation_id
                # into target_automation_id at register time, so the button knows
                # which run to abort even though it itself executes in a transient
                # push-action context.
                elif kind == "cancel_pending":
                    target = step.get("target_automation_id") or ""
                    if not target:
                        result = {"ok": False, "message": "cancel_pending needs target_automation_id"}
                    else:
                        _cancel_flags[target] = _time.time()
                        log_info(f"[Executor] Cancellation flag set for {target}")
                        result = {"ok": True, "message": f"Cancellation queued for {target}"}

                # ── Cancellable wait — abort the automation if cancelled ─────────
                # step: {
                #   "type": "wait_cancellable",
                #   "seconds": 60,
                #   # Optional presence-verification guard. While waiting, the
                #   # executor polls each entity in `presence_sensors` once per
                #   # second. If any reads "on" / "detected" / "occupied", the
                #   # automation aborts and (if message is set) pushes it to
                #   # the user. Used by Last One Out to back off the shutoff
                #   # when motion/mmWave catches someone still home.
                #   "presence_sensors": ["binary_sensor.…", ...],
                #   "presence_abort_message": "...",   # push body on abort
                #   "presence_abort_title":   "Ziggy", # push title (default)
                # }
                # Sleeps in 1-second slices, checking _cancel_flags AND any
                # presence sensors each tick. Either signal breaks out using
                # the same append-result-then-break pattern as wait_for_state
                # on_timeout="abort". Cancel + presence are independent —
                # cancel produces no push (the actionable notification was
                # the user's signal); presence produces the abort push.
                elif kind == "wait_cancellable":
                    secs = max(0, int(step.get("seconds", step.get("delay_seconds", 0))))
                    presence_sensors = [
                        s for s in (step.get("presence_sensors") or []) if s
                    ]
                    abort_message = step.get("presence_abort_message", "")
                    abort_title   = step.get("presence_abort_title", "Ziggy")
                    log_info(
                        f"[Executor] Cancellable wait {secs}s on {automation_id} "
                        f"(presence_sensors={len(presence_sensors)})…"
                    )

                    if presence_sensors:
                        from services.ha_subscriber import state_cache as _state_cache
                    else:
                        _state_cache = None  # type: ignore[assignment]

                    def _presence_active() -> str:
                        """Return the sensor entity_id reading 'present', or '' if all clear."""
                        if not presence_sensors or _state_cache is None:
                            return ""
                        for sid in presence_sensors:
                            raw = (_state_cache.get(sid) or {}).get("state")
                            if raw is None:
                                continue
                            if str(raw).lower() in ("on", "detected", "occupied", "home"):
                                return sid
                        return ""

                    cancelled = False
                    triggered_sensor = ""
                    for _ in range(secs):
                        if _cancel_flags.get(automation_id):
                            cancelled = True
                            break
                        triggered_sensor = _presence_active()
                        if triggered_sensor:
                            break
                        await asyncio.sleep(1)

                    if cancelled:
                        _cancel_flags.pop(automation_id, None)
                        log_info(f"[Executor] {automation_id} cancelled by user — aborting remaining steps")
                        results.append({
                            "ok": True,
                            "cancelled": True,
                            "message": "Cancelled by user — remaining steps skipped.",
                        })
                        break
                    if triggered_sensor:
                        log_info(
                            f"[Executor] {automation_id} aborted — presence detected on "
                            f"{triggered_sensor}. Remaining steps skipped."
                        )
                        if abort_message:
                            try:
                                from services.push_notify import push_notify
                                await push_notify(abort_title, abort_message, "/", "automation")
                            except Exception as _push_err:
                                log_error(f"[Executor] presence-abort push failed: {_push_err}")
                        results.append({
                            "ok": True,
                            "aborted_for_presence": True,
                            "sensor": triggered_sensor,
                            "message": (
                                f"Presence detected on {triggered_sensor} — "
                                "remaining steps skipped."
                            ),
                        })
                        break
                    result = {"ok": True, "message": f"Waited {secs}s (no cancel, no presence)"}

                # ── Speak / announce via TTS ────────────────────────────────────
                # step: {"type": "speak", "text": "Good morning"}
                # ── Play music on a speaker ─────────────────────────────────────
                # step: {"type": "media_play", "speaker_entity": "media_player.x",
                #        "service": "spotify"|"ytmusic", "profile": "Youval",
                #        "mode": "uri"|"search"|"open_app",
                #        "uri": "spotify:playlist:..." or "https://music.youtube.com/...",
                #        "query": "Lovely Day", "volume": 35 }
                elif kind == "media_play":
                    try:
                        from core.media import flag as _media_flag
                        if not _media_flag.is_enabled():
                            result = {"ok": False, "message": "Music feature is disabled."}
                        else:
                            from core.media import orchestrator as _media_orch
                            r = await _media_orch.play(
                                speaker_entity=step.get("speaker_entity", ""),
                                service=step.get("service", "spotify"),
                                profile=step.get("profile", ""),
                                mode=step.get("mode", "uri"),
                                uri=step.get("uri"),
                                query=step.get("query"),
                                volume=step.get("volume"),
                            )
                            result = {
                                "ok": bool(r.get("ok")),
                                "message": r.get("msg") or r.get("reason") or ("Playing." if r.get("ok") else "Couldn't start playback."),
                                "details": r,
                            }
                    except Exception as e:
                        result = {"ok": False, "message": f"media_play failed: {e}"}

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

                # ── Snapshot current state of N entities into namespaced store ──
                # step: {"type": "save_entity_states", "namespace": "...",
                #        "state_key": "...", "entity_ids": ["light.foo", ...]}
                # Captures {state, brightness} for each so restore_entity_states
                # can replay the exact pre-dim configuration.
                elif kind == "save_entity_states":
                    namespace = step.get("namespace", "")
                    state_key = step.get("state_key", "")
                    eids      = step.get("entity_ids") or []
                    if not namespace or not state_key:
                        result = {"ok": False, "message": "save_entity_states needs namespace and state_key"}
                    else:
                        try:
                            from services.ha_subscriber import state_cache
                            from services.home_automation import get_state as _gs
                            snapshot: dict = {}
                            for eid in eids:
                                entry = state_cache.get(eid)
                                if not entry:
                                    state_res = _gs(eid)
                                    if state_res.get("ok"):
                                        entry = state_res.get("data") or {}
                                if not entry:
                                    continue
                                attrs = entry.get("attributes") or {}
                                snapshot[eid] = {
                                    "state":      entry.get("state"),
                                    "brightness": attrs.get("brightness"),
                                }
                            set_local_state(namespace, state_key, snapshot)
                            result = {"ok": True, "message": f"snapshotted {len(snapshot)} entity(s) into {namespace}.{state_key}"}
                        except Exception as e:
                            result = {"ok": False, "message": f"save_entity_states failed: {e}"}

                # ── Restore entities to their saved pre-dim configuration ──
                # step: {"type": "restore_entity_states", "namespace": "...", "state_key": "..."}
                elif kind == "restore_entity_states":
                    namespace = step.get("namespace", "")
                    state_key = step.get("state_key", "")
                    if not namespace or not state_key:
                        result = {"ok": False, "message": "restore_entity_states needs namespace and state_key"}
                    else:
                        try:
                            from services.home_automation import call_service as ha_call
                            snapshot = get_local_state(namespace, state_key) or {}
                            restored = 0
                            for eid, info in snapshot.items():
                                domain = eid.split(".")[0] if "." in eid else "homeassistant"
                                saved_state = (info or {}).get("state")
                                saved_brightness = (info or {}).get("brightness")
                                if saved_state == "off":
                                    payload = {"entity_id": eid}
                                    await asyncio.to_thread(ha_call, domain, "turn_off", payload)
                                else:
                                    payload = {"entity_id": eid}
                                    if isinstance(saved_brightness, int):
                                        payload["brightness"] = saved_brightness
                                    await asyncio.to_thread(ha_call, domain, "turn_on", payload)
                                restored += 1
                            result = {"ok": True, "message": f"restored {restored} entity(s) from {namespace}.{state_key}"}
                        except Exception as e:
                            result = {"ok": False, "message": f"restore_entity_states failed: {e}"}

                # ── Whole-home "off" scenes — call the primitive directly ────────
                elif kind == "turn_off_all_lights":
                    try:
                        from services.home_automation import turn_off_all_lights
                        r = await asyncio.to_thread(turn_off_all_lights)
                        result = {"ok": True, "message": "All lights off", "data": r}
                    except Exception as e:
                        result = {"ok": False, "message": f"turn_off_all_lights failed: {e}"}

                elif kind == "turn_off_everything":
                    try:
                        from services.home_automation import turn_off_everything
                        r = await asyncio.to_thread(turn_off_everything)
                        result = {"ok": True, "message": "Everything off", "data": r}
                    except Exception as e:
                        result = {"ok": False, "message": f"turn_off_everything failed: {e}"}

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

                # ── Run / enable / disable another automation ─────────────────────
                # mode="run"    (default) Loads the target automation's saved actions
                #               and executes them inline. Trigger/conditions of the
                #               target are ignored — this is a manual "include".
                # mode="enable" Calls HA automation.turn_on(target). Used by paired
                #               automations (e.g. Night Watch) where Stage 1 arms a
                #               state-triggered Stage 2 by enabling it.
                # mode="disable" Calls HA automation.turn_off(target). Paired-disarm.
                elif kind == "automation":
                    target_id = step.get("automation_id") or ""
                    mode = (step.get("mode") or "run").lower()
                    if not target_id:
                        result = {"ok": False, "message": "Automation step has no automation_id."}
                    elif mode in ("enable", "disable"):
                        try:
                            from services.ha_automations import toggle_automation
                            ok = await asyncio.to_thread(
                                toggle_automation, target_id, mode == "enable"
                            )
                            result = {
                                "ok": bool(ok),
                                "message": (
                                    f"{'Enabled' if mode == 'enable' else 'Disabled'} {target_id}"
                                    if ok else f"Failed to {mode} {target_id}"
                                ),
                            }
                        except Exception as e:
                            result = {"ok": False, "message": f"{mode} {target_id} failed: {e}"}
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

                # ── Register a multi-day "Away — Simulate Presence" activation ──
                # Hands off all execution to services.fake_occupancy_scheduler,
                # which runs its own per-minute tick from ziggy_scheduler.
                # Calling it again for the same automation_id resets the day
                # counter — re-running from the app means "start over."
                elif kind == "fake_occupancy_start":
                    from services import fake_occupancy_scheduler
                    result = fake_occupancy_scheduler.start(
                        automation_id=automation_id,
                        label=label or automation_id,
                        window_start=step.get("window_start", "19:00"),
                        window_end=step.get("window_end",   "23:00"),
                        duration_days=int(step.get("duration_days", 7)),
                        room_pool=step.get("rooms") or [],
                        tv_ir_device_id=step.get("tv_ir_device_id") or None,
                        brightness_pct=int(step.get("brightness_pct", 70)),
                    )

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
