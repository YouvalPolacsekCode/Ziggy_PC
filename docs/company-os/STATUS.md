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

## IN PROGRESS
- Nothing in flight. Every remaining step waits on a credential or a decision.

## BLOCKED — NEEDS YOUVAL
All 21 items in `SETUP_CHECKLIST.md`. The ones that unblock the most:
1. Google Workspace (or Cloudflare Email Routing) — `hello@ziggy-home.com` cannot receive mail.
2. Cloudflare DNS-edit token — lets me write MX/SPF/DKIM/verification records.
3. GA4 property + PostHog project — the site deploy and the MARKETING/PRODUCT pages.
4. HubSpot private-app token + Brevo key — the lead engine's CRM/ESP legs (leads are
   already stored in the Desk and forwarded to Jeff meanwhile).
5. Relay monitor credentials copied to the Desk — OPERATIONS page.
6. Sentry DSNs + UptimeRobot keys — SYSTEM HEALTH page.
7. "Yes" for the ~US$5/month n8n machine; review/merge/ship of `feat/company-os`.

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
