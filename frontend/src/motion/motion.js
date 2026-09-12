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

export const EASE = {
  out: [0.23, 1, 0.32, 1],       // strong ease-out — small moves, presses, chips
  glide: [0.33, 0.68, 0.15, 1],  // large surfaces: keeps speed through the middle
  inOut: [0.77, 0, 0.175, 1],    // on-screen movement, morphs
  drawer: [0.32, 0.72, 0, 1],    // iOS sheet curve
  std: [0.4, 0, 0.2, 1],         // hover, colour
}

export const CSS_EASE = {
  out: 'cubic-bezier(0.23, 1, 0.32, 1)',
  glide: 'cubic-bezier(0.33, 0.68, 0.15, 1)',
  inOut: 'cubic-bezier(0.77, 0, 0.175, 1)',
  drawer: 'cubic-bezier(0.32, 0.72, 0, 1)',
  std: 'cubic-bezier(0.4, 0, 0.2, 1)',
}

export const DUR = {
  press: 0.12,
  tap: 0.16,
  small: 0.2,
  ui: 0.26,
  sheet: 0.36,
  page: 0.42,
}

// Apple-style perceptual springs: duration + bounce, interruptible by nature.
export const SPRING = {
  snappy: { type: 'spring', duration: 0.32, bounce: 0.08 },
  gentle: { type: 'spring', duration: 0.5, bounce: 0.12 },
  calm: { type: 'spring', duration: 0.7, bounce: 0 },
  press: { type: 'spring', duration: 0.18, bounce: 0 },
  detent: { type: 'spring', stiffness: 520, damping: 34, mass: 0.9 },
}

// ── Reduced motion ─────────────────────────────────────────────────────
// One source of truth, live: the OS setting can change while the app is open.

let _reduced = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
  : false
const _reducedSubs = new Set()

if (typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  const onChange = (e) => {
    _reduced = e.matches
    document.documentElement.setAttribute('data-motion-reduced', e.matches ? 'true' : 'false')
    _reducedSubs.forEach((fn) => fn(e.matches))
  }
  mq.addEventListener?.('change', onChange)
  document.documentElement.setAttribute('data-motion-reduced', _reduced ? 'true' : 'false')
}

export const isReduced = () => _reduced
export function onReducedChange(fn) {
  _reducedSubs.add(fn)
  return () => _reducedSubs.delete(fn)
}

// A transition that degrades correctly: travel and scale vanish, timing stays
// short, opacity survives.
export function safe(transition, reducedTransition = { duration: 0.15 }) {
  return _reduced ? reducedTransition : transition
}

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
