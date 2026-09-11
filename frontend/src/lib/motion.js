// One motion vocabulary for framer-motion call sites. CSS gets the same
// values from the --dur-* / --ease-* tokens in index.css; keep them in sync.
//
//   press  120ms  hover / press feedback
//   state  200ms  a value changing in place (toggle, tint, height)
//   enter  240ms  something appearing or leaving
//
// Two curves: `standard` for in-place changes, `enter` (a decelerating
// ease-out) for things arriving on screen. One spring, for gesture-driven
// sheets only, tuned so it never visibly overshoots.
export const DUR_PRESS = 0.12
export const DUR_STATE = 0.2
export const DUR_ENTER = 0.24

export const EASE_STANDARD = [0.2, 0, 0, 1]
export const EASE_ENTER    = [0.16, 1, 0.3, 1]

export const SPRING_SHEET = { type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }

// Ready-made transition objects.
export const T_STATE = { duration: DUR_STATE, ease: EASE_STANDARD }
export const T_ENTER = { duration: DUR_ENTER, ease: EASE_ENTER }
export const T_PRESS = { duration: DUR_PRESS, ease: EASE_STANDARD }

// Enter/exit presets for AnimatePresence children.
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
