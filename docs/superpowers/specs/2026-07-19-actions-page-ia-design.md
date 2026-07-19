# Actions Page — Information Architecture Redesign

**Date:** 2026-07-19
**Branch:** feat/beta-image-readiness
**Status:** Design approved (2026-07-19 brainstorm). Phase 1 builds immediately; Phase 2 deferred to the concurrent smart-room-creator session.

> The Actions page today hosts **five** overlapping tabs — automations / templates / suggested / routines / quick-asks — mixing two unrelated axes (where an automation came from vs. what kind of thing it is). This spec collapses it to **two** tabs on a clear conceptual line: things that run **automatically** vs. things you **trigger**.

---

## 1. Problem

Five tabs tangle two different axes:

- **Source axis** (same *kind* of object, different origin): user-built automations vs. our curated OOTB library/templates. These are the *same object* (a triggered rule) after instantiation — they don't deserve separate tabs.
- **Type axis** (genuinely different objects): a triggered automation, a manual "press-to-run" routine, a proactive habit suggestion, a one-tap chat shortcut (quick-ask).

Two of the five surfaces are also mis-filed:
- **Quick-asks are not automations.** They're one-tap *chat shortcuts* (`lib/quickAsks.js` already feeds Dashboard chips + Chat suggestions). Some are pure *questions* ("What's the temperature?"), which don't belong on an automations page at all.
- **Suggested** is a proactive nudge stream, not a destination the user navigates to.

## 2. Decisions (from brainstorm)

The page's primary job is **"manage what's running"** — a control panel for active automations. From that anchor:

- **Container stays "Actions."** Tabs: **Automations · Routines** (5 → 2).
- **Library is not a tab — it's an "Add" entry point.** A persistent "➕ Add from Library" banner in the Automations tab opens a **modal** hosting the curated templates + community blueprints. Configuring one makes it a normal active automation.
- **Suggested is not a tab — it's inline nudges + a persistent inbox.** The 1–2 freshest habit suggestions show as a dismissible strip atop the Automations list; a **💡 Suggestions (N)** row opens the full pending list any time. Per-nudge actions: **Add** / **Not now** (snooze — stays in the inbox, never lost) / **Dismiss** (gone for good).
- **Routines = callable macros** — a named chain of actions/automations, triggerable by a tap and/or a chat word. This is the "things you trigger" tab.
- **Quick-asks split by kind:**
  - *Informational* quick-asks ("temperature?", "who's home?") → **Chat/Dashboard suggestion chips** (where they already half-live). They leave the Actions page.
  - *Action* quick-asks ("Good night", "Turn off all lights") → **fold into Routines** (a routine you can also pin as a tap-chip).

## 3. Scope split

### Phase 1 — build now (this spec's implementation)
Pure information-architecture restructuring of the Actions page. **No changes to the smart-room recipe, the Pro-Mode bundle designer, or the `voice_intents` backend registry** — the concurrent smart-room-creator session owns those.

1. **Actions page → 2 tabs** (Automations · Routines). Remove `templates`, `suggested`, `quick-asks` as standalone tabs.
2. **Automations tab:**
   - Active-automations control panel (existing list — unchanged behavior).
   - **➕ Add from Library** banner → **Library modal** (hosts the existing merged Templates/Community/Recommended content).
   - **Suggested**: inline nudge strip (top 1–2) + **💡 Suggestions (N)** row → **Suggestions inbox** panel/modal (the existing pending/history + Analyze content). "Not now" = snooze.
3. **Routines tab:** the existing `RoutinesListPanel`, unchanged for now (its own create/edit wizard stays).
4. **Quick-asks relocation:** drop the Quick-asks tab from Actions. Informational quick-asks continue as Chat/Dashboard chips (verify they surface; `lib/quickAsks.js` already backs them). The standalone QuickAsks management route (if kept) is no longer part of the Actions tab set.

### Phase 2 — deferred (with the smart-room-creator session)
The "Routine becomes THE primitive" unification. **Not built now.**

- Make **Routine** the single "trigger → actions" primitive; `voice_intents` becomes its under-the-hood phrase-matching engine (not a user-facing concept).
- **Smart-room recipe + Pro-Mode bundles emit real Routines** (visible/editable "good night" / "good morning") instead of invisible `voice_intents`.
- **Fold action quick-asks into the Routines data model** (today `quickAskStore`; then unified as routines with tap + phrase trigger surfaces).
- Migrate any existing invisible `voice_intents` into visible Routines.

This is deferred because it touches the routines/voice-intent/smart-room coupling the other session is actively changing.

## 4. Component-level plan (Phase 1)

| File | Change |
|------|--------|
| `frontend/src/pages/Actions.jsx` | Collapse the tab switcher to Automations · Routines. Move Library + Suggested out of the tab set into the Automations view (banner→modal, nudge strip + inbox). Keep the existing modals (`AutomationWizard`, `SmartRoomWizard`, `CircadianBundleWizard`, `AutomationViewModal`) wired. |
| `frontend/src/components/automations/templates/LibraryModal.jsx` | Host the merged Templates/Community/Recommended content (reuse `TemplatesTab`'s body) as a modal opened from the Automations banner. |
| `frontend/src/components/automations/templates/SuggestedTab.jsx` | Extract a small **`SuggestionNudgeStrip`** (top 1–2 inline) and a **Suggestions inbox** view (the existing pending/history + Analyze) usable inside a modal/panel. Reuse `suggestionStore` (`accept`/`reject`/`snooze`, pending/history) verbatim — "Not now" = `snooze`. |
| `frontend/src/pages/Routines.jsx` | No change to `RoutinesListPanel` behavior; only ensure it renders as the second Actions tab. |
| Nav / routing (`frontend/src/App.jsx` + nav component) | `/automations` still lands on Actions. Drop any nav entry that pointed at a now-removed tab; ensure informational quick-asks remain reachable via Chat/Dashboard, not Actions. |

**Untouched (Phase 2 / other session):** `services/smart_room_recipe.py`, `services/orchestra_designer.py`, `services/bundle_executor.py`, `services/voice_intents.py`, `core/agent/tools.py`, `SmartRoomWizard.jsx`, `quickAskStore.js` data model.

## 5. Non-goals
- No backend schema changes in Phase 1.
- No change to how automations are created, saved, executed, or traced.
- No visual/UX polish pass yet — this is the structural skeleton; curation + UX come next, on top of this.
- No deletion of the `voice_intents` registry or `quickAskStore` (Phase 2 decides their fate).

## 6. Success criteria (Phase 1)
- Actions page shows exactly two tabs: Automations, Routines.
- From the Automations tab a user can: see active automations, open the Library modal and configure one, see suggestion nudges, snooze one and re-find it in the Suggestions inbox, and add it later.
- No standalone templates/suggested/quick-asks tab remains.
- Informational quick-asks still reachable from Chat/Dashboard.
- App builds; no dead imports or broken routes.
