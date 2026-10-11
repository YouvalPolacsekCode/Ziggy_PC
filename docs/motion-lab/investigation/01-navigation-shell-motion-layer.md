# Navigation, shell, page transitions and the existing motion layer (origin/main e44e163)

## 1. Route table

All routes in one `<Routes>` at `App.jsx:598-716`, rendered with `location={sheet ? sheet.background : location}`.

Inside `<AppShell>` (`App.jsx:600-655`): `/` Dashboard (**eager**) · `rooms` RoomsList · `rooms/:roomId` RoomDetail (morph destination) · `devices` · `devices/:entityId` DeviceDetail (chunk hand-warmed while a sheet is open, `App.jsx:426-429`) · `remote/:irId` · `ir-walk/:deviceId` · `actions` · `routines` · `chat` · `tasks` (feature-gated) · `settings` + `settings/{display,account,notifications,location,people,ziggy,wall,music}` · `alerts` · `suggestions` · `cameras`. 21 `<Navigate replace>` redirects (`:610-651`, `:711-715`). Boot-time URL rewrite `App.jsx:1341-1352` via `lib/bootRedirect.js`.

Outside AppShell (no nav, no page-transition wrapper): `wall`, `mobile-onboarding`, `mobile-diagnostics`, `ops/*` (role guard, `OpsPageWrapper` with its own Suspense), pre-router `/welcome*` (MarketingSite), `/invite/*`, unauthenticated → `UnauthenticatedGate`.

**Sheet-over-background-location**: only `/devices/:entityId` (`_DEVICE_ROUTE_RE`, `App.jsx:313`). `useDeviceSheet()` (`:342-372`) decides during render, memoised on `location.key|motionOn`; presents only when entityId matched AND motionOn AND `navType === 'PUSH'` AND a prevLoc exists with a different pathname AND the entity is in the store. Sheet render `:725-750` in its **own** Suspense. Trailing sheet: `_TRAIL_MS = 340`, modes `'close'` (`navigate(-1)`) and `'promote'` (`navigate(samePath, {replace:true})`). Design note `:286-339`.

## 2. How navigation works

Both navs are always mounted; visibility is CSS breakpoint. Sidebar `hidden md:flex` (`Sidebar.jsx:141`), width `--sidebar-w` 240px (two comments still say 196px). BottomNav `fixed bottom-0 md:hidden` (`BottomNav.jsx:307`), `ROW_H = 56`.

**Phone**: `PRIMARY_TABS` `/`, `/rooms`, `/devices`, `/actions` + `MoreTab` (`/alerts`, `/tasks`, `/settings`). No Ziggy tab; the FAB is the way to chat. Active = `pathname.startsWith(to)`. **Active indication = three inline swaps, no animation**: `ZIcon stroke 1.6→2`, colour, label weight (`BottomNav.jsx:74-79`), SVG attributes so not transitionable. **No indicator animation**: `NAV_HL_SURFACE = null` (`:140`, rationale `:127-139`); the highlight element `:354-369` never renders; the measurement machinery survives only to compute `moreOriginX`. `haptic('light')` on tap (`:71`, `:375`). Tuck: `data-motion-nav` + `data-tucked`, gated by `motionOn && tucked && !overlayOpen && !showMore && connected !== false`; `useOverlayOpen` is a MutationObserver for `[role=dialog], [role=alertdialog], [data-motion-sheet]`. Glass `BAR_BG = color-mix(--bg 92%)` + `blur(20px)`.

**Desktop**: `PRIMARY` `/`, `/rooms`, `/chat`, `/devices`, `/actions`; secondary `/alerts`, `/tasks`, `/settings`; `/ops` footer (outside NavGroup, never highlighted). `NavGroup` (`Sidebar.jsx:56-118`) measures the active cell and renders `data-motion-nav-hl` with `translate3d(0, y, 0)`; animated by `motion.css:274-276` (`transform/width/height 320ms var(--m-out)`); hand-over blanks `.z-nav-item.active` background while the highlight is live (`motion.css:283-289`). Reduced motion: no travel, 160ms opacity. Icon stroke/colour still cut (`Sidebar.jsx:44`).

Navs call `useLocation()` from inside the background-location `<Routes>`, so the active tab correctly does not move while a device sheet is up.

## 3. Page transition system

Wrapper (`AppShell.jsx:334-336`): `{motionOn ? <div data-motion-enter={enterBack ? 'back' : true} key={location.pathname}>{routed}</div> : routed}`. **Enter-only; no exit, no AnimatePresence, no handshake**; rationale `:306-333` (two failed attempts: `mode="wait"` → pages stuck at opacity 0; no mode → both pages in flow, blank viewport). Attribute keeps a value because `morph.js:196` does `el.closest('[data-motion-enter]')`.

Direction: `historyIdx()` (`AppShell.jsx:35-40`) reads `window.history.state?.idx`; pinned per `location.key` (`:196-205`); `back = idx < prev`. `useNavigationType()` cannot be used here (see §8).

Forward (`motion.css:149-155`): `zm-page-in var(--m-dur-page) var(--m-glide) backwards` = opacity 0 + `translate3d(0, 8px, 0)` → none. Back (`:182-188`): `zm-page-back var(--m-dur-page-back) var(--m-out)` = opacity 0 + `scale3d(1.012, …)` → none; no travel by design (`:157-180`).

Tokens (`motion.css:24-52`): `--m-std` = `--ease-standard` (0.2,0,0,1); `--m-out` = `--ease-enter` (0.16,1,0.3,1); `--m-glide` (0.33,0.68,0.15,1); `--m-in-out` (0.77,0,0.175,1); `--m-drawer` (0.32,0.72,0,1); `--m-scale 1` (no writer); `--m-dur-press` 120; `--m-dur-ui` 240; `--m-dur-page` 340; `--m-dur-page-back` 260; `--m-dur-large` 560.

Gating (`flag.js`): `data-motion` on `<html>`; `?motion=on|1` / `off|0` → localStorage `ziggy_motion` → default ON; an explicit `?motion=` **sticks** (`:44-50`). SSIM 1.000000 on 12/13 screens vs the previous build. No on-screen toggle, no keyboard shortcut (the `m` binding was unsafe).

Reduced motion: `motion.js:54-77` mirrors `prefers-reduced-motion` to `data-motion-reduced`; CSS `motion.css:343-376`; JS gates in pressLayer, morph, gestures, SheetSurface; `<MotionConfig reducedMotion="user">` at `main.jsx:43`. **`index.css:718-720` is a global `!important` nuke** that overrides every nuanced rule in `motion.css`/`controls.css`.

## 4. The existing motion primitives

**4.1 Press layer** (`pressLayer.js`): delegated `pointerdown` capture; `PRESSABLE` = `button, [role=button], a[href], summary, label[for], checkbox, radio, [tabindex=0]` + `cursor: pointer`; `SKIP` includes `[data-no-press]`; refuses >55% viewport area and elements already owning a transform; ancestor walk depth 6; writes `data-pressing="sm|lg"`; CSS `motion.css:58-70` `transition: transform 160ms var(--m-out)`, `scale(0.97)` / `scale(0.985)`. Haptic layer: `[role=switch], checkbox, [aria-pressed], [data-haptic]` → `haptic(light)` on the way down.

**4.2 State arrives** (`motion.css:79-108`): `[data-on]` transitions background/color/border/shadow 160ms `--m-out`, 220ms when `data-on="true"`; `[data-on="true"] [data-motion-icon] { animation: zm-ignite 360ms }` keyframes `scale(0.94) → 1.06 @60% → 1`. Pending: `zm-pending 1.1s infinite` opacity 1→0.62→1. Emitters: `DeviceCard.jsx:452,538,663`, `Dashboard.jsx:330`, `Devices.jsx:994,1226,1913`, `ChatCards.jsx:458`. Generic surfaces `motion.css:115-131`. Toggle track 200ms / knob 220ms. Slider fill 140ms, killed while `data-scrubbing`. Stagger `zm-item-in` 10px rise, delays 0/35/…/240ms capped at nth-child(8), `backwards` never `both` (`:194-196`). Disclosure `grid-template-rows` 340ms open / 180ms close; `zm-reveal` clip-path 240ms; chevron rotate 200ms. `zm-breathe` 4s for `data-motion-live` — **emitted by nobody**.

**4.3 Room morph** (`morph.js`): FLIP across a route change, deliberately not `layoutId`. `FRESH_MS = 700`; `captureOrigin` / `captureOriginFromEvent` / `useMorphOrigin` (layout-effect cleanup) / non-destructive `peekOrigin` (StrictMode). `useMorphTarget(key, {contentRef, followRef, duration 560, returning})`: runs after every render, `useLayoutEffect`, skips tiny deltas, **cancels the page enter** on that wrapper, three WAAPI animations (hero transform only; content opacity+8px held to offset 0.26; follow 62% duration, 26% delay), `runId` guard. `useMorphReturn` 460ms back. Key namespaces `room:${id}` / `room-back:${id}`. Consumers: `Rooms.jsx:140-155`, `:1201-1212`, `Dashboard.jsx:434-441, 663, 759, 769-773`.

**4.4 Sheets** (`SheetSurface.jsx`, `DeviceSheet.jsx`, `sheet.css`): the app's one sheet; narrow bottom sheet / wide docked 320px panel (`WIDE_QUERY 768px`). framer owns `y`; `useSheetDetents` is dead. `FLICK 900`, `PROJECT 0.12`, `PAST_TOP_PX 60`, `T_HANDOFF {duration .16, delay .12}`, `closeDistance 120`, `closeVelocity 600`. Detents `stop = panelHeight - round(layerHeight * fraction)`; 0.01px `settle` alternation (`:188-194`). Drag end order: legacy dismiss → promote if past top → flick → `nearest(project(cur, v), [...stops, dismissAt])`. Backdrop `paintScrim` follows the drag. `SPRING_SHEET {stiffness 400, damping 30, mass 0.8}`. Handoff: `.z-msheet-handoff` holds solid 120ms then 160ms melt (a measured double-exposure fix, `sheet.css:126-141`). `DeviceSheet`: `DETENTS [0.72, 1]` (0.55 cut the control in half), `ELASTIC {top .12}`, peek = `<DeviceRemote>` only. `.z-msheet` must keep `height`, not `max-height` (`sheet.css:29-43`). Other consumers: `ChatSheet.jsx:52`, `Modal.jsx:24` (`sheet` prop, `[0.6, 1]`, 2 of 41 call sites). `data-motion-sheet` is emitted by nobody.

**4.5 Swipe-back** (`gestures.js:71-166`): `COMMIT_FRACTION 0.3`, `COMMIT_VELOCITY 500`, `EDGE 32`; wired `AppShell.jsx:216` on `DETAIL_RE` routes, not `/chat`; `<main>` moves; idempotency guard (a commit once went back twice); cleanup in `AppShell.jsx:247-254`.

**4.6 Scrub** (`gestures.js:269-320`): `|dy|>10 && |dx|<10` → scroll; `|dx|<6` → not yet; else `data-scrubbing` + `haptic(selection)` every 5%; `onCommit` on release. Consumers `DeviceCard.jsx:417-451` (dimmable lights, holds 600ms past commit), `Dashboard.jsx:244`, `Devices.jsx:1856`.

**4.7 Long-press** (`gestures.js:15-57`): 480ms, 8px cancel, `haptic(medium)`; `Rooms.jsx:140-147`, `Dashboard.jsx:434-441`.

**4.8 Scroll chrome** (`gestures.js:327-346`): 6px delta, `'down'` past 60px, always `'up'` at top; `scrolled` returned but unused.

**4.9 Haptics** (`motion.js:85-108`): `selection [6]`, `light [10]`, `medium [18]`, `heavy [28]`, `success [10,40,12]`, `warning [18,60,18]`, `error [24,50,24,50,24]`; `navigator.vibrate` only. `heavy`, `success`, `warning`, `error` never called.

**4.10–4.11 Token files**: `lib/motion.js` (`DUR_PRESS .12`, `DUR_STATE .2`, `DUR_ENTER .24`, `EASE_STANDARD`, `EASE_ENTER`, `SPRING_SHEET`, `T_*`, `FADE_UP`, `FADE`) and `motion/motion.js` (`EASE.out (0.23,1,0.32,1)`, `glide`, `inOut`, `drawer`, `std`; `DUR`; `SPRING snappy/gentle/calm/press/detent`). **`EASE`, `DUR`, `SPRING` are never imported**; `CSS_EASE.out` differs from `--m-out`.

**4.12 controls.css**: loaded twice on purpose (`@import` must stay at the top; attribute selectors doubled so order never matters). Held growth `scaleY(1.35)` track / `scaleY(1.12)` bar / `scaleX(1.045)` well, 130/160ms; thumb settle `left/right 140ms`; hover ring `0 0 0 3px var(--m-ring)` pointer-fine only.

## 5. framer-motion imports (41 files)

`main.jsx` MotionConfig · `SheetSurface.jsx` drag/AnimatePresence/useDragControls/useReducedMotion · `Modal.jsx` · `Toast.jsx` · `DeviceControls.jsx` · `ChatCards.jsx` · `Devices.jsx` (**heaviest**: 25 motion.div, 37 AnimatePresence, 9 popLayout, `layout={layoutArmed} layoutDependency`) · `Rooms.jsx` (Reorder) · `AIChat.jsx` · `Actions.jsx` · `Anomalies.jsx` · `Cameras.jsx` · `Tasks.jsx` · `Routines.jsx` · `Settings.jsx` · `Suggestions.jsx` · `VirtualDevices.jsx` · `Memory.jsx` · `People.jsx` · `QuickAsks.jsx` · `IrWalkWizard.jsx` · `HomeMap*.jsx` · `IRWizard.jsx` · `PairingWizard.jsx` (17 motion.div) · automations/* · `MarketingSite.jsx` (useScroll/useTransform) · marketing/*. **`layoutId` used nowhere. `useSpring` used nowhere.** `layout` only in `Devices.jsx:1209,1892`, armed by intent for 900ms.

## 6. CSS animations

`index.css`: keyframes `spin`, `zPulse`, `waveBar`; `.z-pulse`, `.z-spin`; `.z-toggle::after` transform; `.z-button:active scale(.98)`; global reduced-motion clamp `:718-720`. `motion.css` keyframes: `zm-ignite`, `zm-page-in`, `zm-page-back`, `zm-item-in`, `zm-reveal`, `zm-more-in`, `zm-breathe`, `zm-pending`, `zm-fade-in`. `sheet.css`: `z-msheet-handoff-out`. `chatBubble.css`: transitions only. Inline keyframes: `ziggy-sheet-in` (BottomNav, motion-off only), `ziggy-banner-in` (ConnectionStatus), `CHAT_BUBBLE_TUCK_CSS` (AppShell). Tailwind: `wave-bar`, `fade-in`, `slide-up`, `sheet-in`, `pulse-ring`.

## 7. What changes state / position / hierarchy / importance / context in the shell and cuts

1. Wide-screen chat dock (400px) mounts/unmounts as a hard cut (`AppShell.jsx:341`); `<main>` width jumps.
2. ChatDock header unanimated.
3. Sidebar appears/disappears across 768px with no transition; 4. same for BottomNav.
5. Bottom-nav active change is a cut (no indicator).
6. Sidebar icon/label cut even though the pill slides.
7. More menu closes with no exit (deliberate, `BottomNav.jsx:235-241`); force-closed on every route change.
8. In-nav offline strip cuts and changes bar height (~21px).
9. `ConnectionStatus` enters, exits with `return null`; sticky → page snaps.
10. `SubscriptionGateBanner` fixed z 9000, no animation.
11. Theme flip cuts every token; Sun↔Moon swapped.
12. Sidebar connection dot and Wifi glyph cut.
13. Ops/wall/onboarding/marketing routes have no page transition.
14. Cold lazy route plays the enter on a blank 60vh box, then content pops.
15. No page exit anywhere. 16. Scroll reset jumps. 17. Committed swipe-back seam. 18. 21 redirects double-render. 19. `/chat` swaps `<main>` overflow mode instantly. 20. ChatBubble mount/unmount cut. 21. ChatSheet eligibility gate outside AnimatePresence. 22. Device sheet decision can flip silently (store warmth). 23. `data-motion-live` unwired. 24. `data-motion-sheet` unwired. 25. Dead: `useSheetDetents`, `pageEnterProps`, `setMotion`, `setHaptics`, `safe`, `onReducedChange`, `EASE`, `DUR`, `SPRING`. 26. `--m-scale` pinned with no writer.

## 8. Recorded traps (from comments)

1. **`useNavigationType()` is broken under a background-location `<Routes>`** — react-router hardcodes `Action.Pop` there (`AppShell.jsx:180-190`); use `history.state.idx`.
2. POP-on-first-load closed by construction (`:192-195`).
3. Two page transitions that black-screened the app (`AppShell.jsx:306-318`, echoed `motion.css:144-147`, `morph.js:9-13`).
4. AnimatePresence stalling and trapping taps on cold start (`BottomNav.jsx:235-241`).
5. Swipe-back went back twice (`gestures.js:90-96`).
6. `animation-fill-mode: both` silently kills the press scale (three places).
7. Destructive `peekOrigin` made the morph invisible in dev (StrictMode).
8. Cancelled WAAPI `finished` rejection tore down `transform-origin` (`runId`).
9. `morph.js` must use a layout effect and re-check every render.
10. Animating `border-radius` in the FLIP wobbles corners.
11. `FRESH_MS` 420 silently dropped the morph on slow chunk loads.
12. Returning tile needs animation/opacity/z-index overrides.
13. `clip-path` cannot open a fold → the one layout animation.
14. `@import` after any rule is dropped silently → controls.css double import.
15. Attribute-value selector outranks attribute-presence in reduced-motion.
16. Sheet panel must be `height`, not `max-height`, or detents collapse.
17. 0.55 peek cut the control in half.
18. Two surfaces crossing at half opacity double-expose → 120ms hold.
19. Sheet ending in the same commit as the page was a cut → `_TRAIL_MS`.
20. Trail timer must restart when `sheet` goes away.
21. Promotion must not hand off to a `Suspense fallback={null}` → chunk warmed.
22. Sheet needs its own Suspense boundary.
23. Route-level Suspense needed because the top-level one blanked the app.
24. framer only animates when the target changes → 0.01px settle.
25. framer must keep `y`; `useSheetDetents` would take `transform` away.
26. Committed swipe-back leaves `<main>` translated → cleared pre-paint.
27. `layout` on cards forces a layout read on mount (~100ms for 50 cards) → arm by intent.
28. `scrollbarGutter: stable` because removing the scrollbar shifted children.
29. Nav must not tuck under a modal; reduced motion answered by media query.
30. `?motion=off` used to forget itself.
31. The `m` keyboard shortcut was unsafe.
32. The removed tuner was dishonest about its reach.
33. `MotionRoot` must be statically imported.
34. Chat-bubble tuck stated positively under `no-preference`.
35. **Undocumented**: `index.css:718-720` `!important` clamp defeats motion.css's reduced-motion design.
36. Stale "196px sidebar" figure in `AppShell.jsx:19-20` and `chatStore.js:9`.
