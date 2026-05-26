"""
Hybrid command routing.

A device may have more than one control source:
  - Wi-Fi via Home Assistant (entity_id present, state + commands via HA)
  - IR via the Broadlink blaster + learned codeset (ir_device_id present)

Per-command, the router picks which source to use based on:
  - capability      — does the source actually have this command at all
  - liveness        — is the source reachable right now (HA state != unavailable)
  - learned hints   — wifi_dies_when_off devices route turn_on to IR first
  - explicit prefs  — per-command override in entry["command_routing"][cmd]

The user always sees one logical button. All routing is backend-only.
"""
from __future__ import annotations

from typing import Optional

from core.logger_module import log_info, log_error
from core.debug_bus import bus as _dbus, BASIC, VERBOSE

SOURCE_WIFI = "wifi"
SOURCE_IR   = "ir"


def resolve_hybrid_entry(entity_id: str, base_entry: dict | None = None) -> dict:
    """Return a registry-entry-shaped dict with both `entity_id` and
    `ir_device_id` filled when a link exists.

    The registry merge logic occasionally drifts out of sync — a reconciliation
    that ran before the merge code reordered, an old running backend, a UI
    that linked an IR codeset without triggering refresh, etc. To make the
    hybrid link the single source of truth regardless of when the registry
    last reconciled, we always fall back to a direct scan of ir_devices.json
    for any codeset whose `ha_entity_id` matches this entity.

    This means: as long as the IR codeset declares its link, every
    code path that goes through here treats the device as hybrid — even
    before the registry catches up.
    """
    entry = dict(base_entry) if base_entry else {"entity_id": entity_id}
    if entry.get("ir_device_id"):
        return entry
    try:
        from services.ir_manager import list_ir_devices
        for ir in list_ir_devices(enabled_only=False):
            if (ir.get("ha_entity_id") or "") == entity_id:
                entry["ir_device_id"] = ir["id"]
                return entry
    except Exception as e:
        log_error(f"[CommandRouter] resolve_hybrid_entry: {e}")
    return entry

# Commands that we know cannot work over Wi-Fi when wifi_dies_when_off=True.
# Powering ON a TV whose Wi-Fi radio is dead requires IR. Other commands can
# still go through Wi-Fi once the device is on.
_WIFI_DIES_IR_FIRST = frozenset({"turn_on"})


# Cross-vocabulary command aliases. HA uses `turn_on` / `turn_off` as the
# service name; IR codesets typically use `power_on` / `power_off` / `power`.
# Without this map we'd never recognize IR as a candidate source when the
# caller asks for "turn_on", because the literal command name isn't in the
# IR codeset.
_IR_COMMAND_ALIASES = {
    "turn_on":  ("power_on", "power", "turn_on"),
    "turn_off": ("power_off", "power", "turn_off"),
    "toggle":   ("toggle", "power"),
}


def _resolve_ir_command(ir_device_id: str, command: str) -> str | None:
    """Return the actual learned IR codeset name for a logical command, or None.

    Tries the canonical name first, then aliases (e.g. turn_on → power_on
    → power). This is the seam where the router speaks HA vocabulary on
    one side and IR-codeset vocabulary on the other.

    Critically, checks `learned_commands` (commands the user actually trained
    on the blaster), NOT the `commands` dict — that dict ships every device
    type's full slot catalog pre-populated with placeholder values, so
    `cmds.get(name)` is truthy for all 50+ slots even when only `power`
    has been learned. Using `commands` made the router think IR could
    deliver everything, then `send_ir_command` would silently fail.
    """
    if not ir_device_id:
        return None
    try:
        from services.ir_manager import get_ir_device
        dev = get_ir_device(ir_device_id) or {}
        learned = set(dev.get("learned_commands") or [])
        if not learned:
            return None
        for candidate in _IR_COMMAND_ALIASES.get(command, (command,)):
            if candidate in learned:
                return candidate
    except Exception:
        pass
    return None


# Last meaningful (non-unavailable) state we observed per Wi-Fi entity.
# In-memory only; rebuilt as events flow. Used by is_expected_offline to
# decide whether an "unavailable" state is "intentionally off" vs "crashed".
_last_meaningful_state: dict[str, str] = {}


# ───────────────────────── reachability checks ─────────────────────────

def _wifi_reachable(entity_id: str) -> bool:
    if not entity_id:
        return False
    try:
        from services.ha_subscriber import state_cache
        st = (state_cache.get(entity_id) or {}).get("state", "")
        return st not in ("unavailable", "unknown", "", None)
    except Exception:
        return True  # fail-open — better to attempt than to deadlock the user


def _has_ir_command(ir_device_id: str, command: str) -> bool:
    return _resolve_ir_command(ir_device_id, command) is not None


# ───────────────────────── source ordering ─────────────────────────

def _ranked_sources(entry: dict, command: str) -> list[str]:
    """Pick the order in which to try sources for this command on this device.

    Returns ranked sources that are CAPABLE of the command. Liveness is
    re-checked per attempt inside route_command so a brief drop doesn't
    deny the user a button that would normally work.
    """
    entity_id = entry.get("entity_id") or ""
    ir_device_id = entry.get("ir_device_id") or ""

    candidates: list[str] = []
    if entity_id:
        candidates.append(SOURCE_WIFI)
    if _has_ir_command(ir_device_id, command):
        candidates.append(SOURCE_IR)
    if not candidates:
        return []

    # 1. Explicit per-command override
    override = ((entry.get("command_routing") or {}).get(command) or {}).get("prefer")
    if override in candidates:
        return [override] + [s for s in candidates if s != override]

    # 2. Learned wifi_dies_when_off for power-on
    if (
        entry.get("wifi_dies_when_off")
        and command in _WIFI_DIES_IR_FIRST
        and SOURCE_IR in candidates
    ):
        return [SOURCE_IR] + [s for s in candidates if s != SOURCE_IR]

    # 3. Power-on prefers IR when both sources exist. Reason: a TV (or AVR
    #    / soundbar / projector) that's fully off typically has its Wi-Fi
    #    radio off too. HA's `media_player.turn_on` returns ok-from-its-side
    #    but the device never sees the packet — UI shows "on" forever, TV
    #    stays dark. IR works regardless of network state. If the user
    #    wants Wi-Fi-first for power-on on a device that supports it, they
    #    can pin via command_routing (set_command_routing helper).
    if command == "turn_on" and SOURCE_IR in candidates:
        return [SOURCE_IR] + [s for s in candidates if s != SOURCE_IR]

    # 4. Default: Wi-Fi first (richer feedback + discrete values)
    if SOURCE_WIFI in candidates:
        return [SOURCE_WIFI] + [s for s in candidates if s != SOURCE_WIFI]
    return candidates


# ───────────────────────── execution per source ─────────────────────────

def _execute_wifi(entry: dict, command: str, params: dict | None) -> dict:
    from services.home_automation import call_service
    entity_id = entry.get("entity_id") or ""
    domain = entity_id.split(".", 1)[0] if "." in entity_id else "homeassistant"
    payload: dict = {"entity_id": entity_id}
    if params:
        payload.update({k: v for k, v in params.items() if k != "entity_id"})
    return call_service(domain, command, payload)


def _execute_ir(entry: dict, command: str, params: dict | None) -> dict:
    from services.ir_manager import send_ir_command
    ir_id = entry.get("ir_device_id") or ""
    # Resolve HA-style command into the actual learned IR codeset name.
    actual = _resolve_ir_command(ir_id, command) or command
    return send_ir_command(ir_id, actual)


# ───────────────────────── public dispatch ─────────────────────────

def route_command(entry: dict, command: str, params: dict | None = None) -> dict:
    """Attempt sources in ranked order; return first ok, or last failure.

    Adds debugging keys to the returned dict:
      _routed_via  — source that ultimately delivered the command, or None
      _attempts    — list of {source, ok|skipped} entries in order tried
    """
    sources = _ranked_sources(entry, command)
    if not sources:
        return {
            "ok": False,
            "message": f"No source can deliver '{command}' for this device.",
            "_routed_via": None,
            "_attempts": [],
        }

    attempts: list[dict] = []
    last_result: dict = {}

    for src in sources:
        # Skip Wi-Fi if we know it's unreachable.
        # IR is always considered "deliverable" — the blaster fires regardless of
        # the controlled device's network state.
        if src == SOURCE_WIFI and not _wifi_reachable(entry.get("entity_id", "")):
            attempts.append({"source": src, "skipped": "wifi_unreachable"})
            _dbus.emit("command_router", VERBOSE, "skip_unreachable",
                       entity_id=entry.get("entity_id"), command=command, source=src)
            continue

        if src == SOURCE_WIFI:
            result = _execute_wifi(entry, command, params)
        else:
            result = _execute_ir(entry, command, params)

        attempts.append({"source": src, "ok": bool(result.get("ok"))})
        last_result = result
        if result.get("ok"):
            result["_routed_via"] = src
            result["_attempts"] = attempts
            _dbus.emit("command_router", BASIC, "command_routed",
                       entity_id=entry.get("entity_id"),
                       ir_device_id=entry.get("ir_device_id"),
                       command=command, routed_via=src, attempts=len(attempts))
            return result

    last_result["_attempts"] = attempts
    last_result["_routed_via"] = None
    _dbus.emit("command_router", BASIC, "command_routing_failed",
               entity_id=entry.get("entity_id"),
               ir_device_id=entry.get("ir_device_id"),
               command=command, attempts=len(attempts))
    return last_result


# ───────────────────────── learning hooks ─────────────────────────

def observe_state_transition(entity_id: str, prev_state: str, new_state: str) -> None:
    """Called from ha_subscriber on every state_changed event.

    Two side-effects:
      1. Cache the last meaningful (non-unavailable) state so the alert engine
         can tell apart "off → unavailable" (expected — Wi-Fi dies when off)
         from "on → unavailable" (real crash/disconnect).
      2. If the transition is off → unavailable on a hybrid device, learn
         wifi_dies_when_off=True on that device entry (idempotent, persisted).
    """
    if not entity_id:
        return

    if new_state and new_state not in ("unavailable", "unknown"):
        _last_meaningful_state[entity_id] = new_state

    if prev_state == "off" and new_state in ("unavailable", "unknown"):
        try:
            from services.device_registry import set_learned_flag, get_device_info
            entry = get_device_info(entity_id) or {}
            # Only learn for hybrid devices — pure-HA devices don't benefit
            # since they have no IR fallback to route to anyway.
            if entry.get("ir_device_id") and not entry.get("wifi_dies_when_off"):
                set_learned_flag(entity_id, "wifi_dies_when_off", True)
                log_info(
                    f"[CommandRouter] Learned wifi_dies_when_off=True for "
                    f"{entity_id} (off→unavailable transition observed)"
                )
                _dbus.emit("command_router", BASIC, "learned_wifi_dies_when_off",
                           entity_id=entity_id)
        except Exception as e:
            log_error(f"[CommandRouter] observe_state_transition: {e}")


def is_expected_offline(entity_id: str) -> bool:
    """True iff this entity's current 'unavailable' is consistent with being intentionally off.

    Used by anomaly_engine ANOM-07 to suppress the "device offline" alert for
    devices that we know lose Wi-Fi when powered off.
    """
    if not entity_id:
        return False
    try:
        from services.device_registry import get_device_info
        entry = get_device_info(entity_id) or {}
        if not entry.get("wifi_dies_when_off"):
            return False
        return _last_meaningful_state.get(entity_id) == "off"
    except Exception:
        return False
