import * as Switch from '@radix-ui/react-switch'
import { useIsRTL } from '../../lib/i18n'

export function Toggle({ checked, onCheckedChange, disabled, className }) {
  // translateX is a physical-axis transform, so the on/off positions don't
  // mirror automatically in RTL — without this, the thumb still slides
  // left→right in Hebrew mode and reads inverted (checked thumb on the
  // wrong side of the track). Flip the sign in RTL.
  const isRtl = useIsRTL()
  const offX  = isRtl ? -2  : 2
  const onX   = isRtl ? -18 : 18
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={className}
      style={{
        position: 'relative', display: 'inline-flex', alignItems: 'center',
        width: 36, height: 20, borderRadius: 999, border: 'none', padding: 0,
        background: checked ? 'var(--ok)' : 'var(--line-2)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 0.15s',
        flexShrink: 0,
        outline: 'none',
      }}
    >
      <Switch.Thumb
        style={{
          display: 'block', width: 16, height: 16, borderRadius: '50%',
          background: 'var(--surface)',
          // Knob lift: derived from ink so the shadow tints with the palette
          // instead of staying flat-black on a dark surface.
          boxShadow: '0 1px 3px color-mix(in srgb, var(--ink) 22%, transparent)',
          transition: 'transform 0.15s',
          transform: `translateX(${checked ? onX : offX}px)`,
        }}
      />
    </Switch.Root>
  )
}
