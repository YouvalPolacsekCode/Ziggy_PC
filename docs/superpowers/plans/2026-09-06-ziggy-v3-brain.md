# Ziggy v3 Brain — Implementation Plan

Spec: `docs/superpowers/specs/2026-09-06-ziggy-v3-conversational-brain-design.md`
Branch: `worktree-ziggy-v3-brain` (based on origin/main + feat/capability-catalog merged)

Each task: write the failing test, implement, run the suite, commit.

## Phase 1 — Brain

1. **Gateway shim** — `integrations/llm_gateway.py`: `_is_reasoning_model`,
   `_reasoning_kwargs`, defaults chat/automation_design → gpt-5.5, fallback to
   gpt-4o on unsupported-model errors. Tests `tests/test_llm_gateway_shim.py`.
2. **Persona** — `core/agent/persona.py` with `build_system_prompt(ctx)`;
   runner uses it. Tests in `tests/test_agent_persona.py`.
3. **Context** — `core/agent/context.py`: `build_context(directory, mode, channel,
   actor)` assembling occupancy, automations, recent changes, memory,
   entitlements. Formatting helpers with size caps.
4. **Output** — `spoken_summary`, sanitizer extension. Extend `tests/test_agent_v2.py`.
5. **Runner** — iterations 6, chat/voice token budgets, `mode` param,
   `data.spoken`, needs_approval handling stays model-narrated.

## Phase 2 — Tools

6. `what_can_ziggy_do` — `services/capability_lookup.py` (loads catalog JSON,
   word-overlap search). Tests.
7. `recent_activity`, `run_routine`, `toggle_automation`, `delete_automation`,
   `repair_history` executors + schemas + confirm plumbing on `control_device`.
   Tests `tests/test_agent_tools_v3.py`.
8. **Why-not** — `services/why_not.py` (`gather_facts`, `judge`) +
   `health_speech.describe_why_not` + tool `explain_missing_action`. Tests
   `tests/test_why_not.py`.

## Phase 3 — Proactive repair

9. **Repair ladder** — `services/repair_ladder.py` + `repair_attempts` table +
   CapabilityDef `system.reinterview_device` + Z2M interview publish helper in
   `services/ha_zigbee.py` + hook into `sweep_down_devices` /
   `sweep_stuck_occupancy`. Tests `tests/test_repair_ladder.py`.

## Phase 4 — Mode + entitlements

10. **Entitlements** — relay `plans.features`, manifest fields; hub
    `services/entitlements.py`, `ota_client` ingestion. Tests both sides.
11. **Diagnostic mode** — trigger detection in `intent_router`, `ChatRequest.mode`,
    `chat_threads.mode`, persona addendum, entitlement gate. Tests.
12. **Engine default v2** + settings example block + `_resolve_engine` test update.

## Phase 5 — App

13. `api.js` `sendChat(..., mode)`, speak `data.spoken`, pre-wrap bubbles,
    mode badge + toggle from response, rehearsal banner, i18n en/he.
    `npm run build` must pass; existing vitest suite green.

## Phase 6 — Ship

14. Full `pytest`; `npm test`; merge into `main`; push; `./scripts/ship.sh -m`;
    `flyctl deploy` relay; `scripts/fleet-health.py` until converged; merge
    `main` into `feat/beta-image-readiness`; update memory notes.
