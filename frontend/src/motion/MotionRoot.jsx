// The motion layer's single mount point.
//
// It renders NOTHING. Its whole job is three side effects that have to happen
// once, high in the tree, and survive every route change:
//
//   1. importing motion.css, which is the layer's entire visual vocabulary
//   2. installing the delegated press listener, so every tappable thing in the
//      app answers a finger without any component knowing about it
//   3. installing the delegated haptic listener
//
// Mounted statically rather than lazily (see App.jsx): if it arrived with a
// chunk, the first painted screen would have no motion rules and no press
// feedback, and the first painted screen is the Dashboard.
//
// This file used to also render an on-screen MOTION ON/OFF pill and a TUNE
// panel with speed and curve dials. Both are gone, deliberately:
//
//   - They were review instruments for judging the layer before it shipped,
//     and a real home is not a review. Even gated to localhost, a floating pill
//     over someone's house is the wrong kind of thing to carry in the product.
//   - The tuner was also dishonest about its own reach. Its dials drove CSS
//     custom properties, so they moved page fades and staggered arrivals but
//     could not touch the two transitions anyone actually judges smoothness by
//     — the room morph, which runs on a hardcoded duration in JS, and the
//     sheets, which ride a spring rather than a curve. A dial that visibly does
//     nothing to the thing you are staring at is worse than no dial.
//
// The switch itself is NOT gone, only its button. `?motion=off` still restores
// the app exactly as it was before this layer existed, and it persists, so it
// remains the rollback of last resort. It just no longer has a keyboard
// shortcut — the old "m" binding meant a stray keypress anywhere outside a text
// field would silently strip the app of its motion, in someone's home, with no
// way to know what had happened.
//
// If the timing ever needs tuning again, tune it in the source where the
// numbers live and ship it. That is a change with a commit behind it, which is
// what a timing decision should be.

import { useEffect } from 'react'
import { installPressLayer, installHapticLayer } from './pressLayer'
import './motion.css'

export default function MotionRoot() {
  useEffect(() => {
    const removePress = installPressLayer()
    const removeHaptics = installHapticLayer()
    return () => { removePress(); removeHaptics() }
  }, [])

  return null
}
