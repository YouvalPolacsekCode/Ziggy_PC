"""Shared side-effect fanout for confirmed presence transitions.

Imported by both `backend/routers/presence_router.py` (HTTP ping path) and
`services/ha_presence_bridge.py` (HA Companion bridge). Each ingest path
calls into the engine, then passes the returned Decision to
`schedule_side_effects` so push + automation fanout happens exactly the
same way regardless of source.

Push and automation tasks are independent (`asyncio.create_task` each) so a
hung webpush request can never block automation execution.
"""
from __future__ import annotations

import asyncio
from typing import Optional

from core.logger_module import log_info, log_error
from services.presence_engine import Decision


async def _send_push(name: str, new_state: str, person_id: str) -> None:
    try:
        from services.push_notify import push_notify
        from services import presence_engine
        # Suppress self-notification: don't push to the user whose own person
        # just transitioned — they already know they arrived/left. Partners and
        # any other household members still get the push.
        person  = presence_engine.find_person_by_id(person_id) or {}
        exclude = person.get("linked_user") or None
        verb    = "arrived home" if new_state == "home" else "left home"
        await push_notify(
            f"{name} {verb}", "", "/", "presence",
            exclude_user_id=exclude,
        )
    except Exception as exc:
        log_error(f"[Presence] Push notify failed: {exc}")


async def _fire_automations(name: str, new_state: str) -> None:
    trigger_type = "person_arrives" if new_state == "home" else "person_leaves"
    try:
        from core.automation_file import list_automations
        from services.local_automation_actions import execute_ziggy_actions

        for auto in list_automations():
            if not auto.get("enabled", True):
                continue
            t = auto.get("trigger", {})
            if t.get("type") != trigger_type:
                continue
            person_filter = t.get("person", "*")
            if person_filter != "*" and person_filter.lower() != name.lower():
                continue
            log_info(
                f"[Presence] Firing automation '{auto.get('name', auto['id'])}' "
                f"for {trigger_type} ({name})"
            )
            try:
                await execute_ziggy_actions(auto["id"])
            except Exception as exc:
                log_error(f"[Presence] Automation {auto['id']} failed: {exc}")

        # Composite trigger: fire `all_persons_left` automations only when the
        # household just emptied. Layered on top of `person_leaves` so existing
        # per-person automations stay untouched.
        if trigger_type == "person_leaves":
            from services.presence_engine import is_all_away
            if is_all_away():
                for auto in list_automations():
                    if not auto.get("enabled", True):
                        continue
                    t = auto.get("trigger", {})
                    if t.get("type") != "all_persons_left":
                        continue
                    log_info(
                        f"[Presence] Firing automation '{auto.get('name', auto['id'])}' "
                        f"for all_persons_left (last person: {name})"
                    )
                    try:
                        await execute_ziggy_actions(auto["id"])
                    except Exception as exc:
                        log_error(f"[Presence] Automation {auto['id']} failed: {exc}")
    except Exception as exc:
        log_error(f"[Presence] Transition handler error: {exc}")


async def _fire_zone_automation(zt) -> None:
    """Fire `zone_entered` / `zone_left` automations for one zone transition."""
    trigger_type = "zone_entered" if zt.direction == "entered" else "zone_left"
    try:
        from core.automation_file import list_automations
        from services.local_automation_actions import execute_ziggy_actions

        for auto in list_automations():
            if not auto.get("enabled", True):
                continue
            t = auto.get("trigger", {})
            if t.get("type") != trigger_type:
                continue
            zone_filter   = t.get("zone", "*")
            person_filter = t.get("person", "*")
            if zone_filter != "*" and zone_filter.lower() != zt.zone_name.lower():
                continue
            if person_filter != "*" and person_filter.lower() != zt.person_name.lower():
                continue
            log_info(
                f"[Presence] Firing automation '{auto.get('name', auto['id'])}' "
                f"for {trigger_type} zone={zt.zone_name} person={zt.person_name}"
            )
            try:
                await execute_ziggy_actions(auto["id"])
            except Exception as exc:
                log_error(f"[Presence] Zone automation {auto['id']} failed: {exc}")
    except Exception as exc:
        log_error(f"[Presence] Zone handler error: {exc}")


async def _broadcast_zone_transition(zt) -> None:
    try:
        from backend.ws_manager import manager
        await manager.broadcast({
            "type":       "presence_zone_transition",
            "person_id":  zt.person_id,
            "person":     zt.person_name,
            "zone_id":    zt.zone_id,
            "zone":       zt.zone_name,
            "direction":  zt.direction,
        })
    except Exception as exc:
        log_error(f"[Presence] Zone WS broadcast failed: {exc}")


async def _broadcast_transition(person_id: str, name: str, new_state: str) -> None:
    """Push a `presence_transition` over the WS so the Dashboard refreshes
    immediately, instead of waiting on the 30 s polling fallback."""
    try:
        from backend.ws_manager import manager
        await manager.broadcast({
            "type":       "presence_transition",
            "person_id":  person_id,
            "person":     name,
            "new_state":  new_state,
        })
    except Exception as exc:
        log_error(f"[Presence] WS broadcast failed: {exc}")


def schedule_side_effects(decision: Decision) -> None:
    """Fire push + automation tasks + WS broadcast for a confirmed transition.

    No-op if `decision.fired_transition` is False or the new state is unknown.
    All three side effects run as independent tasks; none blocks the others.

    Must be called from inside an asyncio event loop — uses asyncio.create_task.
    """
    if not decision.fired_transition:
        return
    new_state = decision.new_confirmed
    if new_state not in ("home", "not_home"):
        return
    try:
        asyncio.create_task(_send_push(decision.person_name, new_state, decision.person_id))
        asyncio.create_task(_fire_automations(decision.person_name, new_state))
        asyncio.create_task(_broadcast_transition(decision.person_id, decision.person_name, new_state))
    except RuntimeError as exc:
        # Called from outside an asyncio loop — log and continue. The state
        # was already committed in persons.json so the next sweep / ping will
        # reconcile if needed.
        log_error(
            f"[Presence] Cannot schedule side effects (no loop): {exc} "
            f"for {decision.person_name} → {new_state}"
        )


def schedule_zone_side_effects(decision: Decision) -> None:
    """Fire automation + WS broadcast for each ZoneTransition on the decision.

    Independent of the primary home/not_home side effects — a decision can
    have zone_transitions even when fired_transition is False (you cross into
    "Near Home" before crossing into "Home", or you transit a non-home zone
    while away from home). Currently does NOT send a push notification per
    zone — extra zones tend to be many and noisy.
    """
    transitions = getattr(decision, "zone_transitions", None) or []
    if not transitions:
        return
    try:
        for zt in transitions:
            asyncio.create_task(_fire_zone_automation(zt))
            asyncio.create_task(_broadcast_zone_transition(zt))
    except RuntimeError as exc:
        log_error(f"[Presence] Cannot schedule zone side effects (no loop): {exc}")
