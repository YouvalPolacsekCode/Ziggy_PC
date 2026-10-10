# Company OS — Implementation plan

Ordered so that every step ships something usable on its own and nothing waits
on a credential that may take days. Steps marked **[needs Youval]** can be
built and tested with fakes but only go live after the checklist item.

## Phase 1 — Audit (done 2026-09-18)
Outputs: `ARCHITECTURE.md`, `INTEGRATIONS.md`, this plan, `SETUP_CHECKLIST.md`,
`STATUS.md`. Side effect: `ziggy-desk` now has a private GitHub remote.

## Phase 2 — Human setup checkpoint
One checklist (`SETUP_CHECKLIST.md`) with every account / verification /
OAuth / key Youval must produce. Nothing in it is something I can generate.

## Phase 3 — Tracking foundation
1. `TRACKING_SPEC.md`: canonical event names, required properties, identity
   rules, consent rules, what goes to which vendor.
2. Website `src/lib/analytics/`: one `track()` that fans out to GA4 (gtag,
   Consent Mode v2) and PostHog (EU host), replaces the two old taxonomies,
   fires `page_view` on hash routes, captures and persists UTM/gclid/fbclid/
   referrer/landing page on first touch (`localStorage['ziggy-attr']`),
   emits `cta_clicked` from Nav/Hero/PriceAnchor/MobileCTA, and maps the
   Define events to the canonical names.
3. Consent banner (`src/components/Consent.jsx`, Hebrew-first): analytics off
   until accepted; PostHog runs cookieless/`persistence: memory` before
   consent; Plausible removed.
4. Privacy policy updated to describe analytics, the lead pipeline and its
   processors; footer links to it.
5. Hub app: `services/usage_counters.py` (feature-usage counters, no PII)
   shipped inside the existing 5-minute telemetry post; relay forwards to
   PostHog server-side **[needs Youval: PostHog key]**.

## Phase 4 — Lead engine (Desk)
1. Schema: `leads`, `lead_events`, `outbox`, `integration_runs`,
   `metric_snapshots`, `inbox`, `revenue_entries`.
2. `POST /api/leads` on the Desk: public, CORS limited to the site origins,
   honeypot + per-IP token bucket, validates email, computes `lead_id`,
   dedupes by email, stores attribution, then enqueues outbox jobs:
   `jeff.forward` (keeps today's email alert), `hubspot.upsert`,
   `brevo.contact`, `ga4.mp_event(lead_created)`, `posthog.capture`.
3. Outbox worker inside the Desk scheduler loop: idempotency keys, backoff
   1 m → 5 m → 30 m → 2 h, dead-letter after 6 attempts → TODAY item.
4. Website switches `VITE_WAITLIST_ENDPOINT` to the Desk; Define's summary is
   sent as structured fields, not a truncated string.
5. One-time import of Jeff's `waitlist.json` into `leads` (+ HubSpot when
   the token exists).
6. `/sales` page: pipeline by stage (from HubSpot snapshot), new leads,
   source breakdown, conversion; stage changes are made in HubSpot and
   mirrored by the collector. Manual stage override in the Desk writes back
   through the outbox.

## Phase 5 — Observability
1. Sentry SDK in Desk, relay, Jeff (server) and website (browser, after
   consent). Env `SENTRY_DSN` gates it. **[needs Youval: DSNs]**
2. Relay: switch Fly check to HTTP `/health`; schedule `db_backup --once`
   nightly inside the relay lifespan (it is documented but not scheduled).
3. UptimeRobot monitors created by script **[needs Youval: key]**.
4. Hub error digest: `errors_last_5m` + top exception types in telemetry;
   relay adds an `error_burst` fleet-health issue; the Desk shows it.
5. `/system` page: uptime, Sentry unresolved issues by project, integration
   runs, outbox dead letters, n8n failed executions, GitHub open PRs.

## Phase 6 — Ziggy Desk dashboard
Pages `/today`, `/marketing`, `/sales`, `/product`, `/operations`,
`/support`, `/system`, all reading snapshot tables; a `refresh` action per
section triggers the collector for that section. Existing pages keep their
routes; the nav gains a "Company" group. Everything bilingual (Hebrew
default) like the rest of the Desk. TODAY = open `inbox` items (Instagram/Ads
approvals, new leads, integration failures, fleet incidents, Sentry bursts,
support escalations) with acknowledge/done.

## Phase 7 — Automation
- Code (Desk scheduler): lead fan-out; fleet `down` or `error_burst` →
  TODAY item + webhook; Sentry new issue with ≥ 10 events → TODAY item;
  daily 07:00 collectors for GA4/GSC/Ads/Meta/PostHog/HubSpot/Brevo;
  Meta token expiry warning.
- n8n (`ziggy-n8n` on Fly) for hand-editable flows: daily Hebrew digest to
  the notify webhook, support-mail → Desk inbox, ad-hoc imports. Workflow
  JSON versioned in `ziggy-desk/n8n/workflows/`. **[needs Youval: confirm
  the machine, create the owner account]**

## Testing
- Desk: pytest with fake connectors (same pattern as the existing
  `FakePublisher`); acceptance tests for: lead dedupe + attribution, outbox
  retry/dead-letter, consent gating in the site SDK (vitest), collectors
  producing snapshots from recorded fixtures, pages rendering with every
  connector `not_configured`.
- CI: GitHub Actions running `pytest` on `ziggy-desk` and `Ziggy_PC` on push.

## Non-goals (explicitly out)
- Replacing the Desk's approval queue, the relay's fleet logic, Jeff's loops,
  or the hub telemetry format.
- Sending customer-home data (device names, addresses, hub logs) to any
  analytics vendor.
- Building billing UI before Stripe is switched on.
