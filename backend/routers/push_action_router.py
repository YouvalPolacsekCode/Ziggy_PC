"""Push notification action callback — service-worker-driven, no bearer.

When a user taps an actionable button on a push notification, the
service worker fires:

    POST /api/push/action/{token}

The service worker (frontend/public/sw.js, plus the mobile-app
compiled copies in ziggy_mobile/) cannot attach an Authorization
header because it has no access to localStorage (where the bearer
lives). The token in the URL is therefore the credential: it's a
single-use, TTL-bound (default 1 h) random secret minted by
services.push_actions.register_action and consumed exactly once.

This route MUST be mounted in server.py WITHOUT the global
`_auth = [Depends(get_current_user)]` dependency. FastAPI route-level
deps stack additively with router-level deps; they cannot subtract.
A router that's mounted under _auth makes its routes uncallable from
the service worker. That's exactly the bug PROMPT_SECURITY_HARDENING_V2
fixes: this handler used to live in automation_router (which has
been under _auth since commit 9be2d62 on 2026-05-15), so every push
action button silently 401'd on the wire. The SW's `.catch()` block
swallowed the failure and just opened a window — no error to the
user, no obvious symptom in logs.

Moving the route into its own no-`_auth` router (this file) restores
the intended behavior: a tap → consume token → execute action → 200.

PUBLIC ENDPOINT — reviewed in PROMPT_SECURITY_HARDENING_V2 on
2026-05-28. Justification: the URL token IS the credential
(single-use, TTL ≤ 1 h, bound at notification-send time to a specific
deferred Action). No bearer is sent by the service worker by design.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

router = APIRouter()


@router.post("/api/push/action/{token}")
async def push_action_callback(token: str):
    """Service worker POSTs here when the user taps a notification action button."""
    from services import push_actions
    action = push_actions.consume(token)
    if not action:
        raise HTTPException(status_code=404, detail="Action token expired or already used")
    return await push_actions.execute_action(action)
