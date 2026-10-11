# Motion Lab — Findings (Phase 1 synthesis)

Investigated: `origin/main` at `e44e163` (2026-09-26/27). Seven mapping passes
over the frontend plus a research pass on current Motion / GSAP / platform
capabilities. Detailed maps with file:line references are in `investigation/`.

## 1. What Ziggy already has

A **motion layer** (`frontend/src/motion/`, 2,665 lines) shipped fleet-wide on
2026-09-12, gated on `<html data-motion="on">`, default ON, `?motion=off` is
the rollback. It is CSS-driven through data attributes, with three JS engines
(a delegated press layer, a WAAPI FLIP for the room morph, framer-motion for
the sheet). It provides:

- press scale on every tappable thing (0.97 / 0.985, 160 ms)
- state colour crossfade 160 ms off / 220 ms on, plus a 360 ms 6% icon "ignition"
- page enter (340 ms rise) and back (260 ms 1.2% scale); **no exit anywhere**
- 35 ms stagger capped at 8; disclosure fold via `grid-template-rows`
- room tile → room hero FLIP (560 ms in / 460 ms back)
- device sheet with 72% / 100% detents, velocity projection, backdrop follows
  the drag, 120 ms hold + 160 ms dissolve when promoted to the page
- swipe-back (30% or 500 px/s), scrub-to-dim (5% haptic ticks), long-press (480 ms)
- haptics via `navigator.vibrate` (silent on iOS and desktop)

The README of that layer is honest and good. The lab builds on it.

## 2. What changes state, position, hierarchy, importance or context today with no motion

**State**
- Every number: brightness %, °C, humidity, W, battery %, position %, volume,
  counts, countdowns. No `useSpring`, `useMotionValue` or count-up anywhere in
  the device, room or dashboard views.
- Occupancy: a chip appears only when `occupied === true`; `false` and `null`
  render identically; the chip mounts with no transition. `data-motion-live`
  (a breathing dot) was specified and never emitted.
- Temperature chip tints jump between neutral / info / err at 18° / 25°.
- Glyph swaps: Play/Pause, Lock/LockOpen, Volume/Mute; the bulb glyph is the same
  asset on and off.
- Tab content (Controls / Info on a device; Automatic / On-demand on Actions)
  is a hard subtree swap; the pill slides, the content does not.
- Battery bar width, signal bars, volume bars, the climate `Dial` arc and the
  `PresetGauge` fill have no transition.

**Position**
- Rooms re-sort active-first on every state change; tiles jump (Dashboard.jsx:1146).
- "Show controls" inside a device card animates its own height while every
  card below it jumps.
- Group open / close does not FLIP the groups beneath.
- Banners (connection, health, subscription gate, unassigned, attention) enter
  or cut in, and are removed with `return null`; sticky ones reflow the page.

**Hierarchy / importance**
- An "on" device carries no more visual weight than an "off" one beyond tint.
- The open anomaly / suggestion card does not lift; siblings do not recede.
- Nothing promotes an active or alarming device.

**Context**
- A task ticked done, an anomaly changing severity, a suggestion actioned: two
  separate `AnimatePresence` trees, so exit + enter, never a travel.
- The phone bottom nav has **no active indicator** (`NAV_HL_SURFACE = null`);
  the active tab changes stroke, colour and weight in one frame.
- The More menu enters with a 200 ms scale and closes as a cut (deliberately,
  after an AnimatePresence stall trapped taps on cold start).
- The wide-screen chat dock (400 px) mounts and unmounts as a hard cut.
- Onboarding: every step advance in both wizards is a hard cut; the success
  moment is a static check disc.
- Chat: the thinking dots vanish in one frame as the reply lands; the thread
  drawer, status pill, rehearsal banner and quick-ask row all cut.
- Bundle preview → applying → results → undone: four card bodies, all cuts.
- Local and remote device changes look identical; the only origin cues in the
  app are IR-specific.

## 3. Structural problems found

1. **A global reduced-motion clamp defeats the layer's own policy.**
   `index.css:718` sets `*, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important }`.
   It outranks every "keep colour and opacity, drop travel" rule in
   `motion.css` and `controls.css`. Reduced motion today is *remove*, not *reduce*.
2. **Two token files, two strong ease-out curves.** `motion/motion.js`
   (`EASE`, `DUR`, `SPRING` — never imported) and `lib/motion.js`
   (`T_STATE`, `T_ENTER`, `SPRING_SHEET`). `CSS_EASE.out` is (0.23, 1, 0.32, 1);
   `--ease-enter` / `--m-out` is (0.16, 1, 0.3, 1).
3. **Toast exit is as slow as its enter** (240 ms both), against the layer's own rule.
   Modal panels and backdrop: same duration in and out.
4. **Five optimistic-update strategies coexist** for device commands; only the
   wall has a real snapshot + rollback pair. `data-pending` breathing is
   applied to some surfaces and not others.
5. **`Actions.jsx` wraps a plain `<div>` inside `AnimatePresence popLayout`**,
   so its card exits do nothing.
6. **Dead motion code**: `useSheetDetents`, `pageEnterProps`, `setMotion`,
   `setHaptics`, `safe()`, `onReducedChange`, `DataState`, `uiStore.toastError`.
7. **Haptics never reach iOS**: `navigator.vibrate` only; `@capacitor/haptics`
   is not used. `heavy`, `success`, `warning`, `error` patterns are defined
   and never called.
8. **A cold visit to a lazy route** plays the page-enter on an empty 60 vh
   placeholder; the real content then pops in without motion.
9. **Stale constants**: two comments compute the chat-dock breakpoint against a
   "196 px sidebar"; `--sidebar-w` is 240 px.

## 4. The principle the lab follows

Motion communicates **continuity, causality, hierarchy, state and physical
relationship**. Prefer an object moving or morphing into its next state over
"old thing fades out, new thing fades in".

- The thing you touched is the thing that moves.
- Effects follow causes in time (thumb first, then the circuit; surface first,
  then the content; ring while waiting, check on the answer).
- Importance has weight; siblings recede.
- Numbers roll or glide; glyphs turn into their next self.
- Detail is beside the list, the sheet is below the page, Done is below To do.
- Springs for what the finger drives; tweens for what the system decides.
  Exits faster than entrances. Never ease-in.
- Frequent interactions get little or no motion. One earned ambient loop
  (occupied = "true right now"). Reduced motion keeps colour and opacity.

## 5. Proposed architecture (for Phase 3, after approval)

| Decision | Recommendation |
|---|---|
| Engine | Upgrade `framer-motion ^11` → `motion ^13` (`motion/react`). No breaking changes for this app; React 18 supported. Gains Reorder RTL, faster spring retarget, accelerated `useScroll`. |
| GSAP | Keep `gsap` + `@gsap/react` (free, all plugins) **only** for MorphSVG path morphs, Flip for DOM-reparenting morphs, and labelled timelines. Motion remains the primary engine. |
| Tokens | One vocabulary: durations press 120 / micro 160 / fast 200 / base 260 / slow 400; one strong ease-out (0.23, 1, 0.32, 1), one in-out (0.77, 0, 0.175, 1), the drawer curve (0.32, 0.72, 0, 1); springs snappy `{duration .32, bounce .08}`, gentle `{.5, .12}`, gesture `{stiffness 400, damping 30, mass .8}`. Delete the unused exports. |
| Reduced motion | Replace the `!important` clamp with the layer's policy: transforms and loops off, opacity / colour on at ≤160 ms. `MotionConfig reducedMotion="user"` already does this for framer; CSS must match. |
| Page transitions | Both pages absolutely positioned inside one `AnimatePresence` **without** `mode="wait"`; that is the configuration that never stalls. Shared-element travel needs a `LayoutGroup` above the router. React Router 6.27's `viewTransition` is a cheap crossfade option for iOS 18+ / Chrome 111+. |
| Sheets | Keep `SheetSurface`; Vaul is unmaintained; Base UI Drawer is the off-the-shelf alternative if a rewrite is ever wanted. |
| Numbers | `useSpring` + `useTransform` on a `motion.span` (off React's render loop). NumberFlow declares Hebrew / RTL unsupported; the lab's 20-line rolling digit works inside a `dir="ltr"` island. |
| Origin cues | The WS `state_changed` event must carry an origin (HA `context.user_id` / `parent_id`). Small backend change. |
| Haptics | `@capacitor/haptics` with explicit styles: selectionChanged for scrubs, impact Light for toggles, Medium for detents, Heavy for destructive confirms, notification Success / Error for outcomes. |
| Performance | Transform / opacity / clip-path / filter only, plus two deliberate layout animations (disclosure, banner push). No `transition: all`. Hover only under `(hover:hover) and (pointer:fine)`. Blooms and dimmed siblings capped to small sets. `will-change` set just before, cleared after. |

## 6. Risks and constraints

- **The exit handshake trap is real.** Two previous attempts at page exits
  black-screened the app. Every lab variant avoids `mode="wait"` and keeps
  both pages mounted and positioned; still, the integration must be tested on
  a WS-reconnect storm and a cold lazy-chunk load, which were the triggers.
- **`layoutId` across routes** needs the router and both screens under one
  `LayoutGroup`; the app chose a FLIP to avoid exactly this. Either approach is
  fine; mixing them is not.
- **The device sheet's detents depend on `height`, not `max-height`** on the
  panel (recorded trap). The "tile becomes the sheet" concept must keep that.
- **Two ambient loops are proposed** (occupied pulse, AC breeze). Both mean
  something ("true right now", "air is moving"); both stop under reduced motion.
- **The Sonner-style toast stack** and the origin-aware toast both need the
  toast store to expose ids and the originating element; today it exposes
  neither.
- **Hebrew**: every prototype was checked in RTL. The rolling digit and the
  sparkline are LTR islands by design.
- **Never thumb-tested.** Like the shipped layer, nothing here has been held
  by a human on touch hardware. That is the gate before any approval becomes
  a release.
