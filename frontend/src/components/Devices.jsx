import { useEffect, useState, useCallback } from 'react'
import { postIntent } from '../hooks/useApi'

const DOMAIN_ICON = { light: '💡', switch: '🔌', climate: '🌡', media_player: '📺', binary_sensor: '👁', sensor: '📡', person: '🧑', cover: '🪟' }
const DOMAIN_COLOR = { light: '#f59e0b', switch: '#8b5cf6', climate: '#14b8a6', media_player: '#6366f1', binary_sensor: '#22c55e', sensor: '#a0a3b1' }

function StateChip({ state }) {
  const on = ['on', 'home', 'open', 'playing', 'unlocked'].includes(state?.toLowerCase())
  const off = ['off', 'not_home', 'closed', 'idle', 'unavailable', 'unknown'].includes(state?.toLowerCase())
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '2px 8px',
      borderRadius: 20, letterSpacing: '.05em',
      background: on ? '#22c55e22' : off ? '#ef444422' : '#8b5cf622',
      color: on ? 'var(--green)' : off ? 'var(--red)' : 'var(--purple)',
      border: `1px solid ${on ? '#22c55e44' : off ? '#ef444444' : '#8b5cf644'}`,
    }}>{state}</span>
  )
}

function EntityCard({ entity }) {
  const [loading, setLoading] = useState(false)
  const domain = entity.entity_id.split('.')[0]
  const icon = DOMAIN_ICON[domain] || '◎'
  const color = DOMAIN_COLOR[domain] || 'var(--purple)'
  const isToggleable = ['light', 'switch', 'media_player', 'cover'].includes(domain)
  const isOn = ['on', 'playing', 'open'].includes(entity.state?.toLowerCase())

  async function toggle() {
    if (!isToggleable || loading) return
    setLoading(true)
    const action = isOn ? `turn off ${entity.friendly_name}` : `turn on ${entity.friendly_name}`
    await postIntent(action)
    setLoading(false)
  }

  return (
    <div
      onClick={toggle}
      style={{
        background: 'var(--bg-2)',
        border: `1px solid ${isOn ? color + '44' : 'var(--border-dim)'}`,
        borderRadius: 'var(--radius)',
        padding: '14px 16px',
        cursor: isToggleable ? 'pointer' : 'default',
        transition: 'all .15s',
        display: 'flex', flexDirection: 'column', gap: 8,
        boxShadow: isOn ? `0 0 16px ${color}15` : 'none',
        opacity: loading ? .6 : 1,
      }}
      onMouseEnter={e => isToggleable && (e.currentTarget.style.borderColor = color + '88')}
      onMouseLeave={e => isToggleable && (e.currentTarget.style.borderColor = isOn ? color + '44' : 'var(--border-dim)')}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        <StateChip state={entity.state} />
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', lineHeight: 1.3 }}>
          {entity.friendly_name}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{entity.entity_id}</div>
      </div>
    </div>
  )
}

export function Devices() {
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ha/entities')
      const data = await res.json()
      setEntities(data.entities || [])
    } catch { /* HA may be offline */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const domains = ['all', ...new Set(entities.map(e => e.domain))].sort()
  const visible = entities
    .filter(e => filter === 'all' || e.domain === filter)
    .filter(e => !search || e.friendly_name.toLowerCase().includes(search.toLowerCase()) || e.entity_id.includes(search.toLowerCase()))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-dim)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          placeholder="Search entities…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, minWidth: 180, background: 'var(--bg-3)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '7px 12px',
            fontSize: 13, outline: 'none', fontFamily: 'var(--font)',
          }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {domains.slice(0, 8).map(d => (
            <button key={d} onClick={() => setFilter(d)} style={{
              background: filter === d ? 'var(--purple-dim)' : 'var(--bg-3)',
              border: `1px solid ${filter === d ? 'var(--purple-mid)' : 'var(--border)'}`,
              color: filter === d ? 'var(--purple)' : 'var(--text-2)',
              padding: '4px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
            }}>{d}</button>
          ))}
        </div>
        <button onClick={load} style={{
          background: 'var(--bg-3)', border: '1px solid var(--border)',
          color: 'var(--text-2)', padding: '6px 14px', borderRadius: 'var(--radius-sm)',
          fontSize: 12, cursor: 'pointer',
        }}>↻ Refresh</button>
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', marginTop: 60 }}>Loading entities…</div>
        ) : visible.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', marginTop: 60 }}>No entities found</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {visible.map(e => <EntityCard key={e.entity_id} entity={e} />)}
          </div>
        )}
      </div>

      <div style={{ padding: '8px 20px', borderTop: '1px solid var(--border-dim)', fontSize: 11, color: 'var(--text-3)' }}>
        {visible.length} entities
      </div>
    </div>
  )
}
