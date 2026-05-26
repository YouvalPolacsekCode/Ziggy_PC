from __future__ import annotations

from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from core.settings_loader import save_secrets, save_settings, settings
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
    data = patch.model_dump(exclude_none=True)

    # Non-secret fields persist to settings.yaml.
    if "url" in data:
        ha["url"] = data["url"]
        save_settings(settings)

    # Token is a secret — routed to config/secrets.yaml so it never lands in
    # the tracked settings.yaml even if a later save_settings() call runs.
    if "token" in data:
        ha["token"] = data["token"]
        save_secrets({"home_assistant": {"token": data["token"]}})

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
    "task_tracking":  False,
    "voice":          True,
    "zigbee_support": True,
}


@router.get("/features")
async def get_features(_: dict = Depends(require_role("user"))):
    # Readable by any authenticated user so the FE can gate UI (hide a tab,
    # short-circuit a route) on the same flag the admin toggles. Mutation
    # still requires super_admin via PATCH below.
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
    verbose:         Optional[bool]       = None
    verbose_logging: Optional[bool]       = None
    level:           Optional[str]        = None   # "off"|"basic"|"verbose"|"trace"
    scopes:          Optional[List[str]]  = None   # [] = all scopes


@router.patch("/debug")
async def patch_debug(patch: DebugPatch, _: dict = Depends(require_role("super_admin"))):
    from core.debug_bus import bus as _bus, _LEVEL_VALUES
    debug = settings.setdefault("debug", {})
    for field, val in patch.model_dump(exclude_none=True).items():
        debug[field] = val
    # Apply to live debug bus immediately
    if patch.level is not None and patch.level in _LEVEL_VALUES:
        _bus.set_level(patch.level)
    if patch.scopes is not None:
        _bus.set_scopes(patch.scopes)
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


# ---------------------------------------------------------------------------
# Email (SMTP)
# ---------------------------------------------------------------------------

@router.get("/email")
async def get_email_settings(_: dict = Depends(require_role("super_admin"))):
    em = settings.get("email", {})
    pw = em.get("password", "")
    return {
        "enabled":       em.get("enabled", False),
        "host":          em.get("host", ""),
        "port":          em.get("port", 587),
        "username":      em.get("username", ""),
        "password_configured": bool(pw),
        "password_masked":     _mask(pw),
        "from_address":  em.get("from_address", ""),
        "from_name":     em.get("from_name", "Ziggy"),
    }


class EmailPatch(BaseModel):
    enabled:      Optional[bool] = None
    host:         Optional[str]  = None
    port:         Optional[int]  = None
    username:     Optional[str]  = None
    password:     Optional[str]  = None
    from_address: Optional[str]  = None
    from_name:    Optional[str]  = None


@router.patch("/email")
async def patch_email_settings(patch: EmailPatch, _: dict = Depends(require_role("super_admin"))):
    em = settings.setdefault("email", {})
    for field, val in patch.model_dump(exclude_none=True).items():
        em[field] = val
    save_settings(settings)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Sensor alerts
# ---------------------------------------------------------------------------

@router.get("/sensor-alerts")
async def get_sensor_alerts(_: dict = Depends(require_role("admin"))):
    return settings.get("sensor_alerts", {
        "enabled": True, "cooldown_minutes": 10, "poll_interval_s": 20, "sensors": [],
    })


class SensorAlertsPatch(BaseModel):
    enabled:          Optional[bool]       = None
    cooldown_minutes: Optional[int]        = None
    sensors:          Optional[List[dict]] = None


@router.patch("/sensor-alerts")
async def patch_sensor_alerts(patch: SensorAlertsPatch, _: dict = Depends(require_role("admin"))):
    sa = settings.setdefault("sensor_alerts", {})
    for field, val in patch.model_dump(exclude_none=True).items():
        sa[field] = val
    save_settings(settings)
    return {"ok": True}


@router.post("/email/test")
async def test_email(current: dict = Depends(require_role("super_admin"))):
    """Send a test email to the currently logged-in super_admin."""
    from services.email_sender import is_configured, send
    if not is_configured():
        from fastapi import HTTPException
        raise HTTPException(400, "Email is not configured.")
    ok, err = send(
        to=current["username"],
        subject="Ziggy email test",
        html="<p>Your Ziggy email is working correctly.</p>",
        text="Your Ziggy email is working correctly.",
    )
    return {"ok": ok, "error": err}


# ---------------------------------------------------------------------------
# Anomaly rules
# ---------------------------------------------------------------------------

# Display metadata only (label, description, threshold-key). The severity is
# read from the engine's @register_rule registry at request time so card colour,
# push category, and history row never drift apart.
_RULE_META = [
    {"id": "ANOM-01", "label": "Away + lights on",          "description": "Persons away ≥5 min + lights on with no recent motion",     "config": None},
    {"id": "ANOM-02", "label": "Climate + empty room",       "description": "AC/heat running while room has been empty for a while",     "config": {"key": "anom02_empty_minutes",    "label": "Minutes empty before alert", "default": 30,  "unit": "min"}},
    {"id": "ANOM-03", "label": "Door/window open",           "description": "A door or window left open too long",                       "config": {"key": "anom03_door_open_minutes","label": "Minutes open before alert",  "default": 60,  "unit": "min"}},
    {"id": "ANOM-04", "label": "Motion at night",            "description": "Motion at night while nobody is home",                       "config": None},
    {"id": "ANOM-05", "label": "No motion 24 h",             "description": "No motion anywhere for 24 h while someone is home",         "config": None},
    {"id": "ANOM-06", "label": "Device left on",             "description": "Switch, light or plug left on too long",                    "config": {"key": "anom06_runtime_hours",    "label": "Hours on before alert",      "default": 4,   "unit": "h"}},
    {"id": "ANOM-07", "label": "Automation device offline",  "description": "A device used in an automation went offline/unavailable",   "config": None},
    {"id": "ANOM-08", "label": "Low battery",                "description": "A device's battery is below threshold",                     "config": {"key": "anom08_battery_threshold","label": "Battery % threshold",        "default": 20,  "unit": "%"}},
    {"id": "ANOM-09", "label": "Multiple devices offline",   "description": "Multiple devices offline — possible coordinator failure",   "config": None},
    {"id": "ANOM-10", "label": "Safety sensor silent",       "description": "A smoke / leak / door sensor hasn't reported in a while",   "config": {"key": "anom10_stale_hours",      "label": "Hours silent before alert",  "default": 24,  "unit": "h"}},
]


def _engine_severities() -> dict[str, str]:
    """Map rule_id → severity from the engine's @register_rule registry."""
    try:
        from services.anomaly_engine import _RULES, _ANOM10_RULE
        sev = {r.rule_id: r.severity for r in _RULES}
        sev[_ANOM10_RULE.rule_id] = _ANOM10_RULE.severity
        return sev
    except Exception:
        return {}


@router.get("/anomaly-rules")
async def get_anomaly_rules(_: dict = Depends(require_role("admin"))):
    ae = settings.get("anomaly_engine", {})
    disabled = ae.get("disabled_rules", [])
    severities = _engine_severities()
    rules = []
    for meta in _RULE_META:
        rule = dict(meta)
        rule["severity"] = severities.get(meta["id"], "warning")
        rule["enabled"]  = meta["id"] not in disabled
        if meta["config"]:
            key = meta["config"]["key"]
            rule["config"] = {**meta["config"], "value": ae.get(key, meta["config"]["default"])}
        rules.append(rule)
    return {
        "rules":          rules,
        "engine_enabled": ae.get("enabled", True),
        "exemptions":     ae.get("exemptions", []),
    }


class AnomalyRulesPatch(BaseModel):
    engine_enabled: Optional[bool]       = None
    rules:          Optional[List[dict]] = None  # [{id, enabled, config_value?}]
    exemptions:     Optional[List[str]]  = None  # entity_ids ANOM-06 should ignore


@router.patch("/anomaly-rules")
async def patch_anomaly_rules(body: AnomalyRulesPatch, _: dict = Depends(require_role("admin"))):
    ae = settings.setdefault("anomaly_engine", {})

    if body.engine_enabled is not None:
        ae["enabled"] = body.engine_enabled

    if body.rules:
        disabled = set(ae.get("disabled_rules", []))
        for r in body.rules:
            rid = r.get("id")
            if not rid:
                continue
            if r.get("enabled", True):
                disabled.discard(rid)
            else:
                disabled.add(rid)
            # Update threshold value if provided
            meta = next((m for m in _RULE_META if m["id"] == rid), None)
            if meta and meta["config"] and "config_value" in r:
                ae[meta["config"]["key"]] = r["config_value"]
        ae["disabled_rules"] = sorted(disabled)

    if body.exemptions is not None:
        # De-dup and strip to keep YAML tidy; entity_id format is owner-validated.
        ae["exemptions"] = sorted({e.strip() for e in body.exemptions if e and e.strip()})

    save_settings(settings)
    return {"ok": True}
