// Badge — maps variant names to Ziggy tokens. Text uses the *-text tokens,
// which are the AA-safe (≥4.5:1) variants of each status colour on a 12–14%
// tinted fill. `danger` is a real error tone now; it used to borrow the
// brand accent, which made "delete" and "Ziggy" the same colour.
const variants = {
  default: { background: `color-mix(in srgb, var(--ink-mute) 12%, transparent)`, color: 'var(--ink-mute)' },
  success: { background: `color-mix(in srgb, var(--ok)     14%, transparent)`,   color: 'var(--ok-text)' },
  warning: { background: `color-mix(in srgb, var(--warn)   14%, transparent)`,   color: 'var(--warn-text)' },
  danger:  { background: `color-mix(in srgb, var(--err)    12%, transparent)`,   color: 'var(--err-text)' },
  violet:  { background: `color-mix(in srgb, var(--info)   14%, transparent)`,   color: 'var(--info)' },
  blue:    { background: `color-mix(in srgb, var(--info)   14%, transparent)`,   color: 'var(--info)' },
}

export function Badge({ variant = 'default', className, children, style }) {
  const vs = variants[variant] || variants.default
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex', alignItems: 'center',
        borderRadius: 999, padding: '4px 10px',
        fontSize: 13, fontWeight: 500, lineHeight: 1.2, letterSpacing: '0.01em',
        ...vs, ...style,
      }}
    >
      {children}
    </span>
  )
}
