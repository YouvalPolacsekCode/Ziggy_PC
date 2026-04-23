import { useState } from 'react'
import { useApi, postIntent } from '../hooks/useApi'
import { addToast } from '../App'

export function Memory() {
  const { data, loading, refetch } = useApi('/api/memory')
  const [search, setSearch] = useState('')
  const [keyInput, setKeyInput] = useState('')
  const [valInput, setValInput] = useState('')
  const [saving, setSaving] = useState(false)

  const entries = data?.memory || []
  const visible = search
    ? entries.filter(e => {
        const s = search.toLowerCase()
        if (typeof e === 'string') return e.toLowerCase().includes(s)
        return (e.key || '').toLowerCase().includes(s) || (e.value || '').toLowerCase().includes(s)
      })
    : entries

  async function addMemory() {
    const k = keyInput.trim()
    const v = valInput.trim()
    if (!k || !v || saving) return
    setSaving(true)
    try {
      await postIntent(`remember ${k}: ${v}`)
      setKeyInput('')
      setValInput('')
      setTimeout(refetch, 600)
    } catch {
      addToast('Failed to save memory')
    } finally {
      setSaving(false)
    }
  }

  async function deleteMemory(key) {
    try {
      await postIntent(`forget ${key}`)
      setTimeout(refetch, 600)
    } catch {
      addToast('Failed to delete memory')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-dim)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Ziggy Memory</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Long-term knowledge Ziggy has stored</div>
        </div>
        <button onClick={refetch} style={{
          background: 'var(--bg-3)', border: '1px solid var(--border)',
          color: 'var(--text-2)', padding: '6px 14px', borderRadius: 'var(--radius-sm)',
          cursor: 'pointer', fontSize: 12,
        }}>↻ Refresh</button>
      </div>

      {/* Add memory bar */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-dim)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={keyInput} onChange={e => setKeyInput(e.target.value)}
          placeholder="Key…"
          style={{
            width: 140, background: 'var(--bg-3)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '7px 10px',
            fontSize: 13, outline: 'none', fontFamily: 'var(--font)',
          }}
          onFocus={e => e.target.style.borderColor = 'var(--purple)'}
          onBlur={e => e.target.style.borderColor = 'var(--border)'}
        />
        <input
          value={valInput} onChange={e => setValInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addMemory()}
          placeholder="Value…"
          style={{
            flex: 1, minWidth: 120, background: 'var(--bg-3)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '7px 10px',
            fontSize: 13, outline: 'none', fontFamily: 'var(--font)',
          }}
          onFocus={e => e.target.style.borderColor = 'var(--purple)'}
          onBlur={e => e.target.style.borderColor = 'var(--border)'}
        />
        <button onClick={addMemory} disabled={saving} style={{
          background: 'linear-gradient(135deg, var(--purple), var(--indigo))',
          color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)',
          padding: '7px 16px', cursor: saving ? 'not-allowed' : 'pointer',
          fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1, whiteSpace: 'nowrap',
        }}>{saving ? '…' : '+ Save'}</button>
      </div>

      {/* Search */}
      <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border-dim)' }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search memory…"
          style={{
            width: '100%', background: 'var(--bg-3)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '7px 12px',
            fontSize: 13, outline: 'none', fontFamily: 'var(--font)',
          }}
          onFocus={e => e.target.style.borderColor = 'var(--purple)'}
          onBlur={e => e.target.style.borderColor = 'var(--border)'}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', marginTop: 60 }}>Loading…</div>
        ) : visible.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', marginTop: 60, lineHeight: 2 }}>
            <div style={{ fontSize: 28 }}>◉</div>
            <div>{search ? 'No matches' : 'No memories yet — add one above'}</div>
          </div>
        ) : visible.map((entry, i) => (
          <div key={typeof entry === 'string' ? entry : (entry.key || i)} style={{
            background: 'var(--bg-2)', border: '1px solid var(--border-dim)',
            borderRadius: 'var(--radius)', padding: '14px 16px',
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <div style={{ flex: 1 }}>
              {typeof entry === 'string' ? (
                <div style={{ color: 'var(--text)', lineHeight: 1.6 }}>{entry}</div>
              ) : (
                <>
                  {entry.key && <div style={{ fontSize: 11, color: 'var(--purple)', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.06em' }}>{entry.key}</div>}
                  <div style={{ color: 'var(--text)', lineHeight: 1.6 }}>{entry.value || JSON.stringify(entry)}</div>
                </>
              )}
            </div>
            {typeof entry !== 'string' && entry.key && (
              <button
                onClick={() => deleteMemory(entry.key)}
                title="Delete memory"
                style={{
                  background: 'none', border: 'none', color: 'var(--text-3)',
                  cursor: 'pointer', fontSize: 16, padding: '0 4px', lineHeight: 1,
                  transition: 'color .15s', flexShrink: 0,
                }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}
              >×</button>
            )}
          </div>
        ))}
      </div>

      <div style={{ padding: '8px 20px', borderTop: '1px solid var(--border-dim)', fontSize: 11, color: 'var(--text-3)' }}>
        {visible.length}{search ? ` of ${entries.length}` : ''} entries
      </div>
    </div>
  )
}
