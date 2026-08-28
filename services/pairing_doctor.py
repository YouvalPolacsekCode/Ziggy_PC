"""Pairing doctor — "why won't my new device connect?"

The user sees one symptom ("it won't connect") that has four different causes,
and only the hub can tell them apart:

  1. the home's radio is wedged  → nothing can join until it's back
  2. the radio is still starting → wait a moment
  3. a device DID show up but stalled halfway through introducing itself
     (the SNZB-04PR2 pattern: present, interview never completed)
  4. a device is discovered and just waiting to be finished in the app
  5. the pairing window simply isn't open

Read-only: this module answers "what's wrong", never "let me fix it".

The judgement lives in pure functions so it is testable without a home;
:func:`diagnose_pairing` is the thin live wrapper that gathers the facts.
"""
from __future__ import annotations

from core.logger_module import log_error

# HA config-entry states that mean the radio is broken vs still coming up.
# Mirrors services.ha_health's classification (same vocabulary, same source).
_RADIO_BAD_STATES = frozenset({
    "setup_retry", "setup_error", "migration_error", "failed_unload", "not_loaded",
})
_RADIO_LOADING_STATES = frozenset({"setup_in_progress"})

# Z2M publishes the pairing window as a bridge switch; HA mirrors it as an entity.
_PERMIT_JOIN_MARKER = "permit_join"


def pairing_window_open(states: list[dict]) -> bool | None:
    """Is the home open to new devices right now? ``None`` when unknowable.

    A home with no permit-join entity (e.g. a ZHA stack) tells us nothing —
    "unknown" must never be reported to the user as "closed".
    """
    for s in states or []:
        eid = s.get("entity_id") or ""
        if _PERMIT_JOIN_MARKER not in eid:
            continue
        state = (s.get("state") or "").lower()
        if state in ("on", "true"):
            return True
        if state in ("off", "false"):
            return False
    return None


def stalled_introductions(devices: list[dict]) -> list[dict]:
    """Devices that joined but never finished introducing themselves.

    ``devices`` is a Z2M ``bridge/devices`` payload. A device still mid-interview
    is NOT stalled — it's working — and the coordinator is not a device at all.
    """
    out: list[dict] = []
    for d in devices or []:
        if (d.get("type") or "") == "Coordinator":
            continue
        if d.get("interview_completed"):
            continue
        if d.get("interviewing"):
            continue          # in progress — give it a moment
        out.append({
            "name": d.get("friendly_name") or d.get("ieee_address") or "?",
            "model": ((d.get("definition") or {}) or {}).get("model"),
        })
    return out


# Discovery handlers that are the home's OWN plumbing, not a device someone is
# adding. Telling a user to "finish adding" their Zigbee adapter is nonsense —
# and naming the hardware leaks the engine (feedback_ziggy_product_surface).
_INFRA_HANDLERS = frozenset({
    "smlight", "zha", "zigbee2mqtt", "mqtt", "thread", "otbr", "matter",
    "hassio", "homeassistant", "backup", "sun", "met", "radio_browser",
    "google_translate", "shopping_list", "bluetooth", "upnp", "dhcp", "ssdp",
})


def addable_discoveries(flows: list[dict]) -> list[dict]:
    """Keep only discoveries a user would recognise as "my new device".

    Drops the home's own infrastructure, drops flows with no human name (where
    ha_pairing fell back to the handler slug — an engine word we must never
    say), and mentions each thing once.
    """
    seen: set[str] = set()
    out: list[dict] = []
    for f in flows or []:
        handler = (f.get("handler") or "").strip().lower()
        title = (f.get("title") or "").strip()
        if handler in _INFRA_HANDLERS:
            continue
        if not title or title.lower() == handler:
            continue
        if title.lower() in seen:
            continue
        seen.add(title.lower())
        out.append(f)
    return out


def assess_pairing(*, coordinator_state: str | None, pairing_open: bool | None,
                   stalled: list[dict], pending: list[dict]) -> dict:
    """Fuse the facts into one verdict, worst-first.

    Returns ``{verdict, radio_ok, pairing_open, stalled_names, pending_names}``
    where ``verdict`` is one of: radio_down · radio_starting · stalled ·
    awaiting_setup · pairing_closed · ready.
    """
    state = (coordinator_state or "").lower()
    if state in _RADIO_BAD_STATES:
        radio_ok: bool | None = False
    elif state in _RADIO_LOADING_STATES:
        radio_ok = None
    elif state:
        radio_ok = True
    else:
        radio_ok = None       # no radio info at all — don't invent a fault

    stalled_names = [s.get("name") for s in (stalled or [])]
    pending_names = [p.get("title") or p.get("handler") for p in (pending or [])]

    if state in _RADIO_BAD_STATES:
        verdict = "radio_down"
    elif state in _RADIO_LOADING_STATES:
        verdict = "radio_starting"
    elif stalled_names:
        verdict = "stalled"
    elif pairing_open is False:
        # A shut window is a step the user can take right now; a discovery may
        # have been sitting there for months. Lead with the step — the speech
        # layer still mentions what's waiting.
        verdict = "pairing_closed"
    elif pending_names:
        verdict = "awaiting_setup"
    else:
        verdict = "ready"

    return {
        "verdict": verdict,
        "radio_ok": radio_ok,
        "pairing_open": pairing_open,
        "stalled_names": stalled_names,
        "pending_names": pending_names,
    }


async def diagnose_pairing() -> dict:
    """Live read of every pairing signal → :func:`assess_pairing`'s verdict.

    Every source is best-effort: a home with no Zigbee radio, no MQTT bridge or
    an unreachable HA still gets an honest answer instead of an error.
    """
    coordinator_state = None
    try:
        from services import ha_health
        coord = await ha_health.fetch_coordinator_state()
        coordinator_state = getattr(coord, "state", None)
    except Exception as e:
        log_error(f"[pairing_doctor] coordinator state unavailable: {e}")

    open_window = None
    try:
        from services.home_automation import get_all_states
        open_window = pairing_window_open(get_all_states() or [])
    except Exception as e:
        log_error(f"[pairing_doctor] pairing window unreadable: {e}")

    stalled: list[dict] = []
    try:
        from services.mqtt_client import read_retained
        payload = await read_retained("zigbee2mqtt/bridge/devices")
        if isinstance(payload, list):
            stalled = stalled_introductions(payload)
    except Exception as e:
        log_error(f"[pairing_doctor] device list unavailable: {e}")

    pending: list[dict] = []
    try:
        from services.ha_pairing import get_pending_config_flows
        res = await get_pending_config_flows()
        pending = addable_discoveries(res.get("flows") or [])
    except Exception as e:
        log_error(f"[pairing_doctor] pending discoveries unavailable: {e}")

    return assess_pairing(coordinator_state=coordinator_state, pairing_open=open_window,
                          stalled=stalled, pending=pending)
