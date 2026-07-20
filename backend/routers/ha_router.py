from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel

from backend.ws_manager import manager
from core.errors import ErrorCode, ZiggyError, entity_not_found, ha_unavailable
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
        # Vendor-detection hints for the FE remote — `sound_output` is
        # LG webOS-specific (lets us route nav buttons through
        # `webostv.button`); `device_class` separates real TVs from
        # speakers/receivers/etc.
        "sound_output", "device_class",
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
        # Prefer the WS-fed state cache — it's continuously updated by
        # ha_subscriber on every state_changed event. Saves a 100-300 ms
        # /api/states REST round-trip per call. Frontend's fetchAll fires
        # this on every Dashboard / Devices mount, so the saved cost is
        # multiplied across navigations. Fall back to REST only when the
        # cache is cold (first second after subscriber connect).
        from services.ha_subscriber import state_cache
        if state_cache:
            raw_states = [
                {
                    "entity_id":   eid,
                    "state":       entry.get("state"),
                    "attributes":  entry.get("attributes", {}),
                    "last_changed": entry.get("last_changed"),
                }
                for eid, entry in state_cache.items()
            ]
        else:
            raw_states = get_all_states()
        if not raw_states and not all:
            raise ha_unavailable()

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
    except (HTTPException, ZiggyError):
        raise
    except Exception as e:
        raise ha_unavailable(e)


@router.get("/api/ha/state/{entity_id:path}")
async def ha_state(entity_id: str):
    result = get_state(entity_id)
    if not result.get("ok"):
        raise entity_not_found(entity_id)
    return result["data"]


class EntityNamePatch(BaseModel):
    name: str


@router.patch("/api/ha/entity/{entity_id:path}/name")
async def patch_entity_name(entity_id: str, body: EntityNamePatch):
    """Rename an entity.

    Two-layer write:
      1. Local override in settings.yaml's `entity_names` — picked up by
         /api/ha/entities so Ziggy's UI shows the chosen name immediately
         even when HA's registry update is slow/unreachable.
      2. Best-effort push to HA's entity registry via WebSocket so HA-side
         surfaces (HA UI, automations referencing friendly_name, third-party
         integrations reading the entity registry) all agree. HA stores this
         as `name_by_user`, which it surfaces as the entity's friendly_name
         when set, falling back to the integration-provided name otherwise.

    The local override is authoritative for Ziggy's render path. If the HA
    push fails (HA unreachable, entity not in HA's registry yet), we still
    return ok — the user sees their rename inside Ziggy. `ha_renamed` in
    the response tells the caller whether the HA-side push succeeded so
    they can surface a "Ziggy-only" caveat if they want.
    """
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name cannot be empty")
    names = settings.setdefault("entity_names", {})
    names[entity_id] = name
    save_settings(settings)

    ha_renamed = False
    device_renamed = False
    try:
        # Lazy import to avoid pulling the WS helper into modules that only
        # need the read-side of ha_router.
        from services.ha_areas import _ws
        res, = await _ws({
            "type": "config/entity_registry/update",
            "entity_id": entity_id,
            "name": name,
        })
        if res.get("success"):
            ha_renamed = True
            # Look up the entity's parent device_id from the SAME registry
            # call's result so we can cascade the rename to the device too.
            # The response wraps the entry under `result.entity_entry` (not
            # flat under `result` — earlier code missed the nesting and the
            # device cascade silently no-op'd on every rename, leaving
            # tiles/detail-headers that read the device-registry name out
            # of sync with surfaces that read the entity name).
            # When device_id is set, the user thinks of "device" and "entity"
            # as one thing (the lamp, not "the light entity on the lamp"),
            # so renaming one MUST rename the other.
            entry = (res.get("result") or {}).get("entity_entry") or {}
            device_id = entry.get("device_id")
            if device_id:
                try:
                    dev_res, = await _ws({
                        "type": "config/device_registry/update",
                        "device_id": device_id,
                        "name_by_user": name,
                    })
                    if dev_res.get("success"):
                        device_renamed = True
                    else:
                        err = (dev_res.get("error") or {}).get("message", "")
                        log_info(f"[API] patch_entity_name: HA refused device rename {device_id}: {err}")
                except Exception as dev_err:
                    log_info(f"[API] patch_entity_name: device rename failed for {device_id}: {dev_err}")
        else:
            err = (res.get("error") or {}).get("message", "")
            # `not_found` is common for IR-only entities (ir.<id>) that
            # never enrolled in HA's registry — local override still wins.
            if "not_found" not in err.lower():
                log_info(f"[API] patch_entity_name: HA refused rename of {entity_id}: {err}")
    except Exception as e:
        log_info(f"[API] patch_entity_name: HA WS rename failed for {entity_id}: {e}")

    # Bust the registry caches so the next /api/devices/grouped pulls fresh
    # device names instead of serving up to 60s of stale "renamed to Front
    # Door but card still says SONOFF SNZB-04PR2."
    if ha_renamed or device_renamed:
        try:
            from services.ha_areas import invalidate_registry_cache
            invalidate_registry_cache()
        except Exception:
            pass
        try:
            from services.device_groups import invalidate_cache as _invalidate_groups
            _invalidate_groups()
        except Exception:
            pass

    # Notify every connected client (other browser tabs, the mobile shell,
    # the tablet hub) so they pick up the new label without waiting for
    # their next periodic refresh. App.jsx routes this to deviceStore's
    # renameEntity for the same optimistic update we do on the requester
    # side. Local override means the rename is meaningful even when the
    # HA-side push failed (e.g. IR entities), so broadcast unconditionally.
    try:
        await manager.broadcast({
            "type": "entity_renamed",
            "entity_id": entity_id,
            "display_name": name,
        })
    except Exception as e:
        log_info(f"[API] patch_entity_name: rename broadcast failed: {e}")

    return {
        "ok": True,
        "entity_id": entity_id,
        "display_name": name,
        "ha_renamed": ha_renamed,
        "device_renamed": device_renamed,
    }


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


# Domains the app/PWA is allowed to invoke. Default-deny everything else,
# including homeassistant.*, shell_command.*, hassio.*, system_log.*,
# persistent_notification.*, recorder.*, backup.*, etc. — any of which can
# escalate an auth'd-user session into full host takeover.
#
# Founder review pending — adjust here before deploying. `remote` is included
# so IR/RF blasters routed through HA (services/command_router → remote.
# send_command) keep working.
_HA_DOMAIN_ALLOWLIST: set[str] = {
    "light", "switch", "climate", "scene", "script", "automation",
    "input_boolean", "input_select", "input_number",
    "media_player", "cover", "fan", "lock", "vacuum",
    "remote", "notify",
}

# Services that ARE in an allowed domain but are still admin-only — usually
# config-reload paths that can be triggered from automations.yaml only.
_HA_SERVICE_DENYLIST: dict[str, set[str]] = {
    "automation": {"reload"},
    "script":     {"reload"},
    "scene":      {"reload"},
}


def _ha_service_allowed(domain: str, service: str) -> tuple[bool, str]:
    if domain not in _HA_DOMAIN_ALLOWLIST:
        return False, f"domain '{domain}' not in allowlist"
    denied = _HA_SERVICE_DENYLIST.get(domain, set())
    if service in denied:
        return False, f"service '{domain}.{service}' is denied within '{domain}'"
    return True, ""


@router.post("/api/ha/service")
async def ha_call_service(body: HaServiceCall):
    import asyncio as _asyncio
    import time as _t

    # Domain/service allowlist — closes the audit's S3 finding where any
    # authenticated user could call homeassistant.restart, shell_command.*,
    # hassio.*, system_log.*, etc. and take over the HA host.
    ok, reason = _ha_service_allowed(body.domain, body.service)
    if not ok:
        log_info(
            f"[HASvc] BLOCKED {body.domain}.{body.service} — {reason}"
        )
        raise ZiggyError(
            code=ErrorCode.HA_SERVICE_BLOCKED,
            log_message=f"HA service blocked: {body.domain}.{body.service} — {reason}",
            details={
                "domain":  body.domain,
                "service": body.service,
                "reason":  reason,
            },
        )

    # Default-preset injection: a bare light turn_on (no brightness/colour/effect
    # specified) wakes the light in its default preset, if the user set one.
    if body.service == "turn_on" and body.domain == "light":
        eid = body.data.get("entity_id")
        if isinstance(eid, str):
            try:
                from services.device_presets import resolve_default_turn_on
                body.data.update(resolve_default_turn_on(eid, body.data))
            except Exception as _e:
                log_info(f"[HASvc] default-preset resolve skipped for {eid}: {_e}")

    # call_service is sync (requests.post) — running it inline on an async
    # endpoint blocks the event loop for the full HA round-trip (100-300 ms
    # typical, up to several seconds on a slow tunnel or unresponsive
    # Wi-Fi device). Other concurrent requests stall behind it. to_thread
    # frees the loop to keep serving traffic while HA processes the call.
    _t0 = _t.perf_counter()
    result = await _asyncio.to_thread(call_service, body.domain, body.service, body.data)
    _ha_ms = round((_t.perf_counter() - _t0) * 1000, 1)
    if not result.get("ok"):
        # Keep the HA upstream message in `details` for admin debug but never
        # forward it as the public message — it can include raw integration
        # exception text. The default DEVICE_COMMAND_FAILED message is the
        # user-facing fallback.
        raise ZiggyError(
            code=ErrorCode.HA_SERVICE_FAILED,
            log_message=f"HA service call failed: {body.domain}.{body.service} -> {result.get('message')}",
            details={
                "domain": body.domain,
                "service": body.service,
                "upstream_message": result.get("message"),
            },
        )
    entity_id = body.data.get("entity_id", "")
    if entity_id:
        from services.state_memory import record_service_call
        record_service_call(entity_id, body.service, body.data)
    # Surface the HA round-trip in the response so the FE can log
    # click → ack latency without needing matching trace IDs.
    result["_ha_ms"] = _ha_ms
    return result


class HaControlBody(BaseModel):
    entity_id: str
    action: str
    source: str = "web"


@router.post("/api/ha/control")
async def ha_control(body: HaControlBody, background_tasks: BackgroundTasks):
    """Fire-and-forget device control.

    HA's `switch.turn_on` for Switcher (and many Wi-Fi devices) blocks until
    the device acks — 1-3s typical. The FE already updates optimistically,
    so there's no value in blocking the FE on the HA round-trip. We return
    immediately and run the actual service call in a background task. The
    real state change arrives via the WS state_changed broadcast.
    """
    if body.action not in ("turn_on", "turn_off"):
        raise HTTPException(status_code=422, detail="action must be 'turn_on' or 'turn_off'")

    new_state = "on" if body.action == "turn_on" else "off"

    # Optimistic broadcast — FE clients update before HA confirms. Shape
    # must match ha_subscriber's state_changed events (type/new_state/attrs)
    # so App.jsx's WS handler treats them identically.
    await manager.broadcast({
        "type": "state_changed",
        "entity_id": body.entity_id,
        "new_state": new_state,
        "attributes": {},
    })

    async def _run_in_background():
        import asyncio as _asyncio
        loop = _asyncio.get_running_loop()
        result: dict = {"ok": False, "message": "not attempted"}
        try:
            from services.device_registry import get_device_info
            from services.command_router import route_command, resolve_hybrid_entry
            base = get_device_info(body.entity_id) or {}
            # Resolve hybrid entry — works even before registry merge.
            entry = resolve_hybrid_entry(body.entity_id, base)
            if entry.get("ir_device_id"):
                result = await loop.run_in_executor(None, route_command, entry, body.action)
            else:
                domain = body.entity_id.split(".")[0]
                result = await loop.run_in_executor(
                    None, call_service, domain, body.action,
                    {"entity_id": body.entity_id},
                )
        except Exception as e:
            try:
                domain = body.entity_id.split(".")[0]
                result = await loop.run_in_executor(
                    None, call_service, domain, body.action,
                    {"entity_id": body.entity_id},
                )
            except Exception:
                result = {"ok": False, "message": str(e)}

        # If the actual HA call failed, broadcast a corrective state_changed
        # so the FE reverts the optimistic update, and a command_failed event
        # so the FE can surface a toast. Without these, the user's tile sits
        # in the wrong state forever (HA's state never broadcasts a change
        # because the device never acknowledged the command).
        if not result.get("ok"):
            prev_state = "off" if body.action == "turn_on" else "on"
            try:
                await manager.broadcast({
                    "type": "state_changed",
                    "entity_id": body.entity_id,
                    "new_state": prev_state,
                    "attributes": {},
                })
                await manager.broadcast({
                    "type": "command_failed",
                    "entity_id": body.entity_id,
                    "action": body.action,
                    "message": result.get("message", "Device did not respond"),
                })
            except Exception:
                pass

        try:
            from services.state_memory import record_service_call
            record_service_call(body.entity_id, body.action, {"entity_id": body.entity_id})
        except Exception:
            pass

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

    background_tasks.add_task(_run_in_background)
    return {"ok": True, "entity_id": body.entity_id, "state": new_state, "routed_via": None, "queued": True}


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
        raise ha_unavailable(exc)
