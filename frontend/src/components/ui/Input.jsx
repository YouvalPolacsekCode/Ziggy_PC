// Text fields at Body size (17px). Under 16px iOS Safari zooms the page on
// focus, which is the single most "cheap web app" moment a form can have.
const fieldStyle = {
  width: '100%', boxSizing: 'border-box',
  background: 'var(--surface)', border: '0.5px solid var(--line)',
  borderRadius: 'var(--r-ctl)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 17,
  outline: 'none', transition: 'border-color var(--dur-press) var(--ease-standard), outline var(--dur-press) var(--ease-standard)',
}

const labelStyle = {
  display: 'block', fontSize: 15, fontWeight: 500,
  color: 'var(--ink-2)', marginBottom: 4,
}

function focus(e) {
  e.currentTarget.style.borderColor = 'var(--accent)'
  e.currentTarget.style.outline = '2px solid color-mix(in srgb, var(--accent) 30%, transparent)'
  e.currentTarget.style.outlineOffset = '0px'
}

export function Input({ className, label, error, style, dir = 'auto', ...props }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && <label style={labelStyle}>{label}</label>}
      <input
        dir={dir}
        className={className}
        style={{
          ...fieldStyle,
          height: 44, padding: '0 16px',
          border: `0.5px solid ${error ? 'var(--err)' : 'var(--line)'}`,
          ...style,
        }}
        onFocus={focus}
        onBlur={e => {
          e.currentTarget.style.borderColor = error ? 'var(--err)' : 'var(--line)'
          e.currentTarget.style.outline = 'none'
        }}
        {...props}
      />
      {error && <p style={{ fontSize: 13, color: 'var(--err-text)', marginTop: 4 }}>{error}</p>}
    </div>
  )
}

export function Textarea({ className, label, error, style, dir = 'auto', ...props }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && <label style={labelStyle}>{label}</label>}
      <textarea
        dir={dir}
        className={className}
        style={{
          ...fieldStyle,
          padding: '12px 16px', resize: 'none', lineHeight: 1.4,
          border: `0.5px solid ${error ? 'var(--err)' : 'var(--line)'}`,
          ...style,
        }}
        onFocus={focus}
        onBlur={e => {
          e.currentTarget.style.borderColor = error ? 'var(--err)' : 'var(--line)'
          e.currentTarget.style.outline = 'none'
        }}
        {...props}
      />
      {error && <p style={{ fontSize: 13, color: 'var(--err-text)', marginTop: 4 }}>{error}</p>}
    </div>
  )
}
