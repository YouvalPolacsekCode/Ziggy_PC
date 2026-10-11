# Ziggy analytics specification (canonical)

One vocabulary for every event Ziggy emits, on the website, in the product
and server-side. Vendors (GA4, PostHog, HubSpot, Brevo) receive projections
of this vocabulary; nothing is named per vendor.

## 1. Identity

| Id | Where it is minted | Lifetime | Who receives it |
|---|---|---|---|
| `anonymous_id` | website, `localStorage['ziggy-aid']`, random UUID | until storage cleared | PostHog `distinct_id`, GA4 `client_id` (GA mints its own; we send ours as `user_properties.ziggy_aid` only after consent) |
| `session_id` | website, `sessionStorage['ziggy-sid']` | tab session | PostHog, GA4 as event param `ziggy_session` |
| `lead_id` | Desk, `ld_` + 12 hex, on first lead record | forever | Desk, HubSpot (`ziggy_lead_id`), Brevo attribute `LEAD_ID`, GA4/PostHog as `lead_id` (**never the email**) |
| `customer_id` | relay `home_id` when a home is provisioned | forever | Desk, HubSpot (`ziggy_home_id`); never to GA4/PostHog from the website |
| `home_id` (product counters) | relay | forever | PostHog server-side `distinct_id = home_id` for feature-usage counters; no person is identified |

Rules: email, name, phone and free text never go to GA4 or PostHog. The
Define "wish" free text goes only to the Desk and HubSpot, and only with
the consent checkbox ticked (already the case on the site).

## 2. Attribution (first touch, persisted)

On first page load the SDK captures and stores `localStorage['ziggy-attr']`:

```
utm_source, utm_medium, utm_campaign, utm_term, utm_content,
gclid, fbclid, ttclid,
referrer (document.referrer host), landing_page (path + hash, no query),
first_seen (ISO), language ('he'|'en')
```

Later visits do not overwrite first-touch; the SDK also keeps a
`last_touch` copy. Every lead POST carries both blocks. Every event carries
`utm_source`, `utm_medium`, `utm_campaign`, `landing_page`, `language`,
`page` (current hash route as a path: `/`, `/define`, `/pricing`).

## 3. Consent

- Banner states: `unset`, `accepted`, `declined`; stored in
  `localStorage['ziggy-consent']` with a timestamp and version.
- Before acceptance: GA4 not loaded (Consent Mode v2 defaults
  `analytics_storage: denied`, `ad_storage: denied`, `ad_user_data: denied`,
  `ad_personalization: denied`); PostHog loaded with `persistence: 'memory'`,
  no session replay, no autocapture; Sentry not loaded.
- On acceptance: gtag `consent update` to `granted`, PostHog
  `set_config({persistence: 'localStorage+cookie'})`, replay starts, Sentry
  loads.
- `essential` server-side events (lead created) do not depend on consent
  because they are a direct consequence of a form the person submitted;
  they carry `lead_id`, never the email.
- Marketing email consent is a separate checkbox on the lead form
  (`consent_marketing`), defaulting to unchecked. Without it the contact is
  created in Brevo as blacklisted and receives a double-opt-in email only.

## 4. Events

Names are `snake_case`. Required properties are listed; every event also
carries the context block from §2. Vendor projections: GA4 event name is
the same string (GA4 allows 40 chars, letters/digits/underscore); PostHog
event name is the same string.

### Website

| Event | Required properties | Fires |
|---|---|---|
| `page_view` | `page`, `title` | initial load and every hash route change |
| `cta_clicked` | `cta` (`nav_waitlist`, `hero_waitlist`, `hero_how`, `mobile_bar_waitlist`, `price_anchor_waitlist`, `price_anchor_inside`, `pack_card`, `pricing_kit`, `define_reserve`, `footer_mail`), `target` | click on any primary CTA |
| `language_changed` | `language` | toggle |
| `define_home_started` | — | first interaction on `/define` (was `Define Start`) |
| `define_home_step_completed` | `step` (`pick`, `config`, `hub`, `research`, `result`, `walk`), `rooms` (count) | stage transitions (was `Define Room Added/Configured/Research/Result/Walk`) |
| `define_room_added` / `define_room_removed` / `define_room_configured` | `room`; configured also `presence`,`lighting`,`ac`,`door`,`appliances` | kept for funnel detail |
| `define_pack_toggled` | `pack`, `direction`, `qty` | result adjustments |
| `define_home_completed` | `rooms`, `packs`, `total_ils`, `tenure`, `annoy` | result rendered (was `Define Result`) |
| `define_result_dwell` | `bucket` | as today |
| `define_abandoned` | `stage` | as today |
| `lead_form_viewed` | `form` (`waitlist`, `define_send`) | form scrolled into view |
| `lead_submitted` | `form`, `kit_intent`, `consent_marketing` | POST sent (client side; may be blocked) |
| `lead_created` | `form`, `lead_id`, `is_new` | **server-side** by the Desk after storing the lead (GA4 Measurement Protocol + PostHog); GA4 marks it a key event; Google Ads conversion imports it |
| `demo_requested` / `beta_requested` | `lead_id` | when the form gains those options (`intent` field on the lead POST: `waitlist` \| `demo` \| `beta`) |
| `checkout_started` / `purchase_completed` | `plan`, `total_ils`, `lead_id?` | reserved for when commerce is on (server-side from the relay's Stripe webhook) |

Legacy names `Define *`, `Waitlist Signup`, `DH_*` are retired; the
`src/lib/defineHomeAnalytics.js` module and the unreachable `#define` page
are deleted.

### Product (hub, counters only)

Emitted from `services/usage_counters.py` as `usage_counters` inside the
5-minute telemetry post, aggregated per hub, no per-user data:

```
{"window_s": 300,
 "counters": {"chat_message": 3, "voice_command": 1, "automation_created": 0,
              "automation_triggered": 12, "routine_run": 2, "device_toggled": 40,
              "scene_applied": 1, "app_open": 5, "onboarding_step": 0, "error_5xx": 0},
 "features_enabled": ["occupancy", "smart_climate", "leave_home"],
 "errors": {"count": 0, "top": []}}
```

The relay forwards each counter as a PostHog event `feature_used` with
`{feature, count, home_id, release_tag, cohort}` (`distinct_id = home_id`).
This gives active homes, feature usage and drop-offs without any person
analytics inside a customer's home.

### Server-side (Desk)

| Event | Properties |
|---|---|
| `lead_created` | `lead_id`, `form`, `intent`, `source`, `is_new`, attribution |
| `lead_stage_changed` | `lead_id`, `from`, `to`, `by` (`hubspot_sync` \| email) |
| `integration_failed` | `connector`, `op`, `attempts` |

## 5. Lead record (Desk `leads` table)

```
lead_id, email (lowercase), name?, phone?, intent (waitlist|demo|beta|define),
form (waitlist|define_send|welcome|meta_lead|import_jeff), language,
kit_intent, define (JSON: rooms, packs, total, tenure, annoy, wish),
consent_marketing (0/1), consent_at,
attribution_first (JSON), attribution_last (JSON), landing_page, referrer,
stage (new|contacted|qualified|demo_beta|customer|lost), stage_updated_at,
hubspot_id?, brevo_id?, jeff_forwarded_at?, home_id?,
created_at, updated_at, source_ip_hash (sha256 with daily salt, for abuse control only)
```

## 6. What each vendor gets

| | GA4 | PostHog | HubSpot | Brevo | Desk |
|---|---|---|---|---|---|
| page/CTA/define events | yes (after consent) | yes (memory before consent, persisted after) | no | no | no |
| `lead_created` | yes, server-side, key event | yes, server-side | contact upsert | contact create/DOI | row + TODAY item |
| email / name / free text | never | never | yes | yes | yes |
| attribution | as event params | as event props + person props on identify(lead_id) | custom `ziggy_*` properties | attributes `UTM_SOURCE` … | JSON columns |
| product counters | no | yes (server-side) | no | no | snapshot |
