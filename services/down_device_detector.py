"""Proactive down-device detector.

Finds controllable devices that have gone silent — the fixer noticing a problem on
its own instead of waiting to be asked. Proven on the Canary (2026-08-28): a bulb
was off the network 13 days before anyone noticed; a scan found three more.

Hard-won rules (see docs plan "Field-test lessons"):
- Reachability = HA ``last_reported`` (moves on ANY report), NOT ``last_updated``
  (moves only on a state change → a reachable-but-unchanged device looks silent).
- Filter config/diagnostic sub-entities and treat a media_player ``unavailable`` as
  "off", not down — or the scan drowns in false positives.
- The verdict is provisional: a silent device can self-recover, so callers should
  re-check before nagging.
"""
from __future__ import annotations

import datetime
from typing import Callable, Optional

# Domains a user actually controls — the only "device down" candidates.
_CONTROLLABLE = ("light", "switch", "climate", "fan", "cover", "lock",
                 "media_player", "vacuum", "humidifier", "water_heater")

# Config/diagnostic sub-entity suffixes that never change and aren't devices.
_CONFIG_SUFFIXES = (
    "_do_not_disturb", "_child_lock", "_ai_sensitivity", "_permit_join",
    "_led_disabled_night", "_auto_close_when_water_shortage", "_identify",
    "_power_on_behavior", "_interference_source_selfidentification",
    "_ai_interference_source_selfidentification",
)


def _parse(ts: Optional[str]) -> Optional[datetime.datetime]:
    if not ts:
        return None
    try:
        return datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        return None


def scan_down_devices(states: list[dict], now: datetime.datetime, *,
                      stale_hours: float = 48.0,
                      should_hide: Optional[Callable[[str], bool]] = None) -> list[dict]:
    """Return controllable devices silent longer than ``stale_hours``, worst first.

    Each item: ``{entity_id, name, domain, state, silent_hours}``. ``should_hide``
    (e.g. entity_filter._should_hide) removes config/system entities; a suffix
    denylist is applied as a backstop.
    """
    hide = should_hide or (lambda _e: False)
    out: list[dict] = []
    for s in states or []:
        eid = s.get("entity_id") or ""
        domain = eid.split(".", 1)[0] if "." in eid else eid
        if domain not in _CONTROLLABLE:
            continue
        if hide(eid) or any(eid.endswith(sfx) for sfx in _CONFIG_SUFFIXES):
            continue
        state = s.get("state")
        # A TV/media_player is 'unavailable' simply because it's off — not down.
        if domain == "media_player" and state == "unavailable":
            continue
        ts = _parse(s.get("last_reported")) or _parse(s.get("last_updated"))
        if ts is None:
            continue
        silent_h = (now - ts).total_seconds() / 3600.0
        if silent_h <= stale_hours:
            continue
        out.append({
            "entity_id": eid,
            "name": (s.get("attributes") or {}).get("friendly_name") or eid,
            "domain": domain,
            "state": state,
            "silent_hours": round(silent_h, 1),
        })
    out.sort(key=lambda d: d["silent_hours"], reverse=True)
    return out


def find_down_devices(stale_hours: float = 48.0) -> list[dict]:
    """Live scan: pull current HA states and flag the silent controllable devices."""
    from services.home_automation import get_all_states
    try:
        from services.entity_filter import _should_hide
    except Exception:
        _should_hide = None
    states = get_all_states() or []
    now = datetime.datetime.now(datetime.timezone.utc)
    return scan_down_devices(states, now, stale_hours=stale_hours, should_hide=_should_hide)
