"""Stateless button / scene controllers (wireless remotes, cubes, knobs).

Why this module exists
----------------------
Every other device in Ziggy *has state*: a light is on, a sensor reads 21°C.
The device list is therefore built from visible Home Assistant states.

A controller has no state. It emits an event and goes back to sleep. Zigbee2MQTT
publishes those presses to HA as MQTT **device triggers**
(`homeassistant/device_automation/<ieee>/action_<subtype>/config`), which are
stateless by design and create *no HA entity at all*. Its only real entities are
battery / voltage / link-quality and a couple of config dropdowns — every one of
which `services.entity_filter` correctly hides.

The result, before this module: an Aqara WXKG22LM paired perfectly on Canary,
published `single_left` on every press, and appeared **nowhere** in Ziggy —
283 HA entities reduced to 99 visible, 0 of them belonging to the remote. It
could not be seen, named, put in a room, or used as an automation trigger.

So controllers are sourced from the retained discovery topics instead of from
HA state, and projected into the same group shape the device cards already
render. Nothing here reaches into the state-driven path; it runs alongside it.

Why MQTT triggers and not HA `device` triggers
----------------------------------------------
HA can trigger off `platform: device` with the MQTT device_id, but that binds
the automation to an HA device-registry row that churns when a device is
re-paired or the MQTT integration is reloaded — the automation then silently
never fires. The discovery payload hands us the literal `topic` and `payload`
Z2M will publish, so `platform: mqtt` is both simpler and stable across
re-pairing. It is also what Z2M's own documentation recommends.
"""
from __future__ import annotations

import asyncio
import re
import time
from typing import Any, Iterable

from core.logger_module import log_error

# Retained discovery topic: homeassistant/device_automation/<node>/<name>/config
_DISCOVERY_RE = re.compile(
    r"^homeassistant/device_automation/(?P<node>[^/]+)/(?P<name>[^/]+)/config$"
)

_Z2M_IDENTIFIER_PREFIX = "zigbee2mqtt_"


class UnknownController(LookupError):
    """No controller with that address is currently known."""


class UnknownAction(LookupError):
    """The controller exists but does not offer that button/gesture."""


# ── Plain-language labelling ───────────────────────────────────────────────
# Z2M action subtypes are `<gesture>` or `<gesture>_<button>`. Ziggy is the only
# product surface the customer ever sees, so nothing Zigbee-shaped may reach a
# label — no underscores, no addresses, no "subtype".

_GESTURES = {
    "single": "single press",
    "double": "double press",
    "triple": "triple press",
    "quadruple": "quadruple press",
    "hold": "long press",
    "release": "release",
    "press": "press",
    "rotate_left": "rotate left",
    "rotate_right": "rotate right",
    "shake": "shake",
    "flip": "flip",
    "slide": "slide",
    "tap": "tap",
    "wakeup": "wake",
}

_BUTTONS = {
    "left": "Left button",
    "right": "Right button",
    "both": "Both buttons",
    "middle": "Middle button",
    "center": "Middle button",
    "top": "Top button",
    "bottom": "Bottom button",
    "1": "Button 1", "2": "Button 2", "3": "Button 3",
    "4": "Button 4", "5": "Button 5", "6": "Button 6",
}

# Reading order for the card and the trigger picker.
_BUTTON_ORDER = ["", "left", "middle", "center", "right", "both", "top", "bottom",
                 "1", "2", "3", "4", "5", "6"]
_GESTURE_ORDER = ["single", "double", "triple", "quadruple", "hold", "release",
                  "press", "rotate_left", "rotate_right"]


def _split_action(subtype: str) -> tuple[str, str]:
    """Split a Z2M subtype into (gesture, button). Either half may be empty.

    Handles the two-token gestures (`rotate_left`) before treating a trailing
    token as a button name, otherwise "rotate_left" reads as gesture=rotate,
    button=left and renders as "Left button — rotate".
    """
    s = (subtype or "").strip().lower()
    for g in ("rotate_left", "rotate_right"):
        if s == g:
            return g, ""
        if s.startswith(g + "_"):
            return g, s[len(g) + 1:]
    if "_" in s:
        gesture, _, button = s.partition("_")
        if button in _BUTTONS:
            return gesture, button
        return s, ""
    return s, ""


def action_label(subtype: str) -> str:
    """Human label for one button/gesture, e.g. 'Left button — single press'."""
    gesture, button = _split_action(subtype)
    g_text = _GESTURES.get(gesture)
    if g_text is None:
        g_text = (gesture or subtype or "").replace("_", " ").strip()
    b_text = _BUTTONS.get(button)
    if b_text:
        return f"{b_text} — {g_text}"
    return g_text[:1].upper() + g_text[1:] if g_text else str(subtype)


def _action_sort_key(subtype: str) -> tuple:
    gesture, button = _split_action(subtype)
    b_i = _BUTTON_ORDER.index(button) if button in _BUTTON_ORDER else len(_BUTTON_ORDER)
    g_i = _GESTURE_ORDER.index(gesture) if gesture in _GESTURE_ORDER else len(_GESTURE_ORDER)
    return (b_i, g_i, subtype)


# ── Discovery parsing ──────────────────────────────────────────────────────

def _address_of(device: dict) -> str | None:
    """Stable physical address from the discovery `device` block.

    Prefers the Z2M identifier (`zigbee2mqtt_0x54ef...`) because it survives a
    rename; falls back to any identifier so non-Z2M MQTT controllers still land.
    """
    ids = device.get("identifiers")
    if isinstance(ids, str):
        ids = [ids]
    for ident in ids or []:
        if isinstance(ident, (list, tuple)) and len(ident) >= 2:
            ident = ident[-1]
        if not isinstance(ident, str):
            continue
        if ident.startswith(_Z2M_IDENTIFIER_PREFIX):
            return ident[len(_Z2M_IDENTIFIER_PREFIX):]
    for ident in ids or []:
        if isinstance(ident, str) and ident:
            return ident
    return None


def _display_name(device: dict, address: str) -> str:
    """Never show a raw address. Z2M names an un-renamed device by its IEEE."""
    name = (device.get("name") or "").strip()
    if name and name.lower() != (address or "").lower():
        return name
    model = (device.get("model") or "").strip()
    if model:
        return model
    model_id = (device.get("model_id") or "").strip()
    return model_id or "Controller"


def parse_discovery(messages: Iterable[tuple[str, Any]]) -> list[dict]:
    """Build controller models from retained HA MQTT-discovery messages.

    `messages` is an iterable of (topic, payload) where payload is the decoded
    JSON dict, or None/empty for a cleared retained topic (Z2M's way of
    retracting a trigger — the button must then disappear, not linger).

    Non-trigger discovery (sensors, selects) is ignored, and one malformed
    message never sinks the batch: a hub with a half-written retained topic
    must still surface its other controllers.
    """
    by_addr: dict[str, dict] = {}
    cleared: set[tuple[str, str]] = set()

    for topic, payload in messages or []:
        try:
            m = _DISCOVERY_RE.match(topic or "")
            if not m:
                continue
            if not payload:
                # Retracted trigger — remember and strip after the pass, since
                # the clear may arrive before the config in an unordered batch.
                cleared.add((m.group("node"), m.group("name")))
                continue
            if not isinstance(payload, dict):
                continue
            if payload.get("automation_type") != "trigger":
                continue
            device = payload.get("device")
            if not isinstance(device, dict):
                continue
            address = _address_of(device)
            if not address:
                continue
            mq_topic, mq_payload = payload.get("topic"), payload.get("payload")
            if not mq_topic or mq_payload in (None, ""):
                continue
            subtype = str(payload.get("subtype") or "").strip()
            if not subtype:
                continue

            entry = by_addr.setdefault(address, {
                "ieee": address,
                "name": _display_name(device, address),
                "manufacturer": (device.get("manufacturer") or "").strip() or None,
                "model": (device.get("model") or "").strip() or None,
                "model_id": (device.get("model_id") or "").strip() or None,
                "_actions": {},
            })
            entry["_actions"][subtype] = {
                "subtype": subtype,
                "label": action_label(subtype),
                "type": str(payload.get("type") or "action"),
                "topic": mq_topic,
                "payload": mq_payload,
                "_node": m.group("node"),
                "_name": m.group("name"),
            }
        except Exception as e:  # one bad retained message must not blind the hub
            log_error(f"[controllers] bad discovery message on {topic!r}: {e}")

    out: list[dict] = []
    for entry in by_addr.values():
        actions = [
            a for a in entry.pop("_actions").values()
            if (a["_node"], a["_name"]) not in cleared
        ]
        for a in actions:
            a.pop("_node", None)
            a.pop("_name", None)
        if not actions:
            continue
        actions.sort(key=lambda a: _action_sort_key(a["subtype"]))
        entry["actions"] = actions
        out.append(entry)
    out.sort(key=lambda c: (c["name"].lower(), c["ieee"]))
    return out


# ── Z2M bridge/devices: the authoritative, complete button list ────────────
# Discovery registers a button only the first time it is physically pressed, so
# a freshly paired remote would present zero buttons if that were the only
# source. `bridge/devices` carries each device's `action` enum with *every*
# value it can emit, which is what the picker and the card must show.

def _iter_exposes(exposes: Any, depth: int = 0):
    """Walk exposes, descending one level into composites/features."""
    if depth > 3 or not isinstance(exposes, list):
        return
    for e in exposes:
        if not isinstance(e, dict):
            continue
        yield e
        yield from _iter_exposes(e.get("features"), depth + 1)


def _action_values(definition: dict) -> list[str]:
    for e in _iter_exposes((definition or {}).get("exposes")):
        if e.get("name") == "action" and e.get("type") == "enum":
            return [str(v) for v in (e.get("values") or []) if str(v).strip()]
    return []


def parse_bridge_devices(devices: Iterable[dict]) -> list[dict]:
    """Build controllers from Z2M's retained `bridge/devices` payload.

    A device is a controller when it exposes an `action` enum — that is exactly
    the set of devices that emit events and hold no state. Bulbs, sensors and
    the coordinator are skipped.

    The trigger topic is `zigbee2mqtt/<friendly_name>/action`. That depends on
    the Z2M friendly name, which is safe here because Ziggy renames devices in
    Home Assistant's registry (`ha_zigbee.rename_device` sets `name_by_user`)
    and never touches the Z2M name — so the topic stays stable across renames.
    """
    out: list[dict] = []
    for d in devices or []:
        try:
            if not isinstance(d, dict):
                continue
            if (d.get("type") or "") == "Coordinator":
                continue
            if d.get("disabled") or d.get("interview_completed") is False:
                continue
            definition = d.get("definition") or {}
            values = _action_values(definition)
            if not values:
                continue
            address = d.get("ieee_address")
            friendly = d.get("friendly_name") or address
            if not address or not friendly:
                continue
            topic = f"zigbee2mqtt/{friendly}/action"
            actions = [{
                "subtype": v,
                "label": action_label(v),
                "type": "action",
                "topic": topic,
                "payload": v,
            } for v in dict.fromkeys(values)]
            actions.sort(key=lambda a: _action_sort_key(a["subtype"]))
            out.append({
                "ieee": address,
                "name": _display_name(
                    {"name": d.get("friendly_name"),
                     "model": definition.get("description"),
                     "model_id": definition.get("model") or d.get("model_id")},
                    address,
                ),
                "manufacturer": definition.get("vendor") or d.get("manufacturer") or None,
                "model": definition.get("description") or None,
                "model_id": definition.get("model") or d.get("model_id") or None,
                "actions": actions,
            })
        except Exception as e:
            log_error(f"[controllers] bad bridge device {d!r:.80}: {e}")
    out.sort(key=lambda c: (c["name"].lower(), c["ieee"]))
    return out


def _is_fallback_name(c: dict) -> bool:
    """True when the name is a model/description stand-in, not a user's name."""
    return c.get("name") in {c.get("model"), c.get("model_id"), "Controller", None}


def merge(bridge: Iterable[dict], discovered: Iterable[dict]) -> list[dict]:
    """Combine both sources, one entry per physical address.

    The bridge list wins on actions (it is complete); discovery wins on name
    only when it carries a real user-given one. A controller present in just
    one source still appears — that keeps non-Z2M MQTT controllers working and
    keeps the hub useful if `bridge/devices` is momentarily unavailable.
    """
    by_addr: dict[str, dict] = {}
    for c in bridge or []:
        by_addr[c["ieee"]] = dict(c)
    for c in discovered or []:
        cur = by_addr.get(c["ieee"])
        if cur is None:
            by_addr[c["ieee"]] = dict(c)
            continue
        if _is_fallback_name(cur) and not _is_fallback_name(c):
            cur["name"] = c["name"]
        for field in ("manufacturer", "model", "model_id"):
            cur[field] = cur.get(field) or c.get(field)
        # Keep whichever source knows more buttons.
        if len(c.get("actions") or []) > len(cur.get("actions") or []):
            cur["actions"] = c["actions"]
    out = list(by_addr.values())
    out.sort(key=lambda c: (c["name"].lower(), c["ieee"]))
    return out


# ── Projection into the device-card shape ──────────────────────────────────

def controller_groups(controllers: Iterable[dict]) -> list[dict]:
    """Project controllers into the group shape `/api/devices/grouped` returns.

    Keys mirror `services.device_groups.build_groups` so the frontend needs no
    special case beyond rendering `card_kind == "controller"`. `room` stays None
    until a user assigns one — devices never invent a room.
    """
    groups = []
    for c in controllers or []:
        groups.append({
            "group_id":          f"controller_{c['ieee']}",
            "kind":              "controller",
            "card_kind":         "controller",
            "signature":         c["ieee"],
            "classified_by":     "controller",
            "name":              c["name"],
            "room":              None,
            "status":            "connected",
            "primary_entity_id": None,
            "primary_domain":    None,
            "primary_state":     None,
            "ha_device_id":      None,
            "ir_device_id":      None,
            "entities":          [],
            "metrics":           [],
            "capabilities":      {"controller": True},
            # Controller-specific payload the card and trigger picker read.
            "actions":           c["actions"],
            "manufacturer":      c.get("manufacturer"),
            "model":             c.get("model"),
            "model_id":          c.get("model_id"),
        })
    return groups


# ── Trigger compilation ────────────────────────────────────────────────────

def trigger_for(ieee: str, subtype: str, controllers: Iterable[dict]) -> dict:
    """Compile one button press into a Home Assistant trigger.

    Returns an `mqtt` platform trigger rather than a `device` one: it refires on
    every press (no state-change dedupe to defeat) and survives re-pairing,
    which a device_id-bound trigger does not.
    """
    for c in controllers or []:
        if c.get("ieee") != ieee:
            continue
        for a in c.get("actions") or []:
            if a.get("subtype") == subtype:
                return {
                    "platform": "mqtt",
                    "topic": a["topic"],
                    "payload": a["payload"],
                }
        raise UnknownAction(
            f"{c.get('name') or ieee} has no action {subtype!r}; "
            f"available: {[a.get('subtype') for a in c.get('actions') or []]}"
        )
    raise UnknownController(f"no controller with address {ieee!r}")


# ── Live discovery (cached) ────────────────────────────────────────────────

_BRIDGE_DEVICES_TOPIC = "zigbee2mqtt/bridge/devices"
# Two sources in one subscribe: the complete action list from the Z2M bridge,
# plus device_automation for controllers that are not Z2M-backed.
_RETAINED_FILTER = [_BRIDGE_DEVICES_TOPIC, "homeassistant/device_automation/#"]
_CACHE_TTL_S = 60.0

_cache: dict[str, Any] = {"at": 0.0, "controllers": []}
_refresh_lock = asyncio.Lock()


async def refresh(force: bool = False) -> list[dict]:
    """Re-read controllers from the broker's retained discovery topics.

    Cached for `_CACHE_TTL_S`: the device list is fetched on every Dashboard
    mount and draining the retained backlog each time would put a needless
    connect/subscribe cycle on the broker. A newly paired controller shows up
    within the TTL, and `invalidate()` makes a pairing flow immediate.
    """
    now = time.monotonic()
    if not force and (now - _cache["at"]) < _CACHE_TTL_S and _cache["controllers"]:
        return _cache["controllers"]

    async with _refresh_lock:
        # Another caller may have refreshed while we waited for the lock.
        now = time.monotonic()
        if not force and (now - _cache["at"]) < _CACHE_TTL_S and _cache["controllers"]:
            return _cache["controllers"]
        try:
            from services import mqtt_client
            msgs = await mqtt_client.collect_retained(_RETAINED_FILTER)
            bridge_payload: Any = None
            discovery: list[tuple[str, Any]] = []
            for topic, payload in msgs:
                if topic == _BRIDGE_DEVICES_TOPIC:
                    bridge_payload = payload
                else:
                    discovery.append((topic, payload))
            found = merge(
                parse_bridge_devices(bridge_payload if isinstance(bridge_payload, list) else []),
                parse_discovery(discovery),
            )
            _cache["controllers"] = found
            _cache["at"] = time.monotonic()
            return found
        except Exception as e:
            # A broker hiccup must degrade to "no controllers this fetch",
            # never break the whole device list.
            log_error(f"[controllers] discovery failed: {e}")
            return _cache["controllers"]


async def list_controllers() -> list[dict]:
    """All known controllers, refreshing from the broker when the cache is cold."""
    return await refresh()


async def groups() -> list[dict]:
    """Controllers in the `/api/devices/grouped` card shape."""
    return controller_groups(await refresh())


async def trigger(ieee: str, subtype: str) -> dict:
    """Compile a button press into an HA trigger, refreshing if unknown.

    A controller paired seconds ago is the common case here (the user pairs it,
    then immediately builds an automation), so a miss forces one re-read before
    giving up rather than reporting a device that plainly exists as unknown.
    """
    known = await refresh()
    try:
        return trigger_for(ieee, subtype, known)
    except (UnknownController, UnknownAction):
        return trigger_for(ieee, subtype, await refresh(force=True))


def cached() -> list[dict]:
    """Last known controllers without touching the broker.

    Lets synchronous callers (the automation trigger compiler) resolve an
    address to its live topic without turning a pure function into an async
    one. A cold cache returns [] and the caller falls back to the topic stored
    on the trigger itself.
    """
    return _cache["controllers"]


def invalidate() -> None:
    """Drop the cache so the next read re-scans (call after pairing)."""
    _cache["at"] = 0.0
