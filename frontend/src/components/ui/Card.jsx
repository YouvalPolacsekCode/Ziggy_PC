export function Card({ className, children, onClick, soft, style, ...props }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: soft ? 'var(--surface-2)' : 'var(--surface)',
        border: '0.5px solid var(--line)',
        borderRadius: 'var(--r-card)',
        cursor: onClick ? 'pointer' : undefined,
        transition: onClick ? 'border-color var(--dur-press) var(--ease-standard)' : undefined,
        ...style,
      }}
      onMouseEnter={onClick ? (e => e.currentTarget.style.borderColor = 'var(--line-2)') : undefined}
      onMouseLeave={onClick ? (e => e.currentTarget.style.borderColor = 'var(--line)') : undefined}
      className={className}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardHeader({ className, children, style }) {
  return (
    <div
      className={className}
      style={{ padding: '16px 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...style }}
    >
      {children}
    </div>
  )
}

export function CardBody({ className, children, style }) {
  return (
    <div className={className} style={{ padding: '0 16px 16px', ...style }}>
      {children}
    </div>
  )
}
