"""Make one device announce itself, so a human can say which room it's in.

A multi-split home onboards several air conditioners at once. They arrive
indistinguishable — same manufacturer, frequently the same reported name, no
room yet — and no amount of on-screen cleverness can tell the user which box
is the one in the kids' room. The device has to do something they can perceive.

An AC can't blink, so we use the only channel it has: it runs. A unit that was
off is switched on; a unit already running has its fan pushed to the loudest
mode it offers. The user hears it from the doorway, taps the room, and Ziggy
puts the unit back exactly as it was.

That restore is the dangerous part and the reason this lives in its own module
with its own tests. This executes in a customer's actual home — leaving a
bedroom AC roaring because a restore was skipped is worse than the problem it
solves. Restore therefore runs in a `finally`, and a unit the user had running
is never switched off.
"""
from __future__ import annotations

import asyncio

from services.home_automation import call_service, get_state
from core.logger_module import log_error, log_info

# How long the unit stays pulsed. Long enough to walk to the next room, short
# enough that a hub crash mid-pulse is a minor annoyance rather than a night
# of air conditioning nobody asked for.
DEFAULT_SECONDS = 20

# Loudest first — we want the most perceptible mode the unit actually offers,
# not a hardcoded "high" that some units don't have.
_FAN_PREFERENCE = ("highest", "high", "medium-high", "mediumHigh", "medium", "auto")


def _pick_loud_fan(attrs: dict, current: str | None) -> str | None:
    modes = attrs.get("fan_modes") or []
    for want in _FAN_PREFERENCE:
        for m in modes:
            if str(m).lower() == want.lower() and m != current:
                return m
    return None


async def _svc(domain: str, service: str, data: dict) -> None:
    await asyncio.to_thread(call_service, domain, service, data)


async def identify(entity_id: str, seconds: int = DEFAULT_SECONDS) -> dict:
    """Pulse one climate entity, then restore its exact prior settings.

    Raises ValueError for anything that isn't a known climate entity — this is
    not a general service-call escape hatch, it drives hardware in a home.
    """
    if not entity_id.startswith("climate."):
        raise ValueError("identify supports climate entities only")

    before = await asyncio.to_thread(get_state, entity_id)
    if not before or not before.get("state"):
        raise ValueError(f"unknown entity: {entity_id}")

    prior_state = before.get("state")
    attrs = before.get("attributes") or {}
    prior_fan = attrs.get("fan_mode")
    was_off = prior_state in ("off", "unavailable", "unknown")

    log_info(f"[Identify] pulsing {entity_id} for {seconds}s (was {prior_state})")

    try:
        if was_off:
            # Starting up is unmistakable; no need to touch anything else.
            await _svc("climate", "turn_on", {"entity_id": entity_id})
        else:
            # Already running — turning it "on" changes nothing a human can
            # notice, so make it louder instead.
            loud = _pick_loud_fan(attrs, prior_fan)
            if loud:
                await _svc("climate", "set_fan_mode",
                           {"entity_id": entity_id, "fan_mode": loud})
    except Exception as e:  # noqa: BLE001 — restore matters more than the cause
        log_error(f"[Identify] pulse failed for {entity_id}: {e}")
    finally:
        if seconds:
            await asyncio.sleep(seconds)
        await _restore(entity_id, was_off, prior_fan)

    return {"ok": True, "entity_id": entity_id, "seconds": seconds}


async def _restore(entity_id: str, was_off: bool, prior_fan: str | None) -> None:
    """Return the unit to how the user left it. Best-effort, never raises."""
    try:
        if was_off:
            await _svc("climate", "turn_off", {"entity_id": entity_id})
        elif prior_fan:
            # Only the fan was touched, so only the fan is restored — and we
            # deliberately never issue turn_off here: the user had it running.
            await _svc("climate", "set_fan_mode",
                       {"entity_id": entity_id, "fan_mode": prior_fan})
    except Exception as e:  # noqa: BLE001
        log_error(f"[Identify] RESTORE FAILED for {entity_id}: {e}")
