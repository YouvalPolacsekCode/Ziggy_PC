"""
Command Ledger — records Ziggy's last *intended* command per entity.

Purpose: give the self-heal engine a way to correlate "Ziggy commanded state X"
with "the device reported state Y a moment later". This is deliberately a tiny,
standalone module with NO imports of home_automation / self_heal / ha_subscriber
so it can be written from the command path and read from the detector without
creating an import cycle.

This is separate from `services.manual_overrides` on purpose: manual_overrides
tracks a 5 s "Ziggy just touched this" hint whose semantics feed manual-override
detection, and changing it would alter that behaviour. The ledger instead keeps
a slightly longer record of *what state Ziggy asked for* and *who asked* (origin),
which is what self-heal needs.

Storage: in-memory only. A command record is a short-lived hint, not user data;
losing it on restart is fine.
"""
from __future__ import annotations

import threading
import time

# How long a command record stays correlatable (seconds). Must comfortably
# exceed the self-heal revert window so a spurious revert can be attributed to
# the command that preceded it.
DEFAULT_TTL = 30.0

# Origins. Only "self_heal" is load-bearing (it is the loop guard — self-heal's
# own commands must never count as evidence of flakiness). The rest are
# informational.
ORIGIN_ZIGGY = "ziggy"
ORIGIN_SELF_HEAL = "self_heal"

_last: dict[str, dict] = {}   # entity_id → {"state", "origin", "ts"}
_lock = threading.Lock()


def record(entity_id: str, intended_state: str | None, origin: str = ORIGIN_ZIGGY,
           ttl: float | None = None) -> None:
    """Record that Ziggy just commanded `entity_id` toward `intended_state`.

    `intended_state` is the normalised target ("on"/"off"/…), or None when the
    command has no unambiguous target (skip recording in that case).
    """
    if not entity_id or intended_state is None:
        return
    exp = time.time() + (ttl if ttl is not None else DEFAULT_TTL)
    with _lock:
        _last[entity_id] = {
            "state": intended_state,
            "origin": origin or ORIGIN_ZIGGY,
            "ts": time.time(),
            "_exp": exp,
        }


def get_last(entity_id: str) -> dict | None:
    """Return the last intended command for `entity_id`, or None if none/expired.

    Returned dict: {"state", "origin", "ts"} (the internal expiry key is stripped).
    """
    if not entity_id:
        return None
    now = time.time()
    with _lock:
        rec = _last.get(entity_id)
        if not rec:
            return None
        if rec["_exp"] < now:
            _last.pop(entity_id, None)
            return None
        return {"state": rec["state"], "origin": rec["origin"], "ts": rec["ts"]}


def clear(entity_id: str) -> None:
    with _lock:
        _last.pop(entity_id, None)
