# Motion System Phase A — Foundation, Navigation, Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the motion tokens, fix the reduced-motion clamp, and port the operator's navigation and page-transition picks (bottom-nav depth, More-menu fan-out, condense-on-scroll, sidebar accent bar, iOS parallax push, blur tab crossfade, rubber-band swipe-back) into the real Ziggy components, all behind the existing `?motion=off` rollback plus a new `?pages=off` kill switch.

**Architecture:** Every change is scoped under `<html data-motion="on">` or `useMotionOn()`; with motion off each component renders exactly today's DOM. Page transitions are a hand-rolled two-layer stage (the outgoing page element is cached and overlaid; no `AnimatePresence`, no handshake, a timeout watchdog) so the two historical black-screen failures cannot recur. Framer-motion 11 drives springs; CSS drives everything that is a simple transition.

**Tech Stack:** React 18, framer-motion 11.18, react-router-dom 6.30 (`useOutlet`), vitest 2 + jsdom + @testing-library/react, Vite.

**Spec:** `docs/superpowers/specs/2026-10-10-motion-system-design.md` (read §2 non-negotiables and §3 Navigation/Pages before starting). Lab reference implementations: `frontend/src/lab/sections/Navigation.jsx`, `frontend/src/lab/sections/PageTransitions.jsx`.

All paths below are relative to `frontend/` unless they start with `docs/`. Run commands from `frontend/`.

## Global Constraints

- `?motion=off` must restore today's DOM and styles exactly (spec §2.1; `src/motion/flag.js:17-20`). New elements/attributes may only exist when `useMotionOn()` is true.
- Page transitions additionally gate on `data-motion-pages="on"` (spec §2.2), resolved `?pages=on|off` → localStorage `ziggy_motion_pages` → default on.
- Animate only transform / opacity / clip-path / filter, plus the two layout exceptions this plan owns: the bottom bar's own height when condensing, and the tab container height under the crossfade.
- Exits faster than entrances; never ease-in; one strong ease-out `cubic-bezier(0.23, 1, 0.32, 1)`.
- Reduced motion keeps colour and opacity (≤ 160 ms) and drops travel, scale, blur, loops. Every new CSS rule ships with its `prefers-reduced-motion` counterpart in the same task. Framer sites rely on `<MotionConfig reducedMotion="user">` (`src/main.jsx:42`) **and** explicitly drop `filter`/`y` via `useReducedMotion()` where used.
- Hebrew: travel is logical (`sign = rtl ? -1 : 1`, `insetInlineStart`), checked in RTL in every task.
- Timings from the operator's knobs (spec §3): nav depth spring `{duration 0.45, bounce 0.18}`; More fan-out `{duration 0.32, bounce 0.12}` stagger 40 ms; sidebar bar `{0.4, 0.1}`; push 0.42 s, pop 0.42 × 0.85 s, parallax 0.3, dim 0.35; tabs 0.26 s (crossfade 0.26 × 0.8); swipe peel 32 px.
- The room FLIP (`src/motion/morph.js`) keeps its page: navigations into or out of `/rooms/:id` use today's CSS enter, never the slide (Task 8).
- Do not touch `frontend/node_modules` (it is a committed symlink on `origin/main`; never stage its deletion). Commit specific paths only.
- Baseline: `npx vitest run` = 374 pass, 1 pre-existing fail (`src/lib/__tests__/mergedIrAvailability.test.js`). That one failure is not yours to fix; every other test must pass after each task.

## Review Focus

1. **WS reconnect storm during a page transition** (the historical trigger): the shell re-renders 20× in 400 ms. Expected: the new page ends at `transform: none`, opacity 1, and the overlay is gone. Pinned by Task 8's "storm" test.
2. **Cold lazy route** (`/devices` chunk not loaded): the entering layer suspends. Expected: the Suspense placeholder slides in, content fills, no stuck layer. Pinned by Task 8's suspense test.
3. **Deep link / first load**: no previous page exists. Expected: no overlay, no slide, today's CSS enter. Pinned by Task 8's first-mount test.
4. **Route change while the More menu is closing**: the force-close on route change unmounts both layers. Expected: no stuck backdrop, no trapped taps. Pinned by Task 5's route-change test.
5. **A committed swipe-back must call `onBack` exactly once** even when `transitionend` fires per property and the timeout also fires. Pinned by Task 9's idempotency test.

---

### Task 1: One token vocabulary

**Files:**
- Modify: `src/lib/motion.js` (whole file)
- Modify: `src/motion/motion.js:20-52, 73-83`
- Modify: `src/index.css:95-99`
- Modify: `src/motion/motion.css:24-36`
- Modify: `src/motion/gestures.js:168-261` (delete `useSheetDetents`), `src/motion/morph.js:331-334` (delete `pageEnterProps`), `src/motion/SheetSurface.jsx:29` (comment), `src/motion/README.md:29`
- Test: `src/lib/__tests__/motionTokens.test.js`

**Interfaces:**
- Produces: `src/lib/motion.js` exports `DUR {press, micro, fast, base, slow}`, `EASE {out, glide, inOut, drawer, standard}`, `CSS_EASE` (same keys, `cubic-bezier(...)` strings), `SPRING {snappy, gentle, calm, press, detent, gesture}`, plus the existing `DUR_PRESS, DUR_STATE, DUR_ENTER, EASE_STANDARD, EASE_ENTER, SPRING_SHEET, T_STATE, T_ENTER, T_PRESS, FADE_UP, FADE` (unchanged names, values re-expressed). `src/motion/motion.js` re-exports `EASE, CSS_EASE, DUR, SPRING` from `lib/motion.js` and keeps `isReduced, haptic, clamp, project, nearest, makeVelocityTracker`.
- Later tasks import timing from `src/lib/motion.js` only.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/__tests__/motionTokens.test.js
// One vocabulary. Two files used to carry two different strong ease-outs
// (findings §3.2); this pins them to the same values and pins the CSS tokens
// to the JS ones so a curve cannot drift in one place.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as lib from '../motion'
import * as layer from '../../motion/motion'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const INDEX_CSS = fs.readFileSync(path.resolve(HERE, '../../index.css'), 'utf8')
const SRC = path.resolve(HERE, '../..')

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) { if (name !== 'lab' && name !== '__tests__') walk(p, out) }
    else if (/\.(jsx?|css)$/.test(name)) out.push(p)
  }
  return out
}

describe('motion tokens', () => {
  it('lib/motion.js and motion/motion.js share one EASE / DUR / SPRING', () => {
    expect(layer.EASE).toBe(lib.EASE)
    expect(layer.CSS_EASE).toBe(lib.CSS_EASE)
    expect(layer.DUR).toBe(lib.DUR)
    expect(layer.SPRING).toBe(lib.SPRING)
  })
  it('has one strong ease-out and the enter preset uses it', () => {
    expect(lib.EASE.out).toEqual([0.23, 1, 0.32, 1])
    expect(lib.EASE_ENTER).toEqual([0.23, 1, 0.32, 1])
    expect(lib.CSS_EASE.out).toBe('cubic-bezier(0.23, 1, 0.32, 1)')
    expect(lib.T_ENTER.ease).toEqual(lib.EASE.out)
  })
  it('exposes the five durations and six springs the spec names', () => {
    expect(lib.DUR).toEqual({ press: 0.12, micro: 0.16, fast: 0.2, base: 0.26, slow: 0.4 })
    expect(Object.keys(lib.SPRING).sort()).toEqual(['calm', 'detent', 'gentle', 'gesture', 'press', 'snappy'])
    expect(lib.SPRING.gesture).toEqual({ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 })
    expect(lib.SPRING_SHEET).toBe(lib.SPRING.gesture)
  })
  it('index.css tokens agree with the JS values', () => {
    expect(INDEX_CSS).toMatch(/--ease-enter:\s*cubic-bezier\(0\.23, 1, 0\.32, 1\)/)
    expect(INDEX_CSS).toMatch(/--ease-out-strong:\s*cubic-bezier\(0\.23, 1, 0\.32, 1\)/)
    expect(INDEX_CSS).toMatch(/--ease-in-out:\s*cubic-bezier\(0\.77, 0, 0\.175, 1\)/)
    expect(INDEX_CSS).toMatch(/--ease-drawer:\s*cubic-bezier\(0\.32, 0\.72, 0, 1\)/)
    expect(INDEX_CSS).toMatch(/--dur-fast:\s*160ms/)
    expect(INDEX_CSS).toMatch(/--dur-base:\s*260ms/)
    expect(INDEX_CSS).toMatch(/--dur-slow:\s*400ms/)
  })
  it('the dead exports are gone and nobody imports them', () => {
    expect(layer.safe).toBeUndefined()
    expect(layer.onReducedChange).toBeUndefined()
    const all = walk(SRC).map(p => fs.readFileSync(p, 'utf8')).join('\n')
    expect(all).not.toMatch(/\buseSheetDetents\b/)
    expect(all).not.toMatch(/\bpageEnterProps\b/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/__tests__/motionTokens.test.js`
Expected: FAIL — `layer.EASE` is not `lib.EASE` (lib has no `EASE`), `--ease-out-strong` missing, `useSheetDetents` still found.

- [ ] **Step 3: Rewrite `src/lib/motion.js`**

```js
// One motion vocabulary for every framer-motion call site AND the motion
// layer. CSS gets the same values from the --dur-* / --ease-* tokens in
// index.css; keep them in sync (src/lib/__tests__/motionTokens.test.js pins
// both sides).
//
// Rules (Apple HIG › Motion, Emil Kowalski):
//   - motion answers an action; nothing loops for decoration
//   - enter uses ease-out; exit is FASTER than enter; never ease-in
//   - transform and opacity only (plus clip-path / filter for reveals)
//   - frequent interactions get little or no animation
//   - reduced motion keeps colour/opacity and drops travel, scale and loops

// Durations (seconds, framer's unit).
export const DUR = {
  press: 0.12,  // hover / press feedback
  micro: 0.16,  // a glyph, a chip, a toggle knob
  fast:  0.2,   // a value changing in place
  base:  0.26,  // something appearing or leaving
  slow:  0.4,   // movement across a distance
}

// Curves.
export const EASE = {
  out:      [0.23, 1, 0.32, 1],      // THE strong ease-out — entrances, presses, chips
  glide:    [0.33, 0.68, 0.15, 1],   // large surfaces: keeps speed through the middle
  inOut:    [0.77, 0, 0.175, 1],     // on-screen movement, morphs
  drawer:   [0.32, 0.72, 0, 1],      // iOS sheet / push curve
  standard: [0.2, 0, 0, 1],          // hover, colour, in-place changes
}
export const CSS_EASE = Object.fromEntries(
  Object.entries(EASE).map(([k, v]) => [k, `cubic-bezier(${v.join(', ')})`]),
)

// Apple-style perceptual springs (duration + bounce) and one physics spring
// for what the finger drives.
export const SPRING = {
  snappy:  { type: 'spring', duration: 0.32, bounce: 0.08 },
  gentle:  { type: 'spring', duration: 0.5,  bounce: 0.12 },
  calm:    { type: 'spring', duration: 0.7,  bounce: 0 },
  press:   { type: 'spring', duration: 0.18, bounce: 0 },
  detent:  { type: 'spring', stiffness: 520, damping: 34, mass: 0.9 },
  gesture: { type: 'spring', stiffness: 400, damping: 30, mass: 0.8 },
}

// ── Back-compat names (30 importers). Same objects, new source of truth. ──
export const DUR_PRESS = DUR.press
export const DUR_STATE = DUR.fast
export const DUR_ENTER = DUR.base
export const EASE_STANDARD = EASE.standard
export const EASE_ENTER    = EASE.out
export const SPRING_SHEET  = SPRING.gesture

export const T_STATE = { duration: DUR_STATE, ease: EASE_STANDARD }
export const T_ENTER = { duration: DUR_ENTER, ease: EASE_ENTER }
export const T_PRESS = { duration: DUR_PRESS, ease: EASE_STANDARD }

export const FADE_UP = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -4 },
  transition: T_ENTER,
}
export const FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit:    { opacity: 0 },
  transition: T_STATE,
}
```

Note `DUR_ENTER` moves from 0.24 to 0.26 and `EASE_ENTER` from (0.16,1,0.3,1) to (0.23,1,0.32,1). Both are deliberate (spec §4 Tokens).

- [ ] **Step 4: Make `src/motion/motion.js` re-export**

Replace lines 20-52 (the `EASE`, `CSS_EASE`, `DUR`, `SPRING` blocks) with:

```js
import { EASE, CSS_EASE, DUR, SPRING } from '../lib/motion'
export { EASE, CSS_EASE, DUR, SPRING }
```

(Put the `import` at the top of the file, above the header comment's end; keep the `export` where the blocks were.) Delete lines 73-83 (`onReducedChange`, `_reducedSubs` usage, and `safe`): remove `const _reducedSubs = new Set()`, the `_reducedSubs.forEach(...)` line inside `onChange`, `export function onReducedChange`, and `export function safe`. Keep `isReduced`, the `data-motion-reduced` mirroring, haptics, `clamp`, `project`, `nearest`, `makeVelocityTracker`.

- [ ] **Step 5: CSS tokens**

In `src/index.css` replace lines 95-99 with:

```css
  --dur-press: 120ms;   /* hover / press feedback */
  --dur-fast:  160ms;   /* a glyph, a chip, a toggle knob */
  --dur-state: 200ms;   /* a value changing in place */
  --dur-base:  260ms;   /* something appearing or leaving */
  --dur-enter: 260ms;   /* alias of --dur-base (older rules) */
  --dur-slow:  400ms;   /* movement across a distance */
  --ease-standard:   cubic-bezier(0.2, 0, 0, 1);
  --ease-out-strong: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-enter:      cubic-bezier(0.23, 1, 0.32, 1); /* alias of --ease-out-strong */
  --ease-in-out:     cubic-bezier(0.77, 0, 0.175, 1);
  --ease-drawer:     cubic-bezier(0.32, 0.72, 0, 1);
```

In `src/motion/motion.css` lines 24-36, change the aliases so the layer reads the app tokens (no second definition):

```css
[data-motion="on"] {
  --m-std:    var(--ease-standard);
  --m-out:    var(--ease-out-strong);
  --m-glide:  cubic-bezier(0.33, 0.68, 0.15, 1);
  --m-in-out: var(--ease-in-out);
  --m-drawer: var(--ease-drawer);
```

(Keep the comment block and the duration lines that follow unchanged.)

- [ ] **Step 6: Delete the dead code**

- `src/motion/gestures.js`: delete the whole `useSheetDetents` section (the comment at lines 168-174, `const FLICK = 900`, and the function through line 261). Remove `useState` from the react import if nothing else in the file uses it (`useScrollChrome` does — keep it). Remove `nearest, project, isReduced` from the `./motion` import if now unused (check with the grep in Step 7).
- `src/motion/morph.js`: delete `pageEnterProps` (lines 331-334) and the comment above it.
- `src/motion/SheetSurface.jsx:29`: change the comment to `//    motion/gestures.js used to have a pointer-based detent engine; it was` (keep the rest of that note's meaning: framer owns `y`).
- `src/motion/README.md:29`: `gestures.js    useLongPress · useSwipeBack · useScrub · useScrollChrome`.

- [ ] **Step 7: Run the test and the whole suite**

Run: `npx vitest run src/lib/__tests__/motionTokens.test.js && npx vitest run`
Expected: tokens test PASS; suite 375+ pass, 1 pre-existing fail. Also run `grep -rn "useSheetDetents\|pageEnterProps\|onReducedChange\|safe(" src --exclude-dir=lab` → no code hits (comments in README are fine only if they say it was removed).

- [ ] **Step 8: Build**

Run: `npm run build`
Expected: succeeds. (Vite build is the import check for the 30 `lib/motion` importers.)

- [ ] **Step 9: Commit**

```bash
git add src/lib/motion.js src/motion/motion.js src/index.css src/motion/motion.css src/motion/gestures.js src/motion/morph.js src/motion/SheetSurface.jsx src/motion/README.md src/lib/__tests__/motionTokens.test.js
git commit -m "refactor(motion): one token vocabulary in lib/motion.js; drop dead exports

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Reduced motion is reduce, not remove

**Files:**
- Modify: `src/index.css:718-720`
- Modify: `src/motion/motion.css` (reduced-motion block, after line 376)
- Test: `src/__tests__/reducedMotionPolicy.test.js`

**Interfaces:**
- Produces: with the layer on, the global clamp no longer applies; `motion.css` owns reduced motion. With the layer off, behaviour is byte-identical to today.

- [ ] **Step 1: Write the failing test**

```js
// src/__tests__/reducedMotionPolicy.test.js
// index.css used to clamp EVERY animation and transition to .01ms under
// prefers-reduced-motion with !important, which outranked the layer's own
// "keep colour and opacity, drop travel" rules (findings §3.1). The clamp now
// applies only while the layer is off, so the rollback is unchanged and the
// layer's policy is the policy.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const INDEX = fs.readFileSync(path.resolve(HERE, '../index.css'), 'utf8')
const LAYER = fs.readFileSync(path.resolve(HERE, '../motion/motion.css'), 'utf8')

describe('reduced motion policy', () => {
  it('the global clamp is scoped to the motion-off tree', () => {
    expect(INDEX).toContain('html:not([data-motion="on"]) *, html:not([data-motion="on"]) *::before, html:not([data-motion="on"]) *::after { animation-duration: .01ms !important')
    expect(INDEX).not.toMatch(/^\s*\*, \*::before, \*::after \{ animation-duration: \.01ms !important/m)
  })
  it('the layer stops decorative loops under reduced motion', () => {
    expect(LAYER).toMatch(/\[data-motion="on"\] \.animate-pulse[^{]*\{\s*animation: none/)
    expect(LAYER).toMatch(/\[data-motion="on"\] \.z-pulse[^{]*\{\s*animation: none/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/reducedMotionPolicy.test.js`
Expected: FAIL — clamp not scoped, no `.animate-pulse` rule.

- [ ] **Step 3: Scope the clamp**

In `src/index.css` replace lines 718-720 with:

```css
/* Reduced motion with the motion LAYER OFF: the old global clamp, unchanged,
   so `?motion=off` under the OS setting is exactly what it was. With the
   layer on, src/motion/motion.css owns reduced motion ("reduce, not
   remove": colour and opacity stay, travel/scale/blur/loops go). */
@media (prefers-reduced-motion: reduce) {
  html:not([data-motion="on"]) *, html:not([data-motion="on"]) *::before, html:not([data-motion="on"]) *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
}
```

- [ ] **Step 4: Add the loop stops to the layer**

In `src/motion/motion.css`, inside the existing `@media (prefers-reduced-motion: reduce) { ... }` block (ends at line 370), append before its closing brace:

```css
  /* Loops that live outside this file (Tailwind's pulse, the health dot). */
  [data-motion="on"] .animate-pulse { animation: none; }
  [data-motion="on"] .z-pulse { animation: none; }
```

There is deliberately no blanket cap on other transitions: a rule cannot read an element's current duration, so every later task adds its own reduced-motion counterpart for what it introduces. Add the matching attribute-mirrored lines after line 376:

```css
[data-motion-reduced="true"][data-motion="on"] .animate-pulse { animation: none; }
[data-motion-reduced="true"][data-motion="on"] .z-pulse { animation: none; }
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/__tests__/reducedMotionPolicy.test.js`
Expected: PASS.

- [ ] **Step 6: Manual check**

Run `npx vite --port 3260 --strictPort --host`, open `http://localhost:3260/` with macOS "Reduce motion" on (System Settings → Accessibility → Display). Toggle a light tile: the `[data-on]` colour crossfade still plays (160 ms); the icon ignition does not. Add `?motion=off`: everything is instant, as today.

- [ ] **Step 7: Commit**

```bash
git add src/index.css src/motion/motion.css src/__tests__/reducedMotionPolicy.test.js
git commit -m "fix(motion): scope the reduced-motion clamp to the motion-off tree

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The page-transition kill switch

**Files:**
- Create: `src/motion/pages.js`
- Test: `src/motion/__tests__/pages.test.js`

**Interfaces:**
- Produces: `isPagesOn(): boolean`, `usePagesOn(): boolean` (React), `setPages(next: boolean)`. Resolution `?pages=on|1 / off|0` → localStorage `ziggy_motion_pages` → default `true`. An explicit query choice sticks (same reasoning as `flag.js:36-50`). Mirrors to `<html data-motion-pages="on|off">`.
- Consumed by Task 8 (`AppShell`).

- [ ] **Step 1: Write the failing test**

```js
// src/motion/__tests__/pages.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest'

async function load(search) {
  vi.resetModules()
  window.history.replaceState({}, '', `/${search}`)
  return import('../pages')
}

describe('data-motion-pages flag', () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-motion-pages') })

  it('defaults on and mirrors to <html>', async () => {
    const m = await load('')
    expect(m.isPagesOn()).toBe(true)
    expect(document.documentElement.getAttribute('data-motion-pages')).toBe('on')
  })
  it('?pages=off turns it off and sticks', async () => {
    const m = await load('?pages=off')
    expect(m.isPagesOn()).toBe(false)
    expect(localStorage.getItem('ziggy_motion_pages')).toBe('off')
    const again = await load('')
    expect(again.isPagesOn()).toBe(false)
  })
  it('?pages=on re-enables', async () => {
    localStorage.setItem('ziggy_motion_pages', 'off')
    const m = await load('?pages=on')
    expect(m.isPagesOn()).toBe(true)
    expect(document.documentElement.getAttribute('data-motion-pages')).toBe('on')
  })
  it('setPages notifies subscribers', async () => {
    const m = await load('')
    const seen = []
    const off = m.onPagesChange(v => seen.push(v))
    m.setPages(false)
    off()
    m.setPages(true)
    expect(seen).toEqual([false])
    expect(document.documentElement.getAttribute('data-motion-pages')).toBe('on')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/motion/__tests__/pages.test.js`
Expected: FAIL — cannot resolve `../pages`.

- [ ] **Step 3: Write `src/motion/pages.js`**

```js
// The page-transition switch — a second, narrower kill switch beside flag.js.
//
// Two earlier page transitions black-screened the app (AppShell.jsx has the
// record). The iOS push built in PageTransition.jsx avoids both failure modes
// by construction, but a home that still hits something wrong with it must
// be able to drop ONLY the page slide and keep the rest of the layer. So:
//
//   ?pages=on|1 / ?pages=off|0  →  localStorage ziggy_motion_pages  →  default ON
//
// An explicit query choice sticks, for the same reason flag.js's does: a
// rollback that forgets itself on the next tap is not a rollback. Mirrored to
// <html data-motion-pages> so CSS can read it too.

const KEY = 'ziggy_motion_pages'
const subs = new Set()

function readInitial() {
  try {
    const q = new URLSearchParams(window.location.search).get('pages')
    if (q === 'on' || q === '1') return true
    if (q === 'off' || q === '0') return false
    const stored = localStorage.getItem(KEY)
    if (stored === 'on') return true
    if (stored === 'off') return false
  } catch { /* private mode */ }
  return true
}

function persistExplicitChoice() {
  try {
    const q = new URLSearchParams(window.location.search).get('pages')
    if (q === 'on' || q === '1') localStorage.setItem(KEY, 'on')
    else if (q === 'off' || q === '0') localStorage.setItem(KEY, 'off')
  } catch { /* private mode */ }
}

let on = typeof window === 'undefined' ? false : readInitial()

function apply() {
  document.documentElement.setAttribute('data-motion-pages', on ? 'on' : 'off')
}

if (typeof window !== 'undefined') { persistExplicitChoice(); apply() }

export const isPagesOn = () => on

export function setPages(next) {
  on = !!next
  try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* ignore */ }
  apply()
  subs.forEach((fn) => fn(on))
}

export function onPagesChange(fn) {
  subs.add(fn)
  return () => subs.delete(fn)
}

import { useEffect, useState } from 'react'
export function usePagesOn() {
  const [v, setV] = useState(on)
  useEffect(() => onPagesChange(setV), [])
  return v
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/motion/__tests__/pages.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Document it**

In `src/motion/README.md`, after the paragraph that starts "`<html data-motion="off">` restores the app" (line 14-17), add:

```
Page transitions have their own switch on top of that one: **`?pages=off`**
(sticks the same way) drops only the page slide and keeps everything else.
See `pages.js` and `PageTransition.jsx` for why it exists.
```

And add `  pages.js       the page-transition switch (?pages=on|off → localStorage → default on)` to the file list under `flag.js`.

- [ ] **Step 6: Commit**

```bash
git add src/motion/pages.js src/motion/__tests__/pages.test.js src/motion/README.md
git commit -m "feat(motion): data-motion-pages kill switch for page transitions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Bottom nav — "Depth" active state

Port of lab `NavH` (`src/lab/sections/Navigation.jsx:320-341`): no travelling pill; the active icon comes forward (scale 1.16, up 2 px, soft drop-shadow) while the others recede (scale 0.94, opacity 0.65). The three one-frame swaps today (`stroke`, `fontWeight`, `color` at `BottomNav.jsx:74-79`) ride on that spring. The dead highlight machinery (`NAV_HL_SURFACE`, `hl` state, the `[data-motion-nav-hl]` element) is deleted; `moreOriginX` measurement stays (Task 5 uses it).

**Files:**
- Modify: `src/components/layout/BottomNav.jsx:1-11, 61-107, 127-140, 168-221, 343-369`
- Modify: `src/motion/motion.css:274-276` (delete the `[data-motion-nav-hl]` transition rule; Task 7 removes its sidebar use), `:367-368, :375` (its reduced-motion lines)
- Test: `src/components/layout/__tests__/BottomNav.depth.test.jsx`

**Interfaces:**
- Consumes: `SPRING`/`EASE`/`DUR` from `src/lib/motion.js` (Task 1).
- Produces: `data-nav-depth="active|idle"` on each tab's icon+label wrapper when motion is on; nothing when off.

- [ ] **Step 1: Write the failing test**

```jsx
// src/components/layout/__tests__/BottomNav.depth.test.jsx
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../lib/i18n', async (orig) => ({ ...(await orig()), useT: () => (k) => k, useLang: () => 'en', useIsRTL: () => false }))
vi.mock('../../../stores/featuresStore', () => ({ useFeature: () => true }))
vi.mock('../../../stores/authStore', () => ({ useAuthStore: () => ({ role: 'user' }) }))

import { setMotion } from '../../../motion/flag'
import { BottomNav } from '../BottomNav'

function mount(path, motion) {
  setMotion(motion)
  return render(<MemoryRouter initialEntries={[path]}><BottomNav connected /></MemoryRouter>)
}

describe('BottomNav depth active state', () => {
  beforeEach(() => localStorage.clear())

  it('motion on: the active tab is marked active, the others idle', () => {
    const { container } = mount('/rooms', true)
    const cells = container.querySelectorAll('[data-nav-depth]')
    expect(cells.length).toBe(5)
    const active = [...cells].filter(c => c.getAttribute('data-nav-depth') === 'active')
    expect(active.length).toBe(1)
    expect(active[0].closest('a')?.getAttribute('href')).toBe('/rooms')
  })
  it('motion on: the More cell participates', () => {
    const { container } = mount('/settings', true)
    const active = container.querySelector('[data-nav-depth="active"]')
    expect(active.closest('button')?.getAttribute('aria-expanded')).toBe('false')
  })
  it('motion off: today\'s DOM — no depth wrapper, stroke 2 on the active icon', () => {
    const { container } = mount('/rooms', false)
    expect(container.querySelector('[data-nav-depth]')).toBeNull()
    const activeLink = container.querySelector('a[aria-current="page"]')
    expect(activeLink.querySelector('svg')?.getAttribute('stroke-width')).toBe('2')
    expect(container.querySelector('[data-motion-nav-hl]')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/layout/__tests__/BottomNav.depth.test.jsx`
Expected: FAIL — no `[data-nav-depth]` elements.

- [ ] **Step 3: Implement**

In `src/components/layout/BottomNav.jsx`:

(a) Imports — add after line 8:

```jsx
import { motion } from 'framer-motion'
import { EASE, DUR } from '../../lib/motion'
```

(b) Add, above `function Tab`, the depth wrapper (the spring and filter tween are the lab's, with the operator's knob values):

```jsx
// Depth: the active tab comes forward, the others recede. There is no
// travelling object — hierarchy is stated in z, not x — so the bar keeps its
// resting design exactly (no pill, see the note that used to live here about
// NAV_HL_SURFACE). The shadow is a tween: a bouncy spring would push the blur
// radius below zero, which the browser rejects.
const DEPTH_SPRING = { type: 'spring', duration: 0.45, bounce: 0.18 }
const DEPTH_SHADOW = { duration: 0.24, ease: EASE.out }
function DepthCell({ active, motionOn, icon, label, labelStyle }) {
  if (!motionOn) {
    return (
      <>
        {icon}
        <span style={labelStyle}>{label}</span>
      </>
    )
  }
  return (
    <motion.span
      data-nav-depth={active ? 'active' : 'idle'}
      initial={false}
      animate={{ scale: active ? 1 : 0.94, opacity: active ? 1 : 0.65 }}
      transition={DEPTH_SPRING}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0, maxWidth: '100%' }}
    >
      <motion.span
        initial={false}
        animate={{
          scale: active ? 1.16 : 1,
          y: active ? -2 : 0,
          filter: active ? 'drop-shadow(0 4px 5px rgba(0,0,0,.22))' : 'drop-shadow(0 0px 0px rgba(0,0,0,0))',
        }}
        transition={{ ...DEPTH_SPRING, filter: DEPTH_SHADOW }}
        style={{ display: 'grid' }}
      >
        {icon}
      </motion.span>
      <span style={labelStyle}>{label}</span>
    </motion.span>
  )
}
```

(c) Rewrite `Tab` (lines 61-84) to use it. The icon keeps today's props exactly so the motion-off branch is byte-identical:

```jsx
function Tab({ to, name, label, motionOn }) {
  const location = useLocation()
  const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
  const labelStyle = { ...TAB_LABEL, fontWeight: active ? 600 : 500, color: active ? 'var(--ink)' : 'var(--ink-mute)' }
  return (
    <NavLink
      to={to}
      style={{ ...TAB_CELL, textDecoration: 'none' }}
      aria-current={active ? 'page' : undefined}
      onClick={motionOn ? () => haptic('light') : undefined}
      data-motion-nav-cell={motionOn ? 'true' : undefined}
    >
      <DepthCell
        active={active}
        motionOn={motionOn}
        icon={<ZIcon name={name} size={26} stroke={active ? 2 : 1.6} color={active ? 'var(--ink)' : 'var(--ink-mute)'} />}
        label={label}
        labelStyle={labelStyle}
      />
    </NavLink>
  )
}
```

(d) Rewrite `MoreTab` (lines 86-107) the same way:

```jsx
function MoreTab({ active, onClick, expanded, label, motionOn, cellRef }) {
  const labelStyle = { ...TAB_LABEL, fontWeight: active ? 600 : 500, color: active ? 'var(--ink)' : 'var(--ink-mute)' }
  return (
    <button
      ref={cellRef}
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={expanded}
      data-motion-nav-cell={motionOn ? 'true' : undefined}
      style={{ ...TAB_CELL, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
    >
      <DepthCell
        active={active}
        motionOn={motionOn}
        icon={<MoreHorizontal size={26} strokeWidth={active ? 2 : 1.6} color={active ? 'var(--ink)' : 'var(--ink-mute)'} />}
        label={label}
        labelStyle={labelStyle}
      />
    </button>
  )
}
```

(e) Delete the `NAV_HL_SURFACE` comment+constant (lines 127-140). In the measurement effect (168-221) delete `const [hl, setHl] = useState(null)`, the `if (!NAV_HL_SURFACE) return` line and everything after it inside `measure` (the `cell`/`setHl` block), and change the early return to `if (!motionOn) { setMoreOriginX(null); return }`. Keep `activeIndex` (the More-menu fan uses `isMoreActive`; `activeIndex` can go if unused — delete it if ESLint flags it). Delete the grid's `...(motionOn && NAV_HL_SURFACE ? { position: 'relative' } : null)` spread and the whole `{motionOn && NAV_HL_SURFACE && hl && (...)}` element (lines 354-369). Update the measurement comment to say its one consumer is the More menu's origin.

(f) `src/motion/motion.css`: delete lines 274-276 (`[data-motion-nav-hl]` transition) and the two reduced-motion lines that mention `data-motion-nav-hl` (367-368 and 375). Task 7 replaces the sidebar's use.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/components/layout/__tests__/BottomNav.depth.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Manual check on the phone width**

Dev server, 390 px wide, tap between Home / Rooms / Devices / Actions / More: the active icon lifts and the previous one settles back; no layout shift of the labels (the wrapper is the same flex column as before). Check RTL (`H` in Settings → language). `?motion=off`: identical to before.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/BottomNav.jsx src/motion/motion.css src/components/layout/__tests__/BottomNav.depth.test.jsx
git commit -m "feat(nav): bottom-nav depth active state (pick H), drop the dormant highlight

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: More menu — fan out, retract in reverse

Port of lab `MoreC` (`Navigation.jsx:410-435`). Each More item is its own card that fans up out of the bar, 40 ms apart starting from the item nearest the More tab, on `{spring 0.32, bounce 0.12}`; closing retracts in reverse order (30 ms apart, 120 ms each). **Without AnimatePresence**: the close is a `closing` state driven by framer `animate` plus a timeout that unmounts; a route change still force-unmounts synchronously (the cold-start protection stays).

**Files:**
- Modify: `src/components/layout/BottomNav.jsx` (More popover block, lines 234-304 after Task 4; `showMore` state)
- Modify: `src/motion/motion.css:291-308` (More rules) and its reduced-motion line (`:369`)
- Test: `src/components/layout/__tests__/BottomNav.more.test.jsx`

**Interfaces:**
- Consumes: `moreOriginX`, `moreItems`, `motionOn` already in `BottomNav`.
- Produces: popover items carry `data-fan-item`; the wrapper carries `data-motion-more` and, while retracting, `data-closing="true"`.

- [ ] **Step 1: Write the failing test**

```jsx
// src/components/layout/__tests__/BottomNav.more.test.jsx
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'

vi.mock('../../../lib/i18n', async (orig) => ({ ...(await orig()), useT: () => (k) => k, useLang: () => 'en', useIsRTL: () => false }))
vi.mock('../../../stores/featuresStore', () => ({ useFeature: () => true }))
vi.mock('../../../stores/authStore', () => ({ useAuthStore: () => ({ role: 'user' }) }))

import { setMotion } from '../../../motion/flag'
import { BottomNav } from '../BottomNav'

function Go({ to }) { const nav = useNavigate(); return <button data-testid="go" onClick={() => nav(to)}>go</button> }
function mount(motion) {
  setMotion(motion)
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes><Route path="*" element={<><Go to="/rooms" /><BottomNav connected /></>} /></Routes>
    </MemoryRouter>,
  )
}
const openMore = (c) => fireEvent.click(c.querySelector('button[aria-expanded]'))

describe('More menu fan-out', () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers() })

  it('motion on: three fan items, nearest the More tab first', () => {
    const { container } = mount(true)
    openMore(container)
    const items = container.querySelectorAll('[data-fan-item]')
    expect(items.length).toBe(3)
    expect(items[2].getAttribute('data-fan-item')).toBe('0') // last in DOM = nearest More = first to arrive
  })
  it('motion on: backdrop tap retracts then unmounts after the exit window', () => {
    const { container } = mount(true)
    openMore(container)
    fireEvent.click(container.querySelector('[data-motion-more-backdrop]'))
    expect(container.querySelector('[data-motion-more]')?.getAttribute('data-closing')).toBe('true')
    act(() => { vi.advanceTimersByTime(300) })
    expect(container.querySelector('[data-motion-more]')).toBeNull()
    expect(container.querySelector('[data-motion-more-backdrop]')).toBeNull()
  })
  it('a route change while closing unmounts synchronously (no stuck backdrop)', () => {
    const { container, getByTestId } = mount(true)
    openMore(container)
    fireEvent.click(container.querySelector('[data-motion-more-backdrop]'))
    fireEvent.click(getByTestId('go'))
    expect(container.querySelector('[data-motion-more]')).toBeNull()
    expect(container.querySelector('[data-motion-more-backdrop]')).toBeNull()
  })
  it('motion off: today\'s single card, no fan attributes, instant close', () => {
    const { container } = mount(false)
    openMore(container)
    expect(container.querySelector('[data-fan-item]')).toBeNull()
    expect(container.querySelector('[data-motion-more]')).toBeNull()
    fireEvent.click(container.querySelector('.fixed.inset-0'))
    expect(container.querySelector('[aria-expanded="true"]')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/layout/__tests__/BottomNav.more.test.jsx`
Expected: FAIL — no `[data-fan-item]`, no `data-closing`.

- [ ] **Step 3: Implement**

In `BottomNav.jsx`:

(a) State — replace `const [showMore, setShowMore] = useState(false)` and the force-close effect (lines 150-156) with:

```jsx
  const [showMore, setShowMore] = useState(false)
  // 'closing' keeps the popover mounted for its retract; the timeout below
  // is what unmounts it. NO AnimatePresence: framer's exit cycle stalled on
  // cold start once (the /devices chunk blocked the thread mid-animation and
  // left the backdrop stuck over the viewport). A state + a timer cannot fail
  // to complete.
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef(null)
  const FAN_OUT_MS = 120 + 30 * 2 + 40 // last item's exit delay + its duration + slack
  const requestClose = useCallback(() => {
    if (!motionOn) { setShowMore(false); return }
    setClosing(true)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => { setShowMore(false); setClosing(false) }, FAN_OUT_MS)
  }, [motionOn])
  // Force-close on any route change — synchronously, skipping the retract.
  // Defensive, as before: whatever the animation state, a navigation must
  // never leave a backdrop over the new page.
  useEffect(() => { clearTimeout(closeTimer.current); setShowMore(false); setClosing(false) }, [location.pathname])
  useEffect(() => () => clearTimeout(closeTimer.current), [])
```

Add `useCallback` to the react import.

(b) Replace every `setShowMore(false)` inside the popover (backdrop `onClick`, item `onClick`) with `requestClose()`; the item `onClick` becomes `() => { requestClose(); navigate(to) }` (the route change force-unmounts anyway). The `isTucked` line keeps `!showMore`. The More tab's own `onClick` must cancel a retract in progress: `() => { if (motionOn) haptic('light'); clearTimeout(closeTimer.current); setClosing(false); setShowMore(true) }`.

(c) Replace the popover's inner card (lines 274-301, the `<div style={{ background: 'var(--surface)', ... gridTemplateColumns ... }}>` and its children) with a motion-aware version. With motion **off** keep that block character-for-character. With motion **on** render per-item cards:

```jsx
            {!motionOn ? (
              <div style={{
                background: 'var(--surface)', border: '0.5px solid var(--line)',
                borderRadius: 'var(--r-sheet)', boxShadow: 'var(--shadow-lg)',
                padding: 8, display: 'grid',
                gridTemplateColumns: `repeat(${moreItems.length}, 1fr)`, gap: 8,
              }}>
                {moreItems.map(({ to, Icon, label }) => {
                  const active = location.pathname.startsWith(to)
                  return (
                    <button key={to} onClick={() => { requestClose(); navigate(to) }} style={MORE_ITEM(active)}>
                      <Icon size={24} strokeWidth={active ? 2 : 1.6} color={active ? 'var(--ink)' : 'var(--ink-mute)'} />
                      <span style={{ fontSize: 12, fontWeight: active ? 600 : 500, color: active ? 'var(--ink)' : 'var(--ink-mute)' }}>{label}</span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${moreItems.length}, 1fr)`, gap: 8 }}>
                {moreItems.map(({ to, Icon, label }, i) => {
                  const active = location.pathname.startsWith(to)
                  const n = moreItems.length
                  const order = n - 1 - i             // 0 = nearest the More tab (last in DOM, both directions)
                  return (
                    <motion.button
                      key={to}
                      data-fan-item={order}
                      initial={{ opacity: 0, y: 16, scale: 0.9 }}
                      animate={closing
                        ? { opacity: 0, y: 12, scale: 0.9, transition: { duration: 0.12, delay: i * 0.03 } }
                        : { opacity: 1, y: 0, scale: 1, transition: { ...FAN_SPRING, delay: order * FAN_STAGGER } }}
                      onClick={() => { requestClose(); navigate(to) }}
                      style={{
                        ...MORE_ITEM(active),
                        background: active ? 'var(--surface-2)' : 'var(--surface)',
                        border: '0.5px solid var(--line)', boxShadow: 'var(--shadow-md)',
                        transformOrigin: '50% 100%',
                      }}
                    >
                      <Icon size={24} strokeWidth={active ? 2 : 1.6} color={active ? 'var(--ink)' : 'var(--ink-mute)'} />
                      <span style={{ fontSize: 12, fontWeight: active ? 600 : 500, color: active ? 'var(--ink)' : 'var(--ink-mute)' }}>{label}</span>
                    </motion.button>
                  )
                })}
              </div>
            )}
```

and hoist the shared item style + constants above the component:

```jsx
const FAN_SPRING = { type: 'spring', duration: 0.32, bounce: 0.12 }
const FAN_STAGGER = 0.04
const MORE_ITEM = (active) => ({
  background: active ? 'var(--surface-2)' : 'transparent',
  border: active ? '0.5px solid var(--line)' : '0.5px solid transparent',
  cursor: 'pointer', borderRadius: 'var(--r-card)', minHeight: 64,
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '12px 8px', fontFamily: 'inherit',
})
```

(d) The wrapper `<div className="fixed left-0 right-0 z-50 md:hidden" data-motion-more=...>` gains `data-closing={motionOn && closing ? 'true' : undefined}`. The backdrop `<div ... data-motion-more-backdrop>` becomes, with motion on, a `motion.div` with `initial={{ opacity: 0 }} animate={{ opacity: closing ? 0 : 1 }} transition={{ duration: closing ? 0.12 : 0.16 }}`; with motion off it stays the plain `div` (keep the two branches explicit, like the card).

(e) `src/motion/motion.css` lines 291-308: the enter is now framer-driven, so delete the `zm-more-in` rule and keyframes and the `[data-motion-more-backdrop]` rule; replace the section with:

```css
/* ── More menu ───────────────────────────────────────────────────────────
 * The fan-out is driven by framer in BottomNav.jsx (per-item springs with a
 * stagger, retract in reverse). Still no AnimatePresence: the retract is a
 * `closing` state plus a timer. Nothing to do here except reduced motion. */
```

and in the reduced-motion block replace line 369 with nothing (framer honours `reducedMotion="user"`: the y/scale travel is dropped, opacity stays).

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/components/layout/__tests__/BottomNav.more.test.jsx src/components/layout/__tests__/BottomNav.depth.test.jsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Manual check**

Phone width: tap More — three cards rise one after another from the More side; tap the backdrop — they retract in reverse; tap an item — navigation happens, nothing lingers. Cold start test: hard-reload on `/`, tap More, immediately tap Devices (lazy chunk): no stuck backdrop. RTL: order still starts next to the More tab.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/BottomNav.jsx src/motion/motion.css src/components/layout/__tests__/BottomNav.more.test.jsx
git commit -m "feat(nav): More menu fans out and retracts (pick C) without AnimatePresence

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Bottom nav condenses on scroll (instead of tucking)

Port of lab `ScrollB` (`Navigation.jsx:556-565`): scrolling down condenses the bar to icons only; scrolling up (or reaching the top) restores it. The operator's note *"but add more padding up top"*: the lab condensed to 38 px with the icon jammed under the top edge. **Interpretation used here:** the condensed row is 40 px with the icon vertically centred (8 px above it), which is the extra top padding. If the operator meant the page's top padding, that is a one-line change to `--page-pt` and is called out in the handoff.

**Files:**
- Modify: `src/components/layout/BottomNav.jsx` (`isTucked`, nav attributes, grid row)
- Modify: `src/components/layout/AppShell.jsx:42-71, 343, 347` (chat-bubble coupling)
- Modify: `src/motion/motion.css:263-273` + reduced-motion lines `:366, :374`
- Modify: `src/motion/README.md:90`
- Test: `src/components/layout/__tests__/BottomNav.condense.test.jsx`

**Interfaces:**
- Consumes: `tucked` prop from `AppShell` (unchanged name; semantics now "condense").
- Produces: `data-motion-nav` + `data-condensed="true|false"` on the `<nav>`; `data-nav-row` on the tab grid; `data-nav-label` on each label. `data-tucked` is no longer emitted.

- [ ] **Step 1: Write the failing test**

```jsx
// src/components/layout/__tests__/BottomNav.condense.test.jsx
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../lib/i18n', async (orig) => ({ ...(await orig()), useT: () => (k) => k, useLang: () => 'en', useIsRTL: () => false }))
vi.mock('../../../stores/featuresStore', () => ({ useFeature: () => true }))
vi.mock('../../../stores/authStore', () => ({ useAuthStore: () => ({ role: 'user' }) }))

import { setMotion } from '../../../motion/flag'
import { BottomNav } from '../BottomNav'

const mount = (motion, props) => { setMotion(motion); return render(<MemoryRouter initialEntries={['/']}><BottomNav connected {...props} /></MemoryRouter>) }

describe('BottomNav condense', () => {
  beforeEach(() => localStorage.clear())
  it('motion on + tucked: emits data-condensed="true" and never data-tucked', () => {
    const { container } = mount(true, { tucked: true })
    const nav = container.querySelector('nav')
    expect(nav.getAttribute('data-condensed')).toBe('true')
    expect(nav.hasAttribute('data-tucked')).toBe(false)
    expect(container.querySelector('[data-nav-row]')).not.toBeNull()
    expect(container.querySelectorAll('[data-nav-label]').length).toBe(5)
  })
  it('offline strip pins the bar open', () => {
    const { container } = mount(true, { tucked: true, connected: false })
    expect(container.querySelector('nav').getAttribute('data-condensed')).toBe('false')
  })
  it('motion off: no condense attributes', () => {
    const { container } = mount(false, { tucked: true })
    const nav = container.querySelector('nav')
    expect(nav.hasAttribute('data-condensed')).toBe(false)
    expect(nav.hasAttribute('data-motion-nav')).toBe(false)
    expect(container.querySelector('[data-nav-row]')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/layout/__tests__/BottomNav.condense.test.jsx`
Expected: FAIL — `data-condensed` missing.

- [ ] **Step 3: Implement**

(a) `BottomNav.jsx`: rename the local `isTucked` to `isCondensed` (same expression). On the `<nav>`, replace `data-tucked={...}` with `data-condensed={motionOn ? (isCondensed ? 'true' : 'false') : undefined}`. Update the "Tuck" comment to "Condense". On the tab grid `<div ref={gridRef} ...>` add `data-nav-row={motionOn ? 'true' : undefined}`. In `DepthCell` (Task 4) and the motion-off branch, give the label `<span>` `data-nav-label={motionOn ? 'true' : undefined}` — pass `motionOn` through (it already is).

(b) `src/motion/motion.css` lines 263-273 become:

```css
/* ── Bottom nav ──────────────────────────────────────────────────────────
 * Condenses as you scroll down (56 → 40px, labels fade, icons stay under
 * the thumb) and restores on the first upward scroll or at the top. This is
 * the layer's second deliberate layout animation: `height` on a FIXED
 * element, so nothing else on the page reflows. 40px, not the lab's 38px:
 * the icon sits centred with 8px above it rather than under the top edge
 * (the operator asked for more room up top). */

[data-motion="on"] [data-motion-nav] [data-nav-row] {
  transition: height 400ms var(--m-out);
}
[data-motion="on"] [data-motion-nav][data-condensed="true"] [data-nav-row] {
  height: 40px;
}
[data-motion="on"] [data-motion-nav] [data-nav-label] {
  transition: opacity 160ms var(--m-std);
}
[data-motion="on"] [data-motion-nav][data-condensed="true"] [data-nav-label] {
  opacity: 0;
}
/* The chat bubble keeps its 16px breath above the bar as it condenses. */
[data-motion="on"] [data-motion-nav] ~ .z-chat-bubble {
  transition: inset-block-end 400ms var(--m-out);
}
[data-motion="on"] [data-motion-nav][data-condensed="true"] ~ .z-chat-bubble {
  inset-block-end: calc(var(--nav-h) - 16px + max(var(--safe-bottom), 8px) + 16px);
}
```

The cell's `TAB_CELL` already centres its column (`justifyContent: 'center'`), so at 40 px the 26 px icon lands at 7 px from the top once the label is invisible but still laid out — add to `TAB_CELL` nothing; instead the condensed row clips via the row's `overflow: hidden`: add `overflow: 'hidden'` to the grid style only when `motionOn` (`...(motionOn ? { overflow: 'hidden' } : null)`).

Reduced-motion lines: replace `:366` with `[data-motion="on"] [data-motion-nav][data-condensed="true"] [data-nav-row] { height: 56px; }` and `[data-motion="on"] [data-motion-nav][data-condensed="true"] [data-nav-label] { opacity: 1; }` (the bar never condenses under reduced motion, like it never tucked); same for the mirrored `:374` line, and add the mirrored chat-bubble override to inherit the default `inset-block-end` (`inset-block-end: calc(var(--nav-h) + max(var(--safe-bottom), 8px) + 16px)`).

(c) `AppShell.jsx`: delete `CHAT_BUBBLE_TUCK_CSS` (lines 42-71) and the `{motionOn && <style>{CHAT_BUBBLE_TUCK_CSS}</style>}` line (347); the bubble follows the bar through the CSS above. The `<BottomNav tucked={motionOn && navTucked} />` call stays.

(d) `src/motion/README.md:90`: `| \`data-motion-nav\` + \`data-condensed\` | the bottom nav | condenses to icons on scroll down |`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/layout/__tests__/`
Expected: PASS (all three BottomNav files).

- [ ] **Step 5: Manual check**

Phone width on `/devices` (long list): scroll down — the bar shrinks to icons, the chat bubble rides down with it; scroll up — it restores. Open a modal while condensed: it restores (overlay guard). Reduced motion: no condense.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/BottomNav.jsx src/components/layout/AppShell.jsx src/motion/motion.css src/motion/README.md src/components/layout/__tests__/BottomNav.condense.test.jsx
git commit -m "feat(nav): bottom nav condenses on scroll (pick B) instead of tucking

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Sidebar accent bar

Port of lab `SidebarDemo` variant C (`Navigation.jsx:651`): a 3 px accent bar on the inline-start edge travels between items on `{spring 0.4, bounce 0.1}`; the filled pill is not drawn. **This is a resting-look change with motion on** (the operator chose it); with motion off the sidebar keeps its pill, untouched. The existing hand-over rule (`motion.css:283-289`) already blanks `.z-nav-item.active` while a highlight exists, so it is reused as-is.

**Files:**
- Modify: `src/components/layout/Sidebar.jsx:1, 97-112`
- Modify: `src/motion/motion.css:278-289` (comment only)
- Modify: `src/motion/README.md:91`
- Test: `src/components/layout/__tests__/Sidebar.accentBar.test.jsx`

**Interfaces:**
- Produces: `[data-motion-nav-bar]` element inside each `NavGroup` when motion is on and a measurement exists.

- [ ] **Step 1: Write the failing test**

```jsx
// src/components/layout/__tests__/Sidebar.accentBar.test.jsx
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../lib/i18n', async (orig) => ({ ...(await orig()), useT: () => (k) => k, useLang: () => 'en' }))
vi.mock('../../../stores/featuresStore', () => ({ useFeature: () => true }))
vi.mock('../../../stores/authStore', () => ({ useAuthStore: () => ({ role: 'user' }) }))
vi.mock('../../../stores/uiStore', () => ({ useUIStore: () => ({ theme: 'light', toggleTheme: () => {} }) }))
vi.mock('../../ui/Logo', () => ({ default: () => null }))

import { setMotion } from '../../../motion/flag'
import { Sidebar } from '../Sidebar'

const mount = (motion, path = '/rooms') => { setMotion(motion); return render(<MemoryRouter initialEntries={[path]}><Sidebar connected /></MemoryRouter>) }

describe('Sidebar accent bar', () => {
  beforeEach(() => localStorage.clear())
  it('motion on: the primary group draws one accent bar and hands the surface over', () => {
    const { container } = mount(true)
    const groups = container.querySelectorAll('[data-motion-nav-group]')
    expect(groups.length).toBe(2)
    expect(groups[0].getAttribute('data-motion-hl')).toBe('true')
    expect(groups[0].querySelector('[data-motion-nav-bar]')).not.toBeNull()
    expect(groups[1].querySelector('[data-motion-nav-bar]')).toBeNull()
    expect(container.querySelector('[data-motion-nav-hl]')).toBeNull()
  })
  it('motion off: no bar, the active item keeps its own class', () => {
    const { container } = mount(false)
    expect(container.querySelector('[data-motion-nav-bar]')).toBeNull()
    expect(container.querySelector('[data-motion-nav-group]')).toBeNull()
    expect(container.querySelector('.z-nav-item.active')?.getAttribute('href')).toBe('/rooms')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/layout/__tests__/Sidebar.accentBar.test.jsx`
Expected: FAIL — `[data-motion-nav-bar]` missing.

- [ ] **Step 3: Implement**

`Sidebar.jsx`: add `import { motion } from 'framer-motion'` and `const BAR_SPRING = { type: 'spring', duration: 0.4, bounce: 0.1 }` near the top. Replace the highlight element (lines 97-112) with:

```jsx
      {motionOn && hl && (
        // A 3px accent bar on the leading edge, inset 8px from the row's top
        // and bottom. The row's own surface is handed over to nothing (see
        // motion.css's hand-over rule): the operator chose the quiet row.
        <motion.div
          data-motion-nav-bar
          aria-hidden="true"
          initial={false}
          animate={{ y: hl.y + 8, height: Math.max(8, hl.h - 16) }}
          transition={BAR_SPRING}
          style={{
            position: 'absolute', insetInlineStart: 0, top: 0,
            width: 3, borderRadius: 3, background: 'var(--accent)',
            pointerEvents: 'none',
          }}
        />
      )}
```

Update the `NavGroup` comment (lines 50-55) to describe the bar. In `src/motion/motion.css` lines 278-289, change the comment's first lines to: `/* Sidebar: while the accent bar is drawn (data-motion-hl), the active item's own surface is suppressed — the bar IS the active state with the layer on. With the layer off the pill is untouched. */` and keep the two rules. `README.md:91`: `| \`data-motion-nav-bar\` | the **sidebar**'s active accent bar | slides between items |`.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/components/layout/__tests__/Sidebar.accentBar.test.jsx`
Expected: PASS.

- [ ] **Step 5: Manual check at ≥ 768 px**

Click between sidebar items: the bar slides; the row behind it has no filled pill; hover still shows the hover surface on non-active rows. RTL: the bar is on the right edge. Reduced motion: the bar jumps (framer `reducedMotion="user"` drops the `y` travel). `?motion=off`: the pill is back.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/Sidebar.jsx src/motion/motion.css src/motion/README.md src/components/layout/__tests__/Sidebar.accentBar.test.jsx
git commit -m "feat(nav): sidebar accent bar (pick C) replaces the sliding pill with motion on

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: iOS parallax push — `PageTransition`

Port of lab `PushB` (`PageTransitions.jsx:99-122`) into `AppShell`. Forward: the new page slides in from inline-end (0.42 s, drawer curve) over the old page, which recedes 30 % and dims to 35 %, a 12 px shadow on the incoming edge. Back: reverse, 15 % faster, ease-out.

**How both pages are mounted without AnimatePresence.** `useOutlet()` gives the current page element every render. On a pathname change the *previous render's* outlet element is frozen into `prev` (together with the scroller's `scrollTop`) and rendered inside an absolutely positioned, inert overlay whose inner content is translated by `-scrollTop` so the slice the person was looking at stays where it was. The live `<Outlet/>` renders in flow as the entering layer (so the scroller's height is the new page's). The overlay is dropped on `onAnimationComplete` **or** by a watchdog timeout, whichever first. No handshake exists to be dropped: the entering layer is a plain mount with `initial`→`animate`, and the overlay's removal is a timer.

**What is skipped.** First mount (no `prev`), `pagesOn === false`, reduced motion, and any navigation into or out of `/rooms/:id` (the room FLIP in `morph.js` owns that route pair) all render today's `<div data-motion-enter>` wrapper instead.

**Files:**
- Create: `src/motion/PageTransition.jsx`
- Modify: `src/components/layout/AppShell.jsx:1-2, 12-14, 265-271, 306-336`
- Modify: `src/motion/motion.css:144-188` (comment) and `:383-388` (hygiene)
- Modify: `src/motion/README.md` (new section)
- Test: `src/motion/__tests__/PageTransition.test.jsx`

**Interfaces:**
- Consumes: `isPagesOn/usePagesOn` (Task 3), `EASE` (Task 1), `enterBack` and `rtl` already computed in `AppShell`.
- Produces: `export function PageTransition({ pathKey, back, rtl, enabled, scrollerRef, renderPage, children })` where `children` is the live routed element and `renderPage(el, key)` wraps a cached element in its own Suspense + ErrorBoundary. Exports `PUSH_MS = 420`, `POP_MS = 357`, `PARALLAX = 0.3`, `DIM = 0.35`. The entering layer carries `data-motion-enter={back ? 'back' : 'true'}` and `data-motion-page="enter"`; the overlay carries `data-motion-page="exit"`. Also exports `useLastExited()` → `{ el, scrollTop } | null` for Task 9 (the under-page during swipe-back); the component keeps the last dropped overlay element in a ref for 30 s.

- [ ] **Step 1: Write the failing test**

```jsx
// src/motion/__tests__/PageTransition.test.jsx
import React, { Suspense, lazy } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'

import { PageTransition, PUSH_MS } from '../PageTransition'

const renderPage = (el, key) => <Suspense key={key} fallback={<div data-testid="fallback" />}>{el}</Suspense>
const Page = ({ name }) => <div data-testid={`page-${name}`}>{name}</div>

function Harness({ path, back = false, enabled = true, rtl = false, tick = 0 }) {
  const scrollerRef = React.useRef({ scrollTop: 0 })
  return (
    <div data-tick={tick}>
      <PageTransition pathKey={path} back={back} rtl={rtl} enabled={enabled} scrollerRef={scrollerRef} renderPage={renderPage}>
        <Page name={path} />
      </PageTransition>
    </div>
  )
}

describe('PageTransition', () => {
  beforeEach(() => vi.useFakeTimers())

  it('first mount: no overlay, today\'s enter wrapper', () => {
    const { container } = render(<Harness path="/" />)
    expect(container.querySelector('[data-motion-page="exit"]')).toBeNull()
    expect(container.querySelector('[data-motion-enter]')).not.toBeNull()
  })

  it('forward: overlays the old page, marks the new one, drops the overlay by the watchdog', () => {
    const { container, rerender } = render(<Harness path="/" />)
    rerender(<Harness path="/rooms" />)
    expect(container.querySelector('[data-motion-page="exit"] [data-testid="page-/"]')).not.toBeNull()
    expect(container.querySelector('[data-motion-page="enter"] [data-testid="page-/rooms"]')).not.toBeNull()
    expect(container.querySelector('[data-motion-page="enter"]').getAttribute('data-motion-enter')).toBe('true')
    act(() => { vi.advanceTimersByTime(PUSH_MS + 400) })
    expect(container.querySelector('[data-motion-page="exit"]')).toBeNull()
    const enter = container.querySelector('[data-motion-page="enter"]')
    expect(enter.style.transform === '' || enter.style.transform === 'none').toBe(true)
  })

  it('back: the entering wrapper is marked back', () => {
    const { container, rerender } = render(<Harness path="/rooms" />)
    rerender(<Harness path="/" back />)
    expect(container.querySelector('[data-motion-page="enter"]').getAttribute('data-motion-enter')).toBe('back')
  })

  it('a re-render storm mid-transition cannot leave the page stuck', () => {
    const { container, rerender } = render(<Harness path="/" />)
    rerender(<Harness path="/devices" />)
    for (let i = 1; i <= 20; i++) rerender(<Harness path="/devices" tick={i} />)
    act(() => { vi.advanceTimersByTime(PUSH_MS + 400) })
    expect(container.querySelector('[data-motion-page="exit"]')).toBeNull()
    expect(container.querySelector('[data-testid="page-/devices"]')).not.toBeNull()
    const enter = container.querySelector('[data-motion-page="enter"]')
    expect(enter.style.opacity === '' || enter.style.opacity === '1').toBe(true)
  })

  it('a lazy page that suspends shows the fallback inside the entering layer', async () => {
    let resolve
    const Lazy = lazy(() => new Promise(r => { resolve = r }))
    function H({ path }) {
      const scrollerRef = React.useRef({ scrollTop: 0 })
      return (
        <PageTransition pathKey={path} back={false} rtl={false} enabled scrollerRef={scrollerRef} renderPage={renderPage}>
          <Suspense fallback={<div data-testid="fallback" />}>{path === '/lazy' ? <Lazy /> : <Page name={path} />}</Suspense>
        </PageTransition>
      )
    }
    const { container, rerender } = render(<H path="/" />)
    rerender(<H path="/lazy" />)
    expect(container.querySelector('[data-motion-page="enter"] [data-testid="fallback"]')).not.toBeNull()
    await act(async () => { resolve({ default: () => <div data-testid="page-lazy" /> }) })
    expect(container.querySelector('[data-testid="page-lazy"]')).not.toBeNull()
  })

  it('disabled: today\'s wrapper only, no overlay, no entering layer', () => {
    const { container, rerender } = render(<Harness path="/" enabled={false} />)
    rerender(<Harness path="/rooms" enabled={false} />)
    expect(container.querySelector('[data-motion-page="exit"], [data-motion-page="enter"]')).toBeNull()
    expect(container.querySelector('[data-motion-page="current"][data-motion-enter]')).not.toBeNull()
  })

  it('rtl flips the travel sign', () => {
    const { container, rerender } = render(<Harness path="/" rtl />)
    rerender(<Harness path="/rooms" rtl />)
    expect(container.querySelector('[data-motion-page="enter"]').getAttribute('data-motion-dir')).toBe('-1')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/motion/__tests__/PageTransition.test.jsx`
Expected: FAIL — cannot resolve `../PageTransition`.

- [ ] **Step 3: Write `src/motion/PageTransition.jsx`**

```jsx
// Page transitions: the iOS push, without the two failure modes that
// black-screened the app before (AppShell.jsx keeps the record).
//
//   1. There is NO AnimatePresence and NO exit→enter handshake. The entering
//      page is a plain mount with initial→animate. The outgoing page is a
//      frozen React element (the previous render's outlet) painted in an
//      inert overlay, and the overlay is removed by onAnimationComplete OR
//      a watchdog timer — whichever fires first. A dropped callback cannot
//      strand anything.
//   2. The two pages never share normal flow. The entering page is in flow
//      (so the scroller's height is the new page's); the outgoing page is
//      position:absolute inside a relative stage with overflow-x clipped,
//      its content translated up by the scroll position it was at, so the
//      slice the person was looking at stays put while it recedes.
//
// Forward: new page slides in from inline-end over the old one, which moves
// 30% the other way and dims to 35%; a 12px shadow rides the incoming edge.
// Back: the reverse, 15% faster, on the strong ease-out.
//
// Skipped (today's keyed CSS-enter wrapper is rendered instead): first mount,
// `enabled` false (the ?pages=off switch, reduced motion, the room FLIP's
// routes — AppShell decides), and any key change while a previous overlay
// is still running (the new page simply replaces the entering layer; the
// running overlay finishes on its own clock).

import { useEffect, useLayoutEffect, useReducer, useRef } from 'react'
import { motion } from 'framer-motion'
import { EASE } from '../lib/motion'

export const PUSH_MS = 420
export const POP_MS = Math.round(PUSH_MS * 0.85)
export const PARALLAX = 0.3
export const DIM = 0.35
const WATCHDOG_MS = PUSH_MS + 300
const LAST_EXITED_TTL_MS = 30_000

const push = { duration: PUSH_MS / 1000, ease: EASE.drawer }
const pop = { duration: POP_MS / 1000, ease: EASE.out }

// The most recently dropped overlay, kept briefly so a swipe-back can show
// the page beneath (gestures.js). Module-level on purpose: there is one
// shell. Cleared after LAST_EXITED_TTL_MS so a stale page never resurfaces.
let _lastExited = null
let _lastExitedTimer = null
export function getLastExited() { return _lastExited }
function rememberExited(entry) {
  _lastExited = entry
  clearTimeout(_lastExitedTimer)
  _lastExitedTimer = setTimeout(() => { _lastExited = null }, LAST_EXITED_TTL_MS)
}

export function PageTransition({ pathKey, back, rtl, enabled, scrollerRef, renderPage, children }) {
  const sign = rtl ? -1 : 1
  const [, bump] = useReducer((x) => x + 1, 0)

  // Frozen during render, like AppShell's enterDir: a fact about the moment
  // of navigation. `lastChildren` is the previous render's outlet element.
  const stage = useRef({ key: pathKey, prev: null, lastChildren: children, seq: 0 })
  if (stage.current.key !== pathKey) {
    const scrollTop = scrollerRef?.current?.scrollTop || 0
    stage.current = {
      key: pathKey,
      seq: stage.current.seq + 1,
      lastChildren: children,
      prev: enabled && stage.current.lastChildren
        ? { key: stage.current.key, el: stage.current.lastChildren, scrollTop, back: !!back }
        : null,
    }
  } else {
    stage.current.lastChildren = children
  }
  const { prev, seq } = stage.current
  const active = enabled && prev !== null

  const drop = () => {
    if (!stage.current.prev) return
    rememberExited(stage.current.prev)
    stage.current.prev = null
    bump()
  }

  // Watchdog: whatever framer did or did not call, the overlay goes and the
  // entering layer is left untransformed.
  const enterRef = useRef(null)
  useEffect(() => {
    if (!active) return undefined
    const t = setTimeout(() => {
      drop()
      const el = enterRef.current
      if (el) { el.style.transform = ''; el.style.opacity = '' }
    }, WATCHDOG_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq, active])

  // Never let a transformed entering layer survive a key change that skips
  // the transition (e.g. the room FLIP route): clear before paint.
  useLayoutEffect(() => {
    if (active) return
    const el = enterRef.current
    if (el) { el.style.transform = ''; el.style.opacity = '' }
  }, [pathKey, active])

  if (!active) {
    // Today's keyed CSS-enter wrapper, inside the same stage so Task 9 can
    // paint an under-page beneath it during a swipe. `enterRef` stays bound
    // so the layout effect above can clear a leftover transform.
    return (
      <div data-motion-stage="" style={{ position: 'relative', overflowX: 'clip' }}>
        <div ref={enterRef} data-motion-page="current" data-motion-enter={back ? 'back' : true} key={pathKey}
          style={{ position: 'relative', zIndex: 1 }}>
          {children}
        </div>
      </div>
    )
  }

  const isBack = prev.back
  const t = isBack ? pop : push
  const enterFrom = isBack ? `${-PARALLAX * 100 * sign}%` : `${100 * sign}%`
  const exitTo = isBack ? `${100 * sign}%` : `${-PARALLAX * 100 * sign}%`
  const edgeShadow = `${-12 * sign}px 0 24px rgba(0,0,0,.18)`

  return (
    <div data-motion-stage="" style={{ position: 'relative', overflowX: 'clip' }}>
      <motion.div
        key={`exit-${prev.key}-${seq}`}
        data-motion-page="exit"
        aria-hidden="true"
        inert=""
        initial={{ x: 0 }}
        animate={{ x: exitTo }}
        transition={t}
        onAnimationComplete={drop}
        style={{
          position: 'absolute', top: 0, insetInlineStart: 0, width: '100%', height: 'var(--vh)',
          overflow: 'hidden', pointerEvents: 'none', background: 'var(--bg)',
          zIndex: isBack ? 2 : 0, boxShadow: isBack ? edgeShadow : 'none', willChange: 'transform',
        }}
      >
        <div style={{ transform: prev.scrollTop ? `translateY(-${prev.scrollTop}px)` : undefined }}>
          {renderPage(prev.el, prev.key)}
        </div>
        {!isBack && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: DIM }} transition={t}
            style={{ position: 'absolute', inset: 0, background: '#000', pointerEvents: 'none' }} />
        )}
      </motion.div>

      <motion.div
        key={`enter-${pathKey}-${seq}`}
        ref={enterRef}
        data-motion-page="enter"
        data-motion-enter={isBack ? 'back' : 'true'}
        data-motion-dir={sign}
        initial={{ x: enterFrom }}
        animate={{ x: 0 }}
        transition={t}
        style={{
          position: 'relative', zIndex: isBack ? 1 : 2, background: 'var(--bg)',
          boxShadow: isBack ? 'none' : edgeShadow, willChange: 'transform',
        }}
      >
        {isBack && (
          <motion.div initial={{ opacity: DIM }} animate={{ opacity: 0 }} transition={t}
            style={{ position: 'absolute', inset: 0, background: '#000', pointerEvents: 'none', zIndex: 1 }} />
        )}
        {children}
      </motion.div>
    </div>
  )
}
```

Note: `inert=""` on a `motion.div` — React 18 passes unknown lowercase attributes through; the string form makes it render as `inert`. If React warns, use `{...{ inert: '' }}`.

- [ ] **Step 4: Wire it in `AppShell.jsx`**

(a) Imports: add `import { useOutlet } from 'react-router-dom'` to the existing router import (keep `Outlet` — see below), `import { usePagesOn } from '../../motion/pages'`, `import { useReducedMotion } from 'framer-motion'`, `import { PageTransition } from '../../motion/PageTransition'`.

(b) Replace the `routed` definition (lines 265-271) with:

```jsx
  // A cached page (the overlay in PageTransition) gets its own Suspense +
  // ErrorBoundary so an error or a late chunk in the OUTGOING page can never
  // reach the entering one.
  const renderPage = useCallback((el, key) => (
    <Suspense fallback={<div aria-hidden style={{ minHeight: '60vh' }} />}>
      <ErrorBoundary label={`route-exit:${key}`} key={key} fullHeight={false}>{el}</ErrorBoundary>
    </Suspense>
  ), [])
  const outlet = useOutlet()
  const routed = (
    <Suspense fallback={<div aria-hidden style={{ minHeight: '60vh' }} />}>
      <ErrorBoundary label={`route:${location.pathname}`} key={location.pathname} fullHeight={false}>
        {outlet}
      </ErrorBoundary>
    </Suspense>
  )
```

(`useOutlet()` returns exactly what `<Outlet/>` renders; using the element directly is what lets the previous render's element be frozen.)

(c) Decide when the slide runs. Below `const enterBack = ...` add:

```jsx
  // The room FLIP (morph.js) owns navigations into and out of /rooms/:id;
  // a slide over the top of it would be two stories about one movement.
  const pagesOn = usePagesOn()
  const reduced = useReducedMotion()
  const prevPathRef = useRef(location.pathname)
  const ROOM_DETAIL_RE = /^\/rooms\/[^/]+$/
  const roomPair = ROOM_DETAIL_RE.test(location.pathname) || ROOM_DETAIL_RE.test(prevPathRef.current)
  useEffect(() => { prevPathRef.current = location.pathname }, [location.pathname])
  const slide = motionOn && pagesOn && !reduced && !roomPair
```

(d) Replace lines 334-336 with:

```jsx
        {motionOn ? (
          <PageTransition
            pathKey={location.pathname}
            back={enterBack}
            rtl={rtl}
            enabled={slide}
            scrollerRef={mainRef}
            renderPage={renderPage}
          >
            {routed}
          </PageTransition>
        ) : routed}
```

(e) Rewrite the long comment (lines 306-333) to: keep the two-failure record verbatim, then replace the paragraph starting "The motion layer does NOT reintroduce one" with: "The motion layer's page slide lives in `src/motion/PageTransition.jsx`, which avoids both failures by construction (no AnimatePresence; the outgoing page is a frozen element in an absolute, inert overlay dropped by a timer). `?pages=off` turns only the slide off. The `data-motion-enter` attribute still carries the direction on the entering layer because `morph.js` looks it up."

(f) `src/motion/motion.css`: at lines 144-147 change the comment to say the CSS enter is the fallback used when the slide is skipped (first load, `?pages=off`, reduced motion, the room FLIP routes). Under Hygiene (383-388) add:

```css
/* A page mid-slide is a transformed ancestor; anything position:fixed inside
 * it is trapped for ≤420ms. Pages keep their fixed children out of the
 * routed tree (toasts, nav, bubble, dialogs are siblings or portals). */
```

(g) `src/motion/README.md`: add a short section "**Page push.**" after "A tile becomes the room." describing the forward/back story and pointing at `PageTransition.jsx` and `?pages=off`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/motion/__tests__/PageTransition.test.jsx && npx vitest run`
Expected: PageTransition 7 tests PASS; suite green except the pre-existing failure.

- [ ] **Step 6: Manual checks (all required)**

Dev server, phone width, motion on:
1. Dashboard → Devices → a device (opens as a sheet: no slide, as today) → promote → back: pages slide, back is reverse and faster.
2. Rooms list → a room: **no slide**, the tile FLIPs into the hero as before; back: FLIP return as before.
3. Scroll Devices to the bottom, open Settings via More: the Devices page recedes from the scrolled slice, not from its top.
4. WS storm: stop the backend container (or `docker compose stop ziggy` on the dev stack) while navigating repeatedly; restart; no page is ever left blank or offset.
5. Cold lazy route: hard reload on `/`, navigate to `/actions` (first load of its chunk): the placeholder slides in, content fills.
6. `?pages=off`: today's enter/back fades. `?motion=off`: today.
7. RTL: slide comes from the left.
8. Desktop ≥ 1024 with the chat dock open: the dock does not slide (it is outside `<main>`).

- [ ] **Step 7: Commit**

```bash
git add src/motion/PageTransition.jsx src/motion/__tests__/PageTransition.test.jsx src/components/layout/AppShell.jsx src/motion/motion.css src/motion/README.md
git commit -m "feat(motion): iOS parallax page push (pick B) with no handshake and a kill switch

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Swipe-back — rubber-band edge over the page beneath

Port of lab `SwipeBack` variant C (`PageTransitions.jsx:514-597`). The first 32 px of drag stretch the page's leading edge (`scaleX` 1→1.04 from the trailing edge) before it travels; then the page follows the finger with the previous page beneath at 30 % parallax and a dimming scrim. Commit past 30 % or 500 px/s; cancel springs home.

**Files:**
- Modify: `src/motion/gestures.js:59-166`
- Modify: `src/motion/PageTransition.jsx` (under-page layer while swiping)
- Modify: `src/components/layout/AppShell.jsx:208-216, 247-254`
- Test: `src/motion/__tests__/swipeBack.test.js`

**Interfaces:**
- Consumes: `getLastExited()` (Task 8).
- Produces: `useSwipeBack(ref, onBack, { enabled, rtl, onSwipe })` where `onSwipe(state)` is called with `'start' | 'end'`; the hook writes `el.style.transform = translate3d(dx) scaleX(peel)` and, if present, paints `[data-motion-under]` (a sibling found via `el.parentElement.querySelector('[data-motion-under]')`) with `translate3d((p-1)*PARALLAX*W)` and its scrim's opacity `DIM*(1-p)`. `PageTransition` gains `swiping` prop: while true it renders `getLastExited()` in a `[data-motion-under]` layer beneath the entering layer.

- [ ] **Step 1: Write the failing test**

```js
// src/motion/__tests__/swipeBack.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, act } from '@testing-library/react'
import { setMotion } from '../flag'
import { useSwipeBack } from '../gestures'

function Host({ onBack, onSwipe, rtl = false }) {
  const ref = React.useRef(null)
  useSwipeBack(ref, onBack, { enabled: true, rtl, onSwipe })
  return (
    <div data-testid="stage">
      <div data-motion-under="" data-testid="under"><div data-motion-scrim="" /></div>
      <div ref={ref} data-testid="page" style={{ width: 390 }} />
    </div>
  )
}
const ptr = (type, el, x, y = 10, id = 1) => el.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }), { pointerId: id, pointerType: 'touch' }))

describe('useSwipeBack (rubber-band edge)', () => {
  beforeEach(() => { setMotion(true); vi.useFakeTimers() })

  it('peels before it travels, then follows the finger', () => {
    const { getByTestId } = render(<Host onBack={() => {}} />)
    const page = getByTestId('page')
    page.getBoundingClientRect = () => ({ left: 0, right: 390, width: 390, top: 0, bottom: 800 })
    ptr('pointerdown', page, 4)
    ptr('pointermove', page, 20)   // 16px: inside the 32px peel
    expect(page.style.transform).toMatch(/translate3d\(0px,0,0\) scaleX\(1\.0[12]/)
    ptr('pointermove', page, 84)   // 80px: 48px of travel past the peel
    expect(page.style.transform).toMatch(/translate3d\(48px,0,0\) scaleX\(1(\.0+)?\)/)
    expect(getByTestId('under').style.transform).toMatch(/translate3d\(-\d+(\.\d+)?px,0,0\)/)
  })

  it('tells the host when a swipe starts and ends', () => {
    const onSwipe = vi.fn()
    const { getByTestId } = render(<Host onBack={() => {}} onSwipe={onSwipe} />)
    const page = getByTestId('page')
    page.getBoundingClientRect = () => ({ left: 0, right: 390, width: 390, top: 0, bottom: 800 })
    ptr('pointerdown', page, 4); ptr('pointermove', page, 40)
    expect(onSwipe).toHaveBeenCalledWith('start')
    ptr('pointerup', page, 40)
    act(() => { vi.advanceTimersByTime(300) })
    expect(onSwipe).toHaveBeenLastCalledWith('end')
  })

  it('commits once even if transitionend fires per property and the timer also fires', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Host onBack={onBack} />)
    const page = getByTestId('page')
    page.getBoundingClientRect = () => ({ left: 0, right: 390, width: 390, top: 0, bottom: 800 })
    ptr('pointerdown', page, 4); ptr('pointermove', page, 300); ptr('pointerup', page, 300)
    page.dispatchEvent(new Event('transitionend')); page.dispatchEvent(new Event('transitionend'))
    act(() => { vi.advanceTimersByTime(400) })
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('rtl: the edge is on the right and travel is negative', () => {
    const { getByTestId } = render(<Host onBack={() => {}} rtl />)
    const page = getByTestId('page')
    page.getBoundingClientRect = () => ({ left: 0, right: 390, width: 390, top: 0, bottom: 800 })
    ptr('pointerdown', page, 386); ptr('pointermove', page, 306)
    expect(page.style.transform).toMatch(/translate3d\(-48px,0,0\)/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/motion/__tests__/swipeBack.test.js`
Expected: FAIL — transform has no `scaleX`, `onSwipe` not called.

- [ ] **Step 3: Rewrite `useSwipeBack` in `src/motion/gestures.js`**

Replace lines 59-166 with:

```js
// ── Swipe back ──────────────────────────────────────────────────────────
// Drag from the leading edge to go back. The first 32px stretch the page's
// leading edge (scaleX 1→1.04 from the trailing edge) — a physical peel that
// says the gesture was recognised — and only then does the page travel, 1:1
// with the finger, over the previous page (painted beneath at 30% parallax
// by PageTransition). Commits past 30% of the width OR on a 500px/s flick;
// below that it springs home, so the gesture is always cancellable.
//
// `ref` is the element that moves. `onBack` runs on commit. `onSwipe` gets
// 'start' when the page begins to move and 'end' when it settles or
// cancels, so the host can mount the under-page only while it is needed.

const COMMIT_FRACTION = 0.3
const COMMIT_VELOCITY = 500
const EDGE = 32
const PEEL = 32
const PEEL_MAX = 0.04
const UNDER_PARALLAX = 0.3
const UNDER_DIM = 0.35

export function useSwipeBack(ref, onBack, { enabled = true, rtl = false, onSwipe } = {}) {
  const state = useRef(null)
  const vel = useRef(makeVelocityTracker())

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled || !isMotionOn()) return
    const sign = rtl ? -1 : 1
    const under = () => el.parentElement?.querySelector?.('[data-motion-under]') || null
    const origin = rtl ? '0% 50%' : '100% 50%'

    // dx is kept in state, never re-parsed from the transform string: with
    // scaleX in the same string a regex parse would swallow the scale.
    const paint = (dx, peel) => {
      el.style.transition = 'none'
      el.style.transformOrigin = origin
      el.style.transform = (dx || peel !== 1) ? `translate3d(${dx}px,0,0) scaleX(${peel})` : ''
      el.style.willChange = (dx || peel !== 1) ? 'transform' : ''
      const u = under()
      if (u && state.current) {
        const p = Math.min(1, Math.max(0, (dx * sign) / state.current.w))
        u.style.transition = 'none'
        u.style.transform = `translate3d(${(p - 1) * UNDER_PARALLAX * state.current.w * sign}px,0,0)`
        const scrim = u.querySelector('[data-motion-scrim]')
        if (scrim) scrim.style.opacity = String(UNDER_DIM * (1 - p))
      }
    }
    let width = 0 // the page width captured on pointerdown, for the under-page settle
    const settle = (dx, ms, then) => {
      el.style.transition = `transform ${ms}ms ${CSS_EASE.out}`
      el.style.transform = dx ? `translate3d(${dx}px,0,0) scaleX(1)` : 'translate3d(0,0,0) scaleX(1)'
      const u = under()
      if (u) {
        u.style.transition = `transform ${ms}ms ${CSS_EASE.out}`
        u.style.transform = dx ? 'translate3d(0,0,0)' : `translate3d(${-UNDER_PARALLAX * width * sign}px,0,0)`
        const scrim = u.querySelector('[data-motion-scrim]')
        if (scrim) { scrim.style.transition = `opacity ${ms}ms ${CSS_EASE.out}`; scrim.style.opacity = dx ? '0' : String(UNDER_DIM) }
      }
      // transitionend fires once per property and the timeout is a fallback
      // for when it does not fire at all, so completion MUST be idempotent:
      // a committed swipe once called navigate(-1) twice.
      let finished = false
      let timer = null
      const finish = () => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        el.removeEventListener('transitionend', finish)
        el.style.transition = ''
        el.style.willChange = ''
        el.style.transformOrigin = ''
        if (!then) el.style.transform = ''
        then?.()
        onSwipe?.('end')
      }
      el.addEventListener('transitionend', finish)
      timer = setTimeout(finish, ms + 80)
    }

    const down = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const r = el.getBoundingClientRect()
      const fromEdge = rtl ? r.right - e.clientX : e.clientX - r.left
      if (fromEdge > EDGE) return
      // Never start over something the person is actually using.
      if (e.target.closest?.('button, a, input, select, textarea, [role="slider"], [role="button"], [data-no-swipe]')) return
      state.current = { x0: e.clientX, y0: e.clientY, locked: null, w: r.width, dx: 0, started: false }
      width = r.width
      vel.current.start(e.clientX)
    }

    const move = (e) => {
      const s = state.current
      if (!s) return
      const dxRaw = (e.clientX - s.x0) * sign
      const dy = e.clientY - s.y0
      if (s.locked === null) {
        if (Math.abs(dxRaw) < 6 && Math.abs(dy) < 6) return
        // Direction lock: a mostly-vertical start belongs to the scroller.
        s.locked = Math.abs(dxRaw) > Math.abs(dy)
        if (!s.locked) { state.current = null; return }
        el.setPointerCapture?.(e.pointerId)
      }
      if (!s.started) { s.started = true; onSwipe?.('start') }
      vel.current.move(e.clientX)
      let travel, peel
      if (dxRaw <= 0) {
        // Resist the wrong direction rather than refusing it outright.
        travel = dxRaw * 0.18; peel = 1
      } else if (dxRaw <= PEEL) {
        travel = 0; peel = 1 + PEEL_MAX * (dxRaw / PEEL)
      } else {
        travel = dxRaw - PEEL
        peel = 1 + PEEL_MAX * Math.max(0, 1 - travel / 48)
      }
      s.dx = travel * sign
      paint(s.dx, Number(peel.toFixed(4)))
      e.preventDefault()
    }

    const up = () => {
      const s = state.current
      if (!s) return
      state.current = null
      if (s.locked !== true) return
      const dx = s.dx * sign
      const v = vel.current.get() * sign
      if (dx > s.w * COMMIT_FRACTION || v > COMMIT_VELOCITY) {
        settle(s.w * sign, 240, () => onBack?.())
      } else {
        settle(0, 200)
      }
    }

    el.addEventListener('pointerdown', down, { passive: true })
    el.addEventListener('pointermove', move, { passive: false })
    el.addEventListener('pointerup', up, { passive: true })
    el.addEventListener('pointercancel', up, { passive: true })
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.style.transform = ''
      el.style.transition = ''
      el.style.transformOrigin = ''
    }
  }, [ref, onBack, enabled, rtl, onSwipe])
}
```

- [ ] **Step 4: Under-page layer in `PageTransition`**

In `src/motion/PageTransition.jsx` add a `swiping` prop. In the `!active` branch and the active branch alike, wrap the output so the stage always exists when `swiping` is true:

```jsx
  const last = swiping ? getLastExited() : null
  const underLayer = swiping && last ? (
    <div data-motion-under="" aria-hidden="true" inert="" style={{
      position: 'absolute', top: 0, insetInlineStart: 0, width: '100%', height: 'var(--vh)',
      overflow: 'hidden', pointerEvents: 'none', background: 'var(--bg)', zIndex: 0,
      transform: `translate3d(${-PARALLAX * 100 * sign}%,0,0)`,
    }}>
      <div style={{ transform: last.scrollTop ? `translateY(-${last.scrollTop}px)` : undefined }}>
        {renderPage(last.el, `under-${last.key}`)}
      </div>
      <div data-motion-scrim="" style={{ position: 'absolute', inset: 0, background: '#000', opacity: DIM, pointerEvents: 'none' }} />
    </div>
  ) : null
```

and in the `!active` return, render `{underLayer}` as the first child of the stage and give the current layer `background: swiping ? 'var(--bg)' : undefined` so the under-page never shows through it.

The hook moves `<main>` today; it must now move the **current page layer**, not the scroller, so the under layer (a sibling inside the stage) is visible. Expose the layer: `PageTransition` accepts `pageRef` and attaches it to the current/entering layer (`ref={pageRef}` in both branches; keep `enterRef` as an internal ref via a merged callback: `ref={(n) => { enterRef.current = n; if (pageRef) pageRef.current = n }}`).

- [ ] **Step 5: Wire `AppShell`**

- Add `const pageRef = useRef(null)` and `const [swiping, setSwiping] = useState(false)`; `const onSwipe = useCallback((s) => setSwiping(s === 'start'), [])`.
- Change the hook call to `useSwipeBack(pageRef, onBack, { enabled: motionOn && isDetail && !isChatRoute, rtl, onSwipe })`.
- Pass `swiping={swiping}` and `pageRef={pageRef}` to `<PageTransition>`.
- In the per-route layout effect (lines 247-254) keep clearing `mainRef` (harmless) **and** clear `pageRef.current` the same way (`transition`, `transform`, `transformOrigin`, `willChange`), and `setSwiping(false)`.
- On commit, the swipe has already carried the page off-screen; the route change then runs the back transition whose entering page (the previous route, re-rendered live) starts at `-30%`, which is where the under-page was. Continuity holds.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/motion/__tests__/`
Expected: swipeBack 4 PASS, PageTransition PASS, pages PASS.

- [ ] **Step 7: Manual check**

Phone (touch) on a device page reached from the Devices list: drag from the left edge — the edge stretches, then the page follows with the list visible beneath; release early → springs back; past a third → commits, exactly once. Deep link (no page beneath): the gesture still works, no under-page. RTL: right edge.

- [ ] **Step 8: Commit**

```bash
git add src/motion/gestures.js src/motion/PageTransition.jsx src/components/layout/AppShell.jsx src/motion/__tests__/swipeBack.test.js src/motion/__tests__/PageTransition.test.jsx
git commit -m "feat(motion): swipe-back peels at the edge and reveals the page beneath (pick C)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Blur crossfade for tab bodies

Port of lab `TabsDemo` variant C (`PageTransitions.jsx:365-373`): tab bodies cross-fade with a 3 px blur and a 4 px rise (0.26 × 0.8 s, strong ease-out) under `AnimatePresence mode="popLayout"`, inside a `layout` container whose height springs (0.26 s, bounce 0) so the page below never jumps. Two sites: DeviceDetail Controls/Info (today a hard subtree swap across 15 interleaved blocks) and Actions Automatic/On-demand (today `mode="wait"` + `FADE_UP`).

**Files:**
- Create: `src/motion/TabCrossfade.jsx`
- Modify: `src/pages/DeviceDetail.jsx:1088-1092, 1219-1307, 1320-1740` (group into two keyed subtrees)
- Modify: `src/pages/Actions.jsx:3, 13, 479-483, 583-593`
- Test: `src/motion/__tests__/TabCrossfade.test.jsx`

**Interfaces:**
- Produces: `export function TabCrossfade({ tab, children, duration = 0.26 })`. With motion off (or reduced motion) renders `children` directly. With motion on renders the lab structure; `children` must be the body for the current `tab` (the component keys on `tab`).

- [ ] **Step 1: Write the failing test**

```jsx
// src/motion/__tests__/TabCrossfade.test.jsx
import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { setMotion } from '../flag'
import { TabCrossfade } from '../TabCrossfade'

describe('TabCrossfade', () => {
  beforeEach(() => localStorage.clear())
  it('motion on: keys the body on the tab and marks the container', () => {
    setMotion(true)
    const { container, rerender } = render(<TabCrossfade tab="a"><p>A</p></TabCrossfade>)
    expect(container.querySelector('[data-motion-tabs]')).not.toBeNull()
    expect(container.querySelector('[data-motion-tab="a"]')).not.toBeNull()
    rerender(<TabCrossfade tab="b"><p>B</p></TabCrossfade>)
    expect(container.querySelector('[data-motion-tab="b"]')?.textContent).toBe('B')
  })
  it('motion off: renders the children bare', () => {
    setMotion(false)
    const { container } = render(<TabCrossfade tab="a"><p>A</p></TabCrossfade>)
    expect(container.querySelector('[data-motion-tabs]')).toBeNull()
    expect(container.innerHTML).toBe('<p>A</p>')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/motion/__tests__/TabCrossfade.test.jsx`
Expected: FAIL — cannot resolve `../TabCrossfade`.

- [ ] **Step 3: Write `src/motion/TabCrossfade.jsx`**

```jsx
// Tab bodies cross-fade with a 3px blur and a 4px rise instead of being
// swapped in one frame. `mode="popLayout"` takes the exiting body out of
// flow so the two overlap instead of stacking; the outer `layout` container
// springs its height so the page below never jumps. Reduced motion: no blur,
// no rise, opacity only. With the layer off the children render bare.
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useMotionOn } from './flag'
import { EASE } from '../lib/motion'

export function TabCrossfade({ tab, children, duration = 0.26 }) {
  const motionOn = useMotionOn()
  const reduced = useReducedMotion()
  if (!motionOn) return children
  const fade = { duration: duration * 0.8, ease: EASE.out }
  const from = reduced ? { opacity: 0 } : { opacity: 0, filter: 'blur(3px)', y: 4 }
  const to = reduced ? { opacity: 1 } : { opacity: 1, filter: 'blur(0px)', y: 0 }
  const out = reduced ? { opacity: 0 } : { opacity: 0, filter: 'blur(3px)', y: -4 }
  return (
    <motion.div data-motion-tabs="" layout transition={{ type: 'spring', duration, bounce: 0 }} style={{ position: 'relative' }}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div key={tab} data-motion-tab={tab} initial={from} animate={to} exit={out} transition={fade}>
          {children}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  )
}
```

- [ ] **Step 4: Group DeviceDetail's tab bodies**

In `src/pages/DeviceDetail.jsx`: import `{ TabCrossfade }` from `'../motion/TabCrossfade'`. The 15 conditional blocks (`{showControls && ...}` at 1219 and 1253; `{showData && ...}` at 1320, 1375, 1412, 1425, 1438, 1480, 1494, 1533, 1562, 1630, 1724, 1727) are moved, unchanged in content and order, into two local render functions declared just above the `return`:

```jsx
  const controlsBody = (
    <>
      {/* …the two showControls blocks, with `showControls &&` removed from each… */}
    </>
  )
  const dataBody = (
    <>
      {/* …the twelve showData blocks, with `showData &&` removed from each… */}
    </>
  )
```

and the place they occupied renders:

```jsx
      {hasControls ? (
        <TabCrossfade tab={activeTab}>
          {activeTab === 'controls' ? controlsBody : dataBody}
        </TabCrossfade>
      ) : (
        <>{controlsBody}{dataBody}</>
      )}
```

Leave `showControls`/`showData` defined if anything else reads them; otherwise delete them (`grep -n "showControls\|showData" src/pages/DeviceDetail.jsx`). Note the `!hasControls` case renders both bodies with no crossfade, matching today.

- [ ] **Step 5: Replace Actions' `mode="wait"`**

In `src/pages/Actions.jsx`: import `{ TabCrossfade }` from `'../motion/TabCrossfade'`. Replace the opening at lines 479-483 (`<AnimatePresence mode="wait">` … `<motion.div key="automations" {...FADE_UP}>`) and the closing at 583-593 so the structure becomes:

```jsx
      <TabCrossfade tab={tab}>
        {tab === 'automations' ? (
          <div key="automations">
            {/* …unchanged Automations tab body… */}
          </div>
        ) : (
          <div key="routines">
            <RoutinesListPanel embedded />
          </div>
        )}
      </TabCrossfade>
```

Remove `FADE_UP` from the `lib/motion` import if nothing else uses it (`grep -n FADE_UP src/pages/Actions.jsx`); keep `motion, AnimatePresence` (the nested list still uses them). With motion off the inner `<div>`s render bare — identical to the pre-layer DOM except the removed `motion.div` wrapper (which rendered a `div` with inline `opacity`/`transform` styles; the resting styles were `opacity: 1; transform: none`, so the visible result is unchanged).

- [ ] **Step 6: Run the tests and build**

Run: `npx vitest run src/motion/__tests__/TabCrossfade.test.jsx && npx vitest run && npm run build`
Expected: PASS; suite green except the pre-existing failure; build OK.

- [ ] **Step 7: Manual check**

Device page: Controls ↔ Info cross-fade; the page height eases rather than jumps. Actions: Automatic ↔ On-demand likewise; deleting an automation still animates inside the list. Reduced motion: opacity-only. `?motion=off`: hard swap as today.

- [ ] **Step 8: Commit**

```bash
git add src/motion/TabCrossfade.jsx src/motion/__tests__/TabCrossfade.test.jsx src/pages/DeviceDetail.jsx src/pages/Actions.jsx
git commit -m "feat(motion): blur crossfade for tab bodies (pick C) on DeviceDetail and Actions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Gates — equivalence, crawl, docs

**Files:**
- Modify: `src/motion/README.md` (hooks table, "What it adds" list)
- Modify: `docs/motion-lab/README.md` (one line: Phase A shipped; which picks)
- Test: full suite + build + crawl

- [ ] **Step 1: Full suite and build**

Run: `npx vitest run && npm run build`
Expected: all green except `mergedIrAvailability.test.js`; build OK; `dist/` has no `lab` chunk referenced from `index.html` (`grep -c "lab" dist/index.html` → 0).

- [ ] **Step 2: Motion-off equivalence crawl**

With the dev server on `:3260` and the Chrome DevTools MCP (or Playwright), for each of `/`, `/rooms`, `/devices`, `/actions`, `/alerts`, `/settings`, `/devices/<any entity>`:
- load with `?motion=off` at 390 × 844 light, capture a screenshot;
- compare against the same route on a pre-branch build (check out `e44e163` in a second worktree on another port). Differences allowed: live data (clock, sensor values). Any chrome difference is a bug in a `motionOn` branch.

- [ ] **Step 3: Motion-on crawl**

Same routes, light/dark × LTR/RTL, motion on, pages on: navigate between every pair through the bottom nav and sidebar; zero console errors; no element left at `opacity: 0` or translated (`document.querySelectorAll('[data-motion-page]')` must be a single `current`/`enter` element 1 s after each navigation).

- [ ] **Step 4: Reduced motion crawl**

OS reduce motion on: no slide, no condense, no fan travel; opacity changes remain.

- [ ] **Step 5: Docs**

`src/motion/README.md`: hooks table rows for `data-nav-depth`, `data-fan-item`, `data-condensed`, `data-motion-nav-bar`, `data-motion-page`, `data-motion-tabs`; one paragraph each under "What it adds" for depth, fan-out, condense, accent bar, page push, tab crossfade, swipe peel. `docs/motion-lab/README.md`: add "Phase A (navigation + pages) implemented on `feat/motion-lab` — see `docs/superpowers/plans/2026-10-10-motion-a-foundation-nav-pages.md`."

- [ ] **Step 6: Commit**

```bash
git add src/motion/README.md ../docs/motion-lab/README.md
git commit -m "docs(motion): Phase A hooks and behaviours

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 7: Handoff to the operator (not a code step)**

Push `feat/motion-lab`, point the operator at the LAN URL for the thumb test (spec §7.6). Do **not** merge to `main` or tag until they have held it in Hebrew and English. Then: merge, `./scripts/ship.sh -m "motion: navigation + pages (phase A)"`, wait for Canary (~5 min report + ~12 min rebuild), `./scripts/fleet-health.py`.
