import * as Switch from '@radix-ui/react-switch'
import { useIsRTL } from '../../lib/i18n'
import { isMotionOn, useMotionOn } from '../../motion/flag'
import { CSS_EASE, haptic, isReduced } from '../../motion/motion'
// See Slider.jsx: the controls that depend on these rules import them
// themselves, so a dropped @import can never take them out of the bundle.
import '../../motion/controls.css'

// The one switch. 40×24 track / 20px knob: comfortably clears
// the HIG 28pt minimum control height with a comfortable 44pt-wide target.
// `.z-toggle` in index.css is the CSS twin for non-Radix call sites; keep
// both in sync.
export const TOGGLE_W = 40
export const TOGGLE_H = 24
const KNOB = 20
const INSET = 2

export function Toggle({ checked, onCheckedChange, disabled, className, 'aria-label': ariaLabel }) {
  // translateX is a physical-axis transform, so the on/off positions don't
  // mirror automatically in RTL — without this, the thumb still slides
  // left→right in Hebrew mode and reads inverted (checked thumb on the
  // wrong side of the track). Flip the sign in RTL.
  const isRtl = useIsRTL()
  const travel = TOGGLE_W - KNOB - INSET * 2
  const offX  = isRtl ? -INSET : INSET
  const onX   = isRtl ? -(INSET + travel) : INSET + travel

  // Motion layer: the knob is a physical object, so it travels on the strong
  // ease-out instead of the standard curve, and the impact lands on the way
  // DOWN — the metaphor is a switch closing, not a state arriving back from
  // the hub. Durations, sizes and colours are untouched.
  const kinetic = useMotionOn() && !isReduced()
  const onPointerDown = () => {
    if (!isMotionOn() || disabled) return
    haptic('light')
  }

  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      onPointerDown={onPointerDown}
      disabled={disabled}
      className={className}
      aria-label={ariaLabel}
      // A switch is a toggle control, so it takes the hover ring on pointer
      // devices (motion/controls.css draws it as a box-shadow). The attribute
      // is inert with the layer off — every rule that reads it is scoped
      // under [data-motion="on"].
      data-motion-ring
      style={{
        position: 'relative', display: 'inline-flex', alignItems: 'center',
        width: TOGGLE_W, height: TOGGLE_H, borderRadius: 999, border: 'none', padding: 0,
        background: checked ? 'var(--ok)' : 'var(--line-2)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        // The ring arrives on this control's OWN curve: the inline value
        // outranks the rule in controls.css, so `box-shadow` is added here
        // rather than letting that rule restate the background timing. The
        // background half is character-for-character what it is with the
        // layer off.
        transition: kinetic
          ? 'background var(--dur-state) var(--ease-standard), box-shadow var(--dur-press) var(--ease-standard)'
          : 'background var(--dur-state) var(--ease-standard)',
        flexShrink: 0,
        outline: 'none',
      }}
    >
      <Switch.Thumb
        style={{
          display: 'block', width: KNOB, height: KNOB, borderRadius: '50%',
          background: 'var(--surface)',
          // Knob lift: derived from ink so the shadow tints with the palette
          // instead of staying flat-black on a dark surface.
          boxShadow: '0 1px 3px color-mix(in srgb, var(--ink) 22%, transparent)',
          transition: kinetic
            ? `transform var(--dur-state) ${CSS_EASE.out}`
            : 'transform var(--dur-state) var(--ease-standard)',
          transform: `translateX(${checked ? onX : offX}px)`,
        }}
      />
    </Switch.Root>
  )
}
