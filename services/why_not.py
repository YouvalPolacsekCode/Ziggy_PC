"""Why did X NOT happen — the negative causal question.

`cause_tracer` answers "what turned my light off". This answers "why did my
light not turn on when I walked in": it assembles, for one device, the four
facts that decide it — is the device reachable, which automations should have
acted on it and what their last runs say, what the room's occupancy sensors
were doing, and what Ziggy already tried — then ranks verdicts.

Two layers so it is testable without a home:
  gather_facts(entity_id, hours)  → dict of facts (I/O, best-effort)
  judge(facts)                    → ordered list of verdict codes (pure)
"""
from __future__ import annotations

import datetime as _dt
import json
from typing import Any, Optional

from core.logger_module import log_error

VERDICTS = (
    "device_unreachable",
    "sensor_latched",
    "sensor_silent",
    "automation_disabled",
    "automation_did_not_trigger",
    "automation_stopped_on_conditions",
    "automation_failed",
    "manual_override",
    "no_automation_for_device",
    "unknown",
)

_REACH_STALE_S = 15 * 60


def _iso_age_s(iso: Optional[str], now: Optional[_dt.datetime] = None) -> Optional[float]:
    if not iso:
        return None
    try:
        t = _dt.datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=_dt.timezone.utc)
        now = now or _dt.datetime.now(_dt.timezone.utc)
        return (now - t.astimezone(_dt.timezone.utc)).total_seconds()
    except Exception:
        return None


# ── fact gathering (I/O) ─────────────────────────────────────────────────────
def _device_facts(entity_id: str, cache: dict) -> dict:
    entry = cache.get(entity_id) or {}
    state = str(entry.get("state") or "")
    reported = entry.get("last_reported") or entry.get("last_updated")
    age = _iso_age_s(reported)
    reachable = state not in ("unavailable", "unknown", "") and (age is None or age < _REACH_STALE_S)
    last_intended = None
    try:
        from services import command_ledger
        last = command_ledger.get_last(entity_id) or {}
        last_intended = last.get("state")
    except Exception:
        pass
    return {"state": state, "reachable": reachable, "reported_age_s": age,
            "last_intended": last_intended, "last_changed": entry.get("last_changed")}


def _automation_mentions(auto: dict, entity_id: str) -> bool:
    for a in auto.get("actions") or []:
        if entity_id in json.dumps(a, ensure_ascii=False):
            return True
    trig = auto.get("trigger") or {}
    if entity_id in json.dumps(trig, ensure_ascii=False):
        return False  # triggered BY the device, not acting on it
    return False


def _automation_targets(entity_id: str) -> list[dict]:
    try:
        from services.ha_automations import list_automations, get_automation_for_ui
    except Exception:
        return []
    out: list[dict] = []
    try:
        autos = list_automations()
    except Exception as e:
        log_error(f"[why_not] list_automations: {e}")
        return []
    for a in autos:
        hit = _automation_mentions(a, entity_id)
        if not hit:
            # Ziggy saved actions may be empty for HA-native automations; read
            # the full config once for those.
            try:
                full = get_automation_for_ui(a.get("id")) or {}
                hit = entity_id in json.dumps(full.get("actions") or full.get("action") or [],
                                              ensure_ascii=False)
            except Exception:
                hit = False
        if hit:
            out.append({"id": a.get("id"), "name": a.get("name") or a.get("id"),
                        "enabled": bool(a.get("enabled", True)),
                        "last_triggered": a.get("last_triggered")})
    return out


def _runs_for(auto_id: str, hours: float) -> list[dict]:
    try:
        from services.ha_automations import get_automation_traces
        res = get_automation_traces(auto_id, limit=10)
        runs = res.get("runs") or []
    except Exception:
        return []
    keep = []
    for r in runs:
        age = _iso_age_s(r.get("started_at"))
        if age is None or age <= hours * 3600:
            keep.append({"status": r.get("status"), "started_at": r.get("started_at"),
                         "trigger": r.get("trigger_label")})
    return keep


def _room_of(entity_id: str, directory: dict | None) -> Optional[str]:
    if directory:
        for d in directory.get("devices") or []:
            if d.get("entity_id") == entity_id:
                return d.get("room")
    return None


def _room_sensor_facts(room: Optional[str], directory: dict | None, cache: dict,
                       active: dict) -> list[dict]:
    if not room or not directory:
        return []
    out = []
    for p in directory.get("presence") or []:
        if (p.get("room") or "") != room:
            continue
        eid = p["entity_id"]
        entry = cache.get(eid) or {}
        held = _iso_age_s(entry.get("last_changed"))
        anomalies = set()
        for key, entries in (active or {}).items():
            for e in entries or []:
                rid = e.get("rule_id")
                if rid in ("ANOM-10", "ANOM-12", "ANOM-13") and (key == eid or key == room):
                    anomalies.add(rid)
        out.append({"entity_id": eid, "state": p.get("state"), "held_s": held,
                    "reported_age_s": _iso_age_s(entry.get("last_reported") or entry.get("last_updated")),
                    "anomalies": sorted(anomalies)})
    return out


def _repairs(entity_ids: list[str]) -> list[dict]:
    try:
        from services import repair_ladder
    except Exception:
        return []
    out = []
    for eid in entity_ids:
        try:
            for h in repair_ladder.history(eid, limit=5) or []:
                out.append({"entity_id": eid, **{k: h.get(k) for k in ("rung", "outcome", "ts")}})
        except Exception:
            continue
    return out


def gather_facts(entity_id: str, hours: float = 3.0, *, directory: dict | None = None) -> dict:
    try:
        from services.ha_subscriber import state_cache, active_anomalies
        cache = dict(state_cache) if state_cache else {}
        active = dict(active_anomalies) if active_anomalies else {}
    except Exception:
        cache, active = {}, {}
    device = _device_facts(entity_id, cache)
    autos = _automation_targets(entity_id)
    for a in autos:
        a["runs"] = _runs_for(a["id"], hours)
    room = _room_of(entity_id, directory)
    sensors = _room_sensor_facts(room, directory, cache, active)
    occupancy = None
    try:
        from services.occupancy import engine as occ_engine  # optional
        snap = occ_engine.get_room(room) if room else None
        if snap is not None:
            occupancy = {"state": str(snap.state), "reason": snap.reason.description}
    except Exception:
        pass
    return {
        "entity_id": entity_id, "hours": hours, "room": room,
        "device": device, "automations": autos, "sensors": sensors,
        "occupancy": occupancy,
        "repairs": _repairs([entity_id] + [s["entity_id"] for s in sensors]),
    }


# ── judgement (pure) ─────────────────────────────────────────────────────────
def judge(facts: dict) -> list[str]:
    """Rank verdict codes, most likely first. Pure; see VERDICTS."""
    v: list[str] = []
    dev = facts.get("device") or {}
    if not dev.get("reachable", True):
        v.append("device_unreachable")
    for s in facts.get("sensors") or []:
        an = set(s.get("anomalies") or [])
        if "ANOM-12" in an and "sensor_latched" not in v:
            v.append("sensor_latched")
        if ("ANOM-10" in an or "ANOM-13" in an) and "sensor_silent" not in v:
            v.append("sensor_silent")
    autos = facts.get("automations") or []
    if not autos:
        v.append("no_automation_for_device")
    for a in autos:
        runs = a.get("runs") or []
        if not a.get("enabled", True):
            v.append("automation_disabled")
        elif not runs:
            v.append("automation_did_not_trigger")
        else:
            last = runs[0].get("status")
            if last == "stopped":
                v.append("automation_stopped_on_conditions")
            elif last == "failed":
                v.append("automation_failed")
    if dev.get("last_intended") and dev.get("state") and dev["last_intended"] != dev["state"] \
            and "device_unreachable" not in v:
        v.append("manual_override")
    # dedupe, keep order
    seen: set[str] = set()
    ordered = [x for x in v if not (x in seen or seen.add(x))]
    return ordered or ["unknown"]
