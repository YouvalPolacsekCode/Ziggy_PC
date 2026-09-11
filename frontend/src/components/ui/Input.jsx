const fieldStyle = {
  width: '100%', boxSizing: 'border-box',
  background: 'var(--surface)', border: '0.5px solid var(--line)',
  borderRadius: 10, color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13,
  outline: 'none', transition: 'border-color 0.12s, outline 0.12s',
}

const labelStyle = {
  display: 'block', fontSize: 12, fontWeight: 500,
  color: 'var(--ink-2)', marginBottom: 5,
}

export function Input({ className, label, error, style, dir = 'auto', ...props }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {label && <label style={labelStyle}>{label}</label>}
      <input
        dir={dir}
        className={className}
        style={{
          ...fieldStyle,
          height: 40, padding: '0 12px',
          border: `0.5px solid ${error ? 'var(--err)' : 'var(--line)'}`,
          ...style,
        }}
        onFocus={e => {
          e.currentTarget.style.borderColor = 'var(--accent)'
          e.currentTarget.style.outline = '2px solid color-mix(in srgb, var(--accent) 30%, transparent)'
          e.currentTarget.style.outlineOffset = '0px'
        }}
        onBlur={e => {
          e.currentTarget.style.borderColor = error ? 'var(--err)' : 'var(--line)'
          e.currentTarget.style.outline = 'none'
        }}
        {...props}
      />
      {error && <p style={{ fontSize: 11, color: 'var(--err)', marginTop: 2 }}>{error}</p>}
    </div>
  )
}

export function Textarea({ className, label, error, style, dir = 'auto', ...props }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {label && <label style={labelStyle}>{label}</label>}
      <textarea
        dir={dir}
        className={className}
        style={{
          ...fieldStyle,
          padding: '10px 12px', resize: 'none',
          border: `0.5px solid ${error ? 'var(--err)' : 'var(--line)'}`,
          ...style,
        }}
        onFocus={e => {
          e.currentTarget.style.borderColor = 'var(--accent)'
          e.currentTarget.style.outline = '2px solid color-mix(in srgb, var(--accent) 30%, transparent)'
          e.currentTarget.style.outlineOffset = '0px'
        }}
        onBlur={e => {
          e.currentTarget.style.borderColor = error ? 'var(--err)' : 'var(--line)'
          e.currentTarget.style.outline = 'none'
        }}
        {...props}
      />
      {error && <p style={{ fontSize: 11, color: 'var(--err)', marginTop: 2 }}>{error}</p>}
    </div>
  )
}
