# Ziggy — Israeli Consumer-Law Compliance Runbook (DRAFT)

**Status:** Working draft. Not legally reviewed. Operational reference for the founder; not customer-facing.
**Last updated:** 2026-05-28
**Audience:** Founder (operating Ziggy as an **עוסק פטור**). One-person ops; no support team yet.

This runbook is the day-to-day operational playbook for keeping Ziggy compliant with Israeli consumer-protection and tax rules. It complements the customer-facing [`TERMS.md`](TERMS.md) and [`PRIVACY.md`](PRIVACY.md). Sections marked `<!-- LAWYER REVIEW -->` need confirmation from an Israeli lawyer or accountant before relying on them in production.

---

## 0. Founder operational checklist (every kit shipped)

Before each kit ships:

- [ ] Confirm the customer's order shows VAT-inclusive ILS pricing on the receipt at checkout (not "+ VAT").
- [ ] Issue a **קבלה** (receipt) — not a **חשבונית מס** — per עוסק פטור rules.
- [ ] Include the printed invoice in the box **and** email a PDF copy to the customer's account email.
- [ ] Include the 14-day-return one-pager (see §1.3) printed in Hebrew + English.
- [ ] Note the kit serial number, ship date, and customer id in the **shipments log** (currently a plain spreadsheet; eventually a relay-side table).
- [ ] Tag the customer record with the 12-month warranty window end date.

Before each kit imaging session:

- [ ] Run `scripts/factory/imaging.sh` (or current factory script) and record the kit's serial in the imaging log.
- [ ] Seal the per-home backup key envelope per [`../docs/SEAL_KEY_SNIPPET_FOR_FACTORY_IMAGING.md`](../docs/SEAL_KEY_SNIPPET_FOR_FACTORY_IMAGING.md).
- [ ] Verify the customer-facing pair sticker is printed and adhered.

Monthly:

- [ ] Reconcile Stripe payouts against issued **קבלות** (receipts).
- [ ] Update replacement-budget tracker: spent vs. 5%-of-BOM budget per shipped kit (see §2.2).
- [ ] Triage any 14-day returns received that month; close or escalate.

Quarterly:

- [ ] Re-check עוסק פטור turnover ceiling vs. current run-rate; if approaching the threshold, prepare to switch to **עוסק מורשה** registration.
- [ ] Re-verify DPA status with each third-party processor (Stripe, Fly.io, Backblaze, Cloudflare, OpenAI, Anthropic, Azure).

Annually:

- [ ] File annual income report with the Israeli Tax Authority.
- [ ] Renew קבלה booklet inventory / digital receipting tool licence if applicable.
- [ ] Review and update [`PRIVACY.md`](PRIVACY.md) and [`TERMS.md`](TERMS.md) with founder + counsel.

<!-- LAWYER REVIEW: above checklist for completeness and ordering. -->

---

## 1. The Israeli 14-day right of return

### 1.1 Statutory basis

Under Israel's Consumer Protection Law (חוק הגנת הצרכן) and its accompanying regulations, a consumer who buys at **distance sale** (i.e. online/by phone) is generally entitled to cancel the transaction within 14 days of receipt of the goods, subject to specific exclusions and conditions.

For Ziggy this applies to:

- The Hardware kit (Home / Premium / Beta deposit).
- The first month / first year of the Subscription if cancelled within 14 days of first activation and material use has not occurred.

Exclusions to be confirmed with counsel: digital content that has been "consumed", software whose seal has been broken, etc.

<!-- LAWYER REVIEW: confirm exact statutory citation; confirm scope of "material use" exclusion for SaaS Subscriptions; confirm whether the Hardware kit qualifies for the standard 14-day window or a longer "distance-sale + opened-package" carve-out applies. -->

### 1.2 Process — customer side

The customer initiates a return by:

- Replying to their order confirmation email, or
- Emailing **support@ziggyhome.example** with their order id and reason for return, or
- Tapping "Cancel & return" from the in-app order history view (post-launch).

We do not require the customer to use a specific form. The reason is logged but a "no specific reason" return is also accepted within the 14-day window.

### 1.3 The 14-day one-pager

Every kit ships with a printed insert (Hebrew + English) covering:

- The 14-day window and when it starts (delivery date).
- How to initiate a return (the three options in §1.2).
- That the customer is responsible for shipping the kit back in the original packaging where reasonable.
- That a 5% cancellation fee (or 100 ILS, whichever is lower) **may** apply per Israeli regs, with our current policy being to waive it for beta and early-Home customers as a goodwill gesture — to be revisited as volume grows.
- The refund timeline (see §1.5).
- Founder phone / email contact.

<!-- LAWYER REVIEW: confirm the 5%-or-100-ILS cancellation-fee formulation matches current regulation; confirm whether printed insert is mandatory or recommended. -->

### 1.4 Process — founder side

When a return is initiated:

1. **Acknowledge within 1 business day.** Email reply confirming receipt of the request, ETA on shipping label, and any logistics question (preferred return time slot).
2. **Provide return shipping arrangement.** For beta and first-Home cohorts, founder picks up in person where feasible; otherwise issue a paid shipping label via the chosen carrier.
3. **Receive and inspect.** On arrival, inspect for damage outside normal-use wear. Take photos of received condition.
4. **Decide.** If the kit is in returnable condition, refund per §1.5. If not, communicate to the customer with photos and offer the closest equivalent remedy (e.g. partial refund + retained kit, replacement).
5. **Log the outcome** in the shipments log and the returns log.
6. **Close cloud account** if customer requests, per §3.

### 1.5 Refund timeline

- Refund issued within 14 days of receiving the returned kit, to the original payment method via Stripe.
- The Subscription portion (if any) is refunded pro-rata: full refund if within the 14-day Subscription window AND no material use; otherwise unused full months only.
- Refund includes the kit price and standard shipping charge if paid; non-standard "rush" shipping is not refunded.

<!-- LAWYER REVIEW: refund timeline 14 days from receipt — confirm consistent with Israeli regs (some sources cite a shorter window). -->

---

## 2. Defective product replacement process

### 2.1 What qualifies as defective

Within the 12-month hardware warranty (see [`TERMS.md`](TERMS.md) §7):

- Sensor stops reporting, despite fresh batteries.
- Mini PC fails to boot, repeatedly crashes, or has visible hardware fault (USB, network, screen output).
- Zigbee coordinator (SLZB-06 or Sonoff ZBDongle-E) is not enumerated by HA after a standard re-imaging.
- IR blaster does not transmit codes that previously worked.

NOT covered by warranty (per [`TERMS.md`](TERMS.md) §7.1):

- Drop / water / power-surge damage.
- Cosmetic wear.
- Customer-modified hardware (e.g. customer flashed third-party firmware).
- Third-party add-ons outside the kit SKU.

### 2.2 Replacement budget

Per locked decision in [`../DECISIONS.md`](../DECISIONS.md): founder maintains a **5%-of-BOM replacement budget per shipped kit**. Track in a single budget spreadsheet:

- Per-kit BOM at the sourcing tier in effect on ship date (beta-sourced, beta kit, Home beta-sourced, Home bulk, Premium bulk).
- Spent-to-date on replacements for that kit.
- Burn rate vs. budget.

If replacement burn for a single kit exceeds 5%-of-BOM, escalate: investigate whether the failure is a batch-wide defect or a customer-specific situation. Batch-wide defects warrant a notice to all customers on the affected batch.

<!-- LAWYER REVIEW: the 5%-of-BOM replacement budget is an internal financial planning number, not a contractual cap. Confirm that the customer-facing warranty in TERMS.md §7 does not accidentally promise more than the budget anticipates. -->

### 2.3 Process — customer side

The customer initiates a defective-product claim by:

- Emailing **support@ziggyhome.example** with the kit serial number (printed on the box) and a description of the failure.
- Optionally including a short video or photo of the failure.
- Founder may open a support tunnel (per [`PRIVACY.md`](PRIVACY.md) §6) with prior consent to diagnose.

### 2.4 Process — founder side

1. **Acknowledge within 1 business day.**
2. **Diagnose remotely first** when possible (support tunnel, log inspection).
3. **Replacement decision tree:**
   - Single-sensor failure → ship replacement sensor + return-label for the failed unit.
   - Coordinator failure → ship replacement coordinator; pre-image with customer's HA backup if available.
   - Mini PC failure → trigger DR runbook ([`../docs/RUNBOOK_DR.md`](../docs/RUNBOOK_DR.md)) to restore customer state to a fresh Beelink, ship the replacement, customer ships failed unit back.
4. **Failure-cause logging.** Track failure mode + suspected root cause in a per-SKU table — this feeds the next sourcing-cycle decision.
5. **Update the replacement-budget tracker.**
6. **Close the support ticket** with a summary the customer can read.

### 2.5 RMA path with the original supplier

Where the failed component is within its manufacturer warranty (Aqara, SMLIGHT, Beelink, BroadLink, etc.), founder pursues RMA with the supplier in parallel to the customer-facing replacement. The customer is not asked to wait for supplier RMA; we ship the replacement first.

---

## 3. Account closure on return / refund

When a return or full-refund decision is taken:

1. Customer is asked (not required) whether they want their cloud account deleted. If yes:
   - Trigger the standard 30-day account-deletion flow ([`PRIVACY.md`](PRIVACY.md) §11).
   - Confirm via email when deletion is complete.
2. If they want to keep the cloud account (e.g. they intend to buy a different kit later), leave the account in place; pause Subscription billing.
3. Update the shipments log row to reflect "returned & refunded" with the date.

---

## 4. VAT-inclusive pricing disclosure

### 4.1 Israeli regulatory expectation

Israeli law requires that consumer-facing prices include VAT. Splitting price as "X + VAT" is not acceptable for the headline / shelf / website price.

While Ziggy is operating as an **עוסק פטור**, VAT is not separately collected from customers and not itemised on receipts. The price the customer sees is the price the customer pays.

When Ziggy switches to **עוסק מורשה** registration:

- All displayed prices must continue to be VAT-inclusive.
- Receipts (now **חשבונית מס**) must separately disclose the VAT component.

<!-- LAWYER REVIEW + ACCOUNTANT REVIEW: confirm precisely when the עוסק-פטור-to-עוסק-מורשה switch happens (annual turnover threshold; current threshold as of 2026 needs to be looked up by accountant) and the regulatory steps required at switch (file with Tax Authority, update receipting tool, update website price display logic). -->

### 4.2 What must show VAT-inclusive

- Website kit prices (Home, Premium).
- In-app Subscription prices.
- Receipts and printed invoices.
- Marketing material (social posts, WhatsApp price quotes, ads).

### 4.3 Currency disclosure

Display ILS as the primary currency for Israeli customers. USD secondary is acceptable but the ILS amount must be unambiguous and final.

<!-- LAWYER REVIEW: confirm USD-displayed prices with ILS small-print are sufficient or whether the ILS price must be the primary displayed value across the site. -->

---

## 5. עוסק פטור invoice rules

### 5.1 What an עוסק פטור can and cannot do

- **Cannot issue חשבונית מס.** Receipts are issued as **קבלה** only.
- **Cannot collect VAT separately** from the customer.
- Has an annual turnover ceiling. The threshold is updated periodically by the Tax Authority; confirm the current figure with the accountant each year. As of the time of writing, founder is well below the ceiling but should monitor monthly.
- Must keep records of all receipts and incoming/outgoing money for at least 7 years.

<!-- LAWYER REVIEW + ACCOUNTANT REVIEW: confirm current turnover threshold (changes annually) and confirm record-keeping years. -->

### 5.2 Receipting tooling

Use a recognised Israeli digital receipting service that supports עוסק פטור (e.g. Greeninvoice / iCount / similar) for issuing קבלות. Settings:

- Hebrew-first, English secondary on the receipt PDF.
- Customer's name (or registered name if a company), address (if provided), date, amount in ILS, payment method (Stripe).
- Sequential receipt numbering (do not skip numbers).
- Send-to-customer-email + retain a PDF copy in founder's records.

### 5.3 What the receipt must show

- "**קבלה**" heading (NOT "חשבונית מס").
- Founder's name + עוסק פטור registration number.
- Sequential receipt number.
- Date of issue + date of payment.
- Customer name + (optional) address.
- Description of the goods/service (kit SKU + serial; or "Ziggy Cloud monthly Subscription, month X").
- Amount in ILS, with no VAT line, no "+VAT" suffix, no separate breakdown.
- Payment method.

<!-- LAWYER REVIEW + ACCOUNTANT REVIEW: confirm full list of mandatory fields on a קבלה. -->

### 5.4 Stripe note

Stripe issues its own invoice in addition to the קבלה. The Stripe invoice is not a substitute for the Israeli קבלה; both should exist. Reconcile monthly.

### 5.5 Switch to עוסק מורשה — operational steps

When founder switches to **עוסק מורשה** registration, this runbook updates as follows:

1. New tax-id stamp on receipts.
2. Receipts become **חשבונית מס** with VAT separately disclosed.
3. Customer-facing prices stay VAT-inclusive but receipts now break out the VAT line.
4. File quarterly VAT returns to the Tax Authority.
5. Update [`TERMS.md`](TERMS.md) §4.7 to reflect new status.
6. Notify existing customers by email of the change (no price increase required if VAT-inclusive headline is maintained — the breakdown changes, not the total).

<!-- LAWYER REVIEW + ACCOUNTANT REVIEW: confirm the switch process and any customer-notification obligations. -->

---

## 6. Document maintenance

- **TERMS.md** — version-controlled in this repo. Material changes require lawyer review + 30-day customer notice (per [`TERMS.md`](TERMS.md) §2).
- **PRIVACY.md** — same as above.
- **This runbook** — internal; founder + accountant + lawyer only. Update without customer notice when operational policy changes (subject to keeping customer-facing TERMS / PRIVACY consistent).

### 6.1 Last-touched ledger

| Document | Last reviewed | Reviewer |
|---|---|---|
| TERMS.md | 2026-05-28 | Founder draft only |
| PRIVACY.md | 2026-05-28 | Founder draft only |
| RUNBOOK_LEGAL_COMPLIANCE.md | 2026-05-28 | Founder draft only |
| docs/APP_STORE_DATA_SAFETY.md | (Chunk 2) | — |
| docs/PLAY_STORE_DATA_SAFETY.md | (Chunk 2) | — |
| docs/IN_APP_LEGAL_SURFACES.md | (Chunk 2) | — |

---

## 7. Open follow-ups

- Engage an Israeli lawyer for first formal review of TERMS + PRIVACY before commercial launch.
- Engage an accountant for ongoing receipting + Tax Authority compliance.
- Confirm the registered name and address for the trading entity; populate "Contact" sections in [`TERMS.md`](TERMS.md) §13 and [`PRIVACY.md`](PRIVACY.md) §15.
- Build the 14-day-return one-pager (HE + EN print insert) — referenced in §1.3, not yet drafted.
- Move the shipments log + returns log + replacement-budget tracker from a spreadsheet to a relay-side admin table once admin dashboard work (Prompt 10) lands.
- Per locked decision 2026-05-26, push notifications for billing-related events (charge succeeded / failed / cancellation confirmed) should reference this runbook's customer-facing wording, once Prompt 9 lands.

---

*End of working draft. Cross-references: [`TERMS.md`](TERMS.md), [`PRIVACY.md`](PRIVACY.md), [`../DECISIONS.md`](../DECISIONS.md), [`../docs/RUNBOOK_DR.md`](../docs/RUNBOOK_DR.md), [`../docs/SEAL_KEY_SNIPPET_FOR_FACTORY_IMAGING.md`](../docs/SEAL_KEY_SNIPPET_FOR_FACTORY_IMAGING.md).*
