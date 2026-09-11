export function Select({ label, options = [], className, style, error, ...props }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && (
        <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)' }}>{label}</label>
      )}
      <select
        className={className}
        style={{
          height: 40, padding: '0 14px',
          background: 'var(--surface)',
          border: `0.5px solid ${error ? 'var(--err)' : 'var(--line)'}`,
          borderRadius: 'var(--r-ctl)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 16,
          outline: 'none', appearance: 'none',
          backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'><path fill='none' stroke='%236E5A48' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round' d='M1 1.5l5 5 5-5'/></svg>")`,
          backgroundRepeat: 'no-repeat', backgroundPosition: 'right 14px center',
          paddingRight: 36,
          transition: 'border-color var(--dur-press) var(--ease-standard)',
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
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {error && <p style={{ fontSize: 12, color: 'var(--err-text)', marginTop: 4 }}>{error}</p>}
    </div>
  )
}
