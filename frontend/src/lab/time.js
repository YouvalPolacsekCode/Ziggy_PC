// Motion Lab — time scaling.
//
// The lab has a global speed control so a 260ms transition can be watched at
// a quarter speed. framer-motion has no global time scale, so every demo passes
// its transition through `scaleTransition(t, speed)`:
//
//   - duration / delay / staggerChildren / delayChildren multiply by (1/speed)
//   - physics springs keep their SHAPE: stiffness /= k², damping /= k
//     (a spring's natural frequency is √(k/m), so dividing stiffness by k²
//     slows it by exactly k while damping ratio stays the same)
//   - Apple-style `{ duration, bounce }` springs simply scale duration
//
// CSS-driven demos read `--lab-speed` (a multiplier on durations) from the
// lab root instead. GSAP demos use `gsap.globalTimeline.timeScale(speed)`.

export function scaleTransition(t, speed = 1) {
  if (!t || speed === 1) return t
  const k = 1 / speed
  const out = { ...t }
  if (typeof out.duration === 'number') out.duration = out.duration * k
  if (typeof out.delay === 'number') out.delay = out.delay * k
  if (typeof out.staggerChildren === 'number') out.staggerChildren *= k
  if (typeof out.delayChildren === 'number') out.delayChildren *= k
  if (typeof out.repeatDelay === 'number') out.repeatDelay *= k
  if (out.type === 'spring') {
    if (typeof out.stiffness === 'number') out.stiffness = out.stiffness / (k * k)
    if (typeof out.damping === 'number') out.damping = out.damping / k
    if (typeof out.visualDuration === 'number') out.visualDuration *= k
  }
  // Per-property overrides ({ opacity: {...}, layout: {...} })
  for (const key of Object.keys(out)) {
    const v = out[key]
    if (v && typeof v === 'object' && !Array.isArray(v) && (v.duration || v.type || v.stiffness)) {
      out[key] = scaleTransition(v, speed)
    }
  }
  return out
}

// A spring described the Apple way, scaled.
export function spring(duration, bounce = 0, speed = 1) {
  return scaleTransition({ type: 'spring', duration, bounce }, speed)
}

// Named easings, shared with the app's motion vocabulary (src/motion/motion.js).
export const EASE = {
  out: [0.23, 1, 0.32, 1],
  glide: [0.33, 0.68, 0.15, 1],
  inOut: [0.77, 0, 0.175, 1],
  drawer: [0.32, 0.72, 0, 1],
  std: [0.4, 0, 0.2, 1],
  enter: [0.16, 1, 0.3, 1],
  standard: [0.2, 0, 0, 1],
  linear: [0, 0, 1, 1],
}

export const EASE_OPTIONS = [
  { key: 'out', label: 'ease-out (strong)' },
  { key: 'enter', label: 'enter (app --ease-enter)' },
  { key: 'glide', label: 'glide (large surfaces)' },
  { key: 'inOut', label: 'in-out (on-screen moves)' },
  { key: 'drawer', label: 'drawer (iOS sheet)' },
  { key: 'standard', label: 'standard (app --ease-standard)' },
  { key: 'std', label: 'material standard' },
  { key: 'linear', label: 'linear' },
]

export function cssEase(key) {
  const e = EASE[key] || EASE.out
  return `cubic-bezier(${e.join(', ')})`
}

// Durations from the app (seconds)
export const DUR = { press: 0.12, tap: 0.16, small: 0.2, ui: 0.26, sheet: 0.36, page: 0.42 }

// Springs from the app
export const SPRING = {
  snappy: { type: 'spring', duration: 0.32, bounce: 0.08 },
  gentle: { type: 'spring', duration: 0.5, bounce: 0.12 },
  calm: { type: 'spring', duration: 0.7, bounce: 0 },
  press: { type: 'spring', duration: 0.18, bounce: 0 },
  detent: { type: 'spring', stiffness: 520, damping: 34, mass: 0.9 },
}
