// Badge — maps variant names to Ziggy tokens
const variants = {
  default: { background: `color-mix(in srgb, var(--ink-mute) 12%, transparent)`, color: 'var(--ink-mute)' },
  success: { background: `color-mix(in srgb, var(--ok)     14%, transparent)`,   color: 'var(--ok)' },
  warning: { background: `color-mix(in srgb, var(--warn)   14%, transparent)`,   color: 'var(--warn)' },
  danger:  { background: `color-mix(in srgb, var(--accent) 12%, transparent)`,   color: 'var(--accent)' },
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
        borderRadius: 999, padding: '2px 8px',
        fontSize: 11, fontWeight: 600, letterSpacing: '0.01em',
        ...vs, ...style,
      }}
    >
      {children}
    </span>
  )
}
