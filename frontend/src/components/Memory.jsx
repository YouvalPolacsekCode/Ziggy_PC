import { useApi } from '../hooks/useApi'

export function Memory() {
  const { data, loading, refetch } = useApi('/api/memory')
  const entries = data?.memory || []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-dim)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Ziggy Memory</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Long-term knowledge Ziggy has stored</div>
        </div>
        <button onClick={refetch} style={{
          background: 'var(--bg-3)', border: '1px solid var(--border)',
          color: 'var(--text-2)', padding: '6px 14px', borderRadius: 'var(--radius-sm)',
          cursor: 'pointer', fontSize: 12,
        }}>↻ Refresh</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', marginTop: 60 }}>Loading…</div>
        ) : entries.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', marginTop: 60, lineHeight: 2 }}>
            <div style={{ fontSize: 28 }}>◉</div>
            <div>No memories yet</div>
          </div>
        ) : entries.map((entry, i) => (
          <div key={i} style={{
            background: 'var(--bg-2)', border: '1px solid var(--border-dim)',
            borderRadius: 'var(--radius)', padding: '14px 16px',
          }}>
            {typeof entry === 'string' ? (
              <div style={{ color: 'var(--text)', lineHeight: 1.6 }}>{entry}</div>
            ) : (
              <>
                {entry.key && <div style={{ fontSize: 11, color: 'var(--purple)', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.06em' }}>{entry.key}</div>}
                <div style={{ color: 'var(--text)', lineHeight: 1.6 }}>{entry.value || JSON.stringify(entry)}</div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
