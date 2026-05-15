export function Select({ label, options = [], className, style, ...props }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && (
        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>{label}</label>
      )}
      <select
        className={className}
        style={{
          height: 40, padding: '0 12px',
          background: 'var(--surface)', border: '0.5px solid var(--line)',
          borderRadius: 10, color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13,
          outline: 'none', appearance: 'none',
          backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='rgba(0,0,0,.4)' d='M0 0h10L5 6z'/></svg>")`,
          backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
          paddingRight: 28,
          ...style,
        }}
        {...props}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}
