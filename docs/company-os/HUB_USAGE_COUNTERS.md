# Hub usage counters

The only product analytics a Ziggy hub emits. Whole-home counts, once every
five minutes, inside the telemetry post the hub already sends. Canonical
shape: `TRACKING_SPEC.md` §4 "Product". Code: `services/usage_counters.py`.

## What is counted

Ten integers per 5-minute window, for the home as a whole:

| Counter | Bumped when | Where |
|---|---|---|
| `chat_message` | a turn hits `/api/chat` or `/api/intent` | `backend/routers/intent_router.py` |
| `voice_command` | a turn hits `/api/voice` | `backend/routers/intent_router.py` |
| `automation_created` | a **new** automation is saved (updates are not counted) | `backend/routers/automation_router.py` |
| `automation_triggered` | an automation fires — HA-backed ones from HA's `last_triggered` moving, Ziggy-run ones from the manual-run endpoint | `services/ha_subscriber.py`, `automation_router.py` |
| `routine_run` | an on-demand routine is run | `backend/routers/routine_router.py` |
| `device_toggled` | a successful HA service call on a device domain (light, switch, climate, cover, fan, media_player, lock, …) | `services/home_automation.py::call_service` |
| `scene_applied` | a successful `scene.*` service call | same |
| `app_open` | a client WebSocket connects (app / PWA / wall opened or reconnected) | `backend/server.py` |
| `onboarding_step` | an onboarding step is completed or skipped | `services/onboarding_state.py::mark_step` |
| `error_5xx` | an API request ends in a 5xx | `backend/middleware/error_handler.py` |

Plus two context blocks:

- `features_enabled` — the keys of `settings.yaml › features` that are truthy,
  sorted. Which product surfaces this home has switched on.
- `errors` — `{count, top}`: the number of ERROR-level log records in the
  window and the top three **exception class names** (`ValueError`,
  `ConnectionError`…). Read from a 512-entry ring buffer handler in
  `core/logger_module.py`.

Example post fragment:

```json
"usage_counters": {
  "window_s": 300,
  "counters": {"chat_message": 3, "voice_command": 1, "automation_created": 0,
               "automation_triggered": 12, "routine_run": 2, "device_toggled": 40,
               "scene_applied": 1, "app_open": 5, "onboarding_step": 0, "error_5xx": 0},
  "features_enabled": ["smart_home", "voice", "zigbee_support"],
  "errors": {"count": 0, "top": []}
}
```

## What is NOT counted, ever

- Who did it. No user, person, actor or device-owner id.
- What it was. No entity ids, device names, room names, message text,
  transcripts, automation names or payloads.
- When exactly. Only the window length; no per-event timestamps.
- Log messages. The error digest carries exception **class names only** —
  never the message, path, traceback or request body.
- Anything from a rehearsal turn (service calls are only counted on a real
  HTTP 200 from Home Assistant).

Counters are in-memory. A hub restart loses the current window; a failed
telemetry post loses that window's counts (the next window starts clean).
That is acceptable — this is a trend signal, not an audit log.

## How it flows

```
hub  services/usage_counters.bump()   ← one-line calls at the seams above
     │  every 5 min: telemetry_client._build_payload() → snapshot_and_reset()
     ▼
relay POST /api/devices/{home_id}/telemetry   (HMAC, stored verbatim in telemetry_raw)
     │  relay/app/posthog_forward.py — background task, 5 s timeout
     ▼
PostHog (EU)   feature_used   {feature, count, home_id, release_tag, cohort, window_s}
               hub_errors     {count, top, home_id, release_tag, cohort, window_s}
               distinct_id = home_id
```

The relay also judges the block: `usage_counters.errors.count >= 10` in one
window raises the fleet-health issue `error_burst` (degraded, human), and
`errors_5m` appears in a home's vitals (`relay/app/fleet_health.py`).

Forwarding is on only when the relay has `POSTHOG_PROJECT_KEY` set
(`fly secrets set POSTHOG_PROJECT_KEY=phc_…`). `POSTHOG_HOST` defaults to
`https://eu.i.posthog.com`. A failed batch writes one `audit_log` row
(`posthog_forward`, ok=false) and is dropped; the raw payload is still in
`telemetry_raw`. One `feature_used` event is sent per counter with a value
greater than zero — a zero is expressed by the absence of an event.

## Reading it in PostHog

Every event carries `distinct_id = home_id`, so a "person" in PostHog is a
home, never a human. Useful views:

- **Active homes** — Trends, event `feature_used`, "Unique users" (= unique
  homes), daily. A home that posts any non-zero counter that day is active.
- **Feature adoption** — Trends, `feature_used`, break down by `feature`,
  aggregate `sum(count)`. Filter `cohort = production` to exclude the Canary.
- **Homes using a feature** — same, "Unique users", break down by `feature`.
  Compare `chat_message` vs `voice_command` to see how people actually talk
  to Ziggy.
- **Drop-off** — `feature_used` where `feature = onboarding_step`, unique
  homes per day vs. `app_open` unique homes: homes that opened the app but
  never progressed onboarding.
- **Release health** — `hub_errors`, sum of `count`, break down by
  `release_tag`. A tag whose error count jumps the day it ships is the
  regression you are looking for; `top` (exception class names) says what
  kind. Cross-check with the fleet console's `error_burst` issue.
- **Per-home drill-down** — the Persons page, search by `home_id`; the event
  timeline is that home's feature usage over time.

Remember the window: a single `feature_used` with `count = 40` means forty
device toggles in five minutes, not one event. Always aggregate with
`sum(count)`, not "total events".

## Adding a counter

1. Add the name to `COUNTER_NAMES` in `services/usage_counters.py` and a
   row to the table above.
2. Bump at the seam: `from services.usage_counters import bump as _usage_bump`
   then `_usage_bump("my_counter")` — one line, after the action succeeded.
3. Add the wiring assertion to `tests/test_usage_counters.py::TestWiring`.
4. Nothing on the relay changes: every counter is forwarded by name.

Ask before adding: does the name alone tell us something we would act on,
and would we be comfortable showing this row to the customer whose home
produced it? If either answer is no, it is not a counter.
