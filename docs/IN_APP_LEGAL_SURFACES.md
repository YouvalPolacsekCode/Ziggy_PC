# Ziggy — In-App Legal Surfaces (DESIGN DOC, DRAFT)

**Status:** Working draft. Design doc, not code. Not legally reviewed.
**Last updated:** 2026-05-28
**Source of truth for policy:** [`../legal/PRIVACY.md`](../legal/PRIVACY.md), [`../legal/TERMS.md`](../legal/TERMS.md).
**Companion declarations:** [`APP_STORE_DATA_SAFETY.md`](APP_STORE_DATA_SAFETY.md), [`PLAY_STORE_DATA_SAFETY.md`](PLAY_STORE_DATA_SAFETY.md).

This document specifies the **design** of every in-app surface that touches a legal commitment: account deletion, data export, subscription cancellation, voice-transcript-storage consent, support-tunnel-session consent, and mobile background-location consent. It does **not** contain implementation code. Implementation lives under the separate engineering prompt that consumes this doc.

The design rules below apply to every flow:

1. **No dark patterns.** Confirmation steps are present where there is risk of accidental loss; choices are symmetric (e.g. "Cancel" and "Keep" given equal visual weight); destructive actions never auto-confirm.
2. **Hebrew-first, English secondary.** RTL handling baked in (Israel-first launch per [user memory](../CLAUDE.md)).
3. **Reachable in ≤ 3 taps from the home screen.** Cancellation, export, and delete must not be buried.
4. **In-app + web parity.** Cancellation is exercisable in-app, not only on the website (Apple/Google review expectation).
5. **No external redirect for cancellation.** The cancellation flow stays inside the app — no "tap here to open our website to cancel."
6. **Audit log entry on every legally-relevant action** (cancel, delete, export, consent change, support tunnel approval). Logged to the relay audit log.
7. **Confirmation email** for any irreversible or hard-to-reverse action, sent to the account email.

Sections marked `<!-- LAWYER REVIEW -->` need counsel sign-off before implementation begins. Sections marked `<!-- DESIGN REVIEW -->` are open design questions.

---

## 1. Account deletion flow

### 1.1 Entry points

- **PWA / web:** Settings → Account → Delete Account.
- **iOS / Android:** Same path. Must NOT be web-only.
- **Email-only fallback:** legal@ziggyhome.example, for users locked out of their account.

### 1.2 Screens

**Screen 1 — Settings → Account.**

Shows account email, subscription status, paired devices, language. At the bottom of the screen, two destructive actions with adequate spacing:

- "Export my data" → goes to flow §2.
- "Delete my account" → goes to Screen 2.

The "Delete my account" link is rendered in standard destructive-action red (matches existing destructive-action styling in the app — defer to existing conventions; do not introduce new colour tokens).

**Screen 2 — Delete account confirmation.**

Headline: "Delete your Ziggy account?" (HE: "למחוק את חשבון זיגי שלך?")

Body copy, in plain language:

> When you delete your account:
>
> - Your **cloud-side data is purged within 30 days**: account record, home metadata, billing identifiers, push tokens, and the parts of the audit log that personally identify you.
> - You will receive a confirmation email when the deletion is complete.
> - Your **local hub keeps your data**. Sensors, automations, IR codes, and local voice continue to work. We do not remote-wipe your hub.
> - If you want to wipe your hub as well, do that separately from Settings → System → Factory reset on the hub.
> - Some records (tax invoices) are retained for up to 7 years to meet Israeli tax law. We minimise these.
> - **This action cannot be undone.** You can sign up again later, but the deleted home and Subscription history will not be restored.

Two actions:

- Primary (red, destructive): "Delete my account"
- Secondary (neutral): "Keep my account"

The primary action is **not** enabled until the user types `DELETE` (or the Hebrew equivalent `מחק`) into a single confirmation field. This is the only dark-pattern-adjacent friction we add — and we add it specifically because the action is irreversible.

<!-- DESIGN REVIEW: confirm Hebrew confirmation word. "מחק" is the imperative; "אישור" (confirm) might be more natural. Pick one and lock it. -->

**Screen 3 — Deletion submitted.**

After the user confirms:

- The account is immediately marked `pending_deletion` on the relay.
- The PWA / app signs the user out.
- A confirmation email is sent **immediately**: "We received your account deletion request. Your data will be purged within 30 days. You will receive a second email when it is complete."
- An audit log row is written: `event=account_deletion_requested, account_id=…, ts=…, source=app|web|email`.

Screen 3 displays:

> "Your deletion request is in. We've emailed you a confirmation, and we will email you again when the deletion is complete (within 30 days)."

Single action: "Close."

### 1.3 Backend timing

- **Day 0:** account marked `pending_deletion`. Subscription auto-cancelled if active. Logins disabled. Tunnel access denied.
- **Day 0 → 30:** grace window. If the user emails support to undo, founder can manually rollback (audit-logged).
- **Day 30:** purge runs. Audit log entry: `event=account_deletion_completed`. Second confirmation email sent.
- **After Day 30:** the relay retains only what tax law requires (per [`../legal/PRIVACY.md`](../legal/PRIVACY.md) §11), in pseudonymised form.

<!-- LAWYER REVIEW: 30-day timeline aligned with PRIVACY.md §11 and Israeli/EU norms. Confirm the 7-year tax-record retention obligation is mandatory (not optional). -->

### 1.4 What is NOT deleted

The deletion confirmation copy is explicit about three things that survive deletion:

1. **Local hub data.** The user's hub keeps its automations, history, etc.
2. **Tax records.** Receipts and invoice metadata retained for up to 7 years.
3. **Pseudonymised audit-log rows.** The row is preserved (for incident response) but personal identifiers are stripped.

This is called out in Screen 2 body copy explicitly.

<!-- LAWYER REVIEW: confirm "pseudonymised audit-log retention beyond Day 30" is a legitimate basis under Israeli + EU law. -->

---

## 2. Data export flow

### 2.1 Entry points

Same as deletion: Settings → Account → Export my data (PWA + iOS + Android).

### 2.2 Screens

**Screen 1 — Export request.**

Headline: "Download your data" (HE: "להוריד את הנתונים שלך").

Body copy:

> We will prepare a bundle of everything we hold about you and email you a download link when it is ready. The link expires in 7 days.
>
> The bundle includes:
>
> - Your account record (email, registration date, plan).
> - Your home metadata (home id, friendly name, devices, automations).
> - Voice transcript history we hold on the hub.
> - Subscription and invoice history.
> - The audit-log entries that relate to your account.
>
> The most recent encrypted backup blob is included if you want it, but you will need your **per-home backup key** (which only you hold) to decrypt it.

Two actions:

- Primary: "Email me the bundle"
- Secondary: "Cancel"

**Screen 2 — Request received.**

After tap:

> "We're preparing your bundle. We'll email you a download link, usually within 24 hours, no later than 30 days."

Audit log entry: `event=data_export_requested, account_id=…, ts=…`.

### 2.3 Bundle format

- JSON for the structured records (account, home, automations, voice transcript index, subscription history, audit log).
- The encrypted backup blob (latest only) as a separate file, with a README explaining decryption requires the per-home backup key.
- Hebrew + English README at the bundle root explaining each file.

### 2.4 Delivery

- Link delivered to account email.
- Link is a one-time, signed URL valid for 7 days.
- Bundle is stored on relay disk during the 7-day window, then auto-deleted.

<!-- LAWYER REVIEW: confirm 30-day ceiling on bundle production aligned with Israeli + EU data-subject-access-request norms. -->
<!-- DESIGN REVIEW: should the bundle include the per-home backup key? Default: no — the key is in the founder's safe + 1Password, the user does not have it via the app. Confirm we never break this invariant. -->

---

## 3. Subscription cancellation flow

### 3.1 Constraints

- **In-app cancellation is mandatory** (Apple and Google review expectation, locked decision).
- **No dark patterns.** One confirmation; symmetric buttons; no "Are you really sure?" loops; no "click 3 times to confirm" friction.
- **Web-side cancellation also exists** (because subscription purchase happens on the web per the reader-app deep link strategy in [`../DECISIONS.md`](../DECISIONS.md), so cancellation parity makes sense).
- **No upsells, no save-attempts, no "wait, here's 50% off!"** — at least not in v1. If we ever add a retention offer in v2+, it must be a single screen the user can dismiss with one tap.

### 3.2 Entry points

Settings → Subscription → Manage subscription → "Cancel subscription."

The "Cancel subscription" link is rendered at the same visual weight as the other Subscription actions. It is not hidden behind a "Help" menu or a smaller tap target.

### 3.3 Screens

**Screen 1 — Subscription overview.**

Shows: plan, billing cycle, next charge date, payment method (masked card last 4 from Stripe), button to update payment method (deep-links to Stripe customer portal on the web), button to "Cancel subscription."

**Screen 2 — Cancel confirmation.**

Headline: "Cancel your Ziggy Cloud subscription?" (HE: "לבטל את המנוי לזיגי קלאוד?")

Body copy:

> Your subscription will run until **{period_end_date}**. After that:
>
> - Remote access to your home from outside your Wi-Fi will stop working.
> - Cloud-LLM fallback for free-form questions will stop working.
> - Scheduled encrypted backups will stop running.
> - TTS (when it ships in v1.1) will stop working.
>
> **Your local kit keeps working.** Sensors, automations, IR control, and local voice continue exactly as they do today.
>
> Founder support tunnels stay open — we can always help you, subscription or not.
>
> You can resubscribe any time. Your home will resume on Ziggy Cloud immediately.

Two actions, equal weight:

- "Cancel subscription"
- "Keep subscription"

No third "Wait, I want to talk to someone" / "Pause instead" option. Either confirm or back out.

**Screen 3 — Cancellation submitted.**

> "Done. Your subscription will end on {period_end_date}. Your local kit keeps working. We've emailed you a receipt."

Audit log entry: `event=subscription_cancelled, account_id=…, period_end=…, ts=…, source=app|web`.

Confirmation email is dispatched immediately.

<!-- LAWYER REVIEW + APP/PLAY REVIEW: the symmetric-buttons + no-dark-pattern stance is policy. Confirm it survives any future commercial pressure to add a retention offer. -->

### 3.4 Email content

Subject: "Your Ziggy Cloud subscription is cancelled."

Body:

> Hi {first_name},
>
> We've cancelled your Ziggy Cloud subscription. Your current paid period runs until {period_end_date}. After that, the cloud features pause but your local kit continues working as normal.
>
> If this was a mistake or you change your mind, just resubscribe in the app — your home will pick right back up.
>
> If we got anything wrong, reply to this email and we'll fix it.
>
> — Ziggy

Hebrew translation alongside.

<!-- DESIGN REVIEW: do we deliver this email via the relay's transactional email path or via Stripe's hosted receipt path? Recommend relay-side so the wording is ours, not Stripe's. -->

---

## 4. Voice transcript storage consent

### 4.1 Decision: opt-in or opt-out?

Per locked product decision (in [`../DECISIONS.md`](../DECISIONS.md)), voice is push-to-talk only. Local STT runs on the hub. The question is whether the **local-on-hub history** of transcripts is retained.

**Design recommendation:** opt-in, default OFF.

Rationale:

- Reduces blast radius of a future incident.
- Matches the conservative privacy stance in [`../legal/PRIVACY.md`](../legal/PRIVACY.md).
- Cloud transmission is already controlled separately (transient-only on fallback).

<!-- DESIGN REVIEW: founder to confirm opt-in vs. opt-out for local-hub transcript retention. Recommend opt-in. -->

### 4.2 Consent screen

Triggered:

- During first-boot onboarding, after the user has paired the hub and is configuring voice.
- Always available later under Settings → Voice → Transcript history.

Headline: "Keep a history of your voice commands?" (HE: "לשמור היסטוריה של פקודות הקול?")

Body copy:

> Ziggy can keep the **text** of your recent voice commands on your hub. The audio itself is never stored.
>
> If you keep a history:
>
> - You can see what you said in the last N commands and re-run them.
> - Ziggy uses the history to spot patterns and suggest automations.
> - The text lives only on your hub. We can't see it.
>
> If you don't keep a history:
>
> - Voice commands still work; we just don't keep the text afterwards.
> - You can turn this on any time later.

Toggle: **Off by default.**

Below the toggle:

- "Retain last N commands" slider (default N = 50, max 500, configurable).
- "Clear all history" button.

Audit log entry on toggle change: `event=voice_transcript_consent_changed, value=on|off, ts=…`.

<!-- LAWYER REVIEW: confirm opt-in language is sufficient; confirm the explicit "we can't see it" statement is accurate (it is — local-only — but worth verifying with counsel given the cloud-fallback exception). -->

---

## 5. Support tunnel session consent

### 5.1 Background

When the user asks us for help, we may open a temporary SSH tunnel into the hub. Per locked policy (see [`../legal/PRIVACY.md`](../legal/PRIVACY.md) §6 and [`../legal/TERMS.md`](../legal/TERMS.md) §8):

- Every session requires prior in-app or email approval.
- Every session is audit-logged.
- Sessions are never Subscription-gated.

The in-app surface design:

### 5.2 Founder-initiated session — user approval

When founder requests a support tunnel, the user receives:

- Push notification: "Ziggy support is asking to connect to your hub to help with {ticket_id}."
- In-app modal (next time the user opens the app, with non-blocking persistence — modal can be dismissed but reappears until acted on).

**Modal screen:**

Headline: "Allow support to connect?" (HE: "לאשר חיבור תמיכה?")

Body copy:

> {Founder name} from Ziggy support is asking to connect to your hub to help with **{ticket_short_description}**.
>
> If you approve:
>
> - The connection lasts up to 2 hours, after which it auto-closes.
> - {Founder name} can see logs and run diagnostic commands on your hub.
> - **{Founder name} cannot listen to your microphone or watch your cameras.** (Ziggy v1 has no camera integration; the mic is push-to-talk only and not exposed via the tunnel.)
> - The session is logged. You can see all support sessions on your home under Settings → Privacy → Support sessions.

Two actions:

- "Approve" (primary)
- "Deny" (secondary, neutral)

Both actions audit-log: `event=support_tunnel_approval, value=approve|deny, ticket_id=…, founder_id=…, ts=…`.

### 5.3 Active-session indicator

While a support tunnel is open, the app shows a persistent banner:

> "Support is connected. {time remaining}. Tap to revoke."

Tap revokes immediately, closes the tunnel, and audit-logs the revoke event.

### 5.4 Settings → Privacy → Support sessions

Lists every support session ever opened on the home with:

- Date / time.
- Founder identifier.
- Ticket reference / short description.
- Duration.
- Whether the user-initiated revoke fired before the natural close.

The list is paginated; the user can request the full historical list by email per [`../legal/PRIVACY.md`](../legal/PRIVACY.md) §6.

<!-- LAWYER REVIEW: confirm the "can see logs but cannot listen to mic / watch cameras" copy is accurate against current implementation. -->

---

## 6. Mobile-specific consent — background location

### 6.1 The high-stakes screen

This is the single highest-leverage consent screen in the mobile app. It must:

- Justify background location convincingly to satisfy App Store + Play Store reviewers.
- Be honest with the user about what we use it for.
- Be opt-in. The default state on a fresh mobile install is **not granted**.

### 6.2 When the user sees it

When the user opens the mobile app for the first time and either:

- Toggles on "Use my phone for presence detection" under Settings → Mobile → Presence, or
- Approves a starter automation that requires presence (e.g. "Turn off the lights when I leave home").

The app shows our consent screen **before** triggering the OS permission dialog. The OS dialog gets one chance per app install (on Android) or limited retries (on iOS); we want the user to understand the trade-off first.

### 6.3 The screen

Headline: "Use your phone for home/away detection?" (HE: "להשתמש בטלפון לזיהוי בית/חוץ?")

Body copy:

> Ziggy can use your phone's location to know when you arrive home and when you leave.
>
> **What we use it for:**
>
> - Turn off lights, AC, or scenes when the last person leaves.
> - Turn on welcome scenes when the first person arrives.
> - Send arrival alerts to other household members (if you configured them).
>
> **What we don't do:**
>
> - We don't track where you are during the day.
> - We don't share your location with anyone.
> - We don't use your location for ads — Ziggy has no ads.
> - The raw coordinate stream stays on your phone and your hub. It is never sent to Ziggy Cloud or any third party.
>
> **What your phone will ask next:**
>
> - On {iOS: "the next screen, choose **Always** if you want home/away to work when your phone is in your pocket. **While Using the App** only works while Ziggy is open."}
> - On {Android: "the next screen, choose **Allow all the time** if you want home/away to work when the app is in the background. **Allow only while using the app** only works while Ziggy is open."}
>
> You can change your mind any time in your phone's settings.

Two actions:

- Primary: "Continue" (which then triggers the OS permission flow).
- Secondary: "Not now" (closes the screen, sets the preference to off, can be re-enabled later).

Audit log entry: `event=mobile_location_consent_shown, result=continued|not_now, platform=ios|android, ts=…`.

<!-- LAWYER REVIEW + APP/PLAY REVIEW: this screen is the regulatory linchpin. Wording must be exact. Apple's reviewers have rejected apps for vague "background location for app functionality" justifications; the screen above gives concrete user-visible reasons. -->

### 6.4 OS permission flow handling

After "Continue," the app triggers the platform-native permission flow.

- **iOS:** request "While Using the App" first. Only after we have at least foreground, *and* the user has tried a background-needing automation, do we request "Always." (iOS pattern: don't demand "Always" upfront; let the OS do the upgrade prompt.)
- **Android:** request `ACCESS_FINE_LOCATION` first. If granted, then for users who want background, separately request `ACCESS_BACKGROUND_LOCATION` (Android 10+ requirement; SDK will route this through the system permission screen on Android 11+).

### 6.5 If user denies

- Mark the preference off.
- Disable presence-dependent automations and notify the user.
- Allow re-prompting through Settings → Mobile → Presence (but respect OS-level "Don't ask again" if set).
- Do **not** repeatedly nag.

### 6.6 If user partially grants (foreground only)

- Enable foreground geofence.
- Show a Settings-level note: "Background presence isn't enabled. Geofence only works while Ziggy is open. To enable background, update your phone's location permission for Ziggy."
- One-tap deep-link into OS Settings.

<!-- DESIGN REVIEW: confirm the "limited foreground-only" experience is good enough to be worth supporting. Alternative: refuse to enable presence unless background is granted. Recommend: support foreground-only, because graceful degradation > nag pattern. -->

---

## 7. Consent change audit + history

Every consent-change event in this document writes to the relay audit log with the following shape:

```
{
  "event": "<consent_event_name>",
  "account_id": "<account_id>",
  "home_id": "<home_id, optional>",
  "value": "<new_value>",
  "previous_value": "<old_value, optional>",
  "source": "app|web|email",
  "platform": "ios|android|pwa|web",
  "ts": "<ISO-8601 timestamp>"
}
```

The user can request the consent-change history for their account via [`../legal/PRIVACY.md`](../legal/PRIVACY.md) §7 (right of access). The flow §2 (data export) automatically includes the consent-change history in the bundle.

<!-- LAWYER REVIEW: confirm structure satisfies the burden-of-proof requirement for "demonstrating consent" under Israeli + EU norms. -->

---

## 8. Out-of-scope for v1 / this doc

The following are NOT specified here and are deferred:

- Family / multi-user consent. v1 is single-account per home. Multi-user comes in v1.1 or later; we will revisit consent design at that point.
- Camera integration. v1 has none.
- Wake-word. v1 has none.
- TTS opt-in flow. v1 has no TTS; v1.1 will need a dedicated consent screen (similar shape to §4).
- Age gating. v1 audience is adult homeowners; no children-directed flow.

<!-- LAWYER REVIEW: confirm out-of-scope list is acceptable for initial launch. -->

---

## 9. Cross-references

- Policy text: [`../legal/PRIVACY.md`](../legal/PRIVACY.md), [`../legal/TERMS.md`](../legal/TERMS.md)
- Mobile data declarations: [`APP_STORE_DATA_SAFETY.md`](APP_STORE_DATA_SAFETY.md), [`PLAY_STORE_DATA_SAFETY.md`](PLAY_STORE_DATA_SAFETY.md)
- Internal ops: [`../legal/RUNBOOK_LEGAL_COMPLIANCE.md`](../legal/RUNBOOK_LEGAL_COMPLIANCE.md)
- Mobile route audit: [`MOBILE_ROUTE_AUDIT.md`](MOBILE_ROUTE_AUDIT.md)
- Onboarding audit: [`ONBOARDING_AUDIT.md`](ONBOARDING_AUDIT.md)
- Locked product decisions: [`../DECISIONS.md`](../DECISIONS.md)

---

## Change log

- 2026-05-28 — Initial draft (Prompt 11, Chunk 2). Design only — no implementation yet.

<!-- LAWYER REVIEW: re-run this entire document any time a flow is implemented or changed. The implementation must match the design or the design must be updated to match. -->
