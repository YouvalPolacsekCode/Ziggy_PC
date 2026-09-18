# Company OS — Human setup checklist (Phase 2)

Everything below needs a human because it is an account, a legal acceptance, a
domain verification, billing, or an OAuth consent. I could not generate any of
these values. Everything that *could* be done programmatically is already done
or scripted (see "Already done" at the end).

How to hand me a value: run `fly secrets set -a <app> NAME=value` yourself
(preferred: I never see it), or paste it in chat and I will set it and you rotate
later. Never commit a value to git. Put a copy of each in Bitwarden (item 2).

Order matters only where noted. Items 1–3 unblock the most.

---

## 1. Google Workspace for ziggy-home.com  (identity for everything Google)

- **SERVICE:** Google Workspace
- **ACTION REQUIRED:** create the organisation and the mailbox `hello@ziggy-home.com`. The domain has **no MX records today**, so that address, which is printed on the site and in the privacy policy, cannot receive mail.
- **EXACT PAGE:** https://workspace.google.com/business/signup/welcome → choose Business Starter (paid, ~US$7/user/month; no free tier). Cheaper alternative if you don't want Workspace yet: Cloudflare Email Routing (free forward of `hello@` to a Gmail) at https://dash.cloudflare.com → ziggy-home.com → Email → Email Routing.
- **EXACT STEPS (Workspace):** 1) sign up with `ziggy-home.com`, 2) verify the domain: Google gives a TXT record, 3) add MX records for Google, 4) enable DKIM (Admin → Apps → Google Workspace → Gmail → Authenticate email) and copy its TXT, 5) add SPF `v=spf1 include:_spf.google.com ~all` and DMARC `v=DMARC1; p=none; rua=mailto:hello@ziggy-home.com`.
- **VALUE I NEED:** nothing for the code. To write the DNS records for you, see item 3.
- **WHERE STORED:** n/a. Use the new mailbox as the owner of GA4, Search Console, Ads, Meta Business, HubSpot, Brevo, Sentry, UptimeRobot, PostHog, Freshdesk so nothing is tied to a personal Gmail.

## 2. Bitwarden organisation

- **SERVICE:** Bitwarden
- **ACTION REQUIRED:** create an organisation "Ziggy" (Free org allows 2 members) and invite Tslil.
- **EXACT PAGE:** https://vault.bitwarden.com → New organisation → Free. Then Members → Invite.
- **VALUE I NEED:** none. Store every credential below there as you create it, one item per service, with the Fly app name in the notes.
- **WHERE STORED:** Bitwarden only.

## 3. Cloudflare API token for DNS (lets me write records for items 1, 6, 11)

- **SERVICE:** Cloudflare (zone ziggy-home.com)
- **ACTION REQUIRED:** create an API token scoped to **Zone → DNS → Edit** on `ziggy-home.com` only. The relay's existing token only has Tunnel:Edit.
- **EXACT PAGE:** https://dash.cloudflare.com/profile/api-tokens → Create Token → "Edit zone DNS" template → Zone Resources: Include, Specific zone, ziggy-home.com.
- **VALUE I NEED:** the token, and the zone ID (Overview page of the zone, right column "Zone ID").
- **WHERE STORED:** your laptop env only, used by `ziggy-desk/scripts/company/cloudflare_dns.py`. Not on any server. Delete the token when the records are in.

## 4. Google Cloud project + service account (GA4 Data API, Search Console API)

- **SERVICE:** Google Cloud
- **ACTION REQUIRED:** one project ("ziggy-company-os"), enable **Google Analytics Data API** and **Google Search Console API**, create one service account, download its JSON key.
- **EXACT PAGE:** https://console.cloud.google.com/apis/library (enable the two APIs) → https://console.cloud.google.com/iam-admin/serviceaccounts → Create → name `ziggy-desk-reader` → Keys → Add key → JSON.
- **VALUE I NEED:** the JSON key file contents.
- **WHERE STORED:** Fly secret `GOOGLE_SERVICE_ACCOUNT_JSON` on `ziggy-desk` (paste the whole JSON as the value: `fly secrets set -a ziggy-desk GOOGLE_SERVICE_ACCOUNT_JSON="$(cat key.json)"`).

## 5. Google Analytics 4

- **SERVICE:** GA4
- **ACTION REQUIRED:** create property "Ziggy website", web data stream for `https://ziggy-home.com`, create a Measurement Protocol API secret, add the service account as Viewer, mark `lead_created` as a key event.
- **EXACT PAGE:** https://analytics.google.com → Admin → Create property → Data streams → Web. Then Data streams → (stream) → Measurement Protocol API secrets → Create. Then Admin → Property access management → Add → the service-account email (from item 4) → Viewer. Then Admin → Events → mark `lead_created` as key event (appears after the first event arrives).
- **VALUE I NEED:** Measurement ID `G-…`, the numeric Property ID (Admin → Property details), the MP API secret.
- **WHERE STORED:** website build arg `VITE_GA_ID` (edit `fly.toml [build.args]` in the website repo — not secret); Fly secrets on `ziggy-desk`: `GA4_MEASUREMENT_ID`, `GA4_PROPERTY_ID`, `GA4_API_SECRET`.

## 6. Google Search Console

- **SERVICE:** Search Console
- **ACTION REQUIRED:** add the **Domain** property `ziggy-home.com`, verify via DNS TXT, add the service account as a user (Restricted).
- **EXACT PAGE:** https://search.google.com/search-console → Add property → Domain → copy the TXT → add in Cloudflare (or give me item 3) → Verify. Then Settings → Users and permissions → Add user → service-account email → Restricted.
- **VALUE I NEED:** none beyond item 4 (already set: `GSC_SITE_URL=sc-domain:ziggy-home.com`).
- **WHERE STORED:** n/a.

## 7. Google Ads API access (for spend in the Desk; the publisher already needs the same)

- **SERVICE:** Google Ads (customer ID 577-694-4405 already set on the Desk)
- **ACTION REQUIRED:** (a) developer token — status of your pending Basic-access application at https://ads.google.com/aw/apicenter; (b) OAuth client: in the Cloud project from item 4, https://console.cloud.google.com/apis/credentials → Create credentials → OAuth client ID → Desktop app; (c) refresh token: https://developers.google.com/oauthplayground → gear icon → "Use your own OAuth credentials" (client id/secret from b) → scope `https://www.googleapis.com/auth/adwords` → Authorize with the Google account that manages the Ads account → Exchange authorization code for tokens → copy the refresh token.
- **VALUE I NEED:** developer token, client ID, client secret, refresh token; login-customer-id only if the account sits under an MCC.
- **WHERE STORED:** Fly secrets on `ziggy-desk`: `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, (`GOOGLE_ADS_LOGIN_CUSTOMER_ID`).

## 8. Meta (Facebook / Instagram): system-user token

- **SERVICE:** Meta Business Suite / Meta for Developers
- **ACTION REQUIRED:** have a Meta Business portfolio with the Facebook Page, the Instagram professional account and the Ad Account attached; create (or reuse) an app; create a **System User** and generate a **never-expiring** token.
- **EXACT PAGE:** https://business.facebook.com/settings/system-users → Add → Admin system user → Assign assets (Page, Instagram account, Ad account: full control) → Generate token → select the app → permissions: `ads_read`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`, `business_management`.
- **VALUE I NEED:** the token, the Ad Account ID (`act_…`, at https://business.facebook.com/settings/ad-accounts), the Instagram user ID (Graph API Explorer: `me/accounts` → page → `?fields=instagram_business_account`) and the handle.
- **WHERE STORED:** Fly secrets on `ziggy-desk`: `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `IG_ACCESS_TOKEN` (same token), `IG_USER_ID`, `IG_HANDLE`. If you generate a 60-day token instead, also `META_TOKEN_EXPIRES_AT=YYYY-MM-DD` so TODAY warns you a week before.

## 9. PostHog (EU cloud)

- **SERVICE:** PostHog
- **ACTION REQUIRED:** sign up on the **EU** cloud, create project "Ziggy", copy the project API key and project ID, create a personal API key with `query:read`.
- **EXACT PAGE:** https://eu.posthog.com/signup → Project settings (https://eu.posthog.com/settings/project) shows "Project API key" and "Project ID" → https://eu.posthog.com/settings/user-api-keys → Create → scope Query: Read.
- **VALUE I NEED:** project API key (public, `phc_…`), project ID (number), personal API key (`phx_…`).
- **WHERE STORED:** website build arg `VITE_POSTHOG_KEY` (+ `VITE_POSTHOG_HOST=https://eu.i.posthog.com`); Fly secrets on `ziggy-desk`: `POSTHOG_PROJECT_KEY`, `POSTHOG_PROJECT_ID`, `POSTHOG_PERSONAL_API_KEY`; Fly secret on `ziggy-relay`: `POSTHOG_PROJECT_KEY` (hub feature counters, server-side).

## 10. HubSpot CRM (free)

- **SERVICE:** HubSpot
- **ACTION REQUIRED:** create the free account, then one private app with contact scopes.
- **EXACT PAGE:** https://app.hubspot.com/signup-hubspot/crm → after setup: Settings (gear) → Integrations → Private apps → Create → name "Ziggy Desk" → Scopes: `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.schemas.contacts.read`, `crm.schemas.contacts.write` → Create → Show token.
- **VALUE I NEED:** the private-app token (`pat-eu1-…`).
- **WHERE STORED:** Fly secret `HUBSPOT_PRIVATE_APP_TOKEN` on `ziggy-desk`. Then I run `scripts/company/hubspot_bootstrap.py` (creates the `ziggy_*` properties and the "lost" stage).

## 11. Brevo (chosen over MailerLite — see INTEGRATIONS.md)

- **SERVICE:** Brevo
- **ACTION REQUIRED:** create the free account, an API key, and authenticate the sender domain.
- **EXACT PAGE:** https://onboarding.brevo.com/account/register → https://app.brevo.com/settings/keys/api → Generate a new API key ("ziggy-desk"). Sender domain: https://app.brevo.com/senders/domain/list → Add domain `ziggy-home.com` → Brevo shows DKIM/brevo-code TXT records → add in Cloudflare (or give me item 3).
- **VALUE I NEED:** the API key. After I run `scripts/company/brevo_bootstrap.py` you also need to create a **Double opt-in template** (Templates → Create → Double opt-in) and tell me its ID.
- **WHERE STORED:** Fly secrets on `ziggy-desk`: `BREVO_API_KEY`, `BREVO_LIST_ID` (from the script), `BREVO_DOI_TEMPLATE_ID`, `BREVO_SENDER_EMAIL=hello@ziggy-home.com`.

## 12. Freshdesk

- **SERVICE:** Freshdesk
- **ACTION REQUIRED:** create the helpdesk `ziggyhome.freshdesk.com` and decide the plan. **Documented limitation: the Free plan does not allow API calls**, so on Free the Desk cannot read tickets; it shows its own support inbox instead (fed by email forwarding through n8n). If you take the Growth trial/plan, the Desk reads tickets directly.
- **EXACT PAGE:** https://www.freshworks.com/freshdesk/signup/ → then Profile settings (top-right avatar → Profile Settings) → "Your API key" (Growth+ only).
- **VALUE I NEED:** the subdomain; the agent API key only if on Growth+.
- **WHERE STORED:** Fly secrets on `ziggy-desk`: `FRESHDESK_DOMAIN=ziggyhome`, `FRESHDESK_API_KEY`.

## 13. Sentry

- **SERVICE:** Sentry (Developer plan, free)
- **ACTION REQUIRED:** create org "ziggy", four projects (`ziggy-desk` Python/FastAPI, `ziggy-relay` Python/FastAPI, `youval-jeff` Python/FastAPI, `ziggy-website` JavaScript/Browser), and one org auth token.
- **EXACT PAGE:** https://sentry.io/signup/ → Projects → Create project (×4; each shows its DSN under Settings → Client Keys) → Settings → Auth Tokens (https://sentry.io/settings/account/api/auth-tokens/) → Create → scopes `project:read`, `event:read`, `org:read`.
- **VALUE I NEED:** four DSNs, the org slug, the auth token.
- **WHERE STORED:** `SENTRY_DSN` on `ziggy-desk`, `ziggy-relay`, `youval-jeff` (Fly secrets, each its own DSN); website build arg `VITE_SENTRY_DSN`; on `ziggy-desk` also `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`.

## 14. UptimeRobot

- **SERVICE:** UptimeRobot (free: 50 monitors, 5-min)
- **ACTION REQUIRED:** create the account, a **Main API key** (used once by my script) and a **Read-only API key** (for the Desk).
- **EXACT PAGE:** https://dashboard.uptimerobot.com/sign-up → https://dashboard.uptimerobot.com/integrations → API → "Main API key" → Create; "Read-only API key" → Create.
- **VALUE I NEED:** both keys; the main key goes only into your shell for `scripts/company/uptimerobot_bootstrap.py`, then can be deleted.
- **WHERE STORED:** Fly secret `UPTIMEROBOT_READ_KEY` on `ziggy-desk`.

## 15. n8n (self-hosted on Fly)

- **SERVICE:** n8n, Fly app `ziggy-n8n`
- **ACTION REQUIRED:** (a) confirm the ~US$5/month always-on 1 GB machine (I did not create paid infrastructure without your yes); (b) after I deploy, open https://ziggy-n8n.fly.dev once and create the owner account (n8n's first-run screen); (c) Settings → n8n API → Create API key.
- **EXACT PAGE:** https://ziggy-n8n.fly.dev (after deploy) → Settings → n8n API.
- **VALUE I NEED:** "yes" for (a); the API key for (c).
- **WHERE STORED:** Fly secret `N8N_API_KEY` on `ziggy-desk` (with `N8N_BASE_URL=https://ziggy-n8n.fly.dev`); on `ziggy-n8n`: `DESK_URL`, `DESK_API_KEY` (I generate a new author-role Desk key for n8n), `NOTIFY_WEBHOOK_URL`.

## 16. Notification webhook (Slack, Discord, or WhatsApp via Jeff)

- **SERVICE:** whichever you read daily
- **ACTION REQUIRED:** create an incoming webhook (Slack: https://api.slack.com/apps → Incoming Webhooks; Discord: channel → Integrations → Webhooks). The Desk already posts Hebrew text to `NOTIFY_WEBHOOK_URL` on decisions; the daily digest and fleet-down alerts use the same URL.
- **VALUE I NEED:** the webhook URL.
- **WHERE STORED:** Fly secret `NOTIFY_WEBHOOK_URL` on `ziggy-desk` and `ziggy-n8n`.

## 17. Relay monitor account → Desk

- **SERVICE:** ziggy-relay (existing)
- **ACTION REQUIRED:** copy the two existing Fly secrets from the relay to the Desk. I cannot read Fly secret values.
- **EXACT STEPS:** `fly ssh console -a ziggy-relay -C 'sh -c "echo $RELAY_MONITOR_EMAIL; echo $RELAY_MONITOR_PASSWORD"'` then `fly secrets set -a ziggy-desk RELAY_MONITOR_EMAIL=… RELAY_MONITOR_PASSWORD=…`. If the monitor account was never created on the relay, create it with the founder account via `POST /api/invites/` (role `relay_admin` is required for `/api/admin/fleet/*`; there is no narrower read-only role today — documented limitation).
- **WHERE STORED:** Fly secrets on `ziggy-desk`.

## 18. GitHub fine-grained token (read-only)

- **SERVICE:** GitHub
- **ACTION REQUIRED:** https://github.com/settings/personal-access-tokens/new → Repository access: Ziggy_PC, ziggy-desk, ziggy-website → Permissions: Contents Read, Issues Read, Pull requests Read, Metadata Read.
- **VALUE I NEED:** the token.
- **WHERE STORED:** Fly secret `GITHUB_TOKEN` on `ziggy-desk`.

## 19. Stripe (only if you want revenue automated now)

- **SERVICE:** Stripe
- **ACTION REQUIRED:** the relay's billing code is complete but dormant. To switch it on: create the three prices (founder lifetime, standard monthly, standard annual) and set on `ziggy-relay`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (endpoint `https://ziggy-relay.fly.dev/api/billing/stripe/webhook`), `STRIPE_PRICE_FOUNDER_LIFETIME_V1`, `STRIPE_PRICE_STANDARD_MONTHLY_2026`, `STRIPE_PRICE_STANDARD_ANNUAL_2026`. For the Desk, create a **restricted key** (https://dashboard.stripe.com/apikeys → Create restricted key → Subscriptions Read, Invoices Read, Customers Read).
- **VALUE I NEED:** the restricted key (Desk). The rest is yours to decide.
- **WHERE STORED:** `STRIPE_READ_KEY` on `ziggy-desk`.

## 20. Website deploy (after 5, 9, 13 exist)

- **SERVICE:** Fly app `ziggy-website`
- **ACTION REQUIRED:** the tracking foundation is committed in the website repo but not deployed (it needs the GA4/PostHog IDs to do anything, and the Desk endpoint it posts to is live). Either tell me "deploy the site" or run `fly deploy` from the website dir after editing `fly.toml [build.args]` with `VITE_GA_ID`, `VITE_POSTHOG_KEY`, `VITE_SENTRY_DSN`.
- **WHERE STORED:** `fly.toml [build.args]` (public identifiers, not secrets).

## 21. Ziggy_PC merge + ship (hub usage counters, relay Sentry/PostHog/health/backup)

- **SERVICE:** GitHub / your release process
- **ACTION REQUIRED:** review branch `feat/company-os` in `Ziggy_PC`, merge to `main`, then `./scripts/ship.sh -m "company-os: usage counters, relay observability"` and `fly deploy` the relay from `relay/`. I did not ship because CLAUDE.md requires your agreement before code reaches customer homes.
- **WHERE STORED:** n/a.

---

## Already done (no action needed)

- `ziggy-desk` pushed to private GitHub repo `YouvalPolacsekCode/ziggy-desk`; CI on push.
- Desk deployed with the company layer: `/today /marketing /sales /product /operations /support /system`, public `POST /api/leads`, 15 connectors all reporting `not configured` until their key exists.
- Website tracking foundation committed (consent banner, GA4 Consent Mode v2, PostHog, canonical events, first-touch attribution, Desk lead pipeline with Jeff fallback, privacy policy rewritten).
- `Ziggy_PC` branch `feat/company-os`: hub usage counters, relay → PostHog forwarding, `error_burst` fleet rule, Sentry init, HTTP health check, nightly backup scheduling, CI workflow.
- Jeff: optional Sentry init committed (deploys with the next `fly deploy -a youval-jeff`).
- n8n: Fly config, README and three workflows in `ziggy-desk/n8n/` (deploy on your yes in item 15).
- Bootstrap scripts in `ziggy-desk/scripts/company/` for HubSpot, Brevo, UptimeRobot, Cloudflare DNS, Jeff waitlist import, connector check.
