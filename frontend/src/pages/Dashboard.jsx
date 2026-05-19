import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDeviceStore } from '../stores/deviceStore'
import { useTaskStore } from '../stores/taskStore'
import { useAutomationStore } from '../stores/automationStore'
import { useSuggestionStore } from '../stores/suggestionStore'
import { greetingByTime } from '../lib/utils'
import { getActivity, getActiveAnomalies, getHealth, reloadZigbee, getPresencePersons, getUpdateStatus } from '../lib/api'
import { getRoomPhoto } from '../lib/roomPhotos'

// ── Room summary builder ──────────────────────────────────────────────────────
const INACTIVE_STATES = new Set(['off', 'unavailable', 'unknown', 'closed', 'locked', 'disarmed'])

function buildRoomSummary(room, entityMap) {
  const devices    = room.devices || []
  const ent        = d => entityMap[d.entity_id]
  const lights     = devices.filter(d => d.domain === 'light' && d.ha_state === 'on')
  const media      = devices.filter(d => d.domain === 'media_player' && d.ha_state && !INACTIVE_STATES.has(d.ha_state))
  const climate    = devices.filter(d => d.domain === 'climate' && d.ha_state && !INACTIVE_STATES.has(d.ha_state))
  const fans       = devices.filter(d => d.domain === 'fan' && d.ha_state === 'on')
  const switches   = devices.filter(d => ['switch', 'input_boolean'].includes(d.domain) && d.ha_state === 'on')
  const vacuums    = devices.filter(d => d.domain === 'vacuum' && d.ha_state === 'cleaning')
  const hasMotion  = devices.some(d => { const e = ent(d); return e?.domain === 'binary_sensor' && ['motion', 'occupancy', 'presence'].includes(e.device_class) && e.state === 'on' })
  const sensors    = devices.map(d => ent(d)).filter(e => e?.domain === 'sensor' && !['unavailable', 'unknown'].includes(e.state))
  const tempSensor = sensors.find(e => e.device_class === 'temperature')
  const humSensor  = sensors.find(e => e.device_class === 'humidity')
  const offlineCount = devices.filter(d => d.ha_state === 'unavailable' || d.ha_state === 'unknown').length
  const activeCount  = lights.length + media.length + climate.length + fans.length + switches.length + vacuums.length

  const parts = []
  if (lights.length === 1) parts.push(`${lights[0].display_name || 'Light'} on`)
  else if (lights.length > 1) parts.push(`${lights.length} lights on`)
  for (const m of media.slice(0, 1)) parts.push(`${m.display_name || 'Media'} ${m.ha_state === 'playing' ? 'playing' : 'on'}`)
  for (const c of climate) { const t = c.ha_attributes?.temperature; parts.push(t ? `${c.ha_state} · ${t}°` : c.ha_state) }
  if (fans.length) parts.push('fan on')
  if (vacuums.length) parts.push('vacuum')
  if (switches.length === 1) parts.push(`${switches[0].display_name || 'Switch'} on`)
  else if (switches.length > 1) parts.push(`${switches.length} switches on`)

  return { id: room.id, name: room.name, activeCount, offlineCount, parts, tempSensor, humSensor, hasMotion }
}

// ── Activity formatter ────────────────────────────────────────────────────────
function formatActivity(entry) {
  const ts   = new Date(entry.ts)
  const diff = Math.floor((Date.now() - ts) / 60000)
  const timeStr = diff < 1 ? 'now' : diff < 60 ? `${diff}m` : diff < 1440 ? `${Math.floor(diff / 60)}h` : ts.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const { intent, action, room } = entry
  let label
  if      (intent === 'control_tv')         label = `TV ${action}`
  else if (intent === 'ir_send_command')     label = room ? `IR ${action} · ${room}` : `IR ${action}`
  else if (intent === 'create_automation')   label = 'Automation created'
  else if (intent === 'create_task')         label = 'Task created'
  else if (intent === 'control_device')      label = `Device ${action}${room ? ` · ${room}` : ''}`
  else label = intent.replace(/_/g, ' ') + (action && action !== intent ? ` · ${action}` : '')
  return { label, timeStr, ok: entry.result === 'ok' }
}

const AVATAR_COLORS = ['oklch(0.62 0.12 32)', 'oklch(0.55 0.12 200)', 'oklch(0.62 0.10 140)', 'oklch(0.58 0.12 280)', 'oklch(0.60 0.11 60)']
function avatarColor(name) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

// ── Design-system icon set (matches ziggy-atoms) ──────────────────────────────
function ZIcon({ name, size = 16, stroke = 1.6, color = 'currentColor' }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (name) {
    case 'light':   return <svg {...p}><path d="M9 18h6M10 22h4"/><path d="M12 2a6 6 0 0 0-4 10.5c.7.7 1 1.6 1 2.5v1h6v-1c0-.9.3-1.8 1-2.5A6 6 0 0 0 12 2z"/></svg>
    case 'climate': return <svg {...p}><path d="M14 14.76V4a2 2 0 1 0-4 0v10.76a4 4 0 1 0 4 0z"/></svg>
    case 'media':   return <svg {...p}><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/></svg>
    case 'lock':    return <svg {...p}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 1 1 8 0v4"/></svg>
    case 'fan':     return <svg {...p}><path d="M12 12a4 4 0 0 0-4-4 4 4 0 0 0 4 4zM12 12a4 4 0 0 1 4 4 4 4 0 0 1-4-4zM12 12a4 4 0 0 0 4-4 4 4 0 0 0-4 4zM12 12a4 4 0 0 1-4 4 4 4 0 0 1 4-4z"/></svg>
    case 'plug':    return <svg {...p}><path d="M9 2v6M15 2v6"/><path d="M5 8h14v3a7 7 0 0 1-14 0z"/><path d="M12 18v4"/></svg>
    case 'check':   return <svg {...p}><path d="M4 12l5 5L20 6"/></svg>
    case 'fwd':     return <svg {...p}><path d="M9 6l6 6-6 6"/></svg>
    case 'bolt':    return <svg {...p}><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>
    case 'sunrise': return <svg {...p}><circle cx="12" cy="13" r="3"/><path d="M12 4v3M5 13H2M22 13h-3M5.6 6.6l2.1 2.1M16.3 8.7l2.1-2.1M2 19h20"/></svg>
    case 'sun':     return <svg {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
    case 'sunset':  return <svg {...p}><circle cx="12" cy="13" r="3"/><path d="M12 3v3M5 13H2M22 13h-3M5.6 6.6l2.1 2.1M16.3 8.7l2.1-2.1M2 19h20M12 19v3"/></svg>
    case 'moon':    return <svg {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
    case 'leaf':    return <svg {...p}><path d="M11 20A7 7 0 0 1 4 13c0-6 5-10 17-10 0 12-4 17-10 17z"/><path d="M2 22l8-8"/></svg>
    case 'family':  return <svg {...p}><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5M14 20c0-2 2-3 3-3s3 1 3 3"/></svg>
    default:        return <svg {...p}><circle cx="12" cy="12" r="9"/></svg>
  }
}

// ── ControlTile — matches ziggy-atoms ControlTile exactly ─────────────────────
function ControlTile({ icon, label, sub, on, accentColor, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: 14, borderRadius: 18,
        background: on ? 'var(--ink)' : 'var(--surface)',
        color: on ? 'var(--bg)' : 'var(--ink)',
        border: '0.5px solid var(--line)',
        display: 'flex', flexDirection: 'column', gap: 14,
        minHeight: 96, cursor: 'pointer', textAlign: 'left',
        fontFamily: 'inherit', width: '100%',
        transition: 'opacity 0.12s',
      }}
      onMouseEnter={e => e.currentTarget.style.opacity = '0.88'}
      onMouseLeave={e => e.currentTarget.style.opacity = '1'}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{
          width: 32, height: 32, borderRadius: 10,
          background: on ? `color-mix(in srgb, ${accentColor || 'var(--accent)'} 28%, rgba(255,255,255,0.12))` : 'var(--surface-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: on ? (accentColor || 'var(--gold)') : 'var(--ink-2)',
        }}>
          <ZIcon name={icon} size={16} stroke={1.7} />
        </div>
        <span style={{
          width: 28, height: 16, borderRadius: 999,
          background: on ? (accentColor || 'var(--ok)') : 'var(--line-2)',
          position: 'relative', display: 'inline-block', flexShrink: 0,
        }}>
          <span style={{
            position: 'absolute', top: 2, left: on ? 14 : 2,
            width: 12, height: 12, borderRadius: '50%', background: '#fff',
            boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
            transition: 'left 0.15s',
          }} />
        </span>
      </div>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.25, color: on ? 'var(--bg)' : 'var(--ink)' }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: on ? 'rgba(255,255,255,0.65)' : 'var(--ink-faint)', marginTop: 3 }}>{sub}</div>}
      </div>
    </button>
  )
}

// ── Rooms carousel — fixed snap-slot width, inner photo expands for active ────
// All outer slots are SLOT_W (snap points never shift = no jump).
// The inner photo div is wider for active, narrower for inactive.
const SLOT_W      = 210   // outer snap-slot width, constant for all tiles
const ACTIVE_W    = 210   // active inner width fills the slot
const INACTIVE_W  = 144   // inactive inner width — narrower peek
const TILE_H      = 142   // height never changes

function RoomsCarousel({ sortedRooms, ziggyRooms }) {
  const navigate  = useNavigate()
  const scrollRef = useRef(null)
  const slotRefs  = useRef([])
  const [activeIdx, setActiveIdx] = useState(0)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const handle = () => {
      const cx = el.getBoundingClientRect().left + el.clientWidth / 2
      let best = 0, minD = Infinity
      slotRefs.current.forEach((slot, i) => {
        if (!slot) return
        const r = slot.getBoundingClientRect()
        const d = Math.abs(r.left + r.width / 2 - cx)
        if (d < minD) { minD = d; best = i }
      })
      setActiveIdx(best)
    }
    el.addEventListener('scroll', handle, { passive: true })
    return () => el.removeEventListener('scroll', handle)
  }, [sortedRooms.length])

  if (!sortedRooms.length) return null

  return (
    <div>
      <p className="z-eyebrow" style={{ marginBottom: 10 }}>Rooms</p>
      <div style={{ overflow: 'hidden', marginLeft: -20, marginRight: -20 }}>
        <div
          ref={scrollRef}
          style={{
            display: 'flex', gap: 8,
            overflowX: 'auto',
            paddingLeft: 20, paddingRight: 20, paddingTop: 4, paddingBottom: 4,
            scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch',
          }}
          className="scrollbar-thin"
        >
          {sortedRooms.map((summary, idx) => {
            const room = ziggyRooms.find(r => r.id === summary.id)
            if (!room) return null
            const photo = getRoomPhoto(room)
            const isActive = idx === activeIdx
            const innerW = isActive ? ACTIVE_W : INACTIVE_W
            return (
              // Outer slot — fixed width, snap target
              <div
                key={room.id}
                ref={el => { slotRefs.current[idx] = el }}
                style={{ width: SLOT_W, height: TILE_H, flexShrink: 0, scrollSnapAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {/* Inner photo tile — width animates, height stays */}
                <div
                  onClick={() => navigate(`/rooms/${room.id}`)}
                  style={{
                    position: 'relative',
                    width: innerW, height: TILE_H,
                    borderRadius: 18, overflow: 'hidden', cursor: 'pointer',
                    opacity: isActive ? 1 : 0.55,
                    transition: 'width 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.32s ease',
                  }}
                >
                  <img src={photo} alt={room.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.08) 0%, transparent 30%, rgba(0,0,0,0.65) 100%)' }} />

                  <span style={{
                    position: 'absolute', top: 10, right: 10,
                    width: 7, height: 7, borderRadius: '50%',
                    background: summary.activeCount > 0 ? '#6CBF8C' : 'rgba(255,255,255,0.35)',
                    boxShadow: summary.activeCount > 0 ? '0 0 0 2.5px rgba(108,191,140,0.35)' : 'none',
                  }} />

                  {isActive && (summary.tempSensor || summary.humSensor) && (
                    <div style={{ position: 'absolute', top: 9, left: 10, display: 'flex', gap: 4 }}>
                      {summary.tempSensor && (
                        <span style={{ fontSize: 10, color: '#fff', fontFamily: '"IBM Plex Mono", monospace', background: 'rgba(0,0,0,0.32)', backdropFilter: 'blur(6px)', padding: '2px 6px', borderRadius: 999 }}>
                          {parseFloat(summary.tempSensor.state).toFixed(1)}°
                        </span>
                      )}
                      {summary.humSensor && (
                        <span style={{ fontSize: 10, color: '#fff', fontFamily: '"IBM Plex Mono", monospace', background: 'rgba(0,0,0,0.32)', backdropFilter: 'blur(6px)', padding: '2px 6px', borderRadius: 999 }}>
                          {parseFloat(summary.humSensor.state).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  )}

                  <div style={{ position: 'absolute', bottom: 10, left: 12, right: 12 }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: '#fff', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.01em' }}>{room.name}</p>
                    <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', margin: 0, fontFamily: '"IBM Plex Mono", monospace' }}>
                      {summary.activeCount > 0 ? `${summary.activeCount} active` : 'idle'}
                      {isActive && summary.parts.length > 0 && ` · ${summary.parts[0]}`}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate()
  const { entities, ziggyRooms, fetchAll } = useDeviceStore()
  const { tasks, fetch: fetchTasks }       = useTaskStore()
  const { fetchAutomations, fetchRoutines, routines } = useAutomationStore()
  const { fetch: fetchSuggestions, pendingCount }     = useSuggestionStore()

  const [activity,          setActivity]          = useState([])
  const [anomalies,         setAnomalies]         = useState([])
  const [health,            setHealth]            = useState(null)
  const [reloading,         setReloading]         = useState(false)
  const [reloadMsg,         setReloadMsg]         = useState(null)
  const [coordDismissedAt,  setCoordDismissedAt]  = useState(() => {
    try { return parseInt(localStorage.getItem('coordWarnDismissed') || '0', 10) } catch { return 0 }
  })
  const [presencePersons,   setPresencePersons]   = useState([])
  const [haUpdateStatus,    setHaUpdateStatus]    = useState(null)
  const [activatingRoutine, setActivatingRoutine] = useState(null)

  useEffect(() => {
    fetchAll(); fetchTasks(); fetchAutomations(); fetchRoutines(); fetchSuggestions()
    getActivity(15).then(r => setActivity(r.activity ?? [])).catch(() => {})
    getActiveAnomalies().then(r => setAnomalies(Object.values(r.anomalies ?? {}).flat())).catch(() => {})
    getHealth().then(setHealth).catch(() => {})
    getPresencePersons().then(r => setPresencePersons(r.persons ?? [])).catch(() => {})
    getUpdateStatus().then(setHaUpdateStatus).catch(() => {})
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      getPresencePersons().then(r => setPresencePersons(r.persons ?? [])).catch(() => {})
    }, 30_000)
    return () => clearInterval(id)
  }, [])

  const pendingTasks = tasks.filter(t => !t.done && !t.completed)
  const overdueTasks = pendingTasks.filter(t => t.due_date && new Date(t.due_date) < new Date())
  const entityMap    = Object.fromEntries(entities.map(e => [e.entity_id, e]))
  const roomSummaries = ziggyRooms.filter(r => (r.devices || []).length > 0).map(r => buildRoomSummary(r, entityMap))
  const sortedRooms   = [...roomSummaries].sort((a, b) => ((b.activeCount > 0 || b.hasMotion ? 1 : 0) - (a.activeCount > 0 || a.hasMotion ? 1 : 0)))
  const activeRooms   = roomSummaries.filter(r => r.activeCount > 0 || r.hasMotion)

  const criticalAnomalies = anomalies.filter(a => a.severity === 'critical')
  const warningAnomalies  = anomalies.filter(a => a.severity === 'warning')
  const haOffline    = health !== null && health.ha_connected === false
  const coordWarning = health?.coordinator_warning && !haOffline

  const haUpdateRisk = haUpdateStatus?.update_available ? haUpdateStatus.risk_level : null
  const haUpdateSev  = haUpdateRisk === 'high' ? 'critical' : haUpdateRisk === 'medium' ? 'warn' : haUpdateRisk ? 'info' : null

  const alerts = [
    ...(haOffline ? [{ id: 'ha-offline', sev: 'critical', text: 'Home Assistant offline', to: '/settings' }] : []),
    ...(criticalAnomalies.length > 0 ? [{ id: 'anom-crit', sev: 'critical', text: `${criticalAnomalies.length} critical alert${criticalAnomalies.length > 1 ? 's' : ''}`, to: '/alerts' }] : []),
    ...(warningAnomalies.length  > 0 ? [{ id: 'anom-warn', sev: 'warn',     text: `${warningAnomalies.length} anomal${warningAnomalies.length > 1 ? 'ies' : 'y'}`,          to: '/alerts' }] : []),
    ...(haUpdateSev ? [{ id: 'ha-update', sev: haUpdateSev, text: `HA ${haUpdateStatus.latest_version} · ${haUpdateRisk} risk`, to: '/ops/ha-update' }] : []),
    ...(pendingCount() > 0 ? [{ id: 'sug', sev: 'info', text: `${pendingCount()} suggestion${pendingCount() > 1 ? 's' : ''} ready`, to: '/automations' }] : []),
    ...(overdueTasks.length > 0 ? [{ id: 'tasks', sev: 'warn', text: `${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''}`, to: '/tasks' }] : []),
  ]

  const statusText = activeRooms.length > 0
    ? `${activeRooms.length} room${activeRooms.length > 1 ? 's' : ''} active`
    : 'Home is calm'

  const homePersons = presencePersons.filter(p => (p.effective_state ?? p.state) === 'home')

  const handleReloadZigbee = async () => {
    setReloading(true); setReloadMsg(null)
    try {
      const r = await reloadZigbee()
      setReloadMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error })
    } catch (e) { setReloadMsg({ ok: false, text: e.message }) }
    finally { setReloading(false) }
  }

  const activeRoutines = (routines || []).filter(r => r.enabled !== false).slice(0, 8)

  const handleRunRoutine = async (r) => {
    setActivatingRoutine(r.id)
    setTimeout(() => setActivatingRoutine(null), 1200)
  }

  // Presence string: "Maya & kids home" style
  const homeNames = homePersons.map(p => p.name)
  const presenceStr = homeNames.length === 0
    ? 'Nobody home'
    : homeNames.length === 1
      ? `${homeNames[0]} home`
      : homeNames.length === 2
        ? `${homeNames[0]} & ${homeNames[1]} home`
        : `${homeNames.slice(0, -1).join(', ')} & ${homeNames[homeNames.length - 1]} home`

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '20px 20px 100px', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── 1. Greeting ── */}
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 6 }}>{greetingByTime()}</p>
        <h1 className="z-display" style={{ fontSize: 26, margin: '0 0 8px' }}>{statusText}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="z-dot" style={{ background: activeRooms.length > 0 ? 'var(--ok)' : 'var(--line-2)', flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
            {activeRooms.length > 0 ? `${activeRooms.length} room${activeRooms.length > 1 ? 's' : ''} active` : 'All quiet'}
          </span>
          {homePersons.length > 0 && (
            <>
              <span style={{ color: 'var(--ink-ghost)', fontSize: 12 }}>·</span>
              <span style={{ fontSize: 12, color: 'var(--ink-mute)', textTransform: 'capitalize' }}>{presenceStr}</span>
            </>
          )}
          {/* Alert chips inline */}
          {alerts.slice(0, 2).map(a => {
            const dotColor = a.sev === 'critical' ? 'var(--err)' : a.sev === 'warn' ? 'var(--warn)' : 'var(--info)'
            return (
              <button key={a.id} onClick={() => navigate(a.to)} style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px',
                borderRadius: 999, fontSize: 11, fontWeight: 500,
                background: 'color-mix(in srgb, ' + dotColor + ' 8%, var(--surface))',
                border: '0.5px solid ' + dotColor + '44', cursor: 'pointer',
                fontFamily: 'inherit', color: 'var(--ink)',
              }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                {a.text}
              </button>
            )
          })}
        </div>
      </div>

      {/* System health banners */}
      {haOffline && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12, background: 'color-mix(in srgb, var(--err) 10%, var(--surface))', border: '0.5px solid color-mix(in srgb, var(--err) 30%, transparent)', fontSize: 12, color: 'var(--ink)' }}>
          <span className="z-dot z-dot-err" style={{ flexShrink: 0 }} />
          <span style={{ fontWeight: 600 }}>Home Assistant is offline.</span>
          <span style={{ color: 'var(--ink-mute)' }}>Device control will not work.</span>
        </div>
      )}
      {coordWarning && coordDismissedAt !== health?.offline_count && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12, background: 'color-mix(in srgb, var(--err) 10%, var(--surface))', border: '0.5px solid color-mix(in srgb, var(--err) 30%, transparent)', fontSize: 12, color: 'var(--ink)' }}>
          <span className="z-dot z-dot-err" style={{ flexShrink: 0 }} />
          <span style={{ fontWeight: 600 }}>{health.offline_count} devices offline.</span>
          <span style={{ color: 'var(--ink-mute)', flex: 1 }}>Some devices may be unreachable.</span>
          <button onClick={handleReloadZigbee} disabled={reloading} style={{ padding: '4px 10px', borderRadius: 7, background: 'var(--err)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', flexShrink: 0 }}>
            {reloading ? 'Reconnecting…' : 'Reconnect'}
          </button>
          <button onClick={() => { try { localStorage.setItem('coordWarnDismissed', String(health.offline_count)) } catch {} setCoordDismissedAt(health.offline_count) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', fontSize: 16, padding: '0 2px' }}>×</button>
        </div>
      )}

      {/* ── 2. Rooms carousel ── */}
      {sortedRooms.length > 0 && (
        <RoomsCarousel sortedRooms={sortedRooms} ziggyRooms={ziggyRooms} />
      )}

      {/* ── 3. Quick routines ── */}
      {activeRoutines.length > 0 && (
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 8 }}>Quick routines</p>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }} className="scrollbar-thin">
            {activeRoutines.map((r, idx) => {
              const isActive = activatingRoutine === r.id
              // Tint icons matching design (sunrise/sun/sunset/moon/leaf/family)
              const icons = ['sunrise','sun','sunset','moon','leaf','family','bolt','sparkle']
              const iconName = icons[idx % icons.length]
              const tints = ['var(--gold)','var(--info)','var(--accent)','var(--info)','var(--ok)','var(--accent)']
              const tint = tints[idx % tints.length]
              return (
                <button
                  key={r.id}
                  onClick={() => handleRunRoutine(r)}
                  style={{
                    flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 7,
                    padding: '10px 14px', borderRadius: 14,
                    background: isActive ? 'var(--ink)' : 'var(--surface)',
                    color: isActive ? 'var(--bg)' : 'var(--ink-2)',
                    border: '0.5px solid var(--line)', cursor: 'pointer',
                    fontSize: 12, fontWeight: 500, fontFamily: 'inherit',
                    transition: 'background 0.12s, color 0.12s', whiteSpace: 'nowrap',
                  }}
                >
                  <ZIcon name={iconName} size={14} stroke={1.6} color={isActive ? tint : tint} />
                  {r.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── 4. Quick controls 2×2 ── */}
      {(() => {
        const allEntities = entities.filter(e => !['unavailable','unknown'].includes(e.state))
        const firstLight   = allEntities.find(e => e.domain === 'light')
        const firstClimate = allEntities.find(e => e.domain === 'climate')
        const firstMedia   = allEntities.find(e => e.domain === 'media_player')
        const firstLock    = allEntities.find(e => e.domain === 'lock')
        const tiles = [
          firstLight   && { icon: 'light',   label: firstLight.display_name || firstLight.friendly_name || 'Lights',   sub: firstLight.state === 'on' ? `${firstLight.ha_attributes?.brightness ? Math.round(firstLight.ha_attributes.brightness / 2.55) + '%' : 'on'}` : 'Off', on: firstLight.state === 'on', accentColor: 'var(--gold)',  id: firstLight.entity_id },
          firstClimate && { icon: 'climate', label: firstClimate.display_name || firstClimate.friendly_name || 'AC',    sub: firstClimate.ha_attributes?.temperature ? `${firstClimate.ha_state} · ${firstClimate.ha_attributes.temperature}°` : firstClimate.ha_state, on: !['off','unavailable','unknown'].includes(firstClimate.state), accentColor: 'var(--info)', id: firstClimate.entity_id },
          firstMedia   && { icon: 'media',   label: firstMedia.display_name || firstMedia.friendly_name || 'Media',    sub: firstMedia.ha_attributes?.media_title || firstMedia.ha_state || 'Off', on: firstMedia.state === 'playing', accentColor: 'var(--accent)', id: firstMedia.entity_id },
          firstLock    && { icon: 'lock',    label: firstLock.display_name || firstLock.friendly_name || 'Front door', sub: firstLock.state === 'locked' ? 'Locked' : 'Unlocked', on: false, accentColor: 'var(--err)', id: firstLock.entity_id },
        ].filter(Boolean)
        if (tiles.length < 2) return null
        return (
          <div>
            <p className="z-eyebrow" style={{ marginBottom: 8 }}>Quick controls</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {tiles.map(t => (
                <ControlTile key={t.id} icon={t.icon} label={t.label} sub={t.sub} on={t.on} accentColor={t.accentColor}
                  onClick={() => navigate(`/devices/${encodeURIComponent(t.id)}`)} />
              ))}
            </div>
          </div>
        )
      })()}

      {/* ── 5. Tasks peek ── */}
      {pendingTasks.length > 0 && (
        <button
          onClick={() => navigate('/tasks')}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 14px', borderRadius: 14,
            background: 'var(--surface)', border: '0.5px solid var(--line)',
            cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', width: '100%',
          }}
        >
          <div style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, background: 'color-mix(in srgb, var(--ok) 12%, var(--surface-2))', color: 'var(--ok)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ZIcon name="check" size={14} stroke={2.5} color="var(--ok)" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{pendingTasks.length} task{pendingTasks.length !== 1 ? 's' : ''} today</div>
            <div className="z-mono" style={{ fontSize: 10, color: overdueTasks.length > 0 ? 'var(--err)' : 'var(--ink-faint)', marginTop: 2 }}>
              {overdueTasks.length > 0 ? `${overdueTasks.length} overdue` : `${pendingTasks.length} pending`}
              {pendingTasks[0]?.title && ` · ${pendingTasks[0].title}`}
            </div>
          </div>
          <ZIcon name="fwd" size={12} color="var(--ink-faint)" />
        </button>
      )}

      {/* ── 6. Just now — compact activity strip ── */}
      {activity.length > 0 && (
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 8 }}>Just now</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {activity.slice(0, 4).map((entry, i) => {
              const { label, timeStr, ok } = formatActivity(entry)
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 2px' }}>
                  <span className="z-dot" style={{ background: ok ? 'var(--info)' : 'var(--err)', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--ink-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                  <span className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)', flexShrink: 0 }}>{timeStr}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

    </div>
  )
}
