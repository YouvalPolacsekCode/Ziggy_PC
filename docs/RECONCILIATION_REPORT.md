# Architecture Reconciliation Report — 2026-05-25

**Source prompt:** PROMPT_ARCH_RECONCILIATION (Tasks 1–5)
**Companion prompt:** PROMPT_SECURITY_HARDENING — *not addressed this session*
**Founder approvals collected before each step.** See chat transcript.

---

## Summary

| Task | Status | Code? | Docs? |
|---|---|---|---|
| 1. TTS off in v1 | ✅ Done | Yes | RUNBOOK_VOICE.md + settings.example.yaml |
| 2. Wake-word quarantine | ✅ Done | Yes | oww_data/README.md |
| 3. Motion→Light HA-native | ⏸ Paused — premise was misread | No | DECISIONS.md entry locks the boundary |
| 4. Cloudflare Tunnel formalization | ✅ Done | No | ARCHITECTURE_RELAY.md + PRIVACY_DRAFT.md + DECISIONS.md |
| 5. Oracle → Hetzner migration | ✅ Plan delivered | No | RUNBOOK_HETZNER_MIGRATION.md |

---

## Task 1 — TTS off in v1

### Changes
| File | Change |
|---|---|
| [config/settings.yaml:413](../config/settings.yaml#L413) | `+ tts_enabled: false` |
| [interfaces/voice_interface.py:43](../interfaces/voice_interface.py#L43) | `+ TTS_ENABLED = bool(VOICE_CFG.get("tts_enabled", False))` |
| [interfaces/voice_interface.py:790-799](../interfaces/voice_interface.py#L790-L799) | Early-return at top of `speak()` |
| [config/settings.example.yaml](../config/settings.example.yaml) | **New** — full schema mirror with placeholder secrets and v1 voice defaults |
| [docs/RUNBOOK_VOICE.md](RUNBOOK_VOICE.md) | **New** — v1 lock rationale + v1.1 re-enable path |

### What was deferred
- The AUDIT line claiming the PWA TTSes responses was incorrect (no client-side TTS exists). No frontend change needed.
- Hebrew Piper voice still not compiled. Not a Task-1 concern since Azure remains the configured engine; v1.1 can revive Piper separately.

### Verify in production (on the home unit)
- [ ] 10 Hebrew voice commands → text response in PWA, no audio.
- [ ] 10 English voice commands → same.
- [ ] One Q&A that routes through Ollama/OpenAI fallback → text only.
- [ ] Push notifications still arrive.

---

## Task 2 — Wake-word quarantine

### Changes
| File | Change |
|---|---|
| [config/settings.yaml:416](../config/settings.yaml#L416) | `wakeword_enabled: true → false` |
| [interfaces/voice_interface.py:900-919](../interfaces/voice_interface.py#L900-L919) | Boot-time guard: if `wakeword_model` looks like a custom file path and the file doesn't exist, force-disable wake-word with a loud log line. Bundled OWW models (e.g. `hey_mycroft`) bypass the check. |
| [oww_data/README.md](../oww_data/README.md) | **New** — "Experimental, NOT SHIPPING in v1" banner + v1.1 plan |

### What was deferred (by user choice)
- Training scripts stay at repo root (`generate_hey_ziggy_dataset.py`, `record_hey_ziggy.py`, `train_hey_ziggy.py`) — moving them risks breaking implicit paths and offers no v1 value.
- No unit test added; the boot-time guard itself is the test (logged on every startup).

### Verify in production
- [ ] Restart hub. Confirm `[Voice] OpenWakeWord initialized` is **not** printed (because `wakeword_enabled: false`).
- [ ] Mic does not light up until PTT is pressed in the app.
- [ ] As a smoke check: temporarily set `voice.wakeword_model: /nonexistent/path.onnx` and `wakeword_enabled: true` → confirm boot prints `WAKE-WORD DISABLED: ... does not exist. Falling back to push-to-talk.` Then revert.

---

## Task 3 — Motion→Light HA-native (PAUSED)

### Diagnosis
The prompt's premise — "dual-path implementation, both HA-side and Ziggy-side `local_automation_actions` can handle motion → light, founder pick HA-native" — **does not match the code**.

Confirmed:
1. [services/local_automation_actions.py:2-3](../services/local_automation_actions.py#L2-L3) docstring: *"HA handles triggers and HA service calls; this module executes the Ziggy-side steps."*
2. `local_automation_actions` is the **action executor** for Ziggy-specific step types (`ziggy_intent`, `ir_command`, `notify_actionable`, `speak`, `send_intent`, `device_command`, `wait_for_state`), not an alternative trigger engine.
3. It is depended on by 9 modules including `routine_router`, `push_actions`, `presence_side_effects`, `ziggy_scheduler` — disabling it would break routines, push action buttons, presence side-effects, scheduled actions, and IR command sequences.
4. The actual data on this hub: zero motion→light automations exist. The two automations in [user_files/automation_meta.json](../user_files/automation_meta.json) are temperature-triggered.

### Resolution
- Implementation paused with founder approval.
- DECISIONS.md updated: "HA-native is the canonical automation trigger path; `local_automation_actions` is the action-executor for Ziggy-specific step types." Locked.
- The AUDIT's "dual path" framing (Data flow 1, lines 310-327 — marked `[?]`) was an open question, not a confirmed pattern. Recommend future audits cite this DECISIONS entry.

### What was deferred
- None. Task is complete by virtue of being misframed; the boundary is now documented.

### Verify in production
- Nothing changed. No verification needed.

---

## Task 4 — Cloudflare Tunnel formalization (docs only)

### Changes
| File | Change |
|---|---|
| [docs/ARCHITECTURE_RELAY.md](ARCHITECTURE_RELAY.md) | **New** — topology diagram, provisioning flow, secret inventory, failure modes, code cross-refs |
| [legal/PRIVACY_DRAFT.md](../legal/PRIVACY_DRAFT.md) | **New** — working draft of privacy policy; includes the Cloudflare paragraph the prompt requested |
| `DECISIONS.md` (in ZigguInstructions) | **Updated** — 2026-05-25 entry locks "Cloudflare Tunnel per home, fronted by Fly.io" |

### What was deferred
- Cloudflare cert pinning, per-secret rotation cadence, JWT rotation — all called out as PROMPT_SECURITY_HARDENING territory and cross-referenced in the doc.

### Verify in production
- Read the ARCHITECTURE_RELAY.md sections "Onboarding flow" and "Failure modes" and confirm both match the in-house mental model.

---

## Task 5 — Oracle → Hetzner migration plan (runbook only)

### Changes
| File | Change |
|---|---|
| [docs/RUNBOOK_HETZNER_MIGRATION.md](RUNBOOK_HETZNER_MIGRATION.md) | **New** — full runbook: prerequisites, provisioning script, per-home cutover steps, downtime estimate, rollback plan, open questions, trigger condition |
| `DECISIONS.md` (in ZigguInstructions) | **Updated** — same 2026-05-25 entry locks "Hetzner CPX21 before 5th paid cloud-mode customer" |

### Decisions baked into the plan
- **Hetzner SKU**: CPX21 (~€8.46/mo) over CX22 (€4.51/mo). 4 GB RAM on CX22 is borderline for HA + Ziggy + cloudflared.
- **Shape**: one home per VM. Predictable bill per home, isolated blast radius.
- **Tooling**: shell + `hcloud` CLI. Minimal new deps; mirrors the shape of [relay/app/provisioner.py](../relay/app/provisioner.py).
- **Trigger**: (a) 4+ paid cloud-mode customers OR (b) any Oracle account warning, whichever comes first. Verbatim from prompt.

### What was deferred (explicitly out of scope this session)
- Execution of the migration.
- Folding `provision_hetzner_home.sh` into `relay/app/provisioner_hetzner.py` (post-runbook engineering).
- Backup pipeline (Open Question 1 in the runbook) — punted to a future security/ops session.

### Verify before execution
- All 5 Open Questions in the runbook resolved.
- Hetzner project + API token + SSH key set up.
- One paying customer has explicitly agreed to be the first cutover (or run a synthetic test home first).

---

## What I did **not** touch this session (by design)

- `config/settings.yaml` secret rotation (Azure key, OpenAI key, HA token, session tokens, password hashes, MQTT password, Telegram token, SerpAPI key, SMTP password) — PROMPT_SECURITY_HARDENING territory.
- The 11-prompt commercial features (billing, OTA, fleet ops, backups, etc.).
- `local_automation_actions` refactor (paused per Task 3 decision).
- Hebrew Piper compilation, wake-word training, TTS re-enable — all v1.1.
- Hetzner migration execution.
- Any active HA automation on the beta unit.
- Any file deletion.

---

## Files changed this session

```
M  config/settings.yaml                       (2 lines: tts_enabled added, wakeword_enabled flipped)
M  interfaces/voice_interface.py              (+32 lines: TTS_ENABLED, speak() early-return, wake-word boot guard)
A  config/settings.example.yaml               (new — schema mirror)
A  docs/RUNBOOK_VOICE.md                      (new)
A  docs/ARCHITECTURE_RELAY.md                 (new)
A  docs/RUNBOOK_HETZNER_MIGRATION.md          (new)
A  docs/RECONCILIATION_REPORT.md              (this file)
A  oww_data/README.md                         (new)
A  legal/PRIVACY_DRAFT.md                     (new — draft only, not legally reviewed)

External (outside repo):
M  ~/Downloads/ziggyfiles/DECISIONS.md        (2026-05-25 reconciliation entries)
```

Pre-existing in-flight changes to `settings.yaml` (session_token churn, micro-drift on `home_zone` lat/lon, `task_tracking: true → false`, `device_map.living_room.streamer` removal) are from the live hub mutating the file — not from this session.

## Open follow-ups (suggested, not done)

These are noted for the backlog, not actioned:

1. Move `config/settings.yaml` secrets out of git per AUDIT §S1 (PROMPT_SECURITY_HARDENING).
2. Fix `.gitignore` line 50 so `config/settings.yaml` is actually excluded going forward.
3. Compile Hebrew Piper voice when v1.1 TTS work resumes (`piper_voices/he_IL-sivri-medium.onnx`).
4. Compile `hey_ziggy.onnx` from the training data in `oww_data/hey_ziggy/` when v1.1 wake-word work resumes.
5. Add the per-home backup pipeline before executing the Hetzner migration (Open Question 1 in the migration runbook).
6. Fold `provision_hetzner_home.sh` into a `provisioner_hetzner.py` parallel to the Oracle provisioner when paid-customer count justifies relay-side automation.
