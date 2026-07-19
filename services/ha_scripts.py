"""
HA Scripts — CRUD via HA REST config API.
Ziggy routines map directly to HA scripts (manual sequences of actions).
"""
from __future__ import annotations
import json
import os
import re
import uuid
from typing import Optional
import requests

from core.settings_loader import settings
from core.logger_module import log_error
from services import ha_client


def HA_URL() -> str:  # noqa: N802 — callable shim so credential reads stay dynamic
    return ha_client.url()


def HEADERS() -> dict:  # noqa: N802
    return ha_client.headers()

# ── Routine-only sidecar metadata ─────────────────────────────────────────────
# HA scripts have no `icon` field, so the user's icon choice would otherwise be
# dropped on save and forced back to "⚡" on every reload. Kept in its own file
# (not automation_meta.json) so a routine and an automation that slug to the
# same id can't collide.
_ROUTINE_META_FILE = "user_files/routine_meta.json"


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return s or uuid.uuid4().hex


def _dedupe_script_id(base_id: str) -> str:
    """Return base_id, or base_id_2/_3/… if a script already owns it.

    Mirrors ha_automations._dedupe_auto_id (2026-07-19 addendum A3): adding
    the same Library routine twice must create a second instance, not
    overwrite the first. Create-path only — updates pass script_id explicitly.
    """
    existing: set = set()
    try:
        from services.ha_subscriber import state_cache
        existing |= {eid[len("script."):] for eid in (state_cache or {})
                     if eid.startswith("script.")}
    except Exception:
        pass
    if base_id not in existing:
        return base_id
    n = 2
    while f"{base_id}_{n}" in existing:
        n += 1
    return f"{base_id}_{n}"


def _load_routine_meta() -> dict:
    if not os.path.exists(_ROUTINE_META_FILE):
        return {}
    try:
        with open(_ROUTINE_META_FILE, "r", encoding="utf-8") as f:
            return json.load(f) or {}
    except Exception as e:
        log_error(f"[HA Scripts] load routine_meta: {e}")
        return {}


def _save_routine_meta(data: dict) -> None:
    try:
        os.makedirs(os.path.dirname(_ROUTINE_META_FILE), exist_ok=True)
        with open(_ROUTINE_META_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        log_error(f"[HA Scripts] save routine_meta: {e}")


def _set_routine_meta(script_id: str, fields: dict) -> None:
    store = _load_routine_meta()
    store[script_id] = {**store.get(script_id, {}), **fields}
    _save_routine_meta(store)


def _get_routine_meta(script_id: str) -> dict:
    return _load_routine_meta().get(script_id, {})


def _delete_routine_meta(script_id: str) -> None:
    store = _load_routine_meta()
    if store.pop(script_id, None) is not None:
        _save_routine_meta(store)


# ── Ziggy → HA ────────────────────────────────────────────────────────────────

def _step_to_ha(step: dict) -> Optional[dict]:
    kind = step.get("type", "device")
    if kind == "device":
        entity_id = step.get("entity_id", "")
        # ha_service is the real HA service name; action is the UI value key (may differ for rich actions)
        ha_service = step.get("ha_service") or step.get("action", "turn_on")
        domain = entity_id.split(".")[0] if "." in entity_id else "homeassistant"
        ha_step: dict = {"service": f"{domain}.{ha_service}", "target": {"entity_id": entity_id}}
        service_data = step.get("service_data") or {}
        if service_data:
            ha_step["data"] = service_data
        return ha_step
    if kind == "automation":
        # HA-side representation: a placeholder service call. Real execution
        # happens via execute_ziggy_actions when the routine is run.
        return {"service": "notify.persistent_notification",
                "data": {"message": f"[Ziggy] Run automation: {step.get('automation_id', '?')}"}}
    if kind == "notify":
        # Notify uses Ziggy's web-push; we keep an HA-side placeholder so the
        # script remains visible in HA. Real notification lives in execute_ziggy_actions.
        return {"service": "notify.persistent_notification",
                "data": {
                    "message": step.get("message", ""),
                    "title": step.get("title", "Ziggy"),
                }}
    if kind == "delay":
        secs = int(step.get("delay_seconds", 0))
        m, s = divmod(secs, 60)
        h, m = divmod(m, 60)
        return {"delay": f"{h:02d}:{m:02d}:{s:02d}"}
    if kind == "message":
        return {"service": "notify.persistent_notification",
                "data": {"message": step.get("text", "")}}
    if kind == "ziggy_intent":
        label = step.get("virtual_device_name") or step.get("capability", "ziggy_action")
        return {"service": "notify.persistent_notification",
                "data": {"message": f"[Ziggy] Run: {label}", "title": "Ziggy Capability"}}
    if kind == "ir_command":
        label = f"{step.get('ir_device_name', 'IR device')} → {step.get('ir_sequence') or step.get('ir_command', '')}"
        return {"service": "notify.persistent_notification",
                "data": {"message": f"[Ziggy IR] {label}", "title": "Ziggy IR"}}
    return None


# ── HA → Ziggy ────────────────────────────────────────────────────────────────

def _ha_step_to_ziggy(s: dict) -> dict:
    if "service" in s:
        svc = s["service"]
        target = s.get("target") or s.get("data") or {}
        entity_id = target.get("entity_id", "")
        if isinstance(entity_id, list):
            entity_id = entity_id[0] if entity_id else ""
        return {"type": "device", "entity_id": entity_id, "action": svc.split(".")[-1]}
    if "delay" in s:
        d = s["delay"]
        if isinstance(d, str):
            parts = d.split(":")
            secs = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2]) if len(parts) == 3 else 0
        elif isinstance(d, dict):
            secs = d.get("seconds", 0) + d.get("minutes", 0) * 60 + d.get("hours", 0) * 3600
        else:
            secs = 0
        return {"type": "delay", "delay_seconds": secs}
    return {"type": "message", "text": str(s)}


# ── API calls ─────────────────────────────────────────────────────────────────

def list_scripts() -> list:
    # Prefer the WS state cache (ha_subscriber). Falls back to REST only when
    # the cache is empty (early boot, before the subscriber's first snapshot).
    # Same pattern as ha_automations.list_automations — see comment there.
    try:
        from services.ha_subscriber import state_cache
        cache_items = list(state_cache.items()) if state_cache else None
    except Exception:
        cache_items = None

    try:
        if cache_items is None:
            resp = requests.get(f"{HA_URL()}/api/states", headers=HEADERS(), timeout=10)
            if resp.status_code != 200:
                return []
            cache_items = [(s.get("entity_id", ""), s) for s in resp.json()]

        meta_store = _load_routine_meta()
        result = []
        for eid, s in cache_items:
            if not eid.startswith("script."):
                continue
            script_id = eid[len("script."):]
            attrs = s.get("attributes", {}) or {}
            meta = meta_store.get(script_id, {})
            result.append({
                "id": script_id,
                "entity_id": eid,
                "name": attrs.get("friendly_name", script_id),
                "description": attrs.get("description", ""),
                "icon": meta.get("icon") or "⚡",
                "enabled": True,
                "schedule": {"type": "manual"},
                "steps": [],
            })
        return sorted(result, key=lambda x: x["name"])
    except Exception as e:
        log_error(f"[HA Scripts] list: {e}")
        return []


def get_script_for_ui(script_id: str) -> Optional[dict]:
    try:
        resp = requests.get(f"{HA_URL()}/api/config/script/config/{script_id}",
                            headers=HEADERS(), timeout=10)
        if resp.status_code != 200:
            return None
        cfg = resp.json()
        sequence = cfg.get("sequence", [])
        if isinstance(sequence, dict):
            sequence = [sequence]
        from services.local_automation_actions import get_all_saved_actions
        saved_steps = get_all_saved_actions(script_id)
        meta = _get_routine_meta(script_id)
        return {
            "id": script_id,
            "name": cfg.get("alias", script_id),
            "description": cfg.get("description", ""),
            "icon": meta.get("icon") or "⚡",
            "enabled": True,
            "schedule": {"type": "manual"},
            "steps": saved_steps if saved_steps else [_ha_step_to_ziggy(s) for s in sequence],
        }
    except Exception as e:
        log_error(f"[HA Scripts] get_for_ui {script_id}: {e}")
        return None


def save_script(data: dict, script_id: Optional[str] = None) -> dict:
    if not script_id:
        script_id = _dedupe_script_id(_slug(data.get("name", "ziggy_script")))
    sequence = [_step_to_ha(s) for s in data.get("steps", [])]
    sequence = [s for s in sequence if s is not None]
    ha_cfg = {
        "alias": data.get("name", "Ziggy Script"),
        "description": data.get("description", ""),
        "sequence": sequence,
        "mode": "single",
    }
    try:
        resp = requests.post(f"{HA_URL()}/api/config/script/config/{script_id}",
                             headers=HEADERS(), json=ha_cfg, timeout=10)
        if resp.status_code in (200, 201):
            # HA has no icon field on scripts — persist it in our own sidecar
            # so the user's wizard pick survives reload. Stored even when
            # equal to the default "⚡" so deletes (below) work cleanly.
            icon = data.get("icon") or "⚡"
            _set_routine_meta(script_id, {"icon": icon})
            return {"ok": True, "id": script_id}
        return {"ok": False, "error": f"HA {resp.status_code}: {resp.text}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def delete_script(script_id: str) -> bool:
    try:
        resp = requests.delete(f"{HA_URL()}/api/config/script/config/{script_id}",
                               headers=HEADERS(), timeout=10)
        ok = resp.status_code in (200, 204)
        if ok:
            _delete_routine_meta(script_id)
        return ok
    except Exception as e:
        log_error(f"[HA Scripts] delete {script_id}: {e}")
        return False


def run_script(script_id: str) -> bool:
    try:
        resp = requests.post(f"{HA_URL()}/api/services/script/turn_on",
                             headers=HEADERS(),
                             json={"entity_id": f"script.{script_id}"},
                             timeout=10)
        return resp.status_code == 200
    except Exception as e:
        log_error(f"[HA Scripts] run {script_id}: {e}")
        return False
