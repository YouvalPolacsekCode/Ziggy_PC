"""
Physical-device grouping for the Ziggy device registry.

Background
----------
Ziggy's device registry is keyed by HA entity_id (one row per entity). A
single physical thing (Switcher boiler, Roni Zigbee sensor) exposes several
HA entities — power, current, time_left, battery, signal — and they were
each surfaced as a separate card in the UI.

This module computes a *derived* grouped view on top of the existing
entity-keyed registry. The persistent registry is untouched: that
preserves every saved automation, IR linkage, localStorage pin, and URL
bookmark (all of which key on entity_id).

A group is one of:
  - "ha"   : 2+ HA entities that share an HA `device_id`.
  - "ir"   : an IR-only / hybrid device (already grouped today in the
             registry via _merge_ir_devices).
  - "solo" : a single entity with no HA siblings (or HA registry
             unavailable, or unique_id missing).

Primary-entity rule
-------------------
For each multi-entity group, pick exactly one "primary" entity whose
state/control should dominate the card. Rule, in order:

  1. Linked IR codeset entity → primary (controllable beats everything).
  2. First entity whose domain is in CONTROLLABLE_DOMAINS, in priority
     order (climate > water_heater > media_player > lock > cover > fan
     > vacuum > humidifier > switch > light).
  3. Among sensor-only groups, prefer entities whose device_class is in
     PRIMARY_SENSOR_CLASSES (temperature beats humidity beats battery
     beats signal beats anything else).
  4. Otherwise lexicographic first entity_id.

Caching
-------
`config/entity_registry/list` returns hundreds of rows on a real HA
install. We cache the entity_id → device_id map (and per-entity
device_class) for `_CACHE_TTL_S` seconds. The cache is invalidated by
device_registry.refresh() so room edits don't show stale groupings.

Failure mode
------------
If HA's WS is unavailable, group computation falls back to one "solo"
group per entity (matching the old behavior). The grouped endpoint
never blocks the page on HA hiccups.
"""
from __future__ import annotations

import asyncio
import threading
import time
from typing import Optional

from core.logger_module import log_info, log_error
from services.ha_areas import _ws


# Priority order: lower index wins. `light` outranks `switch` because
# many smart bulbs (especially Tuya/Z2M-converted ones — TS0505B,
# GLEDOPTO) expose ancillary feature switches alongside the actual
# light entity: `switch.<id>_do_not_disturb`, `switch.<id>_effect`,
# etc. Without this ordering, Ziggy's device card would surface the
# feature toggle and the bulb itself would only be reachable from the
# device detail drawer. Pure smart plugs / wall switches have no
# `light.*` entity, so they continue to surface via `switch`.
_CONTROLLABLE_DOMAIN_PRIORITY: list[str] = [
    "climate",
    "water_heater",
    "media_player",
    "lock",
    "cover",
    "fan",
    "vacuum",
    "humidifier",
    "light",
    "switch",
]
_CONTROLLABLE_DOMAINS: frozenset[str] = frozenset(_CONTROLLABLE_DOMAIN_PRIORITY)

# When all entities in a group are sensors, this is the device_class
# preference order used to pick the primary. Anything not in this list
# falls behind the listed ones but before the lexicographic tiebreak.
_PRIMARY_SENSOR_CLASSES: list[str] = [
    "temperature",
    "humidity",
    "illuminance",
    "pressure",
    "co2",
    "pm25",
    "pm10",
    "voc",
    "power",
    "current",
    "voltage",
    "energy",
    "battery",
    "signal_strength",
]

# Binary-sensor device classes that represent the DEVICE'S PURPOSE and should
# outrank any plain-`sensor.*` siblings in the same group. Without this, a
# motion/occupancy node exposing both `binary_sensor.foo_motion` and
# `sensor.foo_illuminance` lets illuminance win the primary slot — the card
# then reads as "120 lx" instead of the motion state the user actually cares
# about. Order is priority (door > window > motion etc.) for the case where
# a single physical device exposes two purposeful binary sensors.
_PRIMARY_BINARY_SENSOR_CLASSES: list[str] = [
    "smoke",       # safety first
    "gas",
    "co",
    "moisture",    # leak
    "motion",
    "occupancy",
    "presence",
    "door",
    "window",
    "garage_door",
    "opening",
    "vibration",
    "tamper",
    "sound",
    "light",       # binary "is it dark" — rare but useful
]

# Entity-id suffix patterns that identify a purposeful binary_sensor when its
# device_class is missing (many Zigbee2MQTT motion sensors omit device_class
# but name the entity `binary_sensor.<room>_motion_occupancy` or similar).
# Order mirrors the device_class priority above so the tiebreak is consistent.
import re as _re
_PRIMARY_BINARY_SENSOR_PATTERNS: list[tuple[str, _re.Pattern]] = [
    (cls, _re.compile(rf"(?:^|_){_re.escape(cls)}(?:$|_)"))
    for cls in _PRIMARY_BINARY_SENSOR_CLASSES
] + [
    # Common aliases that aren't HA device_classes but are still purposeful.
    ("leak",     _re.compile(r"(?:^|_)leak(?:$|_)")),
    ("contact",  _re.compile(r"(?:^|_)contact(?:$|_)")),
    ("water",    _re.compile(r"(?:^|_)water_?leak(?:$|_)")),
]


# Reserved high index used as the "generic binary_sensor" fallback when
# device_class is missing AND no entity-id suffix matches. Sits at the end
# of the priority table so any *named* purposeful binary_sensor still wins
# the tiebreak — but the bare binary_sensor still outranks plain sensors
# in `_pick_primary` (battery, signal_strength etc.), which it should: the
# device's reason to exist is its binary state, not its battery level.
# Without this, the Sonoff SNZB-04P/PR2 door sensor (which ZHA exposes
# with no device_class on its binary_sensor) had `sensor.X_battery` win
# the primary slot and the card read "100%" instead of "Open/Closed".
_GENERIC_BINARY_SENSOR_SCORE = len(_PRIMARY_BINARY_SENSOR_CLASSES) + 100


def _binary_sensor_purpose_score(row: dict) -> int | None:
    """Return a priority index for a binary_sensor, or None for non-binary rows.

    Lower is better. Walks three layers, each more permissive than the last:
      1. `device_class` lookup — authoritative when HA labels the entity.
      2. Entity-id suffix match — catches Zigbee2MQTT motion sensors that
         omit device_class but name the entity `..._motion_occupancy`.
      3. Generic fallback — any binary_sensor that's not a diagnostic gets
         a high-but-finite score so it still outranks plain `sensor.*`
         entities (battery, signal_strength). A bare `binary_sensor.X`
         on a device exists *because* the device's purpose is binary;
         skipping it lets meta-metrics win the card, which is wrong for
         door sensors, leak sensors, button-press sensors, etc.
    """
    if (row.get("domain") or "") != "binary_sensor":
        return None
    dc = _device_class_of(row)
    if dc in _PRIMARY_BINARY_SENSOR_CLASSES:
        return _PRIMARY_BINARY_SENSOR_CLASSES.index(dc)
    eid = (row.get("entity_id") or "").split(".", 1)[-1].lower()
    if eid:
        for i, (_, pat) in enumerate(_PRIMARY_BINARY_SENSOR_PATTERNS):
            if pat.search(eid):
                return i
    # Generic-binary fallback. Skip when the binary_sensor is obviously a
    # health/meta indicator rather than the device's purpose — `connectivity`,
    # `problem`, `update` and `battery_charging` are about the device, not
    # what it senses. (`battery` here means low-battery alert, also meta.)
    if dc in {"connectivity", "problem", "update", "battery", "battery_charging", "running", "plug"}:
        return None
    return _GENERIC_BINARY_SENSOR_SCORE

# Metric pills surfaced on the card (in this order, capped client-side
# to ~2). These are device_classes whose value is "interesting at a glance"
# alongside the primary control.
SECONDARY_METRIC_CLASSES: list[str] = [
    "power",
    "current",
    "voltage",
    "energy",
    "temperature",
    "humidity",
    "illuminance",
    "battery",
    "signal_strength",
    "duration",  # Switcher's time_left
]

# Sensor entities that should appear as a "metric" rather than a control.
_SENSOR_DOMAINS: frozenset[str] = frozenset({"sensor", "binary_sensor"})

# Domains kept as siblings but never promoted to primary. These show up in
# the Info tab but never drive the card. Matches device_router's
# _DETAIL_SKIP_DOMAINS so the two views agree on what counts as a "real"
# entity.
_DIAGNOSTIC_DOMAINS: frozenset[str] = frozenset({
    "button", "number", "select", "update", "text",
})


# ---------------------------------------------------------------------------
# HA entity registry cache
# ---------------------------------------------------------------------------

_CACHE_TTL_S = 60.0
_cache_lock = threading.Lock()
_cache_entry: dict | None = None  # {fetched_at, by_entity, names}


def _build_canonical_id_map(devices: list[dict]) -> dict[str, str]:
    """Union-find over HA device entries: any two devices that share an
    identifier tuple OR a MAC-style connection collapse to the same
    canonical id. Result is `{raw_device_id: canonical_id}`.

    Why this exists: HA assigns separate `device_id`s when the same physical
    box is registered by two integrations (e.g. Chromecast via Cast +
    Android TV Remote via `androidtv_remote`). Without merging, Ziggy
    would show the user TWO cards for one streamer. HA's own UI merges
    these when their `identifiers` or `connections` overlap — we mirror
    that logic here.

    Cheap O(n²) walk over identifiers; HA installs typically have <500
    devices, so the cost is negligible compared to the WS roundtrip.
    """
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        while parent.get(x, x) != x:
            parent[x] = parent.get(parent[x], parent[x])  # path compression
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra == rb:
            return
        # Stable: pick the lexicographically smaller id as the canonical
        # one. Deterministic across runs even if HA reorders devices.
        if ra < rb:
            parent[rb] = ra
        else:
            parent[ra] = rb

    # Initialise singletons.
    for d in devices:
        did = d.get("id")
        if did:
            parent[did] = did

    # Map identifier tuples → device_ids, then union devices that share any.
    # identifiers are HA's primary cross-integration link (e.g. Apple TV
    # exposes ("appletv", "<UUID>") that the AirPlay integration ALSO
    # advertises). Same for connections — MAC tuples on the same physical NIC.
    by_identifier: dict[tuple, list[str]] = {}
    by_connection: dict[tuple, list[str]] = {}
    for d in devices:
        did = d.get("id")
        if not did:
            continue
        for ident in (d.get("identifiers") or []):
            # HA serialises identifiers as [["domain", "value"], ...]; coerce
            # to a hashable tuple so we can key the dict.
            try:
                key = tuple(ident)
            except TypeError:
                continue
            by_identifier.setdefault(key, []).append(did)
        for conn in (d.get("connections") or []):
            try:
                ctype, cvalue = conn[0], conn[1]
            except (IndexError, TypeError):
                continue
            # Only merge on stable hardware connections — MAC primarily.
            # Skip "ip" (DHCP-volatile) and "bluetooth" addresses unless
            # we have a strong reason; MAC alone catches the Cast-vs-ATR
            # case which is the main motivator.
            if ctype not in ("mac", "zigbee", "zwave"):
                continue
            by_connection.setdefault((ctype, str(cvalue).lower()), []).append(did)

    for ids in by_identifier.values():
        for other in ids[1:]:
            union(ids[0], other)
    for ids in by_connection.values():
        for other in ids[1:]:
            union(ids[0], other)

    return {did: find(did) for did in parent}


async def _fetch_ha_registry_async() -> dict:
    """Read entity + device registry from the shared ha_areas snapshot cache.

    Returns:
      {
        "by_entity":      {entity_id: {"device_id", "area_id"}},
        "device_names":   {canonical_id: friendly_name},
        "canonical_id":   {raw_device_id: canonical_id},   # phase-0 merge
        "ok":             bool,
      }

    `canonical_id` is the cross-integration merge map (see
    `_build_canonical_id_map`). Callers should map entity → device_id →
    canonical_id before bucketing.

    Empty dicts on failure; caller skips cache write so the next attempt
    retries instead of pinning empty-group state.
    """
    try:
        from services.ha_areas import get_registry_snapshot
        snap = await get_registry_snapshot()
        entries = snap.get("entities") or []
        devices = snap.get("devices") or []
        canonical_id_map = _build_canonical_id_map(devices)
        by_entity: dict[str, dict] = {}
        for e in entries:
            eid = e.get("entity_id")
            did = e.get("device_id")
            if not eid:
                continue
            by_entity[eid] = {
                "device_id": did,
                "area_id":   e.get("area_id"),
            }
        # Resolve names against the CANONICAL id. When two raw devices merge,
        # take the first non-empty name we see — `name_by_user` from the
        # primary integration usually wins because users edit that one.
        device_names: dict[str, str] = {}
        for d in devices:
            did = d.get("id")
            if not did:
                continue
            canonical = canonical_id_map.get(did, did)
            name = (d.get("name_by_user") or d.get("name") or "").strip()
            if name and canonical not in device_names:
                device_names[canonical] = name
        return {
            "by_entity":     by_entity,
            "device_names":  device_names,
            "canonical_id":  canonical_id_map,
            "ok":            True,
        }
    except Exception as e:
        log_error(f"[DeviceGroups] HA registry fetch failed: {e}")
        return {
            "by_entity": {}, "device_names": {}, "canonical_id": {}, "ok": False,
        }


def _get_cached_registry() -> dict:
    """Return cached registry or fetch fresh. Synchronous wrapper.

    Most callers are sync endpoint handlers — using asyncio.run() here
    isn't viable when the caller is itself in an event loop. We hop
    over to a temporary thread to await the fetch in those cases.
    """
    now = time.time()
    with _cache_lock:
        if _cache_entry and (now - _cache_entry["fetched_at"]) < _CACHE_TTL_S:
            return _cache_entry

    # Cache miss — fetch. If we're already inside an event loop, the
    # cleanest path is to run a fresh loop on a worker thread.
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop is None:
        result = asyncio.run(_fetch_ha_registry_async())
    else:
        # Synchronous code inside a running loop is the awkward case —
        # fall back to a worker thread that runs its own loop.
        result_box: dict = {}
        def _worker():
            result_box["data"] = asyncio.run(_fetch_ha_registry_async())
        t = threading.Thread(target=_worker, daemon=True)
        t.start()
        t.join(timeout=8.0)
        result = result_box.get("data") or {"by_entity": {}, "device_names": {}, "ok": False}

    with _cache_lock:
        # Re-check under lock in case another caller filled the cache while we awaited.
        # Only persist a SUCCESSFUL fetch — caching an empty result on failure
        # used to pin "all devices ungrouped" until TTL expired, even after HA
        # recovered seconds later. Failed fetches return the empty result
        # transparently so the next caller retries.
        if result.get("ok") and (
            not _cache_entry or (now - _cache_entry["fetched_at"]) >= _CACHE_TTL_S
        ):
            globals()["_cache_entry"] = {
                "fetched_at":   time.time(),
                "by_entity":    result.get("by_entity") or {},
                "device_names": result.get("device_names") or {},
                "canonical_id": result.get("canonical_id") or {},
            }
        return _cache_entry or {
            "fetched_at":   time.time(),
            "by_entity":    result.get("by_entity") or {},
            "device_names": result.get("device_names") or {},
            "canonical_id": result.get("canonical_id") or {},
        }


async def get_cached_registry_async() -> dict:
    """Async version of _get_cached_registry() — preferred from FastAPI handlers."""
    now = time.time()
    with _cache_lock:
        if _cache_entry and (now - _cache_entry["fetched_at"]) < _CACHE_TTL_S:
            return _cache_entry
    fresh = await _fetch_ha_registry_async()
    with _cache_lock:
        # Same poison-the-cache fix as the sync path: skip the write when the
        # underlying HA fetch failed. Stale cached data, if any, is preferred
        # over forcing every entity to render as a solo card.
        if fresh.get("ok"):
            globals()["_cache_entry"] = {
                "fetched_at":   time.time(),
                "by_entity":    fresh.get("by_entity") or {},
                "device_names": fresh.get("device_names") or {},
                "canonical_id": fresh.get("canonical_id") or {},
            }
        return _cache_entry or {
            "fetched_at":   time.time(),
            "by_entity":    fresh.get("by_entity") or {},
            "device_names": fresh.get("device_names") or {},
            "canonical_id": fresh.get("canonical_id") or {},
        }


def invalidate_cache() -> None:
    """Drop the HA-registry cache so the next group fetch re-reads HA.

    Called by device_registry.refresh() so room edits propagate quickly.
    """
    with _cache_lock:
        globals()["_cache_entry"] = None


# ---------------------------------------------------------------------------
# Grouping
# ---------------------------------------------------------------------------

def _device_class_priority(device_class: str | None) -> int:
    if not device_class:
        return len(_PRIMARY_SENSOR_CLASSES) + 1
    try:
        return _PRIMARY_SENSOR_CLASSES.index(device_class)
    except ValueError:
        return len(_PRIMARY_SENSOR_CLASSES)


def _domain_priority(domain: str) -> int:
    try:
        return _CONTROLLABLE_DOMAIN_PRIORITY.index(domain)
    except ValueError:
        return len(_CONTROLLABLE_DOMAIN_PRIORITY) + 1


def _pick_primary(rows: list[dict]) -> dict:
    """Return the row from `rows` that should drive the card.

    Each row is an enriched device-registry entry (the shape returned by
    _enrich_devices_with_ha_state).
    """
    # 1. Linked IR codeset present anywhere in the group → that row wins.
    for r in rows:
        if r.get("ir_device_id") and r.get("entity_id"):
            return r
    for r in rows:
        if r.get("ir_device_id"):
            return r

    # Best purposeful binary_sensor (the device's reason to exist:
    # presence/motion/door/smoke/leak). Extracted so step 2 can consult it.
    def _best_purposeful_binary() -> dict | None:
        scored: list[tuple[int, dict]] = []
        for r in rows:
            score = _binary_sensor_purpose_score(r)
            if score is not None:
                scored.append((score, r))
        if not scored:
            return None
        scored.sort(key=lambda t: (t[0], t[1].get("entity_id") or ""))
        return scored[0][1]

    # 2. Best controllable domain — with one exception: a bare `switch` must NOT
    #    hijack the card from a purposeful binary_sensor. A rich sensor (Aqara
    #    FP300, mmWave nodes, …) exposes feature/config switches (adaptive
    #    sensitivity, interference self-ID) that are settings, not the device's
    #    identity — its presence/motion state is. Strong controllables (light,
    #    climate, cover, lock, media_player, fan) still win: those ARE the
    #    device. Plugs / wall-switches keep winning too — they expose no
    #    purposeful binary_sensor to lose to.
    controllable = [r for r in rows if (r.get("domain") or "") in _CONTROLLABLE_DOMAINS]
    if controllable:
        controllable.sort(key=lambda r: (_domain_priority(r["domain"]), r.get("entity_id") or ""))
        best = controllable[0]
        if (best.get("domain") or "") == "switch":
            purposeful = _best_purposeful_binary()
            if purposeful is not None:
                return purposeful
        return best

    # 3. No controllable — a purposeful binary_sensor outranks sibling sensor.*.
    #    (A motion node exposes binary_sensor.foo_motion alongside
    #    sensor.foo_illuminance + sensor.foo_battery; without this, illuminance
    #    would win on device_class priority and the card would read "120 lx".)
    purposeful = _best_purposeful_binary()
    if purposeful is not None:
        return purposeful

    # 4. Sensor-only (or no purposeful binary) — pick by device_class.
    def _sort_key(r: dict) -> tuple:
        dc = _device_class_of(r)
        return (_device_class_priority(dc), r.get("entity_id") or "")

    rows_sorted = sorted(rows, key=_sort_key)
    return rows_sorted[0]


def _classify_role(row: dict, is_primary: bool) -> str:
    if is_primary:
        return "primary"
    domain = (row.get("domain") or "").lower()
    if domain in _SENSOR_DOMAINS:
        return "metric"
    if domain in _DIAGNOSTIC_DOMAINS:
        return "diagnostic"
    return "secondary"


def _device_class_of(row: dict) -> str | None:
    attrs = row.get("ha_attributes") or {}
    if not isinstance(attrs, dict):
        return None
    dc = attrs.get("device_class")
    return dc if isinstance(dc, str) else None


def _unit_of(row: dict) -> str | None:
    attrs = row.get("ha_attributes") or {}
    if not isinstance(attrs, dict):
        return None
    u = attrs.get("unit_of_measurement")
    return u if isinstance(u, str) else None


def _state_of(row: dict):
    return row.get("ha_state")


def _entity_summary(row: dict, is_primary: bool) -> dict:
    """Compact per-entity dict shipped to the frontend inside the group."""
    return {
        "entity_id":     row.get("entity_id"),
        "domain":        row.get("domain"),
        "role":          _classify_role(row, is_primary),
        "device_class":  _device_class_of(row),
        "unit":          _unit_of(row),
        "state":         _state_of(row),
        "display_name":  row.get("display_name") or row.get("name") or row.get("entity_id"),
    }


def _group_name(rows: list[dict], primary: dict, device_name: str | None) -> str:
    """Pick a friendly group label.

    Strategy: HA's device-registry name (manually edited by the user)
    wins. Otherwise, fall back to the primary entity's display_name
    minus common per-entity suffixes (" Power", " Battery", etc.) so a
    Switcher group named only via per-entity friendly_names still reads
    as "Switcher Boiler" instead of "Switcher Boiler Power".
    """
    if device_name:
        return device_name
    raw = primary.get("display_name") or primary.get("name") or primary.get("entity_id") or "Device"
    # Strip trailing metric-style suffix tokens. Order matters: longest first.
    _SUFFIXES = (
        " Time Left", " Power Sensor", " Power", " Current", " Voltage",
        " Energy", " Battery", " Battery Level", " Signal Strength",
        " Signal", " Link Quality", " Temperature", " Humidity",
    )
    for suf in _SUFFIXES:
        if raw.endswith(suf):
            return raw[: -len(suf)].strip() or raw
    return raw


def build_groups(enriched_devices: list[dict], registry: dict | None = None) -> list[dict]:
    """Group enriched registry rows by HA *canonical* device_id.

    `enriched_devices` is the output of _enrich_devices_with_ha_state(): each
    row has `entity_id`, `ir_device_id`, `room`, `device_type`, `status`,
    `name`, `domain`, `ha_state`, `ha_attributes`, `display_name`, ...

    Cross-integration merge: when the registry exposes a `canonical_id`
    map (see `_build_canonical_id_map`), entities whose raw HA `device_id`s
    collapse to the same canonical id are grouped onto a single card. This
    is what unifies the Cast + Android-TV-Remote case where one streamer
    appears under two integrations.

    Returns a list of group dicts (see module docstring).
    """
    reg = registry or {"by_entity": {}, "device_names": {}, "canonical_id": {}}
    by_entity = reg.get("by_entity") or {}
    device_names = reg.get("device_names") or {}
    canonical_id_map = reg.get("canonical_id") or {}

    # Pass 1: bucket rows by (kind, key).
    buckets: dict[tuple[str, str], list[dict]] = {}
    bucket_order: list[tuple[str, str]] = []

    def _bucket(key: tuple[str, str], row: dict) -> None:
        if key not in buckets:
            buckets[key] = []
            bucket_order.append(key)
        buckets[key].append(row)

    for row in enriched_devices:
        eid = row.get("entity_id")
        ir_id = row.get("ir_device_id")

        # IR-only row (no HA entity) → always its own group, keyed by ir_id.
        if ir_id and not eid:
            _bucket(("ir", ir_id), row)
            continue

        # HA entity (with or without linked IR) → group by canonical device_id.
        # When HA reports a raw device_id and we have a canonical mapping for
        # it, use that — collapses Cast+ATR (and any other shared-identifier
        # or shared-MAC pair) into one bucket.
        ha_meta = by_entity.get(eid or "") if eid else None
        ha_device_id = (ha_meta or {}).get("device_id") if ha_meta else None
        if ha_device_id:
            canonical = canonical_id_map.get(ha_device_id, ha_device_id)
            _bucket(("ha", canonical), row)
        else:
            # Solo: entity not in HA registry, or no device_id (template/manual entities).
            _bucket(("solo", eid or f"row_{id(row)}"), row)

    # Pass 2: assemble each group.
    groups: list[dict] = []
    for key in bucket_order:
        rows = buckets[key]
        kind, key_value = key
        primary = _pick_primary(rows)
        primary_eid = primary.get("entity_id")
        ha_device_id = key_value if kind == "ha" else None
        ir_device_id = key_value if kind == "ir" else None
        # For non-IR-only groups, also surface a linked IR device on the
        # group (hybrid) — picked off the primary row if present.
        if not ir_device_id:
            ir_device_id = primary.get("ir_device_id")

        # Group id — stable, kind-prefixed so callers can distinguish solo from grouped.
        if kind == "ha":
            group_id = f"ha_{ha_device_id}"
        elif kind == "ir":
            group_id = f"ir_{ir_device_id}"
        else:
            group_id = f"solo_{primary_eid or key_value}"

        # Friendly group name.
        device_name = device_names.get(ha_device_id) if ha_device_id else None
        name = _group_name(rows, primary, device_name)

        # Room — prefer the primary row's room; fall back to any non-empty room
        # in the group. This matters during transient states where one sibling
        # entity has been assigned but others haven't yet.
        room = primary.get("room")
        if not room:
            for r in rows:
                if r.get("room"):
                    room = r["room"]
                    break

        # Status — primary wins; "connected" beats "unclaimed" overall when at
        # least one sibling is connected (otherwise the group reads as
        # unclaimed even though the controllable entity works).
        statuses = {r.get("status") for r in rows}
        if "connected" in statuses:
            group_status = "connected"
        elif primary.get("status"):
            group_status = primary["status"]
        else:
            # Fall back to any non-None status.
            group_status = next((s for s in statuses if s), None)

        entities = [
            _entity_summary(r, is_primary=(r is primary))
            for r in rows
        ]
        # Stable ordering: primary first, then metrics by device_class priority,
        # then everything else alphabetically.
        def _entity_sort_key(e: dict) -> tuple:
            role = e.get("role")
            if role == "primary":
                return (0, "")
            if role == "metric":
                return (1, str(_device_class_priority(e.get("device_class"))))
            if role == "diagnostic":
                return (3, e.get("entity_id") or "")
            return (2, e.get("entity_id") or "")
        entities.sort(key=_entity_sort_key)

        groups.append({
            "group_id":            group_id,
            "kind":                kind,
            "name":                name,
            "room":                room,
            "status":              group_status,
            "primary_entity_id":   primary_eid,
            "primary_domain":      primary.get("domain"),
            "primary_state":       _state_of(primary),
            "ha_device_id":        ha_device_id,
            "ir_device_id":        ir_device_id,
            "entities":            entities,
            # Convenience for the card render — quick-lookup of common metric values.
            "metrics":             _build_metric_pills(rows, primary),
            # Phase 1: per-group capability projection. The frontend reads
            # this to decide which remote sections to render, replacing the
            # stack of source_list/heuristic checks scattered across
            # DeviceRemote.jsx and TVRemote.jsx.
            "capabilities":        _project_capabilities(rows, primary),
        })
    return groups


# ---------------------------------------------------------------------------
# Capability projection (Phase 1)
# ---------------------------------------------------------------------------
#
# A "capability" is a coarse-grained yes/no statement about what the GROUP can
# do, regardless of which sibling entity backs it. The frontend reads
# `group.capabilities.*` to decide what UI to render — e.g. whether to show
# the OS-nav d-pad, the numpad, the volume row.
#
# This is the single source of truth so the frontend stops re-deriving the
# same answer from heuristics over `source_list` length + paired-remote-id
# basename matching + vendor adapter tables. Each capability cites the
# evidence that satisfied it in `capabilities.evidence` for debugging.
#
# HA media_player supported_features bitmask (subset we care about):
_MP_FEAT = {
    "pause":          1,
    "seek":           2,
    "volume_set":     4,
    "volume_mute":    8,
    "previous_track": 16,
    "next_track":     32,
    "turn_on":        128,
    "turn_off":       256,
    "play_media":     512,
    "volume_step":    1024,
    "select_source":  2048,
    "stop":           4096,
    "play":           16384,
}


def _mp_supports(row: dict, feat_name: str) -> bool:
    attrs = row.get("ha_attributes") or {}
    if not isinstance(attrs, dict):
        return False
    bits = attrs.get("supported_features")
    if not isinstance(bits, (int, float)):
        return False
    mask = _MP_FEAT.get(feat_name, 0)
    return bool(int(bits) & mask)


def _project_capabilities(rows: list[dict], primary: dict) -> dict:
    """Compute the capability map shipped on each group.

    Capabilities surfaced today:
      - power:           any controllable domain or IR codeset present
      - media_transport: media_player advertises play/pause/seek bits
      - volume:          media_player advertises VOLUME_* bits, or IR vol codes
      - source_select:   media_player advertises SELECT_SOURCE and has sources
      - os_nav:          sibling `remote.*` entity, or IR with nav codes
      - app_awareness:   media_player exposes app_id/app_name (streamer-style)
      - digit_input:     sibling `remote.*` (assumed to accept digits), or IR
                         with 0-9 codes
      - diagnostics:     any sibling sensor/binary_sensor row

    Evidence is a flat list of short tags ("mp_seek", "ir_power_on", "remote_sibling")
    that explain WHY each capability was set — useful when debugging "why does
    the d-pad show for this Apple TV but not that one?".
    """
    caps: dict = {
        "power":           False,
        "media_transport": False,
        "volume":          False,
        "source_select":   False,
        "os_nav":          False,
        "app_awareness":   False,
        "digit_input":     False,
        "diagnostics":     False,
    }
    evidence: list[str] = []

    # Sibling-domain quick lookup.
    has_remote_sibling = False
    remote_sibling_eid: str | None = None
    has_sensor_sibling = False
    for r in rows:
        dom = (r.get("domain") or "").lower()
        if dom == "remote":
            has_remote_sibling = True
            remote_sibling_eid = remote_sibling_eid or r.get("entity_id")
        if dom in _SENSOR_DOMAINS:
            has_sensor_sibling = True

    # Aggregate IR-command set across all rows. The IR codes live under
    # `ha_attributes.learned_commands` for pure-IR rows and under
    # `ha_attributes._linkedIr.learned_commands` for hybrid HA+IR rows (the
    # device_router enrich step attaches the linked IR snapshot when a
    # codeset is paired with an HA entity). Walk both so the capability
    # fires regardless of which sibling owns the codeset.
    ir_commands: set[str] = set()
    def _collect_ir(d: dict) -> None:
        learned = d.get("learned_commands") if isinstance(d, dict) else None
        if isinstance(learned, (list, set, tuple)):
            for c in learned:
                if isinstance(c, str):
                    ir_commands.add(c.lower())
        cmds = d.get("commands") if isinstance(d, dict) else None
        if isinstance(cmds, dict):
            for c in cmds.keys():
                if isinstance(c, str):
                    ir_commands.add(c.lower())
    for r in rows:
        attrs = r.get("ha_attributes") or {}
        if not isinstance(attrs, dict):
            continue
        _collect_ir(attrs)
        _collect_ir(attrs.get("_linkedIr") or {})

    # power: controllable domain OR IR power code OR media_player turn_on bit.
    if any((r.get("domain") or "") in _CONTROLLABLE_DOMAINS for r in rows):
        caps["power"] = True
        evidence.append("controllable_domain")
    if {"power_on", "power_off", "power_toggle"} & ir_commands:
        caps["power"] = True
        evidence.append("ir_power")
    for r in rows:
        if (r.get("domain") or "") == "media_player" and (
            _mp_supports(r, "turn_on") or _mp_supports(r, "turn_off")
        ):
            caps["power"] = True
            evidence.append("mp_power")
            break

    # media_transport: play OR pause OR seek bit on any media_player row.
    for r in rows:
        if (r.get("domain") or "") != "media_player":
            continue
        if _mp_supports(r, "play") or _mp_supports(r, "pause"):
            caps["media_transport"] = True
            evidence.append("mp_transport")
        if _mp_supports(r, "seek"):
            caps["media_transport"] = True
            evidence.append("mp_seek")
        if _mp_supports(r, "select_source"):
            attrs = r.get("ha_attributes") or {}
            srcs = attrs.get("source_list") if isinstance(attrs, dict) else None
            if isinstance(srcs, list) and srcs:
                caps["source_select"] = True
                evidence.append(f"mp_source_list:{len(srcs)}")
        if _mp_supports(r, "volume_set") or _mp_supports(r, "volume_step"):
            caps["volume"] = True
            evidence.append("mp_volume")
        attrs = r.get("ha_attributes") or {}
        if isinstance(attrs, dict):
            if attrs.get("app_name") or attrs.get("app_id"):
                caps["app_awareness"] = True
                evidence.append("mp_app_name")

    # IR volume codes can stand in when there's no media_player.
    if {"vol_up", "vol_down", "volume_up", "volume_down"} & ir_commands:
        caps["volume"] = True
        evidence.append("ir_volume")

    # os_nav: sibling remote.* (Apple TV / Android TV Remote / etc.) OR IR
    # nav codes (back/home/menu/d-pad arrows).
    if has_remote_sibling:
        caps["os_nav"] = True
        evidence.append("remote_sibling")
    if {"back", "home", "menu", "nav_up", "nav_down", "nav_left", "nav_right", "nav_ok"} & ir_commands:
        caps["os_nav"] = True
        evidence.append("ir_nav")

    # digit_input: sibling remote.* (accepts numeric send_command) OR IR digits.
    if has_remote_sibling:
        caps["digit_input"] = True
        evidence.append("remote_digits")
    if {str(d) for d in range(10)} & ir_commands:
        caps["digit_input"] = True
        evidence.append("ir_digits")

    if has_sensor_sibling:
        caps["diagnostics"] = True
        evidence.append("sensor_sibling")

    return {
        **caps,
        "companion_remote_entity_id": remote_sibling_eid,
        "evidence": evidence,
    }


def _build_metric_pills(rows: list[dict], primary: dict) -> list[dict]:
    """Pick up to ~3 'glance' metric values to surface on the card.

    Driven by device_class, in `SECONDARY_METRIC_CLASSES` order. Skipped
    when a sibling is the primary (e.g. a temperature sensor's primary
    *is* the temperature — no need to repeat it as a pill).
    """
    seen: set[str] = set()
    pills: list[dict] = []
    primary_eid = primary.get("entity_id")
    for dc in SECONDARY_METRIC_CLASSES:
        for r in rows:
            if r.get("entity_id") == primary_eid:
                continue  # don't echo primary
            if _device_class_of(r) != dc:
                continue
            if dc in seen:
                continue
            seen.add(dc)
            pills.append({
                "device_class": dc,
                "entity_id":    r.get("entity_id"),
                "state":        _state_of(r),
                "unit":         _unit_of(r),
            })
            break
        if len(pills) >= 3:
            break
    return pills


__all__ = [
    "build_groups",
    "get_cached_registry_async",
    "invalidate_cache",
    "SECONDARY_METRIC_CLASSES",
]
