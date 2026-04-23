import { useEffect, useState, useCallback, useRef } from 'react'
import { postIntent } from '../hooks/useApi'
import { addToast } from '../App'

const DOMAIN_ICON = { light: '💡', switch: '🔌', climate: '🌡', media_player: '📺', binary_sensor: '👁', sensor: '📡', person: '🧑', cover: '🪟', vacuum: '🤖', fan: '🌀', lock: '🔒' }
const DOMAIN_COLOR = { light: '#f59e0b', switch: '#8b5cf6', climate: '#14b8a6', media_player: '#6366f1', binary_sensor: '#22c55e', sensor: '#a0a3b1', vacuum: '#f97316', fan: '#06b6d4', lock: '#ef4444' }

const LIGHT_COLORS = [
  { label: 'White', value: 'white' },
  { label: 'Warm', value: 'warm white' },
  { label: 'Red', value: 'red' },
  { label: 'Blue', value: 'blue' },
  { label: 'Green', value: 'green' },
  { label: 'Purple', value: 'purple' },
]

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

function EntityCard({ entity, onStateChange }) {
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [brightness, setBrightness] = useState(
    entity.attributes?.brightness != null ? Math.round(entity.attributes.brightness / 2.55) : 100
  )
  const [targetTemp, setTargetTemp] = useState(
    entity.attributes?.temperature ?? entity.attributes?.target_temp_low ?? 20
  )
  const debounceRef = useRef(null)

  const domain = entity.entity_id.split('.')[0]
  const icon = DOMAIN_ICON[domain] || '◎'
  const color = DOMAIN_COLOR[domain] || 'var(--purple)'
  const isToggleable = ['light', 'switch', 'media_player', 'cover', 'fan', 'lock'].includes(domain)
  const isLight = domain === 'light'
  const isClimate = domain === 'climate'
  const isOn = ['on', 'playing', 'open', 'unlocked'].includes(entity.state?.toLowerCase())

  async function toggle() {
    if (!isToggleable || loading) return
    setLoading(true)
    const action = isOn ? `turn off ${entity.friendly_name}` : `turn on ${entity.friendly_name}`
    try {
      await postIntent(action)
      // Refresh entity state after a short propagation delay
      setTimeout(async () => {
        try {
          const res = await fetch(`/api/ha/state/${entity.entity_id}`)
          if (res.ok) {
            const d = await res.json()
            onStateChange(entity.entity_id, d.state, d.attributes)
          }
        } catch { /* ignore refresh failure */ }
        setLoading(false)
      }, 1200)
    } catch {
      addToast(`Failed to toggle ${entity.friendly_name}`)
      setLoading(false)
    }
  }

  function onBrightnessChange(val) {
    setBrightness(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        await postIntent(`set brightness ${entity.friendly_name} to ${val}%`)
      } catch {
        addToast('Failed to set brightness')
      }
    }, 400)
  }

  async function setColor(colorName) {
    try {
      await postIntent(`set light color ${entity.friendly_name} to ${colorName}`)
    } catch {
      addToast('Failed to set color')
    }
  }

  async function setTemperature(temp) {
    setTargetTemp(temp)
    try {
      await postIntent(`set temperature to ${temp}`)
    } catch {
      addToast('Failed to set temperature')
    }
  }

  const canExpand = (isLight && isOn) || isClimate

  return (
    <div style={{
      background: 'var(--bg-2)',
      border: `1px solid ${isOn ? color + '44' : 'var(--border-dim)'}`,
      borderRadius: 'var(--radius)',
      padding: '14px 16px',
      transition: 'all .15s',
      display: 'flex', flexDirection: 'column', gap: 8,
      boxShadow: isOn ? `0 0 16px ${color}15` : 'none',
      opacity: loading ? .6 : 1,
    }}>
      <div
        onClick={toggle}
        style={{ cursor: isToggleable ? 'pointer' : 'default' }}
        onMouseEnter={e => isToggleable && (e.currentTarget.parentElement.style.borderColor = color + '88')}
        onMouseLeave={e => isToggleable && (e.currentTarget.parentElement.style.borderColor = isOn ? color + '44' : 'var(--border-dim)')}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 20 }}>{icon}</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <StateChip state={entity.state} />
            {canExpand && (
              <button
                onClick={e => { e.stopPropagation(); setExpanded(x => !x) }}
                title="Controls"
                style={{
                  background: expanded ? 'var(--purple-dim)' : 'transparent',
                  border: `1px solid ${expanded ? 'var(--purple-mid)' : 'transparent'}`,
                  color: 'var(--text-3)', borderRadius: 4, cursor: 'pointer',
                  fontSize: 11, padding: '2px 6px', lineHeight: 1,
                }}
              >{expanded ? '▲' : '▼'}</button>
            )}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', lineHeight: 1.3 }}>
            {entity.friendly_name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{entity.entity_id}</div>
        </div>
      </div>

      {/* Light controls */}
      {expanded && isLight && (
        <div style={{ borderTop: '1px solid var(--border-dim)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)', width: 60 }}>Brightness</span>
            <input
              type="range" min="1" max="100" value={brightness}
              onChange={e => onBrightnessChange(parseInt(e.target.value))}
              onClick={e => e.stopPropagation()}
              style={{ flex: 1, accentColor: color }}
            />
            <span style={{ fontSize: 11, color: 'var(--text-3)', width: 32, textAlign: 'right' }}>{brightness}%</span>
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {LIGHT_COLORS.map(c => (
              <button key={c.value} onClick={e => { e.stopPropagation(); setColor(c.value) }} title={c.label} style={{
                background: 'var(--bg-3)', border: '1px solid var(--border)',
                color: 'var(--text-2)', borderRadius: 4, cursor: 'pointer',
                fontSize: 11, padding: '3px 8px',
              }}>{c.label}</button>
            ))}
          </div>
        </div>
      )}

      {/* Thermostat controls */}
      {expanded && isClimate && (
        <div style={{ borderTop: '1px solid var(--border-dim)', paddingTop: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>
            Current: {entity.attributes?.current_temperature ?? '—'}° · Target: {targetTemp}°
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={e => { e.stopPropagation(); setTemperature(targetTemp - 0.5) }} style={{
              background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--text)',
              borderRadius: 4, cursor: 'pointer', fontSize: 16, width: 30, height: 30,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>−</button>
            <span style={{ fontSize: 20, fontWeight: 600, color: 'var(--teal)', minWidth: 48, textAlign: 'center' }}>{targetTemp}°</span>
            <button onClick={e => { e.stopPropagation(); setTemperature(targetTemp + 0.5) }} style={{
              background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--text)',
              borderRadius: 4, cursor: 'pointer', fontSize: 16, width: 30, height: 30,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>+</button>
          </div>
        </div>
      )}
    </div>
  )
}

export function Devices() {
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ha/entities')
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()
      setEntities(data.entities || [])
    } catch (e) {
      setError('Home Assistant unreachable')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function handleStateChange(entityId, newState, newAttributes) {
    setEntities(prev => prev.map(e =>
      e.entity_id === entityId ? { ...e, state: newState, attributes: { ...e.attributes, ...newAttributes } } : e
    ))
  }

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
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 'calc(100% - 200px)' }}>
          {domains.map(d => (
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
        ) : error ? (
          <div style={{ textAlign: 'center', marginTop: 60 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>⚡</div>
            <div style={{ color: 'var(--red)', fontSize: 14 }}>{error}</div>
            <div style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 4 }}>Check Home Assistant URL and token in settings</div>
            <button onClick={load} style={{
              marginTop: 16, background: 'var(--bg-3)', border: '1px solid var(--border)',
              color: 'var(--text-2)', padding: '8px 20px', borderRadius: 'var(--radius-sm)',
              fontSize: 13, cursor: 'pointer',
            }}>Try again</button>
          </div>
        ) : visible.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', marginTop: 60 }}>No entities found</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
            {visible.map(e => (
              <EntityCard key={e.entity_id} entity={e} onStateChange={handleStateChange} />
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: '8px 20px', borderTop: '1px solid var(--border-dim)', fontSize: 11, color: 'var(--text-3)' }}>
        {visible.length} entities{search || filter !== 'all' ? ` (filtered from ${entities.length})` : ''}
      </div>
    </div>
  )
}
