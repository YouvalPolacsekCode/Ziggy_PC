"""
Switcher-specific pairing surface.

End-to-end native pairing for Switcher devices (water heaters, plugs,
Runner blinds, Breeze AC bridges). Mirrors the existing Zigbee permit-
join pattern: the user interacts only with Ziggy UI; HA's `switcher_kis`
integration does the actual LAN protocol work invisibly underneath.

How it works
------------
HA's switcher_kis integration auto-discovers Switcher devices on the LAN
via UDP broadcast and opens a config flow for each one. We:
  1. Read in-progress switcher_kis flows from HA.
  2. If none exist, kick a fresh flow to force discovery.
  3. Render each flow's current step as a Ziggy pairing screen.
  4. Submit the user's answers back to HA.
  5. On `create_entry`, refresh Ziggy's device registry so the new
     device's HA entity appears (and the user can name + room it through
     normal Ziggy device flows).

No `aioswitcher` dependency in Ziggy — HA owns the protocol.
"""
from __future__ import annotations

import requests

from services.ha_flow_driver import (
    init_flow, submit_step, list_in_progress, abort_flow,
    step_kind, translate_schema,
)
from services.switcher_account import get_credentials, is_connected
from services.home_automation import _headers, _ha_url
from core.logger_module import log_info, log_error


HANDLER = "switcher_kis"

# Names HA's switcher_kis flow uses for the account fields. If HA renames
# them in a future version we'll need to update here; the auto-inject is
# best-effort and falls back to showing the form to the user.
_USERNAME_FIELDS = frozenset({"username", "email"})
_TOKEN_FIELDS    = frozenset({"token", "device_token", "user_token"})


def _try_autofill_account(step: dict) -> dict | None:
    """If a flow form asks for username+token, return them from cache.

    Returns the user_input dict to submit, or None if the form doesn't
    look like an account-credentials prompt (so we let the user see it).
    """
    if not is_connected():
        return None
    fields = step.get("fields") or []
    field_names = {f.get("name") for f in fields if isinstance(f, dict)}
    has_user = bool(field_names & _USERNAME_FIELDS)
    has_token = bool(field_names & _TOKEN_FIELDS)
    if not (has_user and has_token):
        return None
    creds = get_credentials() or {}
    payload: dict = {}
    for f in fields:
        n = f.get("name")
        if n in _USERNAME_FIELDS:
            payload[n] = creds.get("email", "")
        elif n in _TOKEN_FIELDS:
            payload[n] = creds.get("token", "")
        elif f.get("required") and f.get("default") is not None:
            payload[n] = f.get("default")
    return payload


async def start_or_resume() -> dict:
    """Return the first available flow step the user should see.

    Resolution:
      1. If HA already has a pending switcher_kis flow (because it auto-
         discovered something), return that one — it has device context
         pre-filled, so the user sees the discovered device immediately.
      2. Otherwise initiate a fresh user-initiated flow to force discovery.
      3. If the first step asks for account credentials AND we have them
         cached, auto-submit and return whatever the next step is.

    The flow_id returned must be passed back to /step / /cancel.
    """
    pending = list_in_progress(HANDLER)
    if pending.get("ok") and pending.get("flows"):
        flow_meta = pending["flows"][0]
        flow_id = flow_meta.get("flow_id")
        # Re-fetch the step body — list_in_progress returns metadata only.
        res = await submit_step(flow_id, None)
        if res.get("ok"):
            return await _maybe_autofill_and_return(res["step"], existing=True)
        log_info(f"[SwitcherPairing] resume failed for {flow_id}, starting fresh")

    res = await init_flow(HANDLER, source="user")
    if not res.get("ok"):
        status = res.get("status_code")
        raw_err = res.get("error", "Could not start pairing.")
        ha_clue = _fetch_recent_switcher_error() if status == 500 else None

        # Classify the failure so the FE can pick the right recovery action.
        # The most common failure mode is `OSError: [Errno 98] Address in use`
        # — aioswitcher's UDP discovery socket is held by a leaked listener
        # inside HA, and restarting HA frees it. We surface that as a one-tap
        # "restart HA and retry" path so the user doesn't see HA at all.
        recovery = None
        friendly = raw_err
        if status == 500 and ha_clue:
            if "Address in use" in ha_clue or "EADDRINUSE" in ha_clue:
                recovery = "ha_restart"
                friendly = (
                    "Home Assistant's Switcher discovery port is busy "
                    "(a previous scan didn't release it). Restarting Home Assistant "
                    "fixes this in ~30 seconds."
                )
            else:
                friendly = f"Home Assistant error during Switcher discovery:\n\n{ha_clue}"
        elif status == 500:
            friendly = (
                "Home Assistant couldn't scan for Switcher devices. "
                "Check that the device is powered on and on the same network as HA, "
                "and that UDP ports 10002, 10003, 20002, 20003 are not blocked."
            )
        return {
            "ok": False,
            "status": "error",
            "error": friendly,
            "status_code": status,
            "raw_error": raw_err,
            "recovery": recovery,
        }
    return await _maybe_autofill_and_return(res["step"], existing=False)


SWITCHER_UDP_PORTS = (20002, 10002, 20003, 10003)


def diagnose_ports() -> dict:
    """Probe Switcher's discovery UDP ports from Ziggy's process.

    Tries to bind `0.0.0.0:<port>` for each Switcher UDP port. A bind that
    succeeds = port is free at this host. A bind that fails with EADDRINUSE
    = something is holding it.

    Returns:
      {
        "ports": [
          {"port": 20002, "free": True|False, "error": str|None},
          ...
        ],
        "free_ports": [...],
        "busy_ports": [...],
        "shell_lookup_hints": ["lsof -nP -iUDP:20002", ...],
      }

    Caveat: if Ziggy and HA run on different hosts, Ziggy's view of port
    state is NOT HA's view — but the result still tells the user something
    actionable (e.g., "Ziggy's host is also blocked → check this host's
    processes"; "Ziggy is free → check HA host").
    """
    import socket
    results: list[dict] = []
    free: list[int] = []
    busy: list[int] = []
    for port in SWITCHER_UDP_PORTS:
        s = None
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind(("0.0.0.0", port))
            results.append({"port": port, "free": True, "error": None})
            free.append(port)
        except OSError as e:
            results.append({"port": port, "free": False, "error": str(e)})
            busy.append(port)
        finally:
            if s is not None:
                try: s.close()
                except Exception: pass
    return {
        "ports": results,
        "free_ports": free,
        "busy_ports": busy,
        "shell_lookup_hints": [
            f"lsof -nP -iUDP:{p}" for p in busy
        ] + [
            f"ss -ulnp 'sport = :{p}'" for p in busy
        ],
    }


async def restart_ha_and_retry() -> dict:
    """Trigger an HA restart, wait for it to come back, then re-attempt pairing.

    Used by the FE when the previous start_or_resume() returned recovery=='ha_restart'.
    Total latency is HA's restart time (~30-60s on small setups).
    """
    import asyncio as _asyncio
    import time as _time
    from services.home_automation import call_service

    # 1. Kick off the restart. HA disconnects mid-response so we don't care
    #    about the return; only that the request was accepted.
    try:
        call_service("homeassistant", "restart", {})
        log_info("[SwitcherPairing] HA restart requested")
    except Exception as e:
        log_error(f"[SwitcherPairing] restart call failed: {e}")
        return {"ok": False, "error": f"Could not request HA restart: {e}"}

    # 2. Poll HA's /api/ endpoint until it answers OK again.
    deadline = _time.time() + 120
    healthy = False
    while _time.time() < deadline:
        await _asyncio.sleep(3)
        try:
            r = requests.get(
                f"{_ha_url()}/api/",
                headers=_headers(), timeout=5,
            )
            if r.status_code == 200:
                healthy = True
                break
        except Exception:
            pass
    if not healthy:
        return {
            "ok": False,
            "error": "Home Assistant didn't come back online within 2 minutes.",
        }

    log_info("[SwitcherPairing] HA back online, retrying pairing")
    # 3. Give HA a moment after the API responds — its integrations may still
    #    be initializing. Then retry the original pairing entry point.
    await _asyncio.sleep(4)
    res = await start_or_resume()

    # 4. If the retry STILL returns the port-in-use recovery hint, restart
    #    didn't help — something on the HA host is permanently holding the
    #    port. Attach a diagnostic so the FE can show actionable info.
    if res.get("recovery") == "ha_restart":
        diag = diagnose_ports()
        res = dict(res)
        res["recovery"] = "ha_restart_failed"
        res["diagnostic"] = diag
        res["error"] = (
            "Home Assistant has been restarted, but the Switcher discovery port is still "
            "blocked. Something other than HA on the HA host is holding it. "
            "Use the diagnostic below to find the offending process."
        )
    return res


def _fetch_recent_switcher_error() -> str | None:
    """Pull the last switcher-related exception from HA's error_log.

    HA exposes the full home-assistant.log at GET /api/error_log. We:
      1. find the bottom-most line mentioning switcher / aioswitcher
      2. walk forward until we hit the actual exception line
         (e.g. `OSError: [Errno 98] Address in use`) — Python 3.13's
         compressed tracebacks can stretch 15+ lines past the frame that
         mentions our library, so a tiny window misses the diagnosis
      3. return the traceback from the switcher frame through the
         exception line
    """
    try:
        resp = requests.get(
            f"{_ha_url()}/api/error_log",
            headers=_headers(), timeout=10,
        )
        if resp.status_code != 200:
            return None
        # Keep only the last ~600 lines — anything older is unrelated.
        lines = resp.text.splitlines()[-600:]
    except Exception as e:
        log_error(f"[SwitcherPairing] error_log fetch failed: {e}")
        return None

    needles = ("switcher", "aioswitcher")
    hit_idx = -1
    for i in range(len(lines) - 1, -1, -1):
        ln = lines[i].lower()
        if any(n in ln for n in needles):
            hit_idx = i
            break
    if hit_idx < 0:
        return None

    # ── Find the exception line that closes the traceback ─────────────────
    # Python's traceback ends with a line shaped like "ExcType: message" at
    # column 0. Scan forward from the switcher hit up to a generous cap.
    import re
    exc_pattern = re.compile(r"^[A-Z][A-Za-z_]*(?:Error|Exception|Warning|Interrupt)(?::|$)")
    exc_idx = -1
    cap = min(len(lines), hit_idx + 40)
    for j in range(hit_idx + 1, cap):
        if exc_pattern.match(lines[j].lstrip(" |")) or exc_pattern.match(lines[j]):
            exc_idx = j
            break

    # If we didn't find one, just include a moderate window so the user still
    # gets useful context.
    end = (exc_idx + 1) if exc_idx > 0 else min(len(lines), hit_idx + 30)
    start = max(0, hit_idx - 4)
    excerpt = "\n".join(lines[start:end]).strip()
    # Cap so the UI stays readable; keep the tail (the actual exception line
    # is more useful than the early frames).
    if len(excerpt) > 1400:
        excerpt = "…\n" + excerpt[-1400:]
    return excerpt


async def submit(flow_id: str, user_input: dict | None) -> dict:
    """Submit user answers for the current step; return the next."""
    res = await submit_step(flow_id, user_input or {})
    if not res.get("ok"):
        return {"ok": False, "error": res.get("error", "Step submission failed.")}
    out = await _maybe_autofill_and_return(res["step"], existing=True)

    # When a Switcher device finishes pairing, refresh the device registry
    # so the new HA entity surfaces in Ziggy promptly.
    if out.get("status") == "done":
        try:
            from services.device_registry import refresh as _refresh_registry
            _refresh_registry()
        except Exception as e:
            log_error(f"[SwitcherPairing] registry refresh failed: {e}")
        # Invalidate the HA service catalog so any new switcher.* services
        # appear in the dynamic command list immediately.
        try:
            from services.ha_capabilities import invalidate as _inv_caps
            _inv_caps()
        except Exception:
            pass

    return out


async def cancel(flow_id: str) -> dict:
    return await abort_flow(flow_id)


async def _maybe_autofill_and_return(step: dict, *, existing: bool) -> dict:
    """Present a flow step. If it's the account-credentials form AND we have
    cached creds, silently submit and recurse onto the next step so the user
    never sees a username/token prompt.

    Recursion depth is bounded by HA's own flow shape — there is at most one
    credentials step per flow, but the loop guards against bugs by limiting
    to 3 hops.
    """
    for _ in range(3):
        presented = _present_step(step, existing=existing)
        if presented.get("status") != "form":
            return presented

        autofill_payload = _try_autofill_account(presented)
        if autofill_payload is None:
            return presented

        flow_id = step.get("flow_id")
        if not flow_id:
            return presented
        log_info(f"[SwitcherPairing] auto-filling cached account creds into flow {flow_id}")
        res = await submit_step(flow_id, autofill_payload)
        if not res.get("ok"):
            # If autofill submission fails (e.g. token rejected), surface the
            # form to the user so they can fix it.
            return presented
        step = res["step"]
        existing = True
    return _present_step(step, existing=True)


def _present_step(step: dict, *, existing: bool) -> dict:
    """Reshape HA's flow step into Ziggy UI's expected envelope."""
    kind = step_kind(step)
    flow_id = step.get("flow_id")

    if kind == "create_entry":
        return {
            "ok": True,
            "status": "done",
            "flow_id": flow_id,
            "title": step.get("title") or "Device added",
            "data": step.get("data") or {},
        }
    if kind == "abort":
        return {
            "ok": False,
            "status": "aborted",
            "flow_id": flow_id,
            "reason": step.get("reason") or "unknown",
        }
    if kind == "progress":
        return {
            "ok": True,
            "status": "progress",
            "flow_id": flow_id,
            "progress_action": step.get("progress_action"),
            "description_placeholders": step.get("description_placeholders") or {},
        }
    if kind == "menu":
        return {
            "ok": True,
            "status": "menu",
            "flow_id": flow_id,
            "options": step.get("menu_options") or [],
            "description_placeholders": step.get("description_placeholders") or {},
        }

    # form (default)
    out = {
        "ok": True,
        "status": "form",
        "flow_id": flow_id,
        "step_id": step.get("step_id"),
        "fields": translate_schema(step),
        "errors": step.get("errors") or {},
        "description_placeholders": step.get("description_placeholders") or {},
        "existing": existing,
    }
    # Mark account-credential forms so the FE knows to short-circuit to the
    # cached-creds path or, if disconnected, prompt for account setup.
    field_names = {f.get("name") for f in out["fields"]}
    if (field_names & _USERNAME_FIELDS) and (field_names & _TOKEN_FIELDS):
        out["needs_account"] = True
        out["account_connected"] = is_connected()
    return out
