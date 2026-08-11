"""Server-side capability enforcement for wall tablets.

Why middleware: the wall's controls call the SAME endpoints the phone app does
(`/api/ha/control`, `/api/automations/...`). Enforcing per-route would mean
editing every existing router, which this project's additive-only constraint
forbids — and which would risk the app. A middleware can gate the wall without
any existing router knowing it exists.

**Identity comes from the credential, never from a header.** An earlier version
keyed off an `X-Ziggy-Wall-Tablet` header, which was worthless: anyone wanting
more privilege just omitted it, and the tablet went from restricted to
unrestricted by deleting a line. Restrictions can only attach to *how you
authenticated*, so a wall tablet now presents its own token (`zwt_…`, issued at
pairing). Dropping it leaves you unauthenticated rather than unrestricted.

**This middleware is inert for every client except a wall tablet.** A request
whose bearer token is not a tablet credential is passed through before any
other work. Phones, browsers, the native app, the relay and the old /hub are
unaffected by construction.

Two gates, one policy:
  - here, at the HTTP layer, for direct device and admin calls;
  - in `core.action_parser.handle_intent`, for everything expressed as natural
    language — which on this product is most of it.

The second gate matters more than it looks. Ziggy is a natural-language system;
gating lock-shaped URLs while leaving "unlock the front door" open to the
assistant card sitting on the wall would be no gate at all.
"""
from __future__ import annotations

import re

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from services import wall_policy as policy

HEADER = "X-Ziggy-Wall-Tablet"

# Path + method → capability. Ordered; first match wins. Anything unmatched is
# unrestricted: this list gates the operations that actually change the home or
# expose something private, not every read.
_RULES: list[tuple[re.Pattern, tuple[str, ...], str]] = [
    # Device commands. The domain in the body decides lights vs locks, so the
    # coarse rule here is refined below by _capability_for_control().
    (re.compile(r"^/api/ha/control$"),                  ("POST",),                  "__control"),
    (re.compile(r"^/api/ha/service$"),                  ("POST",),                  "__control"),

    # Cameras — the feed itself, not just the list.
    (re.compile(r"^/api/cameras/[^/]+/(snapshot|stream)"), ("GET",),                "cameras"),

    # Pairing and device lifecycle.
    (re.compile(r"^/api/pairing/"),                     ("POST", "DELETE"),         "devices"),
    (re.compile(r"^/api/devices"),                      ("POST", "PATCH", "DELETE"), "devices"),
    (re.compile(r"^/api/ha/(zigbee|zwave|matter)/"),    ("POST",),                  "devices"),

    # Automations: viewing is fine, changing is gated.
    (re.compile(r"^/api/automations"),                  ("POST", "PATCH", "DELETE"), "automations"),
    (re.compile(r"^/api/routines/[^/]+/run$"),          ("POST",),                  "scenes"),

    # Lists and agenda.
    (re.compile(r"^/api/(lists|agenda)"),               ("POST", "PATCH", "DELETE"), "lists"),

    # Presence. A wall panel must never create a person, claim a LAN host, or
    # register as a trackable device — see wall_policy.CAPABILITIES.
    (re.compile(r"^/api/presence/persons"),             ("POST", "PATCH", "DELETE"), "presence"),
    (re.compile(r"^/api/presence/me/"),                 ("POST", "PATCH"),          "presence"),
    (re.compile(r"^/api/mobile/(register|pair|webhook)"), ("POST",),                "presence"),

    # Hub settings and anything administrative.
    (re.compile(r"^/api/settings"),                     ("POST", "PATCH", "PUT", "DELETE"), "settings"),
    (re.compile(r"^/api/admin"),                        ("POST", "PATCH", "PUT", "DELETE"), "settings"),
    (re.compile(r"^/api/wall/policy"),                  ("PUT", "POST"),            "settings"),
]

# Which capability a generic device command falls under, by entity domain.
_DOMAIN_CAPABILITY = {
    "lock":         "locks",
    "camera":       "cameras",
    "climate":      "climate",
    "water_heater": "climate",
    "media_player": "media",
}


def _capability_for(path: str, method: str) -> str | None:
    for pattern, methods, cap in _RULES:
        if method in methods and pattern.search(path):
            return cap
    return None


# Order from most to least privileged. Used to pick the strongest capability a
# request touches, so a dangerous entity cannot be smuggled in beside a benign
# one.
_STRENGTH = ("settings", "devices", "locks", "cameras", "automations",
             "climate", "media", "scenes", "lists", "lights")


def _entities_in(body) -> list[str]:
    """Every entity id anywhere in the payload.

    Deliberately recursive: `/api/ha/control` puts the entity at the top level
    while `/api/ha/service` nests it under `data`, and either may hold a list.
    Reading only the first element of `entity_id` let a caller hide
    `lock.front_door` behind `light.lamp` in the same command.
    """
    found: list[str] = []

    def walk(node, depth=0):
        if depth > 6:
            return
        if isinstance(node, str):
            if "." in node and " " not in node:
                found.append(node)
        elif isinstance(node, list):
            for v in node[:64]:
                walk(v, depth + 1)
        elif isinstance(node, dict):
            for k, v in list(node.items())[:64]:
                if k in ("entity_id", "entity", "target", "data", "device_id", "area_id"):
                    walk(v, depth + 1)

    walk(body)
    return found


def _capability_for_control(body: dict) -> str:
    """Capability for a generic device command: the strongest thing it touches.

    Turning on a lamp and unlocking the front door arrive at the same endpoint,
    so the entity decides the power, not the URL. A self-declared `domain` is
    NOT trusted over the entities present — that field is attacker-controlled
    and claiming `domain: "light"` while targeting a lock must not downgrade
    the check.
    """
    caps = set()
    for entity in _entities_in(body):
        caps.add(_DOMAIN_CAPABILITY.get(entity.split(".", 1)[0], "lights"))

    # The declared domain is an ADDITIONAL signal, never a substitute. Every
    # signal can only raise the required capability, never lower it — so no
    # single attacker-controlled field can downgrade the check, whichever one
    # it is.
    declared = body.get("domain")
    if isinstance(declared, str) and declared:
        caps.add(_DOMAIN_CAPABILITY.get(declared, "lights"))

    for strong in _STRENGTH:
        if strong in caps:
            return strong
    return "lights"


def _bearer(request) -> str | None:
    auth = request.headers.get("Authorization") or ""
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


class WallCapabilityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        # Identity from the credential. A tablet token is unmistakable
        # (`zwt_` prefix) and cheap to reject, so non-wall traffic pays almost
        # nothing here.
        tablet_id = policy.resolve_token(_bearer(request))

        # Fast path: not a wall tablet. Nothing below this line runs for any
        # existing client.
        if not tablet_id:
            return await call_next(request)

        # Publish the identity for the duration of this request so the action
        # dispatcher can apply the same policy to natural-language commands,
        # which never touch a capability-shaped URL.
        token = policy.current_tablet.set(tablet_id)
        try:
            capability = _capability_for(request.url.path, request.method)

            if capability == "__control":
                # Needs the body to know which capability applies. Starlette
                # caches the body on the request, so the downstream handler
                # still reads it normally.
                try:
                    import json as _json
                    raw = await request.body()
                    body = _json.loads(raw) if raw else {}
                except Exception:
                    body = {}
                capability = _capability_for_control(body if isinstance(body, dict) else {})

            if capability is not None:
                allowed, reason = await policy.check(tablet_id, capability)
                if not allowed:
                    return JSONResponse(
                        status_code=403,
                        content={
                            "detail": (
                                "This tablet isn’t allowed to do that."
                                if reason == "denied"
                                else "This tablet needs its PIN for that."
                            ),
                            "capability": capability,
                            "reason": reason,
                        },
                    )

            return await call_next(request)
        finally:
            policy.current_tablet.reset(token)
