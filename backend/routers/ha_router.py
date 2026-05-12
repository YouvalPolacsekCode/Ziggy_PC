from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.ws_manager import manager
from core.logger_module import log_info
from core.settings_loader import save_settings, settings
from services.entity_filter import filter_entities
from services.home_automation import get_all_states, get_state, call_service

router = APIRouter()

_DOMAIN_ATTRS: dict[str, list[str]] = {
    "light": [
        "brightness", "color_temp", "min_mireds", "max_mireds",
        "rgb_color", "hs_color", "supported_color_modes", "color_mode",
        "effect", "effect_list", "supported_features",
    ],
    "climate": [
        "hvac_mode", "hvac_modes", "temperature", "current_temperature",
        "fan_mode", "fan_modes", "preset_mode", "preset_modes",
        "swing_mode", "swing_modes",
        "target_humidity", "current_humidity",
        "min_temp", "max_temp", "target_temp_step",
        "supported_features",
    ],
    "media_player": [
        "volume_level", "is_volume_muted", "media_title", "media_artist",
        "source", "source_list", "app_name", "app_list",
        "shuffle", "repeat", "sound_mode", "sound_mode_list",
        "media_content_type", "supported_features",
    ],
    "cover":        ["current_position", "current_tilt_position", "supported_features"],
    "fan":          ["percentage", "preset_mode", "preset_modes", "oscillating", "direction", "supported_features"],
    "vacuum":       ["fan_speed", "fan_speed_list", "battery_level", "supported_features"],
    "input_number": ["min", "max", "step", "mode"],
    "input_select": ["options"],
    "select":       ["options"],
    "sensor":       ["unit_of_measurement", "device_class"],
    "binary_sensor":["device_class"],
}


@router.get("/api/ha/entities")
async def ha_entities(domain: Optional[str] = None, all: bool = False):
    try:
        raw_states = get_all_states()
        if not raw_states and not all:
            raise HTTPException(status_code=502, detail="HA returned no entities")

        raw: list[dict] = []
        for e in raw_states:
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


@router.get("/api/ha/state/{entity_id:path}")
async def ha_state(entity_id: str):
    result = get_state(entity_id)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("message"))
    return result["data"]


class EntityNamePatch(BaseModel):
    name: str


@router.patch("/api/ha/entity/{entity_id:path}/name")
async def patch_entity_name(entity_id: str, body: EntityNamePatch):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name cannot be empty")
    names = settings.setdefault("entity_names", {})
    names[entity_id] = name
    save_settings(settings)
    return {"ok": True, "entity_id": entity_id, "display_name": name}


@router.delete("/api/ha/entity/{entity_id:path}/name")
async def delete_entity_name(entity_id: str):
    names = settings.get("entity_names", {})
    names.pop(entity_id, None)
    save_settings(settings)
    return {"ok": True}


class HaServiceCall(BaseModel):
    domain: str
    service: str
    data: dict = {}


@router.post("/api/ha/service")
async def ha_call_service(body: HaServiceCall):
    result = call_service(body.domain, body.service, body.data)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message", "HA error"))
    return result


class HaControlBody(BaseModel):
    entity_id: str
    action: str
    source: str = "web"


@router.post("/api/ha/control")
async def ha_control(body: HaControlBody):
    if body.action not in ("turn_on", "turn_off"):
        raise HTTPException(status_code=422, detail="action must be 'turn_on' or 'turn_off'")

    domain = body.entity_id.split(".")[0]
    result = call_service(domain, body.action, {"entity_id": body.entity_id})
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message", "HA error"))

    new_state = "on" if body.action == "turn_on" else "off"

    await manager.broadcast({
        "type": "entity_state_changed",
        "entity_id": body.entity_id,
        "state": new_state,
        "source": body.source,
    })

    try:
        from services.pattern_logger import log_event
        log_event(
            intent="toggle_device",
            params={"entity_id": body.entity_id, "turn_on": body.action == "turn_on", "action": body.action},
            result=result,
            source=body.source,
        )
    except Exception:
        pass

    return {"ok": True, "entity_id": body.entity_id, "state": new_state}


@router.get("/api/ha/entity-protocols")
async def ha_entity_protocols():
    """Return {entity_id: protocol} for all entities.

    Protocol values: 'zigbee' | 'zwave' | 'bluetooth' | 'wifi' | 'other'
    Derived by crossing the HA entity registry (entity_id → device_id)
    with the HA device registry (device_id → connections).
    Used by the frontend to group devices by connectivity type.
    """
    try:
        from services.ha_areas import _ws
        devices_res, entities_res = await _ws(
            {"type": "config/device_registry/list"},
            {"type": "config/entity_registry/list"},
        )
        devices = devices_res.get("result") or []
        entities = entities_res.get("result") or []

        # Build device_id → protocol
        def _detect_protocol(connections: list) -> str:
            for kind, _ in connections:
                if kind == "zigbee":       return "zigbee"
                if kind in ("zwave_js", "zwave"):  return "zwave"
                if kind == "bluetooth":    return "bluetooth"
                if kind == "mac":          return "wifi"
                if kind == "upnp":         return "wifi"
            return "other"

        device_protocol: dict[str, str] = {}
        for d in devices:
            device_protocol[d["id"]] = _detect_protocol(d.get("connections") or [])

        # Build entity_id → protocol via device_id
        result: dict[str, str] = {}
        for e in entities:
            eid = e.get("entity_id")
            if not eid:
                continue
            did = e.get("device_id")
            result[eid] = device_protocol.get(did, "other") if did else "other"

        return {"protocols": result}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
