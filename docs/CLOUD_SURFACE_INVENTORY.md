# Ziggy Cloud Surface Inventory

**Source:** rescoped Prompt 2, Section A (see `CLAUDE_CODE_PROMPTS.md`).
**Scope of this document:** every HTTP/WebSocket endpoint exposed by
`backend/routers/` and `relay/app/routers/` as they exist today, plus a
brief appendix on the auth/HMAC/audit-log machinery the routes depend on.
**Not in scope:** edge-side services, the IPC bus, the frontend, or any
endpoint that is not in one of the two router directories.
**Status snapshot:** taken 2026-05-27 against `main` at commit `08ccc4a`.

> **Read this first.** This is a read-only audit. No code was changed by
> producing this document. Five `backend/routers/*.py` files (`alerts`,
> `dashboard`, `mode`, `onboarding`, `weather`) are present on disk but
> are NOT yet imported into `backend/server.py` — they are listed for
> completeness and marked `untracked-parallel-session`. Their routes do
> not currently respond on a running hub.

---

## Conventions

| Column | Meaning |
|---|---|
| **Method** | HTTP verb. `WS` = WebSocket. `ANY` = `api_route` with multiple methods. |
| **Path** | Full URL path the client actually hits (prefix + route). |
| **Auth** | The `Depends(...)` (or other auth machinery) that actually gates the handler. `none` means literally no auth on that route. |
| **Category** | One of: `device`, `mobile`, `user-app`, `admin`, `health-or-other`. Categorization rules at the bottom of this section. |
| **Status** | `committed` / `untracked-parallel-session` / `committed-this-session` / `in-flight`. |
| **Tests** | `yes` / `partial` / `no`. `partial` = there is a test that imports the router module but only covers a subset of handlers (typically a helper, not the route). |

### How endpoints are categorized

- **`device`** — called by the edge agent (hub) or local IR/Z* hardware tooling. Authenticated by per-home HMAC (relay side) or by local-LAN trust (backend side, where most routes have no auth at all).
- **`mobile`** — called by the Capacitor mobile app. Backend `mobile_router` exclusively (no relay counterpart yet). Bearer token issued at pair time.
- **`user-app`** — called by the browser / PWA frontend. Session token (backend) or JWT (relay). Includes "public" auth-flow endpoints (login, setup, invite-accept) because the consumer is still the user-app.
- **`admin`** — gated by `require_role("admin"|"super_admin")` on the backend or `require_role("relay_admin")` on the relay. The dashboard's surface, plus founder-only operations like provision/seal/unseal.
- **`health-or-other`** — liveness and informational endpoints that don't fit a tenant model (e.g. relay `/health`, backend `/api/status`, mobile `/api/mobile/health`, HA update-checker which has no consumer-side identity).

Where a router straddles two categories (e.g. `presence_router` has user-app GETs and admin PATCHes), the master table splits per-row and the per-router section notes the split.

---

## Mount structure (so paths in the master table are unambiguous)

### Backend (`backend/server.py`)
- `app = FastAPI(...)` with `RelayAuthMiddleware`, `RequestLoggerMiddleware`, CORS.
- Routers mounted with their own `prefix=` (often none — many routers hardcode `/api/...` per route).
- Default auth: a list `_auth = [Depends(get_current_user)]` is passed as `dependencies=` to most `include_router(...)` calls. Routers explicitly mounted **without** `_auth`:
  - `auth_router` — public login/setup/status, plus its own internal `require_role` gates.
  - `invite_router` — public accept routes plus internal role gates.
  - `presence_router` — token-in-URL public routes plus per-route `get_current_user` / `require_role`.
  - `mobile_router` — handles its own per-route auth.
- The 5 untracked parallel-session routers are **not imported and not mounted.** Verified via `grep`.

### Relay (`relay/app/main.py`)
All routers mounted under global prefix `/api`, **except** `public_presence_router` which mounts at root (its routes own absolute paths starting with `/presence` or `/api/presence`). Order matters: `backup_keys_router` and `public_presence_router` are mounted **before** `proxy_router` (catch-all) so their specific paths win.

App-level routes outside the routers:
- Backend: `GET /reset` (Clear-Site-Data page), `WS /ws/{client_id}` (frontend pub/sub), static SPA mount at `/`.
- Relay: `GET /health` (literal `{"ok": true, "service": "ziggy-relay"}`).

---

# 1. Master Table

One row per endpoint. Sorted by category in the order: **device → mobile → user-app → admin → health-or-other**. Within a category, grouped by router file. Path collisions inside `backend/` (e.g. `/api/ha/devices/*` exists in three routers) are noted in the per-router section, not de-duplicated here.

## Category: device

| Method | Path | Router | Auth | Status | Tests |
|---|---|---|---|---|---|
| POST | `/api/homes/register-hub` | `relay/homes.py` | Hub HMAC (X-Ziggy-Signature over raw body, verified against `homes.relay_secret`) | committed | no |
| POST | `/api/homes/rotate-hub-secret` | `relay/homes.py` | Hub HMAC against CURRENT `homes.relay_secret`; returns new secret | committed | no |
| POST | `/api/homes/{home_id}/backup-status` | `relay/backup_keys.py` | Hub HMAC | committed | yes |
| POST | `/api/homes/{home_id}/restore-events` | `relay/backup_keys.py` | Hub HMAC | committed | yes |
| POST | `/api/ha/zha/permit` | `backend/pairing_router.py` | none | committed | no |
| GET | `/api/ha/devices` | `backend/pairing_router.py` | none | committed | no |
| GET | `/api/ha/devices/{device_id}/entities` | `backend/pairing_router.py` | none | committed | no |
| PATCH | `/api/ha/devices/{device_id}/rename` | `backend/pairing_router.py` | none | committed | no |
| POST | `/api/ha/zwave/include` | `backend/pairing_router.py` | none | committed | no |
| POST | `/api/ha/zwave/stop` | `backend/pairing_router.py` | none | committed | no |
| POST | `/api/ha/matter/commission` | `backend/pairing_router.py` | none | committed | no |
| GET | `/api/ha/config_flows` | `backend/pairing_router.py` | none | committed | no |
| POST | `/api/pairing/switcher/start` | `backend/pairing_router.py` | none | committed | no |
| POST | `/api/pairing/switcher/{flow_id}/step` | `backend/pairing_router.py` | none | committed | no |
| POST | `/api/pairing/switcher/{flow_id}/cancel` | `backend/pairing_router.py` | none | committed | no |
| GET | `/api/pairing/switcher/diagnose` | `backend/pairing_router.py` | none | committed | no |
| POST | `/api/pairing/switcher/recover` | `backend/pairing_router.py` | none | committed | no |
| GET | `/api/pairing/switcher/account` | `backend/pairing_router.py` | none | committed | no |
| POST | `/api/pairing/switcher/account` | `backend/pairing_router.py` | none | committed | no |
| DELETE | `/api/pairing/switcher/account` | `backend/pairing_router.py` | none | committed | no |
| GET | `/api/ir/blasters` | `backend/ir_router.py` | none | committed | partial (service-level) |
| GET | `/api/ir/discover` | `backend/ir_router.py` | none | committed | partial |
| GET | `/api/ir/devices` | `backend/ir_router.py` | none | committed | partial |
| GET | `/api/ir/devices/{device_id}` | `backend/ir_router.py` | none | committed | partial |
| GET | `/api/ir/devices/{device_id}/state` | `backend/ir_router.py` | none | committed | partial |
| POST | `/api/ir/devices` | `backend/ir_router.py` | none | committed | partial |
| PATCH | `/api/ir/devices/{device_id}` | `backend/ir_router.py` | none | committed | partial |
| DELETE | `/api/ir/devices/{device_id}` | `backend/ir_router.py` | none | committed | partial |
| POST | `/api/ir/devices/{device_id}/channel` | `backend/ir_router.py` | none | committed | partial |
| GET | `/api/ir/catalog` | `backend/ir_router.py` | none | committed | partial |
| POST | `/api/ir/devices/{device_id}/custom-command` | `backend/ir_router.py` | none | committed | partial |
| DELETE | `/api/ir/devices/{device_id}/custom-command/{command_id}` | `backend/ir_router.py` | none | committed | partial |
| POST | `/api/ir/devices/{device_id}/sequences` | `backend/ir_router.py` | none | committed | partial |
| DELETE | `/api/ir/devices/{device_id}/sequences/{name}` | `backend/ir_router.py` | none | committed | partial |
| POST | `/api/ir/devices/{device_id}/sequences/{name}/run` | `backend/ir_router.py` | none | committed | partial |
| POST | `/api/ir/devices/{device_id}/ac/temperature` | `backend/ir_router.py` | none | committed | partial |
| POST | `/api/ir/learn` | `backend/ir_router.py` | none | committed | partial |
| POST | `/api/ir/send` | `backend/ir_router.py` | none | committed | partial |
| GET | `/api/ir/listener/status` | `backend/ir_router.py` | none | committed | partial |
| GET | `/api/ir/unassigned-signals` | `backend/ir_router.py` | none | committed | partial |
| GET | `/api/ir/unassigned-signals/{signal_id}/analyze` | `backend/ir_router.py` | none | committed | partial |
| POST | `/api/ir/unassigned-signals/{signal_id}/assign` | `backend/ir_router.py` | none | committed | partial |
| DELETE | `/api/ir/unassigned-signals/{signal_id}` | `backend/ir_router.py` | none | committed | partial |
| DELETE | `/api/ir/unassigned-signals` | `backend/ir_router.py` | none | committed | partial |

## Category: mobile

| Method | Path | Router | Auth | Status | Tests |
|---|---|---|---|---|---|
| POST | `/api/mobile/pair-code` | `backend/mobile_router.py` | `get_current_user` (PWA-side caller) | committed | no |
| POST | `/api/mobile/pair` | `backend/mobile_router.py` | none (public — consumes pair-code) | committed | no |
| POST | `/api/mobile/register` | `backend/mobile_router.py` | `get_current_device` (Bearer → `mobile_app.find_device_by_token`) | committed | no |
| POST | `/api/mobile/webhook/{webhook_id}` | `backend/mobile_router.py` | `get_current_device` + webhook_id match | committed | no |
| GET | `/api/mobile/devices` | `backend/mobile_router.py` | `get_current_user` | committed | no |
| DELETE | `/api/mobile/devices/{device_id}` | `backend/mobile_router.py` | `get_current_user` (with ownership check) | committed | no |
| WS | `/api/mobile/ws` | `backend/mobile_router.py` | `?token=…` → `find_device_by_token` (closes 4401 on bad token) | committed | no |

## Category: user-app

| Method | Path | Router | Auth | Status | Tests |
|---|---|---|---|---|---|
| POST | `/api/auth/login` | `relay/auth.py` | none (public; bcrypt + transparent rehash from legacy HMAC) | committed | no |
| POST | `/api/auth/register` | `relay/auth.py` | none (public; consumes invite token) | committed | no |
| GET | `/api/auth/me` | `relay/auth.py` | JWT via `current_user` | committed | no |
| GET | `/api/auth/status` | `relay/auth.py` | none | committed | no |
| ANY | `/api/proxy/{home_id}/{path:path}` | `relay/proxy.py` | JWT via `current_user` + home ownership check (relay_admin can proxy any home) | committed | no |
| GET | `/api/invites/{token}/info` | `relay/invites.py` | none (public) | committed | no |
| GET | `/presence/join/{token}` | `relay/public_presence.py` | none (token-in-URL only) | committed | no |
| GET | `/presence/manifest.json` | `relay/public_presence.py` | none | committed | no |
| POST | `/api/presence/ping` | `relay/public_presence.py` | none (forwards to hub, hub validates) | committed | no |
| GET | `/api/auth/status` | `backend/auth_router.py` | inspects bearer header directly | committed | no |
| POST | `/api/auth/setup` | `backend/auth_router.py` | none (first-boot only; 409 if any user exists) | committed | no |
| POST | `/api/auth/login` | `backend/auth_router.py` | none | committed | no |
| POST | `/api/auth/change-password` | `backend/auth_router.py` | `get_current_user` | committed | no |
| POST | `/api/auth/logout` | `backend/auth_router.py` | inspects bearer header directly | committed | no |
| GET | `/api/auth/invite/{token}` | `backend/invite_router.py` | none (public) | committed | no |
| POST | `/api/auth/invite/{token}/accept` | `backend/invite_router.py` | none (public) | committed | no |
| GET | `/api/activity` | `backend/activity_router.py` | none | committed | no |
| GET | `/api/alerts` | `backend/alerts_router.py` | `get_current_user` | untracked-parallel-session | no |
| GET | `/api/automations` | `backend/automation_router.py` | none | committed | no |
| GET | `/api/automations/templates` | `backend/automation_router.py` | none | committed | no |
| GET | `/api/automations/templates/suggested` | `backend/automation_router.py` | none | committed | no |
| GET | `/api/automations/{automation_id}` | `backend/automation_router.py` | none | committed | no |
| POST | `/api/automations` | `backend/automation_router.py` | none | committed | no |
| PATCH | `/api/automations/{id}/rooms` | `backend/automation_router.py` | none | committed | no |
| PATCH | `/api/automations/{id}/toggle` | `backend/automation_router.py` | none | committed | no |
| POST | `/api/automations/{id}/trigger` | `backend/automation_router.py` | none | committed | no |
| GET | `/api/automations/{id}/history` | `backend/automation_router.py` | none | committed | no |
| POST | `/api/automations/{id}/snooze` | `backend/automation_router.py` | none | committed | no |
| DELETE | `/api/automations/{automation_id}` | `backend/automation_router.py` | none | committed | no |
| POST | `/api/push/action/{token}` | `backend/automation_router.py` | none (one-shot token) | committed | no |
| GET | `/api/overrides` | `backend/automation_router.py` | none | committed | no |
| DELETE | `/api/overrides/{entity_id}` | `backend/automation_router.py` | none | committed | no |
| GET | `/api/cameras` | `backend/camera_router.py` | none | committed | no |
| GET | `/api/cameras/motion` | `backend/camera_router.py` | none | committed | no |
| GET | `/api/cameras/{entity_id}/snapshot` | `backend/camera_router.py` | none | committed | no |
| GET | `/api/cameras/{entity_id}/stream` | `backend/camera_router.py` | none | committed | no |
| GET | `/api/capabilities` | `backend/capability_router.py` | none | committed | no |
| GET | `/api/capabilities/{cap_id}` | `backend/capability_router.py` | none | committed | no |
| GET | `/api/dashboard/layout` | `backend/dashboard_router.py` | `get_current_user` | untracked-parallel-session | no |
| PUT | `/api/dashboard/layout` | `backend/dashboard_router.py` | `get_current_user` | untracked-parallel-session | no |
| POST | `/api/dashboard/tablets/claim` | `backend/dashboard_router.py` | `get_current_user` (internal rate-limit) | untracked-parallel-session | no |
| POST | `/api/dashboard/tablets/{tablet_id}/heartbeat` | `backend/dashboard_router.py` | `get_current_user` | untracked-parallel-session | no |
| GET | `/api/devices` | `backend/device_router.py` | none | committed | no |
| GET | `/api/devices/grouped` | `backend/device_router.py` | none | committed | no |
| POST | `/api/devices` | `backend/device_router.py` | none | committed | no |
| DELETE | `/api/devices/{room}/{dtype}` | `backend/device_router.py` | none | committed | no |
| GET | `/api/devices/validate` | `backend/device_router.py` | none | committed | no |
| GET | `/api/rooms` | `backend/device_router.py` | none | committed | no |
| GET | `/api/rooms/all` | `backend/device_router.py` | none | committed | no |
| POST | `/api/rooms` | `backend/device_router.py` | none | committed | no |
| DELETE | `/api/rooms/{area_id}` | `backend/device_router.py` | none | committed | no |
| PATCH | `/api/rooms/{area_id}` | `backend/device_router.py` | none | committed | no |
| GET | `/api/rooms/devices` | `backend/device_router.py` | none | committed | no |
| PATCH | `/api/ha/entity/{entity_id:path}/area` | `backend/device_router.py` | none | committed | no |
| PATCH | `/api/ha/devices/{device_id}/area` | `backend/device_router.py` | none | committed | no |
| DELETE | `/api/ha/entity/{entity_id:path}` | `backend/device_router.py` | none | committed | no |
| PATCH | `/api/registry/entity/{entity_id:path}/room` | `backend/device_router.py` | none | committed | no |
| DELETE | `/api/registry/entity/{entity_id:path}` | `backend/device_router.py` | none | committed | no |
| GET | `/api/ha/entity/{entity_id}/details` | `backend/device_router.py` | none | committed | no |
| GET | `/api/devices/{entity_id:path}/commands` | `backend/device_router.py` | none | committed | no |
| POST | `/api/devices/{entity_id:path}/commands` | `backend/device_router.py` | none | committed | no |
| GET | `/api/devices/{entity_id:path}/history` | `backend/device_router.py` | none | committed | no |
| GET | `/api/events` | `backend/event_router.py` | none | committed | no |
| POST | `/api/events` | `backend/event_router.py` | none | committed | no |
| DELETE | `/api/events/{event_name:path}` | `backend/event_router.py` | none | committed | no |
| GET | `/api/events/next` | `backend/event_router.py` | none | committed | no |
| GET | `/api/events/days-until/{event_name:path}` | `backend/event_router.py` | none | committed | no |
| GET | `/api/ha/entities` | `backend/ha_router.py` | none | committed | no |
| GET | `/api/ha/state/{entity_id:path}` | `backend/ha_router.py` | none | committed | no |
| PATCH | `/api/ha/entity/{entity_id:path}/name` | `backend/ha_router.py` | none | committed | no |
| DELETE | `/api/ha/entity/{entity_id:path}/name` | `backend/ha_router.py` | none | committed | no |
| POST | `/api/ha/service` | `backend/ha_router.py` | none (domain/service denylist) | committed | no |
| POST | `/api/ha/control` | `backend/ha_router.py` | none | committed | no |
| GET | `/api/ha/entity-protocols` | `backend/ha_router.py` | none | committed | no |
| POST | `/api/health/reload-zigbee` | `backend/health_router.py` | none | committed | no |
| POST | `/api/intent` | `backend/intent_router.py` | none | committed | no |
| POST | `/api/chat` | `backend/intent_router.py` | none | committed | no |
| POST | `/api/voice/transcribe` | `backend/intent_router.py` | none (per-client rate limit) | committed | no |
| POST | `/api/voice` | `backend/intent_router.py` | none (per-client rate limit) | committed | no |
| POST | `/api/direct-intent` | `backend/intent_router.py` | none | committed | no |
| GET | `/api/map/rooms/summary` | `backend/map_router.py` | none | committed | partial (test_canvas_api) |
| GET | `/api/map/canvas` | `backend/map_router.py` | none | committed | partial |
| PUT | `/api/map/canvas/{room_id}` | `backend/map_router.py` | none | committed | partial |
| GET | `/api/map/anomalies/active` | `backend/map_router.py` | none | committed | no |
| POST | `/api/map/anomalies/mock` | `backend/map_router.py` | none | committed | no |
| DELETE | `/api/map/anomalies/mock` | `backend/map_router.py` | none | committed | no |
| GET | `/api/map/anomalies/history` | `backend/map_router.py` | none | committed | no |
| POST | `/api/map/anomalies/snooze/{room_id}/{rule_id}` | `backend/map_router.py` | none | committed | no |
| POST | `/api/map/anomalies/action/{room_id}/{rule_id}` | `backend/map_router.py` | none | committed | no |
| GET | `/api/map/render` | `backend/map_router.py` | none | committed | no |
| POST | `/api/map/render/generate` | `backend/map_router.py` | none | committed | no |
| GET | `/api/mode` | `backend/mode_router.py` | `get_current_user` | untracked-parallel-session | no |
| GET | `/api/mode/options` | `backend/mode_router.py` | `get_current_user` | untracked-parallel-session | no |
| POST | `/api/mode` | `backend/mode_router.py` | `get_current_user` | untracked-parallel-session | no |
| GET | `/api/onboarding/state` | `backend/onboarding_router.py` | `get_current_user` | untracked-parallel-session | no |
| PATCH | `/api/onboarding/state` | `backend/onboarding_router.py` | `get_current_user` | untracked-parallel-session | no |
| POST | `/api/onboarding/complete` | `backend/onboarding_router.py` | `get_current_user` | untracked-parallel-session | no |
| POST | `/api/ha/probe` | `backend/onboarding_router.py` | `get_current_user` | untracked-parallel-session | no |
| GET | `/api/presence/my-person` | `backend/presence_router.py` | `get_current_user` | committed | partial (wifi_home_hint) |
| GET | `/api/presence/persons` | `backend/presence_router.py` | `get_current_user` | committed | partial |
| GET | `/api/presence/zone` | `backend/presence_router.py` | `get_current_user` | committed | partial |
| GET | `/api/presence/zones` | `backend/presence_router.py` | `get_current_user` | committed | partial |
| POST | `/api/presence/me/ping` | `backend/presence_router.py` | `get_current_user` | committed | partial |
| POST | `/api/presence/ping` | `backend/presence_router.py` | none (per-person token in body) | committed | partial |
| GET | `/presence/manifest.json` | `backend/presence_router.py` | none (public, hub-side) | committed | partial |
| GET | `/presence/join/{token}` | `backend/presence_router.py` | none (public, hub-side) | committed | partial |
| GET | `/api/push/vapid-public-key` | `backend/push_router.py` | `get_current_user` | committed | no |
| POST | `/api/push/subscribe` | `backend/push_router.py` | `get_current_user` | committed | no |
| DELETE | `/api/push/subscribe` | `backend/push_router.py` | `get_current_user` | committed | no |
| GET | `/api/push/devices` | `backend/push_router.py` | `get_current_user` | committed | no |
| GET | `/api/push/preferences` | `backend/push_router.py` | `get_current_user` | committed | no |
| PATCH | `/api/push/preferences` | `backend/push_router.py` | `get_current_user` | committed | no |
| POST | `/api/push/test` | `backend/push_router.py` | `get_current_user` | committed | no |
| GET | `/api/push/categories` | `backend/push_router.py` | `get_current_user` | committed | no |
| GET | `/api/quick-asks` | `backend/quick_ask_router.py` | none | committed | no |
| POST | `/api/quick-asks` | `backend/quick_ask_router.py` | none | committed | no |
| PATCH | `/api/quick-asks/{qa_id}` | `backend/quick_ask_router.py` | none | committed | no |
| DELETE | `/api/quick-asks/{qa_id}` | `backend/quick_ask_router.py` | none | committed | no |
| GET | `/api/routines` | `backend/routine_router.py` | none | committed | no |
| GET | `/api/routines/{script_id}` | `backend/routine_router.py` | none | committed | no |
| POST | `/api/routines` | `backend/routine_router.py` | none | committed | no |
| POST | `/api/routines/{script_id}/run` | `backend/routine_router.py` | none | committed | no |
| DELETE | `/api/routines/{script_id}` | `backend/routine_router.py` | none | committed | no |
| GET | `/api/memory` | `backend/status_router.py` | none | committed | no |
| GET | `/api/settings/general` | `backend/status_router.py` | `get_current_user` | committed | no |
| PATCH | `/api/settings/general` | `backend/status_router.py` | `get_current_user` | committed | no |
| GET | `/api/settings/voice` | `backend/status_router.py` | `get_current_user` | committed | no |
| PATCH | `/api/settings/voice` | `backend/status_router.py` | `get_current_user` | committed | no |
| GET | `/api/voice/status` | `backend/status_router.py` | `get_current_user` | committed | no |
| GET | `/api/suggestions` | `backend/suggestion_router.py` | none | committed | no |
| GET | `/api/suggestions/pending` | `backend/suggestion_router.py` | none | committed | no |
| POST | `/api/suggestions/{sug_id}/accept` | `backend/suggestion_router.py` | none | committed | no |
| POST | `/api/suggestions/{sug_id}/reject` | `backend/suggestion_router.py` | none | committed | no |
| POST | `/api/suggestions/{sug_id}/snooze` | `backend/suggestion_router.py` | none | committed | no |
| POST | `/api/suggestions/analyze` | `backend/suggestion_router.py` | none | committed | no |
| GET | `/api/tasks` | `backend/task_router.py` | none | committed | no |
| POST | `/api/tasks` | `backend/task_router.py` | none | committed | no |
| PATCH | `/api/tasks/{task_id}` | `backend/task_router.py` | none | committed | no |
| DELETE | `/api/tasks/{task_id}` | `backend/task_router.py` | none | committed | no |
| GET | `/api/ui/prefs` | `backend/ui_prefs_router.py` | `get_current_user` | committed | no |
| PUT | `/api/ui/prefs` | `backend/ui_prefs_router.py` | `get_current_user` | committed | no |
| GET | `/api/virtual-devices` | `backend/virtual_device_router.py` | none | committed | no |
| GET | `/api/virtual-devices/{device_id}` | `backend/virtual_device_router.py` | none | committed | no |
| POST | `/api/virtual-devices` | `backend/virtual_device_router.py` | none | committed | no |
| PATCH | `/api/virtual-devices/{device_id}` | `backend/virtual_device_router.py` | none | committed | no |
| DELETE | `/api/virtual-devices/{device_id}` | `backend/virtual_device_router.py` | none | committed | no |
| POST | `/api/virtual-devices/{device_id}/trigger` | `backend/virtual_device_router.py` | none | committed | no |
| GET | `/api/weather` | `backend/weather_router.py` | none | untracked-parallel-session | no |

## Category: admin

| Method | Path | Router | Auth | Status | Tests |
|---|---|---|---|---|---|
| GET | `/api/homes/` | `relay/homes.py` | `require_role("relay_admin")` (JWT) | committed | no |
| GET | `/api/homes/{home_id}` | `relay/homes.py` | JWT — relay_admin OR own home | committed | no |
| PATCH | `/api/homes/{home_id}` | `relay/homes.py` | `require_role("relay_admin")` | committed | no |
| DELETE | `/api/homes/{home_id}` | `relay/homes.py` | `require_role("relay_admin")` | committed | no |
| GET | `/api/homes/{home_id}/health` | `relay/homes.py` | JWT — relay_admin OR own home | committed | no |
| POST | `/api/homes/{home_id}/seal-key` | `relay/backup_keys.py` | `require_role("relay_admin")` + proof-of-knowledge | committed | yes |
| POST | `/api/homes/{home_id}/unseal` | `relay/backup_keys.py` | `require_role("relay_admin")` | committed | yes |
| GET | `/api/homes/{home_id}/backup-status` | `relay/backup_keys.py` | JWT — relay_admin OR own home | committed | yes |
| POST | `/api/invites/` | `relay/invites.py` | JWT (relay_admin can create home invites; super_admin can create user invites) | committed | no |
| GET | `/api/invites/` | `relay/invites.py` | JWT — relay_admin sees all, others scoped to own home | committed | no |
| DELETE | `/api/invites/{token}` | `relay/invites.py` | JWT — relay_admin OR own home | committed | no |
| POST | `/api/provision/home` | `relay/provision.py` | `require_role("relay_admin")` | committed | no |
| DELETE | `/api/provision/home/{home_id}` | `relay/provision.py` | `require_role("relay_admin")` | committed | no |
| GET | `/api/provision/home/{home_id}/status` | `relay/provision.py` | `require_role("relay_admin")` | committed | no |
| GET | `/api/settings/ha` | `backend/admin_router.py` | `require_role("super_admin")` | committed | no |
| PATCH | `/api/settings/ha` | `backend/admin_router.py` | `require_role("super_admin")` | committed | no |
| GET | `/api/settings/integrations` | `backend/admin_router.py` | `require_role("super_admin")` | committed | no |
| PATCH | `/api/settings/integrations` | `backend/admin_router.py` | `require_role("super_admin")` | committed | no |
| GET | `/api/settings/mqtt` | `backend/admin_router.py` | `require_role("super_admin")` | committed | no |
| PATCH | `/api/settings/mqtt` | `backend/admin_router.py` | `require_role("super_admin")` | committed | no |
| GET | `/api/settings/features` | `backend/admin_router.py` | `require_role("user")` (read-only for all) | committed | no |
| PATCH | `/api/settings/features` | `backend/admin_router.py` | `require_role("super_admin")` | committed | no |
| GET | `/api/settings/debug` | `backend/admin_router.py` | `require_role("super_admin")` | committed | no |
| PATCH | `/api/settings/debug` | `backend/admin_router.py` | `require_role("super_admin")` | committed | no |
| GET | `/api/settings/ollama` | `backend/admin_router.py` | `require_role("super_admin")` | committed | no |
| PATCH | `/api/settings/ollama` | `backend/admin_router.py` | `require_role("super_admin")` | committed | no |
| GET | `/api/settings/pattern-learning` | `backend/admin_router.py` | `require_role("super_admin")` | committed | no |
| PATCH | `/api/settings/pattern-learning` | `backend/admin_router.py` | `require_role("super_admin")` | committed | no |
| GET | `/api/settings/room-aliases` | `backend/admin_router.py` | `require_role("admin")` | committed | no |
| PATCH | `/api/settings/room-aliases` | `backend/admin_router.py` | `require_role("admin")` | committed | no |
| GET | `/api/settings/email` | `backend/admin_router.py` | `require_role("super_admin")` | committed | no |
| PATCH | `/api/settings/email` | `backend/admin_router.py` | `require_role("super_admin")` | committed | no |
| POST | `/api/settings/email/test` | `backend/admin_router.py` | `require_role("super_admin")` | committed | no |
| GET | `/api/settings/sensor-alerts` | `backend/admin_router.py` | `require_role("admin")` | committed | no |
| PATCH | `/api/settings/sensor-alerts` | `backend/admin_router.py` | `require_role("admin")` | committed | no |
| GET | `/api/settings/anomaly-rules` | `backend/admin_router.py` | `require_role("admin")` | committed | no |
| PATCH | `/api/settings/anomaly-rules` | `backend/admin_router.py` | `require_role("admin")` | committed | no |
| GET | `/api/auth/users` | `backend/auth_router.py` | `require_role("super_admin")` | committed | no |
| POST | `/api/auth/users` | `backend/auth_router.py` | `require_role("super_admin")` | committed | no |
| PATCH | `/api/auth/users/{username}` | `backend/auth_router.py` | `require_role("super_admin")` | committed | no |
| DELETE | `/api/auth/users/{username}` | `backend/auth_router.py` | `require_role("super_admin")` | committed | no |
| GET | `/api/dashboard/tablets` | `backend/dashboard_router.py` | `require_role("admin")` | untracked-parallel-session | no |
| POST | `/api/dashboard/tablets/pair-code` | `backend/dashboard_router.py` | `require_role("admin")` | untracked-parallel-session | no |
| PATCH | `/api/dashboard/tablets/{tablet_id}` | `backend/dashboard_router.py` | `require_role("admin")` | untracked-parallel-session | no |
| DELETE | `/api/dashboard/tablets/{tablet_id}` | `backend/dashboard_router.py` | `require_role("admin")` | untracked-parallel-session | no |
| GET | `/api/debug/config` | `backend/debug_router.py` | `require_role("super_admin")` | committed | no |
| POST | `/api/debug/config` | `backend/debug_router.py` | `require_role("super_admin")` | committed | no |
| GET | `/api/debug/events` | `backend/debug_router.py` | `require_role("super_admin")` | committed | no |
| DELETE | `/api/debug/events` | `backend/debug_router.py` | `require_role("super_admin")` | committed | no |
| GET | `/api/debug/export` | `backend/debug_router.py` | `require_role("super_admin")` | committed | no |
| GET | `/api/debug/request/{request_id}` | `backend/debug_router.py` | `require_role("super_admin")` | committed | no |
| POST | `/api/debug/simulate` | `backend/debug_router.py` | `require_role("super_admin")` | committed | no |
| POST | `/api/debug/frontend-event` | `backend/debug_router.py` | `require_role("super_admin")` | committed | no |
| GET | `/api/debug/status` | `backend/debug_router.py` | `require_role("super_admin")` | committed | no |
| POST | `/api/debug/self-test` | `backend/debug_router.py` | `require_role("super_admin")` | committed | no |
| POST | `/api/auth/invites` | `backend/invite_router.py` | `require_role("super_admin")` | committed | no |
| GET | `/api/auth/invites` | `backend/invite_router.py` | `require_role("super_admin")` | committed | no |
| DELETE | `/api/auth/invites/{token}` | `backend/invite_router.py` | `require_role("super_admin")` | committed | no |
| POST | `/api/onboarding/reset` | `backend/onboarding_router.py` | `require_role("super_admin")` | untracked-parallel-session | no |
| GET | `/api/presence/debug` | `backend/presence_router.py` | `require_role("admin")` | committed | partial |
| POST | `/api/presence/persons` | `backend/presence_router.py` | `require_role("admin")` | committed | partial |
| DELETE | `/api/presence/persons/{person_id}` | `backend/presence_router.py` | `require_role("admin")` | committed | partial |
| PATCH | `/api/presence/persons/{person_id}/lan-host` | `backend/presence_router.py` | `require_role("admin")` | committed | partial |
| PATCH | `/api/presence/persons/{person_id}/state` | `backend/presence_router.py` | `require_role("admin")` | committed | partial |
| PATCH | `/api/presence/zone` | `backend/presence_router.py` | `require_role("admin")` | committed | partial |
| POST | `/api/presence/zones` | `backend/presence_router.py` | `require_role("admin")` | committed | partial |
| PATCH | `/api/presence/zones/{zone_id}` | `backend/presence_router.py` | `require_role("admin")` | committed | partial |
| DELETE | `/api/presence/zones/{zone_id}` | `backend/presence_router.py` | `require_role("admin")` | committed | partial |

## Category: health-or-other

| Method | Path | Router | Auth | Status | Tests |
|---|---|---|---|---|---|
| GET | `/health` | `relay/main.py` (app-level) | none | committed | no |
| GET | `/api/mobile/health` | `backend/mobile_router.py` | none | committed | no |
| GET | `/api/status` | `backend/status_router.py` | none | committed | no |
| GET | `/api/health` | `backend/health_router.py` | none | committed | no |
| GET | `/api/health/debug-coordinator` | `backend/health_router.py` | none | committed | no |
| GET | `/api/debug/registry` | `backend/device_router.py` | none | committed | no |
| GET | `/api/update/status` | `backend/update_router.py` | none | committed | no |
| POST | `/api/update/check` | `backend/update_router.py` | none | committed | no |
| POST | `/api/update/dismiss` | `backend/update_router.py` | none | committed | no |
| GET | `/api/update/history` | `backend/update_router.py` | none | committed | no |
| GET | `/reset` | `backend/server.py` (app-level) | none | committed | no |
| WS | `/ws/{client_id}` | `backend/server.py` (app-level) | none | committed | no |

**Endpoint counts:**
- device: 44
- mobile: 7
- user-app: 142
- admin: 67
- health-or-other: 12
- **Total: 272 endpoints across 40 router files (33 backend + 7 relay).**

---

# 2. Per-Router Breakdown

Grouped by `relay/app/routers/` first (smaller, newer surface), then `backend/routers/` alphabetically. Each router gets a one-line purpose, status, test-coverage line, and a per-route detail table with the columns the brief specified.

---

## relay/app/routers/auth.py

**Purpose:** Relay-side JWT auth — bootstrap a `relay_admin` user from env vars, log a user in (with transparent bcrypt rehash from legacy HMAC), redeem an invite, return current claim set.
**Status:** committed. **Test coverage:** no.

| Method | Path | Auth | Req/Resp shape | Gaps / risks |
|---|---|---|---|---|
| POST | `/api/auth/login` | none | `{email, password}` → `{token, role, home_id, email}` | No rate limit. Login on a row with `hash_algo != 'bcrypt'` transparently rehashes — correct, but the migration is also performed inside a non-atomic context: `commit` follows the `update` but the JWT is issued only after. A crash between would leave a rehashed row without the user knowing they "logged in," which is benign. |
| POST | `/api/auth/register` | none | `{email, password, invite_token}` → `{token, role, home_id, email, invite_type}` | Accepts only invite-gated registrations. For `type=home` invites, plaintext password is passed to the Fly provisioning background task. Comment notes "set as Fly machine env var (encrypted at rest) and never stored on the relay" — verify the env-var setter doesn't log it. |
| GET | `/api/auth/me` | JWT via `current_user` | → user row excluding password_hash/salt | Reads user from DB on every call (no caching). Fine for low traffic; revisit if relay traffic scales. |
| GET | `/api/auth/status` | none | → `{"ok": true, "service": "ziggy-relay"}` | Liveness duplicate of relay `/health`. Could be folded; harmless. |

---

## relay/app/routers/backup_keys.py

**Purpose:** Per-home wrapped key material — initial seal at imaging (founder), restore-time unwrap (founder, audited), hub-reported backup status (HMAC), DR success/failure reporting (HMAC). Source of truth for the encrypted-backup pipeline.
**Status:** committed (Prompt 8). **Test coverage:** yes — `tests/test_relay_backup_endpoints.py`.

| Method | Path | Auth | Req/Resp shape | Gaps / risks |
|---|---|---|---|---|
| POST | `/api/homes/{home_id}/seal-key` | `require_role("relay_admin")` + AES-GCM proof-of-knowledge | `{master_key_b64, wrapped_data_key_b64, wrapped_b2_credentials_b64}` → `{ok, home_id, action: first_seal\|re_sealed}` | Wrong master key, malformed body, unknown home all surface as 400 — intentional. Audit row records the actual reason. |
| POST | `/api/homes/{home_id}/unseal` | `require_role("relay_admin")` | `{master_key_b64, reason}` → `{data_key_b64, b2_credentials, ttl_seconds=300, home_id}` | TTL not enforced server-side; restore script re-unseals on lapse. Founder email + free-text reason audited on every attempt. |
| GET | `/api/homes/{home_id}/backup-status` | JWT — relay_admin OR own home | → latest successful daily-backup row | 404 if no row exists. Pulled from `audit_log` via `idx_audit_home`. |
| POST | `/api/homes/{home_id}/backup-status` | Hub HMAC | free-form JSON body → `{ok}` | Stores body verbatim as audit_log.detail (JSON-encoded). No body schema validation. |
| POST | `/api/homes/{home_id}/restore-events` | Hub HMAC | `{event: restore_completed\|restore_aborted, …}` → `{ok}` | `event` whitelist enforced. Other fields stored verbatim in audit detail. |

---

## relay/app/routers/homes.py

**Purpose:** Home lifecycle — hub self-registration (HMAC), one-shot legacy-secret rotation, founder CRUD on homes, and a tunnel-pass-through health check.
**Status:** committed. **Test coverage:** no.

| Method | Path | Auth | Req/Resp shape | Gaps / risks |
|---|---|---|---|---|
| POST | `/api/homes/register-hub` | Hub HMAC against existing `homes.relay_secret` | `{home_id, name, tunnel_url}` → `{ok}` | Hubs that hold the legacy shared secret must rotate first. |
| POST | `/api/homes/rotate-hub-secret` | Hub HMAC against CURRENT secret | `{home_id}` → `{relay_secret, rotated_at}` | Returns new secret in response body — caller must persist before next call. Each invocation generates a fresh value (no idempotency). |
| GET | `/api/homes/` | relay_admin | → list of homes with user_count | |
| GET | `/api/homes/{home_id}` | JWT — relay_admin OR own home | → home row (relay_secret stripped) + users | |
| PATCH | `/api/homes/{home_id}` | relay_admin | `{name?, status?}` → `{ok}` | No allowlist on `status` value — can write arbitrary strings. |
| DELETE | `/api/homes/{home_id}` | relay_admin | → `{ok}` | Cascade via FK to users + invites + backup_keys + audit_log (audit has no FK — rows orphan with the home_id intact, which is desired). |
| GET | `/api/homes/{home_id}/health` | JWT — relay_admin OR own home | → `{ok, status, hub_status}` | Synchronous call to hub's `/api/health` over tunnel with `X-Relay-Secret`. 8-second timeout. |

---

## relay/app/routers/invites.py

**Purpose:** Invite creation/listing/revocation + public invite-info lookup. Used both for new-home invites (relay_admin) and per-home user invites (super_admin).
**Status:** committed. **Test coverage:** no.

| Method | Path | Auth | Req/Resp shape | Gaps / risks |
|---|---|---|---|---|
| POST | `/api/invites/` | JWT — relay_admin for home invites, super_admin for user invites | `{type, email?, role, home_id?, home_name?, public_url?}` → invite record + URL | Email send is background and failure-silent. |
| GET | `/api/invites/{token}/info` | none (public) | → `{type, email, role, home_name, invited_by, expires_at, accepted}` | 410 if accepted or expired. **No rate limit** — tokens can be probed. |
| GET | `/api/invites/` | JWT — relay_admin sees all, others scoped to own home | → list with computed `status` | |
| DELETE | `/api/invites/{token}` | JWT — relay_admin OR own home | → `{ok}` | |

---

## relay/app/routers/provision.py

**Purpose:** Founder-triggered home provisioning on Fly.io (Docker compose + Cloudflare tunnel + DB record). Background task; status polled separately.
**Status:** committed. **Test coverage:** no.

| Method | Path | Auth | Req/Resp shape | Gaps / risks |
|---|---|---|---|---|
| POST | `/api/provision/home` | relay_admin | `{home_name, owner_email?, invite_token?, admin_email?, admin_password?}` → `{home_id, status: provisioning}` | Plaintext password forwarded to provisioner as a Fly secret env var (per inline comment). Bcrypted on the hub side later. |
| DELETE | `/api/provision/home/{home_id}` | relay_admin | → `{ok, status: deprovisioning}` | Background task tears down tunnel + Fly machine. |
| GET | `/api/provision/home/{home_id}/status` | relay_admin | → `{id, name, status, tunnel_url}` | Status string surfaces provisioner errors via `failed: <reason[:200]>`. |

---

## relay/app/routers/proxy.py

**Purpose:** Authenticated request forwarder — browser hits `/api/proxy/{home_id}/<path>` with JWT, relay validates ownership, injects `X-Relay-*` headers, forwards to the hub's tunnel URL.
**Status:** committed. **Test coverage:** no.

| Method | Path | Auth | Req/Resp shape | Gaps / risks |
|---|---|---|---|---|
| ANY | `/api/proxy/{home_id}/{path:path}` | JWT — relay_admin OR own home | verbatim passthrough | Strips hop-by-hop response headers (content-encoding, content-length, transfer-encoding, etc.) to keep Fly's edge from returning 502s. Module-level keep-alive httpx client. Status `suspended` is hard-blocked at the relay — important for Prompt 9 kill-switch design. |

---

## relay/app/routers/public_presence.py

**Purpose:** Public passthrough for Ziggy presence PWA paths — token-in-URL is the only auth, relay forwards verbatim to the single active home's hub.
**Status:** committed. **Test coverage:** no.

| Method | Path | Auth | Req/Resp shape | Gaps / risks |
|---|---|---|---|---|
| GET | `/presence/join/{token}` | none | → HTML page from hub | `_resolve_home` returns 503 if more than one active home exists. **Multi-tenant gap explicitly called out in the file's docstring** — needs a token→home_id cache or URL pattern change. |
| GET | `/presence/manifest.json` | none | → PWA manifest from hub | Same single-home limitation. |
| POST | `/api/presence/ping` | none | GPS payload → hub forward | Same single-home limitation. |

---

## backend/routers/activity_router.py

**Purpose:** Read last N activity events from `user_files/events.jsonl`.
**Status:** committed. **Test coverage:** no.

| Method | Path | Auth | Req/Resp shape | Gaps / risks |
|---|---|---|---|---|
| GET | `/api/activity` | none | `?limit=N` → `{activity: [event dicts]}` | **No auth dep** — public-readable activity log. No rate limit. Swallows all exceptions to `{"activity": []}`. |

---

## backend/routers/admin_router.py

**Purpose:** System config admin surface (HA, integrations, MQTT, features, debug, Ollama, pattern-learning, room aliases, email, sensor alerts, anomaly rules). Largest admin surface.
**Status:** committed. **Test coverage:** no.

(See master table above for all 22 endpoints.) Notable risks:
- **`PATCH /api/settings/features`** has no Pydantic model — accepts any keys. Silently skips non-bool values.
- Secrets (HA token, OpenAI key, SMTP password, MQTT password) all written to `secrets.yaml`. Not encrypted at rest.
- All mutating endpoints are super_admin-gated except sensor-alerts and anomaly-rules (admin-tier).

---

## backend/routers/alerts_router.py *(untracked — parallel session)*

**Purpose:** Flattened active-anomaly list for the Hub's alerts widget.
**Status:** untracked-parallel-session — module file exists, NOT mounted in `server.py`. **Test coverage:** no.

| Method | Path | Auth | Req/Resp shape | Gaps / risks |
|---|---|---|---|---|
| GET | `/api/alerts` | `get_current_user` | `?limit&severity` → `{alerts, total}` | Pure read; swallows ImportError if anomaly engine not loaded. Route is dead until the parallel session wires it in. |

---

## backend/routers/auth_router.py

**Purpose:** First-boot setup, login/logout, password change, user CRUD, session status.
**Status:** committed. **Test coverage:** no.

(See master table for all 9 endpoints.) Notable risks:
- `POST /api/auth/login` has **no rate limit** — brute-force-able. Empty-fleet bypass returns a placeholder token with no credentials supplied (intentional first-boot affordance).
- `POST /api/auth/setup` also has no rate limit, but is one-shot — guarded by 409 once any user exists.

---

## backend/routers/automation_router.py

**Purpose:** HA automation CRUD, templates, history, push-action callbacks, manual override inspection.
**Status:** committed. **Test coverage:** no.

(See master table for all 14 endpoints.) Notable risks:
- **No auth on any endpoint in this router** despite mutating HA automations and firing actions.
- Suspected handler-binding defect on `GET /api/automations/templates` — the decorator sits above `_safe_list_automations` (a list helper) while the real `get_automation_templates` function below is undecorated. Worth verifying by hitting the route.

---

## backend/routers/camera_router.py

**Purpose:** List HA camera entities, motion events, JPEG snapshots and MJPEG stream proxy.
**Status:** committed. **Test coverage:** no.

| Method | Path | Auth | Req/Resp shape | Gaps / risks |
|---|---|---|---|---|
| GET | `/api/cameras` | none | → `{cameras: [...]}` | **No auth — exposes camera entity list.** |
| GET | `/api/cameras/motion` | none | `?hours` → `{events}` | |
| GET | `/api/cameras/{entity_id}/snapshot` | none | → JPEG bytes | **Unauthenticated camera proxy.** HA token stays server-side, but any reachable client gets the frame. |
| GET | `/api/cameras/{entity_id}/stream` | none | → MJPEG stream | **Unauthenticated MJPEG proxy.** Persistent exposure equivalent to a live feed. |

HA URL+token read at module import — token rotation requires process restart.

---

## backend/routers/capability_router.py

**Purpose:** Read-only capability catalog.
**Status:** committed. **Test coverage:** no.

| Method | Path | Auth | Req/Resp shape | Gaps / risks |
|---|---|---|---|---|
| GET | `/api/capabilities` | none | → `{capabilities, categories}` | |
| GET | `/api/capabilities/{cap_id}` | none | → cap detail (404 if missing) | |

---

## backend/routers/dashboard_router.py *(untracked — parallel session)*

**Purpose:** Hub-tablet dashboard layouts + tablet pairing lifecycle.
**Status:** untracked-parallel-session — module file exists, NOT mounted. **Test coverage:** no.

| Method | Path | Auth | Req/Resp shape | Gaps / risks |
|---|---|---|---|---|
| GET | `/api/dashboard/layout` | `get_current_user` | `?tablet_id&mode` → `{layout, tablet_id}` | |
| PUT | `/api/dashboard/layout` | `get_current_user` | `{tablet_id, layout, mode?}` → `{layout}` | Any logged-in user can save any tablet's layout (no ownership check beyond tablet existence). |
| GET | `/api/dashboard/tablets` | `require_role("admin")` | → `{tablets}` | |
| POST | `/api/dashboard/tablets/pair-code` | `require_role("admin")` | `{display_name_hint?}` → `{code, ttl_s,…}` | 6-digit code. |
| POST | `/api/dashboard/tablets/claim` | `get_current_user` | `{code, display_name?, room?}` → tablet record | Internal per-client_key rate-limit (429 on exceed). |
| PATCH | `/api/dashboard/tablets/{tablet_id}` | `require_role("admin")` | `{display_name?, room?}` → updated tablet | |
| DELETE | `/api/dashboard/tablets/{tablet_id}` | `require_role("admin")` | → `{ok}` | Also drops associated layouts. |
| POST | `/api/dashboard/tablets/{tablet_id}/heartbeat` | `get_current_user` | → `{ok}` | Any user can heartbeat any tablet. |

---

## backend/routers/debug_router.py

**Purpose:** Debug bus config, event query, simulate intent, frontend-event ingestion, self-test.
**Status:** committed. **Test coverage:** no.

(See master table for all 10 endpoints.) All super_admin-gated. Notable:
- The `device_router.py` defines `/api/debug/registry` **with no auth**, which is namespace-inconsistent with this router's super_admin gating. Flagged below.

---

## backend/routers/device_router.py

**Purpose:** Device registry, room CRUD, HA area assignment, entity detail / commands / history. Largest router.
**Status:** committed. **Test coverage:** no.

(See master table for all 21 endpoints.) Notable risks:
- **No auth on any endpoint.** Includes destructive operations (`DELETE /api/ha/entity/{...}`, `DELETE /api/rooms/{area_id}`) and command execution (`POST /api/devices/{...}/commands`).
- Defines `/api/debug/registry` — inconsistent with the super_admin gating on every other `/api/debug/*` route in `debug_router.py`.
- Path namespace `/api/ha/devices/{device_id}/area` overlaps with `pairing_router.py`'s `/api/ha/devices/{device_id}/...` routes — FastAPI resolves by path specificity but the surface is fragmented.

---

## backend/routers/event_router.py

**Purpose:** Calendar events (name + date manager).
**Status:** committed. **Test coverage:** no.

| Method | Path | Auth | Req/Resp shape | Gaps / risks |
|---|---|---|---|---|
| GET | `/api/events` | none | → `{events}` | |
| POST | `/api/events` | none | `{name, date_str, notes?, repeat?}` → `{ok, result}` | **No auth.** |
| DELETE | `/api/events/{event_name:path}` | none | → `{ok, result}` | 404 detection via `"❌" in result` — brittle string check. |
| GET | `/api/events/next` | none | → `{result}` | |
| GET | `/api/events/days-until/{event_name:path}` | none | → `{result}` | |

---

## backend/routers/ha_router.py

**Purpose:** HA entity listing, state read, service-call passthrough (with denylist), fire-and-forget control, protocol map.
**Status:** committed. **Test coverage:** no.

| Method | Path | Auth | Req/Resp shape | Gaps / risks |
|---|---|---|---|---|
| GET | `/api/ha/entities` | none | `?domain&all` → `{entities, count}` | |
| GET | `/api/ha/state/{entity_id:path}` | none | → entity state | |
| PATCH | `/api/ha/entity/{entity_id:path}/name` | none | `{name}` → `{ok}` | |
| DELETE | `/api/ha/entity/{entity_id:path}/name` | none | → `{ok}` | |
| POST | `/api/ha/service` | none + denylist | `{domain, service, data}` → HA result + `_ha_ms` | Denylist on `homeassistant.*`, `shell_command.*`, etc. — added per S3 audit. Inline comment marks "Founder review pending" on the denylist. |
| POST | `/api/ha/control` | none | `{entity_id, action, source?}` → `{ok, entity_id, state, queued}` | Optimistic WS broadcast then background HA call; reverts on failure. |
| GET | `/api/ha/entity-protocols` | none | → `{protocols: {entity_id: 'zigbee'\|'zwave'\|…}}` | |

---

## backend/routers/health_router.py

**Purpose:** System health snapshot (offline count, batteries, coordinator detection) and Zigbee reload.
**Status:** committed. **Test coverage:** no.

| Method | Path | Auth | Req/Resp shape | Gaps / risks |
|---|---|---|---|---|
| GET | `/api/health` | none | → coordinator+battery+offline summary | **No auth.** Imports device_router to share enrich helper (cross-router coupling). |
| POST | `/api/health/reload-zigbee` | none | → `{ok, message}` | **No auth on a state-changing HA reload.** |
| GET | `/api/health/debug-coordinator` | none | → `{coordinator_found, all_entity_platforms}` | **No auth on diagnostic.** |

---

## backend/routers/intent_router.py

**Purpose:** Natural-language intent + chat + voice transcription pipelines. Heavily traffic'd.
**Status:** committed. **Test coverage:** no.

(See master table for all 5 endpoints.) Notable:
- **No auth on `/api/intent`, `/api/chat`, `/api/direct-intent`.** Anyone reachable can execute any intent (including ones with HA side-effects).
- `/api/voice` and `/api/voice/transcribe` have a per-client rate limit (30/min/client, 5MB max, content-type allowlist) but **no auth dep** — relies on per-IP/username key.

---

## backend/routers/invite_router.py

**Purpose:** User/home invite tokens — create/list/revoke (admin) and public accept flow.
**Status:** committed. **Test coverage:** no.

(See master table for all 5 endpoints.) Notable:
- Public accept routes (`GET /api/auth/invite/{token}`, `POST /api/auth/invite/{token}/accept`) have **no rate limit** — tokens can be probed.

---

## backend/routers/ir_router.py

**Purpose:** IR blaster + device CRUD, learning, sending, sequences/macros, AC temp, unassigned-signal triage.
**Status:** committed. **Test coverage:** partial — service-level only (`test_ir_manager.py`, `test_ir_protocol.py`, no route tests).

(See master table for all 24 endpoints.) Notable:
- **No auth on any endpoint.** IR learning (`POST /api/ir/learn`) blocks the worker thread up to 20 s — DoS surface.
- `GET /api/ir/discover` runs a 6-second network scan — also DoS-able.

---

## backend/routers/map_router.py

**Purpose:** Floor-plan canvas storage, per-room summaries, anomaly active list/snooze/action, AI SVG render, mock anomalies.
**Status:** committed. **Test coverage:** partial — `test_canvas_api.py` covers helpers in this module.

(See master table for all 11 endpoints.) Notable:
- **No auth on any endpoint.** Includes `POST /api/map/anomalies/mock` (dev-only mocking) and `POST /api/map/anomalies/action/{...}` which can fire HA actions.

---

## backend/routers/mobile_router.py

**Purpose:** Mobile (Capacitor) app HTTP+WS surface — pairing, register, sensor webhook, device list. Prefix `/api/mobile`, tags `["mobile"]`.
**Status:** committed. **Test coverage:** no.

| Method | Path | Auth | Req/Resp shape | Gaps / risks |
|---|---|---|---|---|
| GET | `/api/mobile/health` | none | → `{ok, service, version}` | Liveness. |
| POST | `/api/mobile/pair-code` | `get_current_user` (PWA-side) | → 6-char code + expiry | |
| POST | `/api/mobile/pair` | none (consumes pair-code) | `{pair_code, device:{platform, model?, os_version?, app_version?}}` → `{device_id, webhook_id, webhook_url, ws_url, auth_token, person_id, home_id}` | **URL bug suspect:** response `webhook_url=f"{base}/mobile/webhook/{id}"` and `ws_url=f"{ws}/mobile/ws"` — but the router is mounted at `/api/mobile/...`. Either the prefix or the response strings are wrong. |
| POST | `/api/mobile/register` | `get_current_device` (Bearer → `mobile_app.find_device_by_token`) | `{push_token?, push_provider?, person_id?, permissions?, capabilities?}` → `{ok}` | **No HMAC.** Plain bearer token. |
| POST | `/api/mobile/webhook/{webhook_id}` | `get_current_device` + webhook_id match | arbitrary `{}` payload → handler result | **No HMAC.** No rate limit. |
| GET | `/api/mobile/devices` | `get_current_user` | → `{devices}` + ws_connected flag | |
| DELETE | `/api/mobile/devices/{device_id}` | `get_current_user` (ownership-checked via `_user_id_of`) | → `{ok}` | |
| WS | `/api/mobile/ws` | `?token=…` → `find_device_by_token` (closes 4401 on bad token) | bidirectional; ping/pong | No `home_id` propagation (Phase 2 placeholder per code comments). |

**Critical Chunk 3 finding:** none of these routes use the relay's `X-Ziggy-Signature` HMAC pattern. Mobile auth is plain bearer token. The Section D brief assumes "per-home HMAC verification (same pattern as relay)" — that pattern is **not implemented** on the mobile side today.

---

## backend/routers/mode_router.py *(untracked — parallel session)*

**Purpose:** Home "mode" selector (e.g. home/away/night) read/write.
**Status:** untracked-parallel-session — module file exists, NOT mounted. **Test coverage:** no.

| Method | Path | Auth | Req/Resp shape | Gaps / risks |
|---|---|---|---|---|
| GET | `/api/mode` | `get_current_user` | → current mode + meta | |
| GET | `/api/mode/options` | `get_current_user` | → `{modes: [...]}` | |
| POST | `/api/mode` | `get_current_user` | `{mode}` → result | Any logged-in user can change mode (no role gate). |

---

## backend/routers/onboarding_router.py *(untracked — parallel session)*

**Purpose:** First-run onboarding state machine + HA probe.
**Status:** untracked-parallel-session — module file exists, NOT mounted. **Test coverage:** no.

| Method | Path | Auth | Req/Resp shape | Gaps / risks |
|---|---|---|---|---|
| GET | `/api/onboarding/state` | `get_current_user` | → state + completed/next | |
| PATCH | `/api/onboarding/state` | `get_current_user` | `{step_id, skipped?}` → state | |
| POST | `/api/onboarding/complete` | `get_current_user` | → state | |
| POST | `/api/onboarding/reset` | `require_role("super_admin")` | → state | |
| POST | `/api/ha/probe` | `get_current_user` | `{url, token}` → probe result | **Path namespace overlap** with `ha_router.py`'s other `/api/ha/*` routes. Pure validation — no persistence. |

---

## backend/routers/pairing_router.py

**Purpose:** ZHA / Z-Wave / Matter pairing flows + Switcher Wi-Fi pairing via HA config flows.
**Status:** committed. **Test coverage:** no.

(See master table for all 16 endpoints.) Notable:
- **No auth on any endpoint.** Includes `POST /api/pairing/switcher/recover` which **restarts HA** — unauthenticated.

---

## backend/routers/presence_router.py

**Purpose:** Person registry, geo-ping ingestion, zones (home + extras), PWA join page + manifest.
**Status:** committed. **Test coverage:** partial — `test_wifi_home_hint_safety.py` covers one helper.

(See master table for all 17 endpoints.) Notable:
- Read endpoints user-gated; write endpoints admin-gated — consistent.
- `POST /api/presence/ping` uses a per-person URL token in the body (no Bearer). **No rate limit** beyond the engine's stale-ping rejection.

---

## backend/routers/push_router.py

**Purpose:** Web push (VAPID) subscriptions + per-user preferences + test push.
**Status:** committed. **Test coverage:** no.

(See master table for all 8 endpoints.) Notable:
- All endpoints `get_current_user`-gated. `POST /api/push/test` has no rate limit — any user can spam.
- Separate `POST /api/push/action/{token}` lives in `automation_router.py` (no auth, one-shot token).

---

## backend/routers/quick_ask_router.py

**Purpose:** Quick-ask button CRUD.
**Status:** committed. **Test coverage:** no.

(See master table for all 4 endpoints.) **No auth on any endpoint.**

---

## backend/routers/routine_router.py

**Purpose:** HA scripts ("routines") CRUD + run.
**Status:** committed. **Test coverage:** no.

(See master table for all 5 endpoints.) **No auth on any endpoint** including `POST /api/routines/{script_id}/run`.

---

## backend/routers/status_router.py

**Purpose:** Process / thread / WS status, memory, general + voice settings.
**Status:** committed. **Test coverage:** no.

| Method | Path | Auth | Req/Resp shape | Gaps / risks |
|---|---|---|---|---|
| GET | `/api/status` | none | → `{ok, threads, system, ws_clients, config}` | **No auth — exposes thread names and partial config.** Includes `ha_url`. |
| GET | `/api/memory` | none | → `{memory}` | |
| GET | `/api/settings/general` | `get_current_user` | → `{language, timezone}` | |
| PATCH | `/api/settings/general` | `get_current_user` | `{language?, timezone?}` → `{ok}` | Any user can change site-wide language/timezone. |
| GET | `/api/settings/voice` | `get_current_user` | → voice dict | |
| PATCH | `/api/settings/voice` | `get_current_user` | various → `{ok, voice}` | Toggles `mic_enabled_event` runtime flag. Code comment notes a historical bug where a removed feature-flag duplicate silently dropped every field except scenes. |
| GET | `/api/voice/status` | `get_current_user` | → runtime listening state | |

---

## backend/routers/suggestion_router.py

**Purpose:** Pattern-learning suggestion review (accept/reject/snooze/analyze).
**Status:** committed. **Test coverage:** no.

(See master table for all 6 endpoints.) **No auth on any endpoint.**

---

## backend/routers/task_router.py

**Purpose:** Task CRUD.
**Status:** committed. **Test coverage:** no.

(See master table for all 4 endpoints.) **No auth on any endpoint.** `POST /api/tasks` does an awkward two-step `add_task() → patch_task()` to set extra fields after creation.

---

## backend/routers/ui_prefs_router.py

**Purpose:** Per-user UI prefs (pinned shortcuts, quick controls, room photos, ordering, theme).
**Status:** committed. **Test coverage:** no.

| Method | Path | Auth | Req/Resp shape | Gaps / risks |
|---|---|---|---|---|
| GET | `/api/ui/prefs` | `get_current_user` | → user prefs record | Single-file JSON store keyed by email. |
| PUT | `/api/ui/prefs` | `get_current_user` | PrefsUpdate → updated record | Caps enforced server-side (QUICK_MAX=4, SHORTCUTS_MAX=8, photos 800KB / 20 max). |

---

## backend/routers/update_router.py

**Purpose:** HA version-update status (cached / forced) + dismiss + history.
**Status:** committed. **Test coverage:** no.

(See master table for all 4 endpoints.) **No auth on any endpoint.** Categorized `health-or-other` because the consumer is the system update-check, not a tenant user. Body of `POST /api/update/dismiss` is an untyped dict.

---

## backend/routers/virtual_device_router.py

**Purpose:** Virtual-device CRUD + trigger.
**Status:** committed. **Test coverage:** no.

(See master table for all 6 endpoints.) **No auth on any endpoint.** `POST /api/virtual-devices/{device_id}/trigger` uses a Pydantic model instance default for body — slightly nonstandard but functional.

---

## backend/routers/weather_router.py *(untracked — parallel session)*

**Purpose:** Weather widget shortcut (wraps `_weather_fetch`).
**Status:** untracked-parallel-session — module file exists, NOT mounted. **Test coverage:** no.

| Method | Path | Auth | Req/Resp shape | Gaps / risks |
|---|---|---|---|---|
| GET | `/api/weather` | none | `?city` → `{city, current, cached}` | **No auth.** 10-min in-memory cache per city. Default city falls back to Tel Aviv. |

---

# Appendix A — `auth.db` schema

Two SQLite databases participate in the cloud surface. Both are named `auth.db` in their respective contexts (confusing — flag for naming cleanup post-launch).

## A.1 Relay-side schema (`relay/app/database.py`)

Lives at `DATABASE_URL=/data/relay.db` on Fly volumes. Created idempotently by `init_db()` at app startup. Tables:

```sql
homes (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'cloud',
  tunnel_url  TEXT,
  status      TEXT NOT NULL DEFAULT 'provisioning',
  relay_secret TEXT NOT NULL,        -- per-home HMAC secret, hex-32
  cf_tunnel_id TEXT,
  created_at  TEXT NOT NULL,
  owner_email TEXT
);

users (
  id           TEXT PRIMARY KEY,
  email        TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt         TEXT NOT NULL,        -- unused for bcrypt rows
  role         TEXT NOT NULL DEFAULT 'user',
  home_id      TEXT REFERENCES homes(id) ON DELETE CASCADE,
  session_token TEXT,                -- NOT used by relay's JWT path; vestigial
  created_at   TEXT NOT NULL,
  hash_algo    TEXT NOT NULL DEFAULT 'hmac_sha256'  -- 'bcrypt' or 'hmac_sha256'
);

invites (
  token       TEXT PRIMARY KEY,
  type        TEXT NOT NULL,         -- 'user' | 'home'
  email       TEXT,
  role        TEXT NOT NULL,
  home_id     TEXT REFERENCES homes(id) ON DELETE CASCADE,
  home_name   TEXT,
  invited_by  TEXT,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  accepted    INTEGER NOT NULL DEFAULT 0,
  accepted_at TEXT,
  accepted_by TEXT
);

audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT    NOT NULL,
  event       TEXT    NOT NULL,      -- free-text; documented set in BACKUP_AUDIT_EVENTS
  home_id     TEXT,
  source_ip   TEXT,
  ok          INTEGER NOT NULL DEFAULT 0,
  detail      TEXT                   -- free-text or JSON
);

home_backup_keys (
  home_id                TEXT PRIMARY KEY REFERENCES homes(id) ON DELETE CASCADE,
  wrapped_data_key       BLOB NOT NULL,             -- nonce(12)||ciphertext||tag(16)
  wrapped_b2_credentials BLOB NOT NULL,
  key_version            INTEGER NOT NULL DEFAULT 1,
  created_at             TEXT NOT NULL,
  last_unsealed_at       TEXT,
  last_unsealed_by       TEXT REFERENCES users(email)
);

-- Indexes:
idx_users_email, idx_users_home, idx_invites_token, idx_invites_home,
idx_audit_event(event, ts), idx_audit_home(home_id, ts)
```

**Notable observations:**
- The `hash_algo` column was added via conditional `ALTER TABLE` in `init_db()` — backward-compat shim for pre-Task-4 deployments.
- `users.session_token` exists in the schema but the relay's JWT path doesn't use it — `relay/app/auth.py::current_user` decodes JWT only. Vestigial.
- `homes.status` is unconstrained text. Status values seen in code: `provisioning`, `pending_setup`, `active`, `suspended`, `deprovisioning`, `failed: <reason>`. **No `subscription_state` column yet** — needed for Prompt 9 kill-switch gating.
- No `devices` table. The hub-as-a-thing is keyed by `home_id` everywhere on the relay; one home = one hub today.

## A.2 Backend-side schema (`services/auth_db.py`)

Lives on the hub. Not read in this audit (scope was routers + appendix). The backend's `find_user_by_token` in `auth_deps.py` reads sessions via `services.auth_db.get_user_by_session_token`, with a legacy fallback to `settings.yaml::users[].session_tokens`. The two `auth.db` files are unrelated despite the shared name.

---

# Appendix B — HMAC machinery

## B.1 Relay-side (per-home HMAC)

Lives in `relay/app/audit.py` — single source of truth for both signing and verification (so they can't drift).

**Signature format** (Slack/Stripe-style):
```
X-Ziggy-Signature: t=<unix_ts>,v1=<hex(hmac_sha256(secret, "<ts>." + raw_body))>
```

**Window:** 300 seconds (`SIGNATURE_WINDOW_S = 300`). Constant-time compare via `hmac.compare_digest`.

**Verify reasons surfaced for audit log:** `no_secret_on_record`, `missing_or_malformed_signature`, `timestamp_outside_window`, `signature_mismatch`.

**Secret source:** per-home `homes.relay_secret`, hex-32, rotated via `/api/homes/rotate-hub-secret`.

**Routes that use it today:**
- `POST /api/homes/register-hub`
- `POST /api/homes/rotate-hub-secret`
- `POST /api/homes/{home_id}/backup-status`
- `POST /api/homes/{home_id}/restore-events`

That's the **complete** set. Anything else marked "device" in the master table is either backend-local (no HMAC) or hasn't been built yet (OTA, telemetry).

## B.2 Backend-side (relay→hub passthrough)

Lives in `backend/middleware/relay_auth.py` — pure ASGI middleware (intentionally not `BaseHTTPMiddleware` to avoid Starlette response-buffering stalls).

**Protocol:** relay forwards proxied requests with these headers:
```
X-Relay-Secret: <home_relay_secret>
X-Relay-User:   <user@email>
X-Relay-Role:   <role>
X-Relay-Home:   <home_id>
```

The middleware compares `X-Relay-Secret` against the hub's local `RELAY_SECRET` env var (or `settings.yaml::relay.secret`). On match, injects `scope["state"].relay_user`, which `get_current_user` in `auth_deps.py` reads first (before falling through to local Bearer tokens).

**This is shared-secret auth, not HMAC.** The relay holds the per-home secret and the hub holds the same secret. There is **no signature over the body** — a request that captures the relay secret can replay/forge requests for that hub.

## B.3 Backend-side (mobile)

**There is no HMAC.** Mobile routes use bearer tokens:
- `get_current_device` (in `mobile_router.py`) calls `mobile_app.find_device_by_token(token)` — a service-level lookup.
- Bearer token is issued at `POST /api/mobile/pair` time, returned to the client as `auth_token`.

The Section D brief mentions `verify_mobile_hmac` as a pattern to confirm against. That dep **does not exist** in the codebase. Patching to add HMAC verification on `/api/mobile/*` is a substantive change — it requires:
1. A per-home (or per-device) secret stored on the hub side.
2. A signing layer in the mobile app (Capacitor — requires native crypto).
3. A migration path for already-paired devices.

Flag for Chunk 3 design discussion before patching anything.

---

# Appendix C — Audit log tables

## C.1 Relay `audit_log` (the only structured audit log)

Schema in Appendix A.1. Writer: `relay/app/audit.py::log_event(event, home_id?, source_ip?, ok=True, detail?)` — best-effort, never raises into the request path.

**Event names currently emitted:**
- `register_hub` (homes.py)
- `rotate_hub_secret` (homes.py)
- `backup_key_sealed` (backup_keys.py)
- `backup_key_unsealed` (backup_keys.py)
- `backup_status_updated` (backup_keys.py)
- `restore_completed` (backup_keys.py)
- `restore_aborted` (backup_keys.py)

That's it — no other relay routes write to `audit_log` today. Notably, `provision.py`, `invites.py`, `auth.py` (login/register/me), `proxy.py`, and `homes.py` CRUD do **not** write audit rows.

## C.2 Backend audit log

**There is none.** No structured audit-log table on the hub. Logging goes through:
- `core.logger_module` (rotating files) — narrative log.
- `core.debug_bus` — in-memory ring buffer with WS broadcast, configurable level/scopes, queried via `/api/debug/events`. Not persistent across restarts.

For Prompt 10's admin-dashboard audit-log viewer, the relay's `audit_log` is the only source today. Cross-home admin actions on the hub (e.g. an admin changing HA token via `PATCH /api/settings/ha`) are **not audited** in any retrievable form.

---

# Top Gaps & Risks (priming Chunk 2)

Listed roughly in the order they affect the OTA + telemetry design.

## OTA + telemetry-shaped gaps

1. **No `/api/devices/<device_id>/ota-manifest` exists anywhere.** Greenfield design for Chunk 2 — no existing endpoint or storage to extend.
2. **No `/api/devices/<device_id>/telemetry` exists anywhere.** Same — greenfield.
3. **No `device_id` concept on the relay.** Hub identity is `home_id` everywhere. The Section B/C brief uses `<device_id>` — proposal needed: do we (a) treat `home_id` AS the device id (1:1 in v1), (b) add a `devices(home_id, device_id)` join table on the relay, or (c) keep `device_id` purely as a backend-side mobile thing? Recommend (a) for v1, with the table reserved for v2 if multi-device-per-home becomes real.
4. **No `subscription_state` field anywhere yet.** The brief mentions "device.subscription_state gating pattern" — that pattern is a Prompt 9 outcome, not a current artifact. Chunk 2 must design the OTA + telemetry endpoints to *accept* a state check without depending on the field existing yet. Stub it as `homes.status != 'suspended'` for now; rewire when Prompt 9 lands.
5. **No telemetry retention table.** Brief asks for raw-30-day + daily-aggregates-1-year. Greenfield. Decide SQLite-on-Fly-volume (simple, fits current footprint) vs. a separate timeseries store (over-engineering for first 30 customers).

## Mobile-shape gaps (preview for Chunk 3)

6. **No HMAC on `/api/mobile/*` today.** Brief assumes a "per-home HMAC verification (same pattern as relay)." Patching this in is non-trivial (Capacitor crypto + pairing migration). Need an explicit decision before code change: tighten existing bearer-token model with rate-limiting + audit + per-route checks (lighter), or fully introduce HMAC (heavier, breaks existing paired devices).
7. **No audit log entries from mobile routes.** Per the brief's Section D, every `/api/mobile/*` route should write an audit row on auth failure. Today: zero. There's no backend `audit_log` to write to (Appendix C.2). Either pipe to the relay's `audit_log` via the proxy headers, or introduce a backend audit table.
8. **No rate limit on mobile routes** (one exception: `/api/voice/*` in `intent_router` has its own per-client limit — different router).
9. **Mobile pair response returns wrong URL prefix.** `webhook_url`/`ws_url` use `/mobile/...` but the router is mounted at `/api/mobile/...`. Pre-existing bug, likely cosmetic on the wire if the mobile app constructs URLs from the response. Worth confirming before Chunk 3 patches anything else.

## Surface-wide hardening gaps (out of Chunk 2 scope; surfaced for visibility)

10. **`/api/intent`, `/api/chat`, `/api/direct-intent` are unauthenticated.** Anyone reachable can execute any intent on the hub. The pre-relay LAN-trust model bleeds through here.
11. **`/api/cameras/*` are unauthenticated.** Camera frames + MJPEG stream + motion history exposed to any reachable client.
12. **`/api/ha/service` and `/api/ha/control` are unauthenticated** except for a denylist on `homeassistant.*` etc. Inline comment marks the denylist as "Founder review pending."
13. **`/api/pairing/switcher/recover` restarts HA, unauthenticated.**
14. **`/api/devices`, `/api/rooms` CRUD entirely unauthenticated.** Includes destructive DELETEs against HA areas/entities.
15. **No relay-side rate limit on `/api/auth/login` or `/api/invites/{token}/info`.** Brute-force / probe-able.

Items 10–15 are **not** in the rescoped Prompt 2 scope. They are surfaced here so they can be triaged into a separate hardening prompt (likely the next interstitial after Prompt 2 ships).

## Admin-auth alignment (priming Chunk 3 Section E)

16. **Backend admin model = `require_role("admin"|"super_admin")` against `auth_deps.find_user_by_token` (auth.db sessions or yaml fallback).** Relay admin model = `require_role("relay_admin")` against `current_user` (JWT). Prompt 10's dashboard will need to make admin-level calls against **both** — the relay (for cross-home views, OTA cohort control, audit log) **and** through the proxy to specific hubs (for per-home config). The two role hierarchies don't share a wire format. Aligning them probably means: the dashboard authenticates to the relay with JWT (relay_admin), and any hub-targeted call goes through `/api/proxy/{home_id}/...` which already injects `X-Relay-Role: relay_admin` into the proxied request, which the hub already maps to a synthetic user with role 'relay_admin' in `RelayAuthMiddleware`. **However**, `ROLE_ORDER` in backend `auth_deps.py` only knows `guest/user/admin/super_admin` — not `relay_admin`. A request arriving from a relay-admin via proxy gets injected as `role='relay_admin'`, which `require_role('super_admin')` will reject (unknown role → rank 0). **This is a real bug.** Flag for Chunk 3.

## Untracked parallel-session work

17. **5 router modules exist on disk but are NOT mounted** in `backend/server.py`: `alerts_router`, `dashboard_router`, `mode_router`, `onboarding_router`, `weather_router`. The parallel session has built the modules but not wired the `include_router` calls. This is expected — those endpoints will start responding once the parallel session lands its commit. **Do not modify in Chunk 1/2/3.**

---

# Files referenced

- `backend/server.py`
- `backend/middleware/relay_auth.py`
- `backend/routers/auth_deps.py`
- `backend/routers/*.py` (33 files including the 5 untracked)
- `relay/app/main.py`
- `relay/app/auth.py`
- `relay/app/audit.py`
- `relay/app/database.py`
- `relay/app/routers/*.py` (7 files)
- `services/auth_db.py` (referenced via `auth_deps.py`; not read for this audit)
- `tests/test_relay_backup_endpoints.py`
- `tests/test_wifi_home_hint_safety.py`
- `tests/test_canvas_api.py`

---

**End of inventory.** Awaiting test-gate approval before proceeding to Chunk 2 (OTA + telemetry implementation).
