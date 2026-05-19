import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Settings, Zap, Play, RotateCcw, ChevronRight } from 'lucide-react'
import { useDeviceStore } from '../stores/deviceStore'
import { useTaskStore } from '../stores/taskStore'
import { useAutomationStore } from '../stores/automationStore'
import { useSuggestionStore } from '../stores/suggestionStore'
import { useQuickAskStore } from '../stores/quickAskStore'
import { greetingByTime } from '../lib/utils'
import { getActivity, getActiveAnomalies, getHealth, reloadZigbee, getPresencePersons, getUpdateStatus } from '../lib/api'
import { useCameraStore, cameraSnapshotUrl } from '../stores/cameraStore'
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

const QA_TINTS = ['oklch(0.85 0.10 75)','oklch(0.35 0.10 280)','oklch(0.40 0.06 250)','oklch(0.65 0.10 130)','oklch(0.72 0.12 20)','oklch(0.55 0.12 200)']

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

// ── Widget system ─────────────────────────────────────────────────────────────
const WIDGET_DEFAULTS = [
  { id: 'alerts',       visible: true },
  { id: 'presence',     visible: true },
  { id: 'active_rooms', visible: true },
  { id: 'security',     visible: true },
  { id: 'activity',     visible: true },
  { id: 'quick_ask',    visible: true },
]
const WIDGET_META = [
  { id: 'alerts',       label: 'Alerts' },
  { id: 'presence',     label: "Who's home" },
  { id: 'active_rooms', label: 'Rooms' },
  { id: 'security',     label: 'Security' },
  { id: 'activity',     label: 'Recent Activity' },
  { id: 'quick_ask',    label: 'Quick Asks' },
]
function loadWidgets() {
  try {
    const s = JSON.parse(localStorage.getItem('ziggy_home_widgets') || '[]')
    const m = Object.fromEntries(s.map(w => [w.id, w]))
    return WIDGET_DEFAULTS.map(d => ({ ...d, ...(m[d.id] || {}) }))
  } catch { return [...WIDGET_DEFAULTS] }
}
function saveWidgets(list) { try { localStorage.setItem('ziggy_home_widgets', JSON.stringify(list)) } catch {} }

// ── Hero room card ────────────────────────────────────────────────────────────
function HeroRoomCard({ room, summary }) {
  const navigate = useNavigate()
  const photo = getRoomPhoto(room)

  return (
    <div
      onClick={() => navigate(`/rooms/${room.id}`)}
      style={{
        position: 'relative', height: 220, borderRadius: 22, overflow: 'hidden',
        cursor: 'pointer', flexShrink: 0,
      }}
    >
      {/* Photo */}
      <img src={photo} alt={room.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      {/* Gradient overlay */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.18) 0%, transparent 40%, rgba(0,0,0,0.55) 100%)' }} />

      {/* Room name chip — top left */}
      <div style={{
        position: 'absolute', top: 14, left: 14,
        background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(10px)',
        border: '0.5px solid rgba(255,255,255,0.18)',
        padding: '5px 12px', borderRadius: 999,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: summary.activeCount > 0 ? '#6CBF8C' : '#9A907F',
        }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: '#fff', letterSpacing: '-0.01em' }}>{room.name}</span>
      </div>

      {/* Temp / humidity — top right */}
      {(summary.tempSensor || summary.humSensor) && (
        <div style={{ position: 'absolute', top: 14, right: 14, display: 'flex', gap: 6 }}>
          {summary.tempSensor && (
            <span style={{ fontSize: 12, fontWeight: 500, color: '#fff', fontFamily: '"IBM Plex Mono", monospace', background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(6px)', padding: '3px 8px', borderRadius: 999 }}>
              {parseFloat(summary.tempSensor.state).toFixed(1)}°
            </span>
          )}
          {summary.humSensor && (
            <span style={{ fontSize: 12, fontWeight: 500, color: '#fff', fontFamily: '"IBM Plex Mono", monospace', background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(6px)', padding: '3px 8px', borderRadius: 999 }}>
              {parseFloat(summary.humSensor.state).toFixed(0)}%
            </span>
          )}
        </div>
      )}

      {/* Status — bottom left */}
      <div style={{ position: 'absolute', bottom: 14, left: 14 }}>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', margin: '0 0 2px', fontFamily: '"IBM Plex Mono", monospace' }}>
          {summary.activeCount > 0 ? `${summary.activeCount} active` : 'idle'}
        </p>
        {summary.parts.length > 0 && (
          <p style={{ fontSize: 12, fontWeight: 500, color: '#fff', margin: 0, letterSpacing: '-0.01em' }}>
            {summary.parts.slice(0, 2).join(' · ')}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Collapsible widget card ────────────────────────────────────────────────────
function Widget({ eyebrow, children, collapsed, onToggle, action, visible }) {
  return (
    <div className="z-card" style={{ padding: '13px 15px' }}>
      <button
        onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', marginBottom: !collapsed ? 10 : 0, fontFamily: 'inherit', gap: 8 }}
      >
        <p className="z-eyebrow" style={{ margin: 0 }}>{eyebrow}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          {action}
          <ChevronDown size={13} color="var(--ink-faint)" style={{ transition: 'transform 0.2s', transform: collapsed ? 'none' : 'rotate(180deg)', flexShrink: 0 }} />
        </div>
      </button>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}>
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate()
  const { entities, ziggyRooms, fetchAll, getActiveCount, getTotalControllable } = useDeviceStore()
  const { tasks, fetch: fetchTasks }                           = useTaskStore()
  const { fetchAutomations, fetchRoutines, routines }         = useAutomationStore()
  const { fetch: fetchSuggestions, pendingCount }             = useSuggestionStore()
  const { items: quickAsks, fetch: fetchQuickAsks }           = useQuickAskStore()

  const [widgets,         setWidgets]         = useState(loadWidgets)
  const [editMode,        setEditMode]        = useState(false)
  const [activity,        setActivity]        = useState([])
  const [anomalies,       setAnomalies]       = useState([])
  const [health,          setHealth]          = useState(null)
  const [reloading,       setReloading]       = useState(false)
  const [reloadMsg,       setReloadMsg]       = useState(null)
  const [coordDismissedAt, setCoordDismissedAt] = useState(() => {
    try { return parseInt(localStorage.getItem('coordWarnDismissed') || '0', 10) } catch { return 0 }
  })
  const [presencePersons, setPresencePersons] = useState([])
  const [haUpdateStatus,  setHaUpdateStatus]  = useState(null)
  const [activatingRoutine, setActivatingRoutine] = useState(null)
  const { cameras, motionEvents, fetchCameras, fetchMotionHistory } = useCameraStore()
  const [snapTick, setSnapTick] = useState(0)
  const snapIntervalRef = useRef(null)

  useEffect(() => {
    fetchAll(); fetchTasks(); fetchAutomations(); fetchRoutines(); fetchSuggestions(); fetchQuickAsks()
    fetchCameras(); fetchMotionHistory(24)
    snapIntervalRef.current = setInterval(() => setSnapTick(t => t + 1), 30_000)
    getActivity(15).then(r => setActivity(r.activity ?? [])).catch(() => {})
    getActiveAnomalies().then(r => setAnomalies(Object.values(r.anomalies ?? {}).flat())).catch(() => {})
    getHealth().then(setHealth).catch(() => {})
    getPresencePersons().then(r => setPresencePersons(r.persons ?? [])).catch(() => {})
    getUpdateStatus().then(setHaUpdateStatus).catch(() => {})
    return () => clearInterval(snapIntervalRef.current)
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      getPresencePersons().then(r => setPresencePersons(r.persons ?? [])).catch(() => {})
    }, 30_000)
    return () => clearInterval(id)
  }, [])

  const toggleWidget = id => { const u = widgets.map(w => w.id === id ? { ...w, visible: !w.visible } : w); setWidgets(u); saveWidgets(u) }
  const isCollapsed  = id => !(widgets.find(w => w.id === id)?.visible ?? true)

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

  // Hero room — first room with a photo, or first room
  const heroRoomData = sortedRooms[0]
  const heroRoom     = heroRoomData ? ziggyRooms.find(r => r.id === heroRoomData.id) : null

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 'clamp(16px, 3vw, 36px)', paddingTop: 24, paddingBottom: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── 1. Greeting header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <p className="z-eyebrow" style={{ marginBottom: 4 }}>{greetingByTime()}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 className="z-display" style={{ fontSize: 'clamp(20px, 4vw, 28px)', margin: 0 }}>{statusText}</h1>
            <span className="z-dot" style={{ background: activeRooms.length > 0 ? 'var(--ok)' : 'var(--ink-ghost)', flexShrink: 0 }}
              title={activeRooms.length > 0 ? 'Devices active' : 'All quiet'} />
          </div>
        </div>

        {/* Alert chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end', maxWidth: '50%' }}>
          {alerts.slice(0, 3).map(a => {
            const dotColor = a.sev === 'critical' ? 'var(--err)' : a.sev === 'warn' ? 'var(--warn)' : 'var(--info)'
            const bg = a.sev === 'critical'
              ? 'color-mix(in srgb, var(--err) 10%, var(--surface))'
              : a.sev === 'warn'
                ? 'color-mix(in srgb, var(--warn) 8%, var(--surface))'
                : 'var(--surface)'
            return (
              <button key={a.id} onClick={() => navigate(a.to)} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
                borderRadius: 999, fontSize: 11, fontWeight: 500,
                background: bg, border: '0.5px solid var(--line)', cursor: 'pointer',
                fontFamily: 'inherit', color: 'var(--ink)',
              }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                {a.text}
              </button>
            )
          })}
        </div>

        <button onClick={() => setEditMode(v => !v)} style={{
          background: editMode ? 'var(--ink)' : 'transparent', color: editMode ? 'var(--bg)' : 'var(--ink-faint)',
          border: '0.5px solid ' + (editMode ? 'transparent' : 'var(--line)'),
          borderRadius: 8, padding: '6px 8px', cursor: 'pointer', flexShrink: 0,
        }}>
          <Settings size={13} />
        </button>
      </div>

      {/* Widget customise panel */}
      <AnimatePresence>
        {editMode && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }} className="z-card" style={{ overflow: 'hidden', marginTop: -4 }}
          >
            <div style={{ padding: '8px 16px 6px', borderBottom: '0.5px solid var(--line)' }}>
              <p className="z-eyebrow">Show on dashboard</p>
            </div>
            {WIDGET_META.map((meta, i) => {
              const on = widgets.find(w => w.id === meta.id)?.visible ?? true
              return (
                <div key={meta.id} style={{ display: 'flex', alignItems: 'center', padding: '9px 16px', borderBottom: i < WIDGET_META.length - 1 ? '0.5px solid var(--line)' : 'none', gap: 12 }}>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{meta.label}</span>
                  <button className="z-toggle" aria-checked={on} onClick={() => toggleWidget(meta.id)} />
                </div>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* System health banners */}
      {haOffline && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12, background: 'color-mix(in srgb, var(--err) 10%, var(--surface))', border: '0.5px solid color-mix(in srgb, var(--err) 30%, transparent)', fontSize: 12, color: 'var(--ink)' }}>
          <span className="z-dot z-dot-err" style={{ flexShrink: 0 }} />
          <span style={{ fontWeight: 600 }}>Home Assistant is offline.</span>
          <span style={{ color: 'var(--ink-mute)' }}>Device control and automations will not work until the connection is restored.</span>
        </div>
      )}
      {coordWarning && coordDismissedAt !== health?.offline_count && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12, background: 'color-mix(in srgb, var(--err) 10%, var(--surface))', border: '0.5px solid color-mix(in srgb, var(--err) 30%, transparent)', fontSize: 12, color: 'var(--ink)', flexWrap: 'wrap' }}>
          <span className="z-dot z-dot-err" style={{ flexShrink: 0 }} />
          <span style={{ fontWeight: 600 }}>{health.offline_count} devices offline.</span>
          <span style={{ color: 'var(--ink-mute)', flex: 1 }}>Some devices may be unreachable.</span>
          {reloadMsg
            ? <span style={{ fontSize: 11, color: reloadMsg.ok ? 'var(--ok)' : 'var(--err)', fontFamily: '"IBM Plex Mono", monospace' }}>{reloadMsg.ok ? reloadMsg.text : 'Could not reconnect.'}</span>
            : <button onClick={handleReloadZigbee} disabled={reloading} style={{ padding: '4px 10px', borderRadius: 7, background: 'var(--err)', color: '#fff', border: 'none', cursor: reloading ? 'default' : 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', opacity: reloading ? 0.6 : 1, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                {reloading ? <><RotateCcw size={10} style={{ animation: 'spin 1s linear infinite' }} /> Reconnecting…</> : 'Reconnect'}
              </button>
          }
          <button onClick={() => { try { localStorage.setItem('coordWarnDismissed', String(health.offline_count)) } catch {} setCoordDismissedAt(health.offline_count) }} style={{ marginLeft: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', fontSize: 16, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>×</button>
        </div>
      )}

      {/* ── 2. Hero room card ── */}
      {heroRoom && heroRoomData && (
        <HeroRoomCard room={heroRoom} summary={heroRoomData} />
      )}

      {/* ── 3. Quick routines carousel ── */}
      {activeRoutines.length > 0 && (
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 8 }}>Routines</p>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }} className="scrollbar-thin">
            {activeRoutines.map(r => {
              const isActive = activatingRoutine === r.id
              return (
                <button
                  key={r.id}
                  onClick={() => handleRunRoutine(r)}
                  style={{
                    flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 7,
                    padding: '7px 14px', borderRadius: 999,
                    background: isActive ? 'var(--ink)' : 'var(--surface)',
                    color: isActive ? 'var(--bg)' : 'var(--ink)',
                    border: '0.5px solid var(--line)', cursor: 'pointer',
                    fontSize: 12, fontWeight: 500, fontFamily: 'inherit',
                    transition: 'background 0.12s, color 0.12s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isActive ? <Play size={11} fill="currentColor" stroke="none" /> : <Zap size={11} strokeWidth={2} />}
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
          firstLight   ? { icon: 'light',   label: firstLight.friendly_name || firstLight.display_name || 'Lights',   sub: firstLight.state === 'on' ? `On · ${firstLight.ha_attributes?.brightness ? Math.round(firstLight.ha_attributes.brightness / 2.55) + '%' : ''}` : 'Off', on: firstLight.state === 'on', accentColor: 'var(--gold)',  id: firstLight.entity_id } : null,
          firstClimate ? { icon: 'climate', label: firstClimate.friendly_name || firstClimate.display_name || 'AC',      sub: firstClimate.ha_attributes?.temperature ? `${firstClimate.ha_state} · ${firstClimate.ha_attributes.temperature}°` : firstClimate.ha_state, on: !['off','unavailable','unknown'].includes(firstClimate.state), accentColor: 'var(--info)', id: firstClimate.entity_id } : null,
          firstMedia   ? { icon: 'media',   label: firstMedia.friendly_name || firstMedia.display_name || 'Media',    sub: firstMedia.ha_attributes?.media_title || firstMedia.ha_state || 'Off', on: firstMedia.state === 'playing', accentColor: 'var(--accent)', id: firstMedia.entity_id } : null,
          firstLock    ? { icon: 'lock',    label: firstLock.friendly_name || firstLock.display_name || 'Front door', sub: firstLock.state === 'locked' ? 'Locked' : 'Unlocked', on: false, accentColor: 'var(--err)', id: firstLock.entity_id } : null,
        ].filter(Boolean)
        if (tiles.length < 2) return null
        return (
          <div>
            <p className="z-eyebrow" style={{ marginBottom: 8 }}>Quick controls</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {tiles.map(t => (
                <ControlTile
                  key={t.id}
                  icon={t.icon}
                  label={t.label}
                  sub={t.sub}
                  on={t.on}
                  accentColor={t.accentColor}
                  onClick={() => navigate(`/devices/${encodeURIComponent(t.id)}`)}
                />
              ))}
            </div>
          </div>
        )
      })()}

      {/* ── 4b. Today's tasks peek ── */}
      {pendingTasks.length > 0 && (
        <button
          onClick={() => navigate('/tasks')}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 14px', borderRadius: 14,
            background: 'var(--surface)', border: '0.5px solid var(--line)',
            cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', width: '100%',
            transition: 'border-color 0.12s',
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--line-2)'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}
        >
          <div style={{
            width: 32, height: 32, borderRadius: 9, flexShrink: 0,
            background: 'color-mix(in srgb, var(--accent) 12%, var(--surface-2))',
            color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <ZIcon name="check" size={14} stroke={2.5} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{pendingTasks.length} task{pendingTasks.length !== 1 ? 's' : ''} today</div>
            {overdueTasks.length > 0 && (
              <div className="z-mono" style={{ fontSize: 10, color: 'var(--err)', marginTop: 2 }}>{overdueTasks.length} overdue</div>
            )}
          </div>
          <ZIcon name="fwd" size={12} color="var(--ink-faint)" />
        </button>
      )}

      {/* ── 5. Presence widget ── */}
      <Widget eyebrow="Home" collapsed={isCollapsed('presence')} onToggle={() => toggleWidget('presence')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {homePersons.map(p => (
            <span key={p.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px 3px 4px', borderRadius: 999, background: 'var(--bg-2)', border: '0.5px solid var(--line)', fontSize: 11, color: 'var(--ink)' }}>
              <span style={{ width: 18, height: 18, borderRadius: '50%', background: avatarColor(p.name), color: '#fff', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                {p.name[0]?.toUpperCase()}
              </span>
              <span style={{ textTransform: 'capitalize' }}>{p.name}</span>
            </span>
          ))}
          {homePersons.length === 0 && <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>Nobody home</span>}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>
            {getActiveCount()} of {getTotalControllable()} on
            {pendingTasks.length > 0 && (
              <button onClick={() => navigate('/tasks')} style={{ marginLeft: 10, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, color: 'var(--ink-mute)', padding: 0 }}>
                · {pendingTasks.length} task{pendingTasks.length > 1 ? 's' : ''}
              </button>
            )}
          </span>
        </div>
      </Widget>

      {/* ── 5. Rooms widget ── */}
      {sortedRooms.length > 0 && (
        <Widget eyebrow="Rooms" collapsed={isCollapsed('active_rooms')} onToggle={() => toggleWidget('active_rooms')}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {sortedRooms.map(s => (
              <button
                key={s.id}
                onClick={() => navigate(`/rooms/${s.id}`)}
                className="z-card-soft"
                style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', transition: 'border-color 0.12s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--line-2)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)', flex: 1 }}>{s.name}</span>
                  {s.activeCount > 0 && <span className="z-dot z-dot-on" />}
                  {s.offlineCount > 0 && <span style={{ fontSize: 9, color: 'var(--err)', fontFamily: '"IBM Plex Mono", monospace' }}>{s.offlineCount} off</span>}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 10px', fontSize: 11, color: 'var(--ink-mute)' }}>
                  {s.parts.slice(0, 3).map((p, i) => <span key={i}>{p}</span>)}
                  {s.parts.length === 0 && <span style={{ fontFamily: '"IBM Plex Mono", monospace', color: 'var(--ink-faint)' }}>idle</span>}
                </div>
              </button>
            ))}
          </div>
        </Widget>
      )}

      {/* ── 6. Security cameras widget ── */}
      {cameras.length > 0 && (
        <Widget
          eyebrow="Security"
          collapsed={isCollapsed('security')}
          onToggle={() => toggleWidget('security')}
          action={
            <button onClick={e => { e.stopPropagation(); navigate('/alerts') }} style={{ fontSize: 11, color: 'var(--ink-faint)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
              Alerts
            </button>
          }
        >
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 2 }} className="scrollbar-thin">
            {cameras.slice(0, 4).map(cam => {
              const lastMotion = motionEvents.find(e => e.entity_id === cam.entity_id || e.entity_id.includes(cam.entity_id.split('.')[1]))
              return (
                <button
                  key={cam.entity_id}
                  onClick={() => navigate('/rooms')}
                  style={{ flex: '0 0 auto', width: 160, borderRadius: 12, background: 'var(--bg-2)', border: '0.5px solid var(--line)', overflow: 'hidden', cursor: 'pointer', padding: 0, position: 'relative' }}
                >
                  <div style={{ aspectRatio: '16/9', background: 'var(--bg-2)', overflow: 'hidden' }}>
                    <img src={`${cameraSnapshotUrl(cam.entity_id)}?t=${snapTick}`} alt={cam.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={e => { e.target.style.display = 'none' }} />
                  </div>
                  <div style={{ padding: '5px 8px', textAlign: 'left' }}>
                    <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cam.name}</p>
                    {lastMotion
                      ? <p style={{ fontSize: 9, color: 'var(--err)', fontFamily: '"IBM Plex Mono", monospace', marginTop: 1 }}>motion detected</p>
                      : <p style={{ fontSize: 9, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', marginTop: 1 }}>{cam.state}</p>
                    }
                  </div>
                </button>
              )
            })}
          </div>
          {motionEvents.length > 0 && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '0.5px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="z-dot z-dot-err" />
              <span style={{ fontSize: 11, color: 'var(--ink-mute)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {motionEvents[0].name || motionEvents[0].entity_id.split('.')[1]?.replace(/_/g, ' ')}
              </span>
              <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', flexShrink: 0 }}>
                {(() => { const diff = Math.floor((Date.now() - new Date(motionEvents[0].timestamp)) / 1000); return diff < 60 ? `${diff}s ago` : diff < 3600 ? `${Math.floor(diff/60)}m ago` : `${Math.floor(diff/3600)}h ago` })()}
              </span>
            </div>
          )}
        </Widget>
      )}

      {/* ── 7. Activity widget ── */}
      <Widget eyebrow="Recent" collapsed={isCollapsed('activity')} onToggle={() => toggleWidget('activity')}>
        {activity.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 168, overflowY: 'auto' }} className="scrollbar-thin">
            {activity.slice(0, 10).map((entry, i) => {
              const { label, timeStr, ok } = formatActivity(entry)
              return (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: i < Math.min(activity.length, 10) - 1 ? '0.5px solid var(--line)' : 'none' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: ok ? 'var(--ok)' : 'var(--err)', flexShrink: 0, marginTop: 5 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, color: 'var(--ink)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</p>
                    <p className="z-mono" style={{ fontSize: 9.5, color: 'var(--ink-faint)', marginTop: 1 }}>{timeStr}</p>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--ink-faint)' }}>No activity yet</p>
        )}
      </Widget>

      {/* ── 8. Quick Asks widget ── */}
      {quickAsks.length > 0 && (
        <Widget eyebrow="Quick asks" collapsed={isCollapsed('quick_ask')} onToggle={() => toggleWidget('quick_ask')}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {quickAsks.slice(0, 6).map((qa, idx) => {
              const tint = QA_TINTS[idx % QA_TINTS.length]
              return (
                <button
                  key={qa.id}
                  onClick={() => navigate('/chat', { state: { quickAsk: qa } })}
                  style={{
                    position: 'relative', overflow: 'hidden', aspectRatio: '1',
                    padding: '14px 12px', borderRadius: 14, border: 'none', cursor: 'pointer',
                    background: `linear-gradient(145deg, ${tint} 0%, oklch(0.20 0.02 250) 100%)`,
                    textAlign: 'left', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                    transition: 'transform 0.1s', fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)' }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'none' }}
                >
                  <span style={{ position: 'absolute', right: -12, top: -12, width: 52, height: 52, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.18) 0%, transparent 70%)', pointerEvents: 'none' }} />
                  <span style={{ fontSize: 20, lineHeight: 1 }}>{qa.icon || '⚡'}</span>
                  <p style={{ fontSize: 12, fontWeight: 600, color: '#fff', lineHeight: 1.3, letterSpacing: '-0.01em', textShadow: '0 1px 3px rgba(0,0,0,0.3)', margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {qa.label}
                  </p>
                </button>
              )
            })}
          </div>
        </Widget>
      )}

    </div>
  )
}
