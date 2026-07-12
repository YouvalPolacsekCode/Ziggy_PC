"""
Generic device handler for the `control_device` intent.

Handles any HA domain registered in services.domain_registry without needing
a dedicated per-device handler file.  The handler:
  1. Looks up domain metadata to validate the action.
  2. Resolves the entity via DeviceRegistry (room + domain) or entity_id param.
  3. Maps a natural-language action string to the correct HA service call.
  4. Returns a clear message — success or actionable error.
"""
from __future__ import annotations

from core.intent_utils import ok, err, normalize_room
from core.result_utils import L
from core.conversation_context import set_context
from services.home_automation import resolve_entity, call_service, get_all_states
import services.domain_registry as dr


# ---------------------------------------------------------------------------
# Action resolution
# ---------------------------------------------------------------------------

# Natural-language verb → list of candidate service names (tried in order).
# The handler also checks direct service-name matches in the domain's action map.
_NL_TO_SERVICE: dict[str, list[str]] = {
    "open":       ["open_valve", "open_cover", "unlock"],
    "close":      ["close_valve", "close_cover", "lock"],
    "start":      ["start", "start_mowing"],
    "stop":       ["stop"],
    "dock":       ["dock", "return_to_base"],
    "home":       ["return_to_base", "dock"],
    "pause":      ["pause"],
    "resume":     ["start"],
    "turn on":    ["turn_on"],
    "turn off":   ["turn_off"],
    "on":         ["turn_on"],
    "off":        ["turn_off"],
    "toggle":     ["toggle"],
    "lock":       ["lock"],
    "unlock":     ["unlock"],
    "arm away":   ["alarm_arm_away"],
    "arm home":   ["alarm_arm_home"],
    "arm night":  ["alarm_arm_night"],
    "disarm":     ["alarm_disarm"],
    "mow":        ["start_mowing"],
    "vacuum":     ["start"],
    "clean":      ["start"],
    "activate":   ["turn_on"],
    "deactivate": ["turn_off"],
    "enable":     ["turn_on"],
    "disable":    ["turn_off"],
}


def _resolve_service(meta: dr.DomainMeta, action: str) -> str | None:
    """Return the HA service name for a natural-language action string, or None."""
    action_l = action.lower().strip()

    # 1. Direct match against the registered action keys or service names
    if action_l in meta.actions:
        return meta.actions[action_l].service
    for key, a in meta.actions.items():
        if action_l == a.service or action_l == a.label.lower():
            return a.service

    # 2. Partial / substring match
    for key, a in meta.actions.items():
        if action_l in key or action_l in a.service or action_l in a.label.lower():
            return a.service

    # 3. Natural-language pattern table
    for pattern, candidates in _NL_TO_SERVICE.items():
        if pattern in action_l:
            for candidate in candidates:
                if candidate in meta.actions:
                    return meta.actions[candidate].service

    return None


# ---------------------------------------------------------------------------
# Entity resolution
# ---------------------------------------------------------------------------

def _find_any_entity(domain: str) -> str | None:
    """Return the first live HA entity for a domain when no room is given."""
    try:
        for s in get_all_states():
            eid = s.get("entity_id", "")
            if eid.startswith(f"{domain}.") and s.get("state") not in ("unavailable",):
                return eid
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------

async def handle_control_device(params: dict, *, source: str = "unknown") -> dict:
    domain = (params.get("domain") or "").lower().strip()
    action = (params.get("action") or "").lower().strip()
    entity_id: str | None = params.get("entity_id")

    meta = dr.get(domain)
    if not meta:
        return err(L(f"Unknown device domain '{domain}'.",
                     f"סוג מכשיר לא מוכר '{domain}'."))

    if not meta.actions:
        return err(L(f"{meta.label} devices are read-only and cannot be controlled.",
                     f"מכשירי {meta.label} הם לקריאה בלבד ולא ניתן לשלוט בהם."))

    # Resolve entity
    if not entity_id:
        room = normalize_room(params)
        if room != "unknown":
            entity_id = resolve_entity(room, domain)
        if not entity_id:
            entity_id = _find_any_entity(domain)

    if not entity_id:
        room = normalize_room(params)
        location = f" in {room.replace('_', ' ')}" if room != "unknown" else ""
        location_he = f" ב{room.replace('_', ' ')}" if room != "unknown" else ""
        return err(L(
            f"No {meta.label.lower()} found{location}. "
            "Pair one via the Devices page and assign it to a room.",
            f"לא נמצא {meta.label.lower()}{location_he}. "
            "יש לחבר מכשיר דרך עמוד המכשירים ולשייך אותו לחדר.",
        ))

    service = _resolve_service(meta, action)
    if not service:
        available = ", ".join(
            f"'{k}'" for k in meta.actions
        )
        return err(L(
            f"Unknown action '{action}' for {meta.label}. "
            f"Available: {available}.",
            f"פעולה לא מוכרת '{action}' עבור {meta.label}. "
            f"פעולות זמינות: {available}.",
        ))

    result = call_service(domain, service, {"entity_id": entity_id})
    if not result.get("ok"):
        return err(result.get("message", L(f"Failed to {action} {meta.label.lower()}.",
                                           f"נכשל בביצוע '{action}' עבור {meta.label.lower()}.")))

    action_meta = meta.actions.get(service)
    verb = action_meta.label if action_meta else action.title()
    device_name = entity_id.split(".")[-1].replace("_", " ").title()
    set_context(
        room=normalize_room(params),
        device_type=domain,
        entity_id=entity_id,
        action=service,
        intent="control_device",
    )
    return ok(f"{verb}: {device_name}.")


HANDLERS = {
    "control_device": handle_control_device,
}
