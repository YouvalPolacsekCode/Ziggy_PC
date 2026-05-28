# Ziggy — Terms of Service (DRAFT)

**Status:** Working draft. Not legally reviewed. Do not publish until counsel sign-off.
**Last updated:** 2026-05-28
**Governing law:** State of Israel.

This document is the customer-facing Terms of Service for Ziggy, a local-first AI smart home assistant sold as a hardware kit with an optional cloud subscription. It is written to be read alongside [`PRIVACY.md`](PRIVACY.md) and [`RUNBOOK_LEGAL_COMPLIANCE.md`](RUNBOOK_LEGAL_COMPLIANCE.md). Sections marked `<!-- LAWYER REVIEW -->` require sign-off from Israeli counsel before publication.

---

## 1. Definitions

- **"Ziggy", "we", "us", "our"** — the trading entity selling the Ziggy kit and operating the Ziggy Cloud service. Operating as an Israeli **עוסק פטור** (exempt dealer) at the time of these terms taking effect.
- **"Customer", "you", "your"** — the natural or legal person who purchases the Ziggy kit and/or subscribes to Ziggy Cloud.
- **"Kit" / "Hardware"** — the physical bundle (mini PC, sensors, IR blaster, Zigbee coordinator, packaging) shipped to the customer per the SKU purchased (Home or Premium).
- **"Local install"** — the software running on the Customer's mini PC, including Home Assistant, the Ziggy edge agent, and any models stored locally.
- **"Ziggy Cloud"** — the cloud-hosted services we provide (relay tunnel, OTA manifest, optional cloud-LLM fallback, encrypted backups, account/billing infrastructure).
- **"Subscription"** — a paid recurring plan that unlocks Ziggy Cloud features.
- **"Founder Tier"** — the introductory pricing tier reserved for the first 30 paying customers across both kits.

<!-- LAWYER REVIEW: confirm "עוסק פטור" wording is acceptable in English-language ToS or whether an Israeli-side appendix is needed. -->

---

## 2. The Agreement

By purchasing a Ziggy kit, creating a Ziggy account, or activating a Ziggy Cloud subscription you agree to these Terms. If you do not agree, do not use the product. These Terms, together with the Privacy Policy, form the entire agreement between you and Ziggy regarding the product.

We may change these Terms; material changes are notified by in-app banner and account-email at least 30 days before they take effect. Trivial wording fixes are not separately notified.

<!-- LAWYER REVIEW: 30-day notice period for material changes — confirm consistent with Israeli consumer law. -->

---

## 3. Hardware: Ownership, Title, Risk

**You own the kit outright.** When you receive and accept delivery, full title to the Hardware passes to you. There is no lease, no subscription-tied hardware lock, and no "device-as-a-service" arrangement. You may resell, gift, or dispose of the Hardware as you wish, subject to applicable e-waste regulations.

Risk of loss passes on delivery to the address you provide at checkout. Until then, risk is on us.

The local install is licensed (not sold) to you on the terms in Section 6. Cancelling a Subscription does **not** remove or disable any locally-installed software you have already received — see Section 5.

---

## 4. Subscription: Billing, Cancellation, Data After Cancellation, Refunds

### 4.1 Plans and pricing (as of 2026-05-28)

| Plan | Monthly | Annual | Founder tier |
|---|---|---|---|
| Ziggy Cloud (single home) | **$9 / mo** | **$89 / yr** | **$5 / mo** for life, first 30 customers only |

Prices are listed in USD. For Israeli customers, the equivalent NIS amount including 17% VAT will be shown at checkout per Israeli VAT-inclusive disclosure rules; see [`RUNBOOK_LEGAL_COMPLIANCE.md`](RUNBOOK_LEGAL_COMPLIANCE.md). While Ziggy is operating as an **עוסק פטור**, VAT is not separately itemised on receipts — see Section 4.7.

<!-- LAWYER REVIEW: confirm USD pricing is permissible for Israeli direct-sale, or whether ILS must be the displayed currency. -->

### 4.2 Billing cycle

Monthly plans renew every 30 days from the activation date. Annual plans renew on the anniversary of activation. We charge in advance for the upcoming period. Failed payments trigger a 14-day grace window with email + in-app notice; if not cured by day 14, the Subscription enters Cancelled state per Section 4.4.

### 4.3 Cancellation

You may cancel at any time from inside the Ziggy app (Settings → Subscription → Cancel) or by emailing **support@ziggyhome.example**. No phone-call escalation, no "are you sure" dark-pattern loops — one confirmation screen, then cancellation is committed.

After cancellation:

- The current paid period continues uninterrupted until its end date.
- At the end of the period, the Subscription is fully cancelled and Ziggy Cloud features stop working — see Section 4.5.
- The local install on your mini PC keeps working.

<!-- LAWYER REVIEW: Apple/Google in-app cancellation rules require cancellation be possible inside the app for subscriptions sold via App Store / Play. Confirm wording. -->

### 4.4 What "Cancelled" disables, and what it does not

Per locked product decision: **cancellation never breaks your local kit.** Concretely, the following keep working with no Subscription:

- Local Zigbee sensors, motion + door sensors, temp / humidity readings.
- Local automations (motion → light, scenes, schedules).
- IR control via the BroadLink blaster.
- Local push-to-talk voice with on-device STT.
- Direct access to the mini PC over your local Wi-Fi.

The following Ziggy Cloud features are disabled when the Subscription is Cancelled:

- Remote access to your home from outside your LAN (the relay tunnel will refuse to forward traffic).
- Cloud-LLM fallback for free-form questions.
- Scheduled encrypted backups to Backblaze B2.
- TTS / spoken responses (when this feature ships in v1.1).

Founder-initiated support tunnels for troubleshooting are **never** Subscription-gated — see Section 8.

### 4.5 Data after cancellation

Your local data on your mini PC is not touched by cancellation. We do not have remote-wipe capability built into the Subscription kill-switch and we never will.

Your cloud-side account and any retained metadata (account email, home id, last connect time) are retained while your account exists, so you can re-subscribe and resume Ziggy Cloud without re-pairing your home. If you also wish to delete your account, see Section 7 of [`PRIVACY.md`](PRIVACY.md).

### 4.6 Refunds

- **Israeli buyers — kit (hardware):** subject to the statutory 14-day right of return under Israeli consumer protection law. See Section 7 and [`RUNBOOK_LEGAL_COMPLIANCE.md`](RUNBOOK_LEGAL_COMPLIANCE.md) for the process.
- **Israeli buyers — Subscription:** if you cancel within 14 days of first activation and have not made material use of paid features, you may request a full refund of the most recent charge. After the 14-day window, monthly Subscriptions are non-refundable; annual Subscriptions are pro-rated for the unused full months at our discretion.
- **Non-Israeli buyers:** Ziggy is not actively marketing outside Israel in v1; please contact us at support@ziggyhome.example for a case-by-case refund discussion.

<!-- LAWYER REVIEW: refund pro-ration for annual subscriptions — confirm policy. Confirm 14-day statutory right of return language is correct for both digital service + hardware combination sales. -->

### 4.7 Invoices, receipts, currency, VAT

As long as Ziggy is operating as an **עוסק פטור**:

- Receipts will be issued in the form prescribed by Israeli tax law for exempt dealers (i.e. **קבלה**, not **חשבונית מס**). VAT will **not** be separately itemised on receipts.
- The price you see at checkout is the final price you pay; nothing is added at the till.
- Once Ziggy moves to **עוסק מורשה** registration, we will switch to **חשבונית מס** form and separately disclose VAT.

<!-- LAWYER REVIEW: confirm the קבלה wording and the moment of switch to חשבונית מס upon עוסק מורשה registration. -->

---

## 5. Founder Tier

The first 30 paying customers across both kits qualify for the Founder tier: $499 (Home) / $799 (Premium) one-time hardware price, and $5/month Subscription for life. "For life" means: as long as the customer keeps the Subscription continuously active, and as long as Ziggy continues to operate the Cloud service. Letting the Subscription lapse and re-activating later does not restore Founder pricing.

Founder tier is non-transferable between accounts but is tied to the customer, not the specific hardware kit. If a Founder customer replaces their kit, their Founder pricing on the Subscription continues.

<!-- LAWYER REVIEW: "for life" wording — confirm enforceability and whether a sunset clause (e.g. "for as long as the service is offered, or 7 years, whichever is shorter") is preferred for risk reasons. -->

---

## 6. Software Licence

The local install (Ziggy edge agent, included Home Assistant build, included models) is licensed to you for use on the mini PC delivered as part of your kit, or on a replacement mini PC if your original fails. You may not:

- Resell or sub-license the software separately from the hardware.
- Reverse-engineer for the purpose of producing a competing product.
- Use the software to operate a commercial paid-access smart home service for third parties.

Open-source components included in the local install are governed by their own licences and are exempt from the restrictions above to the extent their licences require.

<!-- LAWYER REVIEW: confirm phrasing does not conflict with included AGPL / GPL components inside Home Assistant. -->

---

## 7. Warranty

### 7.1 Hardware warranty

We warrant the Hardware against defects in materials and workmanship for **12 months from delivery**. If a component fails within that window through no fault of yours, we will replace the defective unit at no charge. Our standing budget for replacement parts is **5% of BOM per shipped kit**, sourced via the same suppliers as the original kit.

The warranty does **not** cover:

- Damage from drops, water exposure outside spec, power-surge events, or modification.
- Cosmetic wear from normal use.
- Failures of third-party hardware the Customer adds to the system outside the kit SKU.

Replacement is the sole warranty remedy. We do not refund the kit price for an individual defective component if a replacement is available.

<!-- LAWYER REVIEW: 12-month warranty — confirm consistent with Israeli statutory minimums (חוק המכר) for consumer electronics. Israeli law may require longer for specific components. -->

### 7.2 Sensor batteries

Sensor batteries are consumables and are not warranted past delivery. We may ship spare batteries as a goodwill gesture but this is not a contractual obligation.

### 7.3 Service warranty

We do not guarantee uninterrupted operation of Ziggy Cloud. Our target is 99% monthly uptime measured at the relay; we do not offer service credits. If extended outages occur, see Section 4.6 for any case-by-case credit.

<!-- LAWYER REVIEW: explicit no-SLA stance — confirm compatibility with consumer SaaS regulation in Israel. -->

---

## 8. Founder Support Tunnel and Account Access

When you ask us for help, we may — with your in-app or email approval — open a temporary, audited SSH tunnel into your mini PC to diagnose the problem. Specifically:

- Each support session is logged (start time, end time, founder identifier) in the audit log on the relay, viewable by you on request.
- We will never open a tunnel without your explicit prior approval for that session.
- Support tunnels are not Subscription-gated. We can always help you regardless of whether your Subscription is active.

See Section 6 of [`PRIVACY.md`](PRIVACY.md) for the corresponding privacy treatment.

<!-- LAWYER REVIEW: "in-app or email approval" — confirm whether email-only is sufficient or in-app affirmative consent is required. -->

---

## 9. Acceptable Use

You agree not to use Ziggy to:

- Surveil people inside your home without their knowledge, in violation of Israeli privacy law.
- Run continuous ambient recording. Voice capture is push-to-talk only by design; do not attempt to circumvent this.
- Operate in environments with regulatory requirements beyond a residential / small-office setting (e.g. medical, industrial, life-safety) — Ziggy is not certified for those uses.
- Send automated traffic from the relay or local hub that materially degrades shared infrastructure or violates third-party service terms (e.g. OpenAI, Anthropic, Cloudflare).
- Resell access to your home tunnel to third parties.

We may suspend the Cloud-side relay for any home found in violation, after attempting to contact the Customer.

<!-- LAWYER REVIEW: surveillance-of-others paragraph — confirm wording compatible with Israeli wiretap/privacy statutes. -->

---

## 10. Liability

To the maximum extent permitted by applicable law:

- We are not liable for indirect, incidental, or consequential damages.
- Our total cumulative liability under these Terms is capped at the greater of: (a) the price you paid for the Hardware in the 12 months preceding the claim, or (b) 12 × the monthly Subscription fee.
- This cap does not limit liability for: (i) death or personal injury caused by our negligence, (ii) fraud or wilful misconduct, (iii) any liability that cannot be excluded under Israeli consumer protection law.

Ziggy is a residential smart home assistant. It is **not** a life-safety, medical, fire-alarm, or security-alarm system. Do not rely on it as such.

<!-- LAWYER REVIEW: liability cap formulation — confirm both branches comply with Israeli minimum-liability rules for consumer goods. -->

---

## 11. Governing Law and Dispute Resolution

These Terms are governed by the laws of the State of Israel, without regard to conflict-of-laws principles. The courts of Tel Aviv-Jaffa have exclusive jurisdiction over disputes that cannot be resolved informally.

Before filing a claim, please contact us at **support@ziggyhome.example**. We will attempt to resolve in good faith within 30 days.

<!-- LAWYER REVIEW: forum-selection clause (Tel Aviv-Jaffa) — confirm enforceability and consumer-protection-statute compatibility. For non-Israeli buyers, separate language may be needed. -->

---

## 12. Termination by Ziggy

We may terminate your account or refuse service for:

- Violation of Section 9 (Acceptable Use).
- Payment fraud / chargeback abuse.
- Activity that materially threatens our infrastructure or other customers.

We will give you notice and an opportunity to cure, except where immediate action is necessary to protect the service or other customers. On termination, the cancellation flow in Section 4.4 applies — your local kit keeps working.

---

## 13. Contact

Operational contact: **support@ziggyhome.example**.
Legal / privacy contact: **legal@ziggyhome.example**.

<!-- LAWYER REVIEW: registered company address and director name need to be added before publication; currently a sole-proprietor עוסק פטור operating from home. -->

---

*End of working draft. Cross-references: [`PRIVACY.md`](PRIVACY.md), [`RUNBOOK_LEGAL_COMPLIANCE.md`](RUNBOOK_LEGAL_COMPLIANCE.md), [`../DECISIONS.md`](../DECISIONS.md) (locked product decisions).*
