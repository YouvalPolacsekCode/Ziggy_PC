# Billing Audit & Design Plan (Prompt 9)

**Date:** 2026-05-28
**Status:** Audit complete; design plan awaiting founder approval.
**Scope:** Subscription billing (Stripe), kill-switch gating, founder slot counter, iOS billing strategy. Absorbs the kill-switch design from deleted Prompt 3.
**Out of scope (do not touch):** onboarding, voice, backup engine internals, OTA pipeline, HA pinning, legal docs, dashboard, mobile pairing. (Parallel session is running Prompt 11 on legal docs.)

---

## Part 1 — Inventory of Existing State

### 1.1 The Prompt 2 stub: `_subscription_active()`

**Location:** [relay/app/routers/ota.py:94-104](relay/app/routers/ota.py#L94-L104) — tracked, committed.

```python
async def _subscription_active(home_status: str) -> bool:
    """Stub for Prompt 9's Stripe-driven subscription_state.
    Today: any home that isn't explicitly 'suspended' is treated as active.
    ...
    TODO(Prompt 9): replace with a read of homes.subscription_state once
    the Stripe webhook handler populates that column. One-line swap.
    """
    return home_status != "suspended"
```

**Direct callers (`_subscription_active` invocation):**

| File | Line | Endpoint gated | What 403 means today |
|---|---|---|---|
| [relay/app/routers/ota.py](relay/app/routers/ota.py#L195) | 195 | `GET /api/devices/{device_id}/ota-manifest` | Hub stops getting update manifests |
| [relay/app/routers/telemetry.py](relay/app/routers/telemetry.py#L116) | 116 | `POST /api/devices/{device_id}/telemetry` | Hub telemetry rejected; admin dashboard goes dark |

**Parallel suspension checks (do NOT call the stub but enforce the same rule):**

| File | Line | Check | Endpoint |
|---|---|---|---|
| [relay/app/routers/proxy.py](relay/app/routers/proxy.py#L71) | 71 | `home["status"] == "suspended"` | `ALL /api/proxy/*` (remote-access tunnel passthrough) |
| [relay/app/routers/public_presence.py](relay/app/routers/public_presence.py#L94) | 94 | `WHERE status != 'suspended'` | `/api/presence/*` |

**Audit assumption to verify in Chunk 2:** there is no fifth call site sneaking past the central stub. The proxy + presence checks are pre-stub duplicates that should also migrate to the same subscription helper.

### 1.2 The `homes` table — current schema

**Location:** [relay/app/database.py:10-20](relay/app/database.py#L10-L20) (+ ALTER in `init_db()` at line 198).

| Column | Type | Default | Used for billing? |
|---|---|---|---|
| `id` | TEXT PK | — | yes (home_id = stripe customer mapping) |
| `name` | TEXT NOT NULL | — | no |
| `type` | TEXT | `'cloud'` | no |
| `tunnel_url` | TEXT | NULL | no |
| **`status`** | TEXT | `'provisioning'` | **operational lifecycle, NOT billing — see §1.3** |
| `relay_secret` | TEXT NOT NULL | — | no |
| `cf_tunnel_id` | TEXT | NULL | no |
| `created_at` | TEXT NOT NULL | — | no |
| `owner_email` | TEXT | NULL | yes (Stripe customer email lookup) |
| `ota_pinned_release_id` | INTEGER | NULL | no |

**`status` value set in use today** (from grep across relay router code):
`provisioning`, `pending_setup`, `active`, `suspended`, `deprovisioning`, `failed: <reason>`.

### 1.3 Critical distinction — `status` vs. the new `subscription_state`

The Prompt 9 spec phrases this as "replace with a read of `homes.subscription_state`". A naive read implies dropping `status` in favor of `subscription_state`. **That would conflate two separate concerns.** This audit recommends keeping both:

- **`status`** — operational lifecycle. Set by the relay/factory: `provisioning → active → deprovisioning`. `suspended` here means "founder manually suspended this hub" (e.g. abuse, chargeback fraud, founder safety lock). Tied to the hub's existence, not the user's payment.
- **`subscription_state`** — billing lifecycle. Set ONLY by Stripe webhooks: `trialing → active → past_due → cancelled → refunded`. Tied to the user's payment status.

A hub can be `status=active` but `subscription_state=cancelled` (kit fully working locally, cloud features off). A hub can be `status=suspended` but `subscription_state=active` (founder-suspended for abuse despite valid payment; refund/credit handled out-of-band).

**Gating policy then becomes:** "block cloud feature X" iff `status != suspended AND subscription_state is in active-set`. Both must be green. (Order matters for the 403 message: operational suspension is more important to surface than billing.)

### 1.4 Existing feature flag system — NOT a paywall

[frontend/src/stores/featuresStore.js](frontend/src/stores/featuresStore.js) and [backend/routers/admin_router.py:157-167](backend/routers/admin_router.py#L157-L167) implement a *product* feature toggle system (`buddy_mode`, `voice`, `task_tracking`, etc.). **These are not billing tiers.** They control which UI sections render and which routes mount. Do not co-opt this for subscription gating — keep paywall logic separate.

### 1.5 Cloud LLM — currently ungated, dispersed across the edge agent

Grep for `openai`, `anthropic`, `claude.haiku`, `cloud_llm`, `llm_fallback` (excluding tests) found cloud-LLM touch points in:

- [core/handlers/chat_handler.py](core/handlers/chat_handler.py) — primary conversational fallback
- [core/intent_parser.py](core/intent_parser.py) — intent extraction may call cloud
- [backend/routers/intent_router.py](backend/routers/intent_router.py) — HTTP entry into intent
- [backend/routers/map_router.py](backend/routers/map_router.py) — home-map LLM rendering
- [integrations/openai_client.py](integrations/openai_client.py) — single SDK wrapper
- [interfaces/voice_interface.py](interfaces/voice_interface.py) — voice → intent → cloud LLM
- [services/web_manager.py](services/web_manager.py), [services/map_renderer.py](services/map_renderer.py)

**Implication for gating:** gating every call site is fragile. The chokepoint is [integrations/openai_client.py](integrations/openai_client.py) (every cloud-LLM call passes through it). One subscription-state check inside that wrapper covers all 7+ call sites.

**Open assumption:** the edge agent does not currently know its own `subscription_state` — that data lives only on the relay. The edge needs to learn it. See design §2.4 for the proposed mechanism.

### 1.6 Backups — currently ungated, single nightly entry point

[services/backup_engine.py:743](services/backup_engine.py#L743) — `run_daily_backup_with_lock()`. Scheduled by [services/ziggy_scheduler.py](services/ziggy_scheduler.py) at 02:00 local. No subscription check anywhere in the engine. Relay-side endpoints in [relay/app/routers/backup_keys.py](relay/app/routers/backup_keys.py) (seal-key, unseal, backup-status POST/GET, restore-events) are also ungated.

**Gating chokepoint:** the single function entry point `run_daily_backup_with_lock()`. If subscription is inactive, the engine short-circuits at the top of `_preflight()` (line 244). On-demand restore operations should still work for a grace window (per design §3.3) so cancelled users can recover their data — this is also a privacy/legal requirement that pairs with the legal session's data-retention text.

### 1.7 Remote access — already 403s on `status=suspended`, needs subscription_state addition

[relay/app/routers/proxy.py:71](relay/app/routers/proxy.py#L71) is the single chokepoint for all hub-bound mobile/web traffic via Cloudflare Tunnel. Easy migration target: add a `subscription_state` check next to the existing `status` check.

### 1.8 Support tunnel — does NOT pass through `proxy.py`

I did not find a dedicated support-tunnel router in the relay. Per `DECISIONS.md`, the founder uses SSH via the per-home Cloudflare Tunnel directly (not through the `/api/proxy/*` HTTP path). **This means the existing proxy gate already does not block support tunneling** — the founder's SSH is end-to-end through CF, not relayed. Confirms the "support tunnel never gated" requirement is met by current architecture as long as we don't extend gating beyond the proxy.

**Risk to flag:** if a future change routes founder support traffic through `proxy.py` (e.g. an admin web terminal), the subscription gate added in Chunk 3 would inadvertently block support. Mitigate with a `X-Relay-Role: founder_support` bypass in `proxy.py` enforced at gate time. Recommend including this in Chunk 3 even though no use case exists today.

### 1.9 Frontend — no pricing UI exists

Grepped `frontend/src/pages/` and `frontend/src/components/`: zero pricing pages, zero paywall components, zero upgrade prompts. Founder slot counter UI also does not exist.

### 1.10 Mobile (Capacitor wrapping the PWA)

Mobile-app code in this repo: [frontend/src/lib/mobileApi.js](frontend/src/lib/mobileApi.js), [frontend/src/lib/native.js](frontend/src/lib/native.js), [frontend/src/pages/MobileOnboarding.jsx](frontend/src/pages/MobileOnboarding.jsx), [frontend/src/pages/MobileDiagnostics.jsx](frontend/src/pages/MobileDiagnostics.jsx). The native shell lives in a separate repo at `~/ziggy_mobile/` (per [AUDIT.md:214](AUDIT.md#L214)). No StoreKit/IAP/RevenueCat references anywhere — clean baseline for the "web checkout, deep-link only" strategy.

### 1.11 Stripe / payment dependencies

`.env.example`: no `STRIPE_*` keys. `requirements.txt`: no `stripe`. No webhook secret. No price IDs hardcoded. Zero existing Stripe state. Greenfield install.

### 1.12 Existing tests covering the suspension gate

[tests/test_relay_ota_endpoint.py:159-165](tests/test_relay_ota_endpoint.py#L159-L165) and [tests/test_relay_telemetry_endpoint.py:157-165](tests/test_relay_telemetry_endpoint.py#L157-L165) both flip a home to `status='suspended'` and assert 403. **These tests are precious** — they encode the contract for the operational suspension gate. The Chunk 3 work must add a *second* set of tests for `subscription_state` (per-state matrix) and must NOT modify the existing suspension tests, since the two gates remain distinct (§1.3).

### 1.13 Existing docs touching billing scope

| Doc | Where billing is mentioned | Action |
|---|---|---|
| [AUDIT.md:259](AUDIT.md#L259) | "no relay-side billing" | will need a follow-up note after Chunk 3 |
| [docs/CLOUD_SURFACE_INVENTORY.md:946,1047](docs/CLOUD_SURFACE_INVENTORY.md#L946) | flags missing `subscription_state` for Prompt 9 | this audit closes both forward refs |
| `docs/BILLING_AUDIT.md` | **this file (new)** | created in Chunk 1 |
| `docs/RUNBOOK_IOS_BILLING.md` | does not exist | created in Chunk 3 |
| `legal/*` | parallel Prompt 11 session is editing these | **do not touch** |

---

## Part 2 — Design Plan: Stripe Integration

### 2.1 Stripe abstraction shape

A thin interface so a future swap (e.g. Lemon Squeezy, Paddle) is one-line for the rest of the codebase. Lives in `relay/app/billing/`.

**Module layout (proposed, not created in Chunk 1):**

```
relay/app/billing/
├── __init__.py
├── provider.py          # Protocol/abstract class — the swap point
├── stripe_provider.py   # Concrete Stripe implementation (uses `stripe` SDK)
├── webhooks.py          # FastAPI router; verifies signatures, dispatches events
├── slot_counter.py      # Founder-slot atomic increment
├── plans.py             # Plan catalog (Founder Lifetime, Std Monthly, Std Annual)
└── invoice.py           # עוסק פטור Israeli invoice generator (sequential numbering)
```

**Abstract interface (sketch — not committed in Chunk 1):**

```python
class BillingProvider(Protocol):
    async def create_checkout(self, home_id: str, plan_id: str, customer_email: str) -> CheckoutSession: ...
    async def get_subscription(self, customer_id: str) -> Subscription | None: ...
    async def cancel_subscription(self, customer_id: str, at_period_end: bool = True) -> None: ...
    async def verify_webhook(self, payload: bytes, signature: str) -> WebhookEvent: ...
    async def list_invoices(self, customer_id: str) -> list[Invoice]: ...
```

The rest of the code calls `provider.create_checkout(...)`, never `stripe.checkout.Session.create(...)` directly.

### 2.2 Webhook handler list

Mounted at `POST /api/billing/stripe/webhook`. Single signature-verification step, then dispatches:

| Stripe event | Handler action | Resulting `subscription_state` |
|---|---|---|
| `customer.subscription.created` (trial) | record trial_started_at; init customer_id | `trialing` |
| `customer.subscription.created` (no trial) / `invoice.paid` first cycle | activate subscription | `active` |
| `invoice.payment_failed` | first failure → log; flip after 1st retry | `past_due` |
| `customer.subscription.updated` (status=past_due) | redundant safety net | `past_due` |
| `customer.subscription.deleted` | cancellation final | `cancelled` |
| `charge.refunded` | mark refund; force-flip | `refunded` |
| `customer.subscription.updated` (status=active after past_due) | recovery | `active` |

All handlers are idempotent (Stripe retries) — keyed off `event.id` deduped in a small `processed_webhooks` table.

**Why these events and not e.g. `checkout.session.completed`:** `checkout.session.completed` fires before payment confirmation in some flows (SCA, Israeli bank 3DS). `invoice.paid` is the authoritative "money landed" signal.

### 2.3 Database migration

New columns on `homes` table, added via the existing idempotent ALTER pattern in `init_db()` ([relay/app/database.py:198](relay/app/database.py#L198)) — matches the prior style for `ota_pinned_release_id` and `hash_algo`. No destructive schema changes.

```sql
ALTER TABLE homes ADD COLUMN subscription_state    TEXT NOT NULL DEFAULT 'trialing';
ALTER TABLE homes ADD COLUMN stripe_customer_id    TEXT;
ALTER TABLE homes ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE homes ADD COLUMN plan_id               TEXT;        -- 'founder_lifetime' | 'std_monthly' | 'std_annual'
ALTER TABLE homes ADD COLUMN trial_started_at      TEXT;        -- ISO timestamp
ALTER TABLE homes ADD COLUMN trial_ends_at         TEXT;        -- ISO timestamp
ALTER TABLE homes ADD COLUMN subscription_updated_at TEXT;      -- last webhook touch
```

Plus two new tables:

```sql
-- Atomic founder slot reservation. PK on the slot number prevents over-sells.
CREATE TABLE IF NOT EXISTS founder_slots (
    slot_number INTEGER PRIMARY KEY,                            -- 1..30
    home_id     TEXT NOT NULL UNIQUE REFERENCES homes(id),
    claimed_at  TEXT NOT NULL
);

-- Idempotency table for webhook dedup. Stripe retries until 2xx, so handlers
-- must tolerate the same event arriving N times.
CREATE TABLE IF NOT EXISTS processed_webhooks (
    event_id    TEXT PRIMARY KEY,                               -- Stripe event.id
    received_at TEXT NOT NULL,
    event_type  TEXT NOT NULL
);

-- Israeli עוסק פטור sequential invoice numbering. Single counter, never gaps.
CREATE TABLE IF NOT EXISTS invoice_sequence (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,          -- the sequence
    home_id         TEXT NOT NULL,
    stripe_invoice_id TEXT UNIQUE NOT NULL,
    issued_at       TEXT NOT NULL,
    amount_ils      INTEGER NOT NULL,                           -- agorot, VAT-inclusive
    vat_amount_ils  INTEGER NOT NULL                            -- agorot
);
```

**Why the founder-slot table is keyed on `slot_number INTEGER PRIMARY KEY`:** SQLite serializes writes; `INSERT INTO founder_slots(slot_number, ...) VALUES (?, ...)` with `slot_number = (SELECT COALESCE(MAX(slot_number),0)+1 FROM founder_slots)` inside a single transaction with a row count check prevents the 31st sell. Alternative (counter row + read-update) has a TOCTOU race.

### 2.4 Edge agent learning its own subscription_state

**Problem.** Cloud LLM gating chokepoint sits inside [integrations/openai_client.py](integrations/openai_client.py) on the edge agent. The edge does not currently know its `subscription_state`.

**Proposed mechanism (lightweight, no new endpoint):** the existing OTA-manifest poll (hourly) already returns a JSON payload from the relay. Add an optional `subscription_state` and `subscription_state_expires_at` field to the manifest response. Edge caches it. The cloud-LLM wrapper reads from cache; if cache is stale beyond TTL, it conservatively refuses the cloud call (local Ollama fallback continues to work, so chat still functions).

**Why piggyback on the OTA manifest rather than a new endpoint:**
- Zero new edge polling logic.
- Manifest already has signature verification (HMAC) — the subscription state is automatically authenticated.
- Cancellation propagation latency: within 1 hour worst case, near-instant if the user reloads the app (app pings manifest on open). Acceptable for v1; tightening to ~minute precision is a v1.1 question.

**Risk:** widens the OTA manifest schema. Mitigate by gating the new field behind a `schema_version` bump and updating [tests/test_relay_ota_endpoint.py](tests/test_relay_ota_endpoint.py) to assert the new field exists when populated.

**Alternative considered and rejected:** a separate `GET /api/devices/{device_id}/subscription` poll. Adds endpoint surface area, doubles HMAC verification cost, no real benefit.

### 2.5 Gating policy per cloud feature

| Cloud feature | Enforcement chokepoint | Today | After Chunk 3 |
|---|---|---|---|
| Remote access (CF Tunnel HTTP proxy) | [relay/app/routers/proxy.py:71](relay/app/routers/proxy.py#L71) | 403 on `status=suspended` only | 403 on `status=suspended` OR `subscription_state ∉ {trialing, active}` |
| OTA manifest delivery | [relay/app/routers/ota.py:195](relay/app/routers/ota.py#L195) (via `_subscription_active`) | 403 on `status=suspended` only | Same call site; helper now reads `subscription_state` too |
| Telemetry ingestion | [relay/app/routers/telemetry.py:116](relay/app/routers/telemetry.py#L116) (via `_subscription_active`) | 403 on `status=suspended` only | Same as OTA |
| Public presence | [relay/app/routers/public_presence.py:94](relay/app/routers/public_presence.py#L94) | filters out `status=suspended` | Filter also excludes inactive subscription_state |
| Cloud LLM | [integrations/openai_client.py](integrations/openai_client.py) (NEW gate at SDK wrapper top) | ungated | Refuse if cached `subscription_state ∉ {trialing, active}`; chat falls back to local Ollama |
| Daily backups | [services/backup_engine.py:743](services/backup_engine.py#L743) (NEW gate at top of `_preflight()`) | ungated | Skip nightly run; log + emit telemetry; restore endpoints remain available for 90-day grace window |
| Backup-key seal/unseal | [relay/app/routers/backup_keys.py](relay/app/routers/backup_keys.py) | ungated | Seal: gated. Unseal: NOT gated (cancelled user must still be able to download their own data). |
| Support tunnel | n/a — direct SSH over CF Tunnel, doesn't pass through proxy router | ungated by architecture | **Stays ungated.** Add a `X-Relay-Role: founder_support` bypass in `proxy.py` defensively. |

**Hard rule (locked in DECISIONS.md):** sensors, automations, IR, local voice continue to work after cancellation. None of the above gates touch the edge agent's local execution loop. Verified: the proposed cloud-LLM gate falls back to local Ollama, not to a hard error.

### 2.6 Founder-pricing slot counter mechanics

**Atomicity strategy:** slot reservation happens at *checkout-session creation*, not at *webhook receipt*. Why: webhook arrives after payment, which is after the user clicked through. A race where two users complete checkout simultaneously and both get founder pricing would be a real loss. Reserve slot atomically when creating the Stripe checkout session for the Founder Lifetime plan:

```sql
BEGIN IMMEDIATE;
INSERT INTO founder_slots (slot_number, home_id, claimed_at)
SELECT COALESCE(MAX(slot_number), 0) + 1, ?, ?
FROM founder_slots
WHERE (SELECT COUNT(*) FROM founder_slots) < 30;
-- If 0 rows affected, founder slots are sold out; fall back to std_monthly checkout
COMMIT;
```

**Refund/cancellation behavior:** if a founder slot is cancelled within Israeli 14-day return window, the slot is released (DELETE FROM founder_slots WHERE home_id = ?). After 14 days, slot stays claimed forever (founder lifetime pricing). This is consistent with "founder lifetime" meaning: claim it within 14 days, keep it forever.

**API surface for slot counter (added in Chunk 3):**

```
GET  /api/billing/founder-slots/remaining   →  {"remaining": 13, "total": 30}
```

Public, unauthenticated, cached for ~60s. Consumed by the landing page and the in-app checkout component.

### 2.7 Israeli VAT-inclusive pricing & invoice format

Per DECISIONS.md "Pricing" section, sub-prices are stated as `$5/mo / $9/mo / $89/yr` in USD. The prompt requires VAT-inclusive display. Locked stance from the prompt: **17% VAT included in displayed prices, Stripe Tax disabled, founder-generated Israeli invoices with sequential numbering (עוסק פטור format).**

**Assumption flagged (please confirm before Chunk 2):**

1. **VAT rate.** Prompt says 17%. Israel raised VAT to 18% on 2025-01-01. Confirm which rate to use in invoice text and what to display on the pricing page. If 18%, that's a one-line `VAT_RATE = 0.18` constant in `relay/app/billing/invoice.py`.
2. **Currency.** DECISIONS.md states prices in USD. Israeli עוסק פטור invoices must show NIS. Will Stripe charge in USD with NIS-displayed converted equivalent on the invoice, or charge in NIS directly? Recommend NIS-charged + USD/NIS dual display on the landing page (since founder pricing was originally communicated in USD but most Israeli customers think in NIS).
3. **DECISIONS.md says "VAT-inclusive pricing — TBD".** Prompt 9 makes this no longer TBD. After Chunk 2 lands, the founder should update DECISIONS.md to lock the VAT-included-in-display call.

### 2.8 iOS billing strategy (the "reader app" rule)

**The rule (Apple Guideline 3.1.3(a)):** an app that lets users access content/services purchased outside the app does NOT need to use Apple IAP, *provided the app does not mention pricing, do upsells, or offer in-app purchase of those services*. This is the rule under which Spotify, Netflix, Kindle ship.

**What this means concretely:**

- The native iOS binary MUST NOT contain text like "$5", "$9", "Subscribe", "Upgrade", "Plans", "Pricing".
- The native iOS binary CAN deep-link out to a web URL where the user can manage their subscription.
- The user must already have an account (created via web) before the iOS app is useful. The pairing flow needs to support this — currently mobile pairing assumes an active subscription, so we'll need a "log in to existing account" path in the app if the user signs up on iPad/desktop.

**Implementation discipline (Chunk 3 runbook):**

1. **Build-time guard.** Add a CI check that greps the iOS binary's localized strings (`frontend/src/lib/i18n/en.js`, `frontend/src/lib/i18n/he.js`) for the banned-word list when building under `CAPACITOR_PLATFORM=ios`. Fail build on hit. Web/Android builds are unaffected.
2. **Mobile UI conditional.** Pricing pages (`PricingPage.jsx`, etc.) check `Capacitor.getPlatform() === 'ios'` and render an "Open in browser to manage subscription →" deep link instead of any pricing.
3. **Subscription status display.** The iOS app CAN show "Trial active until 2026-06-15" or "Subscription required to access remote features" — what it cannot do is offer a path to *purchase* without leaving the app. Tell the user what's missing; let them tap a link to the web.
4. **App Store review notes template.** Include a reviewer note stating: "Subscriptions purchased and managed on website at https://app.ziggy.io. App is a 'reader' per Guideline 3.1.3(a)."

**Android:** Play Store rules are looser. Same deep-link UX is fine; no build-time guard needed.

### 2.9 Cancellation flow & graceful degradation

| User-visible state | What happens locally | What happens in cloud |
|---|---|---|
| Subscription cancelled, in-period | Nothing yet | Subscription still `active` until `current_period_end` (Stripe semantics) |
| Subscription cancelled, period elapsed → webhook `customer.subscription.deleted` | Within ≤1h, cloud LLM gate flips; chat falls back to local Ollama. Sensors, automations, IR, local voice unchanged. Mobile shows "Remote access disabled — local-network access still works" banner. | `subscription_state = cancelled`. Mobile in-app banner via push. |
| `past_due` (payment retry failures) | Same as cancelled but reversible. Banner: "Payment issue — update billing." | `subscription_state = past_due`. |
| Refunded | Same as cancelled, plus founder slot release if within 14d. | `subscription_state = refunded`. |
| Re-subscribes after lapse | Cloud features restored within ~1h (next manifest poll). Founder slot NOT restored if previously released. | New subscription → `active`. |

**LAN-mode fallback for mobile.** Audit confirmation needed but believed true: when mobile app is on the home wifi and the relay 403s, it can still hit the local hub directly via the local IP discovered during pairing. This means cancelled users keep app control on home wifi, only losing it when remote. **Worth confirming in Chunk 3 test plan.** If this LAN fallback does not exist today, the "never breaks local kit" promise is technically violated for mobile — flag for Prompt 7 follow-up rather than expanding Prompt 9 scope.

### 2.10 Test plan outline (drafted now, executed in Chunk 3)

| Test class | What it verifies |
|---|---|
| Webhook signature verification | Tampered payloads return 400; missing signature returns 401 |
| Each webhook event handler | Round-trip from event → DB state update; idempotency on duplicate event_id |
| Founder slot atomic increment | 30 concurrent checkout attempts → exactly 30 slot rows, never 31 |
| `_subscription_active()` matrix | Every (status × subscription_state) combination — table-driven test |
| Existing suspension tests | UNCHANGED, must still pass byte-for-byte (preserves Prompt 2 contract) |
| Cloud LLM gate | `subscription_state=cancelled` → Ollama fallback fires; user gets a response, no crash |
| Backup gate | `subscription_state=cancelled` → nightly run skipped, status logged; restore endpoint still responds |
| Support tunnel bypass | `X-Relay-Role: founder_support` header passes proxy gate even on `subscription_state=cancelled` |
| Slot release on refund | Refund within 14d → slot row deleted; refund after 14d → slot row remains |
| iOS build guard | CI fails when iOS build contains banned pricing strings |

---

## Part 3 — Assumptions to Resolve Before Chunk 2

Numbered for easy reply.

1. **`status` vs `subscription_state` — two columns or one?** Recommendation: two (§1.3). Confirm.
2. **VAT rate.** Prompt says 17%. Real Israeli VAT is currently 18% (raised 2025-01-01). Which goes on the invoice and the pricing page?
3. **Currency for charging.** USD (per DECISIONS.md pricing) or NIS (more natural for Israeli עוסק פטור)?
4. **Subscription-state delivery to edge.** Piggyback on OTA manifest (recommended, §2.4) or new endpoint?
5. **Mobile LAN-mode fallback.** Does it work today? If not, is that a Prompt 9 blocker or a Prompt 7 follow-up?
6. **Founder slot release window.** 14 days = Israeli return law. Confirm.
7. **Trial duration.** Not specified anywhere I could find. Recommend: 14-day trial on `std_monthly` and `std_annual`; no trial on `founder_lifetime` (the price IS the offer). Confirm.
8. **Support-tunnel bypass header.** Add the defensive `X-Relay-Role: founder_support` bypass in `proxy.py` now (§1.8), or wait until support tooling is built?
9. **Backup unseal during cancellation.** Recommendation: unseal stays ungated indefinitely so cancelled users can recover their own data. Backup *creation* gated. Confirm.
10. **VAT-inclusive lock for DECISIONS.md.** DECISIONS.md still says "TBD". Should Chunk 2 include a one-line update to that doc, or leave DECISIONS.md to the founder?

---

## Part 4 — Commit Plan (Chunk 2 → Chunk 3)

**Chunk 2 — Stripe integration + webhooks + subscription_state (multiple small commits):**

1. Add `stripe` to `requirements.txt`; `relay/app/billing/__init__.py` scaffold.
2. `provider.py` (abstract) + `stripe_provider.py` (concrete).
3. DB migration: new homes columns + `founder_slots` + `processed_webhooks` + `invoice_sequence` tables, via idempotent ALTER pattern.
4. `plans.py` — plan catalog with Stripe price IDs (read from env).
5. `webhooks.py` — FastAPI router, all 6 handlers, idempotency, signature verify.
6. `slot_counter.py` — atomic increment + release-on-refund.
7. `invoice.py` — sequential Israeli invoice generator.
8. Update `_subscription_active()` to read both columns; remove `home_status` parameter, take `home_id` and look up. Update both call sites.
9. Tests for everything above.

**Chunk 3 — Gating + degradation + iOS runbook + tests (multiple small commits):**

1. Migrate `proxy.py:71` and `public_presence.py:94` to call the shared subscription helper.
2. Cloud LLM gate in `integrations/openai_client.py` + Ollama fallback path.
3. Backup gate in `services/backup_engine.py:_preflight()`.
4. OTA manifest extension: `subscription_state` + expiry in response; edge cache.
5. Founder slot API endpoint + UI surface (landing-page-ready JSON).
6. `docs/RUNBOOK_IOS_BILLING.md` — Apple reader-app compliance.
7. CI guard for iOS pricing strings.
8. Full end-to-end test: cancellation → cloud features off → local kit unaffected.

Stop after each chunk; await founder test gate.

---

## Part 5 — What This Audit Does NOT Cover

- Founder-side accounting/bookkeeping (out of code scope).
- Stripe dashboard configuration (founder UI task, runbook out-of-band).
- Apple Developer enrollment process (covered by mobile v1.1 plan).
- Existing legal docs in `legal/` — parallel Prompt 11 session owns these.
- Migrating non-cloud features behind any gate — hard rule says local kit always works.

End of audit. Awaiting founder review of Part 3 assumptions and approval to begin Chunk 2.
