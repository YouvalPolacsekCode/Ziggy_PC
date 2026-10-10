// Ziggy motion layer — the vocabulary.
//
// This is Lumen's motion grammar lifted out of the Design Lab and pointed at
// the REAL app. It adds feel only: timing, easing, gesture, haptics. It never
// changes a colour, a size, a radius, a font or a layout value. If a change
// here would alter what the app looks like at rest, it does not belong here.
//
// Everything is gated on `[data-motion="on"]` (set by ./flag.js), so the
// untouched app is always one attribute away.
//
// Rules, from Apple's HIG › Motion and Emil Kowalski's animation work:
//   - motion answers an action; nothing loops for decoration
//   - enter uses ease-out; exit is FASTER than enter; never ease-in
//   - transform and opacity only (plus clip-path for reveals)
//   - no `transition: all`, no animating layout properties
//   - frequent interactions get little or no animation
//   - everything is interruptible and cancellable
//   - reduced motion keeps colour/opacity and drops travel, scale and loops

import { EASE, CSS_EASE, DUR, SPRING } from '../lib/motion'
export { EASE, CSS_EASE, DUR, SPRING }

// ── Reduced motion ─────────────────────────────────────────────────────
// One source of truth, live: the OS setting can change while the app is open.

let _reduced = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
  : false

if (typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  const onChange = (e) => {
    _reduced = e.matches
    document.documentElement.setAttribute('data-motion-reduced', e.matches ? 'true' : 'false')
  }
  mq.addEventListener?.('change', onChange)
  document.documentElement.setAttribute('data-motion-reduced', _reduced ? 'true' : 'false')
}

export const isReduced = () => _reduced

// ── Haptics ────────────────────────────────────────────────────────────
// Named after the HIG's feedback generators so the meaning is consistent:
// selection while a value changes, impact for a physical event, notification
// for the outcome of a task. Silent no-op wherever vibrate is unavailable
// (every desktop browser, and iOS Safari).

const PATTERNS = {
  selection: [6],
  light: [10],
  medium: [18],
  heavy: [28],
  success: [10, 40, 12],
  warning: [18, 60, 18],
  error: [24, 50, 24, 50, 24],
}

let _hapticsOn = true
export const setHaptics = (v) => { _hapticsOn = !!v }

export function haptic(kind = 'selection') {
  if (!_hapticsOn) return
  const pattern = PATTERNS[kind] || PATTERNS.selection
  try { navigator.vibrate?.(pattern) } catch { /* unsupported */ }
}

// ── Small helpers ──────────────────────────────────────────────────────

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// Velocity-aware target: where a flick would land if it decayed. Used by the
// sheet and by swipe-back so a fast, short gesture commits like a slow, long
// one does.
export function project(position, velocity, factor = 0.12) {
  return position + velocity * factor
}

export function nearest(value, points) {
  let best = points[0]
  for (const p of points) if (Math.abs(p - value) < Math.abs(best - value)) best = p
  return best
}

// Exponential moving average of pointer velocity in px/s. Raw deltas are too
// noisy to make a commit decision from.
export function makeVelocityTracker() {
  let v = 0
  let last = 0
  let lastT = 0
  return {
    start(pos) { v = 0; last = pos; lastT = performance.now() },
    move(pos) {
      const now = performance.now()
      const dt = Math.max(1, now - lastT)
      v = v * 0.5 + ((pos - last) / dt) * 0.5
      last = pos
      lastT = now
      return v * 1000
    },
    get() { return v * 1000 },
  }
}
