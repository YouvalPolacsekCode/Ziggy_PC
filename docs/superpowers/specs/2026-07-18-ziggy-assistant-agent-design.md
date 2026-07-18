# Ziggy Assistant Redesign — One Tool-Calling Agent

**Date:** 2026-07-18
**Branch:** feat/beta-image-readiness
**Status:** Design approved (2026-07-18). Ready for implementation plan.
**Author:** design session with the operator (product owner).

> Ziggy's chat is the customer's primary way to talk to the product. This spec
> replaces the current three-brain assistant with a single tool-calling agent
> that holds conversation context, resolves device references against the real
> (HA-truth) device directory, and calls existing tested handlers to act. It is
> gated behind a `v2` engine flag so the working v1 flow stays intact as a
> fallback until the new engine is validated on real hardware.

---

## 1. Why (root causes, verified live on the Canary hub)

The operator reported four chat failures. On the Canary (`home-69856ab2ab19d473`,
`ssh ziggy@10.100.102.15`, container `ziggy-ziggy-1`) we reproduced all four
end-to-end through the real pipeline (real relay → GPT-4o) and traced each to a
root cause. **The model is not the constraint** — chat already routes hub → relay
→ gpt-4o. The architecture and the data it reads are the constraints.

### The current architecture (three separate "brains")

1. **Command path** — `/api/chat` → `core.intent_parser.quick_parse()` →
   (already an LLM: GPT-4o tool-calling over `core/tools_schema.py TOOLS`) →
   `core.action_parser.handle_intent()` → `core/handlers/*`.
2. **Chat path** — when no tool matches, falls to
   `core/handlers/chat_handler.handle_chat_with_gpt()`, a hand-tuned terse
   classifier (GIBBERISH / GREETING / INCOMPLETE_COMMAND / VAGUE_FOLLOWUP /
   NORMAL, clipped to ~12 words).
3. **Pro Mode designer** — `services/orchestra_designer.design_bundle()`, a
   separate outcome→automation-bundle LLM with its own home-context loader and
   preview card.

These three do not share conversation memory and do not share a usable view of
the real home. Routing between them is where the failures live.

> **Key reframing (drove the design):** the "command parser" (`quick_parse`) is
> *already* an LLM tool-call, not deterministic code. So moving to one agent does
> not add LLM risk — it removes two weaker, redundant LLM layers.

### The four failures and their verified root causes

**F1 — Wrong device + ignored correction.** "תכבה את המנורה בסלון" (turn off the
Living Room Lamp) turned off `light.0xa4c138bf729fb1aa`, whose **real HA name is
"Entry Light"**. The correction "לא, את המנורה בסלון" repeated the identical wrong
action. Root causes:
- The command path resolves devices by **(room, type)** via
  `services/home_automation.resolve_entity(room, "light")`, which returns **one**
  entity for the room+type and **never reads the device's real name**. The
  `toggle_light` tool schema has only `room` + `turn_on` — there is no per-device
  parameter.
- The living room has **four lights**. Resolution grabs the first one filed under
  `living_room`.
- **The backend registry (`user_files/device_registry.json`) is stale and wrong:**
  it files "Entry Light", "Kitchen Light", and "Dining Room Light" all under
  `living_room`. HA's own areas/names disagree.
- **The real names already exist** and are exactly what the user says. HA holds
  `friendly_name = "Living Room Lamp"` etc., and the frontend already displays
  them (via `backend/routers/device_router._enrich_devices_with_ha_state`, which
  reads `friendly_name` from `services/ha_subscriber.state_cache`). The assistant
  pipeline simply never consults that source.
- No feedback/state told the agent the first action was rejected, so the
  correction re-emitted the same call.

Ground truth captured from HA (`GET /api/states`) on 2026-07-18:

| Real HA `friendly_name` | entity_id | registry room (stale) | true room |
|---|---|---|---|
| Living Room Lamp | `light.0xa4c13852e1286e50` | living_room | living_room |
| Entry Light | `light.0xa4c138bf729fb1aa` | living_room | entry |
| Kitchen Light | `light.0xa4c138f584898cfe` | living_room | kitchen |
| Dining Room Light | `light.0xa4c138476480801f` | living_room | dining_room |
| Office Light | `light.0xa4c13899b82780aa` | office | office |
| Office Lamp | `light.0xa4c138fe4ba31d47` | office | office |
| Bedroom Light | `light.0xa4c13823fe19d7e9` | bedroom | bedroom |

**F2 — Presence query answered as nonsense.** "יש מישהו בחדר שינה?" (is anyone in
the bedroom?) routed to `is_someone_home(name="bedroom")` — the tool takes a
**person** name, so it searched for a person called "bedroom", found none, and
replied "לא נמצא אדם או חיישן תנועה עבור 'bedroom'." (In the operator's earlier
screenshot the same query fell to the chat path and echoed an unrelated weather
question.) Root cause: **there is no per-room occupancy/state tool**, even though
the rooms have occupancy sensors (e.g.
`binary_sensor.0x00158d008b80576c_occupancy` in living_room). Room-state
questions fall between the command and chat brains.

**F3 — Clear command mishandled (duplicate action).** "תדליק את האור במשרד" (turn
on the office light) produced a `__multi__` with **two identical**
`toggle_light(office, on)` calls → "מדליק את האור בoffice and מדליק את האור
בoffice." Root cause: `parallel_tool_calls=True` with no de-duplication; the
command path is not predictable. (The operator also observes the inverse —
`chat_handler` over-triggering "מה כוונתך?" on clear input, because its classifier
punts to GIBBERISH when unsure.)

**F4 — Hebrew language leak.** Every reply embedded English room slugs:
"מכבה את האור ב**living room**", "מדליק את האור ב**office**". Root cause: room and
device identity are English-canonical in the pipeline; `chat_handler`'s language
rule even says "Device names and room names may stay in English", and command
handlers interpolate the raw slug into the Hebrew sentence.

### The through-line

Three thin LLM layers that don't share memory, hand off badly, and — most
importantly — **do not read the real device directory (names, correct rooms, live
state) that HA holds and the UI already shows.** The single richest fix is to give
one agent that directory and real conversation memory.

---

## 2. Goals / Non-goals

### Goals
- Replace the three assistant paths with **one tool-calling agent** ("Ziggy v2").
- The agent **decides**; existing tested handlers **execute**. The LLM never
  free-hands hardware control.
- Resolve every device reference against a **live device directory sourced from HA
  truth** (real `friendly_name`, correct room/area, current state) — the same
  enriched source the UI uses.
- Hold **real multi-turn conversation state** so corrections and follow-ups work.
- Answer **home-state/presence** questions per room.
- Fold the **Pro Mode automation designer in as a tool** the agent calls (preserve
  the moat and the preview card; do not reimplement).
- **Never leak** HA/entity/HA-terminology to the user; **Hebrew-native** output
  with Israeli defaults; **terse for voice**, richer for chat.
- Ship behind a **`v2` engine flag** so v1 stays a byte-for-byte fallback; A/B on
  the Canary without breaking the working command flow.
- No latency/cost regression on the common command case (aim: single model
  round-trip).

### Non-goals (this spec)
- No new device-naming UI or in-chat name-learning as a *prerequisite* — the names
  already exist in HA. (Optional per-user aliases are a small additive tool, see
  §6.2, not a gate.)
- Not reimplementing HA automation primitives (per the automation-moat principle).
- No changes to STT (stays local) or TTS routing.
- Not deleting v1 in this spec — v1 removal is a later step after hardware sign-off.

---

## 3. Architecture overview

```
User (chat / voice → STT / Telegram)
        │  text + chat_history
        ▼
/api/chat  ──►  engine router (flag: assistant.engine)
        │                         │
     v1 (today)              v2 (this spec)
   quick_parse+handlers    AgentRunner.run(text, history, channel)
                                  │
                    ┌─────────────┼──────────────────────────┐
                    ▼             ▼                           ▼
             system prompt   device directory tool     action/query tools
             (Ziggy voice,   (HA-truth: names,          (wrap EXISTING handlers:
              Hebrew rules,    rooms, state)             toggle_light, set_ac_temp,
              output contract)                           occupancy, tasks, web,
                                                         design_automation_set, …)
                                  │
                        tool calls executed by
                        core.action_parser.handle_intent (reused)
                                  │
                          result → agent → reply
                                  │
                       output contract (localized names,
                       Hebrew, terse-for-voice) → user
```

Key point: **v2 reuses the existing execution layer.** Tools are thin adapters
over the current handler functions and services. The agent is a new orchestration
layer; the "hands" are unchanged and already tested.

---

## 4. The agent runner (the new brain)

New module: `core/agent/agent_runner.py` (name TBD in plan). Responsibilities:

1. Build the **system prompt** once per turn: Ziggy identity + the centralized
   Hebrew/voice **output contract** (§7) + product-surface rules (no HA terms) +
   a compact **home snapshot** (rooms with Hebrew names, per-room device counts,
   house mode, who's home) so the agent has orientation without a tool call.
2. Assemble messages: `[system] + chat_history (capped) + current user turn`.
   `chat_history` is already sent by the frontend on every `/api/chat` turn
   (`ChatRequest.chat_history`). This is the multi-turn memory.
3. Run the **tool-calling loop** (OpenAI tool-calling via
   `integrations.llm_gateway.chat_completion("chat", …)`, i.e. through the relay
   LLM proxy — hub holds no key):
   - Model returns tool call(s) → **de-duplicate** identical calls → execute each
     via the tool registry → append tool results → continue.
   - Bound the loop (e.g. max 3 tool iterations per turn) to cap latency/cost.
   - When the model returns final content → apply the output contract → return.
4. **Latency optimization (common case = one round-trip):** for a single
   unambiguous action tool call whose handler already returns a user-facing
   confirmation message, return that handler message directly (localized) instead
   of paying a second model turn to "narrate". A second model turn is only used
   when the agent must synthesize from tool output (questions, web search,
   multi-step). This preserves today's one-call latency for "turn off the lamp".
5. Emit `debug_bus` telemetry mirroring today's intent events (so the debug
   dashboard keeps working) and broadcast the same `ziggy_response` WS envelope.

### Act-vs-explain and confirmation policy
- **Act directly** on unambiguous single-device / clear commands ("Done." / "כיביתי.").
- **Ask one short question** only when a reference is genuinely ambiguous
  (multiple candidates, missing required slot) — never as a reflexive fallback.
- **Confirm before bulk/destructive** actions that affect many devices
  ("turn off everything") — a short confirm, matching today's intent.
- Gibberish / impossible / injection: one short decline, no invented substance
  (carry over the hardened rules from `chat_handler`'s R1–R6 as agent guidance).

---

## 5. Tool registry (the hands — mostly existing handlers)

Tools are declared for the agent and dispatched to existing code. A registry maps
`tool_name → (schema, executor)`. Executors call `core.action_parser.handle_intent`
(or the underlying service) so behavior matches v1 exactly.

Buckets (reusing today's handlers in `core/handlers/*` and `services/*`):
- **Devices:** `control_device` (per-entity on/off/set — see §6), `set_ac`,
  `set_ac_temperature`, `set_light_color`, `set_light_brightness`, blinds/cover,
  lock, IR actions. All target a **specific resolved entity_id** (from the
  directory), not (room, type).
- **Home state / queries:** `room_occupancy` (NEW, §6.3), `get_temperature`,
  `get_humidity`, `is_someone_home` (whole-home), `list_active_devices`,
  `get_active_anomalies`, `get_sun_times`, date/time.
- **Automations (moat):** `design_automation_set` → wraps
  `services.orchestra_designer.design_bundle` and returns the **same preview
  bundle** the frontend already renders; `apply_automation_bundle`,
  `create_automation`, `update_automation`, `instantiate_blueprint`,
  `list_blueprints`, `create_occupancy_sensor`. Unchanged semantics.
- **Productivity / info:** tasks, notes, files, events, memory, shopping list,
  email/comm, `web_search` (live data), media.

The full v1 tool inventory in `core/tools_schema.py` is the starting catalog; each
becomes an agent tool or is subsumed by the directory-aware `control_device`.

---

## 6. Device directory + resolution (the core F1 fix)

### 6.1 The directory
A single function returns the **live, HA-truth device list** the agent resolves
against, reusing the exact enrichment the UI relies on:
- Source: `backend/routers/device_router._enrich_devices_with_ha_state` logic
  (real `friendly_name` from `ha_subscriber.state_cache`) + HA **area** as the
  canonical room (aligns with commit `2b86e04` "canonicalize room refs to HA
  area_id"). Refactor the enrichment into a service callable from both the router
  and the agent (avoid duplicating it).
- Each entry: `entity_id`, `display_name` (real HA name), `room` (canonical
  area), `room_he`, `domain`/type, `state` (on/off/current), `capabilities`.
- **Fix the stale registry rooms:** reconcile `device_registry.json` room
  assignments to HA area truth so Entry/Kitchen/Dining lights stop appearing under
  living_room. (The agent reads HA-truth regardless, but the registry should not
  contradict it.)

### 6.2 Resolution tool
`resolve_device(query, room?, domain?) → candidates[]`. The agent calls it (or
uses the directory embedded in context for small homes) to turn "המנורה בסלון" /
"Living Room Lamp" / "the couch light" into a specific `entity_id`:
- Exact/normalized name match wins ("Living Room Lamp" → the lamp, not Entry Light).
- Hebrew reference → match against `display_name` and `room_he` (e.g. "סלון" →
  living_room area) using existing room alias data (`services/room_alias_bank.py`).
- **Ambiguous (≥2 candidates):** agent asks one short question listing the real
  names ("איזו — מנורת הסלון או האור הראשי?"), then acts. The chosen mapping can be
  remembered as a **per-user alias** (optional additive store, e.g.
  `user_files/device_aliases.json`: `{"מנורה":"light.0xa4c13852e1286e50"}`) so the
  next "the lamp" is instant. Aliases never replace HA truth; they layer on top.
- **Correction works** because the prior wrong action + the candidate list are in
  the conversation, so "no, the lamp" re-resolves to the other candidate.

### 6.3 Room occupancy (F2 fix)
`room_occupancy(room) → occupied/clear/unknown`, reading the room's occupancy /
motion / presence binary_sensors from the directory (buckets already exist in
`services/home_context._categorize`: motion / presence / occupancy). Returns a
Hebrew-native answer ("כן, יש תנועה בחדר השינה" / "לא נראה שיש מישהו שם").

---

## 7. Output contract (F4 fix + voice + product surface)

One centralized post-processor / prompt contract applied to every reply:
- **Names:** always the localized `display_name`; **Hebrew room name** from
  `room_aliases_he` — never the English slug. "מכבה את המנורה בסלון", never
  "בliving room".
- **No HA/tech terms** ever (entity, integration, טריגר, Home Assistant) — carry
  the product-surface rule.
- **Hebrew voice:** native Israeli, warm, dugri, short; neutral-by-construction
  gendering; Ziggy speaks about himself masculine 1st person. (Reuse the locked
  rules in `frontend/src/lib/i18n/HEBREW_STYLE_GUIDE.md` and the persona block
  from `chat_handler`.)
- **Terseness by channel:** `channel` param (`voice` | `chat` | `telegram`).
  `voice` → one short sentence, plain prose, no symbols/markdown (TTS reads them
  aloud). `chat` may be slightly richer but still tight. Voice terseness comes
  from the tool result, not a second LLM round-trip.
- **Israeli defaults:** 24h clock, °C, ₪, DD/MM, 24°C AC default, cool-first.

---

## 8. Engine flag, routing, migration (safety / A-B)

- New setting `assistant.engine: "v1" | "v2"` (default `v1`). Optional per-request
  override header for testing.
- `/api/chat` (and `/api/voice`, Telegram) branch on the flag:
  `v1` → today's `quick_parse` + `handle_intent` path, **unchanged**;
  `v2` → `AgentRunner.run(...)`.
- v1 code is **not modified or deleted** in this spec — it is the instant fallback.
- Roll out: enable `v2` on the Canary only; the operator lives on it and validates
  the four failures + daily use on real hardware (per the real-life-validation
  gate: nothing "works" until tested on the hub). Only after sign-off do we
  consider defaulting `v2` for beta kits and later retiring v1.
- Rollback = flip the flag. No data migration required (aliases file is additive).

---

## 9. Testing & validation

- **Unit/integration:** tool registry dispatch matches v1 handler behavior;
  `resolve_device` picks "Living Room Lamp" over "Entry Light"; ambiguity asks;
  correction re-resolves; `room_occupancy` reads the right sensors; output
  contract strips slugs / HA terms; de-dup drops duplicate tool calls; engine flag
  routes correctly and v1 path is untouched.
- **Hardware gate (required before "works"):** on the Canary, re-run the exact
  reproduction set through `/api/chat` with `v2` on:
  1. "תכבה את המנורה בסלון" → turns off `light.0xa4c13852e1286e50` (Living Room
     Lamp), reply in clean Hebrew with the real name, no slug.
  2. Correction "לא, את המנורה בסלון" (after a wrong guess) → re-resolves, does not
     repeat.
  3. "יש מישהו בחדר שינה?" → real per-room occupancy answer.
  4. "תדליק את האור במשרד" → **one** action, no duplicate, clean Hebrew.
  5. A Pro Mode outcome ("תעשה אוטומציה לסלון…") → preview card via the tool.
- The operator explicitly approves on real hardware before this is called done.

---

## 10. Risks & mitigations

- **Latency/cost per turn** (relay → OpenAI): mitigated by the single-round-trip
  common path (§4.4), bounded tool-loop iterations, and a compact in-prompt home
  snapshot to avoid a directory tool call for small homes.
- **Tool-loop runaway / wrong tool:** iteration cap; de-dup; confirm-before-bulk;
  carry v1's confidence discipline as agent guidance.
- **Directory source drift** (registry vs HA): HA area/name is the single source
  of truth; registry is reconciled to it, not the reverse.
- **Regression on the working command flow:** v2 is flag-gated and additive; v1
  stays intact until hardware sign-off.
- **Hebrew regressions:** centralized output contract + reuse of the locked style
  guide; leak-greps in tests.

---

## 11. Open questions (resolve during planning)

- Exact home-snapshot size vs directory-tool threshold (how big a home before we
  stop embedding the device list in the system prompt).
- Whether per-user aliases ship in this push or as a fast-follow (agreed: additive,
  can be minimal).
- Telegram/voice channel wiring details for the `channel` terseness param.
- Precise iteration cap and confirm-before-bulk thresholds (tune on hardware).
