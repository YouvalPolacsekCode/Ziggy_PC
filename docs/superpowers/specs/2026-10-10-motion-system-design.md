# Ziggy Motion System — Phase 3 design

**Date:** 2026-10-10
**Status:** Approved picks (45 of 50 lab concepts decided by the operator on 2026-10-10, 14:41–15:00); implementation authorised ("go").
**Branch:** `feat/motion-lab` (worktree off `origin/main` @ `e44e163`). Phase 1 findings: `docs/motion-lab/findings.md`. Phase 2 lab: `frontend/src/lab/` (`/motion-lab`).
**Decisions source:** artifact db `https://claude.ai/artifact/8LES8JcHSjKnK1nYHZ5Zj1`, collection `decisions` (one doc per demo id). Copied verbatim into §3 so this document stands alone.

## 1. What this is

The lab proved 183 variants of 50 interactions on realistic Ziggy content. The operator picked one variant per interaction. Phase 3 ports the **picked** variants into the real components, and nothing else. The lab stays where it is (dev-only route, `?lab=on` in prod) as the reference implementation; it is not imported by the app.

The thesis the picks follow, stated once: **motion should explain the change, not decorate it.** An object moves or morphs into its next state; "old fades out, new fades in" is the fallback, never the first choice.

## 2. Non-negotiables (carry into every task)

1. **Rollback stays honest.** Every addition is scoped under `<html data-motion="on">` (CSS) or behind `isMotionOn()` / `useMotionOn()` (JS). With `?motion=off` the app must render the DOM and styles it renders today. New components that replace a today-element (e.g. a rolling number replacing a `<span>`) render exactly today's markup when motion is off.
2. **Page transitions get a second kill switch.** Two previous page-exit attempts black-screened the app (`AppShell.jsx:306-333`). The iOS push lands behind `data-motion-pages="on"` resolved exactly like `flag.js` (`?pages=off` → localStorage `ziggy_motion_pages` → default on), so a home can drop page transitions without losing the rest of the layer.
3. **Transform / opacity / clip-path / filter only.** Layout animation is allowed in exactly the places the layer already allows it (disclosure) plus the four this spec adds: the banner push (§3 Feedback), the controls-span FLIP (§3 Devices), the tab-body container height under the blur crossfade (§3 Pages), and the bottom bar's own height when it condenses (§3 Navigation; a fixed element, so nothing else reflows).
4. **Exits faster than entrances. Never ease-in.** A loop must mean "true right now" (occupied breath, mic open, radar scanning) and must stop under reduced motion.
5. **Reduced motion keeps colour and opacity.** Travel, scale, blur and loops go; opacity/colour transitions stay at ≤ 160 ms. The global `!important` clamp in `index.css` is scoped to the motion-off tree so the layer's own policy applies when the layer is on.
6. **Hebrew is a first-class direction.** Every travel reads logical (`inline-start`), rolling digits and sparklines are `dir="ltr"` islands, and every task is checked in RTL.
7. **Nothing fabricates data.** The origin cue needs a real origin from the hub (§4). The scene-run wave needs the real affected-entity list (§4). Confidence count-up animates the number the backend sent. If the data is missing the element renders as today.
8. **Backend changes are additive** and reach customers only through `./scripts/ship.sh`. This branch merges to `main` and ships as one tag after a Canary soak (§7).

## 3. The picks

Format: *demo id* → **variant** (knob values the operator left set). "today" means the pick is the current behaviour; nothing is built for it.

### Navigation
- `nav-active` → **H Depth** (duration 0.45 s, bounce 0.18, stretch 0.6). Phone bottom nav gets an active surface that travels between tabs with a stretch along the travel axis and a depth cue; the icon/label swap rides it instead of cutting. Lands in `BottomNav.jsx` (today `NAV_HL_SURFACE = null`).
- `more-menu` → **C Fan out** (0.32 s, bounce 0.12, stagger 0.04). The More popover's items fan out from the More tab's centre, each 40 ms apart; close is a fast reverse. Lands in `BottomNav.jsx` + `motion.css`. **Constraint:** no `AnimatePresence` around the popover (cold-start stall trapped taps once); exit is a CSS class with a timeout fallback.
- `nav-scroll` → **B Condense** (operator note: *"but add more padding up top"*). Scrolling down condenses the chrome instead of tucking it away; the condensed state keeps more top padding than the lab showed. Lands in `gestures.js useScrollChrome`, `BottomNav.jsx`, and the page header rules in `motion.css`.
- `sidebar` → **C Accent bar** (0.4 s, bounce 0.1). Desktop sidebar active indicator becomes an accent bar on the inline-start edge that slides between items; icon colour follows it. Lands in `Sidebar.jsx NavGroup` + `motion.css`.

### Cards
- `card-expand` → **C Layered depth** (0.42 s, bounce 0.18, stagger 0.05). The open anomaly/suggestion card lifts, siblings recede, inner rows arrive 50 ms apart. Lands in `Anomalies.jsx`, `SuggestedTab.jsx` / `Suggestions.jsx`.
- `list-remove` → **E Absorbed by the count** (0.4 s). A removed card shrinks toward the count that absorbs it (header count / stat strip) and the count rolls. Lands in `Tasks.jsx`, `Anomalies.jsx`, suggestions. Requires optimistic removal before the refetch.
- `resort` → **A Instant (today)**. Room tiles keep re-sorting without animation.
- `travel` → **B Shared layoutId travel** (0.5 s). A task ticked done travels from To do to Done; an anomaly changing severity travels between sections; a suggestion travels Pending → History. One `LayoutGroup` per page around both lists; `layoutId` per item.

### Devices
- `origin` → **C Bulb rays draw** (0.6 s). When a device changes from outside Ziggy (wall switch, HA automation, physical remote) the icon draws rays once. Needs the hub to say the origin (§4).
- `pending` → **B Ring → check / cross**. A command in flight draws a ring around the control; the hub's answer turns it into a check (or a cross on failure) which then dissolves. Replaces the `data-pending` breath on controls that have a focal element; the breath stays for surfaces without one.
- `card-controls` → **B Span + FLIP siblings** (0.42 s). "Show controls" spans the card across the grid row and the siblings FLIP around it. Lands in `Devices.jsx` expanded surface + grid.
- `icon-morphs` → **A Play/Pause · Lock · Blinds · Fan**. Four glyphs morph between states instead of swapping. One `IconMorph` component; lands in every Play/Pause, Lock/LockOpen, cover and fan glyph site.
- `sheet` → **B Page peeks beneath** (peek 0.72, elastic 0.12). While the device sheet is up, the page beneath recedes (scale + dim) proportionally to the drag; promotion returns it to 1. Lands in `SheetSurface.jsx` backdrop painting.

### Rooms
- `occupancy` → **D Presence arrives / leaves** (breath 3 s). The occupancy mark arrives (scale + opacity from the tile corner) and leaves (reverse, faster); while occupied it breathes on a 3 s loop (`data-motion-live` finally wired). `unknown` renders nothing, as today; `false` renders nothing, as today.
- `environment` → **B Number glides + corner wash**. Temperature/humidity values glide (spring) to the new number; a tint wash sweeps the chip from the corner when the band (cold/neutral/hot) changes.
- `longpress` → **B Progress ring + cascade** (cascade 0.07). Long-pressing a room draws a progress ring under the finger; on commit the room's lights cascade 70 ms apart (the tile's count rolls as they land).
- `status` → **C Only the word changes**. In "3 rooms active" / "All quiet" and the tile status line, only the changed token animates (roll for numbers, crossfade-slide for the word); the rest of the sentence stays put.

### Controls
- `toggle` → **A Linear slide (today)**.
- `power` → **B Ignition (today)**.
- `brightness` → **B Light well + room glow** (grow 10). The brightness well grows under the finger (10 %) and the surrounding card glows with the light's tint at the current level.
- `temperature` → **A Rolling digits** (0.4 s). The target temperature rolls digit-by-digit on ▲/▼.
- `segment` → **C Icon morph hero** (0.36 s, bounce 0.14, in-out). Mode segments (AC Cool/Heat/Fan/Off) morph the hero icon between modes as the selection pill moves.
- `hold-delete` → **A Clip-path fill** (hold 1.2 s). Destructive confirms become hold-to-confirm: the button fills via clip-path over 1.2 s, commits on completion, snaps back on release. Replaces the two-tap confirm; confirm dialogs keep their dialog but their Remove button becomes the hold button.

### Feedback
- `toast` → **D Morphing button (no toast)** (0.45 s). A button that caused an action becomes the feedback: label → "Running…" with a ring → "Done" with a check (or the error with a cross) → back. Toasts are no longer raised for button-caused outcomes. Toasts remain for everything without a button (WS failures, remote events, execution results from automations the person did not just press). Toast exit becomes faster than enter and siblings `layout`.
- `banner` → **B Push + Back online**. Connection/health banners push the page down (layout) instead of snapping, and offline resolves through a green "Back online" beat (i18n `status.backOnline` exists) before leaving.
- `empty` → **A Swap (today)**.
- `loading` → **D Scan and settle**. Skeletons carry one scan line; when data arrives the skeleton settles into the content (crossfade in place, no pop). One `Skeleton` component replaces the hand-rolled grey blocks.
- `confirm` → **A Centred dialog (today)**.
- `success` → **C Ring bloom**. The success moment (onboarding done, device found, IR walk done) draws a ring that blooms outward and leaves the check.

### Data
- `readout` → **B Rolling digits**. Numeric readouts roll (sensor hero, metric pills, state rows, brightness % mid-scrub, power W, humidity).
- `sparkline` → **A Draw + live append**. The sensor history path draws once; a new point appends by extending the path.
- `bars` → **A Glide + stagger**. Battery/signal/volume bars glide to their value, bars 30 ms apart.
- `confidence` → **B Count-up + dots + bar**. The confidence meter counts up to its %, dots fill in sequence, the bar follows.
- `counts` → **A Roll + pop**. Header counts roll and pop once on change.
- `cooling` → **keep today**.

### Pages
- `push` → **B iOS parallax push** (0.42 s, bounce 0, parallax 0.3). Forward: new page slides in from inline-end while the old page moves 30 % and dims. Back: reverse. Both pages mounted and absolutely positioned inside one `AnimatePresence` **without** `mode="wait"`; direction from `history.state.idx` as today.
- `tabs` → **C Blur crossfade** (0.26 s). Tab bodies cross-fade with a 4 px blur instead of a hard swap (DeviceDetail Controls/Info, Actions Automatic/On-demand).
- `promote` → **keep today**.
- `swipe-back` → **C Rubber-band edge** (parallax 0.3). Swipe-back shows the previous page beneath at 30 % parallax and rubber-bands past the edge.

### Moments
- `onboarding-steps` → **B Slide + dots grow** (0.4 s). Steps slide (direction-aware), the step dots grow into the current one (reuse `StepDots` from the automation wizard).
- `pairing` → **B Radar + blip lands**. Pairing shows a radar sweep; a found device lands as a blip and expands into the "Device found" banner.
- `chat-thinking` → **keep today**.
- `scene-run` → **B Wave from the bedroom** (cascade 0.16). Running a routine/automation waves through the affected rooms in order, 160 ms apart, each tile acknowledging as its devices change. Needs the ordered affected-entity list (§4).
- `ziggy-pill` → **B Pill opens into a card**. The chat status pill (and the proactive "Ziggy says" pill) opens into its card with a shared-layout expansion rather than a swap.

### Experimental
- `ambient` → **keep today**. `exposure`, `orb`, `rewind`, `parallax`, `breeze` → **undecided; not built.**

## 4. Architecture decisions

| Decision | Choice | Why |
|---|---|---|
| Engine | **Stay on `framer-motion` 11** for Phase 3. The `motion` 13 upgrade is a separate follow-up PR. | Every lab variant was judged on 11; 40 production importers; a rename is mechanical but belongs in its own diff. |
| GSAP | Used only where the lab used it (icon morph paths, if the lab did). Otherwise not imported by production code. | Keep one engine on the hot path. |
| Tokens | **One JS vocabulary in `src/lib/motion.js`**: `DUR {press .12, micro .16, fast .2, base .26, slow .4}`, `EASE {out [0.23,1,0.32,1], glide, inOut, drawer, standard}`, `SPRING {snappy, gentle, calm, press, detent, gesture}`, and the existing `T_*`/`FADE*` presets re-expressed on them. `src/motion/motion.js` imports and re-exports these (keeps haptics, reduced-motion, velocity helpers). `index.css` gets `--ease-out-strong`, `--ease-in-out`, `--ease-drawer`, `--dur-fast/base/slow`; `--ease-enter` is set to the strong ease-out so CSS and JS agree. | Two files with two curves is finding §3.2. |
| Dead exports | Delete `safe`, `onReducedChange`, `useSheetDetents`, `pageEnterProps`. Keep `setMotion` (documented as the Settings hook). `DataState` is rewritten as the `Skeleton`/`DataState` pair (loading pick) and adopted; `uiStore.toastError` is kept and used by the morphing button's error path. | Finding §3.6. |
| Reduced motion | `index.css` clamp becomes `html:not([data-motion="on"]) *, …` so rollback is unchanged under reduced motion; `motion.css` owns the policy when the layer is on. Every new rule in this spec ships with its reduced-motion counterpart in the same task. `.animate-pulse`/`.z-pulse` stop under reduced motion with the layer on. | Finding §3.1. |
| Page transitions | `PageTransition` component in `src/motion/`: both pages absolutely positioned in a relative `<main>` child, `AnimatePresence initial={false}` with **no** `mode`, `popLayout` off, exit faster than enter; the outgoing page is `inert` and `pointer-events: none`. Direction from `enterBack` (unchanged). Kill switch `data-motion-pages`. Must be tested against the two historical triggers: a WS reconnect storm mid-transition and a cold lazy-chunk load. | Finding §6. |
| Shared-element travel | `LayoutGroup` **per page**, never above the router. The room morph stays a FLIP. | Mixing approaches is the trap; per-page groups avoid it. |
| Numbers | `RollingNumber` (digit columns, `dir="ltr"` island, `pop` option) and `GlideNumber` (`useSpring`+`useTransform` on a `motion.span`, off the render loop). Both render a plain `<span>` with the formatted value when motion is off or reduced. | Finding §2 "nothing interpolates". |
| Origin cue | `services/ha_subscriber._process_event` adds `"origin": "ziggy" \| "external"` to the `state_changed` broadcast, computed from `manual_overrides.was_ziggy_initiated(entity_id) or was_recent_ziggy_write(entity_id)` **before** the broadcast (both are pure reads of in-memory tables). Frontend `updateEntityState(entity_id, state, attributes, meta)` stores `_originAt`/`_origin` on the entity; the icon reads it for one render. | The only new backend field. |
| Scene-run wave | The `execution_result` WS event already carries per-step outcomes; the wave uses the step order to animate the affected rooms. If the payload lacks entity ids the wave is skipped. | No fabrication. |
| Morphing button | `Button` gains `status: 'idle' \| 'running' \| 'done' \| 'error'` and `useActionStatus(fn)` returns `{run, status}` with a 1.2 s hold on done/error. Call sites replace `addToast(success)` with the status; the error path still calls `toastError` **and** shows the cross. | One primitive, five call sites. |
| Haptics | Unchanged (`navigator.vibrate`). `@capacitor/haptics` is not in scope of the picks. | Surface as a follow-up. |
| Performance | Blooms, rays, glow: capped to the one element that changed. FLIP siblings: armed by intent (existing 900 ms arm). `will-change` set just before, cleared after. Hover only under `(hover:hover) and (pointer:fine)`. | Finding §5. |

## 5. File structure

New under `frontend/src/motion/`:
- `pages.js` — `data-motion-pages` flag (same shape as `flag.js`).
- `PageTransition.jsx` — iOS parallax push + back; swipe-back parallax reads it.
- `TabCrossfade.jsx` — blur crossfade for tab bodies.
- `RollingNumber.jsx`, `GlideNumber.jsx` — numbers.
- `PendingRing.jsx` — ring → check / cross.
- `IconMorph.jsx` — play/pause, lock, blinds, fan.
- `MorphButton` lives in `components/ui/Button.jsx` (status prop) + `hooks/useActionStatus.js`.
- `RingBloom.jsx`, `Radar.jsx`, `Skeleton.jsx`, `HoldButton.jsx`, `LongPressRing.jsx`.
- `motion.css` gains one section per pick, each with its reduced-motion counterpart.

Modified production files (by phase): see the plan. Tests live beside the code in `__tests__/` (vitest + jsdom + testing-library; `MotionConfig reducedMotion="never"` in tests that assert on motion props, `data-motion` set on `document.documentElement` in a `beforeEach`).

## 6. Implementation order

Five plans, one per phase, each merged to `main` on its own so Canary soaks each one:

- **A. Foundation + Navigation + Pages** — tokens, reduced-motion scope, pages kill switch, bottom nav depth, More menu fan-out, condense on scroll, sidebar accent bar, page push + swipe-back parallax, tab crossfade. (`docs/superpowers/plans/2026-10-10-motion-a-foundation-nav-pages.md`)
- **B. Devices + Rooms** — `PendingRing`, `IconMorph`, `GlideNumber` primitives; sheet peek, controls span, pending ring wiring, icon morphs, origin cue (backend + frontend), occupancy presence, environment glide, long-press ring + cascade, status word.
- **C. Cards + Feedback** — `Button` status + `useActionStatus`, `Skeleton`, `RingBloom`, `HoldButton` primitives; layered depth, absorbed-by-count, layoutId travel, morphing button call sites, banner push + back online, skeleton scan, ring bloom, hold-to-delete.
- **D. Controls + Data** — `RollingNumber` primitive; light well + glow, temperature roll, segment icon hero, readouts, sparkline, bars, confidence, counts.
- **E. Moments** — onboarding slide + dots, pairing radar, scene-run wave, Ziggy pill card.

Plans B–E are written when their phase starts, on top of the interfaces A lands.

## 7. Gates before a release tag

1. `cd frontend && npx vitest run` green except the one pre-existing failure (`mergedIrAvailability.test.js`, untouched).
2. `npm run build` green; the `/motion-lab` chunk is not in the main bundle graph.
3. Crawl every route in light/dark × LTR/RTL × motion on/off × reduced on/off with zero console errors.
4. **Motion-off equivalence:** screenshots with `?motion=off` match the pre-branch build (the SSIM check `flag.js` describes).
5. **Page-transition trap test:** navigate while the WS flaps (kill/restore the backend) and on a cold lazy route; no page may remain at `opacity: 0` or off-screen.
6. **Thumb test on a phone** by the operator (the gate that nothing in the layer has ever passed). Hebrew included.
7. Merge to `main`, `./scripts/ship.sh`, Canary converges (allow ~5 min + ~12 min rebuild), fleet health shows no drift.

## 8. Out of scope (said so nobody looks for it)

The five undecided Experimental concepts; the `motion` 13 upgrade; Capacitor haptics; the wall dashboard (`/wall`) and ops console surfaces; the unrouted home map; the marketing site.
