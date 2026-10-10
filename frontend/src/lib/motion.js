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
