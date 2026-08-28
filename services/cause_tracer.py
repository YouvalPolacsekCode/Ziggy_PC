"""Causal trace — identify what caused a device to change.

HA's logbook stamps each state change with a *context* pointing at its cause. This
turns that into a plain classification (automation / person / device / unknown) so
the fixer can answer "what turned my lights off?" from data that already exists.
Read-only.
"""
from __future__ import annotations

import datetime
from typing import Optional

_AUTOMATION_DOMAINS = ("automation", "script")


def _humanize(ref: str) -> str:
    obj = ref.split(".", 1)[-1] if "." in ref else ref
    return obj.replace("_", " ").strip().title() if obj else ref


def _classify_cause(e: dict) -> dict:
    """Map a logbook entry's context → {cause_kind, cause_name}."""
    cdom = (e.get("context_domain") or "")
    cent = (e.get("context_entity_id") or "")
    # Automation / routine / script fired it.
    if cdom in _AUTOMATION_DOMAINS or cent.startswith(("automation.", "script.")):
        name = (e.get("context_name") or e.get("context_entity_id_name")
                or (_humanize(cent) if cent else None))
        return {"cause_kind": "automation", "cause_name": name}
    # A person did it (app / voice / physical with a user context).
    if e.get("context_user_id"):
        return {"cause_kind": "person", "cause_name": None}
    # Another device/sensor triggered it directly.
    if cent:
        return {"cause_kind": "device",
                "cause_name": e.get("context_entity_id_name") or _humanize(cent)}
    return {"cause_kind": "unknown", "cause_name": None}


def explain_change(entries: list[dict], entity_id: str, *,
                   action: Optional[str] = None) -> Optional[dict]:
    """Find the most recent relevant change of ``entity_id`` and identify its cause.

    ``action`` (e.g. 'off'/'on') selects the most recent change to that state;
    without it, the most recent change of any kind. Returns
    ``{entity_id, when, state, cause_kind, cause_name}`` or None if no data.
    """
    rel = [e for e in (entries or [])
           if e.get("entity_id") == entity_id and e.get("state") not in (None, "")]
    if not rel:
        return None
    rel.sort(key=lambda e: e.get("when") or "")
    chosen = None
    if action:
        matches = [e for e in rel if str(e.get("state")).lower() == action.lower()]
        chosen = matches[-1] if matches else None
    if chosen is None:
        chosen = rel[-1]
    return {
        "entity_id": entity_id,
        "when": chosen.get("when"),
        "state": chosen.get("state"),
        **_classify_cause(chosen),
    }


def fetch_logbook(entity_id: str, hours: int = 24) -> list[dict]:
    """Live: pull the HA logbook over the last ``hours`` (``explain_change`` filters).

    NOTE: HA's per-entity logbook filter (``?entity=``) returns nothing on this
    deployment, so we fetch the general logbook and let ``explain_change`` filter by
    entity locally — proven on the Canary. ``entity_id`` is accepted for API symmetry
    (and future use) but not sent as a server-side filter.
    """
    import os
    import requests
    url = os.environ.get("HA_URL") or "http://host.docker.internal:8123"
    tok = os.environ.get("HA_TOKEN")
    start = (datetime.datetime.now(datetime.timezone.utc)
             - datetime.timedelta(hours=hours)).isoformat()
    r = requests.get(f"{url}/api/logbook/{start}",
                     headers={"Authorization": f"Bearer {tok}"}, timeout=15)
    return r.json() if r.ok else []
