import { useEffect, useState, useCallback, useRef } from 'react'
import { postIntent } from '../hooks/useApi'
import { addToast } from '../App'

// ─── Constants ───────────────────────────────────────────────────────────────

const ROOM_META = {
  living_room:  { label: 'Living Room',  icon: '🛋️',  color: '#7c3aed' },
  bedroom:      { label: 'Bedroom',      icon: '🛏️',  color: '#4f46e5' },
  roni_room:    { label: "Roni's Room",  icon: '🧸',  color: '#ec4899' },
  kitchen:      { label: 'Kitchen',      icon: '🍳',  color: '#f59e0b' },
  bathroom:     { label: 'Bathroom',     icon: '🚿',  color: '#06b6d4' },
  entrance:     { label: 'Entrance',     icon: '🚪',  color: '#10b981' },
  balcony:      { label: 'Balcony',      icon: '🌿',  color: '#22c55e' },
}

const DOMAIN_ICON  = { light: '💡', switch: '🔌', climate: '🌡️', media_player: '📺', binary_sensor: '👁️', sensor: '📡', person: '🧑', cover: '🪟', vacuum: '🤖', fan: '🌀', lock: '🔒' }
const DOMAIN_COLOR = { light: '#f59e0b', switch: '#7c3aed', climate: '#06b6d4', media_player: '#4f46e5', binary_sensor: '#10b981', sensor: '#9090c0', lock: '#ef4444', fan: '#06b6d4' }

// ─── Toggle ──────────────────────────────────────────────────────────────────

function Toggle({ on, loading, onChange }) {
  return (
    <div onClick={e => { e.stopPropagation(); onChange() }} style={{
      width: 46, height: 26, borderRadius: 13,
      background: on ? 'linear-gradient(90deg, var(--purple), var(--indigo))' : 'var(--bg-3)',
      border: `1px solid ${on ? 'var(--purple)' : 'var(--border)'}`,
      position: 'relative', cursor: loading ? 'wait' : 'pointer',
      transition: 'all .25s', flexShrink: 0,
      boxShadow: on ? '0 0 10px var(--glow-purple)' : 'none',
      opacity: loading ? .6 : 1,
    }}>
      <div style={{
        position: 'absolute', top: 3, left: on ? 23 : 3,
        width: 18, height: 18, borderRadius: '50%',
        background: on ? '#fff' : 'var(--text-3)',
        transition: 'left .25s',
      }} />
    </div>
  )
}

// ─── Back button ─────────────────────────────────────────────────────────────

function BackButton({ label, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 6,
      background: 'none', border: 'none', color: 'var(--purple-3)',
      cursor: 'pointer', fontSize: 14, padding: 0, fontFamily: 'var(--font)',
    }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
      {label}
    </button>
  )
}

// ─── Room Card ────────────────────────────────────────────────────────────────

function RoomCard({ room, meta, count, activeCount, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-dim)',
      borderRadius: 'var(--radius)',
      padding: '18px 16px',
      cursor: 'pointer',
      display: 'flex', flexDirection: 'column', gap: 12,
      transition: 'all .2s',
      position: 'relative', overflow: 'hidden',
    }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = meta.color + '88'; e.currentTarget.style.transform = 'translateY(-2px)' }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-dim)'; e.currentTarget.style.transform = 'none' }}
    >
      {/* Active indicator */}
      {activeCount > 0 && (
        <div style={{
          position: 'absolute', top: 10, right: 10,
          width: 8, height: 8, borderRadius: '50%',
          background: meta.color,
          boxShadow: `0 0 8px ${meta.color}`,
        }} />
      )}

      {/* Icon */}
      <div style={{
        width: 48, height: 48, borderRadius: 14,
        background: meta.color + '22',
        border: `1px solid ${meta.color}44`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 24,
      }}>{meta.icon}</div>

      {/* Label */}
      <div>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{meta.label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>
          {count} device{count !== 1 ? 's' : ''}
          {activeCount > 0 && <span style={{ color: meta.color, marginLeft: 6 }}>· {activeCount} on</span>}
        </div>
      </div>
    </div>
  )
}

// ─── All Devices Banner ───────────────────────────────────────────────────────

function AllDevicesBanner({ total, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: 'linear-gradient(135deg, var(--purple), var(--indigo))',
      borderRadius: 'var(--radius-lg)',
      padding: '20px 24px',
      cursor: 'pointer',
      display: 'flex', alignItems: 'center', gap: 16,
      boxShadow: '0 8px 32px var(--glow-purple)',
      transition: 'transform .15s',
    }}
    onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
    onMouseLeave={e => e.currentTarget.style.transform = 'none'}
    >
      <div style={{
        width: 56, height: 56, borderRadius: 16,
        background: '#ffffff22',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
      }}>🏠</div>
      <div>
        <div style={{ fontWeight: 800, fontSize: 18, color: '#fff' }}>All Devices</div>
        <div style={{ fontSize: 13, color: '#ffffff99', marginTop: 2 }}>{total} devices</div>
      </div>
    </div>
  )
}

// ─── Device Card (in room view) ───────────────────────────────────────────────

function DeviceCard({ entity, onStateChange, onNameChange }) {
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [brightness, setBrightness] = useState(
    entity.attributes?.brightness != null ? Math.round(entity.attributes.brightness / 2.55) : 100
  )
  const debounceRef = useRef(null)
  const inputRef = useRef(null)

  const domain = entity.entity_id.split('.')[0]
  const icon = DOMAIN_ICON[domain] || '◎'
  const color = DOMAIN_COLOR[domain] || 'var(--purple)'
  const isToggleable = ['light', 'switch', 'media_player', 'cover', 'fan', 'lock'].includes(domain)
  const isLight = domain === 'light'
  const isOn = ['on', 'playing', 'open', 'unlocked'].includes(entity.state?.toLowerCase())

  function startEdit() {
    setEditName(entity.display_name || entity.friendly_name || '')
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  async function saveEdit() {
    const trimmed = editName.trim()
    if (!trimmed) { setEditing(false); return }
    try {
      await fetch(`/api/ha/entity/${entity.entity_id}/name`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      onNameChange?.(entity.entity_id, trimmed)
    } catch {
      addToast('Failed to save name')
    }
    setEditing(false)
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') saveEdit()
    if (e.key === 'Escape') setEditing(false)
  }

  async function toggle() {
    if (!isToggleable || loading) return
    setLoading(true)
    try {
      const name = entity.display_name || entity.friendly_name
      await postIntent(isOn ? `turn off ${name}` : `turn on ${name}`)
      setTimeout(async () => {
        try {
          const res = await fetch(`/api/ha/state/${entity.entity_id}`)
          if (res.ok) { const d = await res.json(); onStateChange(entity.entity_id, d.state, d.attributes) }
        } catch { /* ignore */ }
        setLoading(false)
      }, 1200)
    } catch {
      addToast(`Failed to toggle ${entity.display_name || entity.friendly_name}`)
      setLoading(false)
    }
  }

  function onBrightnessChange(val) {
    setBrightness(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try { await postIntent(`set brightness ${entity.friendly_name} to ${val}%`) }
      catch { addToast('Failed to set brightness') }
    }, 400)
  }

  return (
    <div style={{
      background: isOn ? color + '18' : 'var(--bg-card)',
      border: `1px solid ${isOn ? color + '55' : 'var(--border-dim)'}`,
      borderRadius: 'var(--radius)',
      padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 10,
      transition: 'all .2s',
      boxShadow: isOn ? `0 4px 20px ${color}22` : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: isOn ? color + '33' : 'var(--bg-3)',
            border: `1px solid ${isOn ? color + '55' : 'var(--border-dim)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
            transition: 'all .2s',
          }}>{icon}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {editing ? (
              <input
                ref={inputRef}
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onBlur={saveEdit}
                onKeyDown={onKeyDown}
                style={{
                  fontSize: 13, fontWeight: 600, color: 'var(--text)',
                  background: 'var(--bg-3)', border: '1px solid var(--purple)',
                  borderRadius: 6, padding: '2px 6px', width: '100%',
                  fontFamily: 'var(--font)', outline: 'none',
                }}
              />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entity.display_name || entity.friendly_name}
                </span>
                <button onClick={startEdit} style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  color: 'var(--text-3)', fontSize: 11, lineHeight: 1, flexShrink: 0,
                  opacity: 0.5,
                }} title="Rename">✏️</button>
              </div>
            )}
            <div style={{ fontSize: 11, color: isOn ? color : 'var(--text-3)', marginTop: 1 }}>
              {isOn ? (isLight && entity.attributes?.brightness != null ? `${brightness}% brightness` : 'On') : entity.state}
            </div>
          </div>
        </div>

        {isToggleable
          ? <Toggle on={isOn} loading={loading} onChange={toggle} />
          : <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{entity.state}</span>
        }
      </div>

      {/* Brightness slider */}
      {isLight && isOn && (
        <>
          <button onClick={() => setExpanded(x => !x)} style={{
            background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer',
            fontSize: 11, textAlign: 'left', padding: 0, fontFamily: 'var(--font)',
          }}>{expanded ? '▲ Hide' : '▼ Brightness'}</button>
          {expanded && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12 }}>🔅</span>
              <input type="range" min="1" max="100" value={brightness}
                onChange={e => onBrightnessChange(parseInt(e.target.value))}
                style={{ flex: 1, accentColor: color }}
              />
              <span style={{ fontSize: 12 }}>🔆</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Room View ────────────────────────────────────────────────────────────────

function RoomView({ room, meta, entities, onBack, onStateChange, onNameChange }) {
  const roomEntities = entities.filter(e => isEntityInRoom(e, room))
  const onCount = roomEntities.filter(e => ['on', 'playing', 'open'].includes(e.state?.toLowerCase())).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '20px 20px 14px', borderBottom: '1px solid var(--border-dim)', flexShrink: 0 }}>
        <BackButton label="My Home" onClick={onBack} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14,
            background: meta.color + '22', border: `1px solid ${meta.color}44`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
          }}>{meta.icon}</div>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800 }}>{meta.label}</h2>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
              {roomEntities.length} devices · <span style={{ color: meta.color }}>{onCount} active</span>
            </p>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {roomEntities.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', marginTop: 40 }}>No devices mapped for this room</div>
        ) : (
          roomEntities.map(e => <DeviceCard key={e.entity_id} entity={e} onStateChange={onStateChange} onNameChange={onNameChange} />)
        )}
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isEntityInRoom(entity, room) {
  const eid = entity.entity_id.toLowerCase()
  const fn  = (entity.friendly_name || '').toLowerCase()
  const roomLabel = (ROOM_META[room]?.label || room).toLowerCase().replace('_', ' ')
  const roomKey   = room.toLowerCase().replace('_', ' ')
  return eid.includes(room) || eid.includes(roomKey) || fn.includes(roomLabel) || fn.includes(roomKey)
}

function buildRoomEntities(entities, deviceMap) {
  const result = {}
  for (const [room, devices] of Object.entries(deviceMap)) {
    const eids = new Set(Object.values(devices))
    result[room] = entities.filter(e => eids.has(e.entity_id))
  }
  return result
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function Devices() {
  const [entities, setEntities] = useState([])
  const [deviceMap, setDeviceMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('rooms')   // 'rooms' | 'all' | room key
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    try {
      const [entRes, mapRes] = await Promise.all([
        fetch('/api/ha/entities'),
        fetch('/api/devices'),
      ])
      const entData = await entRes.json()
      const mapData = await mapRes.json()
      setEntities(entData.entities || [])
      setDeviceMap(mapData.device_map || {})
    } catch { addToast('Could not load devices') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  function onStateChange(eid, state, attributes) {
    setEntities(prev => prev.map(e => e.entity_id === eid ? { ...e, state, attributes } : e))
  }

  function onNameChange(eid, name) {
    setEntities(prev => prev.map(e => e.entity_id === eid ? { ...e, display_name: name } : e))
  }

  // ── Room drill-down view ──────────────────────────────────────────────────
  if (view !== 'rooms' && view !== 'all') {
    const meta = ROOM_META[view] || { label: view, icon: '🏠', color: 'var(--purple)' }
    const roomEntityMap = buildRoomEntities(entities, deviceMap)
    const roomEntities  = roomEntityMap[view] || []
    return (
      <RoomView
        room={view} meta={meta}
        entities={roomEntities}
        onBack={() => setView('rooms')}
        onStateChange={onStateChange}
        onNameChange={onNameChange}
      />
    )
  }

  // ── All devices flat view ─────────────────────────────────────────────────
  if (view === 'all') {
    const visible = entities.filter(e => {
      if (!search) return true
      const q = search.toLowerCase()
      return (e.display_name || e.friendly_name || '').toLowerCase().includes(q) || e.entity_id.includes(q)
    })
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ padding: '20px 20px 12px', borderBottom: '1px solid var(--border-dim)', flexShrink: 0 }}>
          <BackButton label="My Home" onClick={() => setView('rooms')} />
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 14 }}>
            <h2 style={{ fontSize: 20, fontWeight: 800 }}>All Devices</h2>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{entities.length} total</span>
          </div>
          <div style={{ position: 'relative', marginTop: 10 }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', fontSize: 14 }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
              style={{
                width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border-dim)',
                borderRadius: 24, color: 'var(--text)', padding: '8px 14px 8px 36px',
                fontSize: 13, outline: 'none', fontFamily: 'var(--font)',
              }}
              onFocus={e => e.target.style.borderColor = 'var(--purple)'}
              onBlur={e => e.target.style.borderColor = 'var(--border-dim)'}
            />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visible.map(e => <DeviceCard key={e.entity_id} entity={e} onStateChange={onStateChange} onNameChange={onNameChange} />)}
        </div>
      </div>
    )
  }

  // ── Rooms grid view (default) ─────────────────────────────────────────────
  const roomEntityMap  = buildRoomEntities(entities, deviceMap)
  const rooms = Object.keys(deviceMap).filter(r => ROOM_META[r])
  const totalDevices   = entities.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '20px 20px 14px', flexShrink: 0 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 16 }}>My Home</h2>

        {/* All Devices banner */}
        {loading ? (
          <div style={{ height: 96, background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)' }}>
            Loading…
          </div>
        ) : (
          <AllDevicesBanner total={totalDevices} onClick={() => setView('all')} />
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px' }}>
        {rooms.length === 0 && !loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', marginTop: 40 }}>
            No rooms configured in device_map
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {rooms.map(room => {
              const meta    = ROOM_META[room] || { label: room, icon: '🏠', color: 'var(--purple)' }
              const rEnts   = roomEntityMap[room] || []
              const onCount = rEnts.filter(e => ['on', 'playing', 'open'].includes(e.state?.toLowerCase())).length
              return (
                <RoomCard
                  key={room}
                  room={room}
                  meta={meta}
                  count={rEnts.length}
                  activeCount={onCount}
                  onClick={() => setView(room)}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
