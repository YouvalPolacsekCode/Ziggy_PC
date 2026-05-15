from __future__ import annotations

from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from core.settings_loader import save_settings, settings
from .auth_deps import get_current_user, require_role

router = APIRouter(prefix="/api/settings")


def _mask(value: str) -> str:
    if not value:
        return ""
    return "•" * max(0, len(value) - 4) + value[-4:]


# ---------------------------------------------------------------------------
# Home Assistant
# ---------------------------------------------------------------------------

@router.get("/ha")
async def get_ha_settings(_: dict = Depends(require_role("super_admin"))):
    ha = settings.get("home_assistant", {})
    token = ha.get("token", "")
    return {
        "url": ha.get("url", ""),
        "token_masked": _mask(token),
        "token_configured": bool(token),
    }


class HaPatch(BaseModel):
    url: Optional[str] = None
    token: Optional[str] = None


@router.patch("/ha")
async def patch_ha_settings(patch: HaPatch, _: dict = Depends(require_role("super_admin"))):
    ha = settings.setdefault("home_assistant", {})
    for field, val in patch.model_dump(exclude_none=True).items():
        ha[field] = val
    save_settings(settings)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Telegram
# ---------------------------------------------------------------------------

@router.get("/telegram")
async def get_telegram_settings(_: dict = Depends(require_role("super_admin"))):
    tg = settings.get("telegram", {})
    token = tg.get("token", "")
    return {
        "enabled": tg.get("enabled", False),
        "token_masked": _mask(token),
        "token_configured": bool(token),
        "allowed_users": tg.get("allowed_users", []),
        "default_chat_id": tg.get("default_chat_id"),
    }


class TelegramPatch(BaseModel):
    enabled: Optional[bool] = None
    token: Optional[str] = None
    allowed_users: Optional[List[int]] = None
    default_chat_id: Optional[int] = None


@router.patch("/telegram")
async def patch_telegram_settings(patch: TelegramPatch, _: dict = Depends(require_role("super_admin"))):
    tg = settings.setdefault("telegram", {})
    for field, val in patch.model_dump(exclude_none=True).items():
        tg[field] = val
    save_settings(settings)
    return {"ok": True}


# ---------------------------------------------------------------------------
# API keys (OpenAI, SerpAPI, IFTTT)
# ---------------------------------------------------------------------------

@router.get("/integrations")
async def get_integrations(_: dict = Depends(require_role("super_admin"))):
    openai_key = settings.get("openai", {}).get("api_key", "")
    serp_key = settings.get("serpapi", {}).get("api_key", "")
    ifttt_key = settings.get("ifttt", {}).get("webhook_key", "")
    return {
        "openai_key_masked": _mask(openai_key),
        "openai_configured": bool(openai_key),
        "serpapi_key_masked": _mask(serp_key),
        "serpapi_configured": bool(serp_key),
        "ifttt_key_masked": _mask(ifttt_key),
        "ifttt_configured": bool(ifttt_key),
    }


class IntegrationsPatch(BaseModel):
    openai_key: Optional[str] = None
    serpapi_key: Optional[str] = None
    ifttt_key: Optional[str] = None


@router.patch("/integrations")
async def patch_integrations(patch: IntegrationsPatch, _: dict = Depends(require_role("super_admin"))):
    data = patch.model_dump(exclude_none=True)
    if "openai_key" in data:
        settings.setdefault("openai", {})["api_key"] = data["openai_key"]
    if "serpapi_key" in data:
        settings.setdefault("serpapi", {})["api_key"] = data["serpapi_key"]
    if "ifttt_key" in data:
        settings.setdefault("ifttt", {})["webhook_key"] = data["ifttt_key"]
    save_settings(settings)
    return {"ok": True}


# ---------------------------------------------------------------------------
# MQTT
# ---------------------------------------------------------------------------

@router.get("/mqtt")
async def get_mqtt_settings(_: dict = Depends(require_role("super_admin"))):
    mqtt = settings.get("mqtt", {})
    pw = mqtt.get("password", "")
    return {
        "host": mqtt.get("host", ""),
        "port": mqtt.get("port", 1883),
        "username": mqtt.get("username", ""),
        "password_configured": bool(pw),
        "password_masked": _mask(pw),
    }


class MqttPatch(BaseModel):
    host: Optional[str] = None
    port: Optional[int] = None
    username: Optional[str] = None
    password: Optional[str] = None


@router.patch("/mqtt")
async def patch_mqtt_settings(patch: MqttPatch, _: dict = Depends(require_role("super_admin"))):
    mqtt = settings.setdefault("mqtt", {})
    for field, val in patch.model_dump(exclude_none=True).items():
        mqtt[field] = val
    save_settings(settings)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Feature flags
# ---------------------------------------------------------------------------

# Canonical defaults — ensures every flag always appears in GET responses
# even if the YAML predates the flag being added.
_FEATURE_DEFAULTS: dict[str, bool] = {
    "buddy_mode":     True,
    "file_management": True,
    "home_map":       False,
    "ifttt":          True,
    "local_storage":  True,
    "smart_home":     True,
    "task_tracking":  True,
    "telegram":       True,
    "voice":          True,
    "zigbee_support": True,
}


@router.get("/features")
async def get_features(_: dict = Depends(require_role("admin"))):
    stored = settings.get("features", {})
    return {**_FEATURE_DEFAULTS, **stored}


@router.patch("/features")
async def patch_features(request: Request, _: dict = Depends(require_role("super_admin"))):
    """Accept any {flag: bool} pairs — no model needed, no silent drops."""
    body = await request.json()
    features = settings.setdefault("features", {})
    for key, val in body.items():
        if isinstance(val, bool):
            features[key] = val
    save_settings(settings)
    return {"ok": True, "features": features}


# ---------------------------------------------------------------------------
# Debug
# ---------------------------------------------------------------------------

@router.get("/debug")
async def get_debug(_: dict = Depends(require_role("super_admin"))):
    return settings.get("debug", {})


class DebugPatch(BaseModel):
    verbose: Optional[bool] = None
    verbose_logging: Optional[bool] = None


@router.patch("/debug")
async def patch_debug(patch: DebugPatch, _: dict = Depends(require_role("super_admin"))):
    debug = settings.setdefault("debug", {})
    for field, val in patch.model_dump(exclude_none=True).items():
        debug[field] = val
    save_settings(settings)
    return {"ok": True, "debug": debug}


# ---------------------------------------------------------------------------
# Ollama
# ---------------------------------------------------------------------------

@router.get("/ollama")
async def get_ollama(_: dict = Depends(require_role("super_admin"))):
    return settings.get("ollama", {})


class OllamaPatch(BaseModel):
    base_url: Optional[str] = None
    model: Optional[str] = None
    timeout: Optional[int] = None


@router.patch("/ollama")
async def patch_ollama(patch: OllamaPatch, _: dict = Depends(require_role("super_admin"))):
    ollama = settings.setdefault("ollama", {})
    for field, val in patch.model_dump(exclude_none=True).items():
        ollama[field] = val
    save_settings(settings)
    return {"ok": True, "ollama": ollama}


# ---------------------------------------------------------------------------
# Pattern learning
# ---------------------------------------------------------------------------

@router.get("/pattern-learning")
async def get_pattern_learning(_: dict = Depends(require_role("super_admin"))):
    return settings.get("pattern_learning", {})


class PatternLearningPatch(BaseModel):
    enabled: Optional[bool] = None
    llm_synthesis: Optional[bool] = None
    analysis_hour: Optional[int] = None
    lookback_days: Optional[int] = None
    min_occurrences: Optional[int] = None
    max_pending_suggestions: Optional[int] = None
    time_window_minutes: Optional[int] = None
    sequence_gap_minutes: Optional[int] = None


@router.patch("/pattern-learning")
async def patch_pattern_learning(patch: PatternLearningPatch, _: dict = Depends(require_role("super_admin"))):
    pl = settings.setdefault("pattern_learning", {})
    for field, val in patch.model_dump(exclude_none=True).items():
        pl[field] = val
    save_settings(settings)
    return {"ok": True, "pattern_learning": pl}


# ---------------------------------------------------------------------------
# Room aliases
# ---------------------------------------------------------------------------

@router.get("/room-aliases")
async def get_room_aliases(_: dict = Depends(require_role("admin"))):
    return {
        "en": settings.get("room_aliases", {}),
        "he": settings.get("room_aliases_he", {}),
    }


class RoomAliasesPatch(BaseModel):
    en: Optional[Dict[str, str]] = None
    he: Optional[Dict[str, str]] = None


@router.patch("/room-aliases")
async def patch_room_aliases(patch: RoomAliasesPatch, _: dict = Depends(require_role("admin"))):
    if patch.en is not None:
        settings["room_aliases"] = patch.en
    if patch.he is not None:
        settings["room_aliases_he"] = patch.he
    save_settings(settings)
    return {"ok": True}
