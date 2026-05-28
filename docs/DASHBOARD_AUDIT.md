# Admin Dashboard — Audit & Gap Plan (Prompt 10 Chunk 1)

Generated: 2026-05-28. Read-only audit; no code touched.

Scope: cross-reference what the **existing operator dashboard** does today
against everything Prompts 2 / 4 / 7 / 8 / 9 have shipped to the relay and
edge agent, then propose a per-gap fix — extend in place, add a new page,
or surface as a backing endpoint first.

The dashboard the founder asked about is the **`/ops` console**
([frontend/src/pages/AdminConsole.jsx](../frontend/src/pages/AdminConsole.jsx)
plus its sub-pages), role-gated to `super_admin`. It is NOT
[frontend/src/pages/Dashboard.jsx](../frontend/src/pages/Dashboard.jsx) —
that file is the consumer home screen at `/` and is out of scope for this
prompt.

---

## A. Current state — what exists today

### A.1 Tech stack (verified)

| Layer | Library / convention |
|------|---------------------|
| Framework | React 18 + Vite 5 ([frontend/package.json](../frontend/package.json)) |
| Routing | react-router-dom v6 lazy routes ([frontend/src/App.jsx:13-37](../frontend/src/App.jsx#L13-L37)) |
| State | Zustand stores ([frontend/src/stores/](../frontend/src/stores/)) |
| Styling | Inline styles using CSS variables (`--ink`, `--bg`, `--bg-2`, `--surface`, `--line`, `--accent`, `--ok`, `--warn`, `--ink-mute`, `--ink-faint`); a handful of Tailwind classes in older AdminSettings sections |
| Icons | `lucide-react` |
| Animations | `framer-motion` |
| i18n | `useT()` hook + `frontend/src/lib/i18n/{he,en}.js` — every UI string must have a key (RTL Hebrew is the primary language) |
| Toasts | `useUIStore().addToast(msg, level)` |
| Auth | `useAuthStore().role === 'super_admin'` gates `/ops/*` ([frontend/src/App.jsx:55-59](../frontend/src/App.jsx#L55-L59)) |
| API client | `frontend/src/lib/api.js` — backend at same origin; relay at `localStorage.ziggy_relay_url` via the `relay*` helpers ([frontend/src/lib/api.js:422-465](../frontend/src/lib/api.js#L422-L465)) |
| Shared shell | `OpsPageWrapper` puts a breadcrumb back to `/ops` on every sub-page ([frontend/src/App.jsx:61-97](../frontend/src/App.jsx#L61-L97)) |

### A.2 Routes (admin / ops only)

| Route | Component | Purpose | State |
|-------|-----------|---------|-------|
| `/ops` | [AdminConsole.jsx](../frontend/src/pages/AdminConsole.jsx) | Landing page — 4 ToolCard entries | Working |
| `/ops/debug` | [DebugPage.jsx](../frontend/src/pages/DebugPage.jsx) | Live event bus + simulate intent + self-test + export | Working, polished |
| `/ops/cloud` | [CloudAdmin.jsx](../frontend/src/pages/CloudAdmin.jsx) | Multi-home manager: relay login, list homes (local + relay), user / invite mgmt, provision / deprovision | Working |
| `/ops/ha-update` | [HAUpdate.jsx](../frontend/src/pages/HAUpdate.jsx) | HA upgrade risk analysis **for the local kit only** | Working, but local-only |
| `/ops/features` | [FeatureFlags.jsx](../frontend/src/pages/FeatureFlags.jsx) | 9 feature toggles for **this home** | Working |
| `/admin` (inside AppShell) | [AdminSettings.jsx](../frontend/src/pages/AdminSettings.jsx) | Per-home settings: push prefs, MQTT, SMTP, Ollama, pattern learning, API keys | Working |

### A.3 Data sources actually wired up

`CloudAdmin.jsx` is the only place that already speaks to the **relay**.
It calls:

- `relayListHomes` → `GET /api/homes/` ([relay/app/routers/homes.py:173](../relay/app/routers/homes.py#L173)) — returns `id, name, type, tunnel_url, status, created_at, owner_email, user_count` per home. No subscription / telemetry / OTA / cohort / tunnel-health fields.
- `relayGetHome` → `GET /api/homes/{id}` — adds the users list, strips `relay_secret`.
- `relayProvision` / `relayDeprovision` / `relayProvStatus` — kick off Fly.io provisioning.
- `relayCreateInvite` / `relayListInvites` / `relayRevokeInvite` — invite flow.
- `relayLogin` — separate JWT login against the relay.

The other ops pages talk to the **local backend** only (this home's HA,
this home's debug bus, this home's feature flags). Nothing reads
telemetry/OTA/audit/billing/founder-slots from the relay.

### A.4 What's good

- Solid auth gate + breadcrumb shell — adding a new `/ops/<thing>` page is one line in [App.jsx:310-324](../frontend/src/App.jsx#L310-L324) plus a new ToolCard in AdminConsole.
- `CloudAdmin.jsx`'s `HomeCard` is already the right surface for per-home detail — it's expandable, has user/invite management, and treats local + relay homes uniformly. Per-device drill-in (Chunk 2) should extend this card or open a dedicated detail page from it, not replace it.
- `DebugPage.jsx`'s WS-driven live feed + side-panel-detail pattern is reusable for telemetry / audit-log viewers.
- The relay-side surface for Prompts 2, 4, 8, 9 is **already richer than the dashboard exposes** — most gaps below are frontend-only.

### A.5 What's rough / missing on the existing pages

- `relayListHomes` SQL ([relay/app/routers/homes.py:178-183](../relay/app/routers/homes.py#L178-L183)) doesn't return `subscription_state`, `cf_tunnel_id`, `ota_pinned_release_id`, or any telemetry summary. Every fleet-level chart needs those fields. **Chunk 2 task.**
- `CloudAdmin.jsx` shows `home.status === 'active'` as the only health pill — no traffic-light, no last-heartbeat, no telemetry-driven yellow/red.
- `HAUpdate.jsx` reads the local backend only. A fleet-wide view of "which home is on which HA version" should NOT live in this page (it would conflate the local kit's update with the fleet); it goes in the new fleet view.
- `FeatureFlags.jsx` toggles features on the local home only. **Out of scope** for the rescoped Prompt 10 — leave it alone.
- `AdminSettings.jsx` is per-home (push prefs for *this user's* browser). The new "push delivery success rates per home" view is a different thing entirely (fleet-wide); don't conflate.

---

## B. Gap analysis — Prompts 2 / 4 / 7 / 8 / 9 surfaces

Each row: **what was built** (relay/edge), **what the dashboard exposes today**, **the gap**, **whether the backing data is already there**.

| # | Capability | Relay / edge endpoint(s) | Dashboard today | Gap | Backing data exists? |
|---|------------|--------------------------|----------------|-----|---------------------|
| 1 | **Fleet list with per-home subscription state** | `homes.subscription_state` column ([relay/app/billing/__init__.py:22-101](../relay/app/billing/__init__.py)) | Status pill is just `home.status === 'active'`. No billing info. | Expose `subscription_state`, `kit_received_at`, `plan_id`. | Yes — column exists, just not returned by `GET /homes/`. **Tiny relay PATCH needed.** |
| 2 | **Per-home Cloudflare Tunnel status** | `homes.cf_tunnel_id` + `homes.tunnel_url` + `GET /homes/{id}/health` ([relay/app/routers/homes.py:235-258](../relay/app/routers/homes.py#L235-L258)) | Health is shown only in the local CloudAdmin pill (`haConnected`), never for relay homes. | Show tunnel URL, last-checked, hub `/health` result, last heartbeat. | Yes — `relayHealthHome()` client exists ([api.js:452](../frontend/src/lib/api.js#L452)) but is unused. Just call it. |
| 3 | **Telemetry: HA version, Ziggy version, uptime, disk/CPU/mem, sensor count + battery, container health, last automation** | `POST /api/devices/{id}/telemetry`, `GET /api/admin/homes/{id}/telemetry`, `GET /api/admin/homes/{id}/telemetry/days` ([relay/app/routers/telemetry.py](../relay/app/routers/telemetry.py)) | Nothing reads telemetry. | New per-device drill-in page consuming both endpoints; fleet view aggregates `latest.payload` summaries. | Yes — full surface ready. **Frontend-only.** |
| 4 | **Traffic-light health** (green/yellow/red across the fleet) | Derived from telemetry recency + payload fields + tunnel health | Not present. | New fleet view component. Suggested thresholds: red = no telemetry in 30 min OR `health()` failed; yellow = disk_pct > 80 OR any sensor battery < 10% OR ziggy_version < latest by more than N releases; green otherwise. | Yes — telemetry rows are timestamped per-home. **Frontend-only.** |
| 5 | **OTA releases catalog + admin publish** | `GET/POST /api/admin/ota/releases` ([ota.py:300-353](../relay/app/routers/ota.py#L300-L353)) | Not exposed. | New OTA page: list releases, publish new release, view per-release image digests + notes. | Yes. **Frontend-only.** |
| 6 | **Per-home OTA pin + cohort assignment + staged rollouts** | `GET/PUT /api/admin/homes/{id}/ota-pin`; `GET/POST /api/admin/ota/cohorts`; `PUT /api/admin/homes/{id}/cohort` ([ota.py:360-557](../relay/app/routers/ota.py)) | Not exposed. | Pin home → release (chooser on per-device detail page); cohort CRUD; assign home to cohort. | Yes. **Frontend-only.** |
| 7 | **Founder slot counter** | `GET /api/billing/founder-slots/remaining` (public, no auth) ([billing/public.py:111](../relay/app/billing/public.py#L111)) + `founder_slots` table | Not exposed. | Widget in fleet view header showing `N of 30 founder slots remaining`. For "which homes hold which slots" we currently have only the table; need a small admin endpoint. | Mostly — `remaining` exists. Per-slot-holder listing needs a new relay endpoint (single GET, trivial). |
| 8 | **Backup status + last_backup_at + restore events** | `GET /homes/{id}/backup-status`, `POST /homes/{id}/restore-events`, `home_backup_keys` table ([relay/app/routers/backup_keys.py](../relay/app/routers/backup_keys.py)) | Not exposed. | Per-device detail tab: last backup timestamp, key-seal state, restore-event log; "unseal key" button (logged). | Yes. **Frontend-only.** |
| 9 | **Audit log viewer** | `audit_log` table written from many code paths ([relay/app/audit.py:27-53](../relay/app/audit.py#L27-L53)) | Not exposed. | New `/ops/audit` page with filters (event, home_id, ok/fail, date range). | Partially — table exists but **no HTTP read endpoint yet.** Needs one small relay GET endpoint. |
| 10 | **Paired mobile devices per home + last_seen + push token status** | Local backend: `GET /api/mobile/devices` ([backend/routers/mobile_router.py:246](../backend/routers/mobile_router.py#L246)). Relay has no admin proxy. | Local: settings page shows the user's own paired phones ([MobileDevicesList.jsx](../frontend/src/components/MobileDevicesList.jsx)). No fleet view. | Per-device detail tab listing mobile devices for that home. | Local backend works; relay needs an admin endpoint that proxies through `/proxy/{home_id}/api/mobile/devices` with founder bypass (already exists for tunnel — see Prompt 9 decision 8). |
| 11 | **Push delivery success rates per home, per channel (APNs / FCM / WebPush)** | Backend send happens via web-push library + `/api/push/test`. **No success/failure log is persisted anywhere I can find.** | Not exposed. | New per-home stat block: 24h / 7d send count, fail count, last-fail reason. | **No — instrumentation missing.** Needs: backend logs each send result to a new table, posts daily aggregate to relay (or relay aggregates from telemetry). **Largest backing-data gap of any item.** |
| 12 | **One-click "open support tunnel" (founder SSH via Cloudflare Tunnel)** | Tunnel itself exists per-home; founder SSH path was **Prompt 5 — DEFERRED** ([CLAUDE_CODE_PROMPTS.md:102-104](../../Documents/Claude/Projects/Ziggu/CLAUDE_CODE_PROMPTS.md#L102-L104)) | Not exposed. | Per-device detail action "Open support tunnel" with user notification confirmation + audit log entry. | **Backing infrastructure is partial.** Founder bypass exists in `proxy.py` (Prompt 9 decision 8). SSH access via the Cloudflare Tunnel is documented in `RUNBOOK_HETZNER_MIGRATION.md` as a founder-manual step. A one-click flow requires: relay endpoint that publishes an SSH key to the per-home tunnel, sends a user-visible notification, and writes audit. Doable but **non-trivial** — calls for its own sub-chunk. |

Notes on the prompt order: per [CLAUDE_CODE_PROMPTS.md:267-272](../../Documents/Claude/Projects/Ziggu/CLAUDE_CODE_PROMPTS.md#L267-L272), Prompt 5 (SSH support tunnel) is "post-launch." The rescoped Prompt 10 does ask for the one-click button — but the founder must decide whether to build the underlying tunnel flow now or stub the button as "manual: see runbook" and unblock the rest of Chunk 3.

---

## C. Plan — per-gap proposal

Recap of the operator briefing: **3 chunks**, stop after each. No new framework. Reuse `OpsPageWrapper`, ToolCard, Card, RoleBadge, CSS vars, i18n keys, addToast.

### Chunk 2 — Fleet view + per-device drill-in + OTA control

| Sub-task | Type | Files touched | Backing-data work | Notes |
|----------|------|---------------|-------------------|-------|
| **2.1** Add `subscription_state`, `cf_tunnel_id`, `ota_pinned_release_id`, `last_seen_ts` (from telemetry MAX) to `GET /api/homes/` response. | Relay PATCH | [relay/app/routers/homes.py:173-184](../relay/app/routers/homes.py#L173-L184) | Single SQL change. Additive — existing CloudAdmin caller ignores extra fields. | Tiny commit. |
| **2.2** Add `getFleetTelemetrySummary` client helper + per-home telemetry-latest fetch. | Client | [frontend/src/lib/api.js:449-460](../frontend/src/lib/api.js#L449-L460) (relay block) | Calls existing telemetry GET endpoints. | Pure addition. |
| **2.3** New page `/ops/fleet` — `FleetView.jsx` with traffic-light list. Each row links to drill-in. | New page | New file + register route in [App.jsx:310-324](../frontend/src/App.jsx#L310-L324). | Add ToolCard in AdminConsole. | Greenfield page using existing CSS vars. |
| **2.4** Per-device drill-in `/ops/fleet/:homeId` — `DeviceDetail` operator page. Tabs: Overview (telemetry latest), History (daily aggregates), OTA (pin/cohort), Backup (status + last restore), Users (link to CloudAdmin section). | New page | New file. | Reuses Card, RoleBadge, OpsPageWrapper. | Drill-in is opened from FleetView rows AND from CloudAdmin's HomeCard expand-arrow as a secondary entrypoint, so existing CloudAdmin UX isn't broken. |
| **2.5** OTA control page `/ops/ota` — list releases, publish form, cohort list, cohort upsert form. Per-home pin sits on the device drill-in page (2.4), not here. | New page | New file. | Reuses Card. | Pure additions; no impact on edge agent or release pipeline (the relay endpoints are write-already). |
| **2.6** Founder-slot widget in FleetView header. | Component | Inside FleetView. | Uses public `/api/billing/founder-slots/remaining`. | If founder wants the per-slot-holder list, also add `GET /api/admin/founder-slots` to relay (one short handler). |
| **2.7** Health rule constants — keep in one file (`frontend/src/lib/fleetHealth.js`) so thresholds are reviewable in one place. | New file | New file. | Pure JS — no API. | Documented in DECISIONS.md if thresholds change. |

Commits: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6+2.7 — six independently shippable.

### Chunk 3 — Per-user view + support tunnel + audit log + push/mobile stats

| Sub-task | Type | Files touched | Backing-data work | Notes |
|----------|------|---------------|-------------------|-------|
| **3.1** Audit log read endpoint `GET /api/admin/audit-log` on relay with filters: `event`, `home_id`, `ok`, `since`, `until`, `limit`. | Relay add | New handler in [relay/app/audit.py](../relay/app/audit.py) or a new `relay/app/routers/audit.py`. | Reads existing `audit_log` table; `idx_audit_event` + `idx_audit_home` indexes already present. | Mirrors telemetry-read pattern. |
| **3.2** Audit log viewer `/ops/audit` — table with filters, side-panel for `detail` blob. | New page | New file. | Reuses DebugPage's filter-sidebar + EventRow patterns where they fit. | Easy reuse. |
| **3.3** Per-user view — a tab inside CloudAdmin's existing HomeCard expansion. Shows: account email, subscription, devices owned (link to drill-in 2.4), support session count from audit_log. | Edit existing page | [CloudAdmin.jsx](../frontend/src/pages/CloudAdmin.jsx) HomeCard internals only. | Reads audit_log via 3.1 endpoint. | **Extend in place — no rebuild.** |
| **3.4** Paired mobile devices per home — admin proxy endpoint `GET /api/admin/homes/{id}/mobile-devices` on relay that forwards via `/proxy/{home_id}/api/mobile/devices` with founder bypass. Render as a tab on the drill-in page (2.4). | Relay add + client | Relay router + api.js helper. | Reuses founder-bypass mechanism (Prompt 9 decision 8). | Per-home drill-in is a logical home; reuses the existing MobileDevicesList shape. |
| **3.5** Push delivery instrumentation — **decision needed** (see C.1 below). | TBD | Backend + relay | New table or in-process counter; aggregate to relay. | Largest single backing-data gap; founder picks scope. |
| **3.6** One-click support tunnel — **decision needed** (see C.2 below). | TBD | Relay + backend | Depends on chosen scope. | Prompt 5 is post-launch; this can be stubbed. |

Commits: 3.1, 3.2, 3.3, 3.4, then 3.5 + 3.6 conditionally on founder decisions.

### Out of scope / leave alone

- `Dashboard.jsx` (consumer home page) — NOT the admin dashboard.
- `Hub.jsx`, `MobileOnboarding.jsx` — parallel mobile work; do not touch (per system reminder).
- `FeatureFlags.jsx` — per-home toggles, not a fleet surface.
- `AdminSettings.jsx` — per-user push prefs, not fleet push delivery.
- `HAUpdate.jsx` — local kit only; staged-rollout HA pinning happens in 2.5 (OTA releases), not by extending this page.
- Billing logic, voice, backup engine, HA pinning — read surfaces only, per operator brief.

---

## C.1 Decision needed — push delivery instrumentation

**Today:** backend's web-push send (and any future APNs/FCM) is fire-and-forget. There's no log of "we tried to send X to home Y at time T, result was success/HTTP 410-gone/etc." Without it, no stats can be aggregated.

**Three options:**

1. **Minimal (recommended for v1):** add a `push_send_log` table on the **edge backend** (one row per send, retained 7 days). The edge's telemetry payload already runs every 5 min — extend it with a `push_24h: {sent, failed, gone}` summary. Relay stores it inside `telemetry_raw.payload` (no schema change). Dashboard reads from the latest telemetry row. **Pros:** zero schema work on relay; instrumentation lives at the source. **Cons:** if the edge is offline, no stats; granularity is 24h totals not per-channel-per-day.
2. **Relay-side aggregate:** edge POSTs send-results to a new relay endpoint `POST /api/devices/{id}/push-events` (HMAC-signed like telemetry). Relay stores rows in a new `push_events` table. Dashboard queries `GET /api/admin/homes/{id}/push-stats?window=24h|7d`. **Pros:** preserves history, per-channel breakdown. **Cons:** new relay table + retention rule + admin endpoint.
3. **Defer:** mark this section "Coming soon" in the dashboard. Don't build instrumentation until we have an actual push channel beyond WebPush.

My recommendation: **option 1** for Chunk 3. Cheap enough to ship now; can swap to option 2 in v1.1 when APNs/FCM land.

## C.2 Decision needed — one-click support tunnel

**Today:** founder SSH into a home is a manual operation per `RUNBOOK_HETZNER_MIGRATION.md` (Prompt 5 status: post-launch deferred). The rescoped Prompt 10 brief asks for a "one-click open support tunnel" button. The button needs:

1. A relay endpoint to mark "founder support session open" — writes `support_session_opened` to audit_log.
2. A user-visible notification on the home's app/web ("Ziggy support has opened a temporary connection" with revoke button).
3. The actual SSH path — currently done by the founder running a `cloudflared` command locally, NOT by the relay.

**Three options:**

1. **Stub for v1:** the button writes audit + sends the user notification, and shows the founder the exact shell command from `RUNBOOK_HETZNER_MIGRATION.md`. No backend automation. **Pros:** unblocks Chunk 3, keeps audit trail. **Cons:** founder still has to copy-paste a command.
2. **Half-automation:** relay endpoint publishes founder SSH pubkey to the per-home Cloudflare Tunnel via `cf-access-cli`, sets a TTL, writes audit. Founder still launches their own `ssh` command. **Pros:** no manual key shuffling. **Cons:** new relay-side work + auth/role handling.
3. **Full Prompt-5 build:** auto-open a WebSSH terminal in the dashboard (xterm.js in the browser). **Pros:** truly one-click. **Cons:** large; this is Prompt 5 in full.

My recommendation: **option 1** for v1, with the audit + notification + runbook-snippet UI. Revisit options 2/3 post-launch as part of full Prompt 5.

---

## D. Risks + assumptions

1. **Relay deployment cadence.** Sub-tasks 2.1, 3.1, 3.4 require pushing relay code. Founder must be willing to redeploy Fly.io during this work. If not — those tasks split into a "frontend-ready, awaiting relay deploy" state and the dashboard pages render placeholders until the relay catches up.
2. **Assumption: `GET /homes/` is consumed only by `CloudAdmin.jsx`.** I grep-confirmed `relayListHomes` has one caller. Adding fields is therefore safe. If the mobile app also calls this, it'd ignore unknown fields (JSON additive) — still safe.
3. **Assumption: founder JWT obtained by `relayLogin` carries `role: 'relay_admin'`.** Verified by reading `require_role("relay_admin")` usage in [provision.py:35](../relay/app/routers/provision.py#L35) and the existing successful flow. If a fresh founder login is needed, the existing `connectRelay` panel in CloudAdmin handles it.
4. **i18n burden.** Every new page needs Hebrew + English strings. Estimate: ~40-60 new keys for Chunk 2, ~30 for Chunk 3.
5. **No new dependencies.** Everything in this plan uses libraries already in package.json. No charts library needed — fleet view uses native CSS bars/dots; per-device telemetry uses a simple sparkline component (one file, ~50 lines) rather than recharts/visx.

---

## E. What I want approved before writing any code

1. **Plan structure** above — fleet + drill-in + OTA in Chunk 2; per-user (extend CloudAdmin) + audit log + push stats + support tunnel in Chunk 3.
2. **Relay PATCHes are OK** — sub-tasks 2.1, 3.1, 3.4 (plus optional founder-slot admin endpoint) touch relay code. Each is single-file, additive, with audit + auth in line with existing patterns.
3. **Decision on C.1 (push instrumentation)** — pick option 1, 2, or 3.
4. **Decision on C.2 (one-click support tunnel)** — pick option 1, 2, or 3.
5. **Per-device drill-in lives at `/ops/fleet/:homeId`** (Chunk 2 task 2.4); CloudAdmin's HomeCard gains a "Drill in →" link but is otherwise untouched. Confirm this is the right reconciliation with the existing page.

I stop here until founder approves these five points. No frontend code will be written during Chunk 1.
