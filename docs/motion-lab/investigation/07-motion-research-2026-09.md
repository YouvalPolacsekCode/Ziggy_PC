# Motion system research brief — Ziggy (React 18 + Vite, framer-motion ^11.11, react-router-dom v6)

Researched 2026-09-26. Every fact below was fetched from a primary source unless marked **[unverified]**. Derived numbers are marked **[derived]**.

---

## 1. Motion (successor of framer-motion)

**Versions & packaging**
- Package is `motion`; React import is `motion/react`. Latest **13.4.4, published 2026-09-25** ([CHANGELOG](https://raw.githubusercontent.com/motiondivision/motion/main/CHANGELOG.md)). 12.0.0 was 2025-01-20; 13.0.0 was 2026-08-05.
- **React 18 compatible.** peerDependencies: `react: ^18.0.0 || ^19.0.0`; docs: "only compatible with React versions 18.2 and higher" ([install docs](https://motion.dev/docs/react-installation)).
- `motion/react-client`: for Next.js App Router server components; irrelevant for a Vite SPA.
- `motion/react-mini`: lighter `useAnimate` variant.

**Migration from framer-motion 11** ([upgrade guide](https://motion.dev/docs/react-upgrade-guide))
- 11 → 12: "There are no breaking changes in Motion for React in version 12." Uninstall `framer-motion`, install `motion`, rewrite imports to `motion/react`.
- 12 → 13: `@emotion/is-prop-valid` optional dependency removed. Only affects styled-components/Emotion users. Tailwind apps: nothing to do.

**Bundle-size options** ([reduce bundle size](https://motion.dev/docs/react-reduce-bundle-size))
- `motion` component: **34 kB**. `m` + `LazyMotion`: **~4.6 kB initial**; `domAnimation` **+15 kB**; `domMax` **+25 kB** (adds pan/drag + layout). `<LazyMotion strict>` throws if a `motion.*` component sneaks in.

**APIs (all React 18 unless noted)**
- **Transitions**: duration-based springs `{ type:"spring", duration, bounce }` (bounce default **0.25**); `visualDuration`; physics springs `stiffness`, `damping`, `mass`, `velocity`, `restSpeed` 0.1, `restDelta` 0.01. Defaults: physical properties like `x` or `scale` use spring physics; `opacity` or `color` use duration-based easing. **No named spring presets exist in Motion.**
- **AnimatePresence**: `mode="sync" | "wait" | "popLayout"`; `popLayout` pops exiting elements out of flow (custom components must `forwardRef`); `initial={false}`, `custom` + `usePresenceData`, `onExitComplete`, `propagate`.
- **Layout / shared element**: `layout`, `layoutId`, `layout="position"`, `layoutScroll`, `layoutRoot`, `LayoutGroup`; scale-correction caveats (`border-radius`/`box-shadow` via `style`, `scrollbar-gutter: stable`, no `display:inline`).
- **MotionConfig**: `reducedMotion="user" | "always" | "never"`. When active: transform and layout animations off; opacity and backgroundColor persist. `useReducedMotion()`.
- **Drag/pan**: `drag`, `dragConstraints`, `dragElastic`, `dragMomentum`, `dragTransition`, `dragSnapToOrigin`, `dragDirectionLock` + `onDirectionLock`, `dragPropagation`, `whileDrag`; **pan on touch needs `touch-action` set** in CSS.
- **Reorder**: 13.1.0 (2026-08-10) added multidimensional (grid) reorder, automatic axis detection, **RTL support**, auto-scroll near edges.
- **useAnimate / animate() sequences / stagger**: `animate(0, 100, { onUpdate })`; sequences with `at`; `stagger(0.1, { from:"center" })`.
- **useSpring / useTransform / useMotionValue / useScroll**: `useSpring(value | motionValue, springOpts)`, `.set()` animates, `.jump()` doesn't; since 12.34.0 piping `scrollYProgress` into opacity/transform via `useTransform` is hardware-accelerated.
- **Hardware acceleration / WAAPI**: accelerated when animating `transform` as a **string**, plus `opacity`, `clipPath`, `filter`; 12.43.0 added `backgroundColor` + SVG. **Independent `x`/`y`/`scale` are not accelerated.**
- **AnimateView** (13.4.0, 2026-09-14): React ViewTransition wrapper. **Requires React + ReactDOM 19.3; not React 18.**
- **SVG path `d` morph: NOT native.** Motion's own tutorial uses flubber + `animate(0,1,{onUpdate})`.

---

## 2. GSAP

- **100% free incl. every plugin** since GSAP 3.13 (2025-04-29), commercial OK, after Webflow's acquisition ([3.13 post](https://gsap.com/blog/3-13/)). Free: ScrollTrigger, ScrollSmoother, DrawSVG, MorphSVG, MotionPath, Flip, Draggable, Inertia, Observer, SplitText, CustomEase, etc. The one restriction: building no-code animation tools that compete with Webflow.
- **Latest: gsap 3.15.0** (2026-04-13). **`@gsap/react` 2.1.2**, `useGSAP(cb, { scope, dependencies, revertOnUpdate })` = `useLayoutEffect` + `gsap.context()`; anything created later (handlers, timeouts) must be wrapped in `contextSafe()`.
- **Flip**: `Flip.getState()` → mutate DOM → `Flip.from(state, {absolute, scale, nested, ...})`; `data-flip-id` for re-rendered nodes.
- **MorphSVG**: handles **mismatched point counts** automatically, `shapeIndex`, `type:"rotational"`, `convertToPath()`.
- **When GSAP beats Motion in React**: labelled timelines, MorphSVG icon morphs (Motion can't morph `d`), DOM-reparenting layout morphs via Flip, SplitText/ScrollSmoother.

---

## 3. Native platform

| Feature | Chrome/Edge | Safari / iOS | Firefox | Status |
|---|---|---|---|---|
| Same-document `startViewTransition` | 111 | 18 / 18 | 144 (2025-10-14) | **Baseline Newly available 2025-10-14** |
| Cross-document `@view-transition` | 126 | 18.2 / 18.2 | not supported | Limited |
| Scroll-driven `animation-timeline` | 115 | **26 / 26 (2025-09-15)** | not in stable | Limited |
| `linear()` easing | 113 | 17.2 / 17.2 | 112 | 93% global |
| `@starting-style` | 117 | 17.5 / 17.5 | 129 | 92% |
| `transition-behavior: allow-discrete` | 117 | 17.4 / 17.4 | 129 | 92% |

- **React 19.3 (2026-09-09)** made `<ViewTransition>` and `addTransitionType` stable. **Not available on React 18.**
- **React 18 path**: `document.startViewTransition(() => flushSync(() => navigate(...)))`. **react-router-dom 6.27.0 stabilized `viewTransition`** on `<Link>`/`<NavLink>`/`useNavigate` and `useViewTransitionState(href)` — usable on our v6 today.

---

## 4. Gesture libraries

- **@use-gesture/react 10.3.1** — no release for ~3 years; dormant.
- **Motion drag/pan** covers axis-locked drag, constraints, elastic, momentum, direction lock, velocity on release.
- **Vaul 1.1.2** — README: "This repo is unmaintained." shadcn's new default Drawer uses **Base UI**.
- **Base UI Drawer** — `@base-ui/react` 1.8.0, React 17–19; swipe-to-dismiss, `snapPoints`, `snapToSequentialPoints`, `modal`, nested drawers.
- **react-spring**: 10.1.2 (2024-06); 11 beta with no stable since.

---

## 5. Number / value interpolation

- Motion: `animate(0, 100, { onUpdate })`; or `useMotionValue` + `useSpring` + `useTransform` rendered via `motion.span` (off React's render loop).
- **NumberFlow** — `@number-flow/react` 0.6.2 (2026-07-18), React 18 OK. **"Non-Latin digits and RTL locales not currently supported"** → must be tested inside a `dir="ltr"` island for Hebrew.

---

## 6. Icon morph

- **MorphSVG** (GSAP, free): the only option that morphs mismatched point counts well.
- **flubber** 0.4.2, last published 2018 — dormant but still what Motion's tutorial recommends.
- **Motion**: no native `d` interpolation; only `pathLength/pathOffset/pathSpacing` line-drawing.
- Lucide animated variants: lucide-animated, AnimateIcons, Lucide React Motion (all Motion-based, MIT).

---

## 7. Performance & accessibility

- **Reduced motion = reduce, not remove**: keep opacity/colour crossfades, remove large translations, parallax, zoom, spring overshoot (WCAG 2.3.3). Use `0.01ms` not `0` so `transitionend` still fires. Motion's `reducedMotion="user"` implements exactly this split.
- **Compositor-only**: `transform`, `opacity`, `filter`, `clip-path`. Never animate width/height/margin/top/left; FLIP converts layout changes to transforms.
- **will-change**: last resort; set via JS just before the change and reset after.
- **content-visibility: auto** + `contain-intrinsic-size` for long device lists (Baseline 2024).
- **iOS Safari**: `svh`==`dvh` when the tab bar is hidden; standalone PWA `100dvh` can be wrong on cold start; `overscroll-behavior` on by default only from iOS 16; body `overflow:hidden` doesn't stop touch scroll; Motion pan/drag needs `touch-action`.
- **Capacitor Haptics** `@capacitor/haptics` 8.0.2: `impact({style: Light|Medium|Heavy})`, `notification({type: Success|Warning|Error})`, `selectionStart/Changed/End()`; pass the style explicitly.

---

## 8. Design references (with numbers)

- **Apple HIG Motion** (2025-09-09, Liquid Glass): "Add motion purposefully"; "generally avoid adding motion to UI interactions that occur frequently"; "Let people cancel motion"; supplement with haptics. No numeric durations published.
- **Material 3 Expressive springs** (dampingRatio / stiffness): spatial fast 0.6/800 (standard 0.9/1400); spatial default 0.8/380 (0.9/700); spatial slow 0.8/200 (0.9/300); effects fast 1.0/3800; default 1.0/1600; slow 1.0/800. Legacy durations: short 50–200, medium 250–400, long 450–600, extra-long 700–1000 ms; easings emphasized (0.2,0,0,1), emphasized-decelerate (0.05,0.7,0.1,1), emphasized-accelerate (0.3,0,0.8,0.15).
- **Emil Kowalski**: button press 100–160 ms; tooltips 125–200; dropdowns 150–250; modals/drawers 200–500; **UI ceiling 300 ms**; never ease-in on UI; `ease-out: cubic-bezier(0.23,1,0.32,1)`, `ease-in-out: cubic-bezier(0.77,0,0.175,1)`, drawer `cubic-bezier(0.32,0.72,0,1)`; Apple-style spring `{duration:0.5, bounce:0.2}`; bounce 0.1–0.3 only for drag-to-dismiss; stagger 30–80 ms; min scale 0.9–0.97 never 0; exits along the entry path; frequency gate (100×/day → no animation).
- **Rauno Freiberg**: high-frequency interactions minimise animation; dismissed elements keep swipe velocity and angle; lightweight actions trigger mid-gesture, destructive ones only on completion.

---

## Recommended stack for Ziggy

1. **Upgrade `framer-motion ^11.11` → `motion ^13.4`: yes.** Find-and-replace imports; zero React-18 risk. Wrap the app in `<MotionConfig reducedMotion="user" transition={tokens.default}>`. Skip `AnimateView` until React 19.3.
2. **GSAP: add only for MorphSVG icon morphs (and optionally Flip).** Fully free (3.15.0) with `@gsap/react` 2.1.2. Motion stays the primary engine.
3. **Vaul: no** — unmaintained. Keep `SheetSurface`; Base UI Drawer is the off-the-shelf alternative.
4. **NumberFlow: yes for live readouts**, in a `dir="ltr"` island; test in Hebrew.
5. **@use-gesture / react-spring: don't add.**
6. **Route transitions on React 18**: React Router v6 `viewTransition` for cheap crossfades; `layoutId` for interruptible shared-element moves inside a route.
7. **CSS-native where cheapest**: `@starting-style` + `transition-behavior: allow-discrete` for popovers; `linear()` for spring-shaped CSS easings.
8. **Haptics** through `@capacitor/haptics` 8 with explicit styles.

### Concrete motion tokens (synthesised)

**Durations**: instant 0 (keyboard / command palette / high-frequency toggles) · press 120 · micro 160 (tooltips, switch thumb) · fast 200 (dropdowns, tab indicator, modal enter) · base 260 (sheets, card expand) · slow 400 (route transitions, hero expansions). Exit ≈ 0.7× the enter. Stagger 40 ms, cap 6.

**Easings**: `out` (0.23, 1, 0.32, 1) · `in-out` (0.77, 0, 0.175, 1) · `sheet` (0.32, 0.72, 0, 1) · `accelerate` (exit only) (0.3, 0, 0.8, 0.15). Never `ease-in` for entrances.

**Springs (Motion)** [derived from M3 via damping = ζ·2√k, mass 1]: spatialFast `{stiffness 800, damping 34}` · spatialDefault `{380, 31}` · spatialSlow `{200, 23}` · effects `{1600, 80}` (or just tween). Duration-style: appleLike `{duration .5, bounce .2}` · snappy `{.3, .1}` · gesture `{visualDuration .25, bounce .25}` for drag release.

**Reduced-motion policy**: transforms/layout/parallax/overshoot off; opacity/colour crossfades stay at ≤160 ms; `transition-duration: 0.01ms` in CSS; in-app override toggle.

**Haptics mapping**: selectionChanged for scrubbing; impact Light for toggles/chips; Medium for sheet snap points and drag-release; Heavy for destructive confirms; notification Success/Warning/Error for outcomes.

### Flags — could not verify
- Motion automatic `will-change` management; `useVelocity` page not fetched; Motion `bounce → dampingRatio` internal mapping; Firefox scroll-driven animations status; CustomEase doc page still reads as paid (the npm file proves it ships free); Capacitor Haptics default impact style; `@property` counter support; Apple Home iOS 26 per-interaction motion specs.
