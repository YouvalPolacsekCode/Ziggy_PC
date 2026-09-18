"""Bundle lint — what a designed bundle may NOT contain, enforced after the model.

Everything here is a shape the chat designer actually produced on 2026-09-18
in the operator's own home:

  * a condition that restates its own trigger (`X turns on` if `X is on`);
  * an "everything off" that reached into rooms nobody mentioned;
  * a rule whose only action was a notification, named as if it did something;
  * two flags nothing read (the schema no longer has flags; strip legacy ones);
  * a blueprint fed a UUID where an entity id belongs (the hallucination guard
    only checked dotted strings).

The lint is pure and never raises. It drops what cannot be honest and returns
notes so the preview card can say "Left out: …" instead of silently shipping a
smaller bundle than it announced.
"""
from __future__ import annotations

import re
from typing import Iterable, Optional

_ENTITY_RE = re.compile(r"^[a-z_]+\.[A-Za-z0-9_]+$")
_ENTITY_INPUT_KEYS = ("_entity", "_target", "_sensor", "_light", "_switch")
_LEGACY_KINDS = ("kv_state", "voice_intents")


def _entity_room_index(home: dict) -> dict[str, str]:
    idx: dict[str, str] = {}
    for r in home.get("rooms") or []:
        slug = str(r.get("id") or "").lower()
        for bucket, items in (r.get("entities") or {}).items():
            if not isinstance(items, list):
                continue
            for e in items:
                if isinstance(e, dict) and e.get("entity_id"):
                    idx[e["entity_id"]] = slug
        occ = r.get("occupancy_sensor")
        if isinstance(occ, dict) and occ.get("entity_id"):
            idx[occ["entity_id"]] = slug
    return idx


def _trigger_entities(trigger: dict) -> list[str]:
    eid = (trigger or {}).get("entity_id")
    if isinstance(eid, list):
        return [str(x) for x in eid]
    return [str(eid)] if eid else []


def _is_tautology(cond: dict, trigger: dict) -> bool:
    """`if X is <trigger state>` where X is the trigger entity."""
    if not isinstance(cond, dict) or cond.get("type") not in (None, "entity", "state"):
        return False
    if cond.get("entity_id") not in _trigger_entities(trigger):
        return False
    op = cond.get("operator", "is")
    if op != "is":
        return False
    return str(cond.get("value", "on")) == str((trigger or {}).get("state", "on"))


def _real_effect(actions: Iterable[dict]) -> bool:
    """A rule must do something a person can perceive besides a notification."""
    for a in actions or []:
        if (a or {}).get("type", "call_service") != "notify":
            return True
    return False


def lint(bundle: dict, home: dict, *, allowed_rooms: Optional[set] = None) -> tuple[dict, list[dict]]:
    """Return (linted bundle, notes). Notes are {"what", "why"} in English —
    the designer's own `left_out` list carries the user-facing language."""
    notes: list[dict] = []
    if not isinstance(bundle, dict):
        return bundle, notes
    arts = bundle.get("artifacts")
    if not isinstance(arts, dict):
        return bundle, notes

    for kind in _LEGACY_KINDS:
        if kind in arts:
            if arts.get(kind):
                notes.append({"what": kind, "why": "not something Ziggy creates any more"})
            arts.pop(kind, None)

    room_of = _entity_room_index(home)
    allowed = {str(r).lower() for r in (allowed_rooms or set())}
    kept: list[dict] = []
    for auto in arts.get("automations") or []:
        if not isinstance(auto, dict):
            continue
        name = str(auto.get("name") or "automation")

        if auto.get("source") == "blueprint":
            bp = auto.get("blueprint") or {}
            bad = [k for k, v in (bp.get("inputs") or {}).items()
                   if any(k.endswith(s) for s in _ENTITY_INPUT_KEYS)
                   and isinstance(v, str) and not _ENTITY_RE.match(v)]
            if bad:
                notes.append({"what": name, "why": f"needs a real device for {', '.join(bad)}"})
                continue
            kept.append(auto)
            continue

        trigger = auto.get("trigger") or {}
        conds = [c for c in (auto.get("conditions") or []) if not _is_tautology(c, trigger)]
        auto["conditions"] = conds

        trig_rooms = {room_of.get(e) for e in _trigger_entities(trigger)} - {None}
        scope = allowed | trig_rooms
        actions: list[dict] = []
        for a in auto.get("actions") or []:
            if not isinstance(a, dict):
                continue
            eid = a.get("entity_id")
            if scope and eid and room_of.get(eid) and room_of[eid] not in scope:
                pretty = room_of[eid].replace("_", " ")
                notes.append({"what": f"{name}: {eid}", "why": f"the {pretty} wasn't part of what you asked for"})
                continue
            actions.append(a)
        auto["actions"] = actions

        if not actions:
            notes.append({"what": name, "why": "nothing left for it to do"})
            continue
        if not _real_effect(actions):
            notes.append({"what": name, "why": "a notification on its own isn't an automation"})
            continue
        kept.append(auto)
    arts["automations"] = kept
    return bundle, notes
