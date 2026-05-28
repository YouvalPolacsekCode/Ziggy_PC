# Ziggy Android — Play Store Data Safety Declaration (DRAFT)

**Status:** Working draft. Not legally reviewed. Submitted as the Data Safety section of the Play Console listing once finalised.
**Last updated:** 2026-05-28
**Source of truth for policy:** [`../legal/PRIVACY.md`](../legal/PRIVACY.md).
**Companion (iOS):** [`APP_STORE_DATA_SAFETY.md`](APP_STORE_DATA_SAFETY.md).

This document is the structured answer to Google's Data Safety form for the Ziggy Android app (Capacitor wrapper of the existing PWA + `/api/mobile/*` endpoints + FCM for push). Google's schema is **distinct** from Apple's; do not assume parity. Each data type is declared independently here.

Google's schema asks, for every data type the app handles:

1. **Is this data collected?** (Yes / No)
2. **Is this data shared with third parties?** (Yes / No — note: this is different from "tracking" in Apple's vocabulary)
3. **Is collection of this data required, or can the user opt out?** (Required / Optional)
4. **What are the purposes?** (App functionality, Analytics, Developer communications, Advertising or marketing, Fraud prevention/security/compliance, Personalization, Account management)
5. **Is data encrypted in transit?** (Yes / No)
6. **Can the user request that data be deleted?** (Yes / No)

For all data types below, the answers to questions 5 and 6 are **Yes** unless otherwise noted (TLS 1.2+ in transit per [`../legal/PRIVACY.md`](../legal/PRIVACY.md) §13; user-initiated deletion per [`../legal/PRIVACY.md`](../legal/PRIVACY.md) §7).

We do not share data with third parties for advertising or marketing. The only "sharing" that occurs is with operational processors strictly necessary for the app to function (see [`../legal/PRIVACY.md`](../legal/PRIVACY.md) §9). Google's framework treats some of these as "sharing" — we declare them honestly.

<!-- LAWYER REVIEW: confirm Google's current definition of "shared" — at the time of writing, sharing means data is transferred to a third party that may use it for their own purposes. Processors acting on our instructions per a DPA are sometimes excluded; verify per current policy text. -->

---

## Categories overview

Google groups data into categories. For each, this document lists the specific data types we collect and the structured answers to Google's six questions.

### 1. Personal info

| Data type | Collected? | Shared? | Required? | Purposes | Encrypted in transit? | Deletable? |
|---|---|---|---|---|---|---|
| Name | No | — | — | — | — | — |
| **Email address** | **Yes** | No | Required | Account management, App functionality, Fraud prevention/security/compliance | Yes | Yes |
| User IDs (account id / home id) | **Yes** | No | Required | Account management, App functionality | Yes | Yes |
| Address | No (unless customer enters it for kit purchase on the web) | — | — | — | — | — |
| Phone number | No | — | — | — | — | — |
| Race and ethnicity | No | — | — | — | — | — |
| Political or religious beliefs | No | — | — | — | — | — |
| Sexual orientation | No | — | — | — | — | — |
| Other info | No | — | — | — | — | — |

<!-- LAWYER REVIEW: confirm whether Stripe-collected payment metadata counts as "shared" under Google's framework. Stripe acts as our payment processor under a DPA — Google's framework usually classes this as processing, not sharing, but reviewer expectations vary. -->

### 2. Financial info

| Data type | Collected? | Shared? | Required? | Purposes | Encrypted in transit? | Deletable? |
|---|---|---|---|---|---|---|
| User payment info (card PAN, bank account) | **No** — Stripe handles cards; we never receive PAN | — | — | — | — | — |
| **Purchase history** (Subscription plan + status) | **Yes** | No | Required | Account management, App functionality | Yes | Yes |
| Credit score | No | — | — | — | — | — |
| Other financial info | No | — | — | — | — | — |

The Android app surfaces subscription status from the Ziggy backend. Per the same "external link" model used on iOS (locked decision in [`../DECISIONS.md`](../DECISIONS.md), Prompt 9 scope), subscription purchase happens on the web, not in-app. Google's "Reader app" / "external billing" rules differ from Apple's — re-verify at submission time.

<!-- LAWYER REVIEW + PLAY REVIEW: confirm Google's current external-billing allowance for SaaS-style subscriptions and the resulting Data-Safety classification. -->

### 3. Health and fitness

| Data type | Collected? |
|---|---|
| Health info | **No** |
| Fitness info | **No** |

### 4. Messages

| Data type | Collected? |
|---|---|
| Emails | **No** |
| SMS or MMS | **No** |
| Other in-app messages | **No** (the in-app assistant chat is a transient interface; messages are not persisted by the Android app itself) |

The "chat" with Ziggy's assistant is processed on the user's hub. We do not store this on Google-classified terms. Voice transcripts are covered separately under "Audio files" below.

### 5. Photos and videos

| Data type | Collected? |
|---|---|
| Photos | **No** |
| Videos | **No** |

### 6. Audio files

| Data type | Collected? | Shared? | Required? | Purposes | Encrypted in transit? | Deletable? |
|---|---|---|---|---|---|---|
| **Voice or sound recordings** | **Yes — only when user actively pushes the mic button (PTT)** | **Yes — only on fallback when local STT fails; transmitted to OpenAI Whisper API at request time** | Optional (user can decide not to use voice) | App functionality | Yes (TLS 1.2+; tunnel E2E encrypted) | Yes (transcripts on the hub are user-deletable; cloud transmission is transient, not persisted by us) |
| Music files | No | — | — | — | — | — |
| Other audio files | No | — | — | — | — | — |

**Voice flow detail (matches `../legal/PRIVACY.md` §5):**

- Capture is push-to-talk only. No wake-word in v1.
- STT is local-first via Whisper on the user's mini PC.
- If local Whisper fails, the audio chunk for that turn is sent to OpenAI Whisper API and discarded immediately on return.
- The audio is NOT persisted by the Android app or by Ziggy Cloud.

Google's framework will likely classify this as "Voice or sound recordings" with the conservative reading that the data is shared with a third party (OpenAI). We declare it that way.

<!-- LAWYER REVIEW + PLAY REVIEW: confirm declaration of OpenAI Whisper fallback as "shared." The alternative reading is that OpenAI is a processor under our DPA. Google has historically asked submitters to declare conservatively. -->

### 7. Files and docs

| Data type | Collected? |
|---|---|
| Files and docs | **No** |

### 8. Calendar

| Data type | Collected? |
|---|---|
| Calendar events | **No** |

### 9. Contacts

| Data type | Collected? |
|---|---|
| Contacts | **No** |

### 10. App activity

| Data type | Collected? | Shared? | Required? | Purposes | Encrypted in transit? | Deletable? |
|---|---|---|---|---|---|---|
| App interactions (which screens visited, taps) | **No** | — | — | — | — | — |
| In-app search history | **No** | — | — | — | — | — |
| Installed apps (list of apps on the device) | **No** | — | — | — | — | — |
| **Other user-generated content** (home/device state — room names, automation names, scenes) | **Yes** | No | Required | App functionality | Yes | Yes |
| Other actions | No | — | — | — | — | — |

We do not have any product-analytics SDK in v1. Re-verify each release.

<!-- LAWYER REVIEW: confirm "no analytics" stance by inspecting Capacitor plugin set + Firebase SDK + Gradle dependencies at each release. Firebase SDK is used only for FCM; verify analytics module is not present. -->

### 11. Web browsing

| Data type | Collected? |
|---|---|
| Web browsing history | **No** |

### 12. App info and performance

| Data type | Collected? | Shared? | Required? | Purposes | Encrypted in transit? | Deletable? |
|---|---|---|---|---|---|---|
| **Crash logs** | **Yes** — Google Play crash reporting (only if user opts in at OS level; anonymous from our perspective) | No (Google Play handles aggregation) | Optional (user-controlled at OS level) | App functionality | Yes | N/A (anonymous data; deletion governed by Google Play's policies) |
| Diagnostics | No | — | — | — | — | — |
| Other app performance data | No | — | — | — | — | — |

We do not use a third-party crash SDK. Reports come only via Google Play's standard mechanism, which is opt-in at OS level and anonymous from our perspective.

<!-- LAWYER REVIEW + PLAY REVIEW: confirm classification of OS-level crash reporting under Google's framework — historically declared "Collected: No" because the data is sent to Google, not to us. Verify current expectation. -->

### 13. Device or other IDs

| Data type | Collected? | Shared? | Required? | Purposes | Encrypted in transit? | Deletable? |
|---|---|---|---|---|---|---|
| **Device or other IDs** | **No** — we do **not** collect Android Advertising ID, Android ID, SSAID, IMEI, build serial, or any device fingerprint for our own use. | — | — | — | — | — |
| **FCM token** (separate from device ID) | **Yes — declared under "Other Data" / "App functionality"** | No | Required | App functionality (delivering notifications) | Yes | Yes (token is removed on un-pair) |

FCM token registration is **not** an Android Advertising ID and is not a device fingerprint. We treat it as a per-installation push routing token. Google's framework asks about Device IDs specifically for tracking/advertising purposes — that is not what FCM tokens are. We declare FCM token under "App functionality" only.

<!-- LAWYER REVIEW + PLAY REVIEW: confirm FCM token classification under Data Safety. Historically declared separately or under "Other Data"; do not conflate with Android Advertising ID. -->

---

## Location (declared separately by Google)

Google's form treats location as a top-level category alongside the data-type list above.

| Sub-type | Collected? | Shared? | Required? | Purposes | Encrypted in transit? | Deletable? |
|---|---|---|---|---|---|---|
| **Approximate location** | **Yes — opt-in, when user enables presence-based automations** | No | Optional | App functionality (geofence triggers) | Yes | Yes |
| **Precise location** | **Yes — same opt-in conditions** | No | Optional | App functionality (geofence accuracy) | Yes | Yes |

**Background location declaration:**

If the user grants "Allow all the time" (background) on Android, this triggers Google Play's separate **Background Location** review process. We submit:

- A clear justification: presence-based automations (home/away detection) require periodic location updates while the app is not foreground. Without background access, the geofence cannot fire reliably when the user is in their pocket.
- A short demonstration video showing the consent prompt + the in-app explanation of what background location is used for.
- A statement that background location is **not** used for any other purpose (no ad targeting, no profiling, no aggregation, no sharing).

Background location is **optional**. The user can grant only foreground (`ACCESS_FINE_LOCATION` without `ACCESS_BACKGROUND_LOCATION`) and lose only the in-pocket reliability of geofence automations. All other Ziggy features continue to work.

<!-- LAWYER REVIEW + PLAY REVIEW: background location declaration is the highest-risk reviewer touchpoint for the Android app. Wording, video, and the in-app consent screen design (see `IN_APP_LEGAL_SURFACES.md`) must align. -->

---

## "Data shared" summary

Google asks us to list every third party with whom we share data. Per our policy and per [`../legal/PRIVACY.md`](../legal/PRIVACY.md) §9:

| Third party | What is shared | Purpose | Required? |
|---|---|---|---|
| OpenAI (Whisper API as STT fallback; gpt-4o-mini for cloud-LLM fallback) | Audio chunk OR transcript text at request time | App functionality | Optional (occurs only when local fails and only if the user chose to send the request) |
| Anthropic (cloud-LLM fallback, under consideration, not active in v1) | Transcript text at request time | App functionality | Optional |
| Cloudflare | Encrypted tunnel bytes (Cloudflare cannot read content) | App functionality | Required |
| Fly.io | Relay disk contents (account/home metadata) | App functionality | Required |
| Backblaze B2 | Encrypted backup blobs (we hold the master key; Backblaze cannot read) | App functionality | Optional (backups only run while Subscription is active) |
| Stripe | Payment metadata (handled on the web, not via the Android app) | App functionality | Required for paid plans |
| Google (APNs's Android equivalent, FCM) | Push token + notification payload | App functionality | Required for push notifications |

Note that the Android app itself does not directly share with Stripe — subscription purchase happens on the web. But under Google's strict reading of the form, the operational chain involving Stripe is declared.

<!-- LAWYER REVIEW: confirm whether "data shared" includes processors-under-DPA per current Play Console wording. Historical guidance: yes, declare conservatively. -->

---

## Data deletion

Google's form asks whether users can request data deletion. Per [`../legal/PRIVACY.md`](../legal/PRIVACY.md) §11 and the design in [`IN_APP_LEGAL_SURFACES.md`](IN_APP_LEGAL_SURFACES.md):

- In-app: Settings → Account → Delete Account.
- 30-day cloud-side purge + confirmation email when complete.
- Local hub data is the user's and is not remotely wiped; the user can wipe the hub themselves.

We answer **Yes** to Google's "Can the user request data deletion?" question.

---

## Security practices declarations

Google asks several yes/no questions about security practices.

| Question | Answer |
|---|---|
| Data is encrypted in transit | **Yes** — TLS 1.2+ + tunnel E2E encryption |
| You provide a way for users to request data deletion | **Yes** — in-app + email |
| You follow Google Play's Families Policy (if applicable) | **N/A** — Ziggy is not directed at children. Target audience is adult homeowners. |
| Your data collection and handling practices have been independently validated by a third party | **No** — not yet. To revisit before commercial launch at scale. |

<!-- LAWYER REVIEW + PLAY REVIEW: third-party validation question can be answered No truthfully but may be a soft signal to reviewers. Consider commissioning a privacy audit once revenue justifies it. -->

---

## Cross-references

- Policy text: [`../legal/PRIVACY.md`](../legal/PRIVACY.md)
- In-app consent screen designs: [`IN_APP_LEGAL_SURFACES.md`](IN_APP_LEGAL_SURFACES.md)
- iOS counterpart declaration: [`APP_STORE_DATA_SAFETY.md`](APP_STORE_DATA_SAFETY.md)
- Mobile route audit: [`MOBILE_ROUTE_AUDIT.md`](MOBILE_ROUTE_AUDIT.md)
- Locked product decisions: [`../DECISIONS.md`](../DECISIONS.md)

---

## Change log

- 2026-05-28 — Initial draft (Prompt 11, Chunk 2). Not yet submitted to Play Console.

<!-- LAWYER REVIEW: re-run this entire document any time the Capacitor plugin set, Firebase SDK / Gradle dependency set, or any native plugin changes. A dependency update can introduce data collection without code-side awareness. -->
