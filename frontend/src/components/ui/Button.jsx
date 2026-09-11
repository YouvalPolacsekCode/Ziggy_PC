// Button — one control, five intents, three sizes. Sizes follow the HIG
// control table: 40px default touch target, 34px only for dense desktop
// rows. Type is the Body role (15px); nothing here renders under 13px.
const variants = {
  primary:   { background: 'var(--ink)',     color: 'var(--bg)',      border: 'none' },
  secondary: { background: 'var(--surface)', color: 'var(--ink)',     border: '0.5px solid var(--line)' },
  ghost:     { background: 'transparent',    color: 'var(--ink-mute)', border: 'none' },
  danger:    { background: `color-mix(in srgb, var(--err) 10%, var(--surface))`, color: 'var(--err-text)', border: '0.5px solid var(--line)' },
  accent:    { background: 'var(--accent)',  color: 'var(--on-accent)', border: 'none' },
}

const sizes = {
  sm:   { minHeight: 36, padding: '8px 16px',  fontSize: 13, borderRadius: 10, gap: 8, fontWeight: 500 },
  md:   { minHeight: 40, padding: '12px 20px', fontSize: 15, borderRadius: 10, gap: 8, fontWeight: 600 },
  lg:   { minHeight: 44, padding: '12px 20px', fontSize: 17, borderRadius: 10, gap: 8, fontWeight: 600 },
  icon: { height: 40, width: 40, padding: 0, fontSize: 13, borderRadius: 10, fontWeight: 500 },
}

export function Button({ variant = 'primary', size = 'md', className, children, style, ...props }) {
  const vs = variants[variant] || variants.primary
  const ss = sizes[size] || sizes.md
  return (
    <button
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'inherit', cursor: 'pointer', lineHeight: 1.2,
        transition: 'background var(--dur-press) var(--ease-standard), transform var(--dur-press) var(--ease-standard)',
        ...vs, ...ss,
        ...style,
      }}
      className={`z-button ${className || ''}`}
      {...props}
    >
      {children}
    </button>
  )
}
