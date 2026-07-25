# Unified Bundle Wizard Engine — Design Spec

**Date:** 2026-07-25 · **Branch:** `feat/unified-bundle-wizards` · **Status:** approved (Option A)

## Problem

The 8 OOTB bundle automations (Motion Light, Night Watch, Window-AC, Leave Home,
Pre-cool, Smart Room, Smart Climate, Smart Light Schedule) each grew a bespoke
wizard component (220–375 lines) plus 3 bespoke view modals. They started from the
same intent and diverged: 2 are stepped, 6 are single-scroll; 6 reinvent the same
"all vs choose" device picker; each invents its own state shape, derive logic, and
save flow. Actions.jsx hosts ~10 separate modal branches. Adding bundle #9 means
another 300-line component that will diverge again.

## Decisions (locked with the user)

1. **Hybrid flow:** creating a bundle is **stepped** (one decision per screen);
   opening an installed bundle is **one flat, live-editable summary**.
2. **View IS edit:** no separate read-only modal. The final review step of Create
   is the same component as the installed-bundle editor. The 3 bespoke view modals
   (Circadian / Climate / SmartRoom) are deleted; the generic AutomationViewModal
   stays only as the eye-view for *custom* automations.
3. **Scope:** the 8 bundle wizards + the custom AutomationWizard adopt one shared
   skeleton. Rooms-page wizards and RoutineWizard are out of scope this round.
4. **Unify + polish:** each bundle keeps what it does; questions are normalized
   (one room-grouped all/choose picker, one time-window widget, one review screen).
   Saved automation shapes (ids, triggers, actions) are unchanged so installed
   automations on the Canary keep working.

## Architecture — Option A: one engine, bundles as recipes

New directory: `frontend/src/components/automations/bundles/`

```
bundles/
  engine/
    BundleHost.jsx      # entry: resolves recipe, builds ctx, loads data, derive → values
    BundleWizard.jsx    # stepped CREATE flow; last step = review (BundleEditor body)
    BundleEditor.jsx    # flat EDIT surface (installed bundles open here directly)
    StepFrame.jsx       # shared step shell: eyebrow title + step dots + n/N counter + nav
    fields.jsx          # the shared field vocabulary (renderers)
    context.js          # useBundleCtx(): entities, rooms, roomOf, entityMap, …
  recipes/
    motionLight.js  nightWatch.js  windowAc.js  leaveHome.js
    precool.js      circadian.js   climate.js   smartRoom.js
    index.js        # registry: id → recipe
```

### Recipe contract (plain object, no JSX except `custom` fields)

```js
{
  id: 'window_ac',
  titleKey, subtitleKey, icon,
  loadData?:  async (ctx, initial) => extra,        // persons, zones, IR devices…
  derive:     (initial, ctx) => values,             // create defaults + edit reconstruction
  steps:      (values, ctx) => [Step] | [Step],     // static array or fn (dynamic steps)
  canSave:    (values, ctx) => bool,
  save:       async (values, ctx, initial) => void, // owns its save target (automations /
                                                    // smart_climate config / circadian config)
  remove:     async (ctx, initial) => void,
  failedKey, deleteLabel: (values, ctx, t) => string,
}
```

`Step = { key, titleKey, icon?, fields: [Field], validate?: (values, ctx) => bool }`

### Field vocabulary (fields.jsx)

| type | replaces today | notes |
|---|---|---|
| `pickMany` | 6 hand-rolled all/choose pickers | items fn(ctx,values); optional All/Choose pills; room-aware labels |
| `pickOne` | 5 hand-rolled radio lists | generic items `{id,label,sub,icon}` (entities OR IR devices OR sources) |
| `choice` | WindowAc mode, Circadian applyMode | radio cards with label+desc |
| `toggle` | every Row() copy | boolean row with label/sub |
| `number` | brightness/linger/grace/temp | inline number + prefix/suffix text |
| `slider` | SmartRoom Range, Circadian Slider | range + live value |
| `time` / `timeWindow` | night windows in 4 wizards | one widget everywhere |
| `note` / `warnIf` | hint + warning boxes | declarative |
| `custom` | truly bespoke screens | renders inside the shared frame |

Every field supports `visibleWhen(values, ctx)` (e.g. Leave Home hides Phone until
presence is tracking; Precool hides the temp input for IR ACs).

### The unifying trick

`BundleWizard`'s final step renders `BundleEditor`'s body (all fields flat, grouped
by step titles) with a Create button. Opening an installed bundle renders
`BundleEditor` directly with Delete / Cancel / Save. One component, two doors.

### Per-recipe mapping of the weird parts

- **Motion Light** — room-pairing compile (per-room stages) lives in `save()`;
  the pairing preview is a `custom` field. Derive unions sensors/lights across
  all `ziggy_motion_light*` stages (host passes `automations`).
- **Night Watch** — 3-stage paired build in `save()`; arm-mode choice + room-aware
  living-candidates as items fns.
- **Window-AC** — notify/auto `choice`; IR-vs-climate branching inside `save()`.
- **Leave Home** — AND-combinable sources = `pickMany` over source items with the
  AND connector styling; alert automation second create in `save()`.
- **Pre-cool** — geofence ensure (`ensureNearZone`) inside `save()`; presence/home
  gates as `warnIf` + `canSave`.
- **Circadian** — save target = circadian config (`saveCircadian`); anchors are
  slider pairs; stepped create: lights → day peak → night floor → timing → mode.
- **Climate** — save target = smart_climate config; dynamic steps (heating step
  appears on demand); edge editor = `pickOne` (devices incl. IR) + two `number`s.
- **Smart Room** — heaviest escape-hatch user: room-pick, async designSmartRoom
  resolution, needSensor (embeds OccupancySensorForm), decline — modeled as
  `custom` steps inside the shared frame. Installed Smart Room's editor = the
  members list (toggle + per-member standard editor + delete room), preserving
  today's behavior in the shared skin.

### Custom AutomationWizard

Keeps its 5 steps and its TriggerEditor/ConditionRow/ActionRow/ReviewPanel
internals, but renders through the shared `StepFrame` (same header, dots, counter,
nav buttons) so it is visually identical to bundle creation.

### Actions.jsx host

The 8 `*Target` states + 8 Modal branches collapse to:

```js
const [bundleTarget, setBundleTarget] = useState(null) // { recipeId, initial }
…
<Modal open={!!bundleTarget} …>
  <BundleHost recipeId={bundleTarget.recipeId} initial={bundleTarget.initial}
              automations={automations} onSaved={…} onClose={…} confirmDelete={confirmDelete}/>
</Modal>
```

- `handleConfigureTemplate` maps `wizard_prefill.bundle` → recipeId directly.
- The `isLeaveHome/isPrecool/…` sniffers collapse to one id→recipe lookup table.
- Group rows' `onView` and `onEdit` both open the same editor (view IS edit).
- Deleted: CircadianViewModal, ClimateViewModal, SmartRoomViewModal, and the 8
  legacy wizard components once migrated.

### i18n strategy

Recipes reference the **existing** per-bundle keys (`automations.motionLight.*`,
etc.) so the Hebrew translations survive untouched. Only a small shared set is
added under `automations.bundles.*` (back/next/create/save/update/delete/cancel,
step counter, all/choose, review title). EN + HE both.

### Testing

- Vitest unit tests for the pure parts: each recipe's `derive()` (installed
  automation → values round-trip) and save-payload builders where extractable.
- `npm run build` green; existing vitest suite green.
- Real-hardware validation on the Canary remains the user's acceptance gate.

## Risks

- **Smart Room** has the most custom machinery; it deliberately uses `custom`
  steps rather than forcing the abstraction.
- Derive logic is behavior-critical (it reconstructs installed state); unit tests
  target exactly this layer.
- `BundlePreviewCard` (LLM/Pro bundle preview) is untouched — different surface.
