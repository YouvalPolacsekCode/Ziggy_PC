# Ziggy iOS — App Privacy Declaration (DRAFT)

**Status:** Working draft. Not legally reviewed. Submitted as the App Privacy section of the App Store Connect listing once finalised.
**Last updated:** 2026-05-28
**Source of truth for policy:** [`../legal/PRIVACY.md`](../legal/PRIVACY.md).

This document is the structured answer to every Apple App Privacy question for the Ziggy iOS app (Capacitor wrapper of the existing PWA + `/api/mobile/*` endpoints). The schema below matches Apple's App Store Connect "App Privacy" workflow at the time of drafting. If Apple changes the schema before submission, re-verify each section.

Apple's schema asks, for every data type the app handles:

1. **Is the data collected?** (Yes / No)
2. **Is the data linked to the user's identity?** (Yes / No)
3. **Is the data used to track the user across other apps or websites?** (Yes / No)
4. **What purposes is the data used for?** (Third-party advertising / Developer's advertising or marketing / Analytics / Product personalization / App functionality / Other purposes)

Tracking, in Apple's vocabulary, means linking the user's data with third-party data for advertising or sharing with a data broker. Ziggy does **none** of this. Therefore the answer to question 3 is **No** for every data type below.

We do not display advertising of any kind. We have no analytics SDK. We have no marketing-attribution SDK. The only third parties involved in data flow are operational processors that exist for the app to function (see [`../legal/PRIVACY.md`](../legal/PRIVACY.md) §9).

<!-- LAWYER REVIEW: confirm Apple's "tracking" definition still excludes operational processors that exist solely to deliver the user-requested service. -->

---

## Categories overview

Apple groups data into categories. For each, this document lists the specific data types we collect and the answers to Apple's four questions.

### 1. Contact Info

| Data type | Collected? | Linked to user? | Used for tracking? | Purposes |
|---|---|---|---|---|
| Name | No | — | No | — |
| **Email address** | **Yes** | **Yes** | **No** | App functionality (login, account recovery, billing receipts, security notices) |
| Phone number | No | — | No | — |
| Physical address | No (unless customer enters it for invoice purposes) | — | No | — |
| Other user contact info | No | — | No | — |

<!-- LAWYER REVIEW: confirm whether the customer's optional physical address (entered at checkout for the kit) needs to be declared even though the iOS app itself does not collect it (kit purchase happens on the web). -->

### 2. Health & Fitness

| Data type | Collected? |
|---|---|
| Health | **No** |
| Fitness | **No** |

### 3. Financial Info

| Data type | Collected? | Linked to user? | Used for tracking? | Purposes |
|---|---|---|---|---|
| Payment info (card PAN / bank account) | **No** — Stripe handles cards; we never receive PAN | — | — | — |
| Credit info | No | — | — | — |
| Other financial info | No | — | — | — |

Subscription purchase status (active / cancelled / past-due) is held in the Ziggy backend tied to the account, but the iOS app itself displays this as read-only state, it does not collect it. We declare this under "App functionality" if Apple requires.

<!-- LAWYER REVIEW: confirm Apple's classification of Stripe-mediated subscription state — is it "Financial Info" collection by us, or out-of-scope because the card is collected by Stripe directly on the web? -->

### 4. Location

| Data type | Collected? | Linked to user? | Used for tracking? | Purposes |
|---|---|---|---|---|
| **Precise location** | **Yes — opt-in, when user enables presence-based automations** | **Yes (to user's home)** | **No** | App functionality (geofence triggers for home/away automations) |
| **Coarse location** | **Yes — same opt-in conditions as precise** | **Yes (to user's home)** | **No** | App functionality |

**Honest framing for the App Privacy "What you'll need to declare" question:**

- Location is **opt-in**. The default state on a fresh install is "not collected."
- The user enables location by toggling on presence-based automations in Settings.
- iOS authorisation flows used: **While Using the App** for foreground; **"Always"** if the user wants background geofence (with the iOS-supplied periodic location-access reminders).
- Raw coordinate streams stay on the device and on the user's mini PC. They are not transmitted to Ziggy Cloud or any third party.
- Background location is used only to evaluate the home geofence. We do not derive any other inference from background location.

<!-- LAWYER REVIEW + APP REVIEW: Apple reviewers may ask for screen recordings demonstrating that background location is only used for geofence + that the user is given a clear "what we use it for" justification before requesting "Always." Be ready to show this; design lives in `IN_APP_LEGAL_SURFACES.md`. -->

### 5. Sensitive Info

| Data type | Collected? |
|---|---|
| Sensitive info (racial/ethnic data, sexual orientation, pregnancy/childbirth, disability, religious/philosophical beliefs, trade union membership, political opinion, genetic info, biometric data) | **No** |

### 6. Contacts

| Data type | Collected? |
|---|---|
| Contacts | **No** |

### 7. User Content

| Data type | Collected? | Linked to user? | Used for tracking? | Purposes |
|---|---|---|---|---|
| Emails or text messages | No | — | — | — |
| Photos or videos | No | — | — | — |
| **Audio data** | See note below | — | — | — |
| Gameplay content | No | — | — | — |
| **Customer support content** | **Yes — if the user emails support@** | **Yes** | **No** | App functionality (responding to support) |
| Other user content | No | — | — | — |

**Audio data note.**

Apple's "Audio data" category covers user-generated audio. The Ziggy iOS app captures audio only via the push-to-talk mic flow when the user actively taps the mic button. The audio is then either:

- Transcribed on the user's mini PC (Whisper local), or
- Sent at request time to OpenAI Whisper API for fallback STT when local Whisper fails.

The iOS app itself does not store the audio. We do not declare "Audio" as collected by the iOS app under Apple's framework because Apple's question is "does the app collect this data" and the iOS app is a transient capture surface that streams to the user's hub. **However**, if Apple's reviewers prefer a conservative declaration, we can change this to **Collected = Yes, Linked = Yes, Tracking = No, Purpose = App functionality.**

Final decision pending: conservative-Yes vs. accurate-No.

<!-- LAWYER REVIEW + APP REVIEW: pick one of the two declarations above and stick with it. Apple's framework favours conservative-Yes when in doubt. Recommend declaring Audio as Yes / Linked / No-tracking / App-functionality. -->

### 8. Browsing History

| Data type | Collected? |
|---|---|
| Browsing history | **No** |

### 9. Search History

| Data type | Collected? |
|---|---|
| Search history | **No** — the in-app search of devices/automations runs on the local hub; we don't store searches centrally. |

### 10. Identifiers

| Data type | Collected? | Linked to user? | Used for tracking? | Purposes |
|---|---|---|---|---|
| **User ID** (Ziggy account id / home id) | **Yes** | **Yes** | **No** | App functionality, account management |
| **Device ID** | **No** — we do not collect IDFV, IDFA, vendor identifier, or any device fingerprint for our own use. | — | — | — |

Apple's "User ID" question covers internal account identifiers. We collect and persist a Ziggy account id and a home id. These are not Apple identifiers; they are our own.

We do **not** request `App Tracking Transparency` permission because we do not perform any operation that requires it (no IDFA access, no tracking-domain SDK).

### 11. Purchases

| Data type | Collected? | Linked to user? | Used for tracking? | Purposes |
|---|---|---|---|---|
| **Purchase history** (Subscription plan + status + billing dates) | **Yes** | **Yes** | **No** | App functionality, account management |

The iOS app surfaces subscription status from the Ziggy backend (Stripe-backed). Per Apple's "reader app" allowance, the iOS app does **not** sell subscriptions directly — it shows a deep link to the Ziggy web site (see Prompt 9 + locked decision in [`../DECISIONS.md`](../DECISIONS.md)).

<!-- LAWYER REVIEW + APP REVIEW: confirm App Store reviewer expectation around the reader-app deep link. Apple's rules tightened around external links in 2024–2025; check current allowance before submission. -->

### 12. Usage Data

| Data type | Collected? | Linked to user? | Used for tracking? | Purposes |
|---|---|---|---|---|
| Product interaction (taps, screens viewed) | **No** | — | — | — |
| Advertising data | **No** | — | — | — |
| Other usage data | **No** | — | — | — |

We do not have any product-analytics SDK in v1. We rely on customer support conversations and direct usage observation. If we add an analytics SDK in v1.1 or later, we will re-file the App Privacy declaration.

<!-- LAWYER REVIEW: confirm "no analytics" stance — re-verify each release by inspecting the Capacitor plugin set + Podfile + the Firebase SDK (used only for FCM). FCM token registration is not "Usage Data" but verify Apple's classification. -->

### 13. Diagnostics

| Data type | Collected? | Linked to user? | Used for tracking? | Purposes |
|---|---|---|---|---|
| **Crash data** | **Yes — only if the user opts in to Apple's Diagnostics & Usage sharing at OS level** | **No (anonymous on the OS-mediated path)** | **No** | App functionality (diagnosing crashes) |
| Performance data | No | — | — | — |
| Other diagnostic data | No | — | — | — |

We do not use a third-party crash SDK (no Sentry, no Crashlytics, etc.). We receive crash reports only via Apple's standard mechanism, which is opt-in at OS level and is anonymous from our perspective.

<!-- LAWYER REVIEW + APP REVIEW: confirm the wording "anonymous on the OS-mediated path" matches Apple's framework's expectations. -->

### 14. Surroundings

| Data type | Collected? |
|---|---|
| Environment scanning (LiDAR, etc.) | **No** |

### 15. Body Data

| Data type | Collected? |
|---|---|
| Body / face data | **No** |

### 16. Other Data

| Data type | Collected? | Linked to user? | Used for tracking? | Purposes |
|---|---|---|---|---|
| **Push notification token (APNs)** | **Yes** | **Yes** (linked to home id) | **No** | App functionality (delivering notifications) |
| **Home/device state metadata** (room names, device names, automation names) | **Yes** | **Yes** | **No** | App functionality (rendering the user's home in the app) |

Per Apple's framework, push tokens are typically declared under either "Identifiers" or "Other Data" — different reviewers have classified differently. We declare under "Other Data" with explicit purpose = App functionality.

Home/device state metadata is fetched from the user's hub through the Cloudflare Tunnel; the iOS app caches it locally for offline display. This is "User content" in spirit but lives in the "Other Data" bucket per Apple's schema.

<!-- LAWYER REVIEW + APP REVIEW: confirm Apple's preferred classification for push tokens (Identifiers vs. Other Data) at submission time. -->

---

## Apple-required summary by Privacy "Type"

Apple displays privacy facts to the App Store user in a summary card. For Ziggy iOS, the summary will look like:

- **Data Not Collected** — Health & Fitness, Financial Info, Contacts (the user's), Browsing History, Search History, Advertising / Tracking IDs, Sensitive Info, Body Data, Surroundings, photos/videos, emails/messages.
- **Data Linked to You** — Contact Info (email), Location (only if user enables presence), Identifiers (User ID), Purchases, Customer Support, Other Data (push token, home/device state), Audio (pending the conservative-Yes / accurate-No decision).
- **Data Not Linked to You** — Diagnostics (crash data, opt-in via OS-level).
- **Data Used to Track You** — None.

<!-- LAWYER REVIEW + APP REVIEW: this summary card is the customer-facing leverage point. Wording must be exact and conservative. -->

---

## Cross-references

- Policy text: [`../legal/PRIVACY.md`](../legal/PRIVACY.md)
- In-app consent screen designs: [`IN_APP_LEGAL_SURFACES.md`](IN_APP_LEGAL_SURFACES.md)
- Mobile route audit: [`MOBILE_ROUTE_AUDIT.md`](MOBILE_ROUTE_AUDIT.md)
- Locked product decisions: [`../DECISIONS.md`](../DECISIONS.md)

---

## Change log

- 2026-05-28 — Initial draft (Prompt 11, Chunk 2). Not yet submitted to App Store Connect.

<!-- LAWYER REVIEW: re-run this entire document any time the Capacitor plugin set, Firebase SDK, or any native dependency changes. A plugin update can change "what is collected" without code-side awareness. -->
