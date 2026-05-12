from __future__ import annotations

import threading
from typing import List, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from backend.ws_manager import manager
from core.logger_module import log_info
from core.memory import list_memory
from core.settings_loader import save_settings, settings
from services.system_tools import get_system_status

router = APIRouter()


@router.get("/api/status")
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


@router.get("/api/memory")
async def get_memory():
    raw = list_memory() or {}
    entries = [{"key": k, "value": v} for k, v in raw.items()] if isinstance(raw, dict) else raw
    return {"memory": entries}


# ---------------------------------------------------------------------------
# General settings — language, timezone
# ---------------------------------------------------------------------------

@router.get("/api/settings/general")
async def get_general_settings():
    return {
        "language": settings.get("language", "en"),
        "timezone": settings.get("system", {}).get("timezone", "UTC"),
    }


class GeneralPatch(BaseModel):
    language: Optional[str] = None
    timezone: Optional[str] = None


@router.patch("/api/settings/general")
async def patch_general_settings(patch: GeneralPatch):
    data = patch.model_dump(exclude_none=True)
    if "language" in data:
        settings["language"] = data["language"]
        settings.setdefault("system", {})["language"] = data["language"]
    if "timezone" in data:
        settings.setdefault("system", {})["timezone"] = data["timezone"]
    save_settings(settings)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Voice settings
# ---------------------------------------------------------------------------

@router.get("/api/settings/voice")
async def get_voice_settings():
    return settings.get("voice", {})


class VoicePatch(BaseModel):
    enabled: Optional[bool] = None
    wakeword_enabled: Optional[bool] = None
    wakeword_threshold: Optional[float] = None
    active_timeout_s: Optional[int] = None
    wakeword_model: Optional[str] = None
    speed: Optional[float] = None


@router.patch("/api/settings/voice")
async def patch_voice_settings(patch: VoicePatch):
    voice = settings.setdefault("voice", {})
    for field, val in patch.model_dump(exclude_none=True).items():
        voice[field] = val
    save_settings(settings)
    return {"ok": True, "voice": voice}


# ---------------------------------------------------------------------------
# Anomaly engine settings
# ---------------------------------------------------------------------------

@router.get("/api/settings/anomaly")
async def get_anomaly_settings():
    return settings.get("anomaly_engine", {})


class AnomalyPatch(BaseModel):
    enabled: Optional[bool] = None
    quiet_hour_start: Optional[int] = None
    quiet_hour_end: Optional[int] = None


@router.patch("/api/settings/anomaly")
async def patch_anomaly_settings(patch: AnomalyPatch):
    anomaly = settings.setdefault("anomaly_engine", {})
    for field, val in patch.model_dump(exclude_none=True).items():
        anomaly[field] = val
    save_settings(settings)
    return {"ok": True, "anomaly_engine": anomaly}


# ---------------------------------------------------------------------------
# Sensor alert rules
# ---------------------------------------------------------------------------

@router.get("/api/settings/alerts")
async def get_alert_settings():
    return settings.get("sensor_alerts", {})


class AlertSensorModel(BaseModel):
    entity_id: str
    label: str
    message: str
    trigger_state: str


class AlertsPatch(BaseModel):
    enabled: Optional[bool] = None
    cooldown_minutes: Optional[int] = None
    sensors: Optional[List[AlertSensorModel]] = None


@router.patch("/api/settings/alerts")
async def patch_alert_settings(patch: AlertsPatch):
    alerts = settings.setdefault("sensor_alerts", {})
    data = patch.model_dump(exclude_none=True)
    for field, val in data.items():
        if field == "sensors":
            alerts["sensors"] = [s.model_dump() for s in (patch.sensors or [])]
        else:
            alerts[field] = val
    save_settings(settings)
    return {"ok": True, "sensor_alerts": alerts}
