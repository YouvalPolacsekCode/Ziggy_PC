"""
Generic Home Assistant config-flow driver.

Lets Ziggy drive any HA config flow programmatically through HA's
WebSocket API. The user sees a native Ziggy pairing screen; underneath,
each step of HA's flow is presented as a Ziggy form, and user answers
are submitted back to HA.

Used today by:
  - services/switcher_pairing — pairs Switcher devices natively in Ziggy UI

Designed to be reused by any vendor whose HA config flow is the natural
discovery / setup mechanism (Shelly, Tuya, ESPHome, …) without exposing
HA branding to the user.

API
---
init_flow(handler, source="user", show_advanced_options=False)
    Start a new config flow for the given integration handler. Returns the
    raw step descriptor: { flow_id, type, step_id, data_schema, errors, ... }.

submit_step(flow_id, user_input)
    Advance the flow by submitting user input for the current step. Returns
    the next step descriptor (or "create_entry" when finished, or "abort").

list_in_progress(handler=None)
    Return any flows HA already has in progress (typically because HA
    auto-discovered devices on the LAN). Useful so we can resume an
    auto-discovered flow inside Ziggy UI instead of starting a new one.

abort_flow(flow_id)
    Cancel a flow.
"""
from __future__ import annotations

from typing import Any

import requests

from services.ha_areas import _ws
from services.home_automation import _headers, _ha_url
from core.logger_module import log_info, log_error


def _extract_ha_error(resp) -> str:
    """Pull the most useful error string from an HA error response.

    HA may return JSON with `message`/`detail`, or HTML for hard failures
    ("500 Internal Server Error\\nServer got itself in trouble"). We prefer
    JSON; fall back to a short snippet of the text body.
    """
    try:
        js = resp.json()
        if isinstance(js, dict):
            for k in ("message", "detail", "error"):
                v = js.get(k)
                if v:
                    return str(v)
    except Exception:
        pass
    body = (resp.text or "").strip()
    # Strip wsgi default error pages to just their first useful line.
    if "Server got itself in trouble" in body:
        return "Home Assistant raised an exception (HTTP 500)."
    return body[:200] or f"HA returned HTTP {resp.status_code}"


async def init_flow(
    handler: str,
    *,
    source: str = "user",
    show_advanced_options: bool = False,
) -> dict:
    """Start a new HA config flow.

    HA REST is more reliable than WS for flow creation (some integrations'
    init step expects a synchronous response that WS dispatches differently).
    """
    try:
        endpoint = f"{_ha_url()}/api/config/config_entries/flow"
        payload = {
            "handler": handler,
            "show_advanced_options": bool(show_advanced_options),
        }
        if source:
            payload["source"] = source
        resp = requests.post(endpoint, headers=_headers(), json=payload, timeout=15)
        if resp.status_code not in (200, 201):
            err_msg = _extract_ha_error(resp)
            log_error(f"[FlowDriver] init_flow {handler}: HTTP {resp.status_code} — {resp.text[:500]}")
            return {
                "ok": False,
                "status_code": resp.status_code,
                "error": err_msg,
                "detail": resp.text[:300],
            }
        step = resp.json()
        log_info(f"[FlowDriver] Started flow {handler} → {step.get('flow_id')} (step={step.get('step_id')})")
        return {"ok": True, "step": step}
    except Exception as e:
        log_error(f"[FlowDriver] init_flow {handler}: {e}")
        return {"ok": False, "error": str(e)}


async def submit_step(flow_id: str, user_input: dict[str, Any] | None) -> dict:
    """Submit user input to the current step of a flow and get the next."""
    try:
        endpoint = f"{_ha_url()}/api/config/config_entries/flow/{flow_id}"
        resp = requests.post(endpoint, headers=_headers(), json=user_input or {}, timeout=20)
        if resp.status_code not in (200, 201):
            log_error(f"[FlowDriver] submit_step {flow_id}: HTTP {resp.status_code} — {resp.text}")
            return {
                "ok": False,
                "error": f"HA returned {resp.status_code}",
                "detail": resp.text[:300],
            }
        step = resp.json()
        log_info(f"[FlowDriver] flow {flow_id} → step={step.get('step_id')} type={step.get('type')}")
        return {"ok": True, "step": step}
    except Exception as e:
        log_error(f"[FlowDriver] submit_step {flow_id}: {e}")
        return {"ok": False, "error": str(e)}


def list_in_progress(handler: str | None = None) -> dict:
    """Return any pending flows HA has open (auto-discovered devices live here)."""
    try:
        resp = requests.get(
            f"{_ha_url()}/api/config/config_entries/flow",
            headers=_headers(), timeout=10,
        )
        if resp.status_code != 200:
            return {"ok": False, "error": f"HA returned {resp.status_code}", "flows": []}
        flows = resp.json()
        if handler:
            flows = [f for f in flows if f.get("handler") == handler]
        return {"ok": True, "flows": flows}
    except Exception as e:
        log_error(f"[FlowDriver] list_in_progress: {e}")
        return {"ok": False, "error": str(e), "flows": []}


async def abort_flow(flow_id: str) -> dict:
    """Cancel an in-progress flow."""
    try:
        resp = requests.delete(
            f"{_ha_url()}/api/config/config_entries/flow/{flow_id}",
            headers=_headers(), timeout=10,
        )
        return {"ok": resp.status_code in (200, 204)}
    except Exception as e:
        log_error(f"[FlowDriver] abort_flow {flow_id}: {e}")
        return {"ok": False, "error": str(e)}


# ───────────────────────── step-shape helpers ─────────────────────────

def step_kind(step: dict) -> str:
    """Categorize a flow step for UI rendering.

    Maps HA flow step types to one of:
      'form'          — render data_schema as a form
      'menu'          — present menu_options as choice
      'progress'      — long-running step, poll/await
      'create_entry'  — flow finished successfully (entry created)
      'abort'         — flow aborted (with reason)
      'external_step' — opens an external URL (rare)
    """
    t = (step or {}).get("type") or ""
    if t in ("form", "menu", "progress", "create_entry", "abort", "external_step"):
        return t
    return "form"


def translate_schema(step: dict) -> list[dict]:
    """Translate HA's voluptuous-derived `data_schema` into Ziggy field descriptors.

    HA returns each schema field as { name, type, required, default, ... }
    with selector hints for complex types. We pass selector hints through
    untouched so the same frontend renderer used in DynamicCommands can
    render pairing forms.
    """
    schema = (step or {}).get("data_schema") or []
    fields: list[dict] = []
    for f in schema:
        if not isinstance(f, dict) or not f.get("name"):
            continue
        kind = "text"
        selector = f.get("selector") or {}
        if selector:
            sel_key = next(iter(selector.keys()), "text")
            kind_map = {
                "number": "number", "select": "select", "boolean": "boolean",
                "time": "time", "duration": "duration", "text": "text",
                "entity": "entity",
            }
            kind = kind_map.get(sel_key, "text")
        elif f.get("type") == "integer":
            kind = "number"
        elif f.get("type") == "boolean":
            kind = "boolean"

        fields.append({
            "name": f["name"],
            "kind": kind,
            "label": (f.get("name") or "").replace("_", " ").title(),
            "required": bool(f.get("required")),
            "default": f.get("default"),
            "min": (selector.get("number") or {}).get("min") if kind == "number" else None,
            "max": (selector.get("number") or {}).get("max") if kind == "number" else None,
            "options": (selector.get("select") or {}).get("options") if kind == "select" else None,
        })
    return fields
