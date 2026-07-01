"""
Ziggy-managed HA template binary_sensors for room occupancy fusion.

Why HTTP, not files
-------------------
HA exposes template binary_sensors two ways:
  1. legacy YAML under `template:` in configuration.yaml (or packages/)
  2. modern UI helper — same `template` integration but config-entry backed,
     stored in HA's `.storage`, hot-reloads on create.

The legacy YAML path requires Ziggy to write into HA's config dir. That
fails on the canary topology (HA OS in a VirtualBox VM, Ziggy in Docker
on the Windows host — no shared filesystem). The modern helper path is
all REST and works regardless of where HA runs.

Flow:
  POST  /api/config/config_entries/flow      {handler: "template"}     → menu
  POST  /api/config/config_entries/flow/{id} {next_step_id: "binary_sensor"}
  POST  /api/config/config_entries/flow/{id} {name, state, device_class, ...}
  DELETE /api/config/config_entries/entry/{entry_id}                   for removal
"""
from __future__ import annotations
from typing import Optional
import re
import requests

from services import ha_client
from core.logger_module import log_info, log_error
from services.local_automation_actions import set_local_state, get_local_state


_KV_NAMESPACE = "occupancy_sensors"  # entry_id → metadata
_DEFAULT_DELAY_OFF_SECONDS = 30


def _ha_post(path: str, body: dict, timeout: float = 10.0) -> tuple[int, dict]:
    url = f"{ha_client.url().rstrip('/')}{path}"
    try:
        resp = requests.post(url, json=body, headers=ha_client.headers(), timeout=timeout)
        try:
            data = resp.json()
        except Exception:
            data = {"_raw": resp.text}
        return resp.status_code, data
    except requests.RequestException as e:
        return 0, {"error": str(e)}


def _ha_delete(path: str, timeout: float = 10.0) -> int:
    url = f"{ha_client.url().rstrip('/')}{path}"
    try:
        resp = requests.delete(url, headers=ha_client.headers(), timeout=timeout)
        return resp.status_code
    except requests.RequestException:
        return 0


def _slug(name: str) -> str:
    """ASCII slug for HA entity_id. Returns '' if no ASCII content (e.g. pure Hebrew)."""
    s = re.sub(r"[^a-z0-9_]+", "_", name.lower().replace(" ", "_")).strip("_")
    if s and s[0].isdigit():
        s = f"z_{s}"
    return s


def _build_state_template(sensor_entities: list[str]) -> str:
    """OR-of-sensors Jinja: any source 'on' → occupied."""
    clean = [e.strip() for e in sensor_entities if e and "." in e]
    if not clean:
        return "false"
    clauses = [f"states('{eid}') == 'on'" for eid in clean]
    return "{{ " + " or ".join(clauses) + " }}"


def _start_template_flow() -> tuple[Optional[str], Optional[str]]:
    """Open a template config_entry flow, advance past the domain menu, and
    return (flow_id, error). On success flow_id is set and the next POST
    submits the binary_sensor form."""
    status, init = _ha_post("/api/config/config_entries/flow",
                            {"handler": "template", "show_advanced_options": False})
    if status != 200 or not isinstance(init, dict):
        return None, f"could not start template flow (HA {status}): {init}"
    flow_id = init.get("flow_id")
    if not flow_id:
        return None, "HA returned no flow_id"
    status, picked = _ha_post(f"/api/config/config_entries/flow/{flow_id}",
                              {"next_step_id": "binary_sensor"})
    if status != 200 or picked.get("step_id") != "binary_sensor":
        return None, f"could not advance to binary_sensor step (HA {status}): {picked}"
    return flow_id, None


def create_occupancy_sensor(
    room: str,
    sensor_entities: list[str],
    friendly_name: Optional[str] = None,
    delay_off_seconds: int = _DEFAULT_DELAY_OFF_SECONDS,
) -> dict:
    """Create a template binary_sensor that ORs the given sensors into a single
    'occupied' signal. Idempotent: if a sensor for the same room already
    exists (tracked in Ziggy's local KV), the old one is removed first.

    Returns:
      {"ok": True, "entity_id": "binary_sensor.{slug}_occupied", "message": str}
      {"ok": False, "error": str}

    Note: `delay_off_seconds` is currently NOT applied — the modern HA template
    helper UI doesn't expose delay_off in its basic form. Track as a follow-up;
    sensors flicker fast in practice (~PIR sampling rate) so for v1 the bare
    OR template is usable. To add: extend the create POST body once we confirm
    the UI's "advanced_options" expandable field name.
    """
    if not room or not sensor_entities:
        return {"ok": False, "error": "room and sensor_entities are required"}

    room_slug = _slug(room)
    if not room_slug:
        return {"ok": False, "error": (
            f"Room name '{room}' has no ASCII characters Ziggy can use for the HA entity_id. "
            f"Pass the room as its ASCII slug (e.g. 'bedroom') and use friendly_name for Hebrew."
        )}

    name = friendly_name or f"{room.replace('_', ' ').title()} Occupied"
    state_template = _build_state_template(sensor_entities)

    # Idempotency: if we previously created one for this room, remove it first.
    existing = get_local_state(_KV_NAMESPACE, room_slug) or {}
    prev_entry_id = existing.get("entry_id") if isinstance(existing, dict) else None
    if prev_entry_id:
        _ha_delete(f"/api/config/config_entries/entry/{prev_entry_id}")  # best-effort

    flow_id, err = _start_template_flow()
    if err:
        log_error(f"[template_sensors] {err}")
        return {"ok": False, "error": "Could not start template helper flow on HA."}

    status, result = _ha_post(f"/api/config/config_entries/flow/{flow_id}", {
        "name":         name,
        "state":        state_template,
        "device_class": "occupancy",
    })
    if status != 200 or result.get("type") != "create_entry":
        log_error(f"[template_sensors] create failed: status={status} body={result}")
        return {"ok": False, "error": "HA rejected the occupancy sensor configuration."}

    entry_id = (result.get("result") or {}).get("entry_id", "")
    if not entry_id:
        return {"ok": False, "error": "HA accepted the flow but returned no entry_id."}

    # Resolve the ACTUAL entity_id HA assigned. Modern HA template helpers
    # normalize the slug from `name` and may append suffixes on collision;
    # guessing it from `_slug(name) + "_occupied"` mismatches in practice
    # (the bundle executor's reported entity_id then doesn't match what HA
    # exposes). The entity_registry WS API tells us the truth.
    actual_entity_id = _lookup_entry_entity_id(entry_id) or (
        f"binary_sensor.{_slug(name) or room_slug}_occupied".replace("_occupied_occupied", "_occupied")
    )

    # Cache the entry_id → room mapping so we can replace/delete later.
    set_local_state(_KV_NAMESPACE, room_slug, {
        "entry_id":  entry_id,
        "entity_id": actual_entity_id,
        "name":      name,
        "sensors":   sensor_entities,
    })

    msg = f"Created occupancy sensor from {len(sensor_entities)} signal(s)"
    log_info(f"[template_sensors] {msg} room={room_slug} entry={entry_id} entity={actual_entity_id}")
    return {"ok": True, "entity_id": actual_entity_id, "entry_id": entry_id, "message": msg}


def _lookup_entry_entity_id(entry_id: str) -> Optional[str]:
    """Ask HA's entity_registry which entity_id belongs to a config_entry.

    Uses WebSocket — HA doesn't expose entity_registry over REST. The
    purpose-built `config/entity_registry/list_for_config_entry` command
    doesn't exist on this HA version, so we fetch the full registry and
    filter by `config_entry_id` client-side. ~300 entries on a typical
    home; the round-trip is cheap.

    HA assigns the entity_id asynchronously after `create_entry`, so a
    fresh entry may not yet appear in the registry. We retry briefly
    (500 ms × 4) before giving up. Returns None on persistent failure so
    the caller can fall back to its guessed slug.
    """
    try:
        from services.ha_ws import ha_ws_command
    except ImportError:
        return None
    import time
    for attempt in range(4):
        if attempt:
            time.sleep(0.5)
        resp = ha_ws_command({"type": "config/entity_registry/list"}, timeout=5.0)
        if not resp.get("ok"):
            continue
        entries = resp.get("result") or []
        if not isinstance(entries, list):
            continue
        # Prefer binary_sensor.* (template helpers create exactly one), but
        # fall back to any entity from this config entry if not yet typed.
        binary = None
        any_entity = None
        for e in entries:
            if not isinstance(e, dict):
                continue
            if e.get("config_entry_id") != entry_id:
                continue
            eid = e.get("entity_id")
            if not eid:
                continue
            if eid.startswith("binary_sensor."):
                binary = eid
                break
            if any_entity is None:
                any_entity = eid
        if binary or any_entity:
            return binary or any_entity
    return None


def list_occupancy_sensors() -> list[dict]:
    """List Ziggy-managed occupancy sensors. Reads from local KV — HA's
    config_entries can be cross-checked separately if drift is a concern."""
    # Walk local KV by namespace. set_local_state stores per-key; the
    # underlying _STATE dict has the namespace as a top-level key.
    from services.local_automation_actions import _load_state
    state = _load_state()
    rooms = (state.get(_KV_NAMESPACE) or {}) if isinstance(state, dict) else {}
    out: list[dict] = []
    for room_slug, meta in rooms.items():
        if isinstance(meta, dict) and meta.get("entry_id"):
            out.append({
                "room":      room_slug,
                "entry_id":  meta["entry_id"],
                "entity_id": meta.get("entity_id", ""),
                "name":      meta.get("name", ""),
                "sensors":   meta.get("sensors", []),
            })
    return out


def delete_occupancy_sensor(room: str) -> dict:
    """Remove a previously-created occupancy sensor by room slug."""
    room_slug = _slug(room)
    if not room_slug:
        return {"ok": False, "error": "invalid room slug"}
    existing = get_local_state(_KV_NAMESPACE, room_slug) or {}
    entry_id = existing.get("entry_id") if isinstance(existing, dict) else None
    if not entry_id:
        return {"ok": False, "error": f"no occupancy sensor tracked for room '{room}'"}
    status = _ha_delete(f"/api/config/config_entries/entry/{entry_id}")
    if status not in (200, 204):
        return {"ok": False, "error": f"HA rejected delete (status {status})"}
    set_local_state(_KV_NAMESPACE, room_slug, None)
    return {"ok": True, "message": f"Removed occupancy sensor for {room}"}


def _find_room_slug_for_entry(entry_id: str) -> Optional[str]:
    """Reverse-lookup the KV room slug whose record holds this HA entry_id."""
    from services.local_automation_actions import _load_state
    state = _load_state()
    rooms = (state.get(_KV_NAMESPACE) or {}) if isinstance(state, dict) else {}
    for room_slug, meta in rooms.items():
        if isinstance(meta, dict) and meta.get("entry_id") == entry_id:
            return room_slug
    return None


def delete_occupancy_sensor_by_entry_id(entry_id: str) -> dict:
    """Remove a Ziggy-created occupancy sensor by its opaque HA config_entry id.

    This is the entry point the Devices-page Delete action uses — the UI carries
    the entry_id (never shown to the user) but not the room slug. We:
      1. delete the HA config entry (removes the entity from HA), and
      2. clear the KV record so device_registry._merge_ziggy_smart_sensors stops
         re-surfacing it on the Devices page.

    A missing KV record is not an error — the entry may already be untracked
    (e.g. deleted in HA directly). We still attempt the HA delete so the caller
    always converges on "gone". Returns {"ok": bool, "message"/"error": str}.
    """
    entry_id = (entry_id or "").strip()
    if not entry_id:
        return {"ok": False, "error": "entry_id is required"}

    status = _ha_delete(f"/api/config/config_entries/entry/{entry_id}")
    # 404 means HA already has no such entry — treat as success (idempotent).
    if status not in (200, 204, 404):
        return {"ok": False, "error": f"HA rejected delete (status {status})"}

    room_slug = _find_room_slug_for_entry(entry_id)
    if room_slug:
        set_local_state(_KV_NAMESPACE, room_slug, None)

    log_info(f"[template_sensors] deleted occupancy sensor entry={entry_id} room={room_slug or '?'}")
    return {"ok": True, "message": "Removed smart sensor"}
