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

                # HA-backed "Leave Home" bundles (bundle:leave_home) live in HA +
                # the ziggy-action store, NOT automations.json — and their
                # compiled trigger is a sensor `state` trigger, so neither this
                # presence path (which reads automations.json) nor the HA
                # automation's dropped/placeholder actions ever ran the real
                # turn-off. Run their stored actions here on the WORKING presence
                # engine's all-away signal, which is what the user's "phone leaves
                # home" choice actually meant.
                try:
                    from services.local_automation_actions import (
                        _load as _la_load, get_automation_meta, get_all_saved_actions,
                    )
                    for aid in list(_la_load().keys()):
                        meta = get_automation_meta(aid) or {}
                        blob = f"{aid} {meta.get('name','')} {meta.get('description','')}".lower()
                        looks_leave = ("leave" in blob) or ("everyone" in blob and "left" in blob) or ("everyone leaves" in blob)
                        acts = get_all_saved_actions(aid)
                        has_home_off = any(
                            a.get("type") in ("turn_off_all_lights", "turn_off_everything")
                            for a in acts
                        )
                        if not (looks_leave and has_home_off):
                            continue
                        log_info(f"[Presence] all-away → running Leave-Home actions for {aid}")
                        try:
                            await execute_ziggy_actions(aid)
                        except Exception as exc:
                            log_error(f"[Presence] Leave-Home {aid} failed: {exc}")
                except Exception as exc:
                    log_error(f"[Presence] HA-backed leave-home scan failed: {exc}")
    except Exception as exc:
        log_error(f"[Presence] Transition handler error: {exc}")


# Last time a zone_entered automation actually FIRED per zone name (monotonic
# seconds). Feeds the arrival fallback's dedup so a successful approach fire
# suppresses the redundant at-the-door re-fire.
_LAST_ZONE_ENTER_FIRE: dict = {}


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
            if trigger_type == "zone_entered":
                import time as _time
                _LAST_ZONE_ENTER_FIRE[zt.zone_name.lower()] = _time.monotonic()
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
    # Fire any extra-zone (approach ring) transitions FIRST — independent of the
    # home/not_home transition, and must fire even when the home state did NOT
    # change (e.g. crossing into "Near Home" while still outside the 150m home
    # ring). Without this, ping-derived approach crossings were computed by the
    # engine but never fired (only the OS-geofence path fired zones), so
    # Pre-cool missed on real drives whenever the OS home_near geofence failed
    # to deliver (Android OEM app-kill). Now pings are a reliable second path.
    try:
        schedule_zone_side_effects(decision)
    except Exception as exc:
        log_error(f"[Presence] zone side effects from ping failed: {exc}")

    if not decision.fired_transition:
        return
    new_state = decision.new_confirmed
    if new_state not in ("home", "not_home"):
        return
    try:
        # Skip the "arrived home" push when the approach ring (Pre-cool) fired
        # within the last 15 min — the user already got "the AC's cooling
        # things down"; a second buzz three minutes later is noise, and the
        # arrival itself is self-evident. Automations/broadcast still run.
        _skip_arrival_push = False
        if new_state == "home":
            import time as _time
            try:
                from services.zones_registry import APPROACH_ZONE_NAME as _AZN
            except Exception:
                _AZN = "Near Home"
            _skip_arrival_push = (
                _time.monotonic() - _LAST_ZONE_ENTER_FIRE.get(_AZN.lower(), 0.0) < 900
            )
        # Mirror household presence into HA. Ziggy's engine is the only thing
        # that knows this, and until it was published HA could not gate an
        # automation on it — so a compiled Leave Home ran on HA's weaker view
        # while Ziggy re-checked presence separately. Best-effort: a broker
        # hiccup must never block the transition itself.
        try:
            from services.presence_engine import is_all_away
            from services import presence_mqtt
            presence_mqtt.publish_state(anyone_home=not is_all_away())
        except Exception as exc:
            log_error(f"[Presence] household presence publish failed: {exc}")

        if not _skip_arrival_push:
            asyncio.create_task(_send_push(decision.person_name, new_state, decision.person_id))
        asyncio.create_task(_fire_automations(decision.person_name, new_state))
        asyncio.create_task(_broadcast_transition(decision.person_id, decision.person_name, new_state))
        # ARRIVAL FALLBACK — defense-in-depth for approach automations
        # (Pre-cool): if the user just arrived home and the approach ring
        # didn't fire within the last 30 min (phone dark the whole drive —
        # geofence dropped AND probes unanswered), fire it now. Late beats
        # never: the AC starts as they walk in instead of not at all.
        if new_state == "home":
            import time as _time
            try:
                from services.zones_registry import APPROACH_ZONE_NAME
            except Exception:
                APPROACH_ZONE_NAME = "Near Home"
            last = _LAST_ZONE_ENTER_FIRE.get(APPROACH_ZONE_NAME.lower(), 0.0)
            if _time.monotonic() - last > 1800:
                from services.presence_engine import ZoneTransition
                from datetime import datetime, timezone
                zt = ZoneTransition(
                    zone_id     = "arrival_fallback",
                    zone_name   = APPROACH_ZONE_NAME,
                    direction   = "entered",
                    ts          = datetime.now(timezone.utc),
                    person_id   = decision.person_id,
                    person_name = decision.person_name,
                    reason      = "arrival_fallback",
                )
                asyncio.create_task(_fire_zone_automation(zt))
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
