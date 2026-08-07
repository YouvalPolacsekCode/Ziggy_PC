"""Server-side capability enforcement for wall tablets.

Why middleware: the wall's controls call the SAME endpoints the phone app does
(`/api/ha/control`, `/api/automations/...`). Enforcing per-route would mean
editing every existing router, which this project's additive-only constraint
forbids — and which would risk the app. A middleware can gate the wall without
any existing router knowing it exists.

**This middleware is inert for every client except a wall tablet.** It looks for
the `X-Ziggy-Wall-Tablet` header, which only the /wall page sends. No header,
no behaviour change — the request is passed through untouched before any other
work is done. Phones, browsers, the native app, the relay and the old /hub are
all unaffected by construction.

What it protects against: a wall panel is shared, always unlocked, and hangs
where children and visitors can reach it. Hiding a door-unlock button in the
UI is not security — anyone can open devtools, or the tablet could be pointed
at the API directly. The capability check has to live where the command is
actually served.
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


def _capability_for_control(body: dict) -> str:
    """Refine a generic device command by the entity it targets, so turning on
    a lamp and unlocking the front door are not treated as the same power."""
    entity = body.get("entity_id") or ""
    if isinstance(entity, list):
        entity = entity[0] if entity else ""
    domain = str(entity).split(".")[0]
    # `/api/ha/service` carries its domain explicitly.
    domain = body.get("domain") or domain
    return _DOMAIN_CAPABILITY.get(domain, "lights")


class WallCapabilityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        tablet_id = request.headers.get(HEADER)

        # Fast path: not a wall tablet. Nothing below this line runs for any
        # existing client.
        if not tablet_id:
            return await call_next(request)

        capability = _capability_for(request.url.path, request.method)
        if capability is None:
            return await call_next(request)

        if capability == "__control":
            # Needs the body to know which capability applies. Read it once and
            # stash it so the downstream handler can still consume the stream.
            try:
                raw = await request.body()
                import json as _json
                body = _json.loads(raw) if raw else {}
            except Exception:
                body = {}
            capability = _capability_for_control(body if isinstance(body, dict) else {})

        allowed, reason = await policy.check(tablet_id, capability)
        if allowed:
            return await call_next(request)

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
