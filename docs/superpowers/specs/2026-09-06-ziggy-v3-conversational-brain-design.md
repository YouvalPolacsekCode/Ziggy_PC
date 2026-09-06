# Ziggy v3 Conversational Brain — Design

**Date:** 2026-09-06
**Status:** Approved by the operator in session ("build everything from A to Z, push live to all homes").
**Supersedes the constraints layered onto chat between 2026-05-17 and 2026-07-18.**

## 1. Why

Git shows the chat was clipped in four rounds after the May 12 build: a regex
confidence gate (2026-05-17) that refuses any state change without a fixed verb;
a "one sentence, ~12 words, no lists" shape contract (2026-06-22/23) written for
TTS and applied to chat; classifier rules (2026-07-13) that forbid greeting,
listing capabilities, status, or asking back; and the v2 agent (2026-07-18) which
fixed device resolution but copied the muzzle into its system prompt.

The v2 architecture (one tool-calling agent, HA-truth directory, tools that call
tested services, model never free-hands hardware) is correct. What is wrong is
the permission to think, the knowledge it is given, and the 2024 model.

Fleet at time of design: all three homes on `release-2026.08.14-8`; Canary on
`origin/main` (+34) with `assistant.engine: v2` and `assistant.rehearsal: true`.
Customer hubs default to **v1** because the engine flag is unset in their config.

## 2. Principles

1. **One agent.** No separate personas. Diagnostic capability is the same agent
   with the same tools, in a mode that unlocks depth and tone.
2. **Two output contracts.** Chat may converse (paragraphs, options, a real
   question). Voice gets a short spoken rendering. The two are never one rule.
3. **Policy decides permission, the model decides intent.** No verb lists. The
   PDP autonomy ladder (act / confirm / ask / deny) gates anything risky.
4. **Ziggy knows himself.** The capability catalog and one character document
   are the source of what he can do and how he sounds. Hebrew-first.
5. **Nothing leaks.** No entity ids, no Home Assistant, Zigbee, coordinator,
   integration. Enforced by the output sanitizer, not by hope.
6. **Ship to every home.** Engine v2 becomes the code default. Customer homes
   get this on the next release tag, not by a per-home flag.

## 3. Architecture

```
/api/chat, /api/voice  ──►  intent_router (thread, rehearsal, mode, phrase→routine)
        │
        ▼
core/agent/runner.run_agent(text, history, channel, actor, mode)
   system prompt = persona.build_system_prompt(context)
   context      = directory (devices, presence, cameras)
                + rooms occupancy (engine if present, else sensors)
                + automations (name, enabled, last run)
                + recent changes (last 60 min, names only)
                + house mode, people, user memory
                + entitlements, mode, channel
   loop ≤ 6 iterations → tools.execute_tool(...)
   reply  (chat contract)            → sanitize_reply
   spoken (voice contract, derived)  → prepare_for_speech (existing)
```

### 3.1 LLM gateway (`integrations/llm_gateway.py`)

- Purpose defaults: `chat` → `gpt-5.5`, `automation_design` → `gpt-5.5`.
  `intent_parse` (v1 fallback + thread titles), `translate`, `vision` unchanged.
- Reasoning-model shim, applied when the resolved model is `gpt-5*`, `o1*`,
  `o3*`, `o4*`: `max_tokens` → `max_completion_tokens`; `reasoning_effort` from
  `settings.models.<purpose>.reasoning_effort`, default `none` (gpt-5.1 and
  newer) or `minimal` (gpt-5, gpt-5-mini, gpt-5-nano); `temperature` kept only
  when effort is `none`. Verified 2026-09-06 through the relay: gpt-5.5 with
  tools works at effort `none` (0.8–1.6 s), rejects `max_tokens`, rejects
  `reasoning_effort=low` with function tools on chat/completions.
- Fallback: if the call fails with a model-not-found / unsupported-model 4xx,
  retry once with `gpt-4o` and log. A retired model id must not kill chat.

### 3.2 Persona (`core/agent/persona.py`)

Single source of Ziggy's character. Replaces the inline paragraph in
`runner._build_system_prompt`. Sections: identity (זיגי, masculine first person,
gender-free address), Hebrew voice rules (from the locked style guide: dugri,
short, 24h, °C, ₪, no literary Hebrew, never English device names, never ids),
how to act (resolve devices from the directory, ask one question when
ambiguous, act then tell), when to look up vs act (home tools vs web_search),
broken-home behaviour (diagnose first, safe fix second, explain cause in human
terms), chat contract, voice contract, diagnostic-mode addendum, entitlement
addendum. The frontend style guide file gains a pointer to this module.

### 3.3 Output (`core/agent/output.py`)

- `render_device_confirmation` unchanged (fast path).
- `spoken_summary(reply, lang)`: deterministic spoken rendering: first two
  sentences, ≤ 220 chars, list markers and newlines removed, sanitized. Returned
  as `data.spoken`. Voice channel replies are already short by contract.
- `sanitize_reply` extended: `ir:<id>` ids, area slugs in brackets, and the
  words Zigbee / coordinator / MQTT / integration / entity in both languages.

### 3.4 Tools (`core/agent/tools.py`)

Existing 25 tools stay. Added:

| Tool | Purpose | Gate |
|---|---|---|
| `what_can_ziggy_do(query)` | Searches the capability catalog (`docs/capability-catalog.json`) by words; returns name, pitch, what it does, status. | read |
| `recent_activity(hours, room?)` | Names of controllable devices that changed in the window, from the state cache. | read |
| `explain_missing_action(entity_id, hours?)` | The "why did X NOT happen" tool. See 3.5. | read |
| `run_routine(name)` | Runs an on-demand routine by name (fuzzy). | act (rehearsal-aware) |
| `toggle_automation(name, enabled)` | Enable/disable by name. | confirm |
| `delete_automation(name, confirmed)` | Delete by name; asks first. | ask |
| `repair_history(entity_id)` | What the repair ladder already tried. | read |

`control_device` gains `confirmed: bool`. Lock/unlock and any `_ask`-tier
action goes through `authz.check("device.<verb>", on_behalf_of=actor,
explicit_confirm=confirmed)`; when the verdict is not `may_act` the tool returns
a `needs_approval` envelope and the model asks in words. The user's "yes" comes
back as the next turn and the model re-calls with `confirmed=true`.

### 3.5 Why-not (`services/why_not.py`)

`gather_facts(entity_id, hours=3)` returns a structured fact set:

- device: reachable now, last_reported age, last intended command (ledger).
- automations targeting the device (scan Ziggy saved actions and the HA config
  for the entity id): enabled, last_triggered, last run status from traces
  (`success | stopped | failed | none in window`).
- room: occupancy state + reason (engine if present, else presence sensors:
  state, last_changed), active anomalies for its sensors (ANOM-10 silent,
  ANOM-12 latched, ANOM-13 down).
- repair ladder history for the device and its room sensors.

`judge(facts)` returns an ordered list of verdicts from:
`device_unreachable`, `sensor_latched`, `sensor_silent`,
`automation_disabled`, `automation_did_not_trigger`,
`automation_stopped_on_conditions`, `automation_failed`,
`manual_override`, `no_automation_for_device`, `unknown`.

`health_speech.describe_why_not(verdicts, facts, label, lang)` phrases the top
verdict plus the next step, jargon-free, both languages.

### 3.6 Repair ladder (`services/repair_ladder.py`)

Triggered by the two proactive sweeps (ANOM-13 device silent, ANOM-12 sensor
latched) before the alert is pushed, at most once per entity per 12 h. Rungs:

1. **nudge** — `self_heal.manual_refresh_heal` for controllables, force poll
   for sensors. Gate `system.refresh_device` (act).
2. **reinterview** — Zigbee2MQTT only: map entity → HA device → Z2M ieee via
   the device registry identifiers, publish
   `zigbee2mqtt/bridge/request/device/interview`. Gate
   `system.reinterview_device` (new CapabilityDef, MEDIUM, connectivity →
   confirm: acts and notifies).
3. **repair** — open pairing and tell the owner the button to press. Gate
   `system.repair_device` (pairing → ask). In background this rung does not
   act; it becomes the instruction in the alert and is offered in chat.
4. **physical** — battery / wall switch instruction.

Every attempt writes to `repair_attempts` (SQLite, `user_files/home_map.db`).
The pushed alert text reflects what was tried. The runner re-checks after each
rung and stops when the device is back.

### 3.7 Diagnostic mode

- Trigger phrases (typed or spoken): `claude ziggy`, `קלוד זיגי`, `zigi debug`,
  `זיגי דיבאג`. Detected in `intent_router` before the engine. Toggles.
- State: `chat_threads.mode` column for threaded chats; for the legacy path the
  response carries `data.kind = "mode_changed"` and the app sends `mode` on
  following turns. `ChatRequest.mode` accepted either way.
- Effect: persona addendum (technician tone, timelines allowed, may name
  sensors by their room and type, still no ids or engine words); the agent is
  told to prefer `explain_missing_action`, `diagnose_device`,
  `list_down_devices`, `repair_history`.
- Entitlement: `diagnostics`. Without it the trigger replies with the plan
  line and stays off.

### 3.8 Entitlements

- Relay: `homes.plan_id` already exists. `billing/plans.py` gains
  `features` per plan. The OTA manifest (schema 2, additive) carries
  `plan_id` and `entitlements: [..]`. `plan_id` NULL (founder homes) →
  full set.
- Hub: `services/entitlements.py` caches from the manifest next to
  `subscription_state`, exposes `has(feature)`; unknown → allow (fail-open,
  same rule as the subscription gate on first boot).
- Features: `diagnostics` (mode + why-not), `auto_repair` (ladder rungs 1–2
  in background), `explain_changes` (causal trace). All three homes get all.

### 3.9 Router and frontend

- `_resolve_engine` default → `v2`. Settings example gains the `assistant` block.
- `/api/voice` passes `chat_history` from the app when present (multi-turn for
  voice endpoints that send it) and `channel="voice"`.
- App: speaks `data.spoken` when present; renders replies with preserved line
  breaks; diagnostic-mode badge; rehearsal shown as a persistent banner, not
  only a header chip; `sendChat` carries `mode`.

## 4. Testing

- Gateway shim: parameter translation and fallback (mocked client).
- Persona: prompt contains no ids; Hebrew rules present; mode addendum toggles.
- Output: spoken summary length/markers; sanitizer catches new leak classes.
- Why-not: `judge()` on fixture fact sets for every verdict.
- Repair ladder: rung sequencing, gating, 12 h rate limit, attempt log (pure
  functions with injected executors).
- Entitlements: cache read/write, fail-open, manifest ingestion.
- Router: trigger phrase toggling, mode threading, engine default v2.
- Relay: manifest carries plan fields; plans have features.
- Existing 207 agent-related tests stay green; prod-entrypoint test covers any
  new background work.

## 5. Rollout

1. Merge to `main`, `./scripts/ship.sh`, verify convergence with
   `scripts/fleet-health.py` after ~5 min.
2. Relay: `flyctl deploy` from `relay/` (additive manifest fields, safe in any
   order relative to the tag).
3. Merge `main` back into `feat/beta-image-readiness`.
4. Canary keeps `rehearsal: true` until the operator flips it in the app; the
   banner makes the state unmissable.

## 6. Out of scope (deliberately)

- Realtime speech-to-speech; Responses API (relay only proxies chat/completions).
- Claude as the brain (needs a relay path change). Trial after this lands.
- The intrinsic occupancy engine (`services/occupancy/`) is uncommitted work in
  another session's checkout and is not on `origin/main`; all new code treats it
  as optional via the existing try/except pattern.
- Tier purchase / upgrade UI. Only the entitlement plumbing and the one-line
  "above your plan" reply.
