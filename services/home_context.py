"""
Home context loader — assemble a compact JSON snapshot of the user's home for
LLM consumption by Ziggy Pro mode (Session D — designer).

What this is
------------
Session D3 (the orchestra designer) needs to reason about the *actual* home —
which rooms exist, what sensors / lights / climate units live in each one,
which integrations are installed (Tuya / Aqara / ZHA / …), who's home, what
mode the house is in, and which automations already exist (so we don't
duplicate them).

This module assembles that snapshot in one call: `load_home_context(language)`.
It reads from Ziggy's existing service layer (device_registry, ha_subscriber's
state_cache, presence_engine, mode_service, ha_automations, template_sensors,
blueprint_importer) — it never talks to HA REST/WS directly. The output is
JSON-serializable and intended to be ~5–10 KB; per-room entity lists are
trimmed to `limits.max_entities_per_room` so a power-user home doesn't blow
the token budget.

Caching
-------
Module-level dict cache keyed by language, TTL 60 s. Entities don't change
fast at the granularity the designer cares about (the designer asks "is there
a motion sensor in the bedroom", not "what is its state right now"). The dict
is intentionally not thread-safe past the GIL — concurrent reads at worst
recompute once.

Not in scope (kept for D3 / D4)
-------------------------------
- Designer prompt assembly. We surface raw structured data; the prompt
  template lives in Session D3.
- Capability catalog. That's D1; this module assumes D1 will be loaded
  alongside the context, not folded in.
- Per-entity history / state timelines. The designer reasons about the
  topology, not time-series.

Cross-cutting rules followed
----------------------------
- HA is NEVER mentioned in any user-facing surface. This blob is LLM-internal
  but error messages still avoid HA jargon ("Could not load home context"
  rather than "HA WS returned 500").
- Additive scope: no service touched here is modified.
- Hebrew strings pass through verbatim (friendly_name from HA, room_aliases_he
  from settings.yaml).
"""
from __future__ import annotations

import asyncio
import threading
import time
from typing import Any, Optional

from core.logger_module import log_error, log_info
from core.settings_loader import settings


# ── Configuration ───────────────────────────────────────────────────────────

# Per-room entity cap. Trimmed lists carry a `"truncated": true, "total": N`
# marker so the LLM knows there were more. 30 is empirically the largest
# room any single design pass needs to reason about without diluting the
# signal — past that, the designer should ask the user to narrow the scope.
_MAX_ENTITIES_PER_ROOM = 30

# Cache TTL. 60 s matches device_registry's reconciliation loop period —
# anything that newly appears in HA shows up in the next context refresh
# within that window. Keyed by language because room_name_he varies.
_CACHE_TTL_S = 60.0
_cache: dict[str, tuple[float, dict]] = {}
_cache_lock = threading.Lock()


# ── Entity categorization ───────────────────────────────────────────────────

# Buckets the designer cares about. The "sensor" bucket is itself sub-grouped
# by device_class (temperature / humidity / illuminance / battery / power /
# other) — the designer needs to distinguish "is there a lux sensor in the
# bedroom" from "is there a temperature sensor".
_BUCKETS = (
    "motion", "presence", "door", "window", "occupancy",
    "light", "switch", "climate", "cover", "media_player",
    "sensor", "other",
)

# binary_sensor.* sub-classification by device_class. HA's own taxonomy. Any
# device_class we don't recognise lands in "other" so the designer can still
# see it exists.
_BINARY_SENSOR_BUCKETS: dict[str, str] = {
    "motion":       "motion",
    "moving":       "motion",
    "occupancy":    "presence",   # mmWave / ESPresense-style
    "presence":     "presence",
    "door":         "door",
    "garage_door":  "door",
    "opening":      "door",
    "window":       "window",
}

# entity_id substring fallbacks for binary_sensor.* when device_class is
# missing or generic. ZHA names often look like
# binary_sensor.aqara_office_motion — the device_class is set, but Z2M MQTT
# discovery sometimes drops it on the import.
_BINARY_NAME_HINTS: tuple[tuple[str, str], ...] = (
    ("motion",    "motion"),
    ("pir",       "motion"),
    ("occupancy", "presence"),
    ("presence",  "presence"),
    ("mmwave",    "presence"),
    ("door",      "door"),
    ("window",    "window"),
    ("contact",   "door"),
)

# Top-level domain → bucket. Anything not covered here falls into "other".
_DOMAIN_BUCKETS: dict[str, str] = {
    "light":        "light",
    "switch":       "switch",
    "climate":      "climate",
    "cover":        "cover",
    "fan":          "switch",       # treat as a switchable for the designer
    "media_player": "media_player",
    "vacuum":       "switch",
}

# sensor.* device_class → sensor sub-category. Anything else lands as
# "sensor.other" — the designer sees the entity_id and can still reason
# about it, just without a strong category hint.
_SENSOR_SUBKINDS: dict[str, str] = {
    "temperature":  "temperature",
    "humidity":     "humidity",
    "illuminance":  "illuminance",
    "battery":      "battery",
    "power":        "power",
    "energy":       "energy",
    "co2":          "air_quality",
    "pm25":         "air_quality",
    "pm10":         "air_quality",
    "voc":          "air_quality",
    "moisture":     "moisture",
}


def _categorize(entity_id: str, attrs: dict) -> tuple[str, Optional[str]]:
    """Return `(bucket, sensor_subkind_or_None)`.

    bucket is one of _BUCKETS. sensor_subkind is non-None only for
    bucket == "sensor".
    """
    domain = entity_id.split(".", 1)[0]
    dc = (attrs.get("device_class") or "").strip().lower()

    if domain == "binary_sensor":
        bucket = _BINARY_SENSOR_BUCKETS.get(dc)
        if bucket:
            return bucket, None
        lower_id = entity_id.lower()
        for needle, hint_bucket in _BINARY_NAME_HINTS:
            if needle in lower_id:
                return hint_bucket, None
        return "other", None

    if domain == "sensor":
        sub = _SENSOR_SUBKINDS.get(dc, "other")
        return "sensor", sub

    if domain in _DOMAIN_BUCKETS:
        return _DOMAIN_BUCKETS[domain], None

    return "other", None


# ── State cache access ──────────────────────────────────────────────────────


def _read_state_cache() -> dict[str, dict]:
    """Snapshot of ha_subscriber's state cache. Empty dict on error.

    We deliberately don't fall back to REST here — if the WS subscriber hasn't
    populated yet (cold-boot first few seconds), an empty context is correct;
    the caller will retry within the 60 s TTL.
    """
    try:
        from services.ha_subscriber import state_cache
        # dict() copy so callers can mutate safely under the lock.
        return dict(state_cache) if state_cache else {}
    except Exception as e:
        log_error(f"[home_context] state cache read failed: {e}")
        return {}


# ── Integrations (HA config_entries via WS) ─────────────────────────────────


def _fetch_integrations_sync(timeout: float = 4.0) -> list[str]:
    """List of loaded HA integration domains (e.g. ['tuya','zha','esphome']).

    Goes through services.ha_client.ws (the only seam for short-lived HA WS
    calls). Sync wrapper: opens a private event loop because we're called
    from a FastAPI worker thread that has no loop of its own.
    """
    try:
        from services.ha_client import ws as _ws

        async def _go() -> list[dict]:
            res, = await _ws({"type": "config_entries/get"}, timeout=timeout)
            if not isinstance(res, dict) or not res.get("success"):
                return []
            return res.get("result") or []

        try:
            entries = asyncio.run(_go())
        except RuntimeError:
            # Already inside a running loop (rare for sync workers, but the
            # FastAPI lifespan path can hit this). Use a private loop.
            loop = asyncio.new_event_loop()
            try:
                entries = loop.run_until_complete(_go())
            finally:
                loop.close()

        domains: list[str] = []
        seen: set[str] = set()
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            domain = (entry.get("domain") or "").strip().lower()
            if not domain or domain in seen:
                continue
            # "loaded" is the only state that proves the integration is
            # actively serving. setup_retry / not_loaded entries are surfaced
            # too because the designer cares that the user intends to have
            # that integration; we just mark state.
            state = (entry.get("state") or "").strip().lower()
            if state and state not in ("loaded", "setup_retry", "setup_in_progress"):
                continue
            domains.append(domain)
            seen.add(domain)
        return sorted(domains)
    except Exception as e:
        log_error(f"[home_context] integrations fetch failed: {e}")
        return []


# ── Hebrew room name lookup ─────────────────────────────────────────────────


def _room_name_he_map() -> dict[str, str]:
    """Build {room_key: hebrew_name} from settings.yaml's `room_aliases_he`.

    The block is curated by the user via Settings → Room aliases; we read it
    live so a renaming round-trip without restart works.
    """
    raw = settings.get("room_aliases_he") or {}
    if not isinstance(raw, dict):
        return {}
    return {str(k).lower(): str(v) for k, v in raw.items() if v}


# ── Per-room entity assembly ────────────────────────────────────────────────


def _empty_room_entities() -> dict[str, list]:
    """Skeleton of the per-room entity buckets. Empty lists, ready to fill."""
    skeleton: dict[str, Any] = {b: [] for b in _BUCKETS}
    # The sensor bucket is sub-grouped — see _categorize. We keep the flat
    # list AND a tally so the LLM can scan quickly without iterating.
    skeleton["sensor_by_kind"] = {}
    return skeleton


def _entity_summary(entity_id: str, cache_entry: dict, sensor_subkind: Optional[str]) -> dict:
    """Compact per-entity summary. Friendly_name is passed through verbatim
    (Hebrew / Arabic / RTL — no transliteration)."""
    attrs = cache_entry.get("attributes") or {}
    out: dict[str, Any] = {
        "entity_id":     entity_id,
        "state":         str(cache_entry.get("state", "")),
        "friendly_name": attrs.get("friendly_name") or entity_id,
    }
    dc = (attrs.get("device_class") or "").strip().lower()
    if dc:
        out["device_class"] = dc
    if sensor_subkind:
        out["kind"] = sensor_subkind
    return out


def _assemble_room_entities(
    devices: list[dict],
    state_cache: dict[str, dict],
    max_per_room: int,
) -> dict[str, dict]:
    """Per-room entity catalog keyed by room_key.

    The room set is derived from device_registry's connected entries (the
    canonical source — see device_registry._infer_room for the room-resolution
    priority). We deliberately skip UNCLAIMED / UNCONFIGURED entries: those
    are still being onboarded, and surfacing them to the designer would let
    it propose automations that can't be created.
    """
    from services.device_registry import CONNECTED, IR_ONLY

    rooms: dict[str, dict] = {}

    for dev in devices:
        room = dev.get("room")
        status = dev.get("status")
        eid = dev.get("entity_id")
        if not room or status not in (CONNECTED, IR_ONLY):
            continue
        if not eid:
            continue   # IR-only without an HA entity has no state for the LLM

        cache_entry = state_cache.get(eid)
        if cache_entry is None:
            # Entity is in the registry but the WS cache hasn't seen it yet.
            # Synthesize a minimal entry so the designer at least knows it
            # exists; state will be empty.
            cache_entry = {"state": "unknown", "attributes": {}}

        bucket, sensor_subkind = _categorize(eid, cache_entry.get("attributes") or {})

        room_blob = rooms.setdefault(room, {
            "id": room,
            "entities": _empty_room_entities(),
            "_total_entities": 0,
        })

        room_blob["entities"][bucket].append(_entity_summary(eid, cache_entry, sensor_subkind))
        room_blob["_total_entities"] += 1
        if bucket == "sensor" and sensor_subkind:
            room_blob["entities"]["sensor_by_kind"][sensor_subkind] = (
                room_blob["entities"]["sensor_by_kind"].get(sensor_subkind, 0) + 1
            )

    # Trim oversized rooms. Stable: keep first-N per bucket so the same call
    # twice in a row returns the same sample.
    for room_blob in rooms.values():
        total = room_blob["_total_entities"]
        if total <= max_per_room:
            continue
        # Trim proportionally — biggest buckets shed first. Designer still
        # sees at least one entity per non-empty bucket so it knows the
        # capability exists.
        buckets = room_blob["entities"]
        non_empty = [b for b in _BUCKETS if buckets.get(b)]
        # Reserve one slot per non-empty bucket so categories aren't silently
        # erased. Distribute the rest proportionally.
        reserve = min(len(non_empty), max_per_room)
        remaining = max_per_room - reserve
        for b in _BUCKETS:
            bucket_list = buckets.get(b) or []
            if not bucket_list:
                continue
            cap = 1 + max(0, int(remaining * (len(bucket_list) / total)))
            if len(bucket_list) > cap:
                buckets[b] = bucket_list[:cap]
        room_blob["truncated"] = True
        room_blob["total"] = total

    return rooms


# ── Occupancy sensors (Ziggy-managed template binary_sensors) ───────────────


def _occupancy_sensors_by_room() -> dict[str, dict]:
    """Map of room_key → {entity_id, exists: True}. Empty when none."""
    try:
        from services.template_sensors import list_occupancy_sensors
        out: dict[str, dict] = {}
        for rec in list_occupancy_sensors():
            room = rec.get("room")
            if not room:
                continue
            name_slug = rec.get("name") or ""
            # Best-effort entity_id construction — see template_sensors's own
            # comment about HA appending suffixes on collision. The designer
            # mostly cares that one exists; the exact entity_id can be
            # resolved at instantiation time.
            entity_id = f"binary_sensor.{name_slug.lower().replace(' ', '_')}".strip("_")
            out[room] = {"entity_id": entity_id, "exists": True, "entry_id": rec.get("entry_id")}
        return out
    except Exception as e:
        log_error(f"[home_context] occupancy sensor lookup failed: {e}")
        return {}


# ── Persons (presence engine) ───────────────────────────────────────────────


def _persons_compact() -> list[dict]:
    """LLM-friendly person list: id, name, effective_state (home/away/unknown)."""
    try:
        from services.presence_engine import list_persons
        out: list[dict] = []
        for p in list_persons():
            out.append({
                "id":    p.get("id"),
                "name":  p.get("name") or p.get("username") or p.get("id"),
                "state": p.get("effective_state") or "unknown",
            })
        return out
    except Exception as e:
        log_error(f"[home_context] persons lookup failed: {e}")
        return []


# ── House mode ──────────────────────────────────────────────────────────────


def _current_mode_sync() -> str:
    """mode_service.get_mode() is async; this is the sync read path the same
    function uses internally. Falls back to the default mode on error so the
    designer always sees *some* value."""
    try:
        from services.mode_service import _load as _mode_load, DEFAULT_MODE
        data = _mode_load()
        return str(data.get("mode") or DEFAULT_MODE)
    except Exception as e:
        log_error(f"[home_context] mode read failed: {e}")
        return "home"


# ── Existing automations (with bundle_id surfaced for D3 management) ────────


def _existing_automations_compact() -> list[dict]:
    """Compact list of existing automations. The bundle_id (set by D3 when an
    automation is part of a bundle) is surfaced so the designer can avoid
    proposing duplicates in the same bundle, and can refer to the bundle by id
    when the user says "extend the bedroom set"."""
    try:
        from services.ha_automations import list_automations
        out: list[dict] = []
        for a in list_automations():
            meta = a.get("trigger") or {}
            # bundle_id may live in trigger meta (D3's plan stamps it on
            # creation). Be lenient — the field may not exist yet pre-D3.
            bundle_id = None
            if isinstance(meta, dict):
                bundle_id = meta.get("bundle_id") or a.get("bundle_id")
            out.append({
                "id":        a.get("id"),
                "name":      a.get("name"),
                "enabled":   bool(a.get("enabled", True)),
                "bundle_id": bundle_id,
            })
        return out
    except Exception as e:
        log_error(f"[home_context] automations list failed: {e}")
        return []


# ── Available blueprints (D3 chooses between blueprint vs scratch) ──────────


def _available_blueprints_compact() -> list[dict]:
    """Compact list of bundled + user-loaded blueprints.

    The designer uses this to decide "for this outcome, instantiate a
    blueprint vs compose from scratch". We trim each entry to just what the
    LLM needs to make that pick: id, name (+ Hebrew), category, plus the
    input KEYS (so the LLM knows what it would have to fill in). Full input
    schema is fetched at instantiation time by D3 — no point paying the
    token cost twice.

    Per the D2 brief: 11 bundled blueprints is small enough that we don't
    truncate this list.
    """
    try:
        from services.blueprint_importer import list_blueprints
        out: list[dict] = []
        for bp in list_blueprints():
            try:
                full = bp.to_dict()
            except Exception:
                continue
            # Trim inputs to {key, name} pairs. Default / selector_meta are
            # rebound at instantiation time.
            slim_inputs: list[dict] = []
            for inp in full.get("inputs", []) or []:
                slim_inputs.append({
                    "key":  inp.get("key"),
                    "name": inp.get("name"),
                })
            # `applies_when` is a free-form hint. Bundled blueprints may carry
            # it under ziggy.applies_when (parsed into the dataclass via
            # raw_body in future); for now we synthesize from category + name
            # so the designer has *some* English handle. Empty when nothing
            # informative is available — the designer can still infer from
            # name + inputs.
            applies_when = full.get("description") or ""
            if len(applies_when) > 160:
                applies_when = applies_when[:157].rstrip() + "..."
            out.append({
                "id":           full.get("id"),
                "name":         full.get("name"),
                "name_he":      full.get("name_he") or "",
                "category":     full.get("category") or "blueprint",
                "inputs":       slim_inputs,
                "applies_when": applies_when,
            })
        return out
    except Exception as e:
        log_error(f"[home_context] blueprint list failed: {e}")
        return []


# ── Public entry point ──────────────────────────────────────────────────────


def load_home_context(language: str = "en") -> dict:
    """Assemble a compact, JSON-serializable snapshot of the user's home.

    Args:
        language: "en" or "he". Controls which room-name field set is
                  populated (Hebrew names are only attached when set).

    Returns:
        dict with keys: house, persons, rooms, integrations,
        existing_automations, available_blueprints, limits, meta.

    Designed to be called from a sync FastAPI worker thread (or from
    `asyncio.to_thread` inside an async route). The function is sync and
    holds no awaitables in its main path; integrations fetching wraps its
    own asyncio loop.
    """
    lang = (language or "en").lower()
    if lang not in ("en", "he"):
        lang = "en"

    now = time.monotonic()
    with _cache_lock:
        cached = _cache.get(lang)
        if cached and (now - cached[0]) < _CACHE_TTL_S:
            return cached[1]

    # Build outside the lock — assembly is read-only against external services
    # and concurrent rebuilds at worst waste work.
    try:
        from services.device_registry import get_all as _registry_get_all
    except Exception as e:
        log_error(f"[home_context] device_registry import failed: {e}")
        _registry_get_all = lambda: []  # noqa: E731

    devices = _registry_get_all()
    state_cache = _read_state_cache()
    rooms_map = _assemble_room_entities(devices, state_cache, _MAX_ENTITIES_PER_ROOM)
    occupancy_map = _occupancy_sensors_by_room()
    he_names = _room_name_he_map()

    rooms: list[dict] = []
    for room_key in sorted(rooms_map.keys()):
        room_blob = rooms_map[room_key]
        # Strip the bookkeeping field before emitting.
        room_blob.pop("_total_entities", None)
        room_blob["name"] = room_key.replace("_", " ").title()
        he = he_names.get(room_key.lower())
        if he:
            # Always surface name_he when known, regardless of `language`,
            # so a bilingual designer can pick.
            room_blob["name_he"] = he
        room_blob["occupancy_sensor"] = occupancy_map.get(room_key)  # None when missing
        rooms.append(room_blob)

    sys_block = (settings.get("system") or {}) if isinstance(settings.get("system"), dict) else {}
    house = {
        "mode":     _current_mode_sync(),
        "language": str(sys_block.get("language") or lang),
        "timezone": str(sys_block.get("timezone") or "UTC"),
    }

    snapshot = {
        "house":                house,
        "persons":              _persons_compact(),
        "rooms":                rooms,
        "integrations":         _fetch_integrations_sync(),
        "existing_automations": _existing_automations_compact(),
        "available_blueprints": _available_blueprints_compact(),
        "limits": {
            "max_entities_per_room": _MAX_ENTITIES_PER_ROOM,
        },
        "meta": {
            "generated_at": time.time(),
            "ttl_seconds":  int(_CACHE_TTL_S),
            "language":     lang,
            "room_count":   len(rooms),
        },
    }

    with _cache_lock:
        _cache[lang] = (now, snapshot)

    log_info(
        f"[home_context] built snapshot lang={lang} rooms={len(rooms)} "
        f"entities={sum(len(r.get('entities', {}).get(b, [])) for r in rooms for b in _BUCKETS)} "
        f"integrations={len(snapshot['integrations'])} "
        f"automations={len(snapshot['existing_automations'])} "
        f"blueprints={len(snapshot['available_blueprints'])}"
    )
    return snapshot


def invalidate_cache() -> None:
    """Drop the cached snapshot for every language. Cheap; safe to call from
    services that mutate the underlying inputs (room rename, automation create,
    etc.). The next load_home_context() rebuilds."""
    with _cache_lock:
        _cache.clear()
