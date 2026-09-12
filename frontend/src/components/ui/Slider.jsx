import { useRef, useState } from 'react'
import * as RadixSlider from '@radix-ui/react-slider'
import { isMotionOn, useMotionOn } from '../../motion/flag'
import { CSS_EASE, haptic, isReduced } from '../../motion/motion'
// motion.css imports this too; a component that depends on these rules also
// imports them itself, so a broken @import can never quietly drop them from
// the bundle. Same module, included once, whichever loads first.
import '../../motion/controls.css'

// The one slider. 44px tall root so the whole strip is a comfortable touch
// target; 28px thumb (the iOS knob size) on the shared 8px .z-slider-track.
const THUMB = 28

// Motion layer: feel only.
//   - a selection haptic every 5% of the range (never per frame)
//   - the fill tracks the finger with NO transition while the drag is live and
//     smooths afterwards, so a remote echo from the hub arrives as a glide
//     rather than a cut. `data-scrubbing` is the documented hook for that.
//   - the control GROWS while it is held: the track thickens and the thumb
//     swells, so the thing under your finger is the thing you are looking at.
//     Cross-axis transform only (see motion/controls.css), so nothing
//     reflows and the value stays exactly where the finger put it.
// Nothing here changes a colour, a size, a radius or a layout value; with
// `data-motion="off"` isMotionOn() is false and every branch below is inert.

// Grab and release. Letting go is faster than taking hold — the house rule.
const HOLD_IN = 160
const HOLD_OUT = 130

// The knob is 28px here, not the 18px this gesture was first tuned on, so it
// takes a much smaller ratio: 1.08× is +1.1px of radius, the same amount of
// edge movement the old 1.15× bought on the smaller knob. A big handle that
// jumps 15% reads as a balloon, not as a grip.
const THUMB_GROW = 1.08

const STEP_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown',
])

export function Slider({
  value, onValueChange, onValueCommit,
  min = 0, max = 100, step = 1, disabled, 'aria-label': ariaLabel,
  // How far the value must travel before the next selection tick. Default is
  // a twentieth of the range — 5% on the 0–100 sliders this component serves.
  hapticStep,
}) {
  // Subscribed, not sampled: flipping the layer off with the `m` key must put
  // this control back exactly as it was without waiting for a re-render.
  const motionOn = useMotionOn()
  const [scrubbing, setScrubbing] = useState(false)
  const [pressed, setPressed] = useState(false)
  const lastTick = useRef(null)
  const fromKeyboard = useRef(false)

  const bucket = Math.max(step || 1, hapticStep ?? (max - min) / 20)
  const tickOf = (v) => Math.round((v - min) / bucket)

  const tick = (v) => {
    const next = tickOf(v)
    if (lastTick.current === null) { lastTick.current = next; return }
    if (next === lastTick.current) return
    lastTick.current = next
    haptic('selection')
  }

  const handleChange = (v) => {
    if (isMotionOn()) {
      // A keypress already fired its own tick; don't double up on it.
      if (fromKeyboard.current) { fromKeyboard.current = false; lastTick.current = tickOf(v) }
      else tick(v)
    }
    onValueChange(v)
  }

  const beginScrub = () => {
    if (!isMotionOn() || disabled) return
    lastTick.current = tickOf(value)
    setScrubbing(true)
    setPressed(true)
  }
  const endScrub = () => {
    if (!scrubbing && !pressed) return
    lastTick.current = null
    setScrubbing(false)
    setPressed(false)
  }

  const onKeyDown = (e) => {
    if (!isMotionOn() || disabled) return
    if (!STEP_KEYS.has(e.key)) return
    fromKeyboard.current = true
    haptic('selection')
  }

  const smooth = motionOn && !isReduced()

  return (
    <RadixSlider.Root
      style={{
        position: 'relative', display: 'flex', alignItems: 'center',
        userSelect: 'none', touchAction: 'none', width: '100%', height: 44,
        opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      // The hook controls.css needs to reach Radix's own thumb-position
      // wrapper, which no prop on this component can style.
      data-motion-slider={smooth ? 'true' : undefined}
      data-scrubbing={motionOn && scrubbing ? 'true' : undefined}
      // Held, not merely scrubbing: the growth is the answer to the grab, so
      // it starts on pointerdown and it is off under reduced motion.
      data-motion-hold={smooth && pressed ? 'true' : undefined}
      onPointerDown={beginScrub}
      onPointerUp={endScrub}
      onPointerCancel={endScrub}
      onLostPointerCapture={endScrub}
      onKeyDown={onKeyDown}
      onBlur={endScrub}
      value={[value]}
      onValueChange={onValueChange ? ([v]) => handleChange(v) : undefined}
      onValueCommit={onValueCommit ? ([v]) => onValueCommit(v) : undefined}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
    >
      {/* The track thickens while held. Cross-axis scale, centred, owned by
          motion/controls.css — the track carries no transform of its own, so
          a rule can have it without fighting an inline value. */}
      <RadixSlider.Track className="z-slider-track" data-motion-grow="track" style={{ flexGrow: 1 }}>
        <RadixSlider.Range
          className="z-slider-fill"
          // Radix positions the fill with left/right, so that is what has to
          // settle — motion.css can only offer a transform transition here,
          // which nothing is animating. None of it while the finger is down:
          // a transition during a drag reads as lag.
          style={smooth
            ? { transition: scrubbing ? 'none' : `left 140ms ${CSS_EASE.out}, right 140ms ${CSS_EASE.out}` }
            : undefined}
        />
      </RadixSlider.Track>
      <RadixSlider.Thumb
        aria-label={ariaLabel}
        style={{
          display: 'block', width: THUMB, height: THUMB,
          background: 'var(--surface)', borderRadius: '50%',
          border: '0.5px solid var(--line-2)',
          boxShadow: 'var(--shadow-md)',
          cursor: disabled ? 'not-allowed' : 'grab', outline: 'none',
          flexShrink: 0,
          transition: 'box-shadow var(--dur-press) var(--ease-standard)',
          // Transient press state, transform only — the thumb's resting size,
          // colour and shadow are untouched. It grows with the track it sits
          // on, a great deal less than the track does, so the handle still
          // reads as a handle and not as a blob. The box-shadow curve is
          // restated verbatim so adding the transform costs nothing.
          ...(smooth ? {
            transition: `box-shadow var(--dur-press) var(--ease-standard), transform ${pressed ? HOLD_IN : HOLD_OUT}ms ${CSS_EASE.out}`,
            transform: pressed ? `scale(${THUMB_GROW})` : 'scale(1)',
          } : null),
        }}
      />
    </RadixSlider.Root>
  )
}
