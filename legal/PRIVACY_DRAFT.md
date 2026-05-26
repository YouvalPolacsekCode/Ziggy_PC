# Ziggy — Privacy Policy (DRAFT)

**Status:** Working draft. Not legally reviewed. Do not publish.
**Last updated:** 2026-05-25

This is a working draft of the Ziggy privacy policy. It captures what data the system handles today and how it moves between local hardware, the Ziggy Cloud relay, and third-party services. Sections are placeholders where the legal/commercial decisions are not yet final.

---

## 1. What Ziggy is

Ziggy is a local-first AI smart home assistant. The Ziggy hub runs on a mini PC in your home alongside Home Assistant. Voice commands, intent parsing, smart home control, and most automation execution happen on that local hardware. Some functions — remote access to your home from outside the LAN, optional cloud-LLM fallback for free-form questions, account management — are provided by Ziggy Cloud.

## 2. Data we collect

| Data | Where it lives | Why |
|---|---|---|
| Account info (email, hashed password) | Ziggy Cloud relay | Login, billing |
| Home metadata (home id, name, status, per-home tunnel URL) | Ziggy Cloud relay | Routing user app → your home |
| Device list, room map, automations, IR codes | Mini PC (your home only) | Local operation |
| Voice audio | Mini PC (transient) | STT happens locally; audio is not persisted |
| Voice transcripts | Mini PC + transient cloud routing for fallback Q&A | Intent execution; cloud-LLM only on Q&A fallback |
| Automation history, anomaly history, presence pings | Mini PC (your home only) | Suggestions, alerts, "anomaly" detection |
| Push subscription endpoints | Mini PC + your browser/device push service | Delivering notifications |

We do not collect ambient audio. Voice capture is push-to-talk only.

## 3. How your home reaches the cloud and back

When you use the app outside your home, your request travels:

> Your app → Ziggy Cloud relay (Fly.io, Amsterdam) → Cloudflare Tunnel → your mini PC.

The Cloudflare Tunnel is end-to-end encrypted between your mini PC's local `cloudflared` daemon and the Ziggy Cloud relay. Cloudflare's network provides NAT traversal only and **cannot read tunnel contents**. The Ziggy Cloud relay can read the request payload (it must, in order to forward it), but does not retain bodies — proxy logs record method, path, status code, and timing only.

You can verify the topology yourself in [`docs/ARCHITECTURE_RELAY.md`](../docs/ARCHITECTURE_RELAY.md). The source code of the relay is available at [relay/](../relay/).

## 4. Third parties

- **Cloudflare** — operates the tunnel transport. Cannot read tunnel contents.
- **Fly.io** — hosts the relay VM. Has access to relay disk (the `homes`/`users`/`invites` SQLite database).
- **OpenAI** — used for two purposes (both optional, both transient): (1) intent parsing via GPT-4o-mini when the local parser cannot resolve a request; (2) Whisper API as STT fallback when local Whisper fails. Audio and text are sent only at the moment of the request; OpenAI's no-training-on-API-data policy applies (verify current terms).
- **Azure Cognitive Services** — Hebrew/English neural TTS. Disabled in v1 (push + on-screen text only). Re-enabled as a paid feature in v1.1.
- **Anthropic** — under consideration as cloud-LLM fallback alongside OpenAI. Not active in v1.
- **Home Assistant** — runs on your hardware. We do not exfiltrate HA state to our cloud.

## 5. Subscriptions and the kill switch

Cancelling a paid subscription does not delete or disable your local Ziggy install. Local sensors, automations, IR devices, and local voice keep working. The cloud-gated features that go away on cancellation are: remote access (the relay refuses to proxy traffic), cloud-LLM fallback, scheduled backups, TTS (v1.1).

Founder support tunnels (when you ask us for help) are never gated.

## 6. Account deletion and data export

> **Placeholder.** Endpoints `/api/account/delete` and `/api/account/export` are not implemented in v1. The legal commitment will land before commercial launch. Until then: support@ziggyhome.example will action requests manually within 30 days.

## 7. Data retention

> **Placeholder.** Per-home data on your hub is retained until you delete the home or wipe the hardware. Relay-side data (account, home metadata, tunnel URL, last connect time) is retained until account deletion. Audit logs are kept 90 days.

## 8. Children

Ziggy is not directed at children under 16. Voice transcripts may incidentally contain children's voices; STT happens locally and transcripts are processed and discarded.

## 9. Israeli buyer's rights

Per Israeli consumer protection law, the 14-day return window applies to physical kits sold direct.

## 10. Changes to this policy

We'll post material changes in-app and email account holders. Trivial wording fixes will not.

---

*End of draft. Cross-references: [`docs/ARCHITECTURE_RELAY.md`](../docs/ARCHITECTURE_RELAY.md), [`docs/RUNBOOK_VOICE.md`](../docs/RUNBOOK_VOICE.md).*
