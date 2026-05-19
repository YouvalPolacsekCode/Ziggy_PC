const variants = {
  primary:   { background: 'var(--ink)',     color: 'var(--bg)',      border: 'none' },
  secondary: { background: 'var(--surface)', color: 'var(--ink)',     border: '0.5px solid var(--line)' },
  ghost:     { background: 'transparent',    color: 'var(--ink-mute)', border: 'none' },
  danger:    { background: `color-mix(in srgb, var(--err) 10%, var(--surface))`, color: 'var(--err)', border: '0.5px solid var(--line)' },
  accent:    { background: 'var(--accent)',  color: '#fff',            border: 'none' },
}

const sizes = {
  sm:   { height: 32, padding: '0 12px', fontSize: 12, borderRadius: 8,  gap: 6, fontWeight: 500 },
  md:   { height: 36, padding: '0 14px', fontSize: 13, borderRadius: 10, gap: 7, fontWeight: 600 },
  lg:   { height: 44, padding: '0 18px', fontSize: 14, borderRadius: 11, gap: 8, fontWeight: 600 },
  icon: { height: 36, width: 36, padding: 0, fontSize: 13, borderRadius: 10, fontWeight: 500 },
}

export function Button({ variant = 'primary', size = 'md', className, children, style, ...props }) {
  const vs = variants[variant] || variants.primary
  const ss = sizes[size] || sizes.md
  return (
    <button
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'inherit', cursor: 'pointer',
        transition: 'opacity 0.12s',
        ...vs, ...ss,
        ...style,
      }}
      onMouseEnter={e => { if (!props.disabled) e.currentTarget.style.opacity = '0.82' }}
      onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
      className={className}
      {...props}
    >
      {children}
    </button>
  )
}
