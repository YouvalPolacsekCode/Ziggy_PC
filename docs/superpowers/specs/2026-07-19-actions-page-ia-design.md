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

---

# Curation + UX Addendum (2026-07-19)

Refines the framing and locks the curated Library content. Supersedes the tab
labels and Library placement above where they conflict.

## A1. Reframe: the split is the *trigger*, not the actions

An automation and a routine can run identical actions — the only real
difference is **what pulls the trigger**. So the two groups are relabelled to
*be* that question, with no jargon:

- **Automatic** — *it starts itself* (a sensor, a state, or the clock). Was "Automations".
- **On-demand** — *you start it* (a tap or a spoken phrase). Was "Routines".

Every Library card carries a **trigger chip** so the distinction is visible
per-item, never something the user must reason about: **⚡ Automatic · 👆 Tap ·
🗣 Say "…"**. The two tabs are just a filter on that chip.

Consequence: scheduled **Sleep Mode** / **Morning Routine** are *Automatic*
(the clock fires them); their spoken/tapped twins **Good Night** / **Good
Morning** are separate *On-demand* items — same body, different trigger.

## A2. Library = one flat shelf, page-level, serves both

- **No "curated vs community" distinction.** One Library. Merge both source
  lists, drop the Community badge, dedup overlaps to a single winner each.
- **Library is page-level, not owned by a tab** — the "Add" entry point lives in
  the Actions header (above the tabs), opening one unified Library that contains
  both Automatic and On-demand items. Picking one lands it in the right tab.

## A3. "Add" — no "multi" concept

Multiplicity is emergent, not a feature. Every Library item's **Add** button is
**always available** (used items are never hidden). **Add** opens the configure
step, which asks for *whatever that item binds to* — decided by the item, not a
mode the user picks (Motion Light → a room + light; a plug schedule → a
device). Each Add creates **one uniquely-identified instance** (unique id +
distinguishing name, e.g. "Motion Light — Bedroom") so a second Add never
overwrites the first. Smart Room's per-room id scheme is the existing pattern to
extend to the other room-scoped items. Naturally-once items (Leave Home, Smart
Light Schedule, and the On-demand set) simply won't be added twice in practice.

## A4. The curated Library (14 items)

**⚡ Automatic (8)** — fires itself:
| Item | Starts on | What it does |
|---|---|---|
| Leave Home | everyone leaves | lights + AC off |
| Pre-cool on Arrival | you head home | AC starts so it's cool on arrival |
| Smart Climate Control | room too warm | AC starts |
| Window Open — AC Off | window opens w/ AC on | push with one-tap shutoff |
| Motion Light | motion (room; opt. night-only) | light on, off after a bit |
| Smart Light Schedule | time of day | lights cool/bright noon → warm/soft night |
| Night Watch | you're in bed | dims lights, silently alerts if something stirs |
| Smart Room | *(you pick a room)* | builds a room's whole presence/lighting/comfort set |

**👆🗣 On-demand (6)** — you start it:
| Item | Trigger | What it does |
|---|---|---|
| Good Night | 🗣 / 👆 | lights off, AC to sleep temp |
| Good Morning | 🗣 / 👆 | lights on, comfortable temp |
| Movie Night | 🗣 / 👆 | living-room dim, TV on, AC comfy |
| Leaving | 👆 | everything off |
| Away / Vacation | 👆 | everything off + simulate presence for N days |
| Shabbat | 🗣 / 👆 | fixed Shabbat lighting + AC preset, no mid-Shabbat switching |

**Dropped from the Library** (and why): Welcome Home, Morning Routine·Sleep Mode
kept only as Automatic (their On-demand twins added), AC Schedule, Open/Close
Blinds, TV Off When Empty, Child Room Monitor — trimmed as low-value or
device-narrow. The alert-class items (Water Leak, Low Battery, Doorbell, Child
Room too-hot) are **not** Library automations: alerting is always-on, owned by
the Alerts/anomaly engine.

## A5. Alerts verification (checked in code, 2026-07-19)

- **Per-device battery: already live.** `anomaly_engine.py` ANOM-08 fires
  "*{device} battery is low ({n}%)*" below 20%, per-entity, 24h cooldown,
  enabled by default. No Library item needed.
- **Water leak: intentionally out.** No leak anomaly rule exists and the user
  does not want leak alerting — **not** added. (Leak sensors are still detected
  and grouped; only the proactive alert is absent, by decision.)

## A6. On-demand starter set = the new Routines seed

`services/routine_templates.py` `ROUTINE_TEMPLATES` is currently **empty**. The
6 On-demand items above are the starter set that fills it. Good Night / Good
Morning / Shabbat carry a spoken phrase (rides the `voice_intents` phrase engine
— but per Phase 2 the *emission* of routines from smart-room stays with the
concurrent session; here we only seed the curated routine templates + their tap
trigger, and register phrases where the existing engine already supports it).

## A7. Build order (Phase 1b — this addendum)
1. Relabel tabs Automatic · On-demand (i18n + Actions.jsx); add trigger chips to Library/Active cards.
2. Move the Library "Add" from inside the Automations tab to a page-level header action; unify content (drop Community badge, dedup), typed Automatic/On-demand with a filter.
3. Curate `automation_templates.py` to the 8 Automatic items (merge the 3 motion variants → one; drop the trimmed ones from the surfaced set).
4. Seed `routine_templates.py` with the 6 On-demand items.
5. "Add" always available + unique-instance ids for room-scoped items (extend Smart Room's id scheme).
6. Keep Phase 2 (Routine-as-primitive, smart-room emits routines, action-quick-asks fold) with the concurrent session.
