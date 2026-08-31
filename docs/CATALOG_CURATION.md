# Ziggy Capability Catalog — Curation Guide

**This document is the source of truth for how catalog entries are written and
what counts as one.** The JSON schema (`scripts/catalog/schema.py`) fixes the
*shape*; this document fixes the *judgment*. Any agent updating the catalog
gets handed this file verbatim.

The rules here came from real experience. Version 1 of the catalog extracted
**483 "capabilities"**. About four in five turned out to be changelog lines,
implementation details, or UI states, not features. Compression to **78 real
entries** happened by applying the rules below. Any update that doesn't apply
them will drift back toward 483.

---

## 1. The one test

**Would a person say *"Ziggy can do this"*?**

If a change is a refinement *of* something rather than a thing on its own, it
is not a capability. Fold it into the parent as `what_it_does` detail or a
`known_gaps` entry. If it doesn't affect a parent either, drop it.

Worked examples of the cut:

| Kept as a capability | Rejected — folded into parent or dropped |
|---|---|
| Alerts — the home watcher | *"Alerts", not "anomalies"* — a naming decision |
| Household sign-in | *Silent password-hash upgrade* — an implementation detail |
| The Actions page and Library | *Add is disabled unless it can actually run* — a button state |
| Smart Light Schedule | *Apply-mode picker* — a form field on the wizard |
| Nightly encrypted home backup | *Relay key unseal with audit trail* — a step inside the backup |

When in doubt, prefer **updating an existing entry** over creating a new one.
"Add a new capability" is the tempting move that inflated version 1.

---

## 2. Voice

The catalog is written from **the owner's side, in the user's language**. Not
engineer language, not marketing language, not Home Assistant vocabulary.

### `pitch` — one benefit line

- **8–130 characters.** If it needs a second sentence, it's not a pitch.
- No entity IDs, no code words: `entity_id`, `webhook`, `endpoint`, `HA`,
  `MQTT`, `homeassistant`, `Home Assistant`, `API`, `router`.
- Describes what the person gets, not what runs.
- Hebrew examples are shown in Hebrew when they're the point (`תדליק את האור בסלון`).

Good pitches, from the current catalog:

- *"Walk out and the house shuts down behind you; drive home and it's already cooling."*
- *"See at a glance who is home and who is out, without a single false alarm from a napping phone."*
- *"Type or say what you want in Hebrew or English and your home does it."*
- *"Make a room look after itself without waking the person asleep in it."*
- *"Ziggy turns off the lamp you actually named, not the nearest guess."*

Rejected shapes:

- ❌ *"GPS-triggered climate.turn_on with 15min pre-arrival buffer via presence webhook"* — engineer talk.
- ❌ *"Manage automations from the Actions page"* — describes the UI, not the value.
- ❌ *"Improved anomaly rule coverage"* — a changelog line, not a benefit.

### `what_it_does` — 2 to 4 plain sentences

- 30 chars minimum, but aim for 200–500 chars.
- Describes *what happens for the user*, not how the code is structured.
- May name concrete surfaces (a screen name, a button, a chip) but not files,
  functions, or entity IDs.
- Preserves the interesting detail: which specific behaviours make this
  capability the thing it is.

Good example (from Alerts):

> Everything the home can do lives on one page split into Automatic ("it
> starts itself") and On-demand ("you start it") tabs, with a curated Library
> of ready-made options reachable from a header button. Each Library card
> shows a plain-language description and whether your home has the devices to
> run it — the Add button only lights up when it can actually work, so tapping
> it never opens a dead form.

Notice: names screens ("Automatic", "Library"), names behaviours ("Add button
only lights up when it can actually work"), names no files.

### Layer names are human, not code

The `layer` field groups entries for the reader. Use short human names:
`Chat & voice`, `Automations`, `Presence`, `Climate & light`, `Mobile app`,
`Alerts & safety`, `Fleet & releases`, `Backup`, `Language`, `Platform`.
**Not** `backend/services`, `presence-territory`, `frontend-pages`.

---

## 3. `status` — the five values

Vocabulary is closed. Any other value is invalid.

| Value | Applies when |
|---|---|
| `live-prod` | Wired in a shipped release tag, reachable from a production entrypoint (`backend/server.py` startup or a `ziggy_scheduler` tick), and running on every home in the fleet. |
| `canary-only` | On main and on the canary cohort, but not in the newest `release-*` tag yet. |
| `flagged` | Present and wired, but gated behind a `settings.yaml` flag that is off by default. Name the flag in `status_evidence`. |
| `orphaned` | Code exists but no caller reaches it from any production entrypoint. Include the file that *would* have been the entrypoint if one existed. |
| `abandoned` | Removed from the tree, superseded, or retired by its own success (a one-shot tool that completed its job fleet-wide). |

### The pessimistic rule

When evidence disagrees or is ambiguous, **under-claim**:

- `orphaned` beats `live-prod`.
- `abandoned` beats `orphaned`.
- `flagged` beats `live-prod` when the flag is off by default.

A catalog that undercounts is recoverable. A catalog that tells you a dead
feature ships is the failure mode this whole thing exists to prevent. **Never
soften a demotion.** If the evidence supports `orphaned`, mark it `orphaned`
even if it feels like it should be alive.

### The `ziggy_main.py` trap

`core/ziggy_main.py` is **not** a production entrypoint. The container runs
`uvicorn backend.server:app`. Anything started only in `ziggy_main.py` is
`orphaned`, no matter how complete it looks. Four features were once wrongly
listed as live for this exact reason.

---

## 4. `status_evidence` — cite or it doesn't count

Every `status_evidence` string must cite a **real file path, flag name, or
commit SHA**. A claim without a citation is a failure.

Good evidence, current catalog:

> *"VERIFIED: ships in release-2026.08.14-8 (commit 9118fc9 is an ancestor)
> but is inert by default — gated behind settings flag `assistant.engine`
> (`backend/routers/intent_router.py:94-113` defaults to "v1"), with no
> `assistant` block in the shipped `config/settings.example.yaml`."*

> *"`services/anomaly_engine.py` registers ANOM-01..ANOM-12; routed at
> `frontend/src/App.jsx:467` (path "alerts", redirecting from /anomalies);
> one-tap fix at `backend/routers/map_router.py:332`."*

> *"`scripts/migrate_zha_to_z2m.py` (commit 2ef1dd2, last touched 2026-06) and
> `docs/RUNBOOK_ZHA_TO_Z2M_CUTOVER.md` remain in the tree, and memory
> `project_z2m_migration.md` confirms the job it was built for is done."*

### Honest evidence when you did not verify

Not every update can afford full verification. When you're carrying a status
forward from prior extraction rather than re-proving it, **say so
explicitly**:

> *"Carried from `automations-and-bundles.history.json`, a history-angle
> salvage extraction that was not independently re-verified in this pass.
> Cited sources: `services/automation_templates.py` …"*

Do **not** write evidence that *sounds* proven when it isn't. That is worse
than saying "unverified" — it launders inference as fact.

### Verified prefix

When you *did* verify against release tags and entrypoints, prefix with
`VERIFIED:` so readers can tell at a glance which entries earned it. Only two
territories in the current catalog carry this prefix; adding more is welcome
but must be earned.

---

## 5. `known_gaps` — the memory field

This is the single most valuable field in the catalog. It exists to preserve
**things future-you would otherwise forget and re-try**, and **honest caveats
that matter to a user**.

What belongs:

- **Do-not-re-try history.** From the Actions entry: *"An earlier read-only
  'look, don't touch' view lock on installed actions was tried, disliked by
  the operator, and reverted the same day — do not re-add it."* This is
  memory the codebase itself cannot hold.

- **Known live defects a user would notice.** From Smart Room: *"Ships fixed
  evening/morning clock times (19:00–06:30) instead of real sunrise/sunset,
  which drifts from reality in Israeli summer."* Not internal noise —
  something you'd want to fix.

- **Unfixed bugs you know about.** From Alerts: *"The engine's in-memory
  timers are not persisted — a restart hands the home a free 24-hour grace
  period on the 'left on' rule."*

- **Carrying costs from prior versions.** *"Six older templates and eleven
  bundled community blueprints were retired or hidden during a 2026-07-19
  curation pass but are still loaded and parsed on every page request."*

- **Deliberately-parked adjacent features.** *"A brief attempt to give
  quick-ask shortcuts a third tab on this page was rolled back when the page
  was simplified to two tabs."*

What does **not** belong:

- Pure implementation detail. If a user would never notice, drop it entirely,
  don't hide it in `known_gaps`.
- Refactoring notes.
- Naming decisions.

---

## 6. Merge aggressively

The compression rule that took 483 down to 78: **when multiple candidate
records describe one thing from different angles, merge them.**

Real merges from the current catalog:

- *"Who's home right now"* absorbed **12** raw records: household presence,
  phone-on-wifi, LAN pin self-heal, ask-before-declaring-departure, native
  background presence, debug console, incident journal, manual override,
  HA-published sensor, and three abandoned attempts.

- *"The house reacts to you leaving or arriving"* absorbed **7** records:
  Leave Home, Pre-cool on Arrival, arrival/departure automations,
  arrival/departure notifications, and the abandoned motion-triggered
  predecessor.

- *"Alerts — the home watcher"* absorbed **12** records: rule engine, inbox,
  the rename from "anomalies", one-tap fix, snooze, history, rules admin,
  room-name resolution, always-on exemptions, and the reconnect false-alarm
  guard.

The rule of thumb: **if two candidates share their user pitch, they are one
entry.** The losers' distinct content moves into `what_it_does` (if a user
would notice) or `known_gaps` (if it's history worth preserving).

---

## 7. Mechanisms — Tier 2

Mechanisms are the **reusable building blocks capabilities are built from**:
presence zones, the FCM push channel, the bundle recipe registry, the intent
dispatcher. They live under `mechanisms`, not `capabilities`, and they are
what makes composition analysis possible.

### The stopping rule

A mechanism earns a Tier 2 entry only if **at least one** is true:

- **Used by 2 or more capabilities.** ("Presence zones" underpins arrival,
  departure, and Smart Room → keep.)
- **`domain_concept: true`** — it owns its own store/engine and would exist
  even if only one capability used it today. (The presence engine, the
  circadian ramp engine, the backup key escrow vault.)

Otherwise it's implementation detail. Do not add it. Version 1 had many
"mechanisms" that were single-consumer utilities; the rule culls them.

### `kind` — closed vocabulary

`trigger`, `condition`, `action`, `alert-channel`, `engine`, `store`,
`bridge`. Nothing else. Typed mechanisms give the Foundations view its
cross-cutting inventories ("every trigger", "every alert channel") for free.

### `health` — the fragility note

Optional but valuable. Names a known failure mode of the mechanism itself:

> *"lan_host is IP-pinned and drifts with DHCP"*

> *"A geofence event carries the ring's centre, not the phone. A Samsung
> force-kill silently unregisters the OS-side rings; only an FCM probe or an
> app open re-arms them."*

> *"en.js has drifted to 114 duplicate keys where JS's 'last definition wins'
> silently picks stale copy."*

A `health` note that's actually a bug ticket should be a bug ticket, not a
catalog entry. Only include fragilities that are architectural or
carry-forward.

### `used_by` is not written by hand

Do not populate `used_by` in mechanism records. It is derived from the `uses`
edges on capabilities by the merge engine. Any hand-written value will be
overwritten.

---

## 8. `composes_with` is derived, never written

Two capabilities compose if and only if they share at least one mechanism.
The `composes_with` field on capability records is **computed** from `uses`
edges by `scripts/catalog/merge_catalog.py`. Never write it by hand. Any
value provided will be overwritten.

This is a design choice, not a limitation: derived composition is consistent
and defensible in a way that hand-asserted composition never can be.

---

## 9. `audience` — three values

| Value | Applies to |
|---|---|
| `user-facing` | A customer of Ziggy perceives it directly. |
| `operator` | Youval, or a support engineer, uses it to run the business — fleet ops, remote support, factory imaging. |
| `internal` | Platform machinery that other capabilities depend on but a user never sees. |

Only `user-facing` entries appear in the Pitch/value-story view. Operator and
internal entries are surfaced in the Engineering view of the catalog viewer.

---

## 10. Adding, updating, or skipping — the hard call

When new work has landed and you're deciding what to do, the default is:

1. **Update an existing entry** if the work extends a capability that already
   has a home. Add to `what_it_does` if a user would notice; add to
   `known_gaps` if it closed a bug worth remembering; refresh
   `status_evidence` if the citation is now stale.

2. **Only add a new entry** if the work is genuinely a new capability by the
   Section 1 test — a thing a user would name — and it doesn't fit under any
   existing entry.

3. **Skip entirely** if it's refactoring, a rename, a test-only change, a
   dependency bump, or purely internal plumbing that doesn't move the
   product forward from a user's point of view.

If you're unsure between (1) and (2), pick (1). If between (2) and (3), pick
(3). Bias toward fewer entries; the catalog stays useful only if it stays
compressed.

### Dead-capability detection

Before adding anything, run the dead check on the existing catalog: for each
capability, if **all** its `surfaces` no longer exist in `git ls-files`,
mark it `abandoned` and cite the deletion commits. This is mechanical and
should run every refresh.

---

## 11. Mechanical checks (the linter)

A deterministic pre-commit check that runs before any catalog change lands.
Rejects on hard rule violations; warns on suspicious patterns.

### Rejects (must fix before commit)

- `pitch` shorter than 8 chars or longer than 250 chars. (The current longest is 199; keep some headroom.)
- `pitch` contains: `entity_id`, `homeassistant`, `Home Assistant`, `MQTT`,
  `webhook`, `endpoint`, `router`, `HTTP`, `API` (case-insensitive).
- `what_it_does` shorter than 30 chars.
- `what_it_does` contains a file path pattern (`services/`, `backend/`,
  `frontend/`) or a Python function reference (`::`, `def `, `.py:`).
- `status` not in the closed set.
- `status_evidence` shorter than 20 chars, or contains no path separator
  (`/`), no `.py`/`.jsx`/`.ts`/`.md`, no SHA-like token (7+ hex chars), and
  no flag name (`something_flag`, `settings.something`).
- `audience` not in `user-facing | operator | internal`.
- Mechanism `kind` not in the closed set.
- Any record contains `composes_with` (capability) or `used_by` (mechanism).

### Warns (needs a second look)

- New entry whose `surfaces` overlap ≥ 50 % with an existing entry — probably
  a merge, not a new entry.
- Any status change from `orphaned`/`abandoned` back to `live-prod` — the
  pessimistic rule was overridden; make sure that's intentional.
- A capability with `uses: []` — verify no shared mechanisms were missed.
- A mechanism with `used_by.length < 2` and `domain_concept: false` — the
  stopping rule says drop it.

---

## 12. Gold-standard entries

These are the calibration set. When a new agent is producing entries, hand
these to it as few-shot examples of what "good" looks like in each layer:

- **Chat & voice** → `chat-with-ziggy` (verified, honest gaps, real Hebrew example)
- **Automations** → `actions-page-and-library` (rich `known_gaps` with do-not-re-try history)
- **Presence** → `whos-home` and `leaving-and-arriving` (large merges done right)
- **Alerts & safety** → `alerts-inbox` (12 sources folded into one, with unfixed bugs preserved)
- **Fleet & releases** → `fleet-health-and-repair` (operator audience, precise evidence)
- **Devices** → `add-a-device` (single card over heterogeneous pairing paths)
- **Language** → `hebrew-and-rtl-product` + `hebrew-conversation-and-voice` (one product-surface, one voice-surface — not one per string)
- **Platform** → `platform-engineering-safeguards` (self-enforcing rules as a capability)

---

## 13. What isn't in this document

- **The schema** — see `scripts/catalog/schema.py`.
- **The pipeline** — see `scripts/catalog/*.py` for merge, render, and assemble.
- **The territory partition** — see `catalog.config.json`.
- **When to refresh** — that's an operational question, not a curation one.

---

## Changelog

- **2026-08-29** — v1. Extracted from the compression session that took the
  raw 483-record extraction down to 78 curated entries.
