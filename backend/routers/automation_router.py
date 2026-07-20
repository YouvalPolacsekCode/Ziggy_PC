from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from core.logger_module import log_info
from core.debug_bus import bus as _bus, BASIC as _BASIC, VERBOSE as _VERBOSE
from services.ha_automations import (
    list_automations as ha_list_automations,
    get_automation_for_ui,
    save_automation,
    delete_automation as ha_delete_automation,
    toggle_automation,
    get_automation_traces,
    get_trace_detail,
)
from services.local_automation_actions import (
    delete_ziggy_actions,
    execute_ziggy_actions,
    delete_automation_meta,
    get_automation_meta,
    save_automation_meta,
)
from services.automation_history import get_history, delete_history

router = APIRouter()


class AutomationBody(BaseModel):
    id: Optional[str] = None
    name: str
    description: Optional[str] = ""
    trigger: Optional[dict] = {}
    actions: Optional[list] = []
    rooms: Optional[list] = []
    # Declared explicitly so the wizard's condition list and run-mode reach
    # save_automation() (Pydantic v2 drops undeclared fields on model_dump).
    # save_automation already reads data["conditions"] / data["mode"].
    conditions: Optional[list] = []
    mode: Optional[str] = "single"


class OccupancySensorBody(BaseModel):
    """Create a Ziggy smart presence sensor that fuses motion / presence /
    door-recently-open into one 'is anyone here' entity. Thin wrapper over the
    same handler the LLM's create_occupancy_sensor tool routes to."""
    room: str
    sensor_entities: Optional[list] = []
    friendly_name: Optional[str] = None
    delay_off_seconds: Optional[int] = 30


class AutomationToggle(BaseModel):
    enabled: bool


class AutomationRoomsPatch(BaseModel):
    rooms: list[str]


class AutomationSnooze(BaseModel):
    minutes: int


@router.get("/api/automations")
async def get_automations():
    # ha_list_automations() does a sync `requests.get` against HA's REST
    # /api/states (10s timeout). Without to_thread, every Automations page
    # load froze the FastAPI event loop for the full HA response time —
    # piling up other requests behind it. Wrapping releases the loop while
    # HA replies.
    autos = await asyncio.to_thread(ha_list_automations)
    return {"automations": autos}


# Cap-map cache. detect_capabilities() iterates every HA state + IR device
# and runs every capability rule against each. The result only changes when
# entities or IR devices are added/removed (capabilities are intrinsic to
# device_class, not to runtime state). Cache fingerprinted by the entity_id
# set + ir-device id list so a per-state tick doesn't invalidate. Templates
# page mount used to fire two heavy rebuilds in parallel.
_CAP_CACHE_TTL_S = 30.0
_cap_cache_value: dict | None = None
_cap_cache_fp: tuple = ()
_cap_cache_ts: float = 0.0


def _cap_snapshot(all_states, ir_devices=None):
    """Return detect_capabilities() result, cached by entity+IR-device fingerprint."""
    import time as _t
    from services.capability_matcher import detect_capabilities

    global _cap_cache_value, _cap_cache_fp, _cap_cache_ts
    ir_devices = ir_devices or []

    # Fingerprint: cheap-to-build set/tuple over identities, not state values.
    # If two snapshots have the same entities and same IR devices, the cap_map
    # is identical regardless of what state any individual entity is in.
    fp = (
        frozenset(s.get("entity_id", "") for s in all_states),
        tuple(sorted(d.get("id", "") for d in ir_devices)),
    )
    now = _t.monotonic()
    if (_cap_cache_value is not None
            and _cap_cache_fp == fp
            and now - _cap_cache_ts < _CAP_CACHE_TTL_S):
        return _cap_cache_value

    _cap_cache_value = detect_capabilities(all_states, ir_devices)
    _cap_cache_fp = fp
    _cap_cache_ts = now
    return _cap_cache_value


def invalidate_capability_cache() -> None:
    """Force the next call to /api/automations/templates* to rebuild cap_map.

    Call after device_registry refresh, IR device pair/unpair, etc.
    """
    global _cap_cache_value, _cap_cache_ts
    _cap_cache_value = None
    _cap_cache_ts = 0.0


def _enrich_template(tmpl, cap_map, existing_names=None, signal_fires=None):
    """Return the serialisable template dict with all computed fields.

    signal_fires: optional {template_id: fire_record} from
    pattern_detector.get_active_template_signals(). When present, templates
    whose habit_signal is currently firing get an extra `habit_signal_fired`
    field so the Suggested tab can surface them with a re-surfacing badge.
    """
    from services.automation_templates import (
        build_prefill, can_run as tmpl_can_run,
        get_matched_caps, get_missing_required, get_missing_optional, friendly_cap, short_cap,
    )

    runnable   = tmpl_can_run(tmpl, cap_map)
    matched    = get_matched_caps(tmpl, cap_map)
    miss_req   = get_missing_required(tmpl, cap_map)
    miss_opt   = get_missing_optional(tmpl, cap_map)
    prefill    = build_prefill(tmpl, cap_map) if runnable else None

    # Friendly labels split into what you have vs. what's missing
    # `short` is the bare device name for the friendly "Needs a X" card line;
    # `label` keeps the fuller description for anywhere that still wants it.
    matched_labels = [
        {"cap": c, "label": friendly_cap(tmpl, c), "short": short_cap(c), "entity": (cap_map.get(c) or [None])[0]}
        for c in matched
    ]
    missing_req_labels = [{"cap": c, "label": friendly_cap(tmpl, c), "short": short_cap(c)} for c in miss_req]
    missing_opt_labels = [{"cap": c, "label": friendly_cap(tmpl, c), "short": short_cap(c)} for c in miss_opt]

    already_exists = False
    if existing_names is not None:
        already_exists = tmpl["name"].lower() in existing_names

    # Readiness tier: ready | partial | unavailable
    relevant = tmpl.get("relevant_capabilities", [])
    if runnable:
        tier = "ready"
    elif matched:
        tier = "partial"
    elif not relevant:
        tier = "ready"          # no requirements (device_offline_alert)
    else:
        tier = "unavailable"

    enriched = {
        **tmpl,
        "can_run":             runnable,
        "tier":                tier,
        "wizard_prefill":      prefill,
        "matched_labels":      matched_labels,
        "missing_req_labels":  missing_req_labels,
        "missing_opt_labels":  missing_opt_labels,
        "already_exists":      already_exists,
    }

    # Attach habit_signal fire info if this template's curated signal is
    # currently firing. The frontend uses this to add a "we noticed you keep
    # doing X" re-surfacing badge on top of the regular Suggested card.
    if signal_fires and tmpl.get("id") in signal_fires:
        enriched["habit_signal_fired"] = signal_fires[tmpl["id"]]

    return enriched


def _safe_list_automations() -> list:
    """Wrap ha_list_automations so a transient HA failure (during the
    parallel fetch in get_suggested_templates) doesn't break the page."""
    try:
        return ha_list_automations() or []
    except Exception:
        return []


def _safe_signal_fires() -> dict:
    """Wrap get_active_template_signals so a broken events.jsonl or
    pattern_detector import failure can't take down the templates endpoint.
    Returns {template_id: fire_record} on success, {} on any failure."""
    try:
        from services.pattern_detector import get_active_template_signals
        return get_active_template_signals() or {}
    except Exception:
        return {}


@router.get("/api/automations/templates")
async def get_automation_templates():
    """Return the full curated template library with runability flags."""
    from services.automation_templates import TEMPLATES
    from services.home_automation import get_all_states

    # Sync HA REST call — release the event loop while HA replies.
    all_states = await asyncio.to_thread(get_all_states)
    ir_devices: list = []
    try:
        from services.ir_manager import list_ir_devices
        ir_devices = list_ir_devices()
    except Exception:
        pass
    cap_map = _cap_snapshot(all_states, ir_devices)
    signal_fires = _safe_signal_fires()

    return {"templates": [_enrich_template(t, cap_map, signal_fires=signal_fires) for t in TEMPLATES]}


# ── Community templates (HA Blueprints, surfaced as Ziggy templates) ────────
#
# Session C. The list endpoint serves a flat catalogue of all bundled
# blueprints, plus any user-loaded ones from the current process. The
# instantiate endpoint creates an automation from a chosen template + a
# filled inputs map, routed through the same save_automation pipeline as
# every other automation creation path. The import endpoint accepts pasted
# YAML for a one-off ad-hoc template (NOT persisted to disk — security
# boundary).

class BlueprintInstantiateBody(BaseModel):
    blueprint_id: str
    inputs:       dict
    name:         Optional[str] = None


class BlueprintImportBody(BaseModel):
    yaml: str


@router.get("/api/blueprints")
async def list_blueprints_endpoint():
    """All bundled + session-loaded community templates, in the same template
    dict shape the curated /api/automations/templates endpoint returns so
    the frontend can reuse TemplateCard.
    """
    from services.automation_templates import get_blueprint_templates
    templates = await asyncio.to_thread(get_blueprint_templates)
    return {"templates": templates}


@router.get("/api/blueprints/{blueprint_id}")
async def get_blueprint_endpoint(blueprint_id: str):
    """Full detail (including the inputs list) for one template."""
    from services.blueprint_importer import get_blueprint
    bp = await asyncio.to_thread(get_blueprint, blueprint_id)
    if not bp:
        raise HTTPException(status_code=404, detail="Template not found")
    return bp.to_dict()


@router.post("/api/blueprints/{blueprint_id}/instantiate")
async def instantiate_blueprint_endpoint(blueprint_id: str, body: BlueprintInstantiateBody):
    """Create an automation from a community template + filled inputs.

    Mirrors the validation contract of the LLM handler: 400 on missing
    inputs / unknown template, 502 on HA save failure, 200 on success.
    """
    from services.blueprint_importer import instantiate_blueprint, get_blueprint
    bp = await asyncio.to_thread(get_blueprint, blueprint_id)
    if not bp:
        raise HTTPException(status_code=404, detail="Template not found")
    try:
        automation_data = await asyncio.to_thread(
            instantiate_blueprint, blueprint_id, body.inputs or {}, name=body.name,
        )
    except ValueError as e:
        # Friendly validation message — surface to the user as-is.
        raise HTTPException(status_code=400, detail=str(e))
    result = await asyncio.to_thread(save_automation, automation_data)
    if not result.get("ok"):
        _bus.emit("automation", _BASIC, "blueprint_instantiate_failed",
                  blueprint_id=blueprint_id, name=automation_data.get("name"),
                  result="error", error=result.get("error"))
        raise HTTPException(status_code=502, detail=result.get("error", "Save failed"))
    _bus.emit("automation", _BASIC, "blueprint_instantiated",
              blueprint_id=blueprint_id, automation_id=result.get("id"),
              name=automation_data.get("name"), result="ok")
    return {
        "ok":            True,
        "automation_id": result.get("id"),
        "source":        result.get("source"),
        "blueprint_id":  blueprint_id,
        "name":          automation_data.get("name"),
    }


# ── Ziggy Pro Mode bundle endpoints (D3) ─────────────────────────────────────


class BundleDesignBody(BaseModel):
    outcome: str
    language: Optional[str] = None


class BundleApplyBody(BaseModel):
    bundle: dict


@router.post("/api/automations/bundles/design")
async def design_bundle_endpoint(body: BundleDesignBody):
    """Design a Ziggy Pro Mode bundle from a natural-language outcome.

    Returns the bundle JSON as a PREVIEW — nothing is created until the
    client POSTs to /apply with the bundle. Mirrors the LLM tool path
    (design_automation_set) for clients that want direct REST access.
    """
    from services.orchestra_designer import design_bundle
    result = await asyncio.to_thread(design_bundle, body.outcome, body.language)
    if not result.get("ok"):
        # Return 400 but keep the bundle (if any) so the caller can see what
        # the LLM produced even when validation rejected it.
        raise HTTPException(status_code=400, detail={
            "error":  result.get("error", "Designer failed."),
            "bundle": result.get("bundle"),
            "raw":    result.get("raw_preview"),
        })
    return result


@router.post("/api/automations/bundles/apply")
async def apply_bundle_endpoint(body: BundleApplyBody):
    """Execute a previously-designed bundle (user accepted the preview).

    Idempotent in the failure case: artifacts that succeed are kept, ones
    that fail are reported in errors[]. The caller can re-POST a corrected
    bundle without first deleting successful items.
    """
    from services.bundle_executor import execute_bundle
    result = await asyncio.to_thread(execute_bundle, body.bundle)
    # Even on partial failure (ok=False but some created), return 200 so the
    # client can render per-artifact pass/fail. Reserve non-200 for input
    # errors only (e.g. malformed bundle, which the executor doesn't validate
    # — Pydantic already enforces the bundle dict shape at the API boundary).
    return result


class SmartRoomDesignBody(BaseModel):
    room: str
    occupancy_entity: Optional[str] = None
    language: Optional[str] = None
    options: Optional[dict] = None


@router.post("/api/automations/smart-room/design")
async def design_smart_room_endpoint(body: SmartRoomDesignBody):
    """Design the deterministic Smart Room recipe (sleeping-wife orchestra) for a
    room. Returns the same bundle shape as /bundles/design (apply via
    /bundles/apply). Unlike the LLM designer this is a fixed, reliable recipe.

    If the room has no fused occupancy sensor and none was passed, returns
    {ok: false, needs_occupancy: true} so the UI opens the presence-sensor
    creation modal first, then retries with the new entity_id.
    """
    from services.smart_room_recipe import build_smart_room_bundle
    lang = body.language or ("he" if any('֐' <= c <= '׿' for c in body.room) else "en")
    result = await asyncio.to_thread(
        build_smart_room_bundle,
        body.room,
        occupancy_entity=body.occupancy_entity,
        language=lang,
        options=body.options,
    )
    # needs_occupancy and decline are both 200 responses the client renders;
    # only a hard unknown-room is an error.
    if not result.get("ok") and result.get("error", "").startswith("unknown room"):
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@router.delete("/api/automations/smart-room/{room}")
async def delete_smart_room_endpoint(room: str):
    """Tear down a room's Smart Room automations (the 3 ziggy_smart_room_<room>_*
    rules) + the sleep flag + good-night/morning voice. KEEPS the fused presence
    sensor (reusable). Mirrors the Circadian bundle delete."""
    from services.room_alias_bank import resolve_room
    from services.ha_automations import delete_automation as ha_delete_automation
    from core.automation_file import delete_automation as ziggy_delete_automation
    from services.local_automation_actions import (
        delete_ziggy_actions, delete_automation_meta, set_local_state,
    )
    slug = resolve_room((room or "").lower().strip())
    removed: list[str] = []
    for part in ("day", "night", "off"):
        aid = f"ziggy_smart_room_{slug}_{part}"
        try:
            ha_ok = await asyncio.to_thread(ha_delete_automation, aid)
            z_ok = ziggy_delete_automation(aid)
            delete_ziggy_actions(aid)
            delete_automation_meta(aid)
            if ha_ok or z_ok:
                removed.append(aid)
        except Exception:
            pass
    # Clear the sleep flag (keep the KV key, just reset it) + drop voice phrases.
    try:
        set_local_state("modes", f"{slug}_sleep", False)
    except Exception:
        pass
    try:
        from services.voice_intents import unregister_voice_intent
        for ph in ("good night", "good morning", "לילה טוב", "בוקר טוב"):
            await asyncio.to_thread(unregister_voice_intent, ph)
    except Exception:
        pass
    _bus.emit("automation", _BASIC, "smart_room_deleted", room=slug,
              removed=len(removed), result="ok")
    return {"ok": True, "room": slug, "removed": removed, "kept_presence_sensor": True}


@router.post("/api/blueprints/import")
async def import_blueprint_endpoint(body: BlueprintImportBody):
    """Parse a user-pasted blueprint YAML string and register it in the
    in-process catalogue. NOT persisted to disk — survives only for the
    current Ziggy process (security boundary; the operator must drop the
    file under services/bundled_blueprints/ to make it permanent).
    """
    from services.blueprint_importer import load_user_blueprint
    try:
        bp = await asyncio.to_thread(load_user_blueprint, body.yaml)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    _bus.emit("automation", _BASIC, "blueprint_imported",
              blueprint_id=bp.id, name=bp.name, source="user", result="ok")
    return {"ok": True, "blueprint": bp.to_dict()}


@router.get("/api/automations/templates/suggested")
async def get_suggested_templates():
    """Return templates that match the user's installed devices, with pre-filled wizard data."""
    from services.automation_templates import TEMPLATES, matches_suggestion
    from services.home_automation import get_all_states

    # Both calls below hit HA REST sync. Run them in parallel via threads so
    # the page (Dashboard mounts this) doesn't pay them serially.
    all_states, existing_autos = await asyncio.gather(
        asyncio.to_thread(get_all_states),
        asyncio.to_thread(lambda: _safe_list_automations()),
    )
    ir_devices: list = []
    try:
        from services.ir_manager import list_ir_devices
        ir_devices = list_ir_devices()
    except Exception:
        pass
    cap_map = _cap_snapshot(all_states, ir_devices)
    signal_fires = _safe_signal_fires()

    existing_names: set = {(a.get("name") or "").lower() for a in existing_autos}

    suggested = [
        _enrich_template(t, cap_map, existing_names, signal_fires=signal_fires)
        for t in TEMPLATES
        if matches_suggestion(t, cap_map) or t.get("id") in signal_fires
    ]
    # Sort: ready first, then partial, then unavailable
    order = {"ready": 0, "partial": 1, "unavailable": 2}
    suggested.sort(key=lambda t: order.get(t["tier"], 3))

    return {"suggested": suggested}


# ── Circadian Lighting bundle ────────────────────────────────────────────────
# The "Smart Light Schedule" suggestion (D1) expands to 4 HA automations
# (sunrise / solar-noon / sunset / bedtime). The standard wizard speaks the
# single-trigger schema only, so Configure on this suggestion routes here
# instead. The bundle is idempotent — re-saving overwrites the same HA IDs.

class CircadianBundleBody(BaseModel):
    lights:  list[str]
    bedtime: Optional[str] = "22:00"
    # True → the schedule turns lights ON at each phase (user expectation).
    # False → only re-tints lights already on. Defaults True.
    auto_on: Optional[bool] = True


@router.get("/api/automations/circadian-bundle")
async def get_circadian_bundle():
    from services.circadian_builder import get_bundle
    return await asyncio.to_thread(get_bundle)


@router.post("/api/automations/circadian-bundle")
async def save_circadian_bundle(body: CircadianBundleBody):
    from services.circadian_builder import save_bundle
    auto_on = True if body.auto_on is None else bool(body.auto_on)
    result = await asyncio.to_thread(save_bundle, body.lights, body.bedtime or "22:00", auto_on)
    if not result.get("ok"):
        _bus.emit("automation", _BASIC, "circadian_bundle_save_failed",
                  light_count=len(body.lights), bedtime=body.bedtime,
                  failed=[f.get("id") for f in result.get("failed", [])],
                  result="error")
        raise HTTPException(status_code=502, detail=result)
    _bus.emit("automation", _BASIC, "circadian_bundle_saved",
              light_count=len(body.lights), bedtime=body.bedtime,
              saved=result.get("saved", []), result="ok")
    return {"ok": True, **result}


@router.delete("/api/automations/circadian-bundle")
async def delete_circadian_bundle():
    from services.circadian_builder import delete_bundle
    result = await asyncio.to_thread(delete_bundle)
    _bus.emit("automation", _BASIC, "circadian_bundle_deleted",
              deleted=result.get("deleted", []),
              missed=result.get("missed", []), result="ok")
    return result


# ── Smart Light Schedule — continuous adaptive ramp (2026-07-20) ─────────────
# Replaces the 4-automation bundle above with a Ziggy-driven ramp engine. Two
# anchors (day peak / night floor) + wake/bedtime; applied on light turn-on and
# every ~10 min, respecting manual override. See services/circadian_engine.py.

class CircadianAnchor(BaseModel):
    kelvin: int
    pct:    int


class CircadianConfigBody(BaseModel):
    lights:  list[str]
    peak:    Optional[CircadianAnchor] = None
    floor:   Optional[CircadianAnchor] = None
    wake:    Optional[str] = None
    bedtime: Optional[str] = None
    # None → enabled iff there are lights. Pass explicitly to pause/resume
    # without losing the config (the card's toggle).
    enabled: Optional[bool] = None


@router.get("/api/automations/circadian")
async def get_circadian():
    """Config + the current ramp point right now + any hand-overridden lights."""
    from services.circadian_engine import status
    return await asyncio.to_thread(status)


@router.post("/api/automations/circadian")
async def save_circadian(body: CircadianConfigBody):
    from services.circadian_engine import save_config, sync_now, DEFAULTS
    cfg = {
        "enabled": bool(body.lights) if body.enabled is None else bool(body.enabled),
        "lights":  body.lights,
        "peak":    body.peak.model_dump()  if body.peak  else DEFAULTS["peak"],
        "floor":   body.floor.model_dump() if body.floor else DEFAULTS["floor"],
        "wake":    body.wake    or DEFAULTS["wake"],
        "bedtime": body.bedtime or DEFAULTS["bedtime"],
    }
    saved = await asyncio.to_thread(save_config, cfg)
    # Retire the legacy 4-automation bundle so the two don't both drive the lights.
    try:
        from services.circadian_builder import delete_bundle
        await asyncio.to_thread(delete_bundle)
    except Exception:
        pass
    applied = await asyncio.to_thread(sync_now) if (cfg["enabled"] and body.lights) else {}
    _bus.emit("automation", _BASIC, "circadian_saved",
              light_count=len(body.lights), applied=applied.get("applied"), result="ok")
    return {"ok": True, "config": saved, "applied": applied}


@router.delete("/api/automations/circadian")
async def delete_circadian():
    from services.circadian_engine import save_config, DEFAULTS
    from services.circadian_builder import delete_bundle
    await asyncio.to_thread(delete_bundle)               # sweep any legacy automations too
    saved = await asyncio.to_thread(save_config, {**DEFAULTS, "enabled": False, "lights": []})
    _bus.emit("automation", _BASIC, "circadian_deleted", result="ok")
    return {"ok": True, "config": saved}


@router.post("/api/automations/circadian/sync")
async def sync_circadian():
    """Play button — re-enroll all scheduled lights and snap them to now."""
    from services.circadian_engine import sync_now
    result = await asyncio.to_thread(sync_now)
    _bus.emit("automation", _BASIC, "circadian_synced",
              applied=result.get("applied"), result="ok")
    return result


# ── Smart Climate Control — Ziggy-as-thermostat (2026-07-20) ─────────────────
# Per-room hysteresis engine: watch a temperature reading, switch a device
# on/off with a deadband. No setpoint is sent to the device — Ziggy owns the
# cutoff. Cooling and/or heating edge per room. See services/smart_climate_engine.py.

class ClimateDevice(BaseModel):
    kind: str                    # "climate" | "ir_ac" | "fan" | "switch"
    id:   str
    name: Optional[str] = ""
    room: Optional[str] = ""


class ClimateEdge(BaseModel):
    device: ClimateDevice
    on:     float
    off:    float


class ClimateRoomBody(BaseModel):
    room:     str
    roomName: Optional[str] = None
    sensor:   str
    # Non-empty → watch the AVERAGE of these sensors instead of `sensor`.
    sensors:  Optional[list[str]] = None
    cooling:  Optional[ClimateEdge] = None
    heating:  Optional[ClimateEdge] = None
    enabled:  Optional[bool] = True


@router.get("/api/automations/smart_climate")
async def get_smart_climate():
    """All configured rooms + each room's live temperature and believed on/off state."""
    from services.smart_climate_engine import status
    return await asyncio.to_thread(status)


@router.post("/api/automations/smart_climate")
async def save_smart_climate(body: ClimateRoomBody):
    from services.smart_climate_engine import save_room, sync_room
    saved = await asyncio.to_thread(
        save_room, body.room,
        sensor=body.sensor,
        sensors=body.sensors,
        cooling=body.cooling.model_dump() if body.cooling else None,
        heating=body.heating.model_dump() if body.heating else None,
        enabled=True if body.enabled is None else bool(body.enabled),
        room_name=body.roomName,
    )
    # Apply immediately so the device snaps to the right state on save.
    applied = await asyncio.to_thread(sync_room, body.room) if saved.get("enabled") else {}
    _bus.emit("automation", _BASIC, "smart_climate_saved",
              room=body.room, has_cooling=bool(body.cooling),
              has_heating=bool(body.heating), result="ok")
    return {"ok": True, "config": saved, "applied": applied}


@router.post("/api/automations/smart_climate/{room}/toggle")
async def toggle_smart_climate(room: str, body: dict):
    from services.smart_climate_engine import set_enabled, sync_room
    enabled = bool(body.get("enabled", True))
    rc = await asyncio.to_thread(set_enabled, room, enabled)
    if rc is None:
        raise HTTPException(status_code=404, detail="Room not configured")
    if enabled:
        await asyncio.to_thread(sync_room, room)
    _bus.emit("automation", _BASIC, "smart_climate_toggled",
              room=room, enabled=enabled, result="ok")
    return {"ok": True, "config": rc}


@router.delete("/api/automations/smart_climate/{room}")
async def delete_smart_climate(room: str):
    from services.smart_climate_engine import delete_room
    res = await asyncio.to_thread(delete_room, room)
    _bus.emit("automation", _BASIC, "smart_climate_deleted", room=room, result="ok")
    return {"ok": True, **res}


@router.post("/api/automations/smart_climate/{room}/sync")
async def sync_smart_climate(room: str):
    """▶ — force-evaluate the room now and re-assert the correct device state."""
    from services.smart_climate_engine import sync_room
    result = await asyncio.to_thread(sync_room, room)
    _bus.emit("automation", _BASIC, "smart_climate_synced", room=room, result="ok")
    return result


# ── Pro Mode bundles — list / delete (undo-accept) ───────────────────────────
# Registered BEFORE the /{automation_id} catch-all so "bundles" isn't captured
# as an automation id. A bundle is the set of artifacts a single Pro Mode accept
# created; deleting it sweeps every one (automations, occupancy sensors, KV
# flags) via services.bundle_executor.delete_bundle.

@router.get("/api/automations/bundles")
async def list_bundles_endpoint():
    from services.bundle_executor import list_bundles
    return {"bundles": await asyncio.to_thread(list_bundles)}


@router.delete("/api/automations/bundles/{bundle_id}")
async def delete_bundle_endpoint(bundle_id: str):
    """Undo a Pro Mode accept — tear down every artifact the bundle created.

    Returns 200 with a per-artifact removed/errors breakdown. A missing bundle
    (nothing to undo) is a 404 so the UI can distinguish gone-vs-broken.
    """
    from services.bundle_executor import delete_bundle
    result = await asyncio.to_thread(delete_bundle, bundle_id)
    if not result.get("ok") and not result.get("removed"):
        detail = (result.get("errors") or [{}])[0].get("error", "Could not delete bundle")
        status = 404 if "no such bundle" in detail else 502
        raise HTTPException(status_code=status, detail=detail)
    _bus.emit("automation", _BASIC, "bundle_deleted",
              bundle_id=bundle_id,
              removed=len(result.get("removed", [])),
              errors=len(result.get("errors", [])),
              result="ok" if result.get("ok") else "partial")
    return result


# ── Voice intents — list / delete registered phrases ─────────────────────────
# Registered phrases ("good night" → sleep mode) are matched in the intent
# parser's short-circuit path without an LLM. These endpoints let a UI (or a
# canary test) inspect and remove them. Creation happens via bundle apply.

@router.get("/api/voice-intents")
async def list_voice_intents_endpoint():
    from services.voice_intents import list_voice_intents
    intents = await asyncio.to_thread(list_voice_intents)
    # Never leak internal action wiring detail beyond what a UI needs.
    return {"voice_intents": [
        {"phrase": r.get("phrase"), "normalized": r.get("normalized"),
         "description": r.get("description"), "bundle_id": r.get("bundle_id"),
         "action_kind": (r.get("action") or {}).get("kind")}
        for r in intents
    ]}


@router.delete("/api/voice-intents/{phrase}")
async def delete_voice_intent_endpoint(phrase: str):
    from services.voice_intents import unregister_voice_intent
    removed = await asyncio.to_thread(unregister_voice_intent, phrase)
    if not removed:
        raise HTTPException(status_code=404, detail="No such voice intent")
    _bus.emit("automation", _BASIC, "voice_intent_deleted", phrase=phrase, result="ok")
    return {"ok": True, "phrase": phrase}


# ── Single-automation endpoints ──────────────────────────────────────────────

@router.get("/api/automations/{automation_id}")
async def get_automation_by_id(automation_id: str):
    a = get_automation_for_ui(automation_id)
    if not a:
        raise HTTPException(status_code=404, detail="Automation not found")
    return a


@router.post("/api/automations")
async def create_automation_endpoint(body: AutomationBody):
    data = body.model_dump()
    is_update = bool(body.id)
    result = save_automation(data, auto_id=body.id)
    if not result.get("ok"):
        _bus.emit("automation", _BASIC, "automation_save_failed",
                  name=body.name, automation_id=body.id,
                  result="error", error=result.get("error"))
        # A trigger that references a missing/empty entity is a user-fixable
        # validation error, not an HA outage — 422 so the app shows a clear
        # "create the sensor first" message instead of a generic failure.
        if result.get("reason") == "trigger_entity_missing":
            raise HTTPException(status_code=422, detail=result.get("error", "Trigger entity missing"))
        raise HTTPException(status_code=502, detail=result.get("error", "HA error"))
    auto_id = result["id"]
    _bus.emit("automation", _BASIC,
              "automation_updated" if is_update else "automation_created",
              automation_id=auto_id, name=body.name,
              trigger_kind=(body.trigger or {}).get("kind"),
              action_count=len(body.actions or []),
              rooms=body.rooms or [],
              result="ok")
    automation = {
        "id": auto_id,
        "name": body.name,
        "description": body.description or "",
        "enabled": True,
        "trigger": body.trigger or {},
        "actions": body.actions or [],
        "rooms": body.rooms or [],
        "source": result.get("source", "ha"),
    }
    return {"ok": True, "automation": automation}


@router.get("/api/occupancy-sensors")
async def list_occupancy_sensors_endpoint():
    """List the Ziggy-created fused presence sensors ({room, entity_id, sensors}).

    The frontend uses this to (a) keep these virtual helpers out of the room
    device grid — they're plumbing, not a device you control — and (b) drive the
    room-tile "occupied" indicator off the room's fused sensor."""
    from services.template_sensors import list_occupancy_sensors
    sensors = await asyncio.to_thread(list_occupancy_sensors)
    return {"sensors": sensors}


@router.post("/api/occupancy-sensors")
async def create_occupancy_sensor_endpoint(body: OccupancySensorBody):
    """Spawn a Ziggy smart presence sensor from the Automation Builder UI.

    Routes through the SAME handler as the LLM's create_occupancy_sensor tool
    so behaviour (auto-naming, delay-off damping, Devices-page surfacing via
    device_registry) stays identical regardless of entry point.
    """
    from core.handlers.automation_handler import handle_create_occupancy_sensor
    result = await handle_create_occupancy_sensor(body.model_dump(), source="ui_wizard")
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("message", "Could not create sensor"))
    return result


@router.delete("/api/smart-sensors/{entry_id}")
async def delete_smart_sensor_endpoint(entry_id: str):
    """Remove a Ziggy-created smart (occupancy) sensor from the Devices page.

    The UI carries the opaque HA config_entry id (never shown to the user) but
    not the room slug, so we delete by entry_id. This both removes the HA config
    entry AND clears Ziggy's KV record so the sensor doesn't reappear on the
    Devices page (device_registry._merge_ziggy_smart_sensors rebuilds from KV).
    """
    from services.template_sensors import delete_occupancy_sensor_by_entry_id
    result = await asyncio.to_thread(delete_occupancy_sensor_by_entry_id, entry_id)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "Could not delete smart sensor"))
    _bus.emit("automation", _BASIC, "smart_sensor_deleted",
              entry_id=entry_id, result="ok")
    return result


@router.get("/api/smart-sensors/probe-fields")
async def probe_smart_sensor_fields_endpoint():
    """Diagnostic: report which fields HA's template binary_sensor flow exposes
    with advanced options on — used to confirm the delay_off field shape on a
    real HA. Creates nothing."""
    from services.template_sensors import probe_template_binary_sensor_fields
    return await asyncio.to_thread(probe_template_binary_sensor_fields)


@router.post("/api/smart-sensors/reconcile")
async def reconcile_smart_sensors_endpoint():
    """Prune orphaned smart-sensor KV records (HA helper deleted, KV lingered).

    Throttled server-side so a Devices page that mounts repeatedly doesn't
    hammer HA's WS. Returns the pruned list (empty when nothing to do or when
    throttled). Conservative: prunes nothing if HA is unreachable.
    """
    from services.ha_reconciler import maybe_reconcile_occupancy
    result = await asyncio.to_thread(maybe_reconcile_occupancy)
    if result.get("pruned"):
        _bus.emit("automation", _BASIC, "smart_sensor_reconciled",
                  pruned=len(result["pruned"]), result="ok")
    return result


@router.patch("/api/automations/{automation_id}/rooms")
async def patch_automation_rooms(automation_id: str, body: AutomationRoomsPatch):
    from services.local_automation_actions import save_automation_meta, get_automation_meta
    meta = get_automation_meta(automation_id)
    meta["rooms"] = body.rooms
    save_automation_meta(automation_id, meta)
    return {"ok": True, "automation_id": automation_id, "rooms": body.rooms}


@router.patch("/api/automations/{automation_id}/toggle")
async def toggle_automation_endpoint(automation_id: str, body: AutomationToggle):
    ok = toggle_automation(automation_id, body.enabled)
    if not ok:
        _bus.emit("automation", _BASIC, "automation_toggle_failed",
                  automation_id=automation_id, enabled=body.enabled,
                  result="error")
        raise HTTPException(status_code=502, detail="Failed to toggle automation")
    # Disabling a Fake Occupancy automation must immediately stop its
    # multi-day activation — otherwise the per-minute scheduler would keep
    # cycling lights even after the user toggled it off in the UI. Safe
    # no-op for any automation that isn't currently running an activation.
    if not body.enabled:
        try:
            from services import fake_occupancy_scheduler
            fake_occupancy_scheduler.stop(automation_id)
        except Exception:
            pass
    _bus.emit("automation", _BASIC, "automation_toggled",
              automation_id=automation_id, enabled=body.enabled, result="ok")
    return {"ok": True, "enabled": body.enabled}


@router.post("/api/automations/{automation_id}/trigger")
async def trigger_automation_endpoint(automation_id: str, background_tasks: BackgroundTasks):
    # Always use Ziggy's executor — it handles call_service, IR, delay, and all
    # other step types natively. Calling trigger_automation() in addition would
    # cause HA to double-execute call_service steps for HA-backed automations.
    # HA state-triggered automations auto-fire independently of this endpoint.
    label = get_automation_meta(automation_id).get("name") or automation_id
    _bus.emit("automation", _BASIC, "automation_triggered",
              automation_id=automation_id, name=label, source="manual")
    background_tasks.add_task(
        execute_ziggy_actions, automation_id, label, "manual",
    )
    return {"ok": True, "message": "Automation triggered"}


@router.get("/api/automations/{automation_id}/history")
async def get_automation_history(automation_id: str, limit: int = 20):
    return {"automation_id": automation_id, "history": get_history(automation_id, limit)}


# Bridge-side run history. Surfaces the smart-home bridge's own per-run records
# (which conditions passed, where it stopped, error details) so users can debug
# "why didn't my light turn on?". Distinct from /history above — that one is
# Ziggy's own executor log for manual triggers; this one is automatic fires.
# Sync HTTP under the hood — wrap in to_thread so the event loop stays free.

@router.get("/api/automations/{automation_id}/traces")
async def get_automation_traces_endpoint(automation_id: str, limit: int = 10):
    result = await asyncio.to_thread(get_automation_traces, automation_id, limit)
    return {"automation_id": automation_id, **result}


@router.get("/api/automations/{automation_id}/traces/{run_id}")
async def get_automation_trace_detail_endpoint(automation_id: str, run_id: str):
    result = await asyncio.to_thread(get_trace_detail, automation_id, run_id)
    if not result.get("ok"):
        # 404 specifically for the "no longer available" case; 502 for upstream
        # outages so the frontend can distinguish gone-vs-broken.
        err = result.get("error", "")
        status = 404 if "no longer available" in err else 502
        raise HTTPException(status_code=status, detail=err)
    return {"automation_id": automation_id, **result}


@router.post("/api/automations/{automation_id}/snooze")
async def snooze_automation_endpoint(automation_id: str, body: AutomationSnooze):
    """Pause an automation for N minutes. minutes=0 clears the snooze."""
    meta = get_automation_meta(automation_id) or {}
    if body.minutes <= 0:
        meta.pop("snoozed_until", None)
        save_automation_meta(automation_id, meta)
        return {"ok": True, "snoozed_until": None}
    until = (datetime.now(timezone.utc) + timedelta(minutes=int(body.minutes))).isoformat()
    meta["snoozed_until"] = until
    save_automation_meta(automation_id, meta)
    return {"ok": True, "snoozed_until": until}


@router.delete("/api/automations/{automation_id}")
async def delete_automation_endpoint(automation_id: str):
    from core.automation_file import delete_automation as delete_ziggy_automation
    ha_ok = ha_delete_automation(automation_id)
    ziggy_ok = delete_ziggy_automation(automation_id)
    if not ha_ok and not ziggy_ok:
        _bus.emit("automation", _BASIC, "automation_delete_not_found",
                  automation_id=automation_id, result="not_found")
        raise HTTPException(status_code=404, detail="Automation not found")
    delete_ziggy_actions(automation_id)
    delete_automation_meta(automation_id)
    delete_history(automation_id)
    # Drop any Fake Occupancy activation tied to this automation so a deleted
    # "Away — Simulate Presence" stops the per-minute scheduler immediately.
    try:
        from services import fake_occupancy_scheduler
        fake_occupancy_scheduler.stop(automation_id)
    except Exception:
        pass
    _bus.emit("automation", _BASIC, "automation_deleted",
              automation_id=automation_id,
              ha_deleted=ha_ok, ziggy_deleted=ziggy_ok,
              result="ok")
    return {"ok": True}


# ── Push action callback ─────────────────────────────────────────────────────
# Moved to backend/routers/push_action_router.py in PROMPT_SECURITY_HARDENING_V2.
# The handler is service-worker-driven (no bearer header possible), so it had
# to leave a router mounted under `_auth = [Depends(get_current_user)]`.
# See push_action_router.py for the design rationale and the bucket-D comment.


# ── Fake Occupancy (Away — Simulate Presence) status / stop ─────────────────
# The "start" side runs through the normal Run-automation path (POST /trigger),
# which executes a `fake_occupancy_start` step. These endpoints expose the
# scheduler's internal activation list so the UI can show "Day 3 of 7" and
# offer a Stop button without having to disable the whole automation.

@router.get("/api/automations/fake_occupancy/active")
async def list_fake_occupancy_active():
    from services import fake_occupancy_scheduler
    return {"activations": fake_occupancy_scheduler.list_active()}


@router.post("/api/automations/{automation_id}/fake_occupancy/stop")
async def stop_fake_occupancy(automation_id: str):
    from services import fake_occupancy_scheduler
    stopped = fake_occupancy_scheduler.stop(automation_id)
    return {"ok": True, "stopped": stopped}


# ── Manual override inspection / clearing ────────────────────────────────────

@router.get("/api/overrides")
async def list_overrides():
    from services import manual_overrides
    return {"overrides": manual_overrides.list_active()}


@router.delete("/api/overrides/{entity_id}")
async def clear_override(entity_id: str):
    from services import manual_overrides
    cleared = manual_overrides.clear_override(entity_id)
    return {"ok": True, "cleared": cleared}
