""""Turn it on for N minutes" — one action step with a duration.

A step like `{"type": "call_service", "entity_id": "switch.valve",
"service": "homeassistant.turn_on", "for_minutes": 20}` is stored as ONE step
(that is what the wizard edits and the user reads), and expanded to
on → wait → off wherever steps are compiled or run. Expansion is the single
definition both evaluators share: `ha_automations` compiles the expanded list
to HA, the local executor runs it, and the HA-deferred bridge filters it.

The wait is a plain delay, so it dies with the process running it — an HA or
hub restart mid-wait would leave a garden valve open all night. The safety net
below records every timed step when its automation fires and, once the
deadline has clearly passed, turns the device off if it is still on and nobody
has touched it since. It never acts on a device that changed after the
deadline (the person turned it on again themselves) or on a run still going.
"""
from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime
from typing import Optional

# On-service → the service that undoes it. Only these get a duration: an "off"
# for a lock, a script or a set-temperature has no safe meaning.
_UNDO = {
    "turn_on": "turn_off",
    "open_cover": "close_cover",
    "open_valve": "close_valve",
}
# Domains where "on" has nothing to undo (a script runs and is done).
_NO_DURATION_DOMAINS = {"script", "scene", "automation", "button", "input_button"}

MAX_MINUTES = 24 * 60
GRACE_S = 120          # past the deadline before the safety net steps in
FORGET_AFTER_S = 86400 # a record this old is history, not a pending off

STORE_FILE = "user_files/timed_actions.json"
_lock = threading.Lock()


def _service_name(step: dict) -> str:
    return str(step.get("service") or "").split(".")[-1]


def undo_service(step: dict) -> Optional[str]:
    """The HA service that ends this step, or None when it can't take a duration."""
    if not isinstance(step, dict) or step.get("type", "call_service") != "call_service":
        return None
    eid = str(step.get("entity_id") or "")
    if "." not in eid or eid.split(".")[0] in _NO_DURATION_DOMAINS:
        return None
    return _UNDO.get(_service_name(step))


def minutes_of(step: dict) -> Optional[float]:
    """The step's duration in minutes, or None when it has none (or can't have one)."""
    if undo_service(step) is None:
        return None
    raw = step.get("for_minutes")
    if raw in (None, "", 0):
        return None
    try:
        mins = float(raw)
    except (TypeError, ValueError):
        return None
    if mins <= 0:
        return None
    return min(mins, MAX_MINUTES)


def invalid_reason(steps) -> Optional[str]:
    """A user-facing error for a duration that can't work, or None."""
    for s in steps or []:
        if not isinstance(s, dict) or s.get("for_minutes") in (None, "", 0):
            continue
        try:
            mins = float(s.get("for_minutes"))
        except (TypeError, ValueError):
            return "“For how long” must be a number of minutes."
        if mins <= 0:
            return "“For how long” must be more than 0 minutes."
        if mins > MAX_MINUTES:
            return "“For how long” can be at most 24 hours."
        if undo_service(s) is None:
            return "Only a “turn on” or “open” step can have “for how long”."
    return None


def expand(steps) -> list:
    """Timed steps → on, wait, off. Untimed steps pass through untouched.

    Idempotent: the expanded steps carry no `for_minutes`, so expanding twice
    is the same as once.
    """
    out: list = []
    for s in steps or []:
        mins = minutes_of(s) if isinstance(s, dict) else None
        if mins is None:
            if isinstance(s, dict) and "for_minutes" in s and s.get("type", "call_service") == "call_service":
                s = {k: v for k, v in s.items() if k != "for_minutes"}
            out.append(s)
            continue
        on = {k: v for k, v in s.items() if k != "for_minutes"}
        domain = on.get("service", "homeassistant.turn_on").split(".")[0] or "homeassistant"
        off = {"type": "call_service", "entity_id": on.get("entity_id"),
               "service": f"{domain}.{undo_service(s)}"}
        out += [on, {"type": "delay", "seconds": int(round(mins * 60))}, off]
    return out


# ── Safety net ────────────────────────────────────────────────────────────────

def _load() -> list:
    try:
        with open(STORE_FILE, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save(items: list) -> None:
    os.makedirs(os.path.dirname(STORE_FILE), exist_ok=True)
    tmp = STORE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    os.replace(tmp, STORE_FILE)


def _step_seconds(s: dict) -> float:
    if s.get("type") == "delay":
        return max(0, int(s.get("seconds", s.get("delay_seconds", 0)) or 0))
    if s.get("type") == "wait_for_state":
        return max(0, int(s.get("timeout_seconds") or 0))
    return 0


def deadlines(steps, started_at: float) -> list:
    """When each timed step's off is due, if the run went as written."""
    out: list = []
    elapsed = 0.0
    for s in steps or []:
        if not isinstance(s, dict):
            continue
        mins = minutes_of(s)
        if mins is not None:
            elapsed += mins * 60
            eid = str(s.get("entity_id"))
            out.append({"entity_id": eid, "service": f"{eid.split('.')[0]}.{undo_service(s)}",
                        "deadline": started_at + elapsed})
        else:
            elapsed += _step_seconds(s)
    return out


def note_fired(automation_id: str, steps, started_at: Optional[float] = None) -> int:
    """Record the offs this run owes. Returns how many were recorded."""
    started_at = time.time() if started_at is None else started_at
    due = deadlines(steps, started_at)
    if not due:
        return 0
    with _lock:
        items = [i for i in _load()
                 if not (i.get("automation_id") == automation_id and i.get("entity_id")
                         in {d["entity_id"] for d in due})]
        for d in due:
            items.append({**d, "automation_id": automation_id, "started_at": started_at})
        _save(items)
    return len(due)


def _ts(value) -> Optional[float]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def _still_running(automation_id: str, state_cache: dict) -> bool:
    try:
        from services.local_automation_actions import _running_automations
        if automation_id in _running_automations:
            return True
    except Exception:
        pass
    for eid, entry in (state_cache or {}).items():
        if not eid.startswith("automation."):
            continue
        attrs = entry.get("attributes") or {}
        if (attrs.get("id") or eid[len("automation."):]) == automation_id:
            return int(attrs.get("current") or 0) > 0
    return False


_OFF_STATES = {"off", "closed", "closing", "unavailable", "unknown"}


def due_offs(now: Optional[float] = None, state_cache: Optional[dict] = None) -> tuple[list, list]:
    """(offs to send now, records to keep). Pure — no HA calls, no file writes."""
    now = time.time() if now is None else now
    if state_cache is None:
        try:
            from services.ha_subscriber import state_cache as _sc
            state_cache = dict(_sc or {})
        except Exception:
            state_cache = {}
    send, keep = [], []
    for item in _load():
        deadline = float(item.get("deadline") or 0)
        if now > deadline + FORGET_AFTER_S:
            continue
        if now < deadline + GRACE_S:
            keep.append(item)
            continue
        entry = state_cache.get(item.get("entity_id") or "")
        if entry is None:
            keep.append(item)       # cache cold — decide on a later tick
            continue
        if str(entry.get("state")) in _OFF_STATES:
            continue                # the off happened; nothing owed
        changed = _ts(entry.get("last_changed"))
        if changed is not None and changed > deadline:
            continue                # touched after the deadline — the person's choice
        if _still_running(item.get("automation_id", ""), state_cache):
            keep.append(item)
            continue
        send.append(item)
    return send, keep


def sweep() -> list:
    """Turn off anything a timed step left on past its deadline. Returns what it sent."""
    from core.logger_module import log_info, log_error
    from services.home_automation import call_service as ha_call
    sent: list = []
    with _lock:
        before = _load()
        send, keep = due_offs()
        for item in send:
            domain, svc = item["service"].split(".", 1)
            try:
                res = ha_call(domain, svc, {"entity_id": item["entity_id"]})
                ok = not isinstance(res, dict) or res.get("ok", True)
            except Exception as e:
                ok = False
                log_error(f"[TimedActions] safety off for {item['entity_id']} failed: {e}")
            if ok:
                sent.append(item)
                log_info(f"[TimedActions] {item['entity_id']} still on past its "
                         f"{item.get('automation_id')} timer — sent {item['service']}")
            else:
                keep.append(item)   # try again next tick
        if keep != before:
            _save(keep)
    return sent
