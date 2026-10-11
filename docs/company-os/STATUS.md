# Company OS — STATUS

Updated: 2026-09-18

## DONE
- **Audit** of ziggy_pc (hub, relay, fleet), ziggy-desk, the marketing website (repo and
  live ziggy-home.com), jeff/jeff-web; live probes of every Fly app; DNS of ziggy-home.com;
  vendor free-tier and API research. Docs: `ARCHITECTURE.md`, `INTEGRATIONS.md`,
  `IMPLEMENTATION_PLAN.md`, `TRACKING_SPEC.md`, `SETUP_CHECKLIST.md`.
- **Vendor decision:** Brevo over MailerLite; Plausible dropped; Freshdesk Free-plan API
  limitation documented with a Desk-native fallback.
- **ziggy-desk** pushed to a new private GitHub repo (it had no remote); CI workflow added.
- **Desk company layer LIVE** (`https://ziggy-desk.fly.dev`, commit `78ea112`): schema,
  15 connectors (relay, ga4, gsc, google_ads, meta, posthog, hubspot, brevo, freshdesk,
  sentry, uptimerobot, n8n, github, stripe, jeff), outbox with backoff + dead letters,
  lead engine with dedupe and first/last-touch attribution, TODAY inbox (mirrors the
  Instagram/Ads approval queue), pages `/today /marketing /sales /product /operations
  /support /system`, JSON API for n8n/agents, manual revenue entries, support inbox.
  Verified live: `/health` lists every connector as `not_configured` (jeff `ok`),
  `POST /api/leads` preflight 204, honeypot 200-without-storing, invalid email 422,
  pages redirect to login. 52 tests green.
- **n8n** self-host package (`ziggy-desk/n8n/`: fly.toml, README, three workflows).
- **Bootstrap scripts** (`ziggy-desk/scripts/company/`): HubSpot properties + "lost"
  stage, Brevo attributes + list, UptimeRobot monitors, Cloudflare DNS plan, Jeff
  waitlist import, connector check.
- **Jeff:** optional Sentry init committed on `main` (`50803d4`), 727 tests green, not deployed.

- **Website tracking foundation committed** (`673893f` on `feat/agentic-os-frontend`
  in the `YouvalCorp.` monorepo, 32 files under `ziggy/website/`): consent banner,
  GA4 Consent Mode v2, PostHog EU, canonical events, first/last-touch attribution,
  Desk lead pipeline with Jeff fallback on any non-2xx except 422/429, honeypot,
  marketing-consent checkbox, privacy policy rewritten, Plausible removed, dead
  `#define` page and `DH_*` taxonomy deleted. 26 vitest + 67 define tests green, build
  green. **Not deployed** — waits on GA4/PostHog IDs (checklist 5, 9, 20).
- **Ziggy_PC `feat/company-os` pushed** (5 commits on top of `main` 6395ef3): hub usage
  counters in the 5-minute telemetry, relay → PostHog forwarding, `error_burst` fleet
  rule, relay Sentry init, HTTP health check, nightly DB backup scheduling, CI workflow,
  in-app `/welcome` waitlist → Desk, company-os docs. 2,895 tests green (11
  pre-existing failures deselected and documented in the workflow). **Not merged, not
  shipped** (checklist 21).

- **Operator layer LIVE in the Desk** (2026-09-18, second pass): one knowledge registry
  (`desk/company/knowledge.py`) drives "?" help on every number and an "about this page"
  on every page; Today = 30-second glance + ACTION REQUIRED / FYI / AUTOMATIC; `/setup`
  = self-verifying Company Setup (23 tasks, progress %, manual ticks, DNS check for
  mail); `/ask` = deterministic Ask Desk (English + Hebrew keywords, live answers for
  "what do I need to do", "is Ziggy healthy", "which systems cost money"); `/flows` =
  Automation Map (7 processes, each step AUTOMATIC / HUMAN APPROVAL / HUMAN ACTION);
  `/system` = Services view (purpose, plan, limit, cost, API, status, fallback, near-limit
  flag) with technical tables collapsed. Daily Hebrew digest and urgent pushes are sent by
  the Desk; inbound support mail accepted by URL token. 73 tests green.
- **n8n removed** after audit (`N8N_DECISION.md`): all three planned workflows are native.

- **Setup progress (2026-09-18 evening):** connected and green — Cloudflare DNS token
  (used from the laptop only), Google service account, GA4 (property 554911954, timezone
  fixed to Israel), Search Console (domain verified, reader added), PostHog EU (project
  278080), HubSpot (15 Ziggy fields created; "Lost" = other + UNQUALIFIED because
  HubSpot's lifecycle options are read-only), Brevo (list id 3, domain authenticated,
  DKIM records written), relay monitor account (created directly in the relay DB — the
  Fly secrets existed but no user row did), Sentry (org ziggy-vs, 4 projects, DSNs on
  Desk + Jeff, staged on relay), UptimeRobot (5 monitors, all UP), GitHub (Ziggy_PC only
  until the token is widened). Google Workspace MX/SPF/DMARC written. Website deployed
  with GA4 + PostHog + Sentry + consent banner; Plausible gone. End-to-end lead test
  passed (Desk → Jeff, HubSpot, Brevo, GA4, PostHog) and the test lead was deleted.
- **Console redesign LIVE** (direction A, chosen from three mockups): grouped sidebar,
  light theme, tables, Ask Desk in the top bar, plain names. Full Hebrew pass: the
  knowledge layer has a Hebrew twin (`knowledge_he.py`), every code-generated string goes
  through `knowledge.dyn(lang, …)`, inbox items store a key + params and render per
  viewer language, relay headlines get a Hebrew rendering, i18n audited. 78 tests.

- **Phone layout LIVE** (direction A, approved): under 860 px the sidebar is replaced by a
  bottom tab bar (היום · עבודה · החברה · עוד) with a sub-navigation strip on the Work and
  Company groups, a `/more` page for everything else, every table renders as stacked cards
  (`desk.js` labels cells, CSS stacks them), item pages pin אישור · בקשת שינוי · דחייה above
  the tab bar, Today approves inline with the proposed schedule, 44 px touch targets, and a
  web-app manifest + icons so "Add to Home Screen" installs Ziggy Desk with the brand icon.
  Desktop unchanged. 80 tests.

## IN PROGRESS
- Nothing in flight.

## BLOCKED — NEEDS YOUVAL
Remaining (also live at `/setup`):
1. Notification webhook URL (Slack/Discord) — turns on the 07:30 digest and urgent pushes.
2. GitHub token widened to `ziggy-desk` and `ziggy-website`.
3. Workspace: domain verification TXT (if Google asks) and DKIM value from the admin console.
4. Meta system-user token; Google Ads developer token (waiting on Google); Stripe and
   Freshdesk only when wanted.
5. Review/merge/ship of `feat/company-os` in Ziggy_PC, then `fly deploy` the relay
   (Sentry DSN + PostHog key are staged there).

## NEXT (after credentials)
- Run the bootstrap scripts; import Jeff's waitlist; deploy the website with the IDs;
  set the Desk secrets; confirm every connector shows `ok` on `/system`; ship
  `feat/company-os` via `ship.sh` and `fly deploy` the relay.

## KNOWN ISSUES (found in the audit, not yet fixed)
- Jeff waitlist endpoint: no rate limit, a thread + SMTP connection per signup,
  `source` truncated to 120 chars (the Desk now carries the full structured lead; Jeff
  keeps receiving the legacy string for the email alert).
- Relay: `audit_log` never pruned; CORS `*`; `HOMES_DIR` dead config; no read-only
  relay role (the Desk monitor account must be `relay_admin`).
- Desk: `AGENT_DAILY_CAP_USD` documented default 5, actual default 0 (no cap).
- Website: three price sources disagree (JSON-LD ₪2,290, llms.txt ₪2,199/₪3,299/₪19,
  site ₪49/mo); no hreflang; OG image relative URL; sitemap stale; the website repo
  is a subdirectory of the `YouvalCorp.` monorepo on a feature branch while a separate
  `ziggy-website` GitHub repo also exists.
- Desk Fly health check logged one transient failure during the deploy; healthy since.
