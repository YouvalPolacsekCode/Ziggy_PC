"""Radio liveness — is each Zigbee device still a member of the network?

Why this exists (Canary office, 2026-09-18). An IKEA bulb factory-reset,
announced it was leaving, and Zigbee2MQTT deleted it from its database. Home
Assistant kept the retained entity and its last state, Ziggy's registry kept
saying "connected", and the Smart Room kept switching a light that no longer
existed — for two days, while a "device doctor" produced 130 false alerts about
lights that were merely untouched.

Every health signal Ziggy had was downstream of Home Assistant's `unavailable`
state, and with Zigbee2MQTT availability tracking off (every imaged hub) a
departed device never becomes unavailable. The coordinator's own device list is
the ground truth, it is retained on MQTT, and it is free:
`zigbee2mqtt/bridge/devices`. A device Ziggy owns that is absent from it has
LEFT the hub. No heuristic, no "silent for N hours".

What this module does, every few minutes from the scheduler:
  1. Read the retained bridge/devices list → set of IEEE addresses present.
  2. Map Ziggy's registry rows to IEEEs (HA device-registry identifiers,
     falling back to the `0x…` in a Zigbee2MQTT default entity id).
  3. Rows whose IEEE is absent → LOST with `lost_reason: left_hub`; rows that
     came back → CONNECTED. One anomaly per departed device (ANOM-14) with the
     only remedy that works: pair it again.
  4. A mass-loss veto, same as the HA reconcile: if half the radio devices
     vanish at once the coordinator is restarting, not the house.

It also asks Zigbee2MQTT to turn availability tracking on (once, persisted in
Z2M's own config) so Home Assistant itself starts saying `unavailable` and
every existing rule wakes up. That takes effect at Z2M's next restart.
"""
from __future__ import annotations

import re
import time
from typing import Iterable, Optional

from core.logger_module import log_error, log_info
from services.local_automation_actions import get_local_state, set_local_state

BRIDGE_DEVICES_TOPIC = "zigbee2mqtt/bridge/devices"
LEFT_HUB = "left_hub"
_KV = "radio_liveness"

_IEEE_RE = re.compile(r"0x[0-9a-f]{16}", re.IGNORECASE)
_MASS_LOSS_MIN = 3          # below this many tracked devices, "half" isn't a signal
_MASS_LOSS_MIN_LEFT = 2     # ≥ this many vanishing together, and ≥ half of tracked
_MASS_LOSS_SHARE = 0.5

# Last result, for the API / ops status.
last_result: dict = {}


def present_ieees(bridge_devices: Iterable[dict]) -> set[str]:
    """IEEE addresses of every non-coordinator device Zigbee2MQTT knows."""
    out: set[str] = set()
    for d in bridge_devices or []:
        if not isinstance(d, dict) or d.get("type") == "Coordinator":
            continue
        ieee = str(d.get("ieee_address") or "").lower()
        if ieee:
            out.add(ieee)
    return out


def ieee_of_entity(entity_id: str, ha_entities: dict[str, dict] | None = None,
                   ha_devices: dict[str, dict] | None = None) -> Optional[str]:
    """Which Zigbee device backs this entity, or None when it is not Zigbee2MQTT's.

    Prefers HA's device registry (identifier `zigbee2mqtt_<ieee>`), which
    survives a friendly-name rename; falls back to the address embedded in a
    Zigbee2MQTT default entity id (`light.0x0070d07effb79f92`).
    """
    ent = (ha_entities or {}).get(entity_id)
    if ent:
        dev = (ha_devices or {}).get(str(ent.get("device_id") or ""))
        for ident in (dev or {}).get("identifiers") or []:
            try:
                dom, val = ident[0], str(ident[1])
            except Exception:
                continue
            if dom == "mqtt" and val.startswith("zigbee2mqtt_0x"):
                return val[len("zigbee2mqtt_"):].lower()
        if ent.get("platform") not in (None, "mqtt"):
            return None
    m = _IEEE_RE.search(entity_id or "")
    return m.group(0).lower() if m else None


def judge(rows: list[dict], present: set[str], ieee_of: dict[str, str]) -> dict:
    """Pure decision: which rows left, which came back, and whether to veto.

    `rows` are registry rows; `ieee_of` maps entity_id → ieee for the rows that
    are Zigbee devices. Rows without an ieee are not judged (Wi-Fi, IR, HA
    helpers). Returns {left: [entity_ids], back: [entity_ids], veto: bool,
    tracked: n}.
    """
    tracked = [r for r in rows if ieee_of.get(str(r.get("entity_id") or ""))]
    left = [r for r in tracked if ieee_of[r["entity_id"]] not in present
            and not (r.get("status") == "lost" and r.get("lost_reason") == LEFT_HUB)]
    already_left = [r for r in tracked if r.get("status") == "lost" and r.get("lost_reason") == LEFT_HUB]
    back = [r for r in already_left if ieee_of[r["entity_id"]] in present]
    n = len(tracked)
    veto = n >= _MASS_LOSS_MIN and len(left) >= _MASS_LOSS_MIN_LEFT and (len(left) / n) >= _MASS_LOSS_SHARE
    return {
        "left": [r["entity_id"] for r in left],
        "back": [r["entity_id"] for r in back],
        "veto": veto,
        "tracked": n,
    }


async def _ha_registry_maps() -> tuple[dict[str, dict], dict[str, dict]]:
    try:
        from services.ha_areas import get_registry_snapshot
        snap = await get_registry_snapshot()
        ents = {e["entity_id"]: e for e in (snap.get("entities") or []) if e.get("entity_id")}
        devs = {d["id"]: d for d in (snap.get("devices") or []) if d.get("id")}
        return ents, devs
    except Exception as e:
        log_error(f"[RadioLiveness] HA registry snapshot unavailable: {e}")
        return {}, {}


async def reconcile() -> dict:
    """One pass. Safe to call every few minutes; cheap when nothing changed."""
    global last_result
    from services import device_registry
    from services.mqtt_client import read_retained

    try:
        bridge = await read_retained(BRIDGE_DEVICES_TOPIC)
    except Exception as e:
        last_result = {"skipped": f"bridge_devices_unavailable: {e}", "at": time.time()}
        return last_result
    if not isinstance(bridge, list) or not bridge:
        last_result = {"skipped": "bridge_devices_empty", "at": time.time()}
        return last_result
    present = present_ieees(bridge)
    if not present:
        last_result = {"skipped": "no_devices_in_bridge_list", "at": time.time()}
        return last_result

    ents, devs = await _ha_registry_maps()
    rows = device_registry.get_all() or []
    ieee_of: dict[str, str] = {}
    for r in rows:
        eid = str(r.get("entity_id") or "")
        if not eid or r.get("ir_device_id"):
            continue
        ieee = ieee_of_entity(eid, ents, devs)
        if ieee:
            ieee_of[eid] = ieee

    verdict = judge(rows, present, ieee_of)
    if verdict["veto"]:
        log_error(f"[RadioLiveness] {len(verdict['left'])}/{verdict['tracked']} Zigbee devices "
                  f"missing from the coordinator list at once — looks like Zigbee2MQTT "
                  f"restarting, not the house. No status changed.")
        last_result = {**verdict, "applied": False, "at": time.time()}
        return last_result

    changed = device_registry.apply_radio_liveness(verdict["left"], verdict["back"])
    if verdict["left"] or verdict["back"]:
        log_info(f"[RadioLiveness] left hub: {verdict['left']} · back: {verdict['back']} "
                 f"(tracked {verdict['tracked']}, changed {changed})")
    await _raise_or_clear_anomalies(rows, verdict, ieee_of, present)
    last_result = {**verdict, "applied": True, "changed": changed, "at": time.time()}
    return last_result


async def _raise_or_clear_anomalies(rows: list[dict], verdict: dict,
                                    ieee_of: dict[str, str], present: set[str]) -> None:
    """ANOM-14 per departed device; cleared the moment it is back."""
    try:
        from services import anomaly_engine as ae
        from services.ha_subscriber import active_anomalies as active
    except Exception:
        return
    names = {str(r.get("entity_id")): (r.get("name") or r.get("display_name") or r.get("entity_id"))
             for r in rows}
    for eid, ieee in ieee_of.items():
        if ieee in present:
            ae.clear_left_hub(active, eid)
        else:
            ae.raise_left_hub(active, eid, str(names.get(eid) or eid))


async def ensure_z2m_availability(force: bool = False) -> bool:
    """Ask Zigbee2MQTT to track availability so HA can say `unavailable` itself.

    Persisted by Z2M into its configuration.yaml; active after its next restart.
    Done once per hub (KV flag) so a deliberate operator opt-out sticks.
    """
    rec = get_local_state(_KV, "z2m_availability") or {}
    if rec.get("requested") and not force:
        return False
    try:
        from services.mqtt_client import publish
        await publish("zigbee2mqtt/bridge/request/options",
                      {"options": {"availability": {"enabled": True}}}, qos=1)
        set_local_state(_KV, "z2m_availability", {"requested": True, "at": time.time()})
        log_info("[RadioLiveness] asked Zigbee2MQTT to enable availability tracking (takes effect on its next restart)")
        return True
    except Exception as e:
        log_error(f"[RadioLiveness] could not request Z2M availability: {e}")
        return False
