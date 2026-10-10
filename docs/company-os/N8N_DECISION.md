# n8n — audited and removed (2026-09-18)

**Decision: n8n is not part of the Ziggy company architecture.** Every workflow that
was planned for it is done by the Desk itself, with tests, and the ~US$6/month
always-on machine plus a second system to log into, back up and upgrade is avoided.
The `n8n/` folder and connector were deleted from the Desk repo. Re-adding it later is
a matter of restoring that folder from git history; nothing else depends on it.

## What the Desk already has

| Capability | Where |
|---|---|
| Scheduled jobs | `desk/company/collectors.py` — every 20 s tick; per-connector intervals; the daily digest clock |
| Outbox with retries, backoff, dead letters | `desk/company/outbox.py` |
| Integration adapters | `desk/company/connectors/*` (14 vendors) |
| Lead fan-out | `desk/company/leads.py` |
| Monitoring + alerting | connectors open TODAY items; urgent items fire the notification webhook (`desk/company/digest.py`) |
| Inbound webhooks | `POST /api/leads`, `POST /api/company/support/inbound/{token}` |

## The three planned workflows

### 1. Daily Hebrew digest
- **Trigger → steps → destination:** 07:30 → read the Desk summary → compose Hebrew text → POST to the notification webhook.
- **Why n8n was proposed:** a cron and an HTTP call without code.
- **Can the Desk do it natively?** Yes — `digest.maybe_send_digest()` runs on the scheduler tick, once per day at `DIGEST_AT` (Israel time), composes from live state (`triage.glance`, `leads.stats`, fleet metrics, setup progress) and posts through the same webhook the approval notifications already use. Tested (`test_digest_composes_hebrew_and_sends_once_per_day`).
- **Verdict:** Desk. Fewer moving parts and the text is richer because it reads the Desk's own models.

### 2. Support mail → Desk
- **Trigger → steps → destination:** Brevo inbound-parse webhook → extract from/subject/body → POST to the Desk support inbox.
- **Why n8n was proposed:** Brevo cannot send an `X-Api-Key` header, so a translator was needed.
- **Can the Desk do it natively?** Yes — `POST /api/company/support/inbound/{token}` accepts Brevo's `items[]` shape directly, authenticates by a token in the URL (`SUPPORT_INBOUND_TOKEN`), rate-limits, and opens a TODAY item (urgent if the subject says so). Tested (`test_support_inbound_token_route_accepts_brevo_shape`).
- **Verdict:** Desk. One endpoint instead of a middleman.

### 3. Fleet-down alert
- **Trigger → steps → destination:** every 10 min → read fleet → if any home is down → POST alert.
- **Why n8n was proposed:** polling and conditional alerting.
- **Can the Desk do it natively?** Yes — the relay connector already runs every 5 min and opens an urgent TODAY item per down home; `inbox.open_item` now pushes every urgent item to the webhook the moment it opens, and recovery closes it. Tested (`test_urgent_item_fires_webhook_but_info_does_not`).
- **Verdict:** Desk. It was already 90 % built; n8n would have duplicated it with a coarser interval.

## When n8n would earn its place

- A non-developer needs to build new automations by hand, frequently, across vendors the Desk has no connector for.
- Long-running multi-step human workflows with branching (n8n's form/wait nodes).
- Neither is true today. If it becomes true, restore `n8n/` from commit `78ea112`, deploy, and add the connector back; the Desk's `/api/company/*` JSON endpoints were designed so an external automation tool can read the same summaries.
