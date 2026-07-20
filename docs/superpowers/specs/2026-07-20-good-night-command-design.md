# "Good Night" whole-home command — editable routine + phrase trigger

**Date:** 2026-07-20
**Branch:** feat/beta-image-readiness
**Status:** Design approved in conversation (2026-07-20).

## 1. Problem (mapped in code)

The user wants to type (and later say, via STT / a "Hey Ziggy" speaker) **"good night"**
and have Ziggy turn off all lights + optionally other devices (TV), as an **editable
On-demand routine** they build from the existing action vocabulary.

Live findings on Canary:
- **The chat/voice engine is v2** (`assistant.engine: v2`). The v2 tool-calling agent
  (`core/agent/runner.py` + `tools.py`) has **no all-off tool** and **bypasses**
  `quick_parse` — so it never sees the v1 "good night" fast-path (`intent_parser.py`)
  or the `voice_intents` registry. Typing "good night" today does nothing reliable.
- Clean, tested primitives already exist in `services/home_automation.py`:
  `turn_off_all_lights()` (lights only) and `turn_off_everything()` (lights + TV/media,
  batched). NOT concurrent-owned.
- A **"Good Night" routine template exists** (`services/routine_templates.py`
  `_good_night_steps`), but its step is `{"type":"message","text":"Turn off all lights"}`
  — a text step that dispatches intent `"chat"`, which has **no handler** → it does not
  reliably actuate. Routines are named step-lists run via `execute_ziggy_actions`.
- **Concurrent-owned (do NOT touch):** `services/voice_intents.py`, `core/agent/tools.py`,
  `core/agent/runner.py`, `bundle_executor.py`, `orchestra_designer.py`,
  `smart_room_recipe.py`, `SmartRoomWizard.jsx`, `quickAskStore.js` (Actions-IA Phase 2).

## 2. Design (decisions from the conversation)

"Good Night" is an **editable On-demand routine** the user composes from action steps.
Three parts, all in non-concurrent-owned files:

### A. Reliable "all-off" routine action types
Add two step kinds to the routine executor (`services/local_automation_actions.py`),
each calling the existing primitive **directly** (no flaky text→intent hop):
- `turn_off_all_lights` → `home_automation.turn_off_all_lights()`
- `turn_off_everything` → `home_automation.turn_off_everything()` (lights + TV/media)

Surface both in the On-demand routine wizard's action picker (`Routines.jsx`
`RoutineWizard`) as **"Turn off all lights"** and **"Turn off everything (incl. TV)"**,
so the user can add/edit them in any routine.

### B. Fix the seeded Good Night routine
`_good_night_steps` uses the new `turn_off_everything` action (lights + TV) instead of
the text step. Still editable — the user can trim to lights-only or add an AC-to-sleep step.

### C. Phrase → routine shortcut (what makes "good night" fire)
In the chat/voice entry router (`backend/routers/intent_router.py`), **before** handing
off to `run_agent`: normalize the incoming text; if it exactly matches an On-demand
routine's **name or phrase**, run that routine (`execute_ziggy_actions`) and return —
skipping the LLM. Deterministic, offline-friendly, engine-agnostic. Applies to
`/api/chat` and `/api/voice`, so a future "Hey Ziggy, good night" (STT → text → same
router) rides the identical path.

Matching rules: exact normalized equality (lowercased, trimmed, punctuation-stripped)
against `{routine.name, routine.phrase}` — NOT substring, to avoid false positives
("turn off the good night light" must not match). Hebrew phrase included. If no routine
matches, fall through to the agent unchanged.

## 3. Architecture

- **`services/local_automation_actions.py`** — in `execute_ziggy_actions`' step dispatch,
  add `elif kind == "turn_off_all_lights":` → `home_automation.turn_off_all_lights()` and
  `elif kind == "turn_off_everything":` → `home_automation.turn_off_everything()`. Both
  wrapped in try/except with a normal result dict. Add to the allowed-kinds set.
- **`backend/routers/intent_router.py`** — a helper `_match_routine_phrase(text) -> routine
  | None` that lists routines (via the routine store) and matches name/phrase; called at
  the top of `process_chat` and `process_voice` (after rate-limit, before engine dispatch).
  On match: `execute_ziggy_actions(script_id, label)` (to_thread) and return a normal chat
  response ("Good night 🌙" style, localized). Emits a debug-bus event.
- **`services/routine_templates.py`** — `_good_night_steps` → `[{"type":"turn_off_everything"}]`
  (+ keep the optional AC step). Minimal edit; flag to concurrent session.
- **Frontend `Routines.jsx` (`RoutineWizard`)** — add the two actions to the step-type
  vocabulary + labels. i18n en+he.

## 4. Testing

- **Unit:** `execute_ziggy_actions` with a `turn_off_everything` step calls the primitive
  (mock `home_automation`); `_match_routine_phrase` matches "good night"/"לילה טוב" exactly,
  rejects substrings and unrelated text.
- **Live (Canary):** type "good night" in chat → lights (+ TV) turn off, routine runs,
  agent NOT invoked. Verify `/api/voice` text path hits the same shortcut. Confirm the
  routine is editable in the wizard with the new actions. Per the real-life-validation
  gate: the user confirms the bulbs on real hardware.

## 5. Non-goals
- No changes to the v2 agent toolset or system prompt (concurrent-owned).
- No new user-facing "add a spoken phrase" UI for arbitrary phrases (routine name/phrase
  match is enough for now; broad phrase management is Phase 2's `voice_intents` engine).
- No wake-word work — just confirm the STT→text→router path is unified (it is).
- Good Morning / other scenes reuse the same mechanism later; only Good Night is built now.
