"""
Multi-protocol pairing helpers.
Z-Wave and Matter use HA services via WebSocket.
Wi-Fi / Broadlink surface HA's auto-discovered config flows via REST.
"""
from __future__ import annotations
import asyncio

import requests

from services.ha_areas import _ws
from services.home_automation import _headers, _ha_url
from core.logger_module import log_error

WIFI_INTEGRATIONS = frozenset({
    "shelly", "tplink", "tuya", "govee", "meross",
    "yeelight", "wled", "esphome",
})


# ---------------------------------------------------------------------------
# Z-Wave JS
# ---------------------------------------------------------------------------

async def _find_zwave_controller_device_id() -> str | None:
    """Find the HA device_id of the Z-Wave JS controller node."""
    try:
        resp = requests.get(f"{_ha_url()}/api/config/config_entries", headers=_headers(), timeout=10)
        if resp.status_code != 200:
            return None
        entries = [e for e in resp.json() if e.get("domain") == "zwave_js"]
        if not entries:
            return None
        entry_id = entries[0]["entry_id"]

        res, = await _ws({"type": "config/device_registry/list"})
        devices = res.get("result") or []
        for d in devices:
            if entry_id in (d.get("config_entries") or []) and not d.get("via_device_id"):
                return d["id"]
    except Exception as e:
        log_error(f"[Pairing] find_zwave_controller: {e}")
    return None


async def start_zwave_inclusion() -> dict:
    """Put the Z-Wave JS network into inclusion mode."""
    try:
        device_id = await _find_zwave_controller_device_id()
        service_data = {}
        if device_id:
            service_data["device_id"] = device_id

        res, = await _ws({
            "type": "call_service",
            "domain": "zwave_js",
            "service": "add_node",
            "service_data": service_data,
        })
        if res.get("success"):
            return {"ok": True}
        err = (res.get("error") or {}).get("message", "Z-Wave JS not available or not configured")
        return {"ok": False, "error": err}
    except Exception as e:
        log_error(f"[Pairing] start_zwave_inclusion: {e}")
        return {"ok": False, "error": str(e)}


async def stop_zwave_inclusion() -> dict:
    """Cancel Z-Wave inclusion mode."""
    try:
        device_id = await _find_zwave_controller_device_id()
        service_data = {}
        if device_id:
            service_data["device_id"] = device_id

        await _ws({
            "type": "call_service",
            "domain": "zwave_js",
            "service": "stop_add_node",
            "service_data": service_data,
        })
        return {"ok": True}
    except Exception as e:
        log_error(f"[Pairing] stop_zwave_inclusion: {e}")
        return {"ok": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Matter
# ---------------------------------------------------------------------------
#
# ## Diagnostic note: "Commission with code failed for node N"
#
# Field report (Aug 3 2026, jeff_inbox #2285–#2287): three back-to-back pair
# attempts failed with "Commission with code failed for node 19 / 20 / 21", and
# the app showed its "Make sure Matter support is set up on your hub" tip.
#
# What it means:
#
# - That string is python-matter-server's *generic* NodeCommissionFailed
#   error. It says nothing about the cause; the real reason is only in the
#   matter-server log (`docker logs ziggy-matter-server`).
# - matter-server reserves a NEW node id for every attempt and does not give it
#   back when the attempt fails. 19 → 20 → 21 means "three failed attempts in a
#   row". It is NOT three devices and NOT a table limit: Matter node ids are
#   64-bit, and neither Ziggy nor matter-server caps the node count. No Ziggy
#   state needs resetting either; the single-flight `_matter_state` in
#   backend/routers/pairing_router.py already expires after 200 s.
# - On the canary, the causes behind this message have been (see
#   docs/MATTER_THREAD.md → Gotchas): device not in pairing mode or out of BLE
#   range; BlueZ not in --experimental mode; no Thread dataset pushed to
#   matter-server; a BLE adapter degraded by a retry storm. The retry storm and
#   the missing Thread dataset were fixed in code the same day (8b2eb99,
#   0ede7fd). The rest need hands on the device or the hub:
#     1. Factory-reset the device, hold it next to the hub, try ONCE.
#     2. Still failing? On the hub: `sudo hciconfig hci0 down && sudo hciconfig
#        hci0 up && docker restart ziggy-matter-server`, then retry once.
#     3. `systemctl cat bluetooth` must show `bluetoothd --experimental`.
#     4. Thread devices: HA's preferred Thread dataset must match the OTBR's
#        live one (`thread/list_datasets`; the matter-enable step syncs them).
#
# `explain_matter_error` turns the raw errors we know into a message that tells
# the user what to do. The raw text goes to the log and to the result's
# `detail` for support.

# (lower-cased substrings of the raw error) → what the user should do. Checked
# in order and the first match wins, so specific causes sit above the generic
# "commission with code failed".
_MATTER_ERROR_HINTS: tuple[tuple[tuple[str, ...], str], ...] = (
    (("unknown_command", "unknown command", "not_loaded", "not loaded",
      "matter integration not available"),
     "Matter isn't set up on this hub yet. Ask support to turn on Matter for "
     "your hub, then try again."),
    (("required network information not provided", "thread (no)"),
     "The hub couldn't give the device its Thread network details. Restart "
     "the hub, then try again. If it keeps failing, contact support."),
    (("discovery timed out", "ble scan error", "device not found",
      "no device found"),
     "The hub couldn't find the device. Put it in pairing mode (usually a "
     "factory reset or a long button press), hold it next to the hub, and try "
     "again."),
    (("bluezendpoint", "le-connection-abort", "operation was cancelled",
      "operation was canceled", "bluetooth"),
     "The hub's Bluetooth link to the device dropped. Wait a minute, "
     "factory-reset the device, hold it next to the hub, and try once. If it "
     "keeps failing, restart the hub."),
    (("invalid setup code", "invalid code", "invalid qr", "invalid manual",
      "pase", "passcode"),
     "The setup code didn't work. Check the code on the device label (or scan "
     "its QR code) and try again."),
    (("attestation",),
     "The device failed Matter's authenticity check. Make sure it's a "
     "certified Matter device, factory-reset it, and try again."),
    (("commission with code failed", "commissioning failed"),
     "The device didn't finish pairing. Factory-reset it, hold it next to the "
     "hub, and try once more. If it fails again, restart the hub and retry."),
)

_MATTER_TIMEOUT_HINT = (
    "Pairing took too long and was stopped. Factory-reset the device, hold it "
    "next to the hub, and try again.")
_MATTER_UNREACHABLE_HINT = (
    "Couldn't reach the hub's Matter service. Restart the hub, then try again.")
_MATTER_FALLBACK_HINT = (
    "Matter pairing failed. Factory-reset the device, hold it next to the hub, "
    "and try again. If it keeps failing, restart the hub.")


def explain_matter_error(raw: str | None, *, code: str | None = None) -> str:
    """Map a raw HA / matter-server commissioning error to a user-facing
    message that says what to do. ``code`` is HA's WS error code, if any."""
    text = f"{code or ''} {raw or ''}".lower()
    for needles, hint in _MATTER_ERROR_HINTS:
        if any(n in text for n in needles):
            return hint
    return _MATTER_FALLBACK_HINT


async def commission_matter(code: str) -> dict:
    """Commission a Matter device using its setup code or QR payload.

    Drives HA's ``matter/commission`` WebSocket command (NOT a service call —
    the matter integration exposes no ``commission_with_code`` service). HA hands
    the commission off to the standalone matter-server, and — crucially —
    automatically supplies the *preferred* Thread operational dataset (or Wi-Fi
    credentials) to the device over the initial BLE handshake, so a fresh
    Matter-over-Thread device (e.g. an IKEA bulb) joins our OTBR's Thread mesh.

    Commissioning is slow: BLE handshake + network join can take 30–120 s, so we
    override the helper's aggressive default WS timeout for this one call. The
    router runs this in a background task (fire-and-poll).

    Returns ``{"ok": True}``, or ``{"ok": False, "error": <what to do>,
    "detail": <raw error>}``. ``error`` is safe to show the user as-is.
    """
    try:
        # STEP 1 — pre-load the preferred Thread operational dataset into
        # matter-server. A Thread Matter device (e.g. an IKEA bulb) connects over
        # BLE, attests, then needs the Thread network key to join. HA's
        # matter/commission does NOT auto-attach it, so without this the device
        # gets to "Required network information not provided / thread (no)" and
        # fails even though BLE + attestation succeeded. We fetch HA's preferred
        # dataset (kept TLV-synced to our OTBR) and push it via matter/set_thread.
        # Non-fatal on failure (a Wi-Fi-only Matter device wouldn't need it).
        try:
            ds = await _ws({"type": "thread/list_datasets"}, timeout=10.0)
            datasets = (ds[0].get("result") or {}).get("datasets", [])
            pref = next((d for d in datasets if d.get("preferred")), None)
            if pref:
                tlv_res = await _ws(
                    {"type": "thread/get_dataset_tlv", "dataset_id": pref["dataset_id"]},
                    timeout=10.0)
                tlv = (tlv_res[0].get("result") or {}).get("tlv")
                if tlv:
                    await _ws({"type": "matter/set_thread",
                               "thread_operation_dataset": tlv}, timeout=15.0)
            else:
                log_error("[Pairing] no preferred Thread dataset; Thread Matter "
                          "devices can't join (Wi-Fi ones still can)")
        except Exception as e:
            log_error(f"[Pairing] set_thread dataset (non-fatal): {e}")

        # STEP 2 — commission. network_only=False is REQUIRED for a fresh device:
        # HA's matter/commission defaults network_only=True (on-network/mDNS
        # discovery ONLY), which a brand-new device — not on any network yet —
        # can never answer ("Discovery timed out"). network_only=False takes the
        # BLE path: BLE scan → PASE handshake → push the Thread dataset above →
        # device joins Thread → operational.
        res, = await _ws({"type": "matter/commission", "code": code,
                          "network_only": False},
                         timeout=150.0)
        if res.get("success"):
            return {"ok": True}
        error = res.get("error") or {}
        raw = error.get("message") or "Matter integration not available or code invalid"
        log_error(f"[Pairing] commission_matter failed: "
                  f"{error.get('code', '')} {raw}".strip())
        return {"ok": False,
                "error": explain_matter_error(raw, code=error.get("code")),
                "detail": raw}
    except (asyncio.TimeoutError, TimeoutError) as e:
        log_error(f"[Pairing] commission_matter timed out: {e!r}")
        return {"ok": False, "error": _MATTER_TIMEOUT_HINT, "detail": "timeout"}
    except OSError as e:  # HA down / WS refused
        log_error(f"[Pairing] commission_matter: HA unreachable: {e}")
        return {"ok": False, "error": _MATTER_UNREACHABLE_HINT, "detail": str(e)}
    except Exception as e:
        log_error(f"[Pairing] commission_matter: {e}")
        return {"ok": False, "error": explain_matter_error(str(e)),
                "detail": str(e)}


# ---------------------------------------------------------------------------
# Wi-Fi / Broadlink — surface HA auto-discovered config flows
# ---------------------------------------------------------------------------

# Discovery handlers that aren't user-addable "devices" — infrastructure /
# adapters we never surface in the pairing list (BT adapter, the router's UPnP,
# raw DHCP sniffs).
NON_DEVICE_FLOW_HANDLERS = frozenset({"bluetooth", "upnp", "dhcp"})


# The domains a customer thinks of as "a device". Pairing can also create
# diagnostic sensors and config switches; those are not things anyone places
# in a room, so they never reach the mapping step.
from services.entity_filter import _should_hide

PRIMARY_DOMAINS = (
    "climate", "cover", "lock", "vacuum", "camera", "water_heater",
    "light", "switch", "fan", "media_player", "valve", "alarm_control_panel",
)


async def paired_units(entry_id: str | None = None) -> dict:
    """Devices Ziggy knows about, for the room-mapping step.

    One physical unit = one HA device = one primary entity, so counting these
    IS the answer to "how many did that pairing produce?" — the user never has
    to tell us. An air conditioner bridge yielding four indoor units and a
    shutter hub yielding six blinds are the same shape.

    With `entry_id`: every unit that pairing just produced, assigned or not.
    Without it: only units that still have no room. Gree keeps scanning and
    adds units as they come back online, so that second query is how Ziggy
    notices a unit whose Wi-Fi module was reset days later.

    Deliberately omits manufacturer. HA hardcodes it to "Gree" while the
    customer bought a Tadiran, and no HA vocabulary belongs in this payload.
    """
    try:
        dev_res, = await _ws({"type": "config/device_registry/list"})
        ent_res, = await _ws({"type": "config/entity_registry/list"})
        devices = {d["id"]: d for d in (dev_res.get("result") or [])}

        # One row per PHYSICAL DEVICE, not per entity. A Gree air conditioner
        # publishes a climate entity plus five auxiliary switches (panel
        # light, quiet mode, fresh air, xtra fan, health mode). Listing
        # entities made one AC appear as six near-identical rows sharing a
        # MAC-derived name; a customer configured one of them and gave up.
        # "Which room is this?" is a question about the box on the wall.
        best: dict[str, dict] = {}
        for e in (ent_res.get("result") or []):
            eid = e.get("entity_id") or ""
            domain = eid.split(".", 1)[0]
            if domain not in PRIMARY_DOMAINS:
                continue
            # Pairing also produces bridge controls and diagnostics — a
            # Zigbee2MQTT permit-join switch is a `switch`, but nobody puts it
            # in a room. Reuse Ziggy's one filter for system entities rather
            # than growing a second opinion about what counts as a device.
            if _should_hide(eid):
                continue
            dev = devices.get(e.get("device_id"))
            if not dev:
                continue
            if entry_id and entry_id not in (dev.get("config_entries") or []):
                continue
            area = dev.get("area_id")
            if not entry_id and area:
                continue  # late-arrival query: only the ones still unplaced

            rank = PRIMARY_DOMAINS.index(domain)
            prev = best.get(dev["id"])
            if prev and prev["_rank"] <= rank:
                continue
            best[dev["id"]] = {
                "_rank": rank,
                "device_id": dev["id"],
                "entity_id": eid,
                "domain": domain,
                # name_by_user wins; otherwise the name the unit reported over
                # the local protocol, which is often what the owner set in the
                # vendor app and is worth pre-filling.
                "name": dev.get("name_by_user") or dev.get("name") or eid,
                "area_id": area,
            }
        units = [{k: v for k, v in u.items() if k != "_rank"} for u in best.values()]
        return {"ok": True, "units": units}
    except Exception as e:
        log_error(f"[Pairing] paired_units: {e}")
        return {"ok": False, "error": str(e), "units": []}


async def climate_units(entry_id: str | None = None) -> dict:
    """Air conditioners only — kept for callers that specifically mean ACs."""
    res = await paired_units(entry_id)
    res["units"] = [u for u in res.get("units", []) if u.get("domain") == "climate"]
    return res


async def get_pending_config_flows(integrations: list[str] | None = None,
                                   exclude: frozenset[str] | None = None) -> dict:
    """Return pending HA config flows (devices HA auto-discovered but not yet
    configured) — e.g. a smart TV, Chromecast, WiFi plug.

    Lists via the WebSocket `config_entries/flow/progress` command. The old REST
    `GET /api/config/config_entries/flow` returns 405 on current HA, which had
    silently made this return nothing (WiFi pairing showed an empty list even
    though HA had discovered the TV).

    Optionally filter to `integrations`; `exclude` drops infra handlers
    (defaults to NON_DEVICE_FLOW_HANDLERS).
    """
    drop = NON_DEVICE_FLOW_HANDLERS if exclude is None else exclude
    try:
        res, = await _ws({"type": "config_entries/flow/progress"})
        flows = res.get("result") or []
        if integrations:
            allow = set(integrations)
            flows = [f for f in flows if f.get("handler") in allow]
        flows = [f for f in flows if f.get("handler") not in drop]
        return {
            "ok": True,
            "ha_url": _ha_url(),
            "flows": [
                {
                    "flow_id": f.get("flow_id"),
                    "handler": f.get("handler", ""),
                    "title": (
                        (f.get("context", {}) or {}).get("title_placeholders", {}).get("name")
                        or f.get("handler", "Unknown device")
                    ),
                    "step_id": f.get("step_id"),
                }
                for f in flows
            ],
        }
    except Exception as e:
        log_error(f"[Pairing] get_pending_config_flows: {e}")
        return {"ok": False, "error": str(e), "flows": [], "ha_url": _ha_url()}
