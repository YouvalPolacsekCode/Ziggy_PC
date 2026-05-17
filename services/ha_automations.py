"""
HA Automations — CRUD via HA REST config API + states.
Translates between Ziggy's simplified UI schema and HA's native format.

Routing rule:
  - Automations that involve a state trigger or call_service action → stored in HA.
  - Automations that only use IR commands / Ziggy capabilities → stored in Ziggy
    (automations.json) so HA is not required for purely local automations.
  - Regardless of storage, all automations are merged in list_automations().
"""
from __future__ import annotations
import re
import uuid
from typing import Optional
import requests

from core.settings_loader import settings
from core.logger_module import log_error

HA_URL: str = settings["home_assistant"]["url"].rstrip("/")
HA_TOKEN: str = settings["home_assistant"]["token"]
HEADERS = {"Authorization": f"Bearer {HA_TOKEN}", "Content-Type": "application/json"}


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return s or uuid.uuid4().hex


def needs_ha(data: dict) -> bool:
    """Return True when the automation requires Home Assistant to store or trigger.

    Rules:
    - state / numeric_state → HA must watch for the state-change event
    - sunrise / sunset      → HA must compute the astronomical time
    - webhook               → HA must receive the HTTP call
    - time trigger          → Ziggy's own scheduler handles it; no HA required
      (call_service steps are now executed natively by execute_ziggy_actions)
    """
    trigger_type = data.get("trigger", {}).get("type", "")
    return trigger_type in ("state", "numeric_state", "sunrise", "sunset", "webhook", "zone")


# ── Ziggy → HA ────────────────────────────────────────────────────────────────

def _condition_to_ha(c: dict) -> Optional[dict]:
    # ── Time-window condition ──────────────────────────────────────────────
    if c.get("type") == "time":
        result: dict = {"condition": "time"}
        after  = (c.get("after")  or "").strip()
        before = (c.get("before") or "").strip()
        if after:
            result["after"]  = after  + ":00" if len(after)  == 5 else after
        if before:
            result["before"] = before + ":00" if len(before) == 5 else before
        return result if (after or before) else None

    # ── Entity-state / numeric-state condition ─────────────────────────────
    entity_id = c.get("entity_id", "")
    if not entity_id:
        return None
    operator = c.get("operator", "is")
    value    = c.get("value", "on")
    if operator in ("is", "is_not"):
        state_val = ("off" if value == "on" else "on") if operator == "is_not" else str(value)
        return {"condition": "state", "entity_id": entity_id, "state": state_val}
    if operator == "above":
        try:
            return {"condition": "numeric_state", "entity_id": entity_id, "above": float(value)}
        except (ValueError, TypeError):
            return None
    if operator == "below":
        try:
            return {"condition": "numeric_state", "entity_id": entity_id, "below": float(value)}
        except (ValueError, TypeError):
            return None
    return None


def _trigger_to_ha(t: dict) -> list:
    kind = t.get("type", "time")
    if kind == "time":
        return [{"platform": "time", "at": f"{t.get('time', '08:00')}:00"}]
    if kind == "state":
        cfg: dict = {"platform": "state", "entity_id": t.get("entity_id", ""), "to": t.get("state", "on")}
        for_mins = t.get("for_minutes")
        if for_mins:
            mins = int(for_mins)
            h, m = divmod(mins, 60)
            cfg["for"] = f"{h:02d}:{m:02d}:00"
        return [cfg]
    if kind == "numeric_state":
        cfg: dict = {"platform": "numeric_state", "entity_id": t.get("entity_id", "")}
        if t.get("above") is not None:
            cfg["above"] = t["above"]
        if t.get("below") is not None:
            cfg["below"] = t["below"]
        return [cfg]
    if kind in ("sunrise", "sunset"):
        cfg = {"platform": "sun", "event": kind}
        if t.get("offset"):
            cfg["offset"] = t["offset"]
        return [cfg]
    if kind == "webhook":
        return [{"platform": "webhook", "webhook_id": t.get("webhook_id", "ziggy_webhook"), "allowed_methods": ["POST"]}]
    if kind == "zone":
        return [{
            "platform": "zone",
            "entity_id": t.get("entity_id", ""),
            "zone":      t.get("zone", "zone.home"),
            "event":     t.get("event", "enter"),
        }]
    return []


def _action_to_ha(a: dict) -> Optional[dict]:
    kind = a.get("type", "call_service")
    if kind == "call_service":
        entity_id = a.get("entity_id", "")
        svc = a.get("service", "homeassistant.turn_on")
        domain = entity_id.split(".")[0] if "." in entity_id else "homeassistant"
        action_name = svc.split(".")[-1]
        ha_action: dict = {"service": f"{domain}.{action_name}", "target": {"entity_id": entity_id}}
        service_data = a.get("service_data") or {}
        if service_data:
            ha_action["data"] = service_data
        return ha_action
    if kind == "delay":
        secs = int(a.get("seconds", 0))
        m, s = divmod(secs, 60)
        h, m = divmod(m, 60)
        return {"delay": f"{h:02d}:{m:02d}:{s:02d}"}
    if kind == "notify":
        return {"service": "notify.persistent_notification",
                "data": {"message": a.get("message", ""), "title": "Ziggy"}}
    if kind == "ziggy_intent":
        label = a.get("virtual_device_name") or a.get("capability", "ziggy_action")
        return {"service": "notify.persistent_notification",
                "data": {"message": f"[Ziggy] Run: {label}", "title": "Ziggy Capability"}}
    if kind == "ir_command":
        label = f"{a.get('ir_device_name', 'IR device')} → {a.get('ir_sequence') or a.get('ir_command', '')}"
        return {"service": "notify.persistent_notification",
                "data": {"message": f"[Ziggy IR] {label}", "title": "Ziggy IR"}}
    return None  # send_intent not translatable to HA


# ── HA → Ziggy ────────────────────────────────────────────────────────────────

def _ha_trigger_to_ziggy(ha_triggers: list) -> dict:
    if not ha_triggers:
        return {}
    t = ha_triggers[0] if isinstance(ha_triggers, list) else ha_triggers
    platform = t.get("platform", "time")
    if platform == "time":
        return {"type": "time", "time": str(t.get("at", "00:00:00"))[:5]}
    if platform == "state":
        return {"type": "state", "entity_id": t.get("entity_id", ""), "state": t.get("to", "on")}
    if platform == "numeric_state":
        result: dict = {"type": "numeric_state", "entity_id": t.get("entity_id", "")}
        if t.get("above") is not None:
            result["above"] = t["above"]
        if t.get("below") is not None:
            result["below"] = t["below"]
        return result
    if platform == "sun":
        return {"type": t.get("event", "sunrise"), "offset": t.get("offset", "")}
    if platform == "webhook":
        return {"type": "webhook", "webhook_id": t.get("webhook_id", "")}
    if platform == "zone":
        return {"type": "zone", "entity_id": t.get("entity_id", ""), "zone": t.get("zone", "zone.home"), "event": t.get("event", "enter")}
    return {}


def _ha_action_to_ziggy(a: dict) -> dict:
    if "service" in a:
        svc = a["service"]
        target = a.get("target") or a.get("data") or {}
        entity_id = target.get("entity_id", "")
        if isinstance(entity_id, list):
            entity_id = entity_id[0] if entity_id else ""
        return {"type": "call_service", "entity_id": entity_id,
                "service": f"homeassistant.{svc.split('.')[-1]}"}
    if "delay" in a:
        d = a["delay"]
        if isinstance(d, str):
            parts = d.split(":")
            secs = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2]) if len(parts) == 3 else 0
        elif isinstance(d, dict):
            secs = d.get("seconds", 0) + d.get("minutes", 0) * 60 + d.get("hours", 0) * 3600
        else:
            secs = 0
        return {"type": "delay", "seconds": secs}
    return {"type": "notify", "message": str(a)}


# ── API calls ─────────────────────────────────────────────────────────────────

def list_automations() -> list:
    """Return all automations: HA-backed (with locally-cached trigger) + Ziggy-only."""
    from services.local_automation_actions import get_automation_meta, get_all_saved_actions
    from core.automation_file import list_automations as list_ziggy_automations

    ha_result: list = []
    ha_ids: set = set()

    try:
        resp = requests.get(f"{HA_URL}/api/states", headers=HEADERS, timeout=10)
        if resp.status_code == 200:
            for s in resp.json():
                eid = s.get("entity_id", "")
                if not eid.startswith("automation."):
                    continue
                auto_id = eid[len("automation."):]
                ha_ids.add(auto_id)
                attrs = s.get("attributes", {})
                meta = get_automation_meta(auto_id)
                ha_result.append({
                    "id": auto_id,
                    "entity_id": eid,
                    "name": meta.get("name") or attrs.get("friendly_name", auto_id),
                    "description": meta.get("description", ""),
                    "enabled": s.get("state") != "off",
                    "last_triggered": attrs.get("last_triggered"),
                    "trigger": meta.get("trigger", {}),
                    "actions": get_all_saved_actions(auto_id),
                    "rooms": meta.get("rooms", []),
                    "source": "ha",
                })
    except Exception as e:
        log_error(f"[HA Automations] list: {e}")

    # Merge Ziggy-only automations (those not already in the HA list).
    ziggy_extras: list = []
    try:
        for a in list_ziggy_automations():
            if a.get("id") not in ha_ids:
                ziggy_extras.append({**a, "source": "ziggy"})
    except Exception:
        pass

    all_automations = ha_result + ziggy_extras
    return sorted(all_automations, key=lambda x: (x.get("name") or "").lower())


def get_automation_for_ui(auto_id: str) -> Optional[dict]:
    """Fetch full automation config for editing. Falls back to Ziggy-only store."""
    from services.local_automation_actions import (
        get_all_saved_actions, get_automation_meta, save_automation_meta,
    )

    # Try HA first.
    try:
        resp = requests.get(f"{HA_URL}/api/config/automation/config/{auto_id}",
                            headers=HEADERS, timeout=10)
        if resp.status_code == 200:
            cfg = resp.json()
            # HA 2024+ uses plural keys ("triggers", "actions"); older HA uses singular.
            ha_triggers = cfg.get("triggers") or cfg.get("trigger") or []
            if isinstance(ha_triggers, dict):
                ha_triggers = [ha_triggers]
            ha_actions = cfg.get("actions") or cfg.get("action") or []
            if isinstance(ha_actions, dict):
                ha_actions = [ha_actions]

            saved_actions = get_all_saved_actions(auto_id)
            meta = get_automation_meta(auto_id)

            # Prefer locally-stored trigger (written at save time, always accurate).
            # Fall back to parsing HA config only if no local record exists.
            trigger = meta.get("trigger") or _ha_trigger_to_ziggy(ha_triggers)
            name = cfg.get("alias", auto_id)

            # Back-fill metadata cache so the list view shows trigger data
            # without needing another HA config API call.
            if not meta and trigger:
                save_automation_meta(auto_id, {
                    "name": name,
                    "description": cfg.get("description", ""),
                    "trigger": trigger,
                })

            return {
                "id": auto_id,
                "name": name,
                "description": cfg.get("description", ""),
                "enabled": True,
                "trigger": trigger,
                "conditions": meta.get("conditions", []),
                "actions": saved_actions if saved_actions else [_ha_action_to_ziggy(a) for a in ha_actions],
                "rooms": meta.get("rooms", []),
                "source": "ha",
            }
    except Exception as e:
        log_error(f"[HA Automations] get_for_ui {auto_id}: {e}")

    # Fall back to Ziggy-only store.
    try:
        from core.automation_file import get_automation as get_ziggy
        ziggy = get_ziggy(auto_id)
        if ziggy:
            saved_actions = get_all_saved_actions(auto_id)
            ziggy["actions"] = saved_actions if saved_actions else ziggy.get("actions", [])
            ziggy["source"] = "ziggy"
            return ziggy
    except Exception:
        pass

    return None


def save_automation(data: dict, auto_id: Optional[str] = None) -> dict:
    """
    Save an automation.  Routes to HA or Ziggy-only depending on needs_ha().
    auto_id — supply when updating an existing automation so the same slug is used.
    """
    if not auto_id:
        auto_id = _slug(data.get("name", "ziggy_automation"))

    ziggy_actions = data.get("actions", [])
    trigger = data.get("trigger", {})

    from services.local_automation_actions import save_ziggy_actions, save_automation_meta

    if not needs_ha(data):
        # Ziggy-only: store in automations.json, no HA required.
        from core.automation_file import (
            get_automation as get_ziggy,
            create_automation as create_ziggy,
            update_automation as update_ziggy,
        )
        # Use the slug as stable ID so lookups are consistent.
        if get_ziggy(auto_id):
            update_ziggy(auto_id, {**data, "id": auto_id})
        else:
            create_ziggy({**data, "id": auto_id})
        save_ziggy_actions(auto_id, ziggy_actions)
        save_automation_meta(auto_id, {
            "name": data.get("name", ""),
            "description": data.get("description", ""),
            "trigger": trigger,
            "conditions": data.get("conditions", []),
            "rooms": data.get("rooms", []),
        })
        return {"ok": True, "id": auto_id, "source": "ziggy"}

    # HA-backed automation.
    ha_actions = [_action_to_ha(a) for a in ziggy_actions]
    ha_actions = [a for a in ha_actions if a is not None]
    ziggy_conditions = data.get("conditions", [])
    ha_conditions = [_condition_to_ha(c) for c in ziggy_conditions]
    ha_conditions = [c for c in ha_conditions if c is not None]
    # HA 2024.1+ uses plural keys only. Sending both "trigger"+"triggers" (or
    # "condition"+"conditions", "action"+"actions") causes a 400 "Message malformed"
    # error. Use plural keys exclusively.
    ha_cfg = {
        "id": auto_id,
        "alias": data.get("name", "Ziggy Automation"),
        "description": data.get("description", ""),
        "triggers": _trigger_to_ha(trigger),
        "conditions": ha_conditions,
        "actions": ha_actions,
        "mode": "single",
    }
    try:
        resp = requests.post(f"{HA_URL}/api/config/automation/config/{auto_id}",
                             headers=HEADERS, json=ha_cfg, timeout=10)
        if resp.status_code in (200, 201):
            save_ziggy_actions(auto_id, ziggy_actions)
            # Cache trigger + name so list_automations() can display them without
            # a per-automation config API call.
            save_automation_meta(auto_id, {
                "name": data.get("name", ""),
                "description": data.get("description", ""),
                "trigger": trigger,
                "conditions": data.get("conditions", []),
                "rooms": data.get("rooms", []),
            })
            return {"ok": True, "id": auto_id, "source": "ha"}
        return {"ok": False, "error": f"HA {resp.status_code}: {resp.text}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def delete_automation(auto_id: str) -> bool:
    try:
        resp = requests.delete(f"{HA_URL}/api/config/automation/config/{auto_id}",
                               headers=HEADERS, timeout=10)
        return resp.status_code in (200, 204)
    except Exception as e:
        log_error(f"[HA Automations] delete {auto_id}: {e}")
        return False


def toggle_automation(auto_id: str, enable: bool) -> bool:
    service = "turn_on" if enable else "turn_off"
    try:
        resp = requests.post(f"{HA_URL}/api/services/automation/{service}",
                             headers=HEADERS,
                             json={"entity_id": f"automation.{auto_id}"},
                             timeout=10)
        return resp.status_code == 200
    except Exception as e:
        log_error(f"[HA Automations] toggle {auto_id}: {e}")
        return False


def trigger_automation(auto_id: str) -> bool:
    try:
        resp = requests.post(f"{HA_URL}/api/services/automation/trigger",
                             headers=HEADERS,
                             json={"entity_id": f"automation.{auto_id}"},
                             timeout=10)
        return resp.status_code == 200
    except Exception as e:
        log_error(f"[HA Automations] trigger {auto_id}: {e}")
        return False
