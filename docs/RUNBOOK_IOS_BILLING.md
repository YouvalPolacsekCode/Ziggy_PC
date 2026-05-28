# RUNBOOK: iOS Billing — Apple "Reader App" Compliance

**Status:** Locked design (Prompt 9 chunk 3, decision 5/8 + audit §2.8).
**Audience:** Founder, anyone preparing an App Store submission.
**Prerequisite skills:** Capacitor build, App Store Connect.

---

## TL;DR

Ziggy subscriptions are sold **on the web only**. The native iOS app
must NOT mention pricing, plans, or purchase CTAs. The iOS binary is
allowed to:

- show subscription **status** ("trial active until 2026-06-15")
- show a degradation banner ("subscription required for remote access — your home still works locally")
- deep-link to the web checkout: `Safari.open("https://app.ziggy.io/account/billing")`

This pattern is Apple's "reader app" exemption (Guideline 3.1.3(a)), the
same one Spotify, Netflix, and Kindle ship under. **It depends on the
binary having zero in-app pricing text.** A single `$5/mo` in a JSX
file or i18n string is enough to flip the app into the regular
3.1.1(a)-must-use-IAP bucket.

---

## Why not Apple IAP

- **30% take** would eat the founder pricing margin entirely
  ($5/mo × 30% = $1.50/mo per founder customer).
- **Refund handling** moves to Apple. Per Israeli consumer law we need
  the founder to control the 14-day return window directly (it ties
  into the founder-slot release logic — see
  `relay/app/billing/slot_counter.py`).
- **Subscription state** moves out of our DB into Apple's, breaking
  the unified subscription_state column that Stripe webhooks own.
- **Cross-platform parity:** web + Android continue with Stripe;
  diverging iOS into IAP creates a second billing pipeline.

The reader-app path keeps one provider (Stripe), one database
(`homes.subscription_state`), and one unified webhook handler in
`relay/app/billing/webhooks.py`.

---

## The Apple rule (Guideline 3.1.3(a)) in plain English

> Apps that allow a user to access content/services purchased elsewhere
> (digital magazines, books, audio/video, music, games, etc.) are
> permitted to display that content **without** using Apple's IAP system,
> **provided** the app does not **encourage** users to buy or upgrade
> outside the app.

Translation for Ziggy:

- ✅ Show what the user already has access to (their devices, automations,
     sensor data, voice control).
- ✅ Show that something is gated due to subscription state ("subscription
     required for remote access").
- ✅ Provide a tappable link to the web for account management.
- ❌ Show prices, plans, or "Buy" / "Subscribe" / "Upgrade" CTAs
     INSIDE the app.

---

## Pre-archive checklist

Run these in order every time you produce an iOS Archive.

### 1. Run the pricing-string guard

```bash
python scripts/ios_pricing_string_guard.py
```

Exits 0 on clean, non-zero on any banned-string hit. Patterns and the
whitelist are documented inside the script. The guard scans
`frontend/src/` because that's the tree Capacitor copies into the iOS
bundle; relay code, backend code, and docs are out of scope.

**If it fails:** read the line numbers it prints. Either move the
offending text to a web-only path (`web-only/` prefix on file names,
or platform check at runtime: `if (Capacitor.getPlatform() === 'ios')
return null`) or, with explicit justification, add the file to the
`WHITELIST` set inside the guard.

### 2. Verify Capacitor-platform guards in pricing-adjacent UI

Search for any new components added since the last archive:

```bash
git diff --name-only <last-archive-tag>..HEAD -- 'frontend/src/**' | grep -i -E 'pricing|billing|checkout|subscribe|upgrade'
```

Each one should either:
- not render on iOS (`Capacitor.getPlatform() === 'ios'` check), OR
- render only the "open in browser" link, no plan / price text.

The `SubscriptionGateBanner` is fine to ship on iOS — its message is
informational ("subscription required for remote access — your home
still works locally"), not a purchase CTA.

### 3. Smoke-test the deep link

Inside the iOS simulator (or a paired device):
1. Tap the account/billing link in the app.
2. Confirm Safari opens to the web checkout URL.
3. Confirm no in-app browser overlay (SFSafariViewController is allowed,
   but a custom in-app browser styled as iOS Safari is not — Apple
   reviewers flag that as a workaround).

### 4. Confirm subscription state still threads through

Manually verify on a test home:
1. Set `homes.subscription_state = 'cancelled'` via the admin DB.
2. Wait for next OTA poll (1h) OR force one with
   `python -m services.ota_client` if such a CLI exists.
3. Open the iOS app over cell (not on home wifi).
4. Confirm: the SubscriptionGateBanner appears; remote actions fail
   gracefully with "subscription required for remote access" rather
   than a generic error or hang.

---

## App Store Connect submission

### Reviewer notes (paste into the "Notes" field at submission)

```
Subscription business model:
This app uses the reader-app exemption under App Store Review Guideline
3.1.3(a). Subscriptions are purchased and managed on our website at
https://app.ziggy.io/account/billing — not in the app.

The app provides access to a smart-home control surface that the user
already paid for outside the app (similar to Netflix / Spotify). The
binary contains no purchase flows, pricing, or subscription upsells.

Account creation: users sign up on the web before pairing the app.
Test account: <set this via the App Review test-account fields>.

If reviewing the subscription-gated state:
1. Sign in with the provided test account.
2. The test home is configured with subscription_state = 'cancelled'.
3. Observe the in-app banner explaining that remote access requires a
   subscription. Local-network access continues to work.
```

### Test credentials

Maintain a dedicated test account for App Review whose home stays in a
predictable demo state. See `relay/app/billing/admin.py::kit-received`
and the `subscription_state` column for how to set this up.

---

## If Apple rejects

The two rejection vectors to expect:

**A. "Your app includes purchase flows that must use IAP."**
Apple found pricing text or a purchase CTA in the binary. Pull the
specific screenshot from their rejection. Re-run the pricing-string
guard with extra patterns based on what they cited; remove the offending
text; submit a new build. The reviewer note should reiterate the
3.1.3(a) reader-app claim.

**B. "Your app does not provide enough functionality."**
The reviewer reached a feature that requires a subscription, saw the
gate, and concluded the app is non-functional. Mitigation: the test
account must have an ACTIVE subscription, not a cancelled one. The
gated-state walk-through is for reviewer education only — the default
state of the test account should let the reviewer experience the full
app.

For both: do NOT switch to IAP. The cost model and Israeli legal
constraints (founder-controlled refunds, עוסק פטור invoices) don't
work with Apple as merchant of record.

---

## Android (Play Store)

Google's rules are looser. The same architecture (web-only checkout,
deep-link from the app) is permitted without invoking a Play
equivalent of the reader-app rule. The `ios_pricing_string_guard.py`
need not run for Android Archives.

Practically, the same `Capacitor.getPlatform()` checks that hide
pricing on iOS can be left in place — Android users see the same
"open in browser to manage subscription" UX as iOS, which is fine and
keeps the codebase platform-symmetric.

---

## References

- App Store Review Guidelines 3.1.1, 3.1.3(a): https://developer.apple.com/app-store/review/guidelines/#payments
- Capacitor platform detection: https://capacitorjs.com/docs/core-apis/platform
- `BILLING_AUDIT.md` §2.8 — the design that produced this runbook
- `relay/app/billing/webhooks.py` — what fires when web checkout completes
- `frontend/src/components/SubscriptionGateBanner.jsx` — the in-app
  banner that satisfies the "tell the user, don't sell to them" line

---

## Change log

- 2026-05-28 — initial runbook (Prompt 9 chunk 3 C3.10). Founder.
