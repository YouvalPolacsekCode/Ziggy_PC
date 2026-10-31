"""Multi-channel devices — which of a device's controls are real channels.

Why (David's garden valve, 2026-10-31). A SONOFF Hydro DUO has two zones, each
a full on/off switch. Ziggy groups a physical device onto one card driven by a
single "primary" control and files every other switch as a setting, so zone 2
sat among ~40 schedule toggles and could not be reached from the card. The
same shape is every 2-gang wall switch, double outlet and dual relay.

A channel is decided from two signals, strongest first:

1. Zigbee2MQTT's own device description (`zigbee2mqtt/bridge/devices`). Each
   control is typed: a channel is a composite `switch`/`light` expose bound to
   an endpoint; a setting is a plain `binary`. No guessing. HA's unique_id for
   a Z2M entity is `<ieee>_<domain>_<endpoint>_zigbee2mqtt`, which links the
   two exactly.
2. Fallback for anything Z2M doesn't describe (Wi-Fi, Matter): a sibling of
   the primary's own domain that HA does not mark as a setting AND whose name
   is nothing but a channel number ("1", "L2", "Channel 2", "Outlet 1").
   HA's category alone is not enough — a Gree AC's "Quiet mode" switch is
   uncategorised — so the name rule is what keeps features out.

Strict on purpose: at least two channels, the primary among them, all one
domain. Anything else returns [] and the device renders exactly as before.
"""
from __future__ import annotations

import re
from typing import Iterable

CHANNEL_DOMAINS = frozenset({"switch", "light"})

# ieee → {(domain, endpoint), ...}; refreshed from bridge/devices by
# services.controllers.refresh (the module that already reads that topic).
_z2m: dict[str, set[tuple[str, str]]] = {}

_Z2M_UID = re.compile(r"^(0x[0-9a-f]{16})_(switch|light)_(.+)_zigbee2mqtt$")

# A name that is only a channel token: "1", "L2", "l 2", "Channel 2",
# "Outlet 1", "Relay 3", "Socket 2", "Gang 1", "Zone 2", "Switch 2", "Left".
_CHANNEL_NAME = re.compile(
    r"^(?:(?:channel|outlet|socket|relay|gang|zone|switch|ch|l)\s*)?(\d{1,2})$"
    r"|^(left|right|center|centre|top|bottom|middle)$",
    re.IGNORECASE,
)
# Same idea on the entity's object id, for rows HA gave no original_name. Only
# the part AFTER the prefix every entity of the device shares is judged, and it
# must be nothing but the token: `<base>_l2` and `<base>_1` are channels,
# `<base>_irrigation_plan_enabled_1` is a setting that merely ends in a digit.
_CHANNEL_REMAINDER = re.compile(
    r"^(?:(?:channel|outlet|socket|relay|gang|zone|switch|ch|l)_?)?(\d{1,2})$"
    r"|^(left|right|center|centre|top|bottom|middle)$",
    re.IGNORECASE,
)


def _object_id(eid: str) -> str:
    return str(eid or "").split(".", 1)[-1]


def _shared_base(object_ids: list[str]) -> str:
    """Longest common prefix of the device's object ids, cut back to a '_'."""
    if len(object_ids) < 2:
        return ""
    lo, hi = min(object_ids), max(object_ids)
    i = 0
    while i < len(lo) and lo[i] == hi[i]:
        i += 1
    cut = lo[:i].rfind("_")
    return lo[:cut + 1] if cut >= 0 else ""


def parse_z2m_channels(bridge_devices) -> dict[str, set[tuple[str, str]]]:
    """Pure: {ieee: {(domain, endpoint)}} for devices with ≥2 channels of a domain."""
    out: dict[str, set[tuple[str, str]]] = {}
    for d in bridge_devices or []:
        if not isinstance(d, dict):
            continue
        ieee = d.get("ieee_address")
        exposes = ((d.get("definition") or {}).get("exposes")) or []
        found: dict[str, set[str]] = {}
        for x in exposes:
            if not isinstance(x, dict):
                continue
            dom, ep = x.get("type"), x.get("endpoint")
            if dom in CHANNEL_DOMAINS and ep not in (None, ""):
                found.setdefault(dom, set()).add(str(ep))
        chans = {(dom, ep) for dom, eps in found.items() if len(eps) >= 2 for ep in eps}
        if ieee and chans:
            out[str(ieee).lower()] = chans
    return out


def set_z2m_channels(mapping: dict[str, set[tuple[str, str]]]) -> None:
    global _z2m
    _z2m = dict(mapping or {})


def z2m_channels() -> dict[str, set[tuple[str, str]]]:
    return _z2m


def _natural_key(token: str):
    return (0, int(token)) if token.isdigit() else (1, token.lower())


def _channel_from_z2m(row: dict, meta: dict, z2m: dict) -> str | None:
    m = _Z2M_UID.match(str(meta.get("unique_id") or ""))
    if not m:
        return None
    ieee, dom, ep = m.group(1).lower(), m.group(2), m.group(3)
    if dom != (row.get("domain") or "") or (dom, ep) not in z2m.get(ieee, set()):
        return None
    return ep


def _channel_from_name(row: dict, meta: dict, base: str) -> str | None:
    if meta.get("entity_category"):            # HA says it's a setting/diagnostic
        return None
    orig = meta.get("original_name")
    if isinstance(orig, str) and orig.strip():
        m = _CHANNEL_NAME.match(orig.strip())
        return (m.group(1) or m.group(2)).lower() if m else None
    oid = _object_id(row.get("entity_id"))
    if not base or not oid.startswith(base):
        return None
    m = _CHANNEL_REMAINDER.match(oid[len(base):])
    return (m.group(1) or m.group(2)).lower() if m else None


def detect_channels(rows: Iterable[dict], primary_eid: str | None,
                    by_entity: dict, group_name: str = "",
                    z2m: dict | None = None) -> list[dict]:
    """Pure: [{entity_id, channel, name}] in channel order, or [] when this
    group is not a multi-channel device. See module docstring for the rules."""
    rows = [r for r in rows or [] if isinstance(r, dict) and r.get("entity_id")]
    primary = next((r for r in rows if r.get("entity_id") == primary_eid), None)
    if not primary or (primary.get("domain") or "") not in CHANNEL_DOMAINS:
        return []
    domain = primary.get("domain")
    z2m = z2m_channels() if z2m is None else z2m

    def collect(pick) -> list[tuple[str, dict]]:
        found = []
        for r in rows:
            if (r.get("domain") or "") != domain:
                continue
            ch = pick(r, by_entity.get(r["entity_id"]) or {})
            if ch is not None:
                found.append((ch, r))
        return found

    found = collect(lambda r, m: _channel_from_z2m(r, m, z2m))
    if not found:
        base = _shared_base([_object_id(r["entity_id"]) for r in rows])
        found = collect(lambda r, m: _channel_from_name(r, m, base))

    eids = [r["entity_id"] for _, r in found]
    channels = {ch for ch, _ in found}
    if (len(found) < 2 or primary_eid not in eids
            or len(channels) != len(found)):    # duplicate tokens → ambiguous
        return []

    found.sort(key=lambda p: _natural_key(p[0]))
    out = []
    for ch, r in found:
        name = (r.get("display_name") or r.get("name") or "").strip()
        # A bare token ("1") or the raw entity id reads as nothing on a card.
        if not name or name == r["entity_id"] or _CHANNEL_NAME.match(name):
            name = f"{group_name} {ch}".strip() if group_name else (name or r["entity_id"])
        out.append({"entity_id": r["entity_id"], "channel": ch, "name": name})
    return out
