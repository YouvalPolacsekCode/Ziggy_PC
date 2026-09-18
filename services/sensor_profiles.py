"""Ziggy sensor profiles — one-time tuning of radios Ziggy knows well.

Why this exists (Canary office, 2026-09-17): the Aqara FP300 presence sensor
(Zigbee2MQTT model PS-S04D) pairs with `absence_delay_timer` = 10 s — the radar
gives up on a still person after ten seconds, and a battery-powered radar that
is PIR-gated then behaves like a plain PIR. Every "the lights went off on me"
report traced back to that one number. 120 s was the fix on the Canary; this
module makes it the default for every FP300 Ziggy ever sees — the kits we
pre-pair and the sensors a customer adds later — without a per-home visit.

The catch: the FP300 sleeps, and a sleeping Zigbee end device does not take
writes. It listens for a split second after it *speaks*. So the profile is
applied opportunistically: the moment the device reports anything (presence or
PIR edge, seen by ha_subscriber), Ziggy checks the timer and, if it is below
the profile value, writes it — the same wake-and-write trick that landed the
Canary change. Applied ONCE per device and recorded; a value the owner later
lowers on purpose is respected forever (`done` never re-arms).

Kept deliberately small: no MQTT of its own, no polling, no device registry
lookups. The FP300 is recognised by its entity shape — a
`number.<ieee>_absence_delay_timer` next to a `binary_sensor.<ieee>_pir_detection`.
"""
from __future__ import annotations

import asyncio
import time
from typing import Callable, Optional

from core.logger_module import log_error, log_info
from core.settings_loader import settings
from services.local_automation_actions import get_local_state, set_local_state

_KV = "sensor_profiles"
FP300_ABSENCE_DELAY_S = 120        # the Canary-validated hold
_MAX_ATTEMPTS = 5                  # then leave it alone (something else is wrong)
_RETRY_S = 60                      # don't hammer a device that reports in bursts
_REPORT_SUFFIXES = ("_presence", "_pir_detection")

# In-memory "already handled" set so a done device costs no file read per report.
_settled: set[str] = set()


def _cfg() -> dict:
    return settings.get("sensor_profiles", {}) or {}


def enabled() -> bool:
    return bool(_cfg().get("enabled", True))


def fp300_absence_delay_s() -> int:
    try:
        return int(_cfg().get("fp300_absence_delay_s", FP300_ABSENCE_DELAY_S))
    except Exception:
        return FP300_ABSENCE_DELAY_S


def fp300_ieee(entity_id: str) -> Optional[str]:
    """The device address if `entity_id` is one of an FP300's report entities."""
    if not entity_id.startswith("binary_sensor."):
        return None
    obj = entity_id.split(".", 1)[1]
    for sfx in _REPORT_SUFFIXES:
        if obj.endswith(sfx) and len(obj) > len(sfx):
            return obj[: -len(sfx)]
    return None


def timer_entity(ieee: str) -> str:
    return f"number.{ieee}_absence_delay_timer"


def _pir_entity(ieee: str) -> str:
    return f"binary_sensor.{ieee}_pir_detection"


def _default_set_value(entity_id: str, value: int) -> bool:
    from services import home_automation as ha
    res = ha.call_service("number", "set_value",
                          {"entity_id": entity_id, "value": value},
                          origin="sensor_profile")
    return bool(res.get("ok"))


def on_device_report(entity_id: str, cache: dict, *,
                     now: Optional[float] = None,
                     set_value: Optional[Callable[[str, int], bool]] = None) -> str:
    """Decide and (maybe) act on one report from a device. Returns the outcome,
    one of: ignored, disabled, already, done, skipped, exhausted, sent, failed.

    Pure apart from the KV record and the injected `set_value` — testable."""
    ieee = fp300_ieee(entity_id)
    if not ieee:
        return "ignored"
    if ieee in _settled:
        return "already"
    if not enabled():
        return "disabled"
    timer = cache.get(timer_entity(ieee))
    if not timer or _pir_entity(ieee) not in cache:
        return "ignored"                    # not an FP300 (or not fully discovered yet)

    rec = get_local_state(_KV, ieee) or {}
    if rec.get("done"):
        _settled.add(ieee)
        return "already"
    try:
        current = float(timer.get("state"))
    except (TypeError, ValueError):
        return "ignored"                    # unavailable / unknown — wait for a real value

    now = time.time() if now is None else now
    target = fp300_absence_delay_s()
    if current >= target:
        # Either our write landed, or the owner already set something sane.
        set_local_state(_KV, ieee, {**rec, "done": True, "value": current,
                                    "target": target, "settled_at": now})
        _settled.add(ieee)
        if rec.get("attempts"):
            log_info(f"[SensorProfile] FP300 {ieee}: absence timer now {int(current)}s "
                     f"(was {rec.get('from')}s) — profile applied")
        return "done"

    attempts = int(rec.get("attempts", 0))
    if attempts >= _MAX_ATTEMPTS:
        return "exhausted"
    if now - float(rec.get("last_attempt", 0)) < _RETRY_S:
        return "skipped"

    ok = False
    try:
        ok = (set_value or _default_set_value)(timer_entity(ieee), target)
    except Exception as e:
        log_error(f"[SensorProfile] FP300 {ieee}: write failed: {e}")
    set_local_state(_KV, ieee, {**rec, "attempts": attempts + 1, "last_attempt": now,
                                "from": rec.get("from", current), "target": target})
    log_info(f"[SensorProfile] FP300 {ieee}: absence timer {int(current)}s → {target}s "
             f"(attempt {attempts + 1}, {'sent' if ok else 'not acked'})")
    return "sent" if ok else "failed"


async def on_device_report_async(entity_id: str, cache: dict) -> str:
    """ha_subscriber entry point: never block the event loop on HA's REST."""
    return await asyncio.to_thread(on_device_report, entity_id, cache)
