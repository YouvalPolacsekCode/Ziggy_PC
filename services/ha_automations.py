"""
HA Automations — CRUD via HA REST config API + states.
Translates between Ziggy's simplified UI schema and HA's native format.
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


# ── Ziggy → HA ────────────────────────────────────────────────────────────────

def _trigger_to_ha(t: dict) -> list:
    kind = t.get("type", "time")
    if kind == "time":
        return [{"platform": "time", "at": f"{t.get('time', '08:00')}:00"}]
    if kind == "state":
        return [{"platform": "state", "entity_id": t.get("entity_id", ""), "to": t.get("state", "on")}]
    if kind in ("sunrise", "sunset"):
        cfg: dict = {"platform": "sun", "event": kind}
        if t.get("offset"):
            cfg["offset"] = t["offset"]
        return [cfg]
    if kind == "webhook":
        return [{"platform": "webhook", "webhook_id": t.get("webhook_id", "ziggy_webhook"), "allowed_methods": ["POST"]}]
    return []


def _action_to_ha(a: dict) -> Optional[dict]:
    kind = a.get("type", "call_service")
    if kind == "call_service":
        entity_id = a.get("entity_id", "")
        svc = a.get("service", "homeassistant.turn_on")
        domain = entity_id.split(".")[0] if "." in entity_id else "homeassistant"
        action_name = svc.split(".")[-1]
        return {"service": f"{domain}.{action_name}", "target": {"entity_id": entity_id}}
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
        return {"type": "time", "time": "08:00"}
    t = ha_triggers[0] if isinstance(ha_triggers, list) else ha_triggers
    platform = t.get("platform", "time")
    if platform == "time":
        return {"type": "time", "time": str(t.get("at", "08:00:00"))[:5]}
    if platform == "state":
        return {"type": "state", "entity_id": t.get("entity_id", ""), "state": t.get("to", "on")}
    if platform == "sun":
        return {"type": t.get("event", "sunrise"), "offset": t.get("offset", "")}
    if platform == "webhook":
        return {"type": "webhook", "webhook_id": t.get("webhook_id", "")}
    return {"type": "time", "time": "08:00"}


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
    try:
        resp = requests.get(f"{HA_URL}/api/states", headers=HEADERS, timeout=10)
        if resp.status_code != 200:
            return []
        result = []
        for s in resp.json():
            eid = s.get("entity_id", "")
            if not eid.startswith("automation."):
                continue
            auto_id = eid[len("automation."):]
            attrs = s.get("attributes", {})
            result.append({
                "id": auto_id,
                "entity_id": eid,
                "name": attrs.get("friendly_name", auto_id),
                "enabled": s.get("state") != "off",
                "last_triggered": attrs.get("last_triggered"),
                "description": "",
            })
        return sorted(result, key=lambda x: x["name"])
    except Exception as e:
        log_error(f"[HA Automations] list: {e}")
        return []


def get_automation_for_ui(auto_id: str) -> Optional[dict]:
    try:
        resp = requests.get(f"{HA_URL}/api/config/automation/config/{auto_id}",
                            headers=HEADERS, timeout=10)
        if resp.status_code != 200:
            return None
        cfg = resp.json()
        ha_triggers = cfg.get("trigger", [])
        if isinstance(ha_triggers, dict):
            ha_triggers = [ha_triggers]
        ha_actions = cfg.get("action", [])
        if isinstance(ha_actions, dict):
            ha_actions = [ha_actions]
        from services.local_automation_actions import get_all_saved_actions
        saved_actions = get_all_saved_actions(auto_id)
        return {
            "id": auto_id,
            "name": cfg.get("alias", auto_id),
            "description": cfg.get("description", ""),
            "enabled": True,
            "trigger": _ha_trigger_to_ziggy(ha_triggers),
            # Prefer locally-stored actions (preserves ir_command / ziggy_intent data).
            # Fall back to parsing HA config when no local record exists.
            "actions": saved_actions if saved_actions else [_ha_action_to_ziggy(a) for a in ha_actions],
        }
    except Exception as e:
        log_error(f"[HA Automations] get_for_ui {auto_id}: {e}")
        return None


def save_automation(data: dict, auto_id: Optional[str] = None) -> dict:
    if not auto_id:
        auto_id = _slug(data.get("name", "ziggy_automation"))
    ziggy_actions = data.get("actions", [])
    triggers = _trigger_to_ha(data.get("trigger", {}))
    ha_actions = [_action_to_ha(a) for a in ziggy_actions]
    ha_actions = [a for a in ha_actions if a is not None]
    ha_cfg = {
        "id": auto_id,
        "alias": data.get("name", "Ziggy Automation"),
        "description": data.get("description", ""),
        "trigger": triggers,
        "condition": [],
        "action": ha_actions,
        "mode": "single",
    }
    try:
        resp = requests.post(f"{HA_URL}/api/config/automation/config/{auto_id}",
                             headers=HEADERS, json=ha_cfg, timeout=10)
        if resp.status_code in (200, 201):
            # Always persist the full Ziggy-format action list locally so the UI
            # can reconstruct actions after restart without depending on the HA
            # config REST API (which is unreliable on many HA setups).
            from services.local_automation_actions import save_ziggy_actions
            save_ziggy_actions(auto_id, ziggy_actions)
            return {"ok": True, "id": auto_id}
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
