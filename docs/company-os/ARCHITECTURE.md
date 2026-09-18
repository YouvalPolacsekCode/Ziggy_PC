# Company OS — Architecture (audit of 2026-09-18)

This is the map of everything Ziggy-the-company runs today, what each piece
stores, how it is deployed, and where the new company operating system plugs
in. It was produced by reading the repositories and the live services, not
from memory. File references are `repo:path:line`.

## 1. The estate

| System | Repo (local path) | Runtime | Data | Public URL |
|---|---|---|---|---|
| **Ziggy hub app** (product) | `ziggy_pc` (`~/ziggy_pc`) | Docker on each customer mini PC: FastAPI `backend/server.py` serves API + built React SPA; HA, Zigbee2MQTT, mosquitto, cloudflared beside it | SQLite files under `user_files/` (auth, permissions, home map) + JSON registries | per home `https://{home_id}.hubs.ziggy-home.com` via tunnel; Canary is `app.ziggy-home.com` |
| **Ziggy relay** (cloud) | `ziggy_pc/relay` | Fly app `ziggy-relay`, region ams, 512 MB, volume `relay_data` | SQLite `/data/relay.db`: homes, users, invites, audit_log, telemetry_raw/daily, OTA, founder_slots, billing columns | `https://ziggy-relay.fly.dev` |
| **Ziggy Desk** | `ziggy-desk` (`~/Code/ziggy-desk`) — no GitHub remote until today; now `YouvalPolacsekCode/ziggy-desk` (private) | Fly app `ziggy-desk`, fra, 512 MB, always on, volume `desk_data` | SQLite `/data/desk.db` (items, revisions, approvals, publications, jobs, conversations, context_docs) + media | `https://ziggy-desk.fly.dev` |
| **Marketing website** | `Documents/Youval Corp./ziggy/website` (subdir of the `YouvalCorp.` monorepo, branch `feat/agentic-os-frontend`) | Fly app `ziggy-website`, fra, nginx static, scale-to-zero | none | `https://ziggy-home.com` |
| **Jeff** (Youval's assistant) | `jeff` (`~/Code/jeff`), UI `jeff-web` | Fly `youval-jeff` (always on, APScheduler in-process), `jeff-web` (Caddy static) | files on `/data` incl. `ziggy/waitlist.json`; git-synced Obsidian brain | `https://youval-jeff.fly.dev`, `https://jeff-web.fly.dev` |
| **GitHub** | `YouvalPolacsekCode/Ziggy_PC` (public), `ziggy-website` (private, separate from the monorepo), `YouvalCorp.`, `ziggy-desk` (new), `Ziggy_Mobile` | — | — | — |
| **DNS / edge** | Cloudflare zone `ziggy-home.com` | tunnels per home, `hubs.` subdomain | — | — |

Other Fly apps in the account are Jeff satellites (`jeff-whatsapp`, `youval-jeff-relay`, `youval-cobalt`, `youval-pot`, `youval-jeff-skills`), `kinetic-surface`, and suspended `yc-*` experiments. None is part of Ziggy's company stack.

## 2. What exists per company function

### Fleet health (OPERATIONS) — exists, good
- Hubs post telemetry every 5 min (`services/telemetry_client.py`, HMAC-signed) with `health` and `deploy` blocks (release tag, cohort, drift).
- Relay judges with a pure function (`relay/app/fleet_health.py`: silence first, then HA reachability, coordinator, mass-lost devices, disk, memory, drift) and auto-repairs safe issues (`relay/app/remediator.py`) with cooldown, caps and audit rows.
- Read API: `GET /api/admin/fleet/health`, `/repairs`, `/activity`, `/api/admin/homes/{id}/telemetry`. Relay-admin JWT; a **monitor** account already exists (`RELAY_MONITOR_EMAIL`/`PASSWORD` secrets on `ziggy-relay`).
- Fleet today: 3 homes (Canary, Tslil, David), all on `release-2026.09.17`, two `degraded` for offline devices.
- UI: `FleetOps.jsx` inside the hub app (founder only), and `scripts/fleet-health.py`.
- Gaps: Fly health check is TCP only; `db_backup` is not scheduled; audit_log has no retention; relay CORS `*`.

### Errors / uptime (SYSTEM HEALTH) — nothing external
- No Sentry, no uptime monitor, no error shipping from hubs, Desk, relay or Jeff. The hub's `error_handler.py` logs tracebacks to a rotating file on the hub only. If `ziggy-relay` goes down, nothing notices.

### Website analytics / user behaviour (MARKETING, PRODUCT) — half-wired
- Live site loads Plausible (`index.html:112`); unknown whether the site is registered in a Plausible account; Plausible is paid and its API is Business-plan only.
- GA4 + Google Ads gtag loader exists but is inert (`VITE_GA_ID`/`VITE_ADS_CONVERSION` empty in `fly.toml`).
- Custom events exist for Define Your Home (`src/define/analytics.js`: `Define View … Define Send Setup`, plus `Waitlist Signup`), sent to Plausible and mirrored to gtag. A dead second taxonomy (`src/lib/defineHomeAnalytics.js`, `DH_*`) is wired only to an unreachable legacy page.
- Hash routes (`#/define`, `#/pricing`) never register as page views. Landing CTAs are untracked. UTM: only `utm_source` read, only at submit time, not persisted.
- Product app: zero analytics; the only product signal is one `onboarding_complete` telemetry extra.
- No consent banner. The privacy policy says "no analytics trackers", which is already untrue (Plausible + a persistent `sid`).

### Leads / CRM (SALES) — a JSON file
- Website waitlist and "Send me this setup" POST `{email, source}` to Jeff `POST /api/webhooks/ziggy/waitlist` (public, no rate limit). Jeff dedupes, appends to `/data/ziggy/waitlist.json`, emails Youval by Gmail SMTP, truncates `source` to 120 chars (loses the Define summary tail).
- No CRM, no ESP, no lifecycle, no double opt-in, no attribution beyond `utm_source`.
- Meta lead-form and comment webhooks land in Jeff (`jeff/ingress/meta_hook.py`) and are filed into the brain by an LLM loop.
- The in-app `/welcome` marketing page's waitlist is a `mailto:` to `hello@ziggy-home.co.il` (wrong TLD, and the address does not exist).

### Marketing ops (MARKETING) — Desk v1
- Desk holds the Instagram (Astra) and Google Ads (Claude) approval queue, cost ledger, calendar, context docs. Instagram publisher is code-complete, credentials pending; Google Ads publisher untested live, developer token pending. Ads budget confirmed ₪46/day.

### Support — nothing
- No help desk. Support is WhatsApp/phone with Tslil and David and SSH support sessions via the relay.

### Revenue — code exists, not live
- Relay `billing/` package: Stripe provider, founder lifetime (cap 30) + standard monthly/annual plans, checkout, webhooks, trial on kit receipt, Israeli invoice numbering, VAT 18 %. **No `STRIPE_*` secrets are set on `ziggy-relay`**, so it is dormant. All three homes are `subscription_state=active` by hand.
- Website checkout is flag-off and points at the destroyed `youval-corp` app.

### Company identity — missing
- `ziggy-home.com` has **no MX and no TXT records**. `hello@ziggy-home.com` (site, JSON-LD, privacy page) cannot receive mail. No Google Workspace. The privacy policy's contact is a personal Gmail.

### Secrets pattern (keep it)
- Every app: Fly secrets (`fly secrets set -a <app>`), read from `os.environ` at import (Desk `desk/config.py`, relay `os.getenv`, Jeff pydantic-settings). Local copies in `~/.ziggy/*.txt` (0600) and `~/.ziggy/desk.env`. `.env` files are git-ignored everywhere; only `ziggy_pc` and `jeff` ship a `.env.example`. Hubs layer `settings.yaml` → `secrets.yaml` → env.

### CI — none
- No GitHub Actions in `Ziggy_PC` (2,115 tests, run by hand), `ziggy-desk` (25 tests), the website, or Jeff. Only `portfolio` has a Pages workflow.

## 3. Target architecture

```
                 ┌──────────────────────── external sources of truth ────────────────────────┐
                 │ GA4 · Search Console · Google Ads · Meta Ads/IG · PostHog · HubSpot ·      │
                 │ Brevo · Freshdesk · Sentry · UptimeRobot · GitHub · Stripe (dormant)      │
                 └──────────────┬────────────────────────────────────────────┬──────────────┘
                                │ read (connectors, cached snapshots)        │ write (outbox, retries)
                                ▼                                            │
 ziggy-home.com ──lead POST──▶ ┌────────────────────── Ziggy Desk ───────────┴────────────┐
 (consent-gated GA4+PostHog)   │ desk/company/                                              │
                               │   connectors/  one adapter per vendor, common interface    │
 Jeff ◀── forward lead ────────│   collectors   scheduled pulls → metric_snapshots          │
 (keeps email alert + brain)   │   leads        lead engine: dedupe, attribution, lifecycle │
                               │   outbox       HubSpot / Brevo / GA4-MP / PostHog / Jeff   │
 ziggy-relay ──fleet health──▶ │   inbox        TODAY items: approvals, leads, incidents    │
 (monitor account, read only)  │ pages: /today /marketing /sales /product /operations       │
                               │        /support /system  (+ existing /instagram /ads …)     │
                               └────────────────────────────────────────────────────────────┘
 hubs ──5-min telemetry──▶ relay ──(server-side)──▶ PostHog  (feature-usage counters, no PII)
```

Design rules:

1. **External services stay the source of truth.** The Desk stores snapshots (`metric_snapshots`), integration status (`integration_runs`), and its own operational objects (`leads` mirror, `inbox`). Nothing in the Desk is the master record of a vendor object except the mapping ids.
2. **Adapters, not vendor coupling.** Every connector implements `Connector.status()` and one or more `fetch_*()`/`push_*()` methods with a plain-dict contract; pages read from snapshot tables only, never from a vendor at request time. Swapping Brevo for MailerLite touches one file.
3. **Independently disableable.** Missing credential → `not_configured`; explicit `COMPANY_DISABLED=hubspot,brevo` → `disabled`. Both show in `/system`.
4. **Writes go through an outbox** with idempotency keys, exponential backoff, a dead-letter state, and a TODAY item when something has failed three times.
5. **Privacy by construction.** Analytics receive pseudonymous ids and event properties only. Email lives in the Desk (`leads`), HubSpot and Brevo; GA4 and PostHog receive `lead_id`, never the address. Hubs never contact a third-party analytics or error vendor; they keep using the relay pipe.
6. **Console layout, Hebrew-first.** A grouped sidebar (Today · Work · Company ·
   Settings), light surfaces, one accent, tables over prose, Ask Desk in the top bar.
   All founder-facing text has a Hebrew twin: `knowledge_he.py` for the knowledge layer,
   `knowledge.dyn()` for code-generated strings, inbox items carry a key + params and
   render per viewer language.
7. **The Desk is the operating system, not an admin panel.** Every page opens with a
   plain-language "what is this page", every number has a "?" from the same registry,
   vendor dashboards are linked but never required. Technical tables sit under
   "Technical details". Today is triaged into ACTION REQUIRED / FYI / AUTOMATIC and
   healthy automations never create items. Company Setup verifies itself where it can
   (a connected service turns green on its own; the mail check reads DNS) and collapses
   into System once complete.
8. **No second automation system.** The three flows planned for n8n (daily digest,
   support mail → Desk, fleet-down alert) run inside the Desk's scheduler and inbox;
   see `N8N_DECISION.md`.
9. **Don't break what works.** The Jeff waitlist endpoint, Youval's signup email, the Instagram/Ads queue, the fleet remediator and the hub telemetry pipe are untouched. The website's lead POST target changes to the Desk, which forwards to Jeff.

## 4. Where new code lives

| Concern | Location |
|---|---|
| Connectors, collectors, lead engine, outbox, inbox, dashboard pages | `ziggy-desk/desk/company/` + templates `desk/templates/company_*.html` |
| Desk schema additions (additive, idempotent) | `ziggy-desk/desk/db.py` `SCHEMA_COMPANY` |
| Tracking spec and site SDK | `ziggy_pc/docs/company-os/TRACKING_SPEC.md`, website `src/lib/analytics/` |
| Website consent banner | website `src/components/Consent.jsx` |
| Sentry init | `ziggy-desk/desk/app.py`, `ziggy_pc/relay/app/main.py`, `jeff/jeff/app.py`, website `src/lib/analytics/sentry.js` |
| Hub feature-usage counters (no PII) | `ziggy_pc/services/usage_counters.py` → `telemetry_client` extra → relay `routers/telemetry.py` → PostHog server-side |
| Bootstrap scripts (run once from the laptop with a main key) | `ziggy-desk/scripts/company/` |
| Knowledge registry (help, setup, ask, flows, services) | `ziggy-desk/desk/company/knowledge.py`; rendered to `KNOWLEDGE.md` by `scripts/company/render_knowledge.py` |
| Today triage, Company Setup, Ask Desk, digest | `ziggy-desk/desk/company/{triage,setup,ask,digest,services_view}.py` |
| CI | `.github/workflows/tests.yml` in `ziggy-desk` and `Ziggy_PC` |

## 5. Known limitations recorded during the audit

- Freshdesk Free has no API; the SUPPORT section documents this and degrades to a Desk-native inbox.
- Plausible cannot feed the Desk without a Business plan; it is replaced.
- Google Ads spend needs an approved developer token; until then the tile says "pending token".
- Revenue has no automated source until Stripe keys exist; the tile is manual + relay subscription counts.
- Hub-side product analytics are counters, not sessions: nothing identifies a person inside a customer home.
