# Mobile Route Audit — Prompt 2 chunk 3

**Source:** rescoped Prompt 2 §D + §E (see `CLAUDE_CODE_PROMPTS.md`).
**Scope:** every `/api/mobile/*` endpoint in `backend/routers/mobile_router.py`,
plus a forward-looking section on admin auth posture for Prompt 10.
**State of code at audit time:** main @ 0a89bea (chunk 3.2 landed).

> The mobile route surface is 8 endpoints. No new routes were added in
> this audit; patches are additive (debug-bus audit events on auth +
> state-transition paths). All v1.1 tightening (rate limits, short
> token TTL, refresh tokens, rotation) is design-doc only in this
> chunk per the Chunk 3 brief.

---

## 1. Per-route status table

Legend:
- **Auth verification** — does the route actually check identity?
- **Audit log entry** — is there an observable signal on auth + state transitions?
  Backend has no structured audit_log table, so "✓" means a `_dbus.emit` event
  fires on the relevant path (queryable via `/api/debug/events`).
- **Rate limit** — per-route or global throttling. None of these routes have
  a rate limit today (deferred to v1.1 — see §3).
- **Error codes ok** — semantically correct HTTP status on the failure path(s).

| Route | Method | Auth | Audit | Rate-limit | Error codes |
|---|---|---|---|---|---|
| `/api/mobile/health` | GET | n/a (intentionally public liveness) | n/a | ✗ | ✓ 200 only |
| `/api/mobile/pair-code` | POST | ✓ `get_current_user` | ✓ `mobile_pair_code_minted` | ✗ | ⚠ 400 on missing user id (probably 500) |
| `/api/mobile/pair` | POST | ✓ self-contained (consumes one-shot pair_code) | ✓ `mobile_pair_succeeded` / `mobile_pair_failed` | ✗ — **brute-force risk** | ✓ 400 on bad code |
| `/api/mobile/register` | POST | ✓ `get_current_device` (bearer token) | ✓ `mobile_device_auth_failed` on 401 | ✗ | ✓ 401 |
| `/api/mobile/webhook/{webhook_id}` | POST | ✓ `get_current_device` + path match | ✓ `mobile_device_auth_failed` + `mobile_webhook_id_mismatch` | ✗ | ✓ 401 / 403 |
| `/api/mobile/devices` | GET | ✓ `get_current_user` (PWA-side) | ✗ (read-only, low risk) | ✗ | ✓ (no failure path) |
| `/api/mobile/devices/{device_id}` | DELETE | ✓ `get_current_user` + ownership via `_user_id_of` | ✓ `mobile_device_revoked` on success; 404 deliberately NOT emitted | ✗ | ✓ 404 |
| `/api/mobile/ws` | WS | ✓ `?token=` → `mobile_app.find_device_by_token` | ✓ `mobile_ws_auth_failed` on close 4401 | ✗ | ✓ close 4401 |

**One borderline error code:** `POST /pair-code` returns 400 when the PWA's
authenticated user dict lacks an id field. That's a server-side oddity (a user
made it past auth without an identifier), not a client error — 500 would be
more accurate. **Left unchanged in this audit** per "additive only" — a real
fix would need to understand under what condition the user dict would actually
lack an id, which is out of scope here. Flagged for separate triage.

---

## 2. Patches applied in chunk 3.2

All patches are in [backend/routers/mobile_router.py](backend/routers/mobile_router.py) and add `_dbus.emit(...)` calls on
auth-failure and key state-transition paths. The route surface and auth
behavior are unchanged — these are pure observability additions.

| Path | Event emitted | Trigger | Data fields (PII-safe) |
|---|---|---|---|
| `get_current_device` 401 | `mobile_device_auth_failed` | bearer token missing or stale | `path`, `source_ip`, `provided` (bool) |
| `POST /pair-code` 200 | `mobile_pair_code_minted` | PWA mints code for phone | `user_id`, `source_ip` |
| `POST /pair` 200 | `mobile_pair_succeeded` | phone redeems valid code | `device_id`, `user_id`, `platform`, `source_ip` |
| `POST /pair` 400 | `mobile_pair_failed` | invalid or expired pair code | `reason`, `code_suffix` (last 2 chars only), `platform`, `source_ip` |
| `POST /webhook/{id}` 403 | `mobile_webhook_id_mismatch` | valid token, wrong webhook id | `device_id`, `url_webhook_id`, `source_ip` |
| `DELETE /devices/{id}` 200 | `mobile_device_revoked` | owner revokes their paired device | `device_id`, `revoked_by`, `source_ip` |
| `WS /ws` close 4401 | `mobile_ws_auth_failed` | bad/missing token on WS connect | `path`, `provided` (bool), `source_ip` |

### What is NOT in patches

- **No rate limits.** Deferred to v1.1 per §3. The most pressing target,
  `POST /pair` brute-force, is documented but not enforced.
- **No token-string logging.** Sensitive-key masking in
  `core/debug_bus.py::_SENSITIVE_KEYS` (`token`, `auth`, `bearer`, `key`,
  `secret`, `credential`, `hash`, `salt`, `password`, `api_key`) would
  auto-redact any field with those substrings in the key name — emit
  kwargs are chosen to avoid them (e.g. `provided=bool(token)` not
  `has_token=...`). Pair codes log the last 2 chars only.
- **No error-code changes.** Per "additive only", the existing 400 on
  `pair-code` missing-id was left for separate triage.
- **No new mobile routes.** Hard rule from the brief.

### Audit data flow today

Events emit synchronously to `core/debug_bus.py::bus`. From there:
1. **In-memory ring buffer** (`deque(maxlen=500)`). Lost on process restart.
2. **WebSocket broadcast** to any client listening on `/ws/{client_id}` —
   admin dashboard wires this up at server startup.
3. **Query API:** `GET /api/debug/events?scope=mobile_auth` (super_admin-gated).

This is NOT a persistent audit log. For a real audit trail (durable, queryable,
retention-controlled), the natural shape is a `mobile_audit_log` table on the
hub side or — better — piping these events to the relay's `audit_log` via the
proxy headers. Both are out of scope for Prompt 2; flagging for a future
backend-audit-infrastructure prompt.

---

## 3. Tightening recommendations (v1.1, NOT in this chunk)

These are the bearer-model hardening choices the user named in the Chunk 3
brief. They are forward-looking — not implemented here, but the auth events
added in §2 lay the groundwork (every recommendation below depends on having
visibility into the auth-failure rate, which we did not have before).

### 3.1 Short access-token TTL (1 h) + refresh tokens

**Today.** `mobile_app.register_device(...)` issues a single long-lived
`auth_token` prefixed `zgy_mb_`. There is no expiry. A stolen token is
valid forever unless the owner explicitly revokes the device.

**v1.1.** Mint a short-lived access token (60 min) plus a long-lived
refresh token (90 days, single-use, rotated on each refresh). The mobile
app silently refreshes when a 401 hits a still-online refresh token; user
re-pairing only happens if both tokens expire. Standard OAuth2-shaped flow,
no new crypto.

**Why not now.** Migrating already-paired beta devices to refresh-token
auth requires a coordinated mobile-app + backend release. Out of scope
for Prompt 2's bundled scope.

**Touch points if/when implemented.**
- `services/mobile_app.py::register_device` returns `{access_token, refresh_token, access_expires_in}`
- New endpoint `POST /api/mobile/refresh` — but this audit's "no new routes" rule means it lands in v1.1, not here
- `get_current_device` rejects expired access tokens with 401 + `WWW-Authenticate: Bearer error="invalid_token", error="expired"`

### 3.2 Token rotation on suspicious activity

**Today.** Token never rotates. A device that was stolen and signed in on
a new IP keeps the same bearer token forever.

**v1.1.** When `mobile_device_auth_failed` count for a single device_id
exceeds N in a 5-min window, rotate the device's access token (invalidate
the current one, require refresh). When the refresh-token endpoint sees
a "second use" of a single-use refresh token, treat the whole device as
compromised — revoke it + alert the user.

**Foundation laid here:** `mobile_device_auth_failed` events already
contain `path` + `source_ip`; an enrichment step (TODO v1.1) can attribute
each failure to a `device_id` when the request came with a token that
WAS valid for a now-deleted device record (currently we just say "not
found").

### 3.3 Per-route rate limits

**Today.** None. The bus events let us *see* spray attacks; nothing
*stops* them.

**v1.1.** SlowAPI-style decorator on the four highest-value routes:

| Route | Rate cap (initial) | Rationale |
|---|---|---|
| `POST /api/mobile/pair` | 5 / min / IP | 6-char pair codes have low entropy by design; brute force without throttle is fast. **Highest priority.** |
| `POST /api/mobile/pair-code` | 3 / min / user | Authenticated, but spammable. |
| `POST /api/mobile/register` | 10 / min / device | Should rarely fire after first call. |
| `WS /api/mobile/ws` (connect attempts) | 5 / min / IP | Same brute-force surface as `/pair`. |

The rest of the routes (health, devices GET/DELETE, webhook) have either
no abuse surface or strong identity coupling — defer until traffic data
shows otherwise.

### 3.4 Bearer model justification (explicit design decision)

Per the Chunk 3 brief: **mobile auth stays bearer-token. No HMAC.**

**Why HMAC is wrong for mobile:**
- HMAC requires a per-device shared secret + signing on every request.
  On Capacitor (WebView-hosted JS), the secret would live in iOS Keychain
  / Android Keystore, and the signing path adds a native bridge call per
  request. Performance and complexity both up; security benefit modest
  over a properly-rotated bearer.
- HMAC's main advantage (replay window enforcement + body integrity) is
  better provided by TLS for human-to-cloud traffic. Edge↔relay traffic
  is machine-to-machine where TLS termination at Cloudflare's edge leaves
  the relay needing a separate integrity signal — that's where HMAC
  belongs (and is currently used; see [docs/CLOUD_SURFACE_INVENTORY.md](docs/CLOUD_SURFACE_INVENTORY.md)
  Appendix B).
- Apple's "reader app" rules (Prompt 9 §G — `RUNBOOK_IOS_BILLING.md`)
  encourage minimal native dependencies in the binary. HMAC signing in
  a native module pushes against that.

**Conclusion:** bearer + short TTL + refresh + rotation > HMAC, for mobile.

---

## 4. Pre-existing bug callout (flag only — do not fix)

### `automation_router.py` decorator-target mismatch

**Where.** `backend/routers/automation_router.py`. The decorator
`@router.get("/api/automations/templates")` sits **above** the local
helper `_safe_list_automations` (a list-returning utility); the function
`get_automation_templates` immediately below it is undecorated. The
registered endpoint may not return the intended shape.

**Status in this audit.** Confirmed by inspection. **Not fixed** —
Chunk 3 brief explicitly says "flag, do NOT fix; founder has a separate
task queued." Surfaced here so it stays tracked through to whatever
prompt picks it up.

---

## 5. Admin auth confirmation report

The Chunk 3 brief asks us to cross-check the admin auth model against
what Prompt 10's dashboard will need. The model is **coherent after the
chunk 3.1 fix** but the surface area is dual (relay JWT + backend
session token, bridged by `X-Relay-*` headers). This section names the
options so Prompt 10 can pick.

### 5.1 Two parallel auth surfaces today

**Relay-side** (Fly.io, `relay/app/auth.py`):
- **JWT.** HS256, 30-day expiry, signed with `RELAY_JWT_SECRET`.
- Claims: `{sub, email, role, home_id, exp}`.
- Roles ranked: guest 0 → user 1 → admin 2 → super_admin 3 → relay_admin 9.
- Bootstrapped via `RELAY_ADMIN_EMAIL` + `RELAY_ADMIN_PASSWORD` env vars.
- Every relay endpoint that needs identity calls `current_user(request)`.

**Backend-side** (hub, `backend/routers/auth_deps.py`):
- **Opaque session tokens** (random hex, stored in `services/auth_db.py`'s
  `auth.db` SQLite, bcrypt'd at issue). Legacy yaml `users[].session_tokens`
  honored as a fallback during transition.
- Same role hierarchy as the relay (post chunk 3.1 fix).
- Two entry points:
  1. Direct `Authorization: Bearer <token>` for LAN access.
  2. **Relay-proxied** requests carry `X-Relay-*` headers; the
     `RelayAuthMiddleware` (pure ASGI) decodes them and injects
     `request.state.relay_user`. `get_current_user` reads that first,
     falling back to (1).

### 5.2 What changed in chunk 3.1

Before: `request.state.relay_user.role = "relay_admin"` would land in
`get_current_user` fine, but `require_role("super_admin")` rejected it
because `ROLE_ORDER.get("relay_admin", 0)` defaulted to 0.

After: `relay_admin: 9` is in the backend's `ROLE_ORDER` too. A founder
proxying through the relay to a customer's hub now satisfies every role
gate on the hub.

This was the only mechanical block. The two-surface model itself is
coherent.

### 5.3 What Prompt 10's dashboard needs

Best estimate from the rescoped Prompt 10 brief (subject to that prompt
making its own choices):

- **Cross-home reads** (list homes, OTA releases, admin telemetry views):
  hit relay endpoints directly with the founder's JWT. No proxy needed.
- **Per-home reads/writes** (HA settings, push delivery stats, OTA pin
  on a specific home): proxy through `/api/proxy/{home_id}/<path>` to
  the hub, relying on `X-Relay-Role: relay_admin` getting through.
- **Audit log viewer** (cross-home): the relay's `audit_log` table is the
  only structured audit source today; cf. [docs/CLOUD_SURFACE_INVENTORY.md](docs/CLOUD_SURFACE_INVENTORY.md)
  Appendix C. Backend events from the mobile route patches live on the
  hub's in-memory debug bus and would need separate piping to be visible
  in a cross-home view.
- **Auth provider:** the founder logs into the dashboard with the
  `relay_admin` JWT issued by `POST /api/auth/login` on the relay.
  Dashboard stores it as a session and forwards to the backend via the
  proxy.

### 5.4 Alignment options (decisions belong to Prompt 10, not here)

Three sketches, none of which we recommend in this chunk — surfaced so
the next prompt can compare:

#### Option A — Keep the two-surface model as-is (zero changes)

- Dashboard authenticates against the relay (JWT).
- All hub-side work goes through `/api/proxy/{home_id}/*`.
- Backend session tokens remain for LAN-only / pre-relay deployments.
- **Cost:** the two surfaces stay distinct; documentation has to explain
  both.
- **Benefit:** zero migration risk. Everything already works after
  chunk 3.1. This is the cheapest path.

#### Option B — Backend learns to decode the relay's JWT

- `get_current_user` adds a third path: parse `Authorization: Bearer <jwt>`
  by trying `relay/app/auth.py::decode_jwt` first, fall through to
  session-token lookup.
- Dashboard sends the same JWT for direct-to-hub calls (no proxy needed
  for non-proxied paths).
- **Cost:** backend takes a runtime dependency on `PyJWT` (currently only
  the relay needs it). `RELAY_JWT_SECRET` must be reachable by the hub —
  meaning either a shared secret distribution at imaging time, or
  asymmetric (RS256) signing.
- **Benefit:** dashboard talks one auth language end-to-end.

#### Option C — Single sign-on via OIDC against the relay

- Relay exposes OIDC endpoints (`/.well-known/openid-configuration`,
  `/userinfo`, JWKS).
- Backend validates JWTs against the relay's JWKS at first-touch.
- Dashboard uses standard OIDC libraries.
- **Cost:** substantial new surface on the relay; OIDC has subtle gotchas
  (audience claims, redirect-URI validation, etc.).
- **Benefit:** clean third-party integration story for future "connect
  Ziggy to my dashboard tool" features.

**This audit makes no recommendation among A/B/C.** Per the brief: "Don't
propose alignment changes — that's Prompt 10's call."

### 5.5 What this audit DID change

Nothing on the admin auth model itself. The chunk 3.1 fix was a
**bug-fix** (relay_admin had no rank in backend's `ROLE_ORDER`), not a
model change. The hierarchy that already existed in design is now also
true at runtime.

---

## 6. Test coverage summary

Tests added in chunk 3 (all in `tests/`):

| File | Tests | What it covers |
|---|---:|---|
| `test_backend_auth_role_order.py` | 10 | relay_admin rank, no-escalation invariant, hierarchy parity with relay |
| `test_mobile_router_audit_events.py` | 12 | every emit on its trigger path, no-emit on 404 revoke, route surface unchanged |

Existing chunk 2 tests (55) continue to pass. Pre-existing
`test_anomaly_engine.py` failures (10) remain — unrelated to Prompt 2,
acknowledged in chunk 1 + 2 commits.

---

**End of audit.** No more chunks in Prompt 2.
