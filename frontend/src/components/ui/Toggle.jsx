import * as Switch from '@radix-ui/react-switch'
import { useIsRTL } from '../../lib/i18n'

// The one switch. 44×26 track / 22px knob: the smallest geometry that clears
// the HIG 28pt minimum control height with a comfortable 44pt-wide target.
// `.z-toggle` in index.css is the CSS twin for non-Radix call sites; keep
// both in sync.
export const TOGGLE_W = 44
export const TOGGLE_H = 26
const KNOB = 22
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
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={className}
      aria-label={ariaLabel}
      style={{
        position: 'relative', display: 'inline-flex', alignItems: 'center',
        width: TOGGLE_W, height: TOGGLE_H, borderRadius: 999, border: 'none', padding: 0,
        background: checked ? 'var(--ok)' : 'var(--line-2)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background var(--dur-state) var(--ease-standard)',
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
          transition: 'transform var(--dur-state) var(--ease-standard)',
          transform: `translateX(${checked ? onX : offX}px)`,
        }}
      />
    </Switch.Root>
  )
}
