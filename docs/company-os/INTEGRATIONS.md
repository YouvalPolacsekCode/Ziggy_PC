# Company OS — Integrations

Every external service the Ziggy company stack talks to, what it is used for,
which credential it needs, where that credential lives, and what the free tier
does and does not allow. External services are the source of truth; Ziggy Desk
is the visibility and control layer.

Rules that apply to every integration below:

- Credentials are Fly secrets on the app that uses them (`fly secrets set -a <app>`),
  never in git. Names are documented in `.env.example` of each repo.
- Every Desk connector is **independently disableable**: an unset credential means
  the connector reports `not_configured` and the Desk section shows that honestly.
- Every connector call is recorded in the Desk's `integration_runs` table
  (ok / error / rate-limited, duration, last success), and outbound writes go
  through the `outbox` table with retry and backoff.
- Least privilege: read-only keys wherever the Desk only reads.

---

## Decision: Brevo over MailerLite (marketing automation)

Compared 2026-09-18 (sources: Brevo help centre "What are the limits of the Free
plan", MailerLite "Free plan update FAQ").

| | **Brevo (chosen)** | MailerLite |
|---|---|---|
| Free contacts | up to 100,000 stored | 250 active subscribers (cut from 500 on 2026-06-16) |
| Free sends | 300 emails / day | 2,500 emails / month |
| Automations on free | yes (marketing automation up to 2,000 contacts) | 3 automations |
| API on free | full REST v3 (contacts, lists, transactional, DOI) | yes, but the 250-subscriber cap binds first |
| Transactional email | included (same API) | separate product |
| Double opt-in via API | `POST /v3/contacts/doubleOptinConfirmation` | form-based |
| Branding on free | Brevo logo in emails | MailerLite logo in emails |

The waitlist already holds more than 250 addresses is not known, but a launch
campaign will pass it fast. 250 subscribers is a hard ceiling that would force a
paid plan on day one of Ads; Brevo's 300/day is a throttle, not a ceiling. Brevo
also gives transactional email (lead confirmation, DOI) on the same key.

---

## Service catalogue

### Google Workspace (`ziggy-home.com`)

- **State found:** the domain has **no MX records and no TXT records** at all
  (checked with `dig` 2026-09-18). `hello@ziggy-home.com` appears on the website,
  in JSON-LD and in the privacy policy but cannot receive mail. DNS is on
  Cloudflare (`nova`/`bruce.ns.cloudflare.com`).
- **Used for:** the company mailbox, Search Console / GA4 / Ads ownership under a
  company identity rather than a personal Gmail, Drive for shared docs, Calendar.
- **Needs from Youval:** sign up for Workspace, then either paste the MX/TXT
  records into Cloudflare or give the Desk a Cloudflare API token with
  `Zone.DNS:Edit` on the `ziggy-home.com` zone so the records can be written by
  script (`scripts/company/cloudflare_dns.py`). The existing relay token only has
  `Tunnel:Edit` and cannot do this.
- **Stored:** `CLOUDFLARE_DNS_TOKEN` (Desk Fly secret, optional).
- **Limitation:** Workspace is paid (Business Starter). There is no free tier.
  Alternative kept open: keep a Cloudflare Email Routing forward for
  `hello@ziggy-home.com` → Gmail (free) and use a personal Google account for
  analytics ownership. The checklist offers both.

### Bitwarden (shared credentials)

- **Used for:** the human-readable copy of every credential below, in a
  "Ziggy" organisation collection shared with Tslil. No code integration.
- **Needs from Youval:** create the org, invite Tslil. Nothing to store in code.

### Plausible (already on the site)

- **State found:** `plausible.io/js/script.js` is loaded on ziggy-home.com with
  `data-domain="ziggy-home.com"`. Whether the site exists in a Plausible account
  is not verifiable from outside (the ingest endpoint answers 202 either way).
  Plausible has no free tier and its Stats API is a Business-plan feature, so it
  cannot feed the Desk for free.
- **Decision:** PostHog replaces Plausible as the product-analytics source and
  GA4 as the acquisition source. The Plausible tag is removed from the site in
  the tracking-foundation change unless Youval says he is paying for it.

### Google Analytics 4

- **Used for:** acquisition reporting (sessions, sources, campaigns, landing
  pages, key events) and Google Ads conversion import.
- **Site side:** the gtag loader already exists in the website's `index.html`,
  inert until `VITE_GA_ID` is set in the website `fly.toml [build.args]`.
- **Desk side:** GA4 Data API `runReport` on the property, read with a service
  account added as **Viewer** on the property. Scope
  `https://www.googleapis.com/auth/analytics.readonly`.
- **Server-side events:** Measurement Protocol
  `POST https://www.google-analytics.com/mp/collect?measurement_id=…&api_secret=…`
  is used by the lead engine to record `lead_created` even when the browser
  did not fire it (ad blockers).
- **Needs from Youval:** create the GA4 property, give me the `G-…` measurement
  ID, create a Measurement Protocol API secret, add the service account email
  as Viewer.
- **Stored:** website build arg `VITE_GA_ID`; Desk secrets `GA4_PROPERTY_ID`,
  `GA4_MEASUREMENT_ID`, `GA4_API_SECRET`, `GOOGLE_SERVICE_ACCOUNT_JSON`.
- **Consent:** GA4 loads only after the visitor accepts analytics in the consent
  banner (Consent Mode v2 defaults are `denied`).

### Google Search Console

- **Used for:** queries, clicks, impressions, position for ziggy-home.com in
  the Desk MARKETING section.
- **API:** `POST https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query`
  with `siteUrl = sc-domain:ziggy-home.com`; scope `webmasters.readonly`;
  the same service account is added as a user on the property.
- **Needs from Youval:** verify the domain property (DNS TXT), add the service
  account as a Restricted user.
- **Stored:** `GSC_SITE_URL` (Desk), same `GOOGLE_SERVICE_ACCOUNT_JSON`.

### Google Ads

- **State found:** the Desk already has a REST v18 publisher
  (`desk/publishers/google_ads.py`) for changes, untested live; customer ID
  `577-694-4405` is set; developer token pending Google review.
- **Used for:** daily spend, clicks, conversions, cost per lead (GAQL
  `customer` / `campaign` metrics) for the MARKETING section.
- **Needs from Youval:** the developer token (once approved), OAuth client +
  refresh token (the checklist has the exact steps with the OAuth playground).
- **Stored:** `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`,
  `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`,
  `GOOGLE_ADS_CUSTOMER_ID` (already set), `GOOGLE_ADS_LOGIN_CUSTOMER_ID`.
- **Limitation:** a Basic-access developer token is enough for one's own
  account; until Google approves it every call returns `DEVELOPER_TOKEN_NOT_APPROVED`.

### Meta (Facebook / Instagram) Ads and Instagram publishing

- **State found:** the Desk already publishes to Instagram via the Graph API
  (`IG_ACCESS_TOKEN`, `IG_USER_ID` still pending). Jeff receives Meta lead-form
  and comment webhooks (`jeff/ingress/meta_hook.py`).
- **Used for:** ad account spend and results (`GET /v25.0/act_{id}/insights`,
  permission `ads_read`), Instagram follower count and recent post reach for
  the social status tile.
- **Needs from Youval:** a Meta app (or the existing one), a **System User**
  token with `ads_read`, `instagram_basic`, `instagram_content_publish`,
  `pages_read_engagement`; the Ad Account ID.
- **Stored:** `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `IG_USER_ID`,
  `IG_ACCESS_TOKEN`.
- **Limitation:** long-lived user tokens expire after 60 days; a System User
  token does not. The Desk records token expiry and raises a TODAY item 7 days
  before.

### PostHog (product and website analytics)

- **Free tier (2026):** 1M events, 5k session recordings, 1M feature-flag
  requests, 100k error events per month. EU cloud available
  (`eu.i.posthog.com`), which is the right region for an Israel/EU audience.
- **Site side:** `posthog-js` on ziggy-home.com with autocapture off,
  `capture_pageview: false` (we send `page_view` ourselves on hash routes),
  session replay on after consent, `person_profiles: 'identified_only'`.
- **Product side:** the hub app gets an opt-in, privacy-preserving event
  emitter (feature usage counts, no PII) that ships via the existing relay
  telemetry pipe; the relay forwards to PostHog server-side. The hub itself
  never talks to PostHog.
- **Desk side:** `POST /api/projects/{id}/query` with `HogQLQuery` /
  `TrendsQuery` / `FunnelsQuery` using a **personal API key** with Query Read
  scope. Limits: 240 requests/min, 3 concurrent, 10 s per query.
- **Needs from Youval:** create the project on EU cloud, give me the project
  API key (public, goes in the site bundle), the project ID and a personal API
  key with `query:read`.
- **Stored:** website build arg `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`; Desk
  secrets `POSTHOG_PROJECT_ID`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_HOST`;
  relay secret `POSTHOG_PROJECT_KEY` (server-side capture).

### HubSpot CRM (free)

- **Free tier:** contacts, companies, deals, lifecycle stages and custom
  properties are all available; private-app tokens; 250k API calls/day.
- **Used for:** the lead lifecycle. Default lifecycle stages map to ours:

  | Ziggy stage | HubSpot `lifecyclestage` | `hs_lead_status` |
  |---|---|---|
  | New Lead | `lead` | `NEW` |
  | Contacted | `lead` | `ATTEMPTED_TO_CONTACT` / `CONNECTED` |
  | Qualified | `marketingqualifiedlead` | `IN_PROGRESS` |
  | Demo / Beta | `opportunity` | `OPEN_DEAL` |
  | Customer | `customer` | — |
  | Lost | `other` (custom stage `lost`) | `UNQUALIFIED` |

  HubSpot only lets `lifecyclestage` move forward through the default order;
  "Lost" is therefore a custom lifecycle stage plus `hs_lead_status =
  UNQUALIFIED`, created once by `scripts/company/hubspot_bootstrap.py`.
- **Attribution properties** (custom, created by the bootstrap script):
  `ziggy_source`, `ziggy_utm_source`, `ziggy_utm_medium`,
  `ziggy_utm_campaign`, `ziggy_utm_content`, `ziggy_landing_page`,
  `ziggy_referrer`, `ziggy_first_seen`, `ziggy_lead_id`, `ziggy_kit_intent`,
  `ziggy_define_summary`, `ziggy_consent_marketing`, `ziggy_language`.
- **Endpoints used:** `POST /crm/v3/objects/contacts/batch/upsert` keyed on
  `idProperty=email` (dedupe by construction),
  `GET /crm/v3/objects/contacts/{email}?idProperty=email`,
  `POST /crm/v3/objects/contacts/search` for the SALES section.
- **Needs from Youval:** a HubSpot account, one private app with scopes
  `crm.objects.contacts.read`, `crm.objects.contacts.write`,
  `crm.schemas.contacts.read`, `crm.schemas.contacts.write`, `crm.objects.deals.read`.
- **Stored:** `HUBSPOT_PRIVATE_APP_TOKEN` (Desk).

### Brevo (marketing automation, transactional email)

- **Used for:** the waitlist list, welcome/nurture automation, DOI where the
  visitor did not tick marketing consent explicitly, transactional emails.
- **Endpoints used:** `POST /v3/contacts` with `updateEnabled: true`
  (idempotent), `POST /v3/contacts/doubleOptinConfirmation`,
  `POST /v3/smtp/email`, `GET /v3/contacts/lists/{id}` for counts.
- **Consent rule:** a contact is created with `emailBlacklisted: true` unless
  the lead ticked marketing consent; DOI is used to flip it.
- **Needs from Youval:** a Brevo account, one API key, one list ("Ziggy
  waitlist"), one DOI template, sender domain authentication for
  `ziggy-home.com` (DKIM/TXT records, same Cloudflare token story as
  Workspace).
- **Stored:** `BREVO_API_KEY`, `BREVO_LIST_ID`, `BREVO_DOI_TEMPLATE_ID`,
  `BREVO_SENDER_EMAIL` (Desk).

### Freshdesk (support)

- **Free plan limitation (documented, verified 2026-09-18):** Freshdesk's Free
  plan **does not allow API calls**. The Desk SUPPORT section therefore has
  two modes: (a) with a Growth trial/plan key it polls
  `GET /api/v2/tickets?updated_since=…` (Basic auth, key as username) and
  shows open / urgent / aging tickets; (b) on Free it shows a "connect
  Freshdesk (paid plan) or forward support mail to the Desk" state and the
  Desk's own lightweight `support_inbox` (an email forward from
  `support@ziggy-home.com` via Brevo inbound parsing) fills the section.
- **Needs from Youval:** create the Freshdesk account (`ziggyhome.freshdesk.com`),
  decide Free vs Growth. If Free: nothing else; if Growth/trial: the agent API
  key.
- **Stored:** `FRESHDESK_DOMAIN`, `FRESHDESK_API_KEY` (Desk).

### Sentry (application errors)

- **Free Developer plan:** 5k errors/month, 10k transactions, 50 replays,
  1 user, 30-day retention.
- **Apps instrumented:** `ziggy-desk`, `ziggy-relay`, `youval-jeff`
  (Python `sentry-sdk`, FastAPI integration auto-enabled), the website
  (`@sentry/browser`, loaded after consent, 10 % traces). **Customer hubs are
  not instrumented directly**: a hub sending tracebacks to a third party is a
  privacy decision, and 5k errors/month would be exhausted by one noisy hub.
  Instead the hub's existing error log is summarised into the 5-minute
  telemetry post (`errors_last_5m`, top 3 exception types, no request bodies)
  and the relay surfaces it as fleet health, which the Desk reads.
- **Desk side:** `GET /api/0/projects/{org}/{project}/issues/?query=is:unresolved`
  with an auth token (`project:read`, `event:read`).
- **Needs from Youval:** create the Sentry org, three projects, one auth token;
  give me the three DSNs (a DSN is not a secret but still goes in Fly secrets).
- **Stored:** `SENTRY_DSN` on each app, `SENTRY_ENVIRONMENT`;
  `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` on the Desk; website build arg
  `VITE_SENTRY_DSN`.

### UptimeRobot (uptime)

- **Free plan:** 50 monitors, 5-minute interval, 10 API requests/minute.
- **Monitors created by script** (`scripts/company/uptimerobot_bootstrap.py`,
  v3 API `POST /monitors`, Bearer auth):
  `https://ziggy-home.com/`, `https://ziggy-relay.fly.dev/health`,
  `https://ziggy-desk.fly.dev/health`, `https://youval-jeff.fly.dev/health`,
  `https://app.ziggy-home.com/health` (keyword `"ok":true`).
- **Desk side:** `GET /monitors` with a **read-only** key, cached 5 minutes
  because of the 10 req/min limit.
- **Needs from Youval:** the account, one main API key (for the bootstrap
  script, used once from the laptop) and one read-only key for the Desk.
- **Stored:** `UPTIMEROBOT_READ_KEY` (Desk). The main key is never stored on a
  server.

### n8n (automation)

- **License:** Sustainable Use License permits free self-hosting for one's
  own internal business purposes (checked against the LICENSE.md in
  `n8n-io/n8n`).
- **Deployment:** Fly app `ziggy-n8n` (fra), image `n8nio/n8n:<pinned>`,
  1 GB volume for `/home/node/.n8n`, SQLite (execution history pruned at 7
  days), `N8N_ENCRYPTION_KEY` generated by me. Scale-to-zero is off because
  schedule triggers need the process alive.
- **Public API:** `/api/v1` with `X-N8N-API-KEY`; the Desk lists workflows and
  failed executions for the SYSTEM HEALTH section.
- **Where n8n is used vs. code:** the critical flows (lead → CRM → Brevo →
  analytics → Desk; fleet outage → Desk; Sentry → Desk) are Desk code with
  tests, because they must be reliable and reviewable. n8n hosts the flows
  that Youval or Tslil are likely to change by hand (daily Slack/WhatsApp
  digest, ad-hoc enrichment, one-off imports). Workflow JSON is versioned in
  `ziggy-desk/n8n/workflows/`.
- **Needs from Youval:** confirm the ~US$5/month machine, then sign in once to
  create the owner account (n8n's first-run screen), then generate an API key.
- **Stored:** `N8N_API_KEY`, `N8N_BASE_URL` (Desk); `N8N_ENCRYPTION_KEY`
  (n8n app).

### GitHub

- **Used for:** open PRs / issues and release tags in the SYSTEM HEALTH and
  OPERATIONS sections (`gh api` equivalent over REST with a fine-grained PAT,
  read-only on `Ziggy_PC`, `ziggy-desk`, `ziggy-website`).
- **Stored:** `GITHUB_TOKEN` (Desk, read-only scopes).

### Ziggy relay / fleet (existing)

- **Used for:** OPERATIONS section: homes, online/offline/degraded, versions,
  incidents, auto-repairs. Read via `GET /api/admin/fleet/health`,
  `/api/admin/fleet/repairs`, `/api/admin/fleet/activity`,
  `/api/admin/homes/{id}/telemetry` with a relay JWT. The relay already has a
  **monitor account** (`RELAY_MONITOR_EMAIL` / `RELAY_MONITOR_PASSWORD`
  secrets on `ziggy-relay`); the Desk uses that account, never the founder
  account, and never calls a repair verb.
- **Stored:** `RELAY_URL`, `RELAY_MONITOR_EMAIL`, `RELAY_MONITOR_PASSWORD`
  (Desk). Youval copies the two values from `ziggy-relay` (they are Fly
  secrets I cannot read).

### Jeff (existing waitlist and notifications)

- **Used for:** the current waitlist store (`/data/ziggy/waitlist.json` on
  `youval-jeff`) is imported once into the Desk `leads` table and HubSpot.
  The website's lead POST moves to the Desk; the Desk forwards each new lead
  to Jeff's existing webhook so Youval's email alert and Jeff's brain filing
  keep working unchanged.
- **Stored:** `JEFF_WAITLIST_URL` (Desk, default the existing public
  endpoint; no secret needed).

### Stripe / revenue (dormant, existing code)

- **State found:** `ziggy_pc/relay/app/billing/` is a complete Stripe
  integration (founder lifetime plan capped at 30, standard monthly/annual,
  checkout, signed webhooks, 14-day trial on kit receipt, Israeli invoice
  numbering, VAT 18 %). **No `STRIPE_*` secrets are set on `ziggy-relay`**, so
  nothing runs. All three homes are `subscription_state=active` by hand. The
  website checkout is flag-off and still points at the destroyed `youval-corp`
  app.
- **Desk:** the REVENUE tile reads `subscription_state` counts and
  `founder_slots` from the relay (monitor account) and, once a **restricted
  read-only Stripe key** exists, MRR / paid invoices from `GET /v1/subscriptions`
  and `GET /v1/invoices`. Until then a manual `revenue_entries` table lets
  Youval record kit sales by hand. Nothing is fabricated: the tile says which
  source it is showing.
- **Needs from Youval:** decide whether to activate Stripe now (create prices
  for the three plans, set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_PRICE_*` on the relay), and create a restricted key (read:
  subscriptions, invoices, customers) for the Desk.
- **Stored:** `STRIPE_READ_KEY` (Desk).
