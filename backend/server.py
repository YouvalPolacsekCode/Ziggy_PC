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
from core.task_file import load_task_json
from services.home_automation import HEADERS, HA_URL, get_state
from services.system_tools import get_system_status
from services.task_manager import add_task

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
    })

    return {"reply": reply, "ok": result.get("ok", True), "data": result.get("data", {})}


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

@app.get("/api/devices")
async def get_devices():
    return {"device_map": settings.get("device_map", {})}


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
    return {"ok": True, "message": f"Saved {room}.{dtype} → {device.entity_id}"}


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

@app.get("/api/ha/entities")
async def ha_entities(domain: Optional[str] = None):
    try:
        resp = requests.get(f"{HA_URL}/api/states", headers=HEADERS, timeout=10)
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"HA returned {resp.status_code}")
        result = []
        for e in resp.json():
            eid = e.get("entity_id", "")
            if domain and not eid.startswith(domain + "."):
                continue
            result.append({
                "entity_id": eid,
                "state": e.get("state"),
                "friendly_name": e.get("attributes", {}).get("friendly_name", eid),
                "domain": eid.split(".")[0] if "." in eid else eid,
            })
        result.sort(key=lambda x: x["entity_id"])
        return {"entities": result, "count": len(result)}
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


@app.post("/api/tasks")
async def create_task(body: TaskCreate):
    result = add_task(task=body.task, due=body.due, priority=body.priority, reminder=body.reminder)
    return {"ok": True, "result": str(result)}


# ---------------------------------------------------------------------------
# Memory  GET /api/memory
# ---------------------------------------------------------------------------

@app.get("/api/memory")
async def get_memory():
    return {"memory": list_memory()}


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
# Server entry point (called from ziggy_main.py)
# ---------------------------------------------------------------------------

def start_api_server():
    port = settings.get("web_interface", {}).get("backend_port", 8001)
    log_info(f"[API] Ziggy API server starting on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
