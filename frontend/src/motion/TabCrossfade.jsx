// Tab bodies cross-fade with a 3px blur and a 4px rise instead of being
// swapped in one frame. `mode="popLayout"` takes the exiting body out of
// flow so the two overlap instead of stacking; the outer `layout` container
// springs its height so the page below never jumps. Reduced motion: no blur,
// no rise, opacity only. With the layer off the children render bare.
//
// Two things the first version got wrong, both about the body on its way OUT:
//
//   - IT WAS STILL CLICKABLE. `popLayout` lifts the leaver out of flow and
//     paints it over the arriving body, so for ~200ms a tap landed on the tab
//     you had just left — the wrong toggle, the wrong row, on a surface that
//     was fading away under the finger. `useIsPresent` is what answers this
//     rather than a `pointerEvents` key in the exit target: it is decided
//     during render, so it is true for the first frame of the exit and cannot
//     be lost to an animation that stalls or is interrupted.
//   - THE CHILDREN STRETCHED. The container animates its own height, and
//     without `layout` on the body inside it the browser simply scales the
//     content with the box for the length of the spring.
import { forwardRef } from 'react'
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'framer-motion'
import { useMotionOn } from './flag'
import { EASE } from '../lib/motion'

// forwardRef is not optional here. `mode="popLayout"` wraps each child in
// framer's PopChild, which takes a ref to the child to MEASURE it and then
// pins the leaver at that size while it is out of flow. A plain function
// component swallows that ref (React says so, loudly), and the exiting body
// collapses to nothing instead of fading on the spot.
const Pane = forwardRef(function Pane({ body, from, to, out, fade, children }, ref) {
  const isPresent = useIsPresent()
  return (
    <motion.div
      ref={ref}
      data-motion-tab={body}
      layout
      initial={from}
      animate={to}
      exit={out}
      transition={fade}
      // Nothing at rest: `undefined` while present, so the live body is the
      // plain element it always was.
      style={{ pointerEvents: isPresent ? undefined : 'none' }}
    >
      {children}
    </motion.div>
  )
})

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
        <Pane key={tab} body={tab} from={from} to={to} out={out} fade={fade}>
          {children}
        </Pane>
      </AnimatePresence>
    </motion.div>
  )
}
