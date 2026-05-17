import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useDeviceStore } from '../stores/deviceStore'
import { useTaskStore } from '../stores/taskStore'
import { useAutomationStore } from '../stores/automationStore'
import { useSuggestionStore } from '../stores/suggestionStore'
import { useQuickAskStore } from '../stores/quickAskStore'
import { greetingByTime } from '../lib/utils'
import { getScenes, activateScene, getActivity, getActiveAnomalies, getHealth, reloadZigbee, getPresencePersons, getFeaturesSettings } from '../lib/api'
import { useCameraStore, cameraSnapshotUrl } from '../stores/cameraStore'

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
  if (hasMotion) parts.push('motion')

  return { id: room.id, name: room.name, activeCount, offlineCount, parts, tempSensor, humSensor, hasMotion }
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function ZIcon({ name, size = 14 }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (name) {
    case 'chev':   return <svg {...p}><path d="M9 6l6 6-6 6"/></svg>
    case 'light':  return <svg {...p}><path d="M9 18h6M10 22h4"/><path d="M12 2a6 6 0 0 0-4 10.5c.7.7 1 1.6 1 2.5v1h6v-1c0-.9.3-1.8 1-2.5A6 6 0 0 0 12 2z"/></svg>
    case 'motion': return <svg {...p}><circle cx="12" cy="5" r="2"/><path d="M8 22l2-6 2 2 2-2 2 6M9 12l3 3 3-3"/></svg>
    case 'temp':   return <svg {...p}><path d="M14 14.76V4a2 2 0 1 0-4 0v10.76a4 4 0 1 0 4 0z"/></svg>
    case 'humid':  return <svg {...p}><path d="M12 2.5s6 7 6 11.5a6 6 0 0 1-12 0c0-4.5 6-11.5 6-11.5z"/></svg>
    case 'tasks':  return <svg {...p}><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
    case 'bolt':   return <svg {...p}><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>
    case 'film':   return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 15h18M8 4v16M16 4v16"/></svg>
    case 'home':   return <svg {...p}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    case 'ir':     return <svg {...p}><path d="M5 12h14M12 5l7 7-7 7"/></svg>
    case 'scene':  return <svg {...p}><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
    default:       return <svg {...p}><circle cx="12" cy="12" r="3"/></svg>
  }
}

// ── Room tile — 2-col, taller ─────────────────────────────────────────────────
function RoomTile({ summary }) {
  const navigate = useNavigate()
  const stats = []
  if (summary.tempSensor) stats.push({ icon: 'temp',   val: `${parseFloat(summary.tempSensor.state).toFixed(1)}°`, mono: true })
  if (summary.humSensor)  stats.push({ icon: 'humid',  val: `${parseFloat(summary.humSensor.state).toFixed(0)}%`,  mono: true })
  summary.parts.forEach(p => stats.push({ icon: 'light', val: p, mono: false }))
  if (summary.hasMotion)  stats.push({ icon: 'motion', val: 'motion' })

  return (
    <button
      onClick={() => navigate(`/rooms/${summary.id}`)}
      style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 18px', borderRadius: 12, background: 'var(--bg)', border: '0.5px solid var(--line)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', transition: 'border-color 0.12s', minHeight: 80 }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--line-2)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}
    >
      <div>
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)', lineHeight: 1.2 }}>{summary.name}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 11, color: 'var(--ink-mute)' }}>
        {summary.offlineCount > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#ef4444', fontFamily: '"IBM Plex Mono", monospace' }}>
            {summary.offlineCount} offline
          </span>
        )}
        {stats.slice(0, 4).map((s, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <ZIcon name={s.icon} size={11} />
            {s.mono ? <span style={{ fontFamily: '"IBM Plex Mono", monospace' }}>{s.val}</span> : <span>{s.val}</span>}
          </span>
        ))}
        {summary.activeCount === 0 && !summary.hasMotion && stats.length === 0 && summary.offlineCount === 0 && (
          <span style={{ fontFamily: '"IBM Plex Mono", monospace', color: 'var(--ink-faint)' }}>idle</span>
        )}
      </div>
    </button>
  )
}

// ── Activity formatter ────────────────────────────────────────────────────────
function formatActivity(entry) {
  const ts   = new Date(entry.ts)
  const diff = Math.floor((Date.now() - ts) / 60000)
  const timeStr = diff < 1 ? 'now' : diff < 60 ? `${diff}m` : diff < 1440 ? `${Math.floor(diff / 60)}h` : ts.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const { intent, action, room } = entry
  let label, icon
  if      (intent === 'control_tv')         { label = `TV ${action}`;                                        icon = 'film'  }
  else if (intent === 'ir_send_command')     { label = room ? `IR ${action} · ${room}` : `IR ${action}`;     icon = 'ir'    }
  else if (intent === 'create_automation')  { label = 'Automation created';                                  icon = 'bolt'  }
  else if (intent === 'activate_scene')     { label = `Scene: ${action || 'activated'}`;                     icon = 'scene' }
  else if (intent === 'create_task')        { label = 'Task created';                                        icon = 'tasks' }
  else if (intent === 'control_device')     { label = `Device ${action}${room ? ` · ${room}` : ''}`;        icon = 'home'  }
  else { label = intent.replace(/_/g, ' ') + (action && action !== intent ? ` · ${action}` : '');           icon = 'bolt'  }
  return { label, timeStr, icon, ok: entry.result === 'ok' }
}

// ── Avatar color ──────────────────────────────────────────────────────────────
const AVATAR_COLORS = ['oklch(0.62 0.12 32)', 'oklch(0.55 0.12 200)', 'oklch(0.62 0.10 140)', 'oklch(0.58 0.12 280)', 'oklch(0.60 0.11 60)']
function avatarColor(name) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

// ── Quick Ask card tints — mirrors the Scenes card palette ───────────────────
const QA_TINTS = [
  'oklch(0.85 0.10 75)',
  'oklch(0.35 0.10 280)',
  'oklch(0.40 0.06 250)',
  'oklch(0.65 0.10 130)',
  'oklch(0.72 0.12 20)',
  'oklch(0.55 0.12 200)',
  'oklch(0.62 0.10 140)',
]

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
  { id: 'presence',     label: 'Who\'s home' },
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

const CogSvg = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1c.5.5 1.3.6 1.8.3.6-.2 1-.8 1-1.5V3a2 2 0 0 1 4 0v.1c0 .7.4 1.3 1 1.5.5.3 1.3.2 1.8-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8c.2.6.8 1 1.5 1H21a2 2 0 0 1 0 4h-.1c-.7 0-1.3.4-1.5 1z"/>
  </svg>
)

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate()
  const { entities, ziggyRooms, fetchAll, getActiveCount, getTotalControllable } = useDeviceStore()
  const { tasks, fetch: fetchTasks }                = useTaskStore()
  const { fetchAutomations, fetchRoutines }         = useAutomationStore()
  const { fetch: fetchSuggestions, pendingCount }   = useSuggestionStore()
  const { items: quickAsks, fetch: fetchQuickAsks } = useQuickAskStore()

  const [widgets,         setWidgets]         = useState(loadWidgets)
  const [editMode,        setEditMode]        = useState(false)
  const [scenes,          setScenes]          = useState([])
  const [scenesEnabled,   setScenesEnabled]   = useState(false)
  const [scenesCollapsed, setScenesCollapsed] = useState(false)
  const [activity,        setActivity]        = useState([])
  const [activatingScene, setActivatingScene] = useState(null)
  const [anomalies,         setAnomalies]         = useState([])
  const [health,            setHealth]            = useState(null)
  const [reloading,         setReloading]         = useState(false)
  const [reloadMsg,         setReloadMsg]         = useState(null)
  const [coordDismissedAt,  setCoordDismissedAt]  = useState(() => {
    try { return parseInt(localStorage.getItem('coordWarnDismissed') || '0', 10) } catch { return 0 }
  })
  const [presencePersons,   setPresencePersons]   = useState([])
  const { cameras, motionEvents, fetchCameras, fetchMotionHistory } = useCameraStore()
  // Snapshot refresh key per camera — increment to bust the browser cache
  const [snapTick, setSnapTick] = useState(0)
  const snapIntervalRef = useRef(null)

  useEffect(() => {
    fetchAll(); fetchTasks(); fetchAutomations(); fetchRoutines(); fetchSuggestions(); fetchQuickAsks()
    fetchCameras(); fetchMotionHistory(24)
    snapIntervalRef.current = setInterval(() => setSnapTick(t => t + 1), 30_000)
    getFeaturesSettings().then(f => {
      if (f.scenes) {
        setScenesEnabled(true)
        getScenes().then(r => setScenes(Array.isArray(r) ? r : (r.scenes ?? []))).catch(() => {})
      }
    }).catch(() => {})
    getActivity(15).then(r => setActivity(r.activity ?? [])).catch(() => {})
    getActiveAnomalies()
      .then(r => setAnomalies(Object.values(r.anomalies ?? {}).flat()))
      .catch(() => {})
    getHealth().then(setHealth).catch(() => {})
    getPresencePersons().then(r => setPresencePersons(r.persons ?? [])).catch(() => {})
    return () => clearInterval(snapIntervalRef.current)
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      getPresencePersons().then(r => setPresencePersons(r.persons ?? [])).catch(() => {})
    }, 30_000)
    return () => clearInterval(id)
  }, [])

  const toggleWidget = id => { const u = widgets.map(w => w.id === id ? { ...w, visible: !w.visible } : w); setWidgets(u); saveWidgets(u) }
  const isVisible    = id => widgets.find(w => w.id === id)?.visible ?? true

  const pendingTasks  = tasks.filter(t => !t.done && !t.completed)
  const overdueTasks  = pendingTasks.filter(t => t.due_date && new Date(t.due_date) < new Date())
  const entityMap     = Object.fromEntries(entities.map(e => [e.entity_id, e]))
  const roomSummaries = ziggyRooms.filter(r => (r.devices || []).length > 0).map(r => buildRoomSummary(r, entityMap))
  const activeRooms   = roomSummaries.filter(r => r.activeCount > 0 || r.hasMotion)

  const criticalAnomalies = anomalies.filter(a => a.severity === 'critical')
  const warningAnomalies  = anomalies.filter(a => a.severity === 'warning')

  // health-derived alerts (things anomaly engine can't surface when HA is down)
  const haOffline    = health !== null && health.ha_connected === false
  const coordWarning = health?.coordinator_warning && !haOffline  // ANOM-09 handles the push notification

  const handleReloadZigbee = async () => {
    setReloading(true)
    setReloadMsg(null)
    try {
      const r = await reloadZigbee()
      setReloadMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error })
    } catch (e) {
      setReloadMsg({ ok: false, text: e.message })
    } finally {
      setReloading(false)
    }
  }

  const alerts = [
    // HA connectivity — must come first so it's most visible
    ...(haOffline ? [{ id: 'ha-offline', sev: 'critical', text: 'Home Assistant offline', to: '/settings' }] : []),
    ...(criticalAnomalies.length > 0 ? [{ id: 'anom-crit', sev: 'critical', text: `${criticalAnomalies.length} critical alert${criticalAnomalies.length > 1 ? 's' : ''}`, to: '/anomalies' }] : []),
    ...(warningAnomalies.length  > 0 ? [{ id: 'anom-warn', sev: 'warn',     text: `${warningAnomalies.length} anomal${warningAnomalies.length > 1 ? 'ies' : 'y'}`,          to: '/anomalies' }] : []),
    ...(pendingCount() > 0 ? [{ id: 'sug',   sev: 'info', text: `${pendingCount()} suggestion${pendingCount() > 1 ? 's' : ''} ready`, to: '/suggestions' }] : []),
    ...(overdueTasks.length > 0 ? [{ id: 'tasks', sev: 'warn', text: `${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''}`,            to: '/tasks'       }] : []),
  ]

  const statusText = activeRooms.length > 0
    ? `${activeRooms.length} room${activeRooms.length > 1 ? 's' : ''} active`
    : 'Home is calm'

  const homePersons = presencePersons
    .filter(p => (p.effective_state ?? p.state) === 'home')
    .map(p => ({ name: p.name }))

  // Active rooms first
  const sortedRooms = [...roomSummaries].sort((a, b) => {
    const aActive = (a.activeCount > 0 || a.hasMotion) ? 1 : 0
    const bActive = (b.activeCount > 0 || b.hasMotion) ? 1 : 0
    return bActive - aActive
  })

  const handleActivateScene = async (entityId) => {
    setActivatingScene(entityId)
    try { await activateScene(entityId) } catch {}
    setTimeout(() => setActivatingScene(null), 1200)
  }

  // Shared card style
  const card = { padding: '13px 15px', borderRadius: 13, background: 'var(--surface)', border: '0.5px solid var(--line)' }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 'clamp(16px, 3vw, 36px)', paddingTop: 24, paddingBottom: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── 1. Header strip ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingBottom: 14, borderBottom: '0.5px solid var(--line)' }}>
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 3 }}>{greetingByTime()}</p>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)', lineHeight: 1.1 }}>{statusText}</div>
        </div>
        <div style={{ flex: 1 }} />
        {isVisible('alerts') && alerts.map(a => {
          const dotColor = a.sev === 'critical' ? '#ef4444' : a.sev === 'warn' ? 'var(--warn)' : 'var(--info)'
          const bg       = a.sev === 'critical'
            ? 'color-mix(in srgb, #ef4444 12%, var(--surface))'
            : a.sev === 'warn'
              ? 'color-mix(in srgb, var(--warn) 10%, var(--surface))'
              : 'var(--surface)'
          return (
            <button key={a.id} onClick={() => navigate(a.to)} style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 999, fontSize: 12,
              background: bg, border: '0.5px solid var(--line)', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ink)',
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
              {a.text}
            </button>
          )
        })}
        <button onClick={() => setEditMode(v => !v)} style={{ background: editMode ? 'var(--ink)' : 'transparent', color: editMode ? 'var(--bg)' : 'var(--ink-faint)', border: '0.5px solid ' + (editMode ? 'transparent' : 'var(--line)'), borderRadius: 8, padding: '6px 8px', cursor: 'pointer', flexShrink: 0 }}>
          <CogSvg />
        </button>
      </div>

      {/* Customise panel */}
      <AnimatePresence>
        {editMode && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}
            style={{ borderRadius: 14, background: 'var(--surface)', border: '0.5px solid var(--line)', overflow: 'hidden', marginTop: -4 }}
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

      {/* ── 1b. System health banners — only critical connectivity / device issues ── */}
      {haOffline && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: 'color-mix(in srgb, #ef4444 10%, var(--surface))', border: '0.5px solid color-mix(in srgb, #ef4444 30%, transparent)', fontSize: 12, color: 'var(--ink)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
          <span style={{ fontWeight: 600 }}>Home Assistant is offline.</span>
          <span style={{ color: 'var(--ink-mute)' }}>Device control and automations will not work until the connection is restored.</span>
        </div>
      )}
      {coordWarning && coordDismissedAt !== health?.offline_count && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: 'color-mix(in srgb, #ef4444 10%, var(--surface))', border: '0.5px solid color-mix(in srgb, #ef4444 30%, transparent)', fontSize: 12, color: 'var(--ink)', flexWrap: 'wrap' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
          <span style={{ fontWeight: 600 }}>
            {health.offline_count} devices offline.
          </span>
          <span style={{ color: 'var(--ink-mute)', flex: 1 }}>
            Some devices may be unreachable.
          </span>
          {reloadMsg
            ? <span style={{ fontSize: 11, color: reloadMsg.ok ? 'var(--ok)' : 'var(--accent)', fontFamily: '"IBM Plex Mono", monospace' }}>{reloadMsg.ok ? reloadMsg.text : 'Could not reconnect. Try from Home Assistant.'}</span>
            : (
              <button
                onClick={handleReloadZigbee}
                disabled={reloading}
                style={{ padding: '4px 10px', borderRadius: 7, background: '#ef4444', color: '#fff', border: 'none', cursor: reloading ? 'default' : 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', opacity: reloading ? 0.6 : 1, flexShrink: 0 }}
              >
                {reloading ? 'Reconnecting…' : 'Reconnect'}
              </button>
            )
          }
          <button
            onClick={() => {
              const n = health.offline_count
              try { localStorage.setItem('coordWarnDismissed', String(n)) } catch {}
              setCoordDismissedAt(n)
            }}
            style={{ marginLeft: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', fontSize: 16, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
            title="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      {!haOffline && !coordWarning && health?.offline_with_deps?.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: 'color-mix(in srgb, var(--warn) 8%, var(--surface))', border: '0.5px solid color-mix(in srgb, var(--warn) 25%, transparent)', fontSize: 12, color: 'var(--ink)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--warn)', flexShrink: 0 }} />
          {health.offline_with_deps.length === 1
            ? <span><span style={{ fontWeight: 600 }}>{health.offline_with_deps[0].name}</span> is offline — <span style={{ color: 'var(--ink-mute)' }}>automation "{health.offline_with_deps[0].automation_deps[0]}" may not work.</span></span>
            : <span><span style={{ fontWeight: 600 }}>{health.offline_with_deps.length} devices</span> are offline and used by automations.</span>
          }
        </div>
      )}

      {/* ── 2. Presence chips row — collapsible ── */}
      <div style={card}>
        <button
          onClick={() => toggleWidget('presence')}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', marginBottom: isVisible('presence') ? 10 : 0, fontFamily: 'inherit' }}
        >
          <p className="z-eyebrow" style={{ margin: 0 }}>Home</p>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transition: 'transform 0.2s', transform: isVisible('presence') ? 'rotate(180deg)' : 'none', flexShrink: 0 }}>
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>
        <AnimatePresence initial={false}>
          {isVisible('presence') && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {homePersons.map(p => (
                    <span key={p.name} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '3px 9px 3px 4px', borderRadius: 999,
                      background: 'var(--bg-2)', border: '0.5px solid var(--line)', fontSize: 11, color: 'var(--ink)',
                    }}>
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
              </motion.div>
            )}
          </AnimatePresence>
      </div>

      {/* ── 3. Rooms — collapsible ── */}
      {sortedRooms.length > 0 && (
        <div style={{ ...card, padding: '14px 14px' }}>
          <button
            onClick={() => toggleWidget('active_rooms')}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', marginBottom: isVisible('active_rooms') ? 10 : 0, fontFamily: 'inherit' }}
          >
            <p className="z-eyebrow" style={{ margin: 0 }}>Rooms</p>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ transition: 'transform 0.2s', transform: isVisible('active_rooms') ? 'rotate(180deg)' : 'none', flexShrink: 0 }}>
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
          <AnimatePresence initial={false}>
            {isVisible('active_rooms') && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                style={{ overflow: 'hidden' }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                  {sortedRooms.map(s => <RoomTile key={s.id} summary={s} />)}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ── 3b. Security cameras — collapsible ── */}
      {cameras.length > 0 && (
        <div style={{ ...card, padding: '14px 14px' }}>
          <button
            onClick={() => toggleWidget('security')}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', marginBottom: isVisible('security') ? 10 : 0, fontFamily: 'inherit' }}
          >
            <p className="z-eyebrow" style={{ margin: 0 }}>Security</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={e => { e.stopPropagation(); navigate('/cameras') }} style={{ fontSize: 11, color: 'var(--ink-faint)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                View all
              </button>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ transition: 'transform 0.2s', transform: isVisible('security') ? 'rotate(180deg)' : 'none', flexShrink: 0 }}>
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </div>
          </button>
          <AnimatePresence initial={false}>
            {isVisible('security') && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}>
                <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 2 }} className="scrollbar-thin">
                  {cameras.slice(0, 4).map(cam => {
                    const lastMotion = motionEvents.find(e =>
                      e.entity_id === cam.entity_id ||
                      e.entity_id.includes(cam.entity_id.split('.')[1])
                    )
                    return (
                      <button
                        key={cam.entity_id}
                        onClick={() => navigate('/cameras')}
                        style={{
                          flex: '0 0 auto', width: 160, borderRadius: 10,
                          background: 'var(--bg-2)', border: '0.5px solid var(--line)',
                          overflow: 'hidden', cursor: 'pointer', padding: 0, position: 'relative',
                        }}
                      >
                        <div style={{ aspectRatio: '16/9', background: 'var(--bg-2)', overflow: 'hidden' }}>
                          <img
                            src={`${cameraSnapshotUrl(cam.entity_id)}?t=${snapTick}`}
                            alt={cam.name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                            onError={e => { e.target.style.display = 'none' }}
                          />
                        </div>
                        <div style={{ padding: '5px 8px', textAlign: 'left' }}>
                          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cam.name}</p>
                          {lastMotion
                            ? <p style={{ fontSize: 9, color: '#ef4444', fontFamily: '"IBM Plex Mono", monospace', marginTop: 1 }}>motion detected</p>
                            : <p style={{ fontSize: 9, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', marginTop: 1 }}>{cam.state}</p>
                          }
                        </div>
                      </button>
                    )
                  })}
                </div>
                {motionEvents.length > 0 && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '0.5px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: 'var(--ink-mute)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {motionEvents[0].name || motionEvents[0].entity_id.split('.')[1]?.replace(/_/g, ' ')}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', flexShrink: 0 }}>
                      {(() => {
                        const diff = Math.floor((Date.now() - new Date(motionEvents[0].timestamp)) / 1000)
                        if (diff < 60) return `${diff}s ago`
                        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
                        return `${Math.floor(diff / 3600)}h ago`
                      })()}
                    </span>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ── 4. Recent Activity — full width, collapsible ── */}
      <div style={card}>
        <button
          onClick={() => toggleWidget('activity')}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', marginBottom: isVisible('activity') ? 10 : 0, fontFamily: 'inherit' }}
        >
          <p className="z-eyebrow" style={{ margin: 0 }}>Recent</p>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transition: 'transform 0.2s', transform: isVisible('activity') ? 'rotate(180deg)' : 'none', flexShrink: 0 }}>
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>
        <AnimatePresence initial={false}>
          {isVisible('activity') && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}>
                {activity.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 168, overflowY: 'auto' }} className="scrollbar-thin">
                    {activity.slice(0, 10).map((entry, i) => {
                      const { label, timeStr, icon, ok } = formatActivity(entry)
                      return (
                        <div key={i} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: i < Math.min(activity.length, 10) - 1 ? '0.5px solid var(--line)' : 'none' }}>
                          <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: ok ? 'var(--ink-mute)' : 'var(--accent)', flexShrink: 0, marginTop: 1 }}>
                            <ZIcon name={icon} size={11} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: 12, color: 'var(--ink)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</p>
                            <p style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 9.5, color: 'var(--ink-faint)', marginTop: 1 }}>{timeStr}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p style={{ fontSize: 12, color: 'var(--ink-faint)' }}>No activity yet — restart backend to enable</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
      </div>

      {/* ── 5. Quick Asks — full width, scene-card style ── */}
      {quickAsks.length > 0 && (
        <div style={card}>
          <button
            onClick={() => toggleWidget('quick_ask')}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', marginBottom: isVisible('quick_ask') ? 12 : 0, fontFamily: 'inherit' }}
          >
            <p className="z-eyebrow" style={{ margin: 0 }}>Quick asks</p>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ transition: 'transform 0.2s', transform: isVisible('quick_ask') ? 'rotate(180deg)' : 'none', flexShrink: 0 }}>
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
          <AnimatePresence initial={false}>
            {isVisible('quick_ask') && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {quickAsks.slice(0, 6).map((qa, idx) => {
                    const tint = QA_TINTS[idx % QA_TINTS.length]
                    return (
                      <button
                        key={qa.id}
                        onClick={() => navigate('/chat', { state: { quickAsk: qa } })}
                        style={{
                          position: 'relative', overflow: 'hidden',
                          aspectRatio: '1',
                          padding: '14px 12px',
                          borderRadius: 13, border: 'none', cursor: 'pointer',
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
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ── 6. Scenes strip — collapsible, Super Admin only ── */}
      {scenesEnabled && scenes.length > 0 && (
        <div style={card}>
          <button
            onClick={() => setScenesCollapsed(v => !v)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', marginBottom: scenesCollapsed ? 0 : 10, fontFamily: 'inherit' }}
          >
            <p className="z-eyebrow" style={{ margin: 0 }}>Scenes</p>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ transition: 'transform 0.2s', transform: scenesCollapsed ? 'none' : 'rotate(180deg)', flexShrink: 0 }}>
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
          <AnimatePresence initial={false}>
            {!scenesCollapsed && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}>
                <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }} className="scrollbar-thin">
                  {scenes.map(s => {
                    const label = (s.name || s.entity_id.split('.')[1] || '').replace(/_/g, ' ')
                    const isOn  = activatingScene === s.entity_id
                    return (
                      <button key={s.entity_id} onClick={() => handleActivateScene(s.entity_id)} style={{
                        flex: '0 0 auto', padding: '8px 14px', borderRadius: 10, minWidth: 72,
                        background: isOn ? 'var(--ink)' : 'var(--surface)',
                        color: isOn ? 'var(--bg)' : 'var(--ink)',
                        border: '0.5px solid var(--line)', cursor: 'pointer', fontFamily: 'inherit',
                        transition: 'background 0.12s, color 0.12s',
                        display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 500,
                      }}>
                        <ZIcon name="scene" size={13} />
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 88 }}>{label}</span>
                      </button>
                    )
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

    </div>
  )
}
