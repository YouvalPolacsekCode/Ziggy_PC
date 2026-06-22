"""
Unified in-memory device table.

Build order at startup:
  1. Load persistent model from user_files/device_registry.json
  2. Seed from YAML device_map (backward compat — deprecated entries logged)
  3. Merge IR virtual devices from ir_devices.json
  4. Validate against live HA entity states → assign connection status
  5. Start reconciliation loop (every 60 s)

Connection states:
  connected     — entity_id set, HA confirms it's live
  unclaimed     — entity exists in HA, not yet assigned to any Ziggy device
  unconfigured  — Ziggy device entry exists but entity_id is None
  lost          — was connected last session, entity_id now missing from HA
  ir_only       — IR virtual device, no HA entity expected
"""
from __future__ import annotations

import json
import os
import threading
import time
from typing import Optional

from core.logger_module import log_info, log_error
from core.settings_loader import settings
from services.entity_filter import _should_hide

REGISTRY_FILE = "user_files/device_registry.json"

CONNECTED    = "connected"
UNCLAIMED    = "unclaimed"
UNCONFIGURED = "unconfigured"
LOST         = "lost"
IR_ONLY      = "ir_only"

# Internal tags on registry entries. Stored as a list of strings on each
# device row (key: "tags"). NOT exposed via the UI — auto-applied at registry
# init based on entity_id / friendly-name heuristics so loads the user can't
# afford to lose (fridge, router, Ziggy Brain) are never touched by sweep
# automations like "Last One Out".
TAG_CRITICAL = "critical"

# Substring keywords that auto-tag a switch.* entity as critical. Matched
# case-insensitively against both entity_id and the friendly name, so devices
# named "Mekarer" (Hebrew transliteration) or HA-assigned ids like
# switch.shelly_fridge both get caught. Add Hebrew variants because the
# Israel-first launch will see device names in Hebrew at the HA layer too.
_CRITICAL_PLUG_KEYWORDS: tuple[str, ...] = (
    # English / transliteration
    "fridge", "refrigerator", "freezer", "router", "modem", "wifi", "wi_fi",
    "internet", "network", "switch_network", "nas", "server", "alarm",
    "ziggy", "brain", "boiler", "water_heater", "heater",
    # Hebrew (UTF-8) — covers the common consumer device names
    "מקרר", "ראוטר", "מודם", "פריזר", "שרת", "אזעקה", "דוד",
)

_registry: list[dict] = []
_lock = threading.Lock()
_initialized = False

# Hot-path lookup indexes. Rebuilt every time _registry is reassigned (init,
# reconcile_with_ha, refresh) and whenever an in-place mutation moves a device
# between rooms / changes its entity_id. The indexes hold *references* to the
# same dict objects in _registry, so in-place flag/tag mutations remain visible
# without rebuild.
#
# Previously, get_entity / get_ir_device_id / get_status / get_device_info all
# did O(N) linear scans, and DeviceCard enrichment in /api/devices cascaded
# several of them per device — quadratic on large registries.
_idx_by_entity_id: dict[str, dict] = {}
_idx_by_room_type: dict[tuple[str, str], list[dict]] = {}


def _rebuild_indexes() -> None:
    """Recompute the lookup indexes from _registry. Caller holds _lock."""
    global _idx_by_entity_id, _idx_by_room_type
    by_eid: dict[str, dict] = {}
    by_rt: dict[tuple[str, str], list[dict]] = {}
    for d in _registry:
        eid = d.get("entity_id")
        if eid:
            by_eid[eid] = d
        room = d.get("room")
        dtype = d.get("device_type")
        if room and dtype:
            by_rt.setdefault((room, dtype), []).append(d)
    _idx_by_entity_id = by_eid
    _idx_by_room_type = by_rt


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def _load_persistent() -> list[dict]:
    if not os.path.exists(REGISTRY_FILE):
        return []
    try:
        with open(REGISTRY_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        log_error(f"[DeviceRegistry] Failed to load {REGISTRY_FILE}: {e}")
        return []


def _save_persistent(devices: list[dict]) -> None:
    os.makedirs(os.path.dirname(REGISTRY_FILE), exist_ok=True)
    try:
        with open(REGISTRY_FILE, "w", encoding="utf-8") as f:
            json.dump(devices, f, indent=2, ensure_ascii=False)
    except Exception as e:
        log_error(f"[DeviceRegistry] Failed to save {REGISTRY_FILE}: {e}")
    # Registry changed — resolve_entity() cache is now potentially stale.
    try:
        from services.home_automation import invalidate_resolve_entity_cache
        invalidate_resolve_entity_cache()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Population
# ---------------------------------------------------------------------------

def _seed_from_yaml(devices: list[dict]) -> list[dict]:
    """Seed the registry from settings.yaml's `device_map` — ONLY ON A TRUE
    FIRST RUN (registry file absent / empty).

    Background: this function used to run on every boot, keyed on
    (room, device_type). That had three failure modes the user kept hitting:

      1. Move an entity to a different room via the UI → registry has
         (new_room, dtype) but YAML still has (old_room, dtype) → next boot
         re-seeds (old_room, dtype) as a duplicate row. Entity rendered in
         two rooms or in the wrong one.

      2. Delete an entity via the UI → registry row removed. YAML strip
         used to be best-effort; any failure (HA WS timeout mid-delete,
         partial save, older release) left the YAML entry behind → next
         boot resurrected the entity.

      3. Rename an entity in HA → the old entity_id is in YAML; reseed
         pushed it back even though it no longer exists in HA.

    After the very first boot, the JSON registry IS the source of truth.
    The YAML `device_map` block is legacy and should only feed the
    migration on a freshly-installed Ziggy where the JSON doesn't exist yet.
    """
    if devices:
        # Registry is already populated — skip YAML seeding entirely.
        # Any later mutations via the UI are persisted to JSON.
        return devices

    device_map = settings.get("device_map", {})
    added = 0
    for room, dtypes in device_map.items():
        for dtype, entity_id in (dtypes or {}).items():
            if not entity_id:
                continue
            devices.append({
                "room": room,
                "device_type": dtype,
                "entity_id": entity_id,
                "ir_device_id": None,
                "status": UNCONFIGURED,
                "name": f"{room} {dtype}".replace("_", " ").title(),
            })
            added += 1
    if added:
        log_info(
            f"[DeviceRegistry] First-run migration: seeded {added} devices "
            "from YAML device_map. Subsequent boots ignore YAML (JSON registry is canonical)."
        )
    return devices


def _dedupe_by_entity_id(devices: list[dict]) -> list[dict]:
    """Collapse duplicate registry rows for the same entity_id.

    Older versions of _seed_from_yaml (above) could produce two rows for
    the same entity after a UI-driven room move. Keep the row whose status
    isn't UNCONFIGURED (i.e., the one the user touched) and discard the
    YAML-seeded twin. Logs whenever it actually does something so the
    issue is visible if it recurs.
    """
    by_eid: dict[str, dict] = {}
    keep_order: list[str | None] = []   # preserve insertion order for non-eid rows
    out: list[dict] = []
    removed = 0
    for d in devices:
        eid = d.get("entity_id")
        if not eid:
            out.append(d)
            continue
        prev = by_eid.get(eid)
        if prev is None:
            by_eid[eid] = d
            keep_order.append(eid)
            continue
        # Prefer the row that is not UNCONFIGURED — it carries the user's
        # latest room assignment / status.
        if prev.get("status") == UNCONFIGURED and d.get("status") != UNCONFIGURED:
            by_eid[eid] = d
        removed += 1
    for eid in keep_order:
        out.append(by_eid[eid])
    if removed:
        log_info(f"[DeviceRegistry] Deduped {removed} duplicate row(s) — JSON registry was inconsistent")
    return out


def _merge_ir_devices(devices: list[dict]) -> list[dict]:
    """
    Rebuild pure IR-only entries from live ir_devices.json on every call.
    Dropping stale entries first ensures room changes and deletions are
    reflected immediately without waiting for the 60-second reconciliation loop.

    Auto-linking: when an IR codeset's `ha_entity_id` field points at an
    existing HA-bound registry entry, we *merge* them into a single hybrid
    row (entity_id + ir_device_id both set). That's what makes the command
    router's WiFi/IR routing engage. Without this merge, "linked" IR
    codesets still appeared as standalone IR-only rows and the router
    never had both sources to choose between.

    Hybrid entries from prior runs are preserved as-is.
    """
    try:
        from services.ir_manager import list_ir_devices

        # Keep non-IR and hybrid (linked) entries; drop pure IR-only ones for rebuild
        kept = [d for d in devices if not (d.get("ir_device_id") and not d.get("entity_id"))]
        linked_ir_ids = {d["ir_device_id"] for d in kept if d.get("ir_device_id")}
        # Index HA-bound entries so we can promote them into hybrids on merge.
        by_entity = {d["entity_id"]: d for d in kept if d.get("entity_id")}

        for ir in list_ir_devices(enabled_only=False):
            if ir["id"] in linked_ir_ids:
                # Already represented by a hybrid entry
                continue

            # If the codeset declares a linked HA entity AND that entity is in
            # the registry, fold this codeset into the existing row.
            linked_eid = (ir.get("ha_entity_id") or "").strip()
            if linked_eid and linked_eid in by_entity:
                target = by_entity[linked_eid]
                target["ir_device_id"] = ir["id"]
                # Don't clobber a user-edited friendly name; only fill if empty.
                if not target.get("name") or target["name"] == linked_eid:
                    target["name"] = ir.get("name") or target.get("name") or linked_eid
                linked_ir_ids.add(ir["id"])
                log_info(
                    f"[DeviceRegistry] Linked IR codeset {ir['id']} → {linked_eid} "
                    f"(merged into hybrid entry)"
                )
                continue

            # IR-only — no HA link (or link points at an entity we don't know yet).
            room = ir.get("room") or None
            dtype = ir.get("type")
            kept.append({
                "room": room,
                "device_type": dtype,
                "entity_id": None,
                "ir_device_id": ir["id"],
                "status": IR_ONLY,
                "name": ir.get("name", f"{room or ''} {dtype}").strip(),
            })

        return kept
    except Exception as e:
        log_error(f"[DeviceRegistry] Failed to merge IR devices: {e}")
        return devices


# ---------------------------------------------------------------------------
# Reconciliation
# ---------------------------------------------------------------------------

def _live_entity_ids() -> set[str]:
    try:
        from services.home_automation import get_all_states
        return {s["entity_id"] for s in get_all_states()}
    except Exception as e:
        log_error(f"[DeviceRegistry] Could not fetch HA states: {e}")
        return set()


def _live_states_and_ids() -> tuple[list[dict], set[str]]:
    """Single HA REST snapshot, returns (full_state_list, entity_id_set).

    Replaces two independent calls to get_all_states() that init() used to
    make — one inside _live_entity_ids(), another inside _add_unclaimed().
    Two REST round-trips → one.
    """
    try:
        from services.home_automation import get_all_states
        states = get_all_states()
        return states, {s["entity_id"] for s in states}
    except Exception as e:
        log_error(f"[DeviceRegistry] Could not fetch HA states: {e}")
        return [], set()


_NON_DEVICE_DOMAINS = frozenset({
    "automation", "script", "scene", "timer", "counter",
    "input_select", "input_number", "input_text", "input_datetime", "input_button",
    "group", "zone", "sun", "stt", "tts", "conversation",
    # HA data sources — kept in sync with entity_filter.HIDDEN_DOMAINS
    "calendar", "weather", "todo", "person", "device_tracker", "remote",
})


# Auto-prune ghosts (entities present in registry but missing from HA) after
# this long. Reasoning:
#   - Below: gives the user time to notice and re-add in HA if they didn't
#     mean to delete it — Ziggy preserves the room assignment in the meantime.
#   - Above: keeps a stale entity hanging in the UI forever, surfacing in
#     "needs attention" banners and any "all devices" lists.
# 7 days is the sweet spot for the typical use case of "I deleted this in HA
# weeks ago and just want it gone."
_GHOST_AUTOPRUNE_SECONDS = 7 * 24 * 3600


def _reconcile(devices: list[dict], live_ids: set[str]) -> list[dict]:
    if not live_ids:
        return devices
    import time as _t
    now = _t.time()
    keep = []
    for d in devices:
        if d.get("ir_device_id") and not d.get("entity_id"):
            d["status"] = IR_ONLY
            keep.append(d)
            continue
        eid = d.get("entity_id")
        if not eid:
            d["status"] = UNCONFIGURED
            keep.append(d)
            continue
        domain = eid.split(".")[0]
        if domain in _NON_DEVICE_DOMAINS:
            log_info(f"[DeviceRegistry] Removing non-device entity from registry: {eid}")
            continue
        if _should_hide(eid):
            # Catches pattern-filtered entities (phone sensors, router sensors, sun sub-sensors)
            log_info(f"[DeviceRegistry] Removing filtered entity from registry: {eid}")
            continue
        if eid in live_ids:
            d["status"] = CONNECTED
            d.pop("_lost_since", None)   # back in HA — clear the prune timer
            keep.append(d)
        else:
            # First time we see it missing, stamp it. Subsequent reconciles
            # check the stamp and auto-drop after the grace window expires —
            # the user explicitly removed it from HA and isn't coming back.
            if "_lost_since" not in d:
                d["_lost_since"] = now
            d["status"] = LOST
            if (now - float(d.get("_lost_since") or now)) > _GHOST_AUTOPRUNE_SECONDS:
                log_info(f"[DeviceRegistry] Auto-pruning ghost {eid} (lost > {_GHOST_AUTOPRUNE_SECONDS}s)")
                continue
            keep.append(d)
    return keep


def _infer_device_type(entity_id: str, attrs: dict) -> str:
    """Map an HA entity to Ziggy's device_type taxonomy.

    Ziggy keys mappings by semantic type — "temperature", "humidity", "motion" —
    not by HA domain. For `sensor.*` and `binary_sensor.*`, the semantic type
    lives in `attributes.device_class` (HA's own taxonomy). Falling back to
    the domain ("sensor") loses that signal and is why `resolve_entity(room,
    "temperature")` used to miss every Z2M temp sensor (entity_ids are MAC
    addresses with no name hints).
    """
    domain = entity_id.split(".")[0]
    if domain in ("sensor", "binary_sensor"):
        dc = (attrs.get("device_class") or "").strip().lower()
        if dc:
            return dc
    return domain


# Room slugs we recognise in entity_ids / friendly names. Kept short on purpose
# — the HA area registry is the authoritative source; this is a name-hint
# fallback for users who haven't set up HA areas yet. Matched longest-first so
# "master_bedroom" wins over "bedroom".
_NAME_HINT_ROOMS: tuple[str, ...] = (
    "master_bedroom", "kids_room", "living_room", "dining_room", "guest_room",
    "office", "bedroom", "kitchen", "bathroom", "balcony", "garden", "hallway",
    "entrance", "study", "garage", "laundry",
)


def _infer_room(entity_id: str, attrs: dict, entity_areas: dict[str, str] | None) -> str | None:
    """Resolve `entity_id → ziggy-room-key`. Priority order:

      1. HA area assignment (authoritative — the operator told HA so)
      2. friendly_name contains a known room hint
      3. entity_id slug contains a known room hint

    Steps 2+3 are deliberate fallbacks for the user who has the sensor
    plugged in but never set the HA area. Returns None when nothing matches —
    callers leave the row UNCLAIMED so the Devices page can prompt a manual
    assignment.
    """
    if entity_areas:
        area = entity_areas.get(entity_id)
        if area:
            return area
    # Step 2: friendly_name. Z2M often names devices "Office Temperature
    # Sensor" — that's the strongest non-area signal we have.
    fn = (attrs.get("friendly_name") or "").lower().replace(" ", "_")
    if fn:
        for slug in _NAME_HINT_ROOMS:
            if slug in fn:
                return slug
    # Step 3: entity_id slug. Catches ZHA-style ids like
    # `sensor.aqara_office_temperature` even without a friendly name.
    slug_part = entity_id.split(".", 1)[-1].lower()
    for slug in _NAME_HINT_ROOMS:
        if slug in slug_part:
            return slug
    return None


def _add_unclaimed(devices: list[dict], live_ids: set[str],
                   states: list[dict] | None = None,
                   entity_areas: dict[str, str] | None = None) -> list[dict]:
    """Append UNCLAIMED entries for live HA entities the registry doesn't yet know.

    `states` may be supplied by the caller to avoid a duplicate HA REST round-trip
    (init() previously fetched /api/states twice: once for live_ids, once here).

    `entity_areas` is `entity_id → ziggy-room-key`, derived from HA's area
    registry by the async caller. When provided and the entity has an area,
    the new row lands as CONNECTED with room set — no manual mapping needed.
    Without an area, the row stays UNCLAIMED so the Devices page can prompt.

    Also normalises device_type from HA's device_class so chat handlers can
    look up `(room, "temperature")` instead of `(room, "sensor")` (see
    _infer_device_type doc).
    """
    if not live_ids:
        return devices
    try:
        from services.entity_filter import filter_entities
        if states is None:
            from services.home_automation import get_all_states
            states = get_all_states()
        filtered = filter_entities(states)
        filtered_ids = {s["entity_id"] for s in filtered}
        # entity_id → attributes dict, for device_class lookup
        attrs_by_id = {s["entity_id"]: (s.get("attributes") or {}) for s in filtered}
    except Exception as e:
        log_error(f"[DeviceRegistry] Unclaimed scan failed: {e}")
        return devices

    claimed = {d["entity_id"] for d in devices if d.get("entity_id")}
    existing_unclaimed = {d["entity_id"] for d in devices if d["status"] == UNCLAIMED}
    entity_areas = entity_areas or {}

    for eid in filtered_ids:
        if eid in claimed or eid in existing_unclaimed:
            continue
        attrs = attrs_by_id.get(eid, {})
        device_type = _infer_device_type(eid, attrs)
        room = _infer_room(eid, attrs, entity_areas)
        devices.append({
            "room": room,
            "device_type": device_type,
            "entity_id": eid,
            "ir_device_id": None,
            # Known room → fully usable from chat. No area → still surfaces
            # in the Devices page for manual claim.
            "status": CONNECTED if room else UNCLAIMED,
            "name": eid,
        })
    return devices


def _heal_unclaimed(devices: list[dict],
                    states: list[dict] | None = None,
                    entity_areas: dict[str, str] | None = None) -> list[dict]:
    """Re-evaluate existing UNCLAIMED entries with the dynamic-mapping rules.

    Covers the migration case where a sensor was added before this code existed
    — it's already in the registry as ("sensor", room=None), so chat lookups
    miss it. On every reconcile we walk the UNCLAIMED set, infer device_type
    from attributes, look up the HA area, and promote rows that now have both
    to CONNECTED. Idempotent — entries without an HA area stay UNCLAIMED.
    """
    if not entity_areas and not states:
        return devices
    attrs_by_id = {s["entity_id"]: (s.get("attributes") or {})
                   for s in (states or [])}
    entity_areas = entity_areas or {}
    promoted = 0
    for d in devices:
        if d.get("status") != UNCLAIMED:
            continue
        eid = d.get("entity_id")
        if not eid:
            continue
        attrs = attrs_by_id.get(eid, {})
        room = _infer_room(eid, attrs, entity_areas)
        new_type = _infer_device_type(eid, attrs)
        # Refine device_type even if there's no room yet — "sensor" → "temperature"
        # is still better for ops UIs and future area assignments.
        if new_type and new_type != d.get("device_type"):
            d["device_type"] = new_type
        if room and not d.get("room"):
            d["room"] = room
            d["status"] = CONNECTED
            promoted += 1
    if promoted:
        log_info(f"[DeviceRegistry] Healed {promoted} unclaimed entities via HA area mapping")
    return devices


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def init() -> None:
    """Phase 1: populate the device table from local sources only — no HA REST.

    Safe to call multiple times — idempotent. The HA-dependent reconciliation
    (status updates, unclaimed scan) lives in reconcile_with_ha(), which is
    scheduled as a background task from the FastAPI startup hook. Splitting
    these two phases removes a sync 100-300 ms (LAN) / multi-second (remote
    tunnel) HA REST hit from the startup critical path.

    What still happens here:
      - load persistent JSON (already-known devices keep their last-seen status)
      - first-run YAML migration
      - dedupe by entity_id (cleans up old duplicates)
      - IR merge (reads ir_devices.json — local, fast)
    """
    global _registry, _initialized
    # Two startup paths call this: core/ziggy_main.py (so voice/sensor/dashboard
    # threads see a populated registry immediately) and the FastAPI lifespan in
    # backend/server.py. Without this guard, both paths re-ran JSON load + YAML
    # migration + dedupe + IR merge and emitted a duplicate "Phase 1 initialized"
    # line on every startup.
    if _initialized:
        return
    with _lock:
        devices = _load_persistent()
        # First-run YAML migration (no-op on subsequent boots — see comment
        # in _seed_from_yaml). Dedupe AFTER seeding to clean up any
        # duplicates the old buggy version left behind.
        devices = _seed_from_yaml(devices)
        devices = _dedupe_by_entity_id(devices)
        # IR merge before HA reconciliation: hybrid HA+IR rows surface
        # immediately on /api/devices even before reconcile_with_ha runs.
        devices = _merge_ir_devices(devices)
        _registry = devices
        _rebuild_indexes()
        _initialized = True
    log_info(f"[DeviceRegistry] Phase 1 initialized with {len(_registry)} devices (HA reconcile pending)")


async def reconcile_with_ha() -> None:
    """Phase 2: live HA REST reconciliation — runs as a background task.

    Updates each entry's `status` field against the current HA entity list,
    adds UNCLAIMED entries for new HA entities, then re-runs the IR merge
    so anything that changed during reconciliation is consistent.

    Idempotent: re-running just refreshes the status field. Used by the
    60-second background loop too.

    Also pulls HA area assignments (entity_id → area_name) and uses them to
    auto-map newly-added entities to Ziggy rooms — and to heal already-
    UNCLAIMED rows whose room never got set. This is what makes
    `resolve_entity(room, "temperature")` work without manual mapping on
    Z2M setups, where entity_ids are MAC-addressed and have no name hints.

    Cold start: HA may not be reachable yet (relay tunnel still waking, etc.).
    On a failed snapshot we leave the registry as-is and rely on the periodic
    refresh() loop to retry.
    """
    import asyncio as _asyncio

    # HA area registry → entity_id → ziggy-room-key. The area registry lives
    # behind a WebSocket call so it has to be awaited up here, before we drop
    # into the sync `_do` worker.
    entity_areas: dict[str, str] = {}
    try:
        from services.ha_areas import get_areas
        for area in await get_areas():
            area_key = (area.get("name") or "").lower().replace(" ", "_").strip()
            if not area_key:
                continue
            for eid in area.get("entities") or ():
                entity_areas[eid] = area_key
    except Exception as e:
        # HA may be reachable for /api/states but not for the registry WS yet
        # (different transport). Don't fail reconcile — fall through with no
        # area data; next loop will retry.
        log_info(f"[DeviceRegistry] HA area registry unavailable: {e}")

    def _do() -> int:
        global _registry
        # One HA REST snapshot → reused for both reconcile and unclaimed scan.
        # Previously the inline init() path made the same call twice.
        states, live_ids = _live_states_and_ids()
        if not live_ids:
            return 0
        with _lock:
            devices = _reconcile(_registry, live_ids)
            devices = _add_unclaimed(devices, live_ids, states=states,
                                     entity_areas=entity_areas)
            devices = _heal_unclaimed(devices, states=states,
                                      entity_areas=entity_areas)
            devices = _merge_ir_devices(devices)
            _save_persistent(devices)
            _registry = devices
            _rebuild_indexes()
            return len(_registry)

    try:
        count = await _asyncio.to_thread(_do)
    except Exception as e:
        log_error(f"[DeviceRegistry] reconcile_with_ha failed: {e}")
        return
    if count:
        log_info(f"[DeviceRegistry] Phase 2 reconciled: {count} devices")
    # Critical-plug auto-tag pass runs after reconcile so newly-paired plugs
    # (fridge, router, …) get caught immediately rather than waiting for the
    # next 60s tick. Idempotent — does nothing on the steady state.
    try:
        added = await _asyncio.to_thread(auto_tag_critical_plugs)
        if added:
            log_info(f"[DeviceRegistry] Auto-tagged {added} critical plug(s)")
    except Exception as e:
        log_error(f"[DeviceRegistry] auto_tag_critical_plugs failed: {e}")


def refresh() -> None:
    """Re-reconcile against live HA and re-merge IR devices.

    Call after any device/room change. Includes _merge_ir_devices so newly
    paired IR devices and IR room/type changes are picked up without waiting
    for the next process init().
    """
    global _registry
    # One HA REST snapshot reused for both reconcile and unclaimed scan
    # (used to be two independent calls — wasted round-trip).
    states, live_ids = _live_states_and_ids()
    with _lock:
        # Strip stale IR-only rows so they get rebuilt from current ir_devices.json.
        devices = [d for d in _registry if not (d.get("ir_device_id") and not d.get("entity_id"))]
        devices = _dedupe_by_entity_id(devices)
        devices = _reconcile(devices, live_ids)
        devices = _add_unclaimed(devices, live_ids, states=states)
        # Merge IR devices LAST so the merge can see all HA-bound rows.
        devices = _merge_ir_devices(devices)
        _save_persistent(devices)
        _registry = devices
        _rebuild_indexes()
    # Drop any cached HA entity-registry → device_id grouping so the next
    # /api/devices/grouped call picks up rooms/areas changes immediately.
    try:
        from services.device_groups import invalidate_cache as _invalidate_groups
        _invalidate_groups()
    except Exception:
        pass
    # Drop the automation templates capability cache so the next /api/automations/
    # templates call sees a freshly-paired (or unpaired) device immediately
    # instead of waiting for the 30 s TTL to expire.
    try:
        from backend.routers.automation_router import invalidate_capability_cache
        invalidate_capability_cache()
    except Exception:
        pass
    # Re-run the critical-plug auto-tag pass. Cheap, idempotent; catches
    # plugs that were named "Mekarer" or "Fridge" after the last reconcile.
    try:
        auto_tag_critical_plugs()
    except Exception as e:
        log_error(f"[DeviceRegistry] auto_tag_critical_plugs (refresh) failed: {e}")
    log_info("[DeviceRegistry] Refreshed")


def get_entity(room: str, device_type: str) -> Optional[str]:
    """Return entity_id for a connected device, or None. Logs the reason if missing."""
    room_norm = (room or "").lower().replace(" ", "_").strip()
    dtype_norm = (device_type or "").lower().strip()
    with _lock:
        for d in _idx_by_room_type.get((room_norm, dtype_norm), ()):
            if d["status"] == CONNECTED:
                return d["entity_id"]
            if d["status"] == LOST:
                log_error(
                    f"[DeviceRegistry] {room_norm}.{dtype_norm} is lost "
                    f"(entity '{d['entity_id']}' removed from HA)"
                )
            elif d["status"] == UNCONFIGURED:
                log_error(f"[DeviceRegistry] {room_norm}.{dtype_norm} has no entity_id assigned")
            return None
    return None


def get_ir_device_id(room: str, device_type: str) -> Optional[str]:
    """Return the IR device id for a room + device_type, or None."""
    room_norm = (room or "").lower().replace(" ", "_").strip()
    dtype_norm = (device_type or "").lower().strip()
    with _lock:
        for d in _idx_by_room_type.get((room_norm, dtype_norm), ()):
            if d["status"] == IR_ONLY:
                return d.get("ir_device_id")
    return None


def get_status(room: str, device_type: str) -> Optional[str]:
    room_norm = (room or "").lower().replace(" ", "_").strip()
    dtype_norm = (device_type or "").lower().strip()
    with _lock:
        bucket = _idx_by_room_type.get((room_norm, dtype_norm))
        if bucket:
            return bucket[0]["status"]
    return None


def get_all() -> list[dict]:
    with _lock:
        return list(_registry)


def get_all_for_room(room: str) -> list[dict]:
    room_norm = (room or "").lower().replace(" ", "_").strip()
    with _lock:
        return [d for d in _registry if d.get("room") == room_norm]


def get_device_info(entity_id: str) -> Optional[dict]:
    """Return the registry entry for an entity_id, or None."""
    with _lock:
        d = _idx_by_entity_id.get(entity_id)
        return dict(d) if d is not None else None


def set_learned_flag(entity_id: str, flag: str, value) -> bool:
    """Set a learned-behavior flag on a device entry, keyed by entity_id.

    Used by services.command_router to persist learned facts like
    wifi_dies_when_off. Idempotent — only writes to disk when the value
    actually changes. Returns True iff the entry was updated.
    """
    if not entity_id:
        return False
    with _lock:
        d = _idx_by_entity_id.get(entity_id)
        changed = False
        if d is not None and d.get(flag) != value:
            d[flag] = value
            changed = True
        if changed:
            _save_persistent(_registry)
    return changed


def set_command_routing(entity_id: str, command: str, prefer: str | None) -> bool:
    """Pin (or clear) the preferred source for a single command on a hybrid device.

    prefer=None clears any existing override for that command. Persisted.
    """
    if not entity_id or not command:
        return False
    with _lock:
        changed = False
        d = _idx_by_entity_id.get(entity_id)
        if d is not None:
            routing = d.setdefault("command_routing", {})
            if prefer is None:
                if command in routing:
                    routing.pop(command, None)
                    changed = True
            else:
                cur = (routing.get(command) or {}).get("prefer")
                if cur != prefer:
                    routing[command] = {"prefer": prefer}
                    changed = True
        if changed:
            _save_persistent(_registry)
    return changed


def set_device_tag(entity_id: str, tag: str, on: bool) -> bool:
    """Add or remove a tag on a device row keyed by entity_id.

    Tags live in a `tags: list[str]` field on the registry entry. The list is
    created on demand and pruned to empty when the last tag is removed.
    Persisted on change. Returns True iff the row was actually updated.
    """
    if not entity_id or not tag:
        return False
    with _lock:
        changed = False
        d = _idx_by_entity_id.get(entity_id)
        if d is not None:
            current = list(d.get("tags") or [])
            has = tag in current
            if on and not has:
                current.append(tag)
                d["tags"] = current
                changed = True
            elif not on and has:
                current.remove(tag)
                if current:
                    d["tags"] = current
                else:
                    d.pop("tags", None)
                changed = True
        if changed:
            _save_persistent(_registry)
    return changed


def get_devices_with_tag(tag: str) -> list[dict]:
    """Return a copy of every registry entry that carries `tag`."""
    if not tag:
        return []
    with _lock:
        return [dict(d) for d in _registry if tag in (d.get("tags") or [])]


def has_tag(entity_id: str, tag: str) -> bool:
    """True iff the device row for `entity_id` carries `tag`."""
    if not entity_id or not tag:
        return False
    with _lock:
        d = _idx_by_entity_id.get(entity_id)
        return bool(d and tag in (d.get("tags") or []))


def auto_tag_critical_plugs() -> int:
    """Heuristically tag switch.* entities whose entity_id or name contains a
    known critical keyword (fridge, router, etc.). Idempotent — adds only,
    never removes — so a user-renamed plug stays tagged across reboots and
    a freshly-paired fridge gets caught on the next reconcile.

    Returns the number of newly-tagged rows (0 on no-op).
    """
    global _registry
    added = 0
    with _lock:
        changed_any = False
        for d in _registry:
            eid = (d.get("entity_id") or "")
            if not eid.startswith("switch."):
                continue
            existing = d.get("tags") or []
            if TAG_CRITICAL in existing:
                continue
            haystack = (eid + " " + (d.get("name") or "")).lower()
            if any(kw in haystack for kw in _CRITICAL_PLUG_KEYWORDS):
                d["tags"] = existing + [TAG_CRITICAL]
                added += 1
                changed_any = True
                log_info(f"[DeviceRegistry] Auto-tagged critical: {eid}")
        if changed_any:
            _save_persistent(_registry)
    return added


def get_rooms_by_device_type() -> dict[str, list[str]]:
    """Return {device_type: [room, ...]} for all connected devices with a room assigned.

    Used to inject live device-room knowledge into the GPT system prompt so it
    can enumerate rooms correctly for multi-device commands like 'turn on all lights'.
    """
    result: dict[str, list[str]] = {}
    with _lock:
        for d in _registry:
            room = d.get("room")
            dtype = d.get("device_type")
            status = d.get("status", "")
            if not room or not dtype or status in (UNCLAIMED, UNCONFIGURED, LOST):
                continue
            result.setdefault(dtype, [])
            if room not in result[dtype]:
                result[dtype].append(room)
    return result


# ---------------------------------------------------------------------------
# Background reconciliation loop
# ---------------------------------------------------------------------------

async def sync_rooms_to_ha() -> None:
    """Ensure IR-only rooms in the device registry are backed by HA areas.

    Called once on startup. Scope is intentionally narrow:
      - Only processes rooms whose ALL devices are IR-only (no entity_id).
      - HA-backed devices (entity_id set) have their room managed entirely by HA.
        We must NOT recreate an HA area for them — that would silently resurrect
        rooms the user deliberately deleted.
      - After creating a missing HA area, normalizes registry room keys to match
        the canonical area name so future joins don't diverge.
    """
    import re as _re

    def _norm(name: str) -> str:
        s = name.lower()
        s = _re.sub(r"[''`]", "", s)
        s = _re.sub(r"[^a-z0-9]+", "_", s)
        return s.strip("_")

    try:
        from services.ha_areas import get_areas, create_area
        ha_areas = await get_areas()
        ha_norm_to_area = {_norm(a["name"]): a for a in ha_areas}
    except Exception as e:
        log_error(f"[DeviceRegistry] sync_rooms_to_ha: could not fetch HA areas: {e}")
        return

    with _lock:
        # Build a map: room_key → set of device types present
        # Only consider rooms where EVERY device is IR-only (no entity_id).
        # If a room has even one HA-backed device, HA owns the room lifecycle.
        room_to_devices: dict[str, list] = {}
        for d in _registry:
            room_key = d.get("room")
            if room_key:
                room_to_devices.setdefault(room_key, []).append(d)

        ir_only_rooms: set[str] = {
            room for room, devs in room_to_devices.items()
            if all(not d.get("entity_id") for d in devs)  # all devices are IR-only
        }

        created: dict[str, str] = {}  # old_norm → new_norm after HA creation

        for room_key in sorted(ir_only_rooms):
            norm = _norm(room_key)
            if norm in ha_norm_to_area:
                continue  # already backed by an HA area

            display_name = room_key.replace("_", " ").title()
            try:
                result = await create_area(display_name)
                if result.get("ok"):
                    new_area_name: str = result["area"]["name"]
                    new_norm = _norm(new_area_name)
                    ha_norm_to_area[new_norm] = result["area"]
                    created[norm] = new_norm
                    log_info(
                        f"[DeviceRegistry] sync_rooms_to_ha: created HA area '{new_area_name}' "
                        f"for IR-only room '{room_key}'"
                    )
                else:
                    log_error(f"[DeviceRegistry] sync_rooms_to_ha: failed to create '{display_name}': {result.get('error')}")
            except Exception as e:
                log_error(f"[DeviceRegistry] sync_rooms_to_ha: exception creating '{display_name}': {e}")

        if created:
            for d in _registry:
                old_key = d.get("room") or ""
                old_norm = _norm(old_key) if old_key else ""
                if old_norm in created:
                    d["room"] = created[old_norm]
            _save_persistent(_registry)
            _rebuild_indexes()  # room keys changed → (room, type) buckets stale
            log_info(f"[DeviceRegistry] sync_rooms_to_ha: migrated room keys: {created}")


def start_reconciliation_loop(interval_s: int = 60) -> threading.Thread:
    def _loop():
        while True:
            time.sleep(interval_s)
            try:
                refresh()
            except Exception as e:
                log_error(f"[DeviceRegistry] Reconciliation loop error: {e}")

    t = threading.Thread(target=_loop, name="DeviceRegistryReconcile", daemon=True)
    t.start()
    return t
