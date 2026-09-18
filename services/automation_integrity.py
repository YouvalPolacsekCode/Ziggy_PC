"""Automation integrity — does every automation still point at real devices?

Why (Canary bedroom, 2026-09-18). Two bulbs were first paired over Matter,
then re-paired over Zigbee on Aug 12. Their entity ids changed. The bedroom
Smart Room rules kept the old ids and switched lights that did not exist for
five weeks. Home Assistant logged "referenced entities are missing" on every
trigger; nobody reads Home Assistant's log. Same class as the Tslil balcony
incident: an automation that runs "successfully" against nothing.

An entity id is a property of a PAIRING, not of a device. So the check is
mechanical: collect every entity an automation references (trigger, conditions,
Ziggy's stored actions, and the action list Home Assistant holds), and compare
against what exists right now. A dangling reference makes the automation show
as broken in the app and raises exactly one anomaly (ANOM-15) naming the
device to pick again. Runs hourly and on demand; the list endpoint annotates
each automation so the card can badge it.
"""
from __future__ import annotations

import time
from typing import Iterable, Optional

from core.logger_module import log_error, log_info

# Only HA-device domains are judged. `ir:` targets, scenes and Ziggy's own
# virtual sensors have their own lifecycle and would only add noise.
_DEVICE_DOMAINS = frozenset({
    "light", "switch", "climate", "fan", "cover", "lock", "media_player",
    "binary_sensor", "sensor", "vacuum", "humidifier", "water_heater", "input_boolean",
})

last_report: dict = {"at": None, "broken": []}


def _ids(value) -> list[str]:
    if isinstance(value, str):
        return [value] if "." in value else []
    if isinstance(value, (list, tuple)):
        return [v for v in value if isinstance(v, str) and "." in v]
    return []


def referenced_entities(automation: dict, ha_actions: Optional[Iterable[dict]] = None) -> set[str]:
    """Every HA entity this automation depends on, from all four sources."""
    refs: set[str] = set()
    trig = automation.get("trigger") or {}
    if isinstance(trig, dict):
        refs.update(_ids(trig.get("entity_id")))
    for c in automation.get("conditions") or []:
        if isinstance(c, dict):
            refs.update(_ids(c.get("entity_id")))
    for a in list(automation.get("actions") or []) + list(ha_actions or []):
        if not isinstance(a, dict):
            continue
        refs.update(_ids(a.get("entity_id")))
        tgt = a.get("target")
        if isinstance(tgt, dict):
            refs.update(_ids(tgt.get("entity_id")))
        data = a.get("data") or a.get("service_data")
        if isinstance(data, dict):
            refs.update(_ids(data.get("entity_id")))
    return {e for e in refs if e.split(".", 1)[0] in _DEVICE_DOMAINS}


def missing_entities(automation: dict, known: set[str],
                     ha_actions: Optional[Iterable[dict]] = None) -> list[str]:
    return sorted(e for e in referenced_entities(automation, ha_actions) if e not in known)


def check(automations: list[dict], known: set[str],
          ha_actions_for=None) -> list[dict]:
    """Pure: [{id, name, missing:[entity_ids]}] for every automation with a gap."""
    out: list[dict] = []
    for a in automations:
        extra = ha_actions_for(a.get("id")) if ha_actions_for else None
        miss = missing_entities(a, known, extra)
        if miss:
            out.append({"id": a.get("id"), "name": a.get("name") or a.get("id"), "missing": miss})
    return out


def annotate(automations: list[dict], known: set[str]) -> list[dict]:
    """Add `missing_entities` to each list item (cheap: no HA round-trip)."""
    if not known:
        return automations
    for a in automations:
        try:
            a["missing_entities"] = missing_entities(a, known)
        except Exception:
            a["missing_entities"] = []
    return automations


async def sweep() -> dict:
    """Hourly: full check including HA's own action lists; raise/clear ANOM-15."""
    global last_report
    import asyncio
    from services import ha_automations
    try:
        automations = await asyncio.to_thread(ha_automations.list_automations)
        known = await asyncio.to_thread(ha_automations._known_entity_ids)
    except Exception as e:
        log_error(f"[AutomationIntegrity] list unavailable: {e}")
        return last_report
    if not known:
        return last_report                      # HA unreachable — never judge blind

    def _ha_actions(auto_id):
        try:
            return ha_automations._ha_config_actions(auto_id)
        except Exception:
            return []

    broken = await asyncio.to_thread(check, automations, known, _ha_actions)
    last_report = {"at": time.time(), "broken": broken, "checked": len(automations)}

    try:
        from services import anomaly_engine as ae
        from services.ha_subscriber import active_anomalies as active
        broken_ids = {b["id"] for b in broken}
        for b in broken:
            ae.raise_broken_automation(active, str(b["id"]), str(b["name"]), b["missing"])
        for a in automations:
            if a.get("id") not in broken_ids:
                ae.clear_broken_automation(active, str(a.get("id")))
    except Exception as e:
        log_error(f"[AutomationIntegrity] anomaly update failed: {e}")
    if broken:
        log_info(f"[AutomationIntegrity] {len(broken)} automation(s) reference missing devices: "
                 + ", ".join(f"{b['name']}→{b['missing']}" for b in broken))
    return last_report
