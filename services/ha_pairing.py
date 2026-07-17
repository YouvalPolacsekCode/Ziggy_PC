"""
Multi-protocol pairing helpers.
Z-Wave and Matter use HA services via WebSocket.
Wi-Fi / Broadlink surface HA's auto-discovered config flows via REST.
"""
from __future__ import annotations
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

async def commission_matter(code: str) -> dict:
    """Commission a Matter device using its setup code or QR payload."""
    try:
        res, = await _ws({
            "type": "call_service",
            "domain": "matter",
            "service": "commission_with_code",
            "service_data": {"code": code},
        })
        if res.get("success"):
            return {"ok": True}
        err = (res.get("error") or {}).get("message", "Matter integration not available or code invalid")
        return {"ok": False, "error": err}
    except Exception as e:
        log_error(f"[Pairing] commission_matter: {e}")
        return {"ok": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Wi-Fi / Broadlink — surface HA auto-discovered config flows
# ---------------------------------------------------------------------------

# Discovery handlers that aren't user-addable "devices" — infrastructure /
# adapters we never surface in the pairing list (BT adapter, the router's UPnP,
# raw DHCP sniffs).
NON_DEVICE_FLOW_HANDLERS = frozenset({"bluetooth", "upnp", "dhcp"})


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
