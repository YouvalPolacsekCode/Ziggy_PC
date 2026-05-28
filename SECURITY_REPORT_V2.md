# Security Hardening Report V2 — 2026-05-28

Closes the class of issues V1 missed: routes on the hub that were
either intentionally or accidentally unauthenticated, or
authenticated at user tier when their structural/destructive nature
warrants admin tier. V2 lands across 10 commits on `main` plus 3
prerequisite commits that cleaned the working tree. Nothing pushed
yet; nothing deployed.

V1's premise was "fix four specific issues by name." V2's premise was
"fix the class — re-enumerate every unauthed route on the hub, classify,
fix, audit." The most valuable outcome of the diagnosis phase: the
prior cloud surface inventory (`docs/CLOUD_SURFACE_INVENTORY.md`) was
stale on its auth column — `_auth = [Depends(get_current_user)]`
landed at the router-mount level on 2026-05-15 (commit `9be2d62`) but
the inventory snapshot was never refreshed to reflect that. V2's
re-enumeration corrected the picture and surfaced one real production
bug along the way (see §B).

---

## What changed

### A — Bucket E: dead code removed

| Route / file | Reason | Commit |
|---|---|---|
| `POST /api/map/anomalies/mock` | Dev-only injector; zero callers in `frontend/`, `ziggy_mobile/`, `tests/`. Per V2 rubric: no dev endpoints in shipped code without a role gate. | `a6b4b69` |
| `DELETE /api/map/anomalies/mock` | Same dev-only surface, the wipe counterpart. | `a6b4b69` |
| Companion helpers in `map_router.py` (`_MOCK_DEFS`, `_materialize_mocks`, `_write_mocks_to_file`, `load_mock_anomalies_into`) | Dead with the endpoints. | `a6b4b69` |
| Startup-import block in `services/ha_subscriber.py` that called `load_mock_anomalies_into` | Dead with the loader; `active_anomalies` still inits as `{}` so the engine is unaffected. | `a6b4b69` |
| Orphan runtime file `user_files/mock_anomalies.json` | Loader is gone; harmless leftover otherwise. Removed from disk; gitignore already covers `user_files/*`. | `a6b4b69` |
| `backend/routers/onboarding_router.py` (file) | Parked v1 self-install path. Committed but never mounted in `server.py`. Docstring marked "Parked v1". Per-route auth was correct (`get_current_user` / `require_role("super_admin")`) but the gates didn't gate anything because the router wasn't mounted. Risk of accidental future-mount with path collision against `onboarding_sensors_router`. | `f41455e` |
| Companion service `services/onboarding_state.py` | **Retained.** No router dependency; reusable primitive if v1.1+ rebuilds the self-install path. | — |
| Companion frontend `frontend/src/pages/Onboarding.jsx` | **Retained.** Imported by `App.jsx`; staying parked until a separate cleanup pass. | — |
| Breadcrumb added to `docs/ONBOARDING_AUDIT.md §3.2` | Documents the deletion + how to restore the file (`git show <hash>~1`) when BYO-hardware v1.1+ is in scope. | `f41455e` |

### B — Push-action callback moved out of `_auth` (2-week-old production bug)

`POST /api/push/action/{token}` lived in `automation_router`, which has
been mounted under `_auth = [Depends(get_current_user)]` since
2026-05-15. The handler is service-worker-driven; the SW
([frontend/public/sw.js:73](frontend/public/sw.js#L73) and the mobile-app
compiled copies in `~/ziggy_mobile/`) cannot attach an `Authorization`
header — bearer tokens live in `localStorage`, which is inaccessible to
service workers. From 2026-05-15 to 2026-05-28, **every notification
action button silently 401'd**. The SW's `.catch()` block swallowed
the failure and opened a window instead. No error to the user; no
obvious symptom in logs.

The fix could not be `dependencies=[]` at the route decorator
(FastAPI does not let route-level deps subtract from router-level
deps — they stack additively). The handler had to move out of
`automation_router` into a router mounted without `_auth`.

| Layer | Before | After |
|---|---|---|
| Route location | `automation_router.py:296` (under `_auth`) | New `backend/routers/push_action_router.py` (mounted without `_auth`) |
| Auth model | Implicit bearer requirement that the SW could not satisfy | Token-in-URL IS the credential (single-use, TTL ≤ 1 h, minted by `services.push_actions.register_action`) — bucket D |
| Audit comment | None | File-level docstring + `# PUBLIC ENDPOINT — reviewed in PROMPT_SECURITY_HARDENING_V2 on 2026-05-28` |
| FastAPI dep count (verified) | 1 (bearer) | **0** |
| User-visible behavior | Tap → 401 → SW opens window → action never fires | Tap → 200 → action fires |

Commit `1ebc558`. Integration smoke confirmed at the FastAPI layer:
`POST /api/push/action/invalid_test_token_xxx` returns **404** (token
not found), not 401 (auth failure).

### C — Bucket B: 20 user→admin/super_admin promotions

Structural / destructive operations promoted to require the founder /
admin role. Household-tier users keep everyday control (chat, voice,
automations, scenes, IR, control endpoints). One route promoted to
`super_admin` for alignment with sibling debug routes.

#### `pairing_router` — 10 routes → admin

```
POST   /api/ha/zha/permit
POST   /api/ha/zwave/include
POST   /api/ha/zwave/stop
POST   /api/ha/matter/commission
POST   /api/pairing/switcher/start
POST   /api/pairing/switcher/{flow_id}/step
POST   /api/pairing/switcher/{flow_id}/cancel
POST   /api/pairing/switcher/recover
POST   /api/pairing/switcher/account
DELETE /api/pairing/switcher/account
```

Kept user-bearer (read + entity rename): `GET /api/ha/devices`,
`GET /api/ha/devices/{id}/entities`,
`PATCH /api/ha/devices/{device_id}/rename`,
`GET /api/ha/config_flows`,
`GET /api/pairing/switcher/diagnose`,
`GET /api/pairing/switcher/account`. Commit `cc4ec07`.

#### `device_router` — 8 routes (7 → admin, 1 → super_admin)

```
POST   /api/devices
DELETE /api/devices/{room}/{dtype}
POST   /api/rooms
PATCH  /api/rooms/{area_id}
DELETE /api/rooms/{area_id}
DELETE /api/ha/entity/{entity_id:path}
DELETE /api/registry/entity/{entity_id:path}
GET    /api/debug/registry                 → super_admin (aligns with debug_router siblings)
```

Kept user-bearer (reads, area-assignment patches, control endpoints,
entity-name patches). Commit `936115e`.

#### `health_router` — 2 routes → admin

```
POST /api/health/reload-zigbee
GET  /api/health/debug-coordinator
```

Kept user-bearer: `GET /api/health` (the snapshot). Commit `ce8699c`.

Per-handler emits on the debug bus tag every successful admin call
with `auth_added=true` plus the calling user identity for the 30-day
audit window. The founder can spot any legitimate caller broken by
the promotion via `/api/debug/events?event=auth_promoted_route_called`.

**Migration safety**: both current beta users
(`silentyouval@gmail.com`, `youvalpolacsek@gmail.com`) are
`super_admin` in the hub-side `user_files/auth.db`. `super_admin`
satisfies `require_role("admin")` per the `ROLE_ORDER` in
`backend/routers/auth_deps.py`. Hard cutover — no soft-fail window.

### D — Defense-in-depth on `/api/onboarding/sensors/confirm`

The endpoint writes structural HA state: renames devices, creates HA
areas, assigns devices to areas. Device-token auth via
`Depends(get_current_device)` already passes a valid device. V2 adds
the inline check:

```python
if not device.get("user_id"):
    raise HTTPException(status_code=409, detail="Device not claimed.")
```

The upstream invariant is set by
`claim_owner → mobile_app.bind_claim_pending_device`. The inline
check is the safety net for the class of bug where the invariant is
silently broken by a future refactor (e.g. token-mint and user-bind
moved to separate transactions). Commit `7596385`.

### E — Bucket D: 17 routes carry the V2 audit-trail comment

Each public route was independently reviewed and intentionally remains
without an auth dep. Each now carries `# PUBLIC ENDPOINT — reviewed in
PROMPT_SECURITY_HARDENING_V2 on 2026-05-28. Justification: <line>`
above its handler so the next reviewer doesn't have to re-derive the
justification.

Routes covered: `GET /reset`, `GET /api/auth/status`,
`POST /api/auth/setup`, `POST /api/auth/login`, `POST /api/auth/logout`,
`GET /api/auth/invite/{token}`, `POST /api/auth/invite/{token}/accept`,
`GET /presence/manifest.json`, `GET /presence/join/{token}`,
`POST /api/presence/ping`, `GET /api/mobile/health`,
`POST /api/mobile/pair`, `GET /health` (edge_health), `GET /pair`
(first_boot), `GET /api/onboarding/first-boot/qr.json`, plus the new
`POST /api/push/action/{token}` (already commented at creation time).
Commit `2e6c8e2`.

Grep recipe:
`grep -rln "PUBLIC ENDPOINT — reviewed in PROMPT_SECURITY_HARDENING_V2" backend/`.

### F — `CLOUD_SURFACE_INVENTORY.md` refresh

Added authoritative **Section 0** to the inventory documenting the
post-V2 state of the cloud surface plus a "READ THIS FIRST" callout
that corrects the stale auth columns in the legacy master table
(those columns were captured before `_auth` landed and never updated;
the callout disclaims them globally rather than mass-relabeling 100+
cosmetically-stale rows). Section 0 itemises: routers mounted under
`_auth`, session-2 additions, every bucket-B promotion, every
bucket-E deletion, the push-action mover, the defense-in-depth check,
the bucket-D audit comments, and updated endpoint counts. Commit
`fc32fb9`.

---

## Commits (in order)

Three prerequisite commits (clean-tree hygiene before V2 work began):

```
ac490ff  feat(presence): generalize _handle_location for multi-zone + drive-past suppression + approach-home push
bb2955e  mobile session 2: presence bridge wiring
997bec8  chore(hygiene): stop tracking runtime data under user_files/
```

V2 itself (10 commits):

```
a6b4b69  chore(map_router): delete /api/map/anomalies/mock dev-only endpoints (bucket E)
f41455e  chore(onboarding): delete parked v1 onboarding_router (bucket E)
1ebc558  fix(push): move push-action callback out of _auth — 2-week-old UX bug
cc4ec07  feat(auth): promote 10 pairing_router routes user→admin (bucket B)
936115e  feat(auth): promote 8 device_router routes (bucket B)
ce8699c  feat(auth): promote 2 health_router routes user→admin (bucket B)
7596385  feat(onboarding): defense-in-depth user_id check on sensors/confirm
2e6c8e2  chore(audit): bucket-D PUBLIC ENDPOINT comments across 15 routes
fc32fb9  docs(inventory): refresh CLOUD_SURFACE_INVENTORY.md for V2 changes
                                                       (no commit yet for this report — added in this commit)
```

---

## Regression check

### Automated

| Suite | Result |
|---|---|
| `pytest tests/` (entire suite) | **740 passed, 10 failed, 1 skipped** |
| Anomaly engine failures (10) | **Pre-existing — same failures present on `997bec8` (pre-V2 baseline) verified by re-running the suite after `git checkout 997bec8`.** Not caused by V2. |
| V2-adjacent suites (`test_mobile_router_audit_events.py`, `test_relay_backup_endpoints.py`, `test_canvas_api.py`, `test_wifi_home_hint_safety.py`, `test_ir_manager.py`, `test_ir_protocol.py`) | **118 passed, 0 failed.** No V2-introduced regressions in the directly-touched code paths. |

### Manual via FastAPI TestClient (19/19 ok)

- ✅ Bucket-D routes (`/api/auth/status`, `/api/mobile/health`, `/health`, `/api/onboarding/first-boot/qr.json`) reachable without auth.
- ✅ `POST /api/push/action/{invalid_token}` returns **404** (not 401) — the 2-week-old bug is fixed at the FastAPI layer.
- ✅ All 8 sampled bucket-B promoted routes (pairing, device, health) return **401** without bearer.
- ✅ Deleted bucket-E routes (`POST/DELETE /api/map/anomalies/mock`, `GET /api/onboarding/state`) return 404 / 405.
- ✅ Session-2 routes (`/api/onboarding/sensors`, `/claim`, `/sensors/confirm`) registered and properly device-token-gated.

### What I did NOT verify (founder responsibility)

I cannot drive a real browser in this environment, so the per-V2-task-3
manual flows that exercise the full stack remain on the founder's plate:

- **User-app login → dashboard → device control → voice → automation create**. Requires running the dev server + frontend + clicking through.
- **Mobile pairing flow** (pair code → register → WS connect → push delivery stub). Requires the Capacitor app build + a phone or simulator.
- **Edge agent → relay flow**. V2 did not touch any relay route, but a smoke confirming the HMAC-signed `register-hub` still succeeds end-to-end is prudent.

If any of these flows breaks for a beta user post-deploy, the
`/api/debug/events?event=auth_promoted_route_called&auth_added=true`
log will identify which promoted route they hit. The 30-day window
catches that exact failure mode.

---

## Follow-ups (out of V2 scope)

| Item | Severity | Notes |
|---|---|---|
| **`WS /ws` (backend/server.py)** | P2 | Only truly unauthed app-level route remaining on the hub. Token-in-URL upgrade would mirror `/api/mobile/ws`. Touches frontend reconnect logic + `RelayAuthMiddleware` synthetic-user path. **Deferred to `PROMPT_WS_AUTH.md`.** |
| **`removeDevice` (DELETE /api/devices/{room}/{dtype})** | P2 | Promoted to admin in V2 but the frontend `api.js` exports `removeDevice` and no page invokes it — only i18n labels reference it. Either (a) dead export to delete, or (b) live in a code path I missed. Worth a future grep. |
| **`/api/onboarding/sensors/confirm` claim_pending symmetry** | P3 | V2 added the `device.user_id` defense-in-depth check. The symmetric `device.claim_pending is False` check is **not** present. `claim_owner` does check `claim_pending is True`; sensors/confirm should mirror it. Adds 2 lines. |
| **Relay-side `users` table role distribution** | P3 | V2 confirmed both hub-side beta users are `super_admin` (hard cutover safe). The **relay-side** `users` table (`relay/app/database.py`, lives on Fly volumes at `/data/relay.db`) was not queryable from this environment. If any relay user has role=`user`, future relay-side promotions need the soft-fail window pattern. |
| **`silentyouval@gmail.com` still on `hmac_sha256` hash** | P3 | Per V1's S4 design, next login transparently rehashes to bcrypt. Cosmetic noise until then. |
| **Frontend SW (`frontend/public/sw.js`) build artifact in `frontend/dist/sw.js`** | P3 | Cached compiled SW may need a forced refresh in PWAs that cached the broken version. The `Clear-Site-Data` recovery page at `/reset` covers this if a user is stuck. |
| **No rate-limit on `POST /api/auth/login`, public invite-info lookup, etc.** | P3 | V1 noted the same. Probe-able. Not in V2 scope. |
| **Inventory's legacy master table** | P4 | Section 0 supersedes it for the auth column; the legacy table is now structural reference. A future doc refresh could merge the two. |

---

## What did NOT change (out of V2 scope)

Per the V2 prompt's explicit out-of-scope list:

- **V1 fixes** (settings.yaml secrets, register-hub HMAC, HA service allowlist, relay bcrypt) — see `SECURITY_REPORT.md`.
- **Edge agent password hashing** — see `SECURITY_REPORT_EDGE.md`.
- **Relay-side routes** — none surfaced as unauthed in V2 diagnosis; relay surface was hardened in V1 S2.
- **Edge agent auth_router routes** — hardened in `PROMPT_EDGE_AUTH_BCRYPT.md`.
- **WebSocket auth model beyond confirming `/api/mobile/ws` validates the device token at connect** (it does). `/ws` upgrade deferred to `PROMPT_WS_AUTH.md`.
- **2FA, SSO, OAuth** — not in v1.
- **CORS policy changes** — separate concern.
- **Rate-limit redesign** — separate concern.

---

## Verification checklist (post-deploy)

After deploying the V2 batch to a beta hub:

- [ ] `git log --oneline main | head -13` shows all 10 V2 commits.
- [ ] `POST /api/push/action/<random_token>` returns 404 (not 401).
- [ ] A logged-in `user`-role caller (NOT super_admin) hitting `POST /api/rooms` gets **403** with the standard error envelope (not 200).
- [ ] A logged-in `super_admin` caller hitting `POST /api/rooms` succeeds.
- [ ] `POST /api/map/anomalies/mock` returns 404/405 (route gone).
- [ ] `GET /api/onboarding/state` returns 404 (file deleted).
- [ ] `GET /api/onboarding/sensors` returns 401 without a device token; succeeds with one.
- [ ] Service worker push action button taps now fire actions (per V2 §B fix).
- [ ] `/api/debug/events?event=auth_promoted_route_called` returns rows tagged `auth_added=true` once a super_admin hits a promoted route. (Confirms the 30-day audit logging is live.)
- [ ] `grep -rln "PUBLIC ENDPOINT — reviewed in PROMPT_SECURITY_HARDENING_V2" backend/` returns ≥ 8 files (server.py + 7 routers).
- [ ] `docs/CLOUD_SURFACE_INVENTORY.md` opens to a "READ THIS FIRST" callout + Section 0.
- [ ] `docs/ONBOARDING_AUDIT.md` §3.2 contains the "Breadcrumb (PROMPT_SECURITY_HARDENING_V2, 2026-05-28)" paragraph.
