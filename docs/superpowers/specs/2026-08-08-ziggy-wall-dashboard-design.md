# Ziggy Wall Dashboard — Design

**Date:** 2026-08-08
**Status:** Built. Verified in a browser against a live hub; pending on-hardware
validation on a real tablet (§14).
**Source design:** claude.ai/design project `230b8010-dca8-4ddd-a0a4-401075de07cb`
("Ziggy Tablet Home Dashboard"), file `Ziggy Tablet Dashboard.dc.html`

---

## 1. Goal

Every Ziggy home has phones running the app and, on the wall, a always-on tablet
showing the whole home in one place. This spec covers the wall tablet surface:
a live, editable, room-first dashboard that reflects exactly the same home state
as every phone in the house, at all times.

The imported design supplies the visual and interaction language. It was drawn
without knowledge of the Ziggy codebase, so this spec is the bridge: it maps
every element of the mockup onto real Ziggy data, real components, and real
plumbing, and specifies the parts that do not exist yet.

## 2. Scope

**In scope (v1)**

- New wall dashboard at `/wall`, coexisting with the untouched `/hub` (see §4)
- 12-column snap grid with drag, resize, and auto-reflow; per-tablet persistence
- Fixed Rooms rail + reorderable/resizable modules, duplicates allowed
- Live state from the hub; optimistic control with rollback; honest offline state
- Full parity for device pairing and automation authoring, by reusing the real
  app components rather than reimplementing them
- Tablet identity with per-capability permissions and a PIN gate on sensitive
  actions, enforced server-side
- HE/EN with RTL, light/dark, both driven by existing app state
- Idle / always-on-display with burn-in protection
- Two new hub-owned features with real backends: **shopping lists** and **agenda**

**Out of scope (v1)**

- Voice input on the tablet (see §10 — blocked on secure context)
- Shopping list and agenda UI in the phone app (backend is built app-ready)
- Google Calendar sync
- Wake-on-motion and auto-return-home (explicitly declined)
- Any change to the phone app's existing screens

## 3. Decisions

| # | Decision | Chosen |
|---|---|---|
| 1 | Old `/hub` | Scrap all UI; keep and extend backend plumbing |
| 2 | Shopping + agenda | Real hub-persisted backends, WS-synced, tablet-only UI for now |
| 3 | Scenes | User-curated selection of existing on-demand Actions/routines |
| 4 | Pairing + automations | Full parity, reusing existing UI and plumbing |
| 5 | Security | Per-tablet identity + configurable capabilities + PIN gate |
| 6 | Voice | Tap-to-type only in v1; mic behind a flag |
| 7 | Layout | Rooms fixed; 12-col snap grid, resize + move any direction, auto-reflow |
| 8 | Idle | Dim + big clock after timeout, with burn-in protection |
| 9 | Palette | Match the app's existing tokens |

### Note on decision 9

Investigation during design found the app and the mockup are already the same
design system. `index.css` defines `--accent: #C96442`; the mockup specifies
`#c9634a`. `--bg` is `#F9F7F3` against the mockup's `#f2efe9`. Both load
**Heebo + IBM Plex Mono**. The indigo `#4f46e5` seen in old Hub code was a dead
fallback in `var(--accent, #4f46e5)` that never rendered.

Consequence: the mockup's literal hex values are **discarded** and every surface
uses the existing token set. A complete dark ramp already exists in `index.css`,
so dark mode requires no new color work — only correct token usage.

One new semantic token is required. The design uses `#26221e` (near-black) as a
*raised* surface for active chips, the Ziggy module, and scene tiles. In light
mode that reads as "inverse of the page"; in dark mode it must not stay dark or
those elements vanish. Add:

```css
:root       { --inverse: var(--ink);       --on-inverse: var(--bg); }
[data-theme="dark"] { --inverse: var(--surface-3); --on-inverse: var(--ink); }
```

## 4. Additive-only constraint

**Nothing in the existing app or hub may change or degrade.** This is a hard
constraint and it overrides any convenience in this design. The wall dashboard
is a new surface that sits *beside* the current one; it never edits, reshapes,
or deletes a working path.

### 4.1 Nothing is deleted

`pages/Hub.jsx`, `components/hub/*`, and `stores/hubStore.js` stay exactly as
they are, and `/hub` keeps rendering the current dashboard. Removing them is a
**separate, later step**, taken only after the new surface is confirmed working
on real hardware and explicitly approved. Until then the two coexist and `/hub`
is a working fallback.

### 4.2 New surfaces, not extended ones

| Concern | New thing | Existing thing (untouched) |
|---|---|---|
| Route | `/wall` | `/hub` |
| API | `/api/wall/*` (`backend/routers/wall_router.py`) | `dashboard_router.py` |
| Layout storage | `user_files/wall_layouts.json` | `dashboard_layouts.json` |
| Capabilities + PIN | `user_files/wall_tablet_policy.json`, keyed by `tablet_id` | `dashboard_tablets.json` schema |
| Store | `stores/wallStore.js` | `stores/hubStore.js` |

Tablet pairing is **read-shared**: the wall reads the existing tablet registry
via `dashboard_tablets.get_tablet()` and stores its policy alongside by id. A
tablet paired for `/hub` therefore works on `/wall` with no re-pairing, and the
pairing flow itself is not modified.

### 4.3 Append-only edits to shared files

These four files are touched, and only by appending:

- `frontend/src/index.css` — add `--inverse` / `--on-inverse`. Nothing existing
  reads these names, so no current pixel moves.
- `services/mobile_ws_bridge.py` — add `list_changed`, `agenda_changed` to
  `_MOBILE_RELEVANT_TYPES`. Additive allowlist entries only.
- `frontend/src/lib/api.js` — new exported consts at the end of the file.
- `frontend/src/App.jsx` — one lazy import and one `<Route>`.

No existing function, export, endpoint, or storage schema is modified.

### 4.4 Reused read-only

- `stores/deviceStore.js` (rooms, entities, groups, `pinnedShortcuts`, `roomsOrder`,
  `updateEntityState`) — consumed, never modified
- `stores/automationStore.js`, `stores/taskStore.js`, `stores/uiStore.js` (theme)
- `hooks/useWebSocket.js` — module-level singleton, reconnect, `_msgSeq`
- `lib/i18n/` (`he.js`, `en.js`, `useT`), `lib/deviceIcons.jsx`
- `components/PairingWizard.jsx` + config-flow components
- `components/automations/*`

### 4.5 Regression baseline

Recorded before implementation began, so new breakage is distinguishable from
existing breakage:

- **Frontend:** 129 passing, **1 pre-existing failure** —
  `src/lib/__tests__/mergedIrAvailability.test.js`, "reflects an IR-assumed ON
  while Wi-Fi is still catching up". Not caused by this work.
- The full suite is re-run at the end of every phase; any *new* failure blocks
  the phase.

## 5. Architecture

### 5.1 File layout

```
frontend/src/pages/Wall.jsx              route shell, mounted at /wall, outside AppShell
frontend/src/wall/
  WallShell.jsx        header + tabs + idle host + toast host + PIN host
  WallHeader.jsx       logo, date/greeting, tabs, clock, weather, actions
  WallGrid.jsx         module rendering, drag + resize surface
  RoomsRail.jsx        fixed furniture, left (right in RTL)
  EditChrome.jsx       per-module overlay, module picker, hidden tray
  IdleScreen.jsx       AOD clock + burn-in drift
  PinGate.jsx          PIN pad, elevation lifetime
  ConnectionState.jsx  reconnecting chip + desaturation
  modules/
    registry.js        MODULE_REGISTRY: type -> {component, manifest}
    *Module.jsx        one file per module
  wall.css
frontend/src/lib/wallGrid.js             pure grid math, no React, no DOM
frontend/src/stores/wallStore.js         layout, edit draft, elevation state
```

Rationale: `wallGrid.js` holds all the fiddly placement logic as pure functions so
it is unit-testable without a browser and the components stay presentational. Each
module is one self-contained file; adding a module later means adding a file and a
registry entry, touching nothing else.

### 5.2 Grid engine

- 12 columns; column width = available width / 12. Row unit = fixed 64px.
- A module occupies `{x, y, w, h}` in whole cells.
- Manifest declares `minW, minH, defaultW, defaultH, maxW`.
- Resize drags a corner handle and snaps to whole cells, clamped to manifest bounds.
- Drop resolves by push-down then float-up ("gravity"): displaced modules move down,
  then every module rises until it collides. Result is always gap-free and
  overlap-free.
- Duplicates are permitted. Identity is the instance `id`, not the `type`.
- The Rooms rail is **not** in the grid. It is fixed furniture: leading edge, full
  height, fixed width, always present, cannot be moved or removed.

`wallGrid.js` exports pure functions:

```js
place(modules, id, x, y)      -> modules'   // move + reflow
resize(modules, id, w, h)     -> modules'   // resize + reflow
insert(modules, type, manifest)-> modules'  // first-fit placement
remove(modules, id)           -> modules'   // remove + reflow
reflow(modules)               -> modules'   // gravity pass, idempotent
collides(a, b)                -> boolean
```

### 5.3 Module contract

Every module exports a component and a manifest:

```js
export const manifest = {
  type:        'shopping',
  titleKey:    'wall.module.shopping',
  minW: 3, minH: 3, defaultW: 4, defaultH: 5, maxW: 8,
  capability:  'lists',        // gates visibility + actions; null = always allowed
  configSchema: { list_id: { kind: 'list', default: 'default' } },
}
```

The module picker, edit overlay, and capability filter all read the manifest. No
module type is referenced by name anywhere outside `registry.js`.

### 5.4 Module inventory

Backed by data that exists today:

| Module | Source |
|---|---|
| Rooms rail | `deviceStore` rooms + entities |
| Ziggy | `POST /api/chat` (tap-to-type) |
| Scenes | on-demand Actions/routines, user-picked instances |
| Pinned devices | `deviceStore.pinnedShortcuts` |
| Cameras | `camera_router` / `cameraStore` |
| Weather | `weather_router` |
| Tasks | `task_router` / `taskStore` |
| Alerts | `alerts_router`, anomaly events |
| Media | `media_router` / `mediaStore` |
| Modes | `mode_router` |

Requiring new backend (§6): **Shopping**, **Agenda**.

### 5.5 Rooms rail behaviour

Accordion per room, matching the mockup's structure on real data:

- Room row: name, status line ("2 lights on · 1 offline"), master toggle, chevron
- Expanded: per-device rows with live state text and the right control per domain —
  toggle, dimmer slider, climate ±setpoint, lock with confirm, offline state
- Master toggle applies to controllable domains only, skipping offline entities
- Lock actions are capability- and PIN-gated (§7)
- Room membership comes from the registry, per the existing room ownership model.
  The rail never derives or invents rooms.

## 6. New backend: lists and agenda

Two routers modeled directly on `task_router.py`, SQLite-persisted.

```
GET    /api/lists                     all lists with items
POST   /api/lists                     create list
POST   /api/lists/{id}/items          add item      -> ws list_changed
PATCH  /api/lists/{id}/items/{item}   toggle/rename -> ws list_changed
DELETE /api/lists/{id}/items/{item}   remove        -> ws list_changed

GET    /api/agenda?day=YYYY-MM-DD     events for a day
POST   /api/agenda                    create        -> ws agenda_changed
PATCH  /api/agenda/{id}               edit/complete -> ws agenda_changed
DELETE /api/agenda/{id}               remove        -> ws agenda_changed
```

Shopping is the default list (`id: "default"`), created on first read so a fresh
home is never empty-stateless.

Item shape: `{id, text, done, added_by, created_at}`.
Event shape: `{id, when, title, note, people[], done, created_at}`.

**Both new event types are appended to `_MOBILE_RELEVANT_TYPES` in
`services/mobile_ws_bridge.py`.** The features are tablet-only in the UI, but
they are live-synced to phones from day one. Retrofitting that later would cost
a release; doing it now costs one line.

## 7. Tablet identity, capabilities, PIN

The wall tablet is a shared, always-on, physically-accessible screen. It cannot
inherit a person's full permissions.

Per §4, the existing tablet record is **not modified**. Policy lives in a new
sidecar file `user_files/wall_tablet_policy.json`, keyed by the `tablet_id` the
existing pairing flow already issues:

```python
{ "<tablet_id>": {
    "capabilities": { ... },  # lights, climate, media, scenes, lists, cameras,
                              # locks, automations, devices, settings -> bool
    "pin_hash":     str | None,
    "pin_required": [ ... ],  # e.g. ["locks","cameras","settings","devices"]
}}
```

A tablet with no policy entry gets a safe default (everything except locks,
cameras, devices, and settings). Configured from **Settings → Tablets**.

**Enforcement is server-side**, via new middleware
`backend/middleware/wall_capability.py`. The middleware inspects the
`X-Ziggy-Wall-Tablet` header, maps the request's path + method to a capability,
and rejects when the tablet's policy forbids it. Requests without that header —
every phone, every browser, every existing client — pass through completely
untouched, so no existing route's behaviour changes.

**PIN elevation.** Entering the correct PIN mints a short-lived elevated scope
(default 5 minutes, then automatic re-lock) covering only the capability that
requested it. The tablet re-locks immediately on entering idle.

**UI consequence.** Capabilities the tablet does not have do not render at all —
their modules are absent from the picker and their controls are absent from the
rail. A child never sees a front-door control she cannot use.

## 8. Real-time and control semantics

The realtime fabric already exists and is complete. `ha_subscriber` sees a state
change and calls `ws_manager.broadcast`; `services/mobile_ws_bridge.py` fans the
same event to PWA clients (which includes the wall tablet) and, filtered, to
native phones over `/api/mobile/ws`. A tap on a phone is therefore already
visible to every other surface. The wall dashboard consumes this fabric; it does
not introduce a parallel one.

Required behaviour:

1. **No local mock state.** Every module renders from a store fed by the WS.
2. **Optimistic with rollback.** A control paints its new state immediately, then
   the confirming broadcast either ratifies it or the failure reverts it and
   surfaces the real reason via toast.
3. **Echo suppression.** The tablet tracks the `_msgSeq` of messages it caused so
   its own confirming broadcast does not fight its optimistic paint.
4. **Honest disconnection.** On WS drop the board desaturates slightly and shows a
   single quiet "reconnecting" chip. It must never present a confident, stale
   picture of the home. Existing reconnect cadence (750ms ×5, then 3s) applies.

Point 4 is a correctness requirement, not polish: a silently-wrong wall display
is the same failure class as the Canary DHCP outage.

## 9. Theme, language, idle

- **Language:** existing `lib/i18n`. All new strings go in `he.js` / `en.js`. The
  mockup's inline `STR` object is discarded. `dir` flips the whole board; the grid
  mirrors, so column 0 is the trailing edge in RTL.
- **Theme:** existing `uiStore` theme, already server-synced, plus the one new
  `--inverse` token pair from §3.
- **Idle:** black screen, large clock, home status line. Configurable timeout,
  stored in the tablet's layout record. Burn-in protection drifts the clock a few
  pixels on a slow cycle. Tap anywhere to wake. PIN elevation drops on idle entry.

## 10. Known constraint: voice

`getUserMedia` requires a secure context. A tablet on `http://<hub-lan-ip>` is not
one, so the microphone is silently unavailable — the same class of failure as
`crypto.randomUUID` in the wizard. v1 therefore ships tap-to-type against
`/api/chat`, with mic capture written but behind a flag and a capability check.
Enabling it later requires HTTPS on the tablet (tunnel or local cert) or running
the native shell in kiosk mode — a deployment decision, not a code change.

## 11. Testing

- **`wallGrid.js`** — unit tests for place/resize/insert/remove/reflow: no overlap,
  no gaps, idempotent reflow, clamped bounds, RTL mirroring.
- **Capabilities + PIN** — pytest: a tablet token lacking a capability is rejected
  at the API; elevation expires; idle drops elevation.
- **Lists + agenda** — pytest: CRUD, persistence across restart, broadcast emitted,
  type present in `_MOBILE_RELEVANT_TYPES`.
- **Optimistic rollback** — component test: failed command reverts and toasts.
- **On-hardware gate** — nothing is "working" until it runs on a real tablet against
  the Canary hub: two surfaces open, change on one appears on the other; pull the
  network and confirm the reconnecting state; leave it running overnight and confirm
  no leak or drift.

## 12. Risks

| Risk | Mitigation |
|---|---|
| `PairingWizard` is phone-shaped; tablet parity is real work | Adapt layout at the container level; do not fork the component |
| Touch drag + resize on a 10" screen is fiddly | Grid math is pure and testable; large hit targets; long-press to enter drag |
| Browser left open for weeks leaks | Interval/listener discipline; overnight soak test in the on-hardware gate |
| Regressing the working hub or app | §4 additive-only constraint; separate route, router, storage and store; full suite re-run against the §4.5 baseline every phase |

## 13. Implementation phases

1. Foundations — `wallGrid.js` + tests, `wallStore.js`, `/wall` route shell, `--inverse` tokens
2. Rail + live control — Rooms rail, optimistic control, connection state
3. Grid + edit mode — drag, resize, reflow, picker, per-tablet persistence
4. Modules on existing data — Ziggy, Scenes, Pinned, Weather, Cameras, Tasks, Alerts, Media, Modes
5. New backends — lists + agenda, routers, WS types, bridge allowlist, modules
6. Security — capability middleware, policy sidecar, PIN gate, Settings → Tablets UI
7. Parity — device modal + pairing, automations tab
8. Idle + AOD, burn-in, soak
9. Responsive sweep across tablet sizes + full test pass
10. On-hardware validation at Canary

**Not a phase:** retiring `/hub`. That happens only after phase 10 passes and is
explicitly approved.

---

## 14. Build notes — what changed during implementation

Recorded because several decisions in §1–13 turned out to be wrong once the code
met the codebase.

### 14.1 The old hub was already dead code

`/hub` is unreachable today, in three independent ways:

- `backend/routers/dashboard_router.py` is **never registered** in
  `backend/server.py`, so every `/api/dashboard/*` path 404s.
- `pages/Hub.jsx` has **no route** in `App.jsx`.
- It imports `hubTabletHeartbeat` and `claimHubPairCode` from `lib/api.js`,
  and **neither export exists**.

Consequence for this work: the "don't break the hub" constraint was free, and
the wall could not read-share the pairing endpoints as §4.2 assumed. Instead
`wall_router` exposes its own `/api/wall/tablets/*` endpoints that call the
existing, well-built `services/dashboard_tablets` functions — that service is
unmodified. `weather_router` is unregistered too, so the weather module falls
back to a Home Assistant `weather.*` entity.

### 14.2 Capability enforcement is real, via middleware

§7 said "enforced server-side" but only specified a policy service. Client-side
gating alone is theatre — a wall tablet can be pointed at the API directly. Added
`backend/middleware/wall_capability.py`: it maps path + method (and, for device
commands, the target entity's domain) to a capability and refuses with 403.

It is **inert unless the request carries `X-Ziggy-Wall-Tablet`**, which only the
`/wall` page sends (`setWallMode()` in `lib/api.js`, set on mount, cleared on
unmount). Every other client returns from the first line of the middleware.

Verified live: a phone unlocking the door → 200; the same call from a paired
tablet → 403 `denied`; after enabling locks behind a PIN → 403 `pin_required`;
after a correct PIN → 200; cameras still 403 (elevation is per-capability); after
the idle ping → 403 again.

### 14.3 An unpaired `/wall` session is unrestricted

A visitor to `/wall` who has not paired is a signed-in person in a browser, not
a wall panel — they already hold their own account's permissions and send no
tablet header, so restricting the UI would be both unenforceable and confusing.
`get_policy(None)` returns everything allowed. The restrictions exist for a
**paired** tablet, which is the one hanging where anyone can reach it.

### 14.4 Layout is authored once and derived per screen

The original design refitted the layout on every resize and wrote it back.
Refit is lossy — collapsing three-across onto a narrow board yields stacked
full-width cards, and widening back cannot recover the arrangement — so
rotating a tablet **permanently destroyed the user's layout**.

Now the stored layout keeps the `cols` it was authored at, and the view for the
current width is derived on render (`refit(...)` in `WallGrid`, never written
back). Editing re-authors at the current width. Verified: 1280 → 600 → 1280
returns pixel-identical geometry.

### 14.5 Grid engine fixes found by testing

- **`reflow` did not resolve overlaps.** It only floated cards upward, assuming
  overlap-free input — but `refit` legitimately produces overlaps. Two cards
  visibly stacked on top of each other at 1280px. Rewritten as a gravity pack
  that resolves overlap and gaps in one pass.
- **Drop-then-settle.** During a drag the moving card is pinned so neighbours
  slide around it; gravity is applied on release (`endGesture`). Pinning alone
  left holes; packing alone made the card squirm away from the finger.
- **`refit` ignored manifest minimums**, producing ~130px cards on a 7" panel
  with every label truncated to "Whol…". It now honours `minW`, and takes the
  full row when the minimum would leave an unusable sliver.
- **Rows stretch to fill.** A short layout on a tall portrait panel rendered as
  a band across the top with hundreds of pixels of dead space. `rowHeightFor()`
  stretches (capped at 2.2×, never shrinks).
- **Breakpoints retuned** so a 1280×800 tablet — the most common wall panel —
  gets the full 12 columns rather than being silently refitted to 8.

### 14.6 Other fixes

- `/wall` is exempt from `App.jsx`'s cold-start "send them home" redirect. A
  kiosk tablet cold-boots straight to its URL on every power-on, so without the
  exemption the wall would land on the phone dashboard forever.
- Un-pairing now deletes the tablet's capability policy **and PIN hash**, not
  just its layout. Found while cleaning up after a manual test; a reissued
  tablet id would have inherited a stranger's permissions.
- Room status lines report what is actually true. The lights-only count showed
  "all off" next to a lit green master switch whenever a room had a dishwasher
  running and its lamp off.
- Device names go through the app's `translateNamePhrase`, so Hebrew reads the
  same on the wall as on a phone.

### 14.7 Test + regression status

- **Backend:** 65 new pytest cases in `tests/test_wall_dashboard.py`.
- **Grid engine:** 60 vitest cases in `wallGrid.test.js`, including explicit
  regressions for every bug in §14.5 and a 500-operation randomised fuzz that
  asserts the invariants after each step.
- **Regression vs the §4.5 baseline:** backend went 27 → 25 failures with
  **zero new failures** (the two that flipped green are order-dependent flakes).
  Frontend keeps its single pre-existing `mergedIrAvailability` failure and
  gains nothing new.
- **Not yet verified:** real touch drag/resize on a physical panel, an overnight
  soak, and anything requiring a reachable Home Assistant (the dev machine has
  none, so device commands were exercised through the hub and observed failing
  at the HA hop — which did confirm the optimistic-rollback path).
