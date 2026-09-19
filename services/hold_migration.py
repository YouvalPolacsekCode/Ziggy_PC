"""Teach already-installed recipe automations to honour a light hold.

`respect_hold` was added to the recipes on 2026-09-19, but an automation that
was installed BEFORE that keeps the steps it was saved with. On the operator's
own hub that meant Smart Room switched the office lamp back on fifteen seconds
after he turned it off by hand — the hold had been created correctly and the
rule simply never asked about it, because its `turn_on` compiles straight into
Home Assistant and never reaches the one evaluator that checks.

This migration re-saves those automations with `respect_hold: true` on their
light turn-ons. That flips them from "HA calls the light" to "HA fires an
event, Ziggy performs the step" (ha_automations._action_to_ha /
ha_defers_action), which is what puts the hold gate in the path.

Scope is deliberately narrow — automations Ziggy's own recipes own:

    ziggy_smart_room_<zone>_day / _night      motion-driven turn-ons
    ziggy_motion_light_<room>                 motion-driven turn-ons
    ziggy_welcome_home                        arrival turn-ons

A rule the customer built in the wizard is NOT touched: they wrote it to turn a
light on, and silently adding a condition they never asked for is the kind of
surprise this project keeps having to undo. The Off rules are untouched too —
a hold never blocks turning something off.

Idempotent and quiet: it reads first and writes nothing when every turn-on
already carries the flag, so it is safe on the hourly tick.
"""
from __future__ import annotations

import re
from typing import Any

from core.logger_module import log_error, log_info

#: Automation ids this migration owns.
_OWNED = (
    re.compile(r"^ziggy_smart_room_.+_(day|night)$"),
    re.compile(r"^ziggy_motion_light_.+$"),
    re.compile(r"^ziggy_welcome_home$"),
)


def owns(automation_id: str) -> bool:
    return any(p.match(automation_id or "") for p in _OWNED)


def _is_light_turn_on(step: dict) -> bool:
    if not isinstance(step, dict) or step.get("type") not in ("call_service", "device"):
        return False
    eid = step.get("entity_id")
    if not isinstance(eid, str) or not eid.startswith("light."):
        return False
    svc = f"{step.get('service', '')}{step.get('service_value', '')}" \
          f"{step.get('ha_service', '')}{step.get('action', '')}"
    return "turn_on" in svc


def plan() -> list[dict]:
    """Automations that still need the flag. Pure read."""
    from services.local_automation_actions import _load, get_all_saved_actions

    out: list[dict] = []
    try:
        ids = list(_load().keys())
    except Exception as e:
        log_error(f"[hold-migration] could not list automations: {e}")
        return out
    for aid in ids:
        if not owns(aid):
            continue
        steps = get_all_saved_actions(aid) or []
        pending = [i for i, s in enumerate(steps)
                   if _is_light_turn_on(s) and not s.get("respect_hold")]
        if pending:
            out.append({"id": aid, "steps": len(steps), "to_patch": len(pending)})
    return out


def migrate(*, dry_run: bool = False) -> dict[str, Any]:
    """Patch + re-save. Returns {checked, migrated:[...], errors:[...], dry_run}."""
    from services.local_automation_actions import get_all_saved_actions, get_automation_meta
    from services.ha_automations import save_automation

    todo = plan()
    result: dict[str, Any] = {"checked": len(todo), "migrated": [], "errors": [],
                              "dry_run": dry_run}
    if not todo:
        return result

    for row in todo:
        aid = row["id"]
        try:
            steps = [dict(s) for s in (get_all_saved_actions(aid) or [])]
            patched = 0
            for s in steps:
                if _is_light_turn_on(s) and not s.get("respect_hold"):
                    s["respect_hold"] = True
                    patched += 1
            if not patched:
                continue
            if dry_run:
                result["migrated"].append({"id": aid, "patched": patched, "written": False})
                continue

            meta = get_automation_meta(aid) or {}
            data = {
                "name":        meta.get("name") or aid,
                "description": meta.get("description", ""),
                "trigger":     meta.get("trigger") or {},
                "conditions":  meta.get("conditions") or [],
                "actions":     steps,
                "rooms":       meta.get("rooms") or [],
                "mode":        meta.get("mode", "single"),
            }
            if isinstance(meta.get("ha_native_body"), dict) and meta["ha_native_body"]:
                data["ha_native_body"] = meta["ha_native_body"]
            if not data["trigger"].get("type"):
                result["errors"].append({"id": aid, "error": "no stored trigger — skipped"})
                continue

            saved = save_automation(data, auto_id=aid)
            if saved.get("ok"):
                result["migrated"].append({"id": aid, "patched": patched, "written": True})
                log_info(f"[hold-migration] {aid}: {patched} turn-on(s) now honour a manual off")
            else:
                result["errors"].append({"id": aid, "error": saved.get("error", "save failed")})
        except Exception as e:  # one bad automation must not stop the rest
            log_error(f"[hold-migration] {aid} failed: {e}")
            result["errors"].append({"id": aid, "error": str(e)})

    if result["migrated"] and not dry_run:
        log_info(f"[hold-migration] migrated {len(result['migrated'])} automation(s)")
    return result


def tick() -> dict[str, Any]:
    """Scheduler entry point. No-op (and no HA writes) once everything carries
    the flag, so it is safe to run repeatedly — and self-heals an automation
    re-saved by an older client."""
    try:
        return migrate()
    except Exception as e:
        log_error(f"[hold-migration] tick failed: {e}")
        return {"checked": 0, "migrated": [], "errors": [{"error": str(e)}], "dry_run": False}
