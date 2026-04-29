# backend/server.py
from __future__ import annotations

import os
import tempfile
import threading
from typing import Optional

import requests
import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.ws_manager import manager
from core.action_parser import handle_intent
from core.intent_parser import quick_parse
from core.logger_module import log_error, log_info
from core.memory import list_memory
from core.result_utils import render_result
from core.settings_loader import save_settings, settings
from core.task_file import load_task_json, get_task, patch_task, delete_task as delete_task_file
from services.ha_areas import get_areas, create_area, delete_area, rename_area, assign_entity_to_area, assign_device_to_area, sync_device_area_to_ha
from services.ha_zha import start_permit_join, get_devices as zha_get_devices, get_device_entities, rename_device as zha_rename_device
from services.ha_pairing import (
    start_zwave_inclusion, stop_zwave_inclusion,
    commission_matter, get_pending_config_flows,
    WIFI_INTEGRATIONS,
)
from services.ha_automations import (
    list_automations, get_automation_for_ui, save_automation,
    delete_automation, toggle_automation, trigger_automation,
)
from services.ha_scripts import (
    list_scripts, get_script_for_ui, save_script, delete_script, run_script,
)
from services.entity_filter import filter_entities
from services.home_automation import HEADERS, HA_URL, get_state, call_service
from services.system_tools import get_system_status
from services.task_manager import add_task
from services.event_manager import add_event, list_events, remove_event, days_until_event, next_event, get_all_events
from services.virtual_devices import (
    list_virtual_devices, get_virtual_device, create_virtual_device,
    update_virtual_device, delete_virtual_device, trigger_virtual_device,
)
from services.capability_catalog import get_catalog, get_capability, CATEGORIES
from services.local_automation_actions import save_ziggy_actions, delete_ziggy_actions, execute_ziggy_actions
from services.suggestion_manager import (
    get_all as get_all_suggestions, get_pending as get_pending_suggestions,
    get_by_id as get_suggestion_by_id, update_status as update_suggestion_status,
)
from services.ir_manager import (
    list_ir_devices, get_ir_device, create_ir_device,
    update_ir_device, delete_ir_device,
    list_ir_blasters, send_ir_command, start_learning,
    mark_command_learned,
)

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Ziggy API", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000",
                   "http://localhost:3001", "http://127.0.0.1:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# WebSocket  /ws
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    log_info(f"[API] WebSocket connected. Total: {manager.count}")
    try:
        while True:
            await websocket.receive_text()  # keep-alive / client pings
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        log_info(f"[API] WebSocket disconnected. Total: {manager.count}")


# ---------------------------------------------------------------------------
# Intent  POST /api/intent
# ---------------------------------------------------------------------------

class IntentRequest(BaseModel):
    text: str
    source: str = "web"


@app.post("/api/intent")
async def process_intent(req: IntentRequest):
    intent_data = quick_parse(req.text)
    intent_data["source"] = req.source
    result = await handle_intent(intent_data)
    reply = render_result(result)

    await manager.broadcast({
        "type": "ziggy_response",
        "input": req.text,
        "reply": reply,
        "source": req.source,
        "ok": result.get("ok", True),
        "intent": intent_data.get("intent"),
        "params": intent_data.get("params", {}),
    })

    return {
        "reply": reply,
        "ok": result.get("ok", True),
        "intent": intent_data.get("intent"),
        "params": intent_data.get("params", {}),
        "data": result.get("data", {}),
    }


# ---------------------------------------------------------------------------
# Voice upload  POST /api/voice
# ---------------------------------------------------------------------------

@app.post("/api/voice")
async def process_voice(file: UploadFile = File(...)):
    suffix = ".wav" if "wav" in (file.content_type or "") else ".webm"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name

        # Lazy import — avoids loading Whisper unless voice endpoint is hit
        from interfaces.voice_interface import _translate, transcribe
        transcription, lang = transcribe(tmp_path)

        if not transcription.strip():
            return {"reply": "", "transcription": "", "ok": False, "error": "No speech detected"}

        pipeline_text = transcription
        if lang == "he":
            pipeline_text = _translate(transcription, "en")

        intent_data = quick_parse(pipeline_text)
        intent_data["source"] = "web_voice"
        result = await handle_intent(intent_data)
        reply = render_result(result)

        if lang == "he":
            reply = _translate(reply, "he")

        await manager.broadcast({
            "type": "ziggy_response",
            "input": transcription,
            "reply": reply,
            "source": "web_voice",
            "ok": result.get("ok", True),
        })

        return {"transcription": transcription, "reply": reply, "lang": lang, "ok": result.get("ok", True)}

    except Exception as e:
        log_error(f"[API] Voice error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Devices  GET / POST / DELETE /api/devices
# ---------------------------------------------------------------------------

def _enrich_devices_with_ha_state(devices: list[dict]) -> list[dict]:
    """Add ha_state/ha_attributes/domain/display_name to connected devices."""
    try:
        states = get_all_states()
        state_map = {s["entity_id"]: s for s in states}
    except Exception:
        state_map = {}

    enriched = []
    for d in devices:
        entry = dict(d)
        eid = d.get("entity_id")
        if eid and eid in state_map:
            s = state_map[eid]
            attrs = s.get("attributes", {}) or {}
            entry["ha_state"]      = s.get("state")
            entry["ha_attributes"] = attrs
            entry["domain"]        = eid.split(".")[0]
            entry["friendly_name"] = attrs.get("friendly_name") or eid.split(".")[-1]
            entry["display_name"]  = attrs.get("friendly_name") or d.get("name") or eid.split(".")[-1]
        else:
            entry.setdefault("ha_state", None)
            entry.setdefault("ha_attributes", {})
            entry.setdefault("domain", (eid or "").split(".")[0] if eid else d.get("device_type"))
            entry.setdefault("display_name", d.get("name") or eid or "")
        enriched.append(entry)
    return enriched


@app.get("/api/devices")
async def get_devices():
    try:
        from services.device_registry import get_all, _initialized
        if _initialized:
            return {"devices": _enrich_devices_with_ha_state(get_all())}
    except Exception:
        pass
    return {"devices": [
        {"room": room, "device_type": dtype, "entity_id": eid, "status": "unknown"}
        for room, dtypes in settings.get("device_map", {}).items()
        for dtype, eid in (dtypes or {}).items()
        if eid
    ]}


@app.get("/api/rooms/devices")
async def get_rooms_with_devices():
    """
    Rooms with their devices from DeviceRegistry, enriched with live HA state.
    Rooms are matched to HA areas by normalized name. Includes lost/ir_only/unconfigured.
    Also returns unclaimed devices (no room assigned).
    """
    from services.device_registry import get_all, _initialized

    try:
        ha_rooms = await get_areas()
    except Exception:
        ha_rooms = []

    area_by_norm = {a["name"].lower().replace(" ", "_"): a for a in ha_rooms}

    devices_raw = get_all() if _initialized else []
    devices = _enrich_devices_with_ha_state(devices_raw)

    # Group by room
    room_devices: dict[str, list] = {}
    unclaimed = []
    for d in devices:
        room = d.get("room")
        if not room:
            unclaimed.append(d)
        else:
            room_devices.setdefault(room, []).append(d)

    # Build room list: all rooms that appear in either HA areas or DeviceRegistry
    all_room_keys = set(room_devices.keys()) | {a["name"].lower().replace(" ", "_") for a in ha_rooms}
    rooms_out = []
    for room_key in sorted(all_room_keys):
        area = area_by_norm.get(room_key)
        rooms_out.append({
            "id":      area["id"]   if area else room_key,
            "name":    area["name"] if area else room_key.replace("_", " ").title(),
            "devices": room_devices.get(room_key, []),
        })

    return {"rooms": rooms_out, "unclaimed": unclaimed}


# ---------------------------------------------------------------------------
# Rooms  GET / POST / DELETE /api/rooms  — backed by HA Area Registry
# ---------------------------------------------------------------------------

@app.get("/api/rooms")
async def get_rooms():
    try:
        rooms = await get_areas()
        return {"rooms": rooms}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


class RoomCreate(BaseModel):
    name: str


@app.post("/api/rooms")
async def create_room(body: RoomCreate):
    result = await create_area(body.name)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "HA error"))
    log_info(f"[API] Room created in HA: {body.name}")
    return result


@app.delete("/api/rooms/{area_id}")
async def delete_room(area_id: str):
    result = await delete_area(area_id)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "HA error"))
    log_info(f"[API] Room deleted from HA: {area_id}")
    return result


@app.patch("/api/rooms/{area_id}")
async def rename_room(area_id: str, body: RoomCreate):
    result = await rename_area(area_id, body.name)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "HA error"))
    return result


class EntityAreaPatch(BaseModel):
    area_id: Optional[str] = None


@app.patch("/api/ha/entity/{entity_id:path}/area")
async def patch_entity_area(entity_id: str, body: EntityAreaPatch):
    result = await assign_entity_to_area(entity_id, body.area_id or None)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "HA error"))
    _refresh_device_registry()
    return result


class DeviceAreaPatch(BaseModel):
    area_id: Optional[str] = None


@app.patch("/api/ha/devices/{device_id}/area")
async def patch_device_area(device_id: str, body: DeviceAreaPatch):
    result = await assign_device_to_area(device_id, body.area_id or None)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "HA error"))
    _refresh_device_registry()
    return result


def _refresh_device_registry():
    """Non-blocking DeviceRegistry refresh — called after any area/device change."""
    try:
        from services.device_registry import refresh
        import threading
        threading.Thread(target=refresh, daemon=True).start()
    except Exception:
        pass


class DeviceUpsert(BaseModel):
    room: str
    type: str        # light, temperature, motion, ac, tv, plug_1 …
    entity_id: str
    validate_ha: bool = True


@app.post("/api/devices")
async def upsert_device(device: DeviceUpsert):
    room = device.room.lower().strip().replace(" ", "_")
    dtype = device.type.lower().strip()

    # Optional: verify entity exists in HA
    if device.validate_ha and device.entity_id:
        check = get_state(device.entity_id)
        if not check.get("ok"):
            raise HTTPException(status_code=422, detail=f"Entity '{device.entity_id}' not found in Home Assistant.")

    dm = settings.setdefault("device_map", {})
    dm.setdefault(room, {})[dtype] = device.entity_id
    save_settings(settings)
    log_info(f"[API] Device saved: {room}.{dtype} = {device.entity_id}")

    ha_sync = {"ok": True}
    if device.entity_id:
        ha_sync = await sync_device_area_to_ha(device.entity_id, room)
        if not ha_sync.get("ok"):
            log_info(f"[API] HA area sync skipped: {ha_sync.get('error')}")

    return {"ok": True, "message": f"Saved {room}.{dtype} → {device.entity_id}", "ha_sync": ha_sync}


@app.delete("/api/devices/{room}/{dtype}")
async def delete_device(room: str, dtype: str):
    dm = settings.get("device_map", {})
    if room not in dm or dtype not in dm[room]:
        raise HTTPException(status_code=404, detail="Device not found")
    del settings["device_map"][room][dtype]
    if not settings["device_map"][room]:
        del settings["device_map"][room]
    save_settings(settings)
    return {"ok": True, "message": f"Removed {room}.{dtype}"}


# ---------------------------------------------------------------------------
# HA entity browser  GET /api/ha/entities
# ---------------------------------------------------------------------------

# Attributes to include per domain for the UI controls
_DOMAIN_ATTRS: dict[str, list[str]] = {
    "light": [
        "brightness", "color_temp", "min_mireds", "max_mireds",
        "rgb_color", "supported_color_modes", "effect", "effect_list",
    ],
    "climate": [
        "hvac_mode", "hvac_modes", "temperature", "current_temperature",
        "fan_mode", "fan_modes", "preset_mode", "preset_modes",
        "min_temp", "max_temp", "target_temp_step",
    ],
    "media_player": [
        "volume_level", "is_volume_muted", "media_title", "media_artist",
        "source", "source_list",
    ],
    "cover":        ["current_position", "current_tilt_position"],
    "fan":          ["percentage", "preset_mode", "preset_modes", "oscillating", "direction"],
    "vacuum":       ["fan_speed", "fan_speed_list", "battery_level"],
    "input_number": ["min", "max", "step", "mode"],
    "input_select": ["options"],
    "select":       ["options"],
    "sensor":       ["unit_of_measurement", "device_class"],
    "binary_sensor":["device_class"],
}


@app.get("/api/ha/entities")
async def ha_entities(domain: Optional[str] = None, all: bool = False):
    """
    List HA entities.
    By default applies the entity filter (hidden domains + patterns) and attaches
    a normalized display_name to each result.
    Pass ?all=true to bypass filtering and see every raw HA entity.
    """
    try:
        resp = requests.get(f"{HA_URL}/api/states", headers=HEADERS, timeout=10)
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"HA returned {resp.status_code}")

        raw: list[dict] = []
        for e in resp.json():
            eid = e.get("entity_id", "")
            if domain and not eid.startswith(domain + "."):
                continue
            dom = eid.split(".")[0] if "." in eid else eid
            attrs = e.get("attributes", {})
            entity: dict = {
                "entity_id": eid,
                "state": e.get("state"),
                "friendly_name": attrs.get("friendly_name", ""),
                "domain": dom,
            }
            for key in _DOMAIN_ATTRS.get(dom, []):
                if key in attrs:
                    entity[key] = attrs[key]
            raw.append(entity)

        raw.sort(key=lambda x: x["entity_id"])

        if all:
            return {"entities": raw, "count": len(raw)}

        ef = settings.get("entity_filter", {})
        filtered = filter_entities(
            raw,
            extra_hidden_domains=ef.get("extra_hidden_domains"),
            extra_hidden_patterns=ef.get("extra_hidden_patterns"),
        )

        custom_names: dict = settings.get("entity_names", {})
        for e in filtered:
            if e["entity_id"] in custom_names:
                e["display_name"] = custom_names[e["entity_id"]]

        return {"entities": filtered, "count": len(filtered)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/ha/state/{entity_id:path}")
async def ha_state(entity_id: str):
    result = get_state(entity_id)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("message"))
    return result["data"]


class EntityNamePatch(BaseModel):
    name: str


@app.patch("/api/ha/entity/{entity_id:path}/name")
async def patch_entity_name(entity_id: str, body: EntityNamePatch):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name cannot be empty")
    names = settings.setdefault("entity_names", {})
    if name == "":
        names.pop(entity_id, None)
    else:
        names[entity_id] = name
    save_settings(settings)
    return {"ok": True, "entity_id": entity_id, "display_name": name}


@app.delete("/api/ha/entity/{entity_id:path}/name")
async def delete_entity_name(entity_id: str):
    names = settings.get("entity_names", {})
    names.pop(entity_id, None)
    save_settings(settings)
    return {"ok": True}


class HaServiceCall(BaseModel):
    domain: str
    service: str
    data: dict = {}


@app.post("/api/ha/service")
async def ha_call_service(body: HaServiceCall):
    """Call any Home Assistant service directly from the UI."""
    result = call_service(body.domain, body.service, body.data)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message", "HA error"))
    return result


@app.get("/api/devices/validate")
async def validate_device_map():
    """
    Check every entity_id in device_map against HA's live state registry.
    Returns two lists:
      - valid:   entries that exist in HA (even if state is 'unavailable')
      - missing: entries whose entity_id HA has never heard of
    Does not modify device_map — surfacing only, action is up to the user.
    """
    try:
        resp = requests.get(f"{HA_URL}/api/states", headers=HEADERS, timeout=10)
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"HA returned {resp.status_code}")

        known_ids: set[str] = {e["entity_id"] for e in resp.json()}
        device_map: dict = settings.get("device_map", {})

        valid, missing = [], []
        for room, devices in device_map.items():
            for dtype, entity_id in devices.items():
                if not entity_id:
                    continue
                entry = {"room": room, "type": dtype, "entity_id": entity_id}
                if entity_id in known_ids:
                    valid.append(entry)
                else:
                    missing.append(entry)

        return {
            "valid": valid,
            "missing": missing,
            "summary": {
                "total": len(valid) + len(missing),
                "valid": len(valid),
                "missing": len(missing),
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Tasks  GET / POST /api/tasks
# ---------------------------------------------------------------------------

@app.get("/api/tasks")
async def get_tasks():
    return {"tasks": load_task_json()}


class TaskCreate(BaseModel):
    task: str
    due: Optional[str] = None
    priority: Optional[str] = None
    reminder: Optional[str] = None
    description: Optional[str] = None
    items: Optional[list] = None


class TaskPatch(BaseModel):
    task: Optional[str] = None
    done: Optional[bool] = None
    due: Optional[str] = None
    priority: Optional[str] = None
    description: Optional[str] = None
    items: Optional[list] = None


@app.post("/api/tasks")
async def create_task(body: TaskCreate):
    result = add_task(task=body.task, due=body.due, priority=body.priority, reminder=body.reminder)
    # Patch in description + items after task_manager creates the base record
    tasks = load_task_json()
    if tasks:
        last = tasks[-1]
        updates = {}
        if body.description is not None:
            updates["description"] = body.description
        if body.items is not None:
            updates["items"] = body.items
        if updates:
            patch_task(last["id"], updates)
    return {"ok": True, "result": str(result)}


@app.patch("/api/tasks/{task_id}")
async def update_task(task_id: str, body: TaskPatch):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    updated = patch_task(task_id, updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Task not found")
    return updated


@app.delete("/api/tasks/{task_id}")
async def remove_task_endpoint(task_id: str):
    ok = delete_task_file(task_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Memory  GET /api/memory
# ---------------------------------------------------------------------------

@app.get("/api/memory")
async def get_memory():
    raw = list_memory() or {}
    entries = [{"key": k, "value": v} for k, v in raw.items()] if isinstance(raw, dict) else raw
    return {"memory": entries}


# ---------------------------------------------------------------------------
# Status  GET /api/status
# ---------------------------------------------------------------------------

@app.get("/api/status")
async def status():
    return {
        "ok": True,
        "threads": [t.name for t in threading.enumerate()],
        "system": get_system_status(),
        "ws_clients": manager.count,
        "config": {
            "voice_enabled": settings.get("features", {}).get("voice", True),
            "wakeword_model": settings.get("voice", {}).get("wakeword_model"),
            "ha_url": settings.get("home_assistant", {}).get("url"),
        },
    }


# ---------------------------------------------------------------------------
# Settings (safe subsets)  GET|PATCH /api/settings/voice
# ---------------------------------------------------------------------------

@app.get("/api/settings/voice")
async def get_voice_settings():
    return settings.get("voice", {})


class VoicePatch(BaseModel):
    wakeword_enabled: Optional[bool] = None
    wakeword_threshold: Optional[float] = None
    active_timeout_s: Optional[int] = None
    wakeword_model: Optional[str] = None


@app.patch("/api/settings/voice")
async def patch_voice_settings(patch: VoicePatch):
    voice = settings.setdefault("voice", {})
    for field, val in patch.model_dump(exclude_none=True).items():
        voice[field] = val
    save_settings(settings)
    return {"ok": True, "voice": voice}


@app.get("/api/settings/alerts")
async def get_alert_settings():
    return settings.get("sensor_alerts", {})


# ---------------------------------------------------------------------------
# Automations  GET / POST / PATCH / DELETE /api/automations — backed by HA
# ---------------------------------------------------------------------------

class AutomationBody(BaseModel):
    name: str
    description: Optional[str] = ""
    trigger: Optional[dict] = {}
    actions: Optional[list] = []


class AutomationToggle(BaseModel):
    enabled: bool


@app.get("/api/automations")
async def get_automations():
    return {"automations": list_automations()}


@app.get("/api/automations/{automation_id}")
async def get_automation_by_id(automation_id: str):
    a = get_automation_for_ui(automation_id)
    if not a:
        raise HTTPException(status_code=404, detail="Automation not found")
    return a


@app.post("/api/automations")
async def create_automation_endpoint(body: AutomationBody):
    data = body.model_dump()
    result = save_automation(data)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "HA error"))
    auto_id = result["id"]
    automation = get_automation_for_ui(auto_id) or {"id": auto_id, "name": body.name}
    return {"ok": True, "automation": automation}


@app.patch("/api/automations/{automation_id}/toggle")
async def toggle_automation_endpoint(automation_id: str, body: AutomationToggle):
    ok = toggle_automation(automation_id, body.enabled)
    if not ok:
        raise HTTPException(status_code=502, detail="Failed to toggle automation")
    return {"ok": True, "enabled": body.enabled}


@app.post("/api/automations/{automation_id}/trigger")
async def trigger_automation_endpoint(automation_id: str):
    ok = trigger_automation(automation_id)
    ziggy_results = await execute_ziggy_actions(automation_id)
    if not ok and not ziggy_results:
        raise HTTPException(status_code=502, detail="Failed to trigger automation")
    return {"ok": True, "ziggy_actions": ziggy_results}


@app.delete("/api/automations/{automation_id}")
async def delete_automation_endpoint(automation_id: str):
    if not delete_automation(automation_id):
        raise HTTPException(status_code=404, detail="Automation not found")
    delete_ziggy_actions(automation_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Routines (→ HA Scripts)  GET / POST / DELETE /api/routines
# ---------------------------------------------------------------------------

class RoutineBody(BaseModel):
    name: str
    description: Optional[str] = ""
    icon: Optional[str] = "⚡"
    steps: Optional[list] = []


@app.get("/api/routines")
async def get_routines():
    return {"routines": list_scripts()}


@app.get("/api/routines/{script_id}")
async def get_routine_by_id(script_id: str):
    r = get_script_for_ui(script_id)
    if not r:
        raise HTTPException(status_code=404, detail="Script not found")
    return r


@app.post("/api/routines")
async def create_routine_endpoint(body: RoutineBody):
    data = body.model_dump()
    result = save_script(data)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "HA error"))
    script_id = result["id"]
    save_ziggy_actions(script_id, data.get("steps", []))
    routine = get_script_for_ui(script_id) or {"id": script_id, "name": body.name, "icon": body.icon, "steps": []}
    return {"ok": True, "routine": routine}


@app.post("/api/routines/{script_id}/run")
async def run_routine_endpoint(script_id: str):
    ok = run_script(script_id)
    ziggy_results = await execute_ziggy_actions(script_id)
    if not ok and not ziggy_results:
        raise HTTPException(status_code=502, detail="Failed to run routine")
    return {"ok": True, "ziggy_actions": ziggy_results}


@app.delete("/api/routines/{script_id}")
async def delete_routine_endpoint(script_id: str):
    if not delete_script(script_id):
        raise HTTPException(status_code=404, detail="Script not found")
    delete_ziggy_actions(script_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Scenes  GET /api/ha/scenes  POST /api/ha/scenes/activate
# ---------------------------------------------------------------------------

@app.get("/api/ha/scenes")
async def get_scenes():
    try:
        resp = requests.get(f"{HA_URL}/api/states", headers=HEADERS, timeout=10)
        if resp.status_code != 200:
            return {"scenes": []}
        scenes = []
        for s in resp.json():
            eid = s.get("entity_id", "")
            if not eid.startswith("scene."):
                continue
            attrs = s.get("attributes", {})
            scenes.append({
                "entity_id": eid,
                "name": attrs.get("friendly_name", eid.replace("scene.", "").replace("_", " ").title()),
                "icon": attrs.get("icon", ""),
            })
        return {"scenes": sorted(scenes, key=lambda x: x["name"])}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class SceneActivate(BaseModel):
    entity_id: str


# ---------------------------------------------------------------------------
# ZHA pairing  POST /api/ha/zha/permit  GET /api/ha/devices
#              GET /api/ha/devices/{id}/entities  PATCH /api/ha/devices/{id}/rename
# ---------------------------------------------------------------------------

class ZhaPermitBody(BaseModel):
    duration: int = 60


@app.post("/api/ha/zha/permit")
async def zha_permit(body: ZhaPermitBody):
    result = await start_permit_join(body.duration)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "ZHA error"))
    return result


@app.get("/api/ha/devices")
async def ha_devices():
    devices = await zha_get_devices()
    return {"devices": devices}


@app.get("/api/ha/devices/{device_id}/entities")
async def ha_device_entities(device_id: str):
    entity_ids = await get_device_entities(device_id)
    return {"entity_ids": entity_ids}


class DeviceRename(BaseModel):
    name: str


@app.patch("/api/ha/devices/{device_id}/rename")
async def ha_rename_device(device_id: str, body: DeviceRename):
    result = await zha_rename_device(device_id, body.name)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "HA error"))
    return result


# ---------------------------------------------------------------------------
# Z-Wave pairing  POST /api/ha/zwave/include  POST /api/ha/zwave/stop
# ---------------------------------------------------------------------------

@app.post("/api/ha/zwave/include")
async def zwave_include():
    result = await start_zwave_inclusion()
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "Z-Wave error"))
    return result


@app.post("/api/ha/zwave/stop")
async def zwave_stop():
    await stop_zwave_inclusion()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Matter commissioning  POST /api/ha/matter/commission
# ---------------------------------------------------------------------------

class MatterCommissionBody(BaseModel):
    code: str


@app.post("/api/ha/matter/commission")
async def matter_commission(body: MatterCommissionBody):
    if not body.code.strip():
        raise HTTPException(status_code=422, detail="Setup code is required")
    result = await commission_matter(body.code.strip())
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "Matter error"))
    return result


# ---------------------------------------------------------------------------
# Config flows (Wi-Fi / Broadlink discovery)  GET /api/ha/config_flows
# ---------------------------------------------------------------------------

@app.get("/api/ha/config_flows")
async def ha_config_flows(protocol: Optional[str] = None):
    integrations = None
    if protocol == "wifi":
        integrations = list(WIFI_INTEGRATIONS)
    elif protocol == "broadlink":
        integrations = ["broadlink"]
    return get_pending_config_flows(integrations)


@app.post("/api/ha/scenes/activate")
async def activate_scene(body: SceneActivate):
    try:
        resp = requests.post(
            f"{HA_URL}/api/services/scene/turn_on",
            headers=HEADERS,
            json={"entity_id": body.entity_id},
            timeout=10,
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"HA {resp.status_code}")
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Events  /api/events
# ---------------------------------------------------------------------------

class EventCreate(BaseModel):
    name: str
    date_str: str
    notes: Optional[str] = ""
    repeat: Optional[str] = "none"


class EventRemove(BaseModel):
    name: str


@app.get("/api/events")
async def get_events():
    return {"events": get_all_events()}


@app.post("/api/events")
async def create_event(body: EventCreate):
    result = add_event(body.name, body.date_str, notes=body.notes or "", repeat=body.repeat or "none")
    return {"ok": True, "result": result}


@app.delete("/api/events/{event_name:path}")
async def delete_event_endpoint(event_name: str):
    result = remove_event(event_name)
    if "❌" in result:
        raise HTTPException(status_code=404, detail=result)
    return {"ok": True, "result": result}


@app.get("/api/events/next")
async def get_next_event():
    return {"result": next_event()}


@app.get("/api/events/days-until/{event_name:path}")
async def get_days_until(event_name: str):
    return {"result": days_until_event(event_name)}


# ---------------------------------------------------------------------------
# Capability Catalog  /api/capabilities
# ---------------------------------------------------------------------------

@app.get("/api/capabilities")
async def get_capabilities():
    return {"capabilities": get_catalog(), "categories": CATEGORIES}


@app.get("/api/capabilities/{cap_id}")
async def get_capability_detail(cap_id: str):
    cap = get_capability(cap_id)
    if not cap:
        raise HTTPException(status_code=404, detail="Capability not found")
    return {"id": cap_id, **cap}


# ---------------------------------------------------------------------------
# Virtual Devices  /api/virtual-devices
# ---------------------------------------------------------------------------

class VirtualDeviceCreate(BaseModel):
    name: str
    capability: str
    room: Optional[str] = None
    default_params: Optional[dict] = None
    enabled: bool = True


class VirtualDevicePatch(BaseModel):
    name: Optional[str] = None
    room: Optional[str] = None
    default_params: Optional[dict] = None
    enabled: Optional[bool] = None
    icon: Optional[str] = None


class VirtualDeviceTrigger(BaseModel):
    params: Optional[dict] = None


@app.get("/api/virtual-devices")
async def get_virtual_devices(room: Optional[str] = None, category: Optional[str] = None):
    return {"devices": list_virtual_devices(room=room, category=category)}


@app.get("/api/virtual-devices/{device_id}")
async def get_single_virtual_device(device_id: str):
    device = get_virtual_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Virtual device not found")
    return device


@app.post("/api/virtual-devices")
async def create_vdevice(body: VirtualDeviceCreate):
    try:
        device = create_virtual_device(
            name=body.name,
            capability=body.capability,
            room=body.room,
            default_params=body.default_params,
            enabled=body.enabled,
        )
        return {"ok": True, "device": device}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.patch("/api/virtual-devices/{device_id}")
async def patch_vdevice(device_id: str, body: VirtualDevicePatch):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    device = update_virtual_device(device_id, updates)
    if not device:
        raise HTTPException(status_code=404, detail="Virtual device not found")
    return device


@app.delete("/api/virtual-devices/{device_id}")
async def delete_vdevice(device_id: str):
    ok = delete_virtual_device(device_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Virtual device not found")
    return {"ok": True}


@app.post("/api/virtual-devices/{device_id}/trigger")
async def trigger_vdevice(device_id: str, body: VirtualDeviceTrigger = VirtualDeviceTrigger()):
    result = await trigger_virtual_device(device_id, runtime_params=body.params)
    return result


# ---------------------------------------------------------------------------
# IR Devices  /api/ir/*
# ---------------------------------------------------------------------------

class IrDeviceCreate(BaseModel):
    name: str
    device_type: str
    blaster_entity_id: str
    room: Optional[str] = ""
    brand: Optional[str] = ""
    model: Optional[str] = ""
    aliases: Optional[list] = None
    commands: Optional[dict] = None
    ac_config: Optional[dict] = None


class IrDevicePatch(BaseModel):
    name: Optional[str] = None
    room: Optional[str] = None
    brand: Optional[str] = None
    model: Optional[str] = None
    enabled: Optional[bool] = None
    aliases: Optional[list] = None
    commands: Optional[dict] = None
    ac_config: Optional[dict] = None


class IrLearnBody(BaseModel):
    device_id: str
    command_name: str


class IrSendBody(BaseModel):
    device_id: str
    command: str
    repeats: int = 1


@app.get("/api/ir/blasters")
async def ir_blasters():
    """Return all remote.* entities from HA — physical Broadlink blasters."""
    return {"blasters": list_ir_blasters()}


@app.get("/api/ir/devices")
async def get_ir_devices(room: Optional[str] = None, device_type: Optional[str] = None):
    return {"devices": list_ir_devices(room=room, device_type=device_type, enabled_only=False)}


@app.get("/api/ir/devices/{device_id}")
async def get_single_ir_device(device_id: str):
    device = get_ir_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="IR device not found")
    return device


@app.post("/api/ir/devices")
async def create_ir_device_endpoint(body: IrDeviceCreate):
    try:
        device = create_ir_device(
            name=body.name,
            device_type=body.device_type,
            blaster_entity_id=body.blaster_entity_id,
            room=body.room,
            brand=body.brand or "",
            model=body.model or "",
            aliases=body.aliases,
            commands=body.commands,
            ac_config=body.ac_config,
        )
        return {"ok": True, "device": device}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.patch("/api/ir/devices/{device_id}")
async def patch_ir_device(device_id: str, body: IrDevicePatch):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    device = update_ir_device(device_id, updates)
    if not device:
        raise HTTPException(status_code=404, detail="IR device not found")
    return device


@app.delete("/api/ir/devices/{device_id}")
async def remove_ir_device(device_id: str):
    if not delete_ir_device(device_id):
        raise HTTPException(status_code=404, detail="IR device not found")
    return {"ok": True}


@app.post("/api/ir/learn")
async def ir_learn(body: IrLearnBody):
    """
    Start Broadlink learning mode for a specific device + command.
    User has 20 seconds to press the physical remote button.
    On success the command is marked as learned in the device registry.
    """
    device = get_ir_device(body.device_id)
    if not device:
        raise HTTPException(status_code=404, detail="IR device not found")

    command_map: dict = device.get("commands") or {}
    ha_command = command_map.get(body.command_name, body.command_name)

    result = start_learning(
        blaster_entity=device["blaster_entity_id"],
        device_namespace=device["ha_device_namespace"],
        ha_command=ha_command,
    )
    if result.get("ok"):
        mark_command_learned(body.device_id, body.command_name)

    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message", "Learning mode failed"))
    return result


@app.post("/api/ir/send")
async def ir_send(body: IrSendBody):
    """Test-fire a learned IR command from the setup wizard."""
    result = send_ir_command(body.device_id, body.command, repeats=body.repeats)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message", "Send failed"))
    return result


# ---------------------------------------------------------------------------
# Pattern Learning — Suggestions  /api/suggestions
# ---------------------------------------------------------------------------

class SuggestionSnoozeBody(BaseModel):
    days: int = 3


@app.get("/api/suggestions")
async def api_get_suggestions():
    return {"suggestions": get_all_suggestions()}


@app.get("/api/suggestions/pending")
async def api_get_pending_suggestions():
    pending = get_pending_suggestions()
    return {"suggestions": pending, "count": len(pending)}


@app.post("/api/suggestions/{sug_id}/accept")
async def api_accept_suggestion(sug_id: str):
    if not update_suggestion_status(sug_id, "accepted"):
        raise HTTPException(status_code=404, detail=f"Suggestion {sug_id} not found")
    return {"ok": True}


@app.post("/api/suggestions/{sug_id}/reject")
async def api_reject_suggestion(sug_id: str):
    if not update_suggestion_status(sug_id, "rejected"):
        raise HTTPException(status_code=404, detail=f"Suggestion {sug_id} not found")
    return {"ok": True}


@app.post("/api/suggestions/{sug_id}/snooze")
async def api_snooze_suggestion(sug_id: str, body: SuggestionSnoozeBody):
    if not update_suggestion_status(sug_id, "snoozed", snooze_days=body.days):
        raise HTTPException(status_code=404, detail=f"Suggestion {sug_id} not found")
    return {"ok": True}


@app.post("/api/suggestions/analyze")
async def api_run_pattern_analysis():
    try:
        from services.suggestion_engine import run_analysis
        new = run_analysis()
        return {"ok": True, "new_count": len(new), "suggestions": new}
    except Exception as e:
        log_error(f"[API] Pattern analysis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Server entry point (called from ziggy_main.py)
# ---------------------------------------------------------------------------

def start_api_server():
    port = settings.get("web_interface", {}).get("backend_port", 8001)
    log_info(f"[API] Ziggy API server starting on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
