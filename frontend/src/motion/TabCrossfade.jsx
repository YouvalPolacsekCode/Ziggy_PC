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
