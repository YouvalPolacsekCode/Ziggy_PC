"""Reconciler — mirror Ziggy's live device model + users into the permission store.

The permission engine keeps its own resource graph (spaces + devices). This
module keeps that graph in sync with the *real* home so operators never
double-enter devices:

* rooms from the device registry become ``room`` spaces under a single ``home``;
* each registered device becomes a permission ``Device`` (its HA domain mapped
  to a capability class);
* existing auth users become person principals with a home-scoped preset role
  (via :mod:`services.permissions.compat`).

It is **diff-based and idempotent**: it only appends events for things that are
new or changed, so calling it every boot (or on a timer) doesn't bloat the log.
Reconciled devices carry ``attrs.source == "registry"`` so a later removal only
prunes registry-sourced rows, never a manually/API-created device.
"""
from __future__ import annotations

from .service import PermissionService

HOME_ID = "home"
HOME_SCOPE = f"space:{HOME_ID}"

# HA domain (+ optionally service) → permission capability class.
_DOMAIN_TO_CLASS: dict[str, str] = {
    "light": "light",
    "switch": "switch",
    "lock": "lock",
    "camera": "camera",
    "climate": "climate",
    "fan": "climate",
    "cover": "garage",
    "garage": "garage",
    "media_player": "media",
    "alarm_control_panel": "alarm",
    "sensor": "sensor",
    "binary_sensor": "sensor",
    "temperature": "sensor",
    "humidity": "sensor",
    "motion": "sensor",
}


def _class_for(device_type: str) -> str:
    return _DOMAIN_TO_CLASS.get((device_type or "").lower(), (device_type or "unknown").lower())


def _room_space_id(room: str) -> str:
    return (room or "unassigned").lower().replace(" ", "_").strip()


def _humanize(entity_id: str) -> str:
    """Turn an entity_id into a human label so a raw id NEVER surfaces in the UI.
    ``light.living_room_lamp`` → ``Living Room Lamp``."""
    obj = entity_id.split(".", 1)[-1] if "." in entity_id else entity_id
    words = obj.replace("_", " ").replace("-", " ").strip()
    return words.title() if words else entity_id


def _display_name(dev: dict, friendly: dict | None) -> str:
    """Best available human name for a device — HA friendly name first, then a
    registry-supplied name (only if it isn't itself an entity_id), then a
    humanized entity_id. Guarantees we never store/return a raw entity_id."""
    eid = dev.get("entity_id", "")
    fn = (friendly or {}).get(eid)
    if fn and fn.strip():
        return fn.strip()
    rn = dev.get("name")
    if rn and rn != eid and "." not in rn:
        return rn
    return _humanize(eid)


def reconcile_devices(service: PermissionService, devices: list[dict],
                      friendly: dict | None = None) -> dict:
    """Sync the given registry-style device dicts into the store. Returns counts.

    ``devices`` items use the device_registry shape:
    ``{entity_id, room, device_type, tags?, name?}``. ``friendly`` optionally
    maps entity_id → HA friendly_name for the best display labels.
    """
    state = service.state()
    counts = {"spaces_added": 0, "devices_added": 0, "devices_updated": 0,
              "devices_removed": 0}

    # Ensure the home root exists.
    if HOME_ID not in state.spaces:
        service.add_space(HOME_ID, "home", actor="system:reconcile")
        counts["spaces_added"] += 1

    # Desired rooms → spaces.
    desired_rooms = {_room_space_id(d.get("room")) for d in devices if d.get("room")}
    for rid in sorted(desired_rooms):
        if rid not in service.state().spaces:
            service.add_space(rid, "room", parent_ids=[HOME_ID],
                              actor="system:reconcile")
            counts["spaces_added"] += 1

    # Skip HA/Z2M internals (permit-join, per-device config switches, battery/
    # firmware sub-entities, …) using the app's canonical filter, so the
    # permission model never lists a non-device entity.
    try:
        from services.entity_filter import _should_hide
    except Exception:
        _should_hide = lambda _eid: False  # noqa: E731 - defensive fallback

    # Desired devices.
    desired: dict[str, dict] = {}
    for d in devices:
        eid = d.get("entity_id")
        if not eid or _should_hide(eid):
            continue
        desired[eid] = {
            "class": _class_for(d.get("device_type")),
            "space_id": _room_space_id(d.get("room")) if d.get("room") else None,
            "tags": sorted(set(d.get("tags", []) or []) | {d.get("device_type", "")} - {""}),
            "name": _display_name(d, friendly),
        }

    cur = service.state().devices
    for eid, want in desired.items():
        have = cur.get(eid)
        attrs = {"source": "registry", "name": want["name"]}
        if have is None:
            service.add_device(eid, want["class"], want["space_id"],
                               tags=want["tags"], attrs=attrs, actor="system:reconcile")
            counts["devices_added"] += 1
        elif (have.device_class != want["class"]
              or have.space_id != want["space_id"]
              or set(have.tags) != set(want["tags"])
              or have.attrs.get("name") != want["name"]):
            service.add_device(eid, want["class"], want["space_id"],
                               tags=want["tags"], attrs=attrs, actor="system:reconcile")
            counts["devices_updated"] += 1

    # Prune registry-sourced devices that vanished from the home.
    for eid, dev in list(cur.items()):
        if dev.attrs.get("source") == "registry" and eid not in desired:
            service.remove_device(eid, actor="system:reconcile")
            counts["devices_removed"] += 1

    return counts


def reconcile_users(service: PermissionService, users: list[dict]) -> dict:
    """Seed auth users as principals + home-scoped role bindings (diff-based)."""
    from .compat import seed_legacy_user
    state = service.state()
    counts = {"users_seeded": 0}
    for u in users:
        username = u.get("username")
        if not username:
            continue
        ref = f"person:{username}"
        if ref in state.principals:
            continue  # already seeded
        seed_legacy_user(service, username=username, role=u.get("role", "user"),
                         home_scope=HOME_SCOPE, actor="system:reconcile")
        counts["users_seeded"] += 1
    return counts


def ensure_bootstrapped(service: PermissionService | None = None) -> dict:
    """Boot hook: pull live devices + users into the store. Never raises.

    Safe to call on every startup — diff-based, so a warm store is a few
    cheap comparisons. Wrapped so a device-registry / auth-db hiccup can never
    block server boot."""
    from .runtime import get_service
    svc = service or get_service()
    out = {"devices": {}, "users": {}, "error": None}
    try:
        from services import device_registry
        devs = device_registry.get_all()
        # Best-effort: pull HA friendly names so devices show human labels, not
        # entity_ids. A failure here just falls back to humanized ids.
        friendly = {}
        try:
            from services.home_automation import get_all_states
            for s in get_all_states() or []:
                fn = (s.get("attributes") or {}).get("friendly_name")
                if fn and s.get("entity_id"):
                    friendly[s["entity_id"]] = fn
        except Exception:
            pass
        out["devices"] = reconcile_devices(svc, devs, friendly=friendly)
    except Exception as e:  # pragma: no cover - defensive boot guard
        out["error"] = f"device reconcile skipped: {e}"
    try:
        from services import auth_db
        out["users"] = reconcile_users(svc, auth_db.list_users())
    except Exception as e:  # pragma: no cover
        out["error"] = (out["error"] or "") + f" user reconcile skipped: {e}"
    return out
