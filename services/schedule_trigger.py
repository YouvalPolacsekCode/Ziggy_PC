"""Schedule triggers — the `time` trigger with days and several times a day.

    {"type": "time", "time": "07:00"}                                 every day at 07:00
    {"type": "time", "time": "07:00", "times": ["07:00", "19:30"],
     "days": ["sun", "mon", "tue", "wed", "thu"]}                    Sun–Thu at 07:00 and 19:30

Backwards compatible by construction:
  * `days` absent (or None) means every day — exactly what every rule saved
    before 2026-10-31 meant.
  * `times` is optional; `time` always carries the first one, so code that
    only knows the single `time` field (bundle previews, older apps, the
    catalog) still reads a valid, true value.

One definition for every reader: the scheduler that fires the rule, the save
guard, the HA converter and the chat agent.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Optional

# HA's own weekday codes, Monday first (datetime.weekday(): 0 = Monday).
DAY_CODES: tuple[str, ...] = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")

_ALIASES = {
    **{c: c for c in DAY_CODES},
    "monday": "mon", "tuesday": "tue", "wednesday": "wed", "thursday": "thu",
    "friday": "fri", "saturday": "sat", "sunday": "sun",
    "tues": "tue", "wed.": "wed", "thur": "thu", "thurs": "thu",
}
_HHMM = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$")


def _hhmm(v: Any) -> Optional[str]:
    m = _HHMM.match(str(v or "").strip())
    return f"{int(m.group(1)):02d}:{m.group(2)}" if m else None


def trigger_times(trigger: dict) -> list[str]:
    """Every valid HH:MM this trigger fires at, in order, de-duplicated."""
    t = trigger or {}
    raw = t.get("times") if isinstance(t.get("times"), (list, tuple)) and t.get("times") else [t.get("time")]
    out: list[str] = []
    for v in raw:
        h = _hhmm(v)
        if h and h not in out:
            out.append(h)
    return sorted(out)


def normalize_days(value: Any) -> Optional[list[str]]:
    """None = every day. Otherwise the valid day codes, Monday-first order.

    Unknown entries are dropped; a list that had entries but none valid comes
    back as [] so the save guard can say so instead of silently meaning
    "every day".
    """
    if value is None:
        return None
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, (list, tuple)):
        return []
    picked = set()
    for v in value:
        if isinstance(v, int) and 0 <= v <= 6:
            picked.add(DAY_CODES[v])
            continue
        code = _ALIASES.get(str(v or "").strip().lower())
        if code:
            picked.add(code)
    return [c for c in DAY_CODES if c in picked]


def trigger_days(trigger: dict) -> Optional[list[str]]:
    days = normalize_days((trigger or {}).get("days"))
    # All seven picked is the same rule as "every day"; say it the simple way.
    return None if days is not None and len(days) == 7 else days


def invalid_reason(trigger: dict) -> Optional[str]:
    """Why this schedule could never fire, or None."""
    if not trigger_times(trigger):
        return "This automation has no time set, so it would never run. Set a time."
    if "days" in (trigger or {}) and (trigger or {}).get("days") is not None and not normalize_days(trigger["days"]):
        return "This automation has no days picked, so it would never run. Pick at least one day."
    return None


def fires_at(trigger: dict, now: datetime) -> bool:
    """True when this schedule is due in the minute `now` falls in."""
    if f"{now.hour:02d}:{now.minute:02d}" not in trigger_times(trigger):
        return False
    days = trigger_days(trigger)
    return days is None or DAY_CODES[now.weekday()] in days


def normalized(trigger: dict) -> dict:
    """The trigger in canonical stored form. Leaves an old single-time,
    every-day rule byte-for-byte as it was."""
    t = dict(trigger or {})
    times = trigger_times(t)
    if times:
        t["time"] = times[0]
    if len(times) > 1:
        t["times"] = times
    else:
        t.pop("times", None)
    if "days" in t:
        days = trigger_days(t)
        if days is None:
            t.pop("days")
        else:
            t["days"] = days
    return t
