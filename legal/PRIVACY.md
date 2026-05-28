# Ziggy — Privacy Policy (DRAFT)

**Status:** Working draft, not legally reviewed. Do not publish until counsel sign-off.
**Last updated:** 2026-05-28
**Supersedes:** [`PRIVACY_DRAFT.md`](PRIVACY_DRAFT.md). That earlier draft is kept in the repo for archival/diff purposes; this file is the canonical working policy.

This document describes what data Ziggy collects, where it lives, who can see it, and what you can do about it. It is written to be read alongside [`TERMS.md`](TERMS.md) and [`RUNBOOK_LEGAL_COMPLIANCE.md`](RUNBOOK_LEGAL_COMPLIANCE.md). Sections marked `<!-- LAWYER REVIEW -->` require sign-off from Israeli counsel (and, for the mobile sections, App Store and Play Store data-safety reviewers).

---

## 1. Who we are and what Ziggy is

Ziggy is a local-first AI smart home assistant. The Ziggy hub runs on a mini PC in your home alongside Home Assistant. Voice commands, intent parsing, smart home control, and most automation execution happen on that local hardware. Some functions — remote access to your home from outside the LAN, optional cloud-LLM fallback, scheduled backups, account management — are provided by Ziggy Cloud.

For the purposes of privacy law, the **data controller** is the trading entity behind Ziggy (currently operating as an Israeli **עוסק פטור** — see [`TERMS.md`](TERMS.md) for the legal entity description). Contact: **legal@ziggyhome.example**.

<!-- LAWYER REVIEW: data-controller naming — needs registered name and address before publication. -->

---

## 2. Summary of data we handle

| Data | Where it lives | Why |
|---|---|---|
| Account info (email, hashed password) | Ziggy Cloud relay (Fly.io Amsterdam) | Login, billing, support |
| Subscription + billing metadata (customer id, plan, status, last invoice timestamp) | Ziggy Cloud relay + Stripe | Charging, kill-switch on cancel |
| Home metadata (home id, friendly name, status, per-home tunnel URL, last connect time) | Ziggy Cloud relay | Routing app → your home |
| Device list, room map, automations, IR codes | Mini PC (your home only) | Local operation |
| Voice audio | Mini PC (transient, never persisted) | STT runs locally |
| Voice transcripts | Mini PC; transient cloud routing only when cloud-LLM fallback triggers | Intent execution; cloud-LLM only on Q&A fallback |
| Automation history, anomaly history, presence pings | Mini PC (your home only) | Suggestions, alerts, "anomaly" detection |
| Push subscription endpoints (web push) | Mini PC + your browser/device push service | Delivering notifications |
| Encrypted backups (envelope-encrypted) | Backblaze B2 EU (`eu-central-003`, Amsterdam) | Disaster recovery |
| Mobile push tokens (APNs / FCM) | Ziggy Cloud relay | Delivering mobile notifications |
| Mobile foreground/background location (if you enable presence) | Mini PC (your home only) | Home/away detection, geofence automations |
| Mobile local crash logs | Your mobile device (and Apple Crash Analytics / Google Play crash reporting if you opt in at OS level) | Diagnosing app crashes |
| Operational audit log (relay-side: rotate-secret, support-tunnel-open, kill-switch flip) | Ziggy Cloud relay | Compliance, support transparency |

What we do **not** collect:

- Ambient audio. Voice capture is push-to-talk only.
- Mobile advertising identifiers (IDFA on iOS, Android Advertising ID). We have no advertising business.
- Device fingerprint / behavioural-tracking signals for cross-app or cross-site tracking.
- Camera footage. Ziggy v1 does not integrate cameras.
- Payment card data. Stripe handles cards; we never see PAN.

<!-- LAWYER REVIEW: confirm the "not collected" list matches what the mobile app actually does at OS level (vs. what we control). E.g. crash analytics on the Apple side may collect more than we know. -->

---

## 3. How your home reaches the cloud and back

When you use the app from outside your home, the request travels:

> Your app → Ziggy Cloud relay (Fly.io, Amsterdam) → Cloudflare Tunnel → your mini PC.

The Cloudflare Tunnel is end-to-end encrypted between your mini PC's local `cloudflared` daemon and the Ziggy Cloud relay. Cloudflare's network provides NAT traversal only and **cannot read tunnel contents**.

The Ziggy Cloud relay can read the request payload (it must, in order to forward it), but does not retain bodies. Proxy logs record only: method, path, status code, timing, and a per-home id. Sensitive paths (auth, voice) are excluded from path-level logging.

Architecture sources: [`../docs/ARCHITECTURE_RELAY.md`](../docs/ARCHITECTURE_RELAY.md), [`../relay/`](../relay/).

---

## 4. Web / PWA data, in detail

When you use Ziggy via your browser (PWA) or the desktop interface inside your LAN:

- **Account.** Email + hashed password (bcrypt) live in `users.db` on the mini PC, with a mirror in the relay account database. Reset tokens are short-lived (hours).
- **Telemetry.** Aggregate non-content telemetry — version numbers, error counts, last successful heartbeat — flows to the relay on a schedule, never tied to message content.
- **Voice transcripts.** Local-only by default. Transcripts cross the cloud only when (a) you trigger cloud-LLM fallback or (b) Whisper cloud is invoked as STT fallback after local STT fails. In both cases the transcript is sent at request time and not persisted by us beyond the request lifecycle. The third-party processor (OpenAI or Anthropic) is bound by their no-training-on-API-data policy in effect at the time of the request.
- **Backups.** Daily envelope-encrypted backups upload from your mini PC to Backblaze B2 EU (`eu-central-003`, Amsterdam). The master encryption key lives in the founder's password manager + a physical safe — never on the relay. We can rotate keys but cannot read your backups without your cooperation. See [`../docs/DESIGN_BACKUP_DR.md`](../DESIGN_BACKUP_DR.md).

### 4.1 Where it's stored

- Account, billing, home metadata, audit log: Fly.io Amsterdam (EU region — GDPR-clean).
- Backup blobs: Backblaze B2 `eu-central-003` (Amsterdam).
- Stripe processes payment data in their regional infrastructure per the Stripe DPA.

We do not transfer this data outside the EU/EEA except as required by the LLM cloud-fallback flow (Section 5).

<!-- LAWYER REVIEW: Israeli + EU residents both protected — confirm the EU residency claim doesn't accidentally create EU-only obligations we then breach for Israeli customers (or vice versa). -->

### 4.2 Retention

- Account record: retained while you have an account. Deleted within 30 days of account-deletion request — see Section 7.
- Home metadata + tunnel URL: retained while the home is paired. Removed within 30 days of un-pairing.
- Audit log (relay): 90 days rolling.
- Backups: 7 daily + 4 weekly per home, enforced by B2 lifecycle (not application code). Older backups are deleted automatically.
- Voice transcripts on cloud-fallback path: transient (request lifecycle only). Not persisted.
- Mobile push tokens: retained while paired. Removed within 30 days of un-pair.

### 4.3 Access and audited support sessions

Founder-only access. Two narrowly-scoped exceptions:

1. **Support sessions.** When you ask us to help, we may open a temporary SSH tunnel into your mini PC. Every session is logged in the relay audit log (start time, end time, founder identifier) and is viewable on request. We will never open a tunnel without your prior in-app or email approval for that session.
2. **Incident investigation.** If we detect a security incident affecting your home or the relay, we may inspect the minimum data needed to triage. Such inspections are recorded in the audit log.

We never share account or home data with marketing partners, data brokers, or advertisers. We do not have any.

<!-- LAWYER REVIEW: confirm "prior approval" formulation meets Israeli requirement for affirmative consent in the surveillance context. -->

---

## 5. Voice specifics

- **Capture is push-to-talk only.** You tap the mic button; audio is captured until you release. No wake word in v1 (`hey_mycroft` directory is dormant; see locked decision 2026-05-24).
- **STT (speech-to-text)** runs locally via Whisper on your mini PC. The audio never leaves your home in the default flow.
- **Cloud STT fallback** is invoked only when local Whisper fails — at that moment, the audio chunk for that turn is sent to OpenAI Whisper API for transcription and discarded immediately on return. Transcripts are not persisted on our side.
- **Intent execution** is local by default. If the local intent parser cannot resolve your request, the transcript (text — not audio) is forwarded to the cloud-LLM provider (OpenAI gpt-4o-mini, or Anthropic Claude Haiku when wired) for a free-form answer. Transcript is sent at request time, not persisted.
- **TTS (text-to-speech) is OFF in v1.** Responses are delivered as on-screen text and push notifications. Spoken responses return in v1.1 as a paid feature, gated behind explicit consent. When TTS is enabled in v1.1, the text of the response (not your voice) is sent to the TTS provider (Azure Neural TTS or local Piper, depending on plan) and the synthesised audio is streamed back; the request text is not persisted.

**Voice transcript storage on your hub.** Local transcripts may be retained on your mini PC for the "recent commands" history and for offline anomaly review. Default retention is the most-recent N entries (configurable). This is a local-only retention; the transcripts never leave your hub absent a fallback as described above. You may clear local history at any time from Settings.

<!-- LAWYER REVIEW: confirm the v1.1 TTS opt-in flow language. -->

---

## 6. Founder support tunnels — privacy treatment

Each support session has:

- **Prior consent** from you for that session (in-app prompt or replied email).
- **Audit-log entry** on the relay (start, end, founder id).
- **No persistence** of your data beyond what the founder copies into the support ticket to remember the diagnosis. We never bulk-copy your home data into our systems.

You can request a list of all support sessions ever opened on your home; we will produce it from the audit log within 14 days.

<!-- LAWYER REVIEW: 14-day SLA for log production — confirm consistent with Israeli data-subject access timelines. -->

---

## 7. Your rights

You can:

- **Access.** Request a copy of the personal data we hold about you. We will respond within 30 days.
- **Export.** Download a structured bundle of your account, home metadata, automations, voice transcript history, and most recent backup blob, via the in-app data export flow (design in [`../docs/IN_APP_LEGAL_SURFACES.md`](../docs/IN_APP_LEGAL_SURFACES.md) — coming in Chunk 2).
- **Delete.** Delete your account from inside the app. We will action the deletion within 30 days, send you a confirmation email when it's done, and purge all cloud-side personal data identifying you. Local data on your mini PC is yours and is not touched by remote deletion (you can wipe the hub yourself any time).
- **Correct.** Update incorrect personal data (e.g. account email) from in-app Settings, or by emailing us.
- **Object / restrict.** Ask us to restrict specific processing.
- **Withdraw consent.** Where processing is consent-based (e.g. voice transcript storage in v1.1, support tunnel sessions), you can withdraw consent prospectively.

To exercise any right, email **legal@ziggyhome.example**. We will not charge you to action a reasonable request.

<!-- LAWYER REVIEW: rights catalogue — confirm coverage of Israeli Protection of Privacy Law (PPL) + GDPR Articles 15–22 + future Israeli PPL amendments in pipeline. -->

---

## 8. Mobile app data

When you install the Ziggy iOS or Android app, the following data is involved.

### 8.1 What the mobile app collects

| Data | Collected | Linked to identity | Purpose |
|---|---|---|---|
| Push notification token (APNs / FCM) | Yes | Yes (to your home) | Delivering alerts |
| Foreground location (if you enable presence-based automations) | Yes — only while in use | Yes (to your home) | Geofence triggers, home/away |
| Background location (if you enable "Always" / Android "background location") | Yes — when permitted by OS | Yes (to your home) | Home/away detection while phone is in pocket |
| Crash logs (local + OS-level reporting) | Yes — local always; OS-level only if you opt in via Apple Diagnostics & Usage / Google Play crash settings | No (anonymous on OS path) | Diagnosing crashes |
| Account email + auth token | Yes | Yes | Login |

**What we do NOT collect** on mobile:

- Advertising identifiers (IDFA on iOS, Android Advertising ID).
- Contacts, calendar, photos, microphone (mic permission requested only when you push-to-talk; audio leaves your phone only via the same flow as Section 5 above).
- Browsing history outside the app.
- Any tracking signal across other apps / sites.

<!-- LAWYER REVIEW: confirm the "not collected" list matches the Capacitor wrapper + any native plugins. A Capacitor or Firebase SDK update can quietly enable analytics — re-verify at each release. -->

### 8.2 Background location — the honest version

If you turn on presence-based automations and grant "Always" on iOS (or "Background location" on Android), the OS will pass occasional location updates to the app even when it is not on screen. We use these updates **only** to determine whether you are inside or outside the home geofence and to trigger automations you have configured. The raw coordinate stream stays on your phone and on your mini PC; it is not transmitted to Ziggy Cloud or any third party. You can revoke the permission at any time from your OS settings; doing so disables geofence automations but does not break any other feature.

iOS will show a system reminder periodically indicating that the app has accessed your location in the background. That reminder is Apple's, not ours.

<!-- LAWYER REVIEW + APP STORE / PLAY STORE REVIEW: this paragraph is what justifies "Always" location to Apple's reviewers and to the user. Wording is high-leverage. -->

### 8.3 Crash logs

Crash logs generated by the Ziggy mobile app are stored locally on the device and viewable to you. We also benefit from the platform-level crash reporting (Apple Crash Analytics, Google Play Crash Reporting) **only when you have opted in to those OS-level settings**. Those reports are aggregated and stripped of identifiers by the platform; we cannot link them back to you. We do not use any third-party crash SDK (Sentry, Crashlytics, etc.) in v1.

<!-- LAWYER REVIEW: confirm "no third-party crash SDK" statement matches the current Capacitor + plugin set. -->

### 8.4 Push notifications

We send push notifications via APNs (Apple) and FCM (Google). The token is associated with your home id. The notification payload is the minimum needed to render the alert; for sensitive notifications (e.g. "Front door opened at 02:14"), we keep payloads brief. Apple and Google have visibility into delivery metadata per their platform terms; they do not see notification body content beyond what is necessary to deliver it.

---

## 9. Third-party processors

| Processor | Purpose | Data shared | Region |
|---|---|---|---|
| **Stripe** | Payment processing | Customer name, email, billing address, card token | EU + global Stripe footprint per Stripe DPA |
| **Cloudflare** | Tunnel transport | Encrypted tunnel bytes only (cannot read contents) | Global edge |
| **Fly.io** | Relay hosting | Relay disk contents (account/home metadata DB) | Amsterdam (EU) |
| **Backblaze B2** | Encrypted backup storage | Encrypted backup blobs (we hold the master key) | `eu-central-003` Amsterdam (EU) |
| **OpenAI** | Cloud-LLM fallback for Q&A; Whisper API as STT fallback | Transcript text at request time (LLM) or audio chunk at request time (Whisper) | Per OpenAI's regional infrastructure |
| **Anthropic** | Cloud-LLM fallback (under consideration, not active in v1) | Transcript text at request time | Per Anthropic's regional infrastructure |
| **Azure Cognitive Services** | Hebrew/English neural TTS (v1.1 only — off in v1) | Response text at request time | Azure region tbd at TTS-on date |
| **Apple Push (APNs)** | iOS push notifications | Push token, notification payload | Apple infrastructure |
| **Google FCM** | Android push notifications | Push token, notification payload | Google infrastructure |
| **Home Assistant** | Local automation engine (runs on your hardware) | None to us — local-only | Your mini PC |

We have signed (or will sign before commercial launch) the standard Data Processing Agreement with each processor we control (Stripe, Fly.io, Backblaze, Cloudflare, OpenAI, Anthropic, Azure). Apple and Google operate per their platform terms; no separate DPA is offered.

<!-- LAWYER REVIEW: confirm DPAs are in place for each processor before commercial launch. Maintain a separate DPA-status spreadsheet outside this file. -->

---

## 10. Subscriptions and the kill switch

Cancelling a paid Subscription does not delete or disable your local Ziggy install. The cloud-gated features that stop working on cancellation are: remote access (the relay refuses to proxy traffic), cloud-LLM fallback, scheduled backups, and TTS (when shipped in v1.1).

Founder support tunnels are never gated.

Local sensors, automations, IR control, and local voice continue to work indefinitely on your kit.

See [`TERMS.md`](TERMS.md) Section 4 for the commercial side; see [`../DECISIONS.md`](../DECISIONS.md) for the product decision history behind this.

---

## 11. Account deletion and data export

You can delete your account from inside the Ziggy app under Settings → Account → Delete Account. The flow:

1. You confirm in the app.
2. We email you a confirmation that the deletion request has been received.
3. Within 30 days, all cloud-side personal data identifying you is purged: account record, home metadata, billing identifiers (subject to legal-retention exceptions for tax records below), push tokens, audit-log entries that personally identify you (with the row preserved in pseudonymised form).
4. We email you a second confirmation when the deletion is complete.
5. Your local hub data is yours; we do not remotely wipe it. You can wipe it yourself via the in-app "factory reset" flow.

Legal-retention exception: Israeli tax law may require us to retain transaction-level invoice records for up to 7 years. Where we must keep records for this reason, we will retain the minimum (invoice id, date, amount, your name if printed on the invoice) and treat the data as restricted-access tax records.

Data export: request via the in-app flow or by emailing **legal@ziggyhome.example**. We respond within 30 days with a structured download bundle.

<!-- LAWYER REVIEW: 7-year retention for tax records — confirm. Confirm shaping of the deletion timeline (30 days) consistent with Israeli + EU norms. -->

---

## 12. Children

Ziggy is not directed at children under 16. Voice transcripts may incidentally contain children's voices because the system is used in family homes; STT happens locally and transcripts are not persisted on our side absent fallback as described in Section 5.

Parents and guardians should be aware that geofence automations using the household's adult mobile devices may infer the presence of children in the home as a side-effect. We do not record or transmit individual identifiers for any household member other than the account holder(s).

<!-- LAWYER REVIEW: confirm wording compatible with Israeli protections for minors. -->

---

## 13. Security

- All data in transit uses TLS 1.2+.
- Tunnel traffic is additionally end-to-end encrypted between the mini PC's `cloudflared` and the relay.
- Account passwords are hashed with bcrypt (matching cost factor across edge and relay — see [`../docs/SECURITY_REPORT.md`](../SECURITY_REPORT.md)).
- Backups use envelope encryption (AES-256-GCM, HKDF subkeys per file). Master key is in the founder's password manager + offline physical safe — never on the relay. See [`../docs/DESIGN_BACKUP_DR.md`](../DESIGN_BACKUP_DR.md).
- We rotate cloud secrets per the cadence in [`../docs/SECRETS_ROTATION_2026-05.md`](../docs/SECRETS_ROTATION_2026-05.md).

If we discover a security incident materially affecting your data, we will notify you within 72 hours of confirming the incident, with what we know at the time.

<!-- LAWYER REVIEW: 72-hour notification — confirm Israeli + EU GDPR Article 33 alignment. -->

---

## 14. Changes to this policy

Material changes are notified by in-app banner and account-email at least 30 days before they take effect. Trivial wording fixes are not separately notified.

---

## 15. Contact

- **General privacy questions:** legal@ziggyhome.example
- **Data-subject access / deletion / export:** legal@ziggyhome.example
- **Security incident report:** security@ziggyhome.example
- **Support:** support@ziggyhome.example

<!-- LAWYER REVIEW: registered company address required before publication. -->

---

*End of working draft. Cross-references: [`TERMS.md`](TERMS.md), [`RUNBOOK_LEGAL_COMPLIANCE.md`](RUNBOOK_LEGAL_COMPLIANCE.md), [`../docs/ARCHITECTURE_RELAY.md`](../docs/ARCHITECTURE_RELAY.md), [`../docs/DESIGN_BACKUP_DR.md`](../docs/DESIGN_BACKUP_DR.md), [`../docs/RUNBOOK_VOICE.md`](../docs/RUNBOOK_VOICE.md), [`../DECISIONS.md`](../DECISIONS.md). Mobile data-safety declarations: see `docs/APP_STORE_DATA_SAFETY.md` and `docs/PLAY_STORE_DATA_SAFETY.md` (Chunk 2 of this work). In-app legal surface designs: see `docs/IN_APP_LEGAL_SURFACES.md` (Chunk 2).*
