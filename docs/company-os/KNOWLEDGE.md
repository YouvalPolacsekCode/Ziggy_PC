# Ziggy company knowledge (generated from desk/company/knowledge.py — do not edit by hand)

## Services

### Ziggy Desk
- Purpose: Your one place to run Ziggy: approvals, leads, homes, numbers, and what needs you.
- Why: So you don't have to open eight vendor dashboards to know how the company is doing.
- Data: Pulls snapshots from every connected service on a schedule and keeps its own records of leads, approvals and incidents.
- Automatic: Collects data every 5–60 minutes per service, fans leads out, opens items in Today when something needs a person, sends the daily digest.
- You do: Open Today each morning. Act on 'Action required'. Everything else is informational.
- Open the vendor when: Never — this is the Desk.
- Cost: paid · Fly.io shared-cpu-1x 512 MB, always on · ~US$3.32/month · limit: One small machine; fine for years at this size. · API: yes
- Fallback: —
- Verified: 2026-09-18

### ziggy-home.com
- Purpose: The marketing site: explains Ziggy, runs Define Your Home, collects leads.
- Why: Every customer starts here.
- Data: Visitor behaviour goes to GA4 and PostHog after the visitor accepts the consent banner. Leads go to the Desk.
- Automatic: Deploys from the website repo. Consent banner, analytics and lead posting run on their own.
- You do: Nothing day to day. Deploy when copy or prices change.
- Open the vendor when: To read the site as a customer would.
- Cost: paid · Fly.io shared-cpu-1x 256 MB, stops when idle · ~US$1.0/month · limit: Scale-to-zero: first visitor after idle waits ~1 s. · API: no
- Fallback: —
- Verified: 2026-09-18

### Ziggy cloud (relay)
- Purpose: Connects every customer home to the app, receives each home's health report every 5 minutes, and repairs safe problems on its own.
- Why: Homes sit behind customers' routers; the relay is how the app and you reach them.
- Data: Each hub posts health, device counts, disk and software version. The Desk reads the relay's verdict per home.
- Automatic: Silence, unreachable Home Assistant, lost devices, low disk and drifted software are judged automatically; reconcile / recover-HA repairs run with cooldowns and a 3-attempt cap, then escalate to you.
- You do: Look at Today when a home is DOWN or a repair escalated. Ship releases with ship.sh.
- Open the vendor when: Rarely. The founder fleet console lives inside the Canary app (/ops/cloud) for repairs the Desk deliberately does not perform.
- Cost: paid · Fly.io shared-cpu-1x 512 MB, always on · ~US$3.32/month · limit: — · API: yes
- Fallback: scripts/fleet-health.py on your laptop
- Verified: 2026-09-18

### Jeff
- Purpose: Your assistant. Today it also keeps the historical waitlist and emails you on every new signup.
- Why: It already existed and you rely on the email; the Desk keeps feeding it so nothing you're used to disappears.
- Data: The Desk forwards each new lead to Jeff's waitlist endpoint.
- Automatic: Forwarding, with retries.
- You do: Nothing.
- Open the vendor when: For Jeff's own features, not for Ziggy leads (those are in Sales).
- Cost: paid · Fly.io, always on (existing) · ~US$5.92/month · limit: — · API: yes
- Fallback: —
- Verified: 2026-09-18

### Google Analytics 4
- Purpose: Where website visitors come from and which campaigns bring leads.
- Why: It's the language Google Ads speaks: conversions imported from GA4 make Ads optimise for real leads.
- Data: The site sends page views and events after consent; the Desk sends a server-side lead_created event so ad blockers don't hide conversions. The Desk reads reports hourly.
- Automatic: Everything. Reports refresh hourly into Marketing.
- You do: Nothing after setup.
- Open the vendor when: Deep-dive on a specific campaign, or to link the property to Google Ads (one-time).
- Cost: free · Standard · ~US$0/month · limit: Standard is free without practical limits at our size. · API: yes
- Fallback: PostHog covers visitor behaviour; only Ads attribution would be lost.
- Verified: 2026-09-18

### Google Search Console
- Purpose: Which searches show ziggy-home.com and how often people click.
- Why: Free organic traffic is the cheapest lead source; this is the only way to see it.
- Data: Google's own search data, read by the Desk every 6 hours (Google lags ~2 days).
- Automatic: Everything.
- You do: Nothing after domain verification.
- Open the vendor when: If Google reports an indexing or manual-action problem (you'd get an email).
- Cost: free · — · ~US$0/month · limit: None. · API: yes
- Fallback: None needed.
- Verified: 2026-09-18

### Google Ads
- Purpose: Paid search: people who type 'בית חכם' into Google.
- Why: Highest-intent channel for a ₪2,290 kit.
- Data: Spend, clicks and conversions read hourly. Changes (negatives, budgets, new campaigns) are proposed by Claude in the Ads queue and only run after you approve.
- Automatic: Reporting. Publishing an approved change (once the developer token is approved by Google).
- You do: Approve or reject proposed changes in the Ads queue. Keep an eye on cost per lead in Marketing.
- Open the vendor when: Billing/payment problems, policy disapprovals, or to add a payment method — the API cannot do those.
- Cost: paid · Ad spend only (₪46/day agreed) · ~US$380/month · limit: API access needs a developer token approved by Google (pending). · API: yes
- Fallback: Claude proposes, you execute by hand in Ads and mark it done.
- Verified: 2026-09-18

### Meta (Facebook & Instagram)
- Purpose: Instagram posts (published from the Desk after approval) and Meta ad spend.
- Why: Where Israeli home-owners actually scroll.
- Data: Ad spend and Instagram followers read hourly. Posts are published by the Desk when you approve.
- Automatic: Reporting; publishing approved posts; a warning a week before the access token expires.
- You do: Approve posts in the Instagram queue. Renew the token when Today asks (every ~60 days unless it's a System User token).
- Open the vendor when: Comments and DMs (not in the Desk yet), ad billing, or to generate a new token.
- Cost: paid · Ad spend only · ~US$0/month · limit: User tokens expire after 60 days; a System User token does not. · API: yes
- Fallback: Post by hand from the phone; mark published in the Desk.
- Verified: 2026-09-18

### PostHog
- Purpose: How people use ziggy-home.com and, in aggregate, which Ziggy features homes use.
- Why: Shows where visitors drop out of Define Your Home and which product features matter — without putting a tracker inside customers' homes.
- Data: Website events after consent (with session replay); hub feature counters arrive via the relay, keyed by home, never by person.
- Automatic: Everything. Funnels and usage refresh hourly into Product.
- You do: Nothing.
- Open the vendor when: To watch a session replay of someone getting stuck in Define Your Home.
- Cost: free · Free tier (EU cloud) · ~US$0/month · limit: 1M events, 5,000 session recordings per month; then pay-as-you-go. · API: yes
- Fallback: GA4 keeps acquisition; funnels and replays would be lost.
- Verified: 2026-09-18

### HubSpot CRM
- Purpose: The customer list: every lead, what stage they are in, notes and emails.
- Why: A CRM you can open on your phone, with a free tier that fits a solo founder for a long time.
- Data: Every lead the Desk receives is created or updated in HubSpot with its source. Stages you change in HubSpot flow back to the Desk every 15 minutes.
- Automatic: Contact creation, attribution, stage sync.
- You do: Move leads between stages (in Sales or in HubSpot) and write notes when you talk to people.
- Open the vendor when: To email or call a lead, log a conversation, or use its mobile app.
- Cost: free · Free CRM · ~US$0/month · limit: 250,000 API calls/day (we use a few hundred). Marketing email caps apply only if you use HubSpot's email — we use Brevo. · API: yes
- Fallback: The Desk's own lead list keeps working; you'd lose the CRM UI.
- Verified: 2026-09-18

### Brevo
- Purpose: Sending email to leads: welcome, updates, launch news — and confirmation emails.
- Why: Free tier allows 300 emails a day with a real API and double opt-in, which MailerLite's 250-subscriber cap does not.
- Data: Leads with marketing consent join the list; without consent they get one double-opt-in email.
- Automatic: List sync, double opt-in, transactional emails.
- You do: Write campaigns and automations in Brevo when you want to email the list.
- Open the vendor when: To design or send a campaign, or check deliverability.
- Cost: free · Free · ~US$0/month · limit: 300 emails/day; automation workflows for up to 2,000 contacts; Brevo logo in emails. · API: yes
- Fallback: MailerLite (250 subscribers) or HubSpot's own email.
- Verified: 2026-09-18

### Freshdesk
- Purpose: Support tickets with a knowledge base, if you want a proper help desk.
- Why: Requested. Note: its Free plan blocks API access, so the Desk can only show tickets on a paid plan.
- Data: Tickets read every 15 minutes (paid plan). On Free, support mail is routed straight into the Desk instead.
- Automatic: Ticket counts and urgent escalations into Today.
- You do: Answer customers.
- Open the vendor when: To reply to tickets (paid plan). On Free: not needed — use the Desk's Support page.
- Cost: free · Free (2 agents) · ~US$0/month · limit: No API on Free — the Desk cannot read tickets. Growth is ~US$15/agent/month. · API: no
- Fallback: Desk-native support inbox fed by support@ mail (built in, active now).
- Verified: 2026-09-18

### Sentry
- Purpose: Catches application errors in the Desk, the cloud relay, Jeff and the website.
- Why: Without it a crash on the relay is invisible until a customer calls.
- Data: Each app reports its own errors; customer hubs do NOT report to Sentry (privacy; volume). Hub error counts ride the existing health report instead.
- Automatic: Errors grouped; an issue with 10+ events in a day opens an item in Today.
- You do: Nothing unless Today shows an error burst.
- Open the vendor when: To read the stack trace of a burst before asking Claude to fix it.
- Cost: free · Developer · ~US$0/month · limit: 5,000 errors/month, 1 user, 30-day retention. · API: yes
- Fallback: fly logs by hand.
- Verified: 2026-09-18

### UptimeRobot
- Purpose: Pings the website, the relay, the Desk, Jeff and the Canary app every 5 minutes from outside.
- Why: Everything else lives inside our own services; this is the one watcher that notices when they are all down.
- Data: Up/down and 30-day uptime per monitor, read every 10 minutes.
- Automatic: A DOWN monitor opens an urgent item in Today and sends the notification webhook.
- You do: Nothing unless something is down.
- Open the vendor when: To add a monitor or change alert contacts.
- Cost: free · Free · ~US$0/month · limit: 50 monitors, 5-minute checks, 10 API calls/minute. · API: yes
- Fallback: Fly's own health checks (they don't alert you).
- Verified: 2026-09-18

### GitHub
- Purpose: Where the code lives; tests run on every push.
- Why: —
- Data: Open pull requests, issues and the latest release tag per repo, read every 30 minutes.
- Automatic: CI on push. Release tags reach customer homes within ~5 minutes of ship.sh.
- You do: Merge and ship when Claude asks.
- Open the vendor when: To review a pull request.
- Cost: free · Free (public + private repos) · ~US$0/month · limit: 2,000 CI minutes/month on private repos. · API: yes
- Fallback: —
- Verified: 2026-09-18

### Stripe
- Purpose: Payments and subscriptions (founder lifetime, monthly, annual).
- Why: The relay already contains the full billing flow; it's switched off until you create prices and keys.
- Data: Once on: active subscriptions, MRR and paid invoices read hourly. Until then revenue is what you record by hand in System.
- Automatic: Checkout, webhooks, trial start on kit receipt, Israeli invoice numbering — all in the relay.
- You do: Decide when to switch billing on. Record kit sales by hand until then.
- Open the vendor when: Refunds, disputes, payouts.
- Cost: paid · Per transaction (~2.9% + fixed fee in Israel) · ~US$0/month · limit: — · API: yes
- Fallback: Manual revenue entries in the Desk.
- Verified: 2026-09-18

### Google Workspace (ziggy-home.com mail)
- Purpose: A real hello@ziggy-home.com mailbox and a company identity for Google services.
- Why: The address is printed on the site and in the privacy policy and currently receives nothing — the domain has no mail records at all.
- Data: —
- Automatic: —
- You do: Sign up once; then use it as the owner of Analytics, Ads, Search Console and vendor accounts.
- Open the vendor when: Daily, for mail.
- Cost: paid · Business Starter · ~US$8.4/month · limit: US$8.40/user/month monthly (US$7 annual). Free alternative: Cloudflare Email Routing forwards hello@ to Gmail. · API: no
- Fallback: Cloudflare Email Routing (free forwarding).
- Verified: 2026-09-18

### Cloudflare
- Purpose: DNS for ziggy-home.com and the private tunnels that connect each home.
- Why: Free, and the tunnels are what make homes reachable without touching customers' routers.
- Data: —
- Automatic: The relay creates a tunnel and hostname per new home.
- You do: Add DNS records when a vendor asks (mail, verification) — or give Claude a DNS-edit token to do it.
- Open the vendor when: DNS changes; tunnel problems.
- Cost: free · Free · ~US$0/month · limit: — · API: yes
- Fallback: —
- Verified: 2026-09-18

### Bitwarden
- Purpose: Where you and Tslil keep every password and API key.
- Why: Keys live in Fly secrets for the apps; humans need a copy somewhere safe and shared.
- Data: —
- Automatic: —
- You do: Store each credential as you create it.
- Open the vendor when: Whenever you need a password.
- Cost: free · Free organisation (2 members) · ~US$0/month · limit: 2 members on the free org. · API: no
- Fallback: —
- Verified: 2026-09-18

### Fly.io
- Purpose: Hosts the Desk, the relay, the website and Jeff.
- Why: Cheap, in Frankfurt, deploys with one command.
- Data: —
- Automatic: Health checks restart a crashed app.
- You do: Nothing. Billing is monthly on the card on file.
- Open the vendor when: Billing, or if an app will not start.
- Cost: paid · Pay as you go · ~US$14.0/month · limit: Total for Desk + relay + website + Jeff ≈ US$14/month (compute only; the free tier ended in 2024). · API: yes
- Fallback: —
- Verified: 2026-09-18

## How Ziggy runs (automation map)

### A visitor becomes a lead
Trigger: Someone submits the waitlist, 'Send me this setup' in Define Your Home, or the in-app page.

- [AUTO] The website records the visit and attribution (after consent) and posts the lead to the Desk. If the Desk is unreachable it posts to Jeff instead — no lead is lost.
- [AUTO] The Desk deduplicates by email, keeps first- and last-touch source, and stores the Define answers in full.
- [AUTO] Fan-out with retries: Jeff (your signup email), HubSpot (contact + stage 'new lead'), Brevo (list or double opt-in), GA4 and PostHog (a 'lead_created' conversion with the lead id, never the email).
- [ACTION] 'New lead' appears in Today. You contact them and move the stage (Sales or HubSpot).
- [AUTO] Stage changes made in HubSpot flow back to the Desk every 15 minutes; Marketing shows cost per lead.

### A customer home goes offline
Trigger: A hub stops reporting, or reports Home Assistant unreachable / coordinator down / many devices lost.

- [AUTO] Every hub reports health every 5 minutes. The relay evaluates silence first: 20 minutes late = degraded, 60 minutes = down.
- [AUTO] Safe repairs run automatically (reconcile devices, recover Home Assistant) with a 30-minute cooldown and a 3-attempt cap, every attempt audited.
- [AUTO] The Desk reads the relay's verdict every 5 minutes; a down home opens an urgent item in Today and fires the notification webhook. Recovery closes it automatically.
- [ACTION] Only if repairs escalated or the home is silent: call the customer (power? internet?) or open a support session from the founder console.

### An Instagram post or an ads change goes live
Trigger: Astra drafts a post, or Claude proposes a Google Ads change.

- [AUTO] The draft lands in the Instagram or Ads queue with a preview and a rationale.
- [APPROVAL] You (or Tslil) approve, request changes (the agent rewrites), or reject. Nothing publishes without this.
- [AUTO] Approved items publish at the scheduled time; failures come back to the queue. Ads changes wait for the Google developer token — until then Claude executes by hand and marks them done.

### A purchase (when billing is switched on)
Trigger: A customer checks out on the site.

- [AUTO] Stripe checkout; the relay reserves a founder slot before creating the session (30 cap).
- [AUTO] Stripe webhooks update the home's subscription state; a 14-day trial starts when you mark the kit received; Israeli invoice numbers are assigned.
- [ACTION] You image and ship the kit, then mark 'kit received'. HubSpot stage → customer.
- [AUTO] Revenue metrics (MRR, paid invoices) refresh hourly in System.

### Something breaks in an app
Trigger: The Desk, the relay, Jeff or the website throws an error.

- [AUTO] Sentry groups the error. UptimeRobot notices if a service stops answering.
- [AUTO] The Desk reads both every 10–15 minutes. An issue with 10+ events in a day, or a DOWN monitor, opens a Today item and fires the webhook. Quiet issues stay in System.
- [ACTION] Read the item, ask Claude to fix it with the Sentry link.

### A software release reaches customer homes
Trigger: Code is merged to main.

- [AUTO] GitHub runs the test suite on every push.
- [ACTION] You run ship.sh, which cuts a release tag. This is the only way code reaches a home.
- [AUTO] Each home's updater pulls the tag within 2 minutes and reports its version; Operations shows convergence and any drift.

### A customer asks for help
Trigger: Mail to support@ / hello@, or a Freshdesk ticket.

- [AUTO] On Freshdesk's paid plan: tickets are read every 15 minutes. Otherwise mail forwarded to the Desk's inbound address becomes a support item.
- [AUTO] Urgent requests open a Today item.
- [ACTION] You answer; mark pending or resolved.

### Every morning
Trigger: 07:30 Israel time.

- [AUTO] The Desk sends a Hebrew digest to your notification channel: leads, fleet status, open items, spend.
- [ACTION] You open Today. Thirty seconds: healthy? broken? what needs me?

## Setup tasks

- **Ziggy Desk deployed** (Foundation) — The Desk itself, with the company pages. Why: Everything else feeds into it.
- **Lead engine live** (Foundation) — The website posts leads to the Desk; the Desk stores, deduplicates and fans them out. Why: So no lead is lost and every lead has a source.
- **Tests run on every push** (Foundation) — GitHub Actions for the Desk and Ziggy_PC. Why: Nothing ships untested.
- **Business email: hello@ziggy-home.com** (Company) — A mailbox that actually receives mail at the address printed on the site. Why: Today the domain has no mail records: customers who write to hello@ get nothing back.
- **Let Claude write DNS records** (Company) — A Cloudflare token that can edit DNS for ziggy-home.com only. Why: Mail, Search Console, Brevo and Google all want DNS records; with this token Claude adds them for you and you never touch DNS.
- **Shared password vault** (Company) — A Bitwarden organisation 'Ziggy' with Tslil invited. Why: Every key below needs a safe home you both can reach.
- **Google service account (reads Analytics and Search Console)** (Marketing) — One Google Cloud project with a 'robot' account the Desk uses to read reports. Why: Google's reporting APIs only talk to service accounts.
- **Google Analytics 4** (Marketing) — A GA4 property for ziggy-home.com. Why: Traffic sources, campaigns, and conversions that Google Ads can learn from.
- **Google Search Console** (Marketing) — Verify ziggy-home.com as a Domain property. Why: See which searches bring people.
- **PostHog** (Marketing) — A PostHog project on the EU cloud. Why: Funnels, session replay and product usage — free at our size.
- **HubSpot CRM** (Sales) — A free HubSpot account and one 'private app' token. Why: Your customer list, on the web and on your phone.
- **Brevo (email)** (Marketing) — A free Brevo account, an API key, and the sender domain. Why: Email to leads with consent handled properly.
- **Sentry (errors)** (System) — A free Sentry org with four projects. Why: So a crash in the cloud is seen before a customer calls.
- **UptimeRobot (uptime)** (System) — A free account with two API keys. Why: The one watcher outside our own servers.
- **Connect the Desk to the Ziggy cloud** (Operations) — Copy the relay's monitor login to the Desk. Why: Operations and Today need the fleet verdict; Claude cannot read Fly secrets.
- **Meta: Instagram publishing and ad spend** (Marketing) — A System User token in Meta Business. Why: Publishes approved posts and reads ad spend; a System User token does not expire every 60 days.
- **Google Ads API access** (Marketing) — Developer token (pending Google's review) plus an OAuth client and refresh token. Why: Spend and cost per lead in Marketing; publishing approved changes.
- **Notification channel (Slack/Discord/WhatsApp)** (Company) — An incoming webhook the Desk posts Hebrew messages to. Why: Daily digest, a home going down, a publish failing — pushed to where you already look.
- **GitHub read token** (System) — A fine-grained token that can only read the three Ziggy repos. Why: Open PRs and the latest release tag on System.
- **Freshdesk (optional)** (Support, optional) — A help desk, if you want one. Why: On the Free plan the Desk cannot read tickets (no API); the Desk's own support inbox already works. Only worth it on a paid plan.
- **Stripe (when you want billing on)** (Revenue, optional) — Prices for the three plans and a read-only key for the Desk. Why: Turns on the relay's dormant billing and automates revenue numbers.
- **Deploy the website with analytics** (Marketing) — Publish the new consent banner, analytics and lead pipeline. Why: Nothing is measured until this is live.
- **Ship the hub/relay changes** (Operations) — Merge branch feat/company-os and run ship.sh; deploy the relay. Why: Feature-usage counters, error bursts and cloud error monitoring only exist after this reaches homes.
