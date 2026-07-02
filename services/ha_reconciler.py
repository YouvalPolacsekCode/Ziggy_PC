"""
HA ↔ Ziggy KV reconciliation.

Ziggy caches metadata about the HA helpers it creates in a small file-backed
KV store (services.local_automation_actions). The canonical example is the
occupancy_sensors namespace: entry_id → {entity_id, name, sensors}. When a
user (or Ziggy) deletes the underlying HA config entry but the KV record isn't
cleared, the orphan lingers — it keeps surfacing on the Devices page as a smart
sensor that no longer exists (the known `test_bedroom` orphan).

This module compares the KV against HA's live config_entries and prunes records
whose HA entry is gone. It is deliberately CONSERVATIVE: if HA is unreachable or
returns nothing usable, it prunes NOTHING — we must never mistake "HA is down"
for "everything was deleted".

Two entry points:
  * reconcile_occupancy_sensors() — the actual pass (sync; safe off-thread).
  * maybe_reconcile_occupancy()   — throttled wrapper for hot paths like a
    Devices-page load, so repeated loads don't hammer HA's WS.

Cron: called hourly from services.ziggy_scheduler.run_scheduler().
"""
from __future__ import annotations

import asyncio
import time
from typing import Optional

from core.logger_module import log_info, log_error


def _live_config_entry_ids(timeout: float = 4.0) -> Optional[set[str]]:
    """Live HA config_entry ids via WS `config_entries/get`.

    Returns None (NOT an empty set) when HA is unreachable or returned nothing
    usable — the signal to callers that they must not prune. A real HA always
    has config entries, so an empty result is treated as "couldn't read".
    """
    try:
        from services.ha_client import ws as _ws

        async def _go() -> list[dict]:
            res, = await _ws({"type": "config_entries/get"}, timeout=timeout)
            if not isinstance(res, dict) or not res.get("success"):
                return []
            return res.get("result") or []

        try:
            entries = asyncio.run(_go())
        except RuntimeError:
            # Called from within a running loop — use a private one.
            loop = asyncio.new_event_loop()
            try:
                entries = loop.run_until_complete(_go())
            finally:
                loop.close()
    except Exception as e:
        log_error(f"[reconciler] could not fetch HA config_entries: {e}")
        return None

    ids = {e.get("entry_id") for e in entries
           if isinstance(e, dict) and e.get("entry_id")}
    return ids or None


def reconcile_occupancy_sensors() -> dict:
    """Prune occupancy_sensors KV records whose HA config entry no longer exists.

    Returns:
      {"ok": True,  "checked": int, "pruned": [{room, entry_id, entity_id}, ...]}
      {"ok": False, "reason": "ha_unreachable", "checked": 0, "pruned": []}
    """
    live = _live_config_entry_ids()
    if live is None:
        return {"ok": False, "reason": "ha_unreachable", "checked": 0, "pruned": []}

    from services.local_automation_actions import _load_state, set_local_state
    from services.template_sensors import _KV_NAMESPACE

    state = _load_state()
    rooms = (state.get(_KV_NAMESPACE) or {}) if isinstance(state, dict) else {}

    pruned: list[dict] = []
    checked = 0
    for room_slug, meta in list(rooms.items()):
        if not isinstance(meta, dict):
            continue
        entry_id = meta.get("entry_id")
        if not entry_id:
            continue
        checked += 1
        if entry_id not in live:
            set_local_state(_KV_NAMESPACE, room_slug, None)
            pruned.append({
                "room": room_slug,
                "entry_id": entry_id,
                "entity_id": meta.get("entity_id"),
            })

    if pruned:
        log_info(f"[reconciler] pruned {len(pruned)} orphan occupancy sensor(s): "
                 f"{[p['room'] for p in pruned]}")
    return {"ok": True, "checked": checked, "pruned": pruned}


# ── Throttle for hot-path triggers (e.g. Devices page load) ──────────────────
_last_reconcile_ts: float = 0.0
_RECONCILE_MIN_INTERVAL = 300.0  # seconds


def maybe_reconcile_occupancy(min_interval: float = _RECONCILE_MIN_INTERVAL) -> dict:
    """Run reconcile_occupancy_sensors at most once per `min_interval`.

    Cheap to call repeatedly: the throttle check short-circuits before any HA
    round-trip. Intended for the Devices-page-load trigger where many mounts can
    happen in quick succession.
    """
    global _last_reconcile_ts
    now = time.time()
    if now - _last_reconcile_ts < min_interval:
        return {"ok": True, "skipped": "throttled", "checked": 0, "pruned": []}
    _last_reconcile_ts = now
    return reconcile_occupancy_sensors()
