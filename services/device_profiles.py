"""
Device profiles — the curated/crowd-sourced classification catalog.

A profile recognises a *kind* of device Ziggy has seen before and declares how
its card should read: which entity is MAIN, what card_kind renders, and each
entity's role. It is the middle layer:

    user override (device_overrides)  >  profile (here)  >  heuristic (device_groups)

Matching is by ENTITY-SHAPE FINGERPRINT — a set of required entity-id
substrings + domains — so it works for any brand of a device class without
needing every model enumerated (a Tuya, Giex, or Aqara irrigation valve all
expose `switch.<id>` + `*_irrigation_*` + `*_flow`). Profiles can also match
by HA model when that's available.

`entity_roles` uses SUBSTRING keys matched against each entity's object_id, so
one rule covers every brand's naming. `main` is the object_id substring (or a
bare `domain:` marker) that identifies the control entity.

This seed catalog is intentionally small; user corrections (device_overrides)
are the scalable path and can be promoted here later. Adding a profile is pure
data — no logic changes.
"""
from __future__ import annotations

from typing import Optional

# Each profile:
#   name         : human id
#   card_kind    : the card the frontend should render
#   any_of       : entity-id substrings; ALL must appear somewhere in the group
#   main         : "domain:switch:bare" | "suffix:<substr>" — how to find MAIN
#   roles        : ordered (substring, role) — first match wins per entity
_PROFILES: list[dict] = [
    {
        "name": "irrigation_valve",
        "card_kind": "irrigation",
        # Fingerprint: a controllable switch + irrigation/flow telemetry.
        "any_of": ["irrigation", "flow"],
        "require_domain": "switch",
        "main": "domain:switch:bare",   # the bare valve switch, not a config toggle
        "roles": [
            ("_battery", "diagnostic"),
            ("_linkquality", "diagnostic"),
            ("_signal", "diagnostic"),
            ("current_device_status", "diagnostic"),
            ("_start_time", "diagnostic"),
            ("_end_time", "diagnostic"),
            ("valve_work_state", "diagnostic"),
            ("update", "diagnostic"),
            ("auto_close", "config"),
            ("cyclic_", "config"),
            ("_flow", "metric"),
            ("daily_irrigation_volume", "metric"),
            ("real_time_irrigation_volume", "metric"),
            ("real_time_irrigation_duration", "metric"),
        ],
    },
]


def _object_id(entity_id: str) -> str:
    return (entity_id or "").split(".", 1)[-1].lower()


def match_profile(rows: list[dict]) -> Optional[dict]:
    """Return the best profile matching this device group, or None.

    A profile matches when every `any_of` substring appears in some entity's
    object_id AND (if set) at least one entity has `require_domain`.
    """
    oids = [_object_id(r.get("entity_id") or "") for r in rows if r.get("entity_id")]
    domains = {(r.get("domain") or "").lower() for r in rows}
    if not oids:
        return None
    for prof in _PROFILES:
        need = prof.get("any_of") or []
        if not all(any(sub in o for o in oids) for sub in need):
            continue
        req_dom = prof.get("require_domain")
        if req_dom and req_dom not in domains:
            continue
        return prof
    return None


def profile_main_entity(prof: dict, rows: list[dict]) -> Optional[str]:
    """Resolve the profile's MAIN rule to a concrete entity_id in this group."""
    rule = prof.get("main") or ""
    if rule.startswith("domain:"):
        parts = rule.split(":")
        dom = parts[1] if len(parts) > 1 else ""
        bare = len(parts) > 2 and parts[2] == "bare"
        cands = [r for r in rows if (r.get("domain") or "").lower() == dom and r.get("entity_id")]
        if not cands:
            return None
        if bare:
            # shortest object_id (fewest tokens) = the bare control, no suffix
            cands.sort(key=lambda r: (len(_object_id(r["entity_id"]).split("_")), r["entity_id"]))
        else:
            cands.sort(key=lambda r: r["entity_id"])
        return cands[0]["entity_id"]
    if rule.startswith("suffix:"):
        sub = rule.split(":", 1)[1]
        for r in rows:
            if sub in _object_id(r.get("entity_id") or ""):
                return r.get("entity_id")
    return None


def profile_role_for(prof: dict, entity_id: str) -> Optional[str]:
    """First matching role rule for an entity, or None (fall through to heuristic)."""
    oid = _object_id(entity_id)
    for sub, role in prof.get("roles") or []:
        if sub in oid:
            return role
    return None
