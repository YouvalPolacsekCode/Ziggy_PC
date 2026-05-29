# Security Hardening Report WS — 2026-05-29

Closes the last truly unauthed app-level surface on the hub after V2:
`@app.websocket("/ws")` in [backend/server.py:337](backend/server.py#L337),
which accepted any connection on `:8001/ws` and streamed the full backend
pub/sub feed (device state, automation results, anomaly fires, debug bus)
to whoever asked. The handler now accepts EITHER a `?token=<bearer>` query
param validated against the same `find_user_by_token` that
`get_current_user` delegates to, OR the `RelayAuthMiddleware`-injected
synthetic user on `websocket.state.relay_user` (cloud-relay path, kept open
for future operator live-feed work even though no caller exercises it
today per DECISIONS.md). On miss, the handler emits a
`ws_auth/ws_auth_failed` audit event (path, provided, source_ip,
`relay_user_attempted` for dual-fakery forensics) and closes the socket
with code 4401 — accept-then-close so the browser sees the real WebSocket
close code rather than uvicorn's pre-accept HTTP 403 (which would surface
as code 1006 and defeat the frontend's "stop reconnecting on 4401" guard).
[frontend/src/hooks/useWebSocket.js](frontend/src/hooks/useWebSocket.js)
now reads `useAuthStore.getState().token` on every connect attempt
(token rotation is free, no WS-instance caching), gates the connect on a
non-empty token, stops the retry loop on a 4401 close, and listens to the
authStore so logout closes any live socket and login kicks a fresh
`_connect()`. Five new pytest cases in `tests/test_ws_auth.py` cover
missing / bad / spoofed-relay-without-secret / valid-token / valid-relay
paths against the actual production handler. A live in-process boot
(`/tmp/ws_regression.py`, not committed) confirmed end-to-end against the
real uvicorn server: no-token → 4401, bad-token → 4401, valid token →
ping/pong + real broadcast frames reach the client, deleted session →
next reconnect 4401. Full suite: **745 passed, 10 failed, 1 skipped**;
all 10 failures are in `tests/test_anomaly_engine.py` and reproduce
unchanged at `f09957d` (the commit immediately before this work) — not
introduced here.

## Follow-ups (out of WS-auth scope)

| Item | Severity | Notes |
|---|---|---|
| **`RelayAuthMiddleware` sets attribute on dict** | P1 | At [backend/middleware/relay_auth.py:53](backend/middleware/relay_auth.py#L53), the middleware does `scope["state"].relay_user = {...}`. In current Starlette `scope["state"]` is pre-initialised as a `dict`, so the `if "state" not in scope:` guard skips and the next line raises `AttributeError: 'dict' object has no attribute 'relay_user'`. The exception propagates up; `get_current_user`'s `getattr(request.state, "relay_user", None)` then sees `None` and falls back to bearer-token validation. Net effect: every relay-proxied HTTP request to the hub today silently degrades to "must also carry a valid bearer token." Fix is one line: `scope.setdefault("state", {})["relay_user"] = {...}`. The mobile router's `/api/mobile/ws` has the analogous accept-then-close issue with code 4401 — its pre-accept close currently surfaces as HTTP 403 on the upgrade rather than a WS close frame. Both deferred per "don't touch the relay path or mobile auth in this prompt." |
| **Spoofable `display_hello` payload** | P2 | Now that connect-time auth is enforced, the residual issue is content-integrity: an authenticated `user`-role client can still register itself as `{name: "kitchen", room: "kitchen"}` in the display registry and receive `display_push` events targeted at the real kiosk. Connect-time auth doesn't fix the spoof — that needs server-side ownership of the display identity (e.g., display tokens minted at kiosk-setup time). Worth a future content-integrity prompt; out of scope here. |
| **Broadcast-level role scoping** | P3 | The hub fans out the full pub/sub feed to every authed connection regardless of role. A `user`-role client today sees debug-bus events meant for `super_admin` (e.g. trace-level diagnostics). The right fix is per-broadcast role gating in `ws_manager.broadcast`. Out of "connect-time auth only" scope per the prompt. |
| **`onclose` 4401 vs token-rotation race** | P3 | If the server closes the socket with code 4401 (e.g., admin revoked the session) and the token in `authStore` hasn't changed yet, the frontend's `if (evt?.code === 4401) return` stops retrying until the next authStore mutation. That's the intended behavior — but a future "force re-login on revoke" affordance (push a `revoked` event before close, surface a modal) would improve UX. |
| **Capacitor app (`~/ziggy_mobile`)** | P3 | The mobile shell talks to `/api/mobile/ws` (already token-gated) — unaffected by this work. Verified by grep: no `new WebSocket("/ws")` usage in `~/ziggy_mobile/`. |

## What did NOT change

- `/api/mobile/ws` — already correctly token-authed; mirrored as the reference pattern but not modified.
- `find_user_by_token` / `get_current_user` / `auth_deps.py` — reused as-is per founder instruction.
- The `display_hello` / `display_heartbeat` / `display_push` registry — connect-time auth only; content integrity is a separate prompt.
- Reconnect cadence, ping interval, message buffer size — the existing constants in `useWebSocket.js` are unchanged.
- Out of scope per prompt: V1, V2, edge bcrypt, `removeDevice` dead-code question.

## Manual verification I did NOT do

I cannot drive a real browser in this environment. The following remain on founder hands:

- [ ] PWA login → dashboard → device tile updates flow visually after the new connect (the live regression script proves the bytes reach the client, but not that React renders them).
- [ ] Multi-tab behavior: two tabs of the same login both stream broadcasts.
- [ ] Logout actually flips the connected indicator off and stays off until re-login.
- [ ] Kiosk display tab (one of the existing wall-mounted screens, if any exist beyond the operator dashboard) keeps streaming display_push events after redeploy.
- [ ] Behind a real Cloudflare Tunnel: the `?token=` query param survives the tunnel hop.

## Commits

```
2297021  feat(auth): gate /ws with bearer token + relay-injected user (close 4401 otherwise)
9bb2242  test(auth): cover /ws auth gate (token, missing, bad, relay path, dual-fakery)
88bd9c8  fix(auth): accept-then-close on /ws 4401 so client sees real WS close code
```
