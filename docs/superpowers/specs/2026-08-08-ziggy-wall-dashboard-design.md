# Ziggy Wall Dashboard — Design

**Date:** 2026-08-08
**Status:** Approved design, pending implementation plan
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

- New wall dashboard replacing the entire `/hub` UI
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

## 4. What is kept and what is deleted

**Kept — backend, extended not replaced**

- `backend/routers/dashboard_router.py` — pair-code, claim, heartbeat, layout GET/PUT
- `services/dashboard_layouts.py`, `services/dashboard_tablets.py`
- The `/hub` route path, so already-deployed tablets keep working without re-pairing

**Kept — frontend, reused as-is**

- `stores/deviceStore.js` (rooms, entities, groups, `pinnedShortcuts`, `roomsOrder`)
- `stores/automationStore.js`, `stores/taskStore.js`, `stores/uiStore.js` (theme)
- `hooks/useWebSocket.js` — module-level singleton, reconnect, subscription filters, `_msgSeq`
- `lib/i18n/` (`he.js`, `en.js`, `useT`), `lib/api.js`, `lib/deviceIcons.jsx`
- `components/PairingWizard.jsx` + config-flow components
- `components/automations/*`

**Deleted**

- `components/hub/sections.jsx`, `LayoutRenderer.jsx`, `EditOverlay.jsx`,
  `SectionConfigSheet.jsx`, `Hub.css`
- `pages/Hub.jsx` body
- `stores/hubStore.js` section model (replaced by `wallStore.js`)

## 5. Architecture

### 5.1 File layout

```
frontend/src/pages/Wall.jsx              route shell, mounted at /hub, outside AppShell
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

The tablet record (`services/dashboard_tablets.py`) gains:

```python
capabilities: dict   # lights, climate, media, scenes, lists, cameras,
                     # locks, automations, devices, settings -> bool
pin_hash:     str | None
pin_required: list   # capability names requiring PIN, e.g. ["locks","cameras","settings","devices"]
```

Configured from **Settings → Tablets** on a phone by an admin.

**Enforcement is server-side.** `claim` issues a long-lived **tablet-scoped
token** representing a tablet principal, not a user. `auth_deps` resolves that
principal and checks the requested capability. A capability the tablet lacks is
rejected at the API, not merely hidden in the UI.

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
| Existing v1 layouts in the DB | v1 `sections` payloads are ignored; tablet is seeded with the default v2 layout on first load |

## 13. Implementation phases

1. Foundations — `wallGrid.js` + tests, `wallStore.js`, route shell, token/`--inverse` work
2. Rail + live control — Rooms rail, optimistic control, connection state
3. Grid + edit mode — drag, resize, reflow, picker, per-tablet persistence
4. Modules on existing data — Ziggy, Scenes, Pinned, Weather, Cameras, Tasks, Alerts, Media, Modes
5. New backends — lists + agenda, routers, WS types, bridge allowlist, modules
6. Security — tablet principal, capabilities, PIN gate, Settings → Tablets UI
7. Parity — device modal + pairing, automations tab
8. Idle + AOD, burn-in, soak
9. On-hardware validation at Canary
