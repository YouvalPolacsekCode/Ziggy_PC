// Hub section components — one per `type` in the layout schema.
//
// Phase 1 ships the sections referenced by DEFAULT_LAYOUT. Each section reads
// from existing Ziggy stores; nothing new on the backend is required.
// Unknown / not-yet-built types render as <UnknownSection/> placeholders.
//
// Sections deliberately render minimally compared to Dashboard.jsx. The Hub
// is glance-first on a wall tablet: large tap targets, low chrome.

import { useEffect, useMemo, useState } from 'react'
import { useDeviceStore } from '../../stores/deviceStore'
import { useAutomationStore } from '../../stores/automationStore'
import { useTaskStore } from '../../stores/taskStore'
import { useUIStore } from '../../stores/uiStore'
import {
  sendDirectIntent,
  getWeather, getMode, setMode, getAlerts,
  cameraSnapshotUrl, cameraStreamUrl,
} from '../../lib/api'
import { useWsMessages } from '../../hooks/useWebSocket'
import { useHubStore } from '../../stores/hubStore'
import DeviceCard from '../device/DeviceCard'
import { Card, CardBody } from '../ui/Card'
import { useFeature } from '../../stores/featuresStore'
import { useMediaStore } from '../../stores/mediaStore'
import { pauseMedia, resumeMedia, nextMedia } from '../../lib/api'
import { useT } from '../../lib/i18n'

// ─── Shared bits ─────────────────────────────────────────────────────────────

function SectionTitle({ children, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '4px 4px 10px' }}>
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: 0.2, color: 'var(--ink)' }}>{children}</h3>
      {action}
    </div>
  )
}

function EmptyHint({ children }) {
  return (
    <p style={{ margin: 0, padding: '12px 4px', fontSize: 13, color: 'var(--ink-faint)' }}>{children}</p>
  )
}

// ─── status_strip ────────────────────────────────────────────────────────────
// Greeting + clock. The fixed top strip in the design lives in Hub.jsx itself
// (always-on); this section is the in-body greeting when the layout calls for it.

export function StatusStripSection() {
  const now = new Date()
  const hour = now.getHours()
  const greet = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <div style={{ padding: '4px 4px 8px' }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-faint)', letterSpacing: 0.4, textTransform: 'uppercase' }}>{greet}</p>
      <p style={{ margin: '2px 0 0', fontSize: 34, fontWeight: 600, color: 'var(--ink)' }}>{time}</p>
    </div>
  )
}

// ─── rooms_carousel ──────────────────────────────────────────────────────────
// Reads ziggyRooms from deviceStore. Renders a horizontal scroll of room
// chips, each tappable to navigate. Intentionally simpler than Dashboard's
// photo-backed carousel — the Hub layout system will own visual richness
// once edit mode + per-section config land.

export function RoomsCarouselSection() {
  const ziggyRooms = useDeviceStore(s => s.ziggyRooms)
  const fetchAll   = useDeviceStore(s => s.fetchAll)
  useEffect(() => { fetchAll({ maxAge: 120_000 }).catch(() => {}) }, [fetchAll])

  if (!ziggyRooms || ziggyRooms.length === 0) {
    return (
      <Card><CardBody><EmptyHint>No rooms yet. Add rooms in Settings.</EmptyHint></CardBody></Card>
    )
  }

  return (
    <div>
      <SectionTitle>Rooms</SectionTitle>
      <div style={{
        display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4,
        scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch',
      }}>
        {ziggyRooms.map(r => (
          <a key={r.id} href={`/rooms/${encodeURIComponent(r.id)}`}
             style={{
               flex: '0 0 180px', height: 110, scrollSnapAlign: 'start',
               background: 'var(--surface)', border: '0.5px solid var(--line)',
               borderRadius: 14, padding: 14, color: 'var(--ink)', textDecoration: 'none',
               display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
             }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{r.display_name || r.name || r.id}</span>
            <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>
              {(r.entities || r.devices || []).length} devices
            </span>
          </a>
        ))}
      </div>
    </div>
  )
}

// ─── scene_grid ──────────────────────────────────────────────────────────────
// Buttons for routines/scenes. Tap to run via runRoutine (already wired into
// automationStore). Falls back to "no routines yet" with a link to /routines.

export function SceneGridSection({ config = {} }) {
  const routines      = useAutomationStore(s => s.routines)
  const fetchRoutines = useAutomationStore(s => s.fetchRoutines)
  const runRoutine    = useAutomationStore(s => s.runRoutine)
  const addToast      = useUIStore(s => s.addToast)

  useEffect(() => { fetchRoutines({ maxAge: 60_000 }).catch(() => {}) }, [fetchRoutines])

  const limit = Math.min(Number(config.limit) || 12, 24)
  const shown = (routines || []).slice(0, limit)

  if (shown.length === 0) {
    return (
      <Card><CardBody><EmptyHint>No scenes yet. Create one in Routines.</EmptyHint></CardBody></Card>
    )
  }

  const onRun = async (r) => {
    try { await runRoutine(r.id); addToast(`Ran ${r.label || r.id}`, 'success') }
    catch { addToast(`Couldn't run ${r.label || r.id}`, 'error') }
  }

  return (
    <div>
      <SectionTitle>Scenes</SectionTitle>
      <div style={{
        display: 'grid', gap: 10,
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
      }}>
        {shown.map(r => (
          <button key={r.id} onClick={() => onRun(r)}
            style={{
              aspectRatio: '1.6 / 1', minHeight: 76, padding: 14,
              background: 'var(--surface)', border: '0.5px solid var(--line)',
              borderRadius: 14, cursor: 'pointer', textAlign: 'start',
              display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
              color: 'var(--ink)',
            }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{r.label || r.id}</span>
            {r.room && <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{r.room}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── quick_devices ───────────────────────────────────────────────────────────
// Reuses the existing DeviceCard tile variant + the existing quickControlIds
// pin list. No new server state — same pins drive Dashboard and Hub today.

export function QuickDevicesSection() {
  const entities        = useDeviceStore(s => s.entities)
  const quickControlIds = useDeviceStore(s => s.quickControlIds)
  const fetchAll        = useDeviceStore(s => s.fetchAll)
  useEffect(() => { fetchAll({ maxAge: 120_000 }).catch(() => {}) }, [fetchAll])

  const entityMap = useMemo(() => {
    const m = {}
    for (const e of entities || []) m[e.entity_id] = e
    return m
  }, [entities])

  const pinned = (quickControlIds || []).map(id => entityMap[id]).filter(Boolean)

  if (pinned.length === 0) {
    return (
      <Card><CardBody><EmptyHint>Pin devices from the Dashboard or Devices page for quick access here.</EmptyHint></CardBody></Card>
    )
  }

  return (
    <div>
      <SectionTitle>Quick controls</SectionTitle>
      <div style={{
        display: 'grid', gap: 12,
        gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
      }}>
        {pinned.map(e => (
          <DeviceCard key={e.entity_id} entity={e} variant="tile" />
        ))}
      </div>
    </div>
  )
}

// ─── tasks_list ──────────────────────────────────────────────────────────────

export function TasksListSection({ config = {} }) {
  const tasks      = useTaskStore(s => s.tasks)
  const fetchTasks = useTaskStore(s => s.fetch)
  useEffect(() => { fetchTasks?.().catch?.(() => {}) }, [fetchTasks])

  const limit = Math.min(Number(config.limit) || 5, 20)
  const open  = (tasks || []).filter(t => !t.done).slice(0, limit)

  if (open.length === 0) {
    return (
      <Card>
        <CardBody>
          <SectionTitle>Tasks</SectionTitle>
          <EmptyHint>All caught up. Tap to add one.</EmptyHint>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardBody>
        <SectionTitle>Tasks</SectionTitle>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {open.map(t => (
            <li key={t.id} style={{ fontSize: 14, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--accent)', flexShrink: 0 }} />
              <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.task || t.title || '(untitled)'}</span>
              {t.due && <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{t.due}</span>}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}

// ─── alerts_inbox ────────────────────────────────────────────────────────────
// Live alerts from /api/alerts (flattened active_anomalies + sensor alerts).
// Re-fetches when an anomaly_active WS message arrives so new alerts appear
// without polling.

export function AlertsInboxSection({ config = {} }) {
  const [alerts, setAlerts] = useState([])
  const [loaded, setLoaded] = useState(false)
  const messages = useWsMessages()
  const limit = Math.min(Number(config.limit) || 5, 20)

  const load = () => getAlerts(limit).then(r => { setAlerts(r.alerts || []); setLoaded(true) }).catch(() => setLoaded(true))
  useEffect(() => { load() }, [limit])

  // Trigger a refresh on relevant WS events. The latest message is enough —
  // useWsMessages re-renders us on every new item.
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last) return
    if (last.type === 'anomaly_active' || last.type === 'anomaly_cleared') load()
  }, [messages.length])

  if (loaded && alerts.length === 0) {
    return (
      <Card><CardBody>
        <SectionTitle>Alerts</SectionTitle>
        <EmptyHint>All clear.</EmptyHint>
      </CardBody></Card>
    )
  }

  const sevColor = (s) => s === 'critical' ? 'var(--err)' : 'var(--warn, #d97706)'
  const fmtSince = (ts) => {
    if (!ts) return ''
    const age = Math.floor(Date.now() / 1000 - ts)
    if (age < 60)    return 'just now'
    if (age < 3600)  return `${Math.floor(age / 60)}m ago`
    if (age < 86400) return `${Math.floor(age / 3600)}h ago`
    return `${Math.floor(age / 86400)}d ago`
  }

  return (
    <Card><CardBody>
      <SectionTitle>Alerts</SectionTitle>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {alerts.map((a, i) => (
          <li key={`${a.room_id}:${a.rule_id}:${i}`} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: sevColor(a.severity), marginTop: 6, flexShrink: 0 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--ink)' }}>{a.message || a.rule_id}</p>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--ink-faint)' }}>
                {a.room_id || ''}{a.room_id && a.since ? ' · ' : ''}{fmtSince(a.since)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </CardBody></Card>
  )
}

// ─── weather_card ────────────────────────────────────────────────────────────
// Calls /api/weather with optional city override. Cached server-side for 10
// minutes, so refreshes on this tile are cheap.

const _WMO_GLYPH = (code) => {
  // Open-Meteo WMO weather codes → short glyph + label. Keep it minimal — a
  // dedicated icon set is overkill for a 1-line summary.
  if (code == null) return ['—', 'Unknown']
  if (code === 0) return ['☀', 'Clear']
  if (code <= 3) return ['⛅', 'Partly cloudy']
  if (code <= 49) return ['🌫', 'Fog']
  if (code <= 59) return ['🌦', 'Drizzle']
  if (code <= 69) return ['🌧', 'Rain']
  if (code <= 79) return ['🌨', 'Snow']
  if (code <= 84) return ['🌧', 'Showers']
  if (code <= 99) return ['⛈', 'Thunderstorm']
  return ['—', `Code ${code}`]
}

export function WeatherCardSection({ config = {} }) {
  const [data, setData] = useState(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    getWeather(config.city || null)
      .then(r => { if (alive) { setData(r); setLoaded(true) } })
      .catch(() => { if (alive) setLoaded(true) })
    // Refresh every 15 minutes — server cache is 10 min so this is one fresh
    // fetch per cycle when the tile stays on screen.
    const id = setInterval(() => {
      getWeather(config.city || null).then(r => alive && setData(r)).catch(() => {})
    }, 15 * 60 * 1000)
    return () => { alive = false; clearInterval(id) }
  }, [config.city])

  const current = data?.current
  if (loaded && !current) {
    return (
      <Card><CardBody>
        <SectionTitle>Weather</SectionTitle>
        <EmptyHint>{data?.city ? `Couldn't reach weather service for ${data.city}.` : 'Set a city in Settings to enable weather.'}</EmptyHint>
      </CardBody></Card>
    )
  }
  if (!current) {
    return (
      <Card><CardBody>
        <SectionTitle>Weather</SectionTitle>
        <EmptyHint>Loading…</EmptyHint>
      </CardBody></Card>
    )
  }

  const [glyph, label] = _WMO_GLYPH(current.weathercode)
  return (
    <Card><CardBody>
      <SectionTitle>{data?.city || 'Weather'}</SectionTitle>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ fontSize: 40, lineHeight: 1 }}>{glyph}</span>
        <div>
          <p style={{ margin: 0, fontSize: 30, fontWeight: 600, color: 'var(--ink)' }}>
            {Math.round(current.temperature)}°
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--ink-faint)' }}>
            {label} · wind {Math.round(current.windspeed)} km/h
          </p>
        </div>
      </div>
    </CardBody></Card>
  )
}

// ─── mode_switcher ───────────────────────────────────────────────────────────
// Reads /api/mode, listens for `mode_changed` WS events from other tablets,
// and POSTs on selection. Pure UI for v1 — switching modes doesn't trigger
// scenes yet; that hook lands in slice 4.

const _MODE_LABELS = { home: 'Home', away: 'Away', night: 'Night', vacation: 'Vacation' }

export function ModeSwitcherSection() {
  const [mode, setLocalMode] = useState(null)
  const [busy, setBusy] = useState(false)
  const addToast = useUIStore(s => s.addToast)
  const messages = useWsMessages()

  useEffect(() => {
    getMode().then(r => setLocalMode(r?.mode || 'home')).catch(() => setLocalMode('home'))
  }, [])

  // Stay in sync if another tablet changes the mode.
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (last?.type === 'mode_changed' && last.mode) setLocalMode(last.mode)
  }, [messages.length])

  const onPick = async (m) => {
    if (m === mode || busy) return
    setBusy(true)
    const prev = mode
    setLocalMode(m)  // optimistic
    try { await setMode(m); addToast(`Mode: ${_MODE_LABELS[m] || m}`, 'success') }
    catch { setLocalMode(prev); addToast('Could not change mode', 'error') }
    finally { setBusy(false) }
  }

  return (
    <Card><CardBody>
      <SectionTitle>Mode</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        {Object.entries(_MODE_LABELS).map(([k, label]) => {
          const active = mode === k
          return (
            <button key={k} onClick={() => onPick(k)} disabled={busy}
              style={{
                padding: '12px 10px', borderRadius: 12, cursor: 'pointer', fontWeight: 600, fontSize: 13,
                background: active ? 'var(--accent, #4f46e5)' : 'var(--bg)',
                color:      active ? 'white' : 'var(--ink)',
                border:     `0.5px solid ${active ? 'transparent' : 'var(--line)'}`,
              }}>{label}</button>
          )
        })}
      </div>
    </CardBody></Card>
  )
}

// ─── camera_tile ─────────────────────────────────────────────────────────────
// Polled snapshot. Entity_id comes from section.config.entity_id (set via the
// per-section config sheet). Polling pauses when the tab is hidden.

// CameraLiveModal — fullscreen MJPEG stream from /api/cameras/{id}/stream.
// The browser's <img> tag decodes multipart/x-mixed-replace streams natively
// (no hls.js / no <video> needed), matching what the Cameras page does today.
// Escape key and backdrop tap close. While open we suspend the snapshot
// polling on the tile so we're not duplicating bandwidth.

function CameraLiveModal({ entityId, label, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="z-hub-cam-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="z-hub-cam-modal-inner" onClick={e => e.stopPropagation()}>
        <div className="z-hub-cam-modal-bar">
          <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
          <button onClick={onClose} aria-label="Close" className="z-hub-cam-modal-close">×</button>
        </div>
        <div className="z-hub-cam-modal-stage">
          {/* Browsers render MJPEG inline in <img>. Drop alt to avoid showing
              broken-image text if the stream stalls — backdrop already
              signals "video area". */}
          <img src={cameraStreamUrl(entityId)} alt="" />
        </div>
      </div>
    </div>
  )
}

export function CameraTileSection({ config = {} }) {
  const entityId = config.entity_id
  const refreshMs = Math.max(2000, Math.min(Number(config.refresh_ms) || 4000, 60000))
  const editing = useHubStore(s => s.editing)
  // Cache-buster so the browser refetches instead of serving the cached JPEG.
  const [stamp, setStamp] = useState(() => Date.now())
  const [visible, setVisible] = useState(typeof document !== 'undefined' ? document.visibilityState === 'visible' : true)
  const [liveOpen, setLiveOpen] = useState(false)

  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  useEffect(() => {
    // Pause snapshot polling while the live modal is open — the stream
    // already shows fresh frames and the snapshot poll would just waste
    // bandwidth + HA round-trips.
    if (!entityId || !visible || liveOpen) return
    const id = setInterval(() => setStamp(Date.now()), refreshMs)
    return () => clearInterval(id)
  }, [entityId, visible, refreshMs, liveOpen])

  if (!entityId) {
    return (
      <Card><CardBody>
        <SectionTitle>Camera</SectionTitle>
        <EmptyHint>Tap the gear icon in edit mode to pick a camera.</EmptyHint>
      </CardBody></Card>
    )
  }

  const src = `${cameraSnapshotUrl(entityId)}?t=${stamp}`
  const niceName = config.label || entityId.split('.').slice(-1)[0].replace(/_/g, ' ')

  // Tile is tappable only when NOT editing — in edit mode the overlay buttons
  // own the interactions and tapping the tile to open a live view would fight
  // with the gear/×/drag buttons.
  const onTileClick = () => { if (!editing) setLiveOpen(true) }

  return (
    <>
      <div
        onClick={onTileClick}
        role={editing ? undefined : 'button'}
        tabIndex={editing ? -1 : 0}
        onKeyDown={editing ? undefined : (e) => { if (e.key === 'Enter') setLiveOpen(true) }}
        style={{
          position: 'relative', borderRadius: 14, overflow: 'hidden',
          background: '#000', border: '0.5px solid var(--line)',
          aspectRatio: '16 / 9',
          cursor: editing ? 'default' : 'pointer',
        }}
      >
        <img src={src} alt={niceName}
             style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
             onError={(e) => { e.currentTarget.style.opacity = '0.3' }} />
        <div style={{
          position: 'absolute', left: 10, bottom: 8,
          background: 'rgba(0,0,0,0.55)', color: 'white',
          fontSize: 12, padding: '4px 8px', borderRadius: 6,
        }}>{niceName}</div>
        {!editing && (
          <div style={{
            position: 'absolute', right: 10, top: 8,
            background: 'rgba(0,0,0,0.55)', color: 'white',
            fontSize: 10, padding: '3px 7px', borderRadius: 999,
            letterSpacing: 0.4, textTransform: 'uppercase',
          }}>Live ▸</div>
        )}
      </div>
      {liveOpen && (
        <CameraLiveModal entityId={entityId} label={niceName} onClose={() => setLiveOpen(false)} />
      )}
    </>
  )
}

// ─── command_button ──────────────────────────────────────────────────────────
// Bound to a Ziggy intent — taps fire /api/direct-intent. The action lives in
// section.config; the LayoutRenderer passes it through.

export function CommandButtonSection({ config = {} }) {
  const addToast = useUIStore(s => s.addToast)
  const label = config.label || 'Run'
  const action = config.action || null

  const onTap = async () => {
    if (!action) return
    try {
      if (action.kind === 'intent') {
        await sendDirectIntent(action.intent, action.params || {}, 'hub')
        addToast(`Sent: ${label}`, 'success')
      } else {
        addToast(`Action kind "${action.kind}" not supported yet`, 'error')
      }
    } catch {
      addToast(`Failed: ${label}`, 'error')
    }
  }

  return (
    <button onClick={onTap} style={{
      width: '100%', minHeight: 76, padding: 14,
      background: 'var(--surface)', border: '0.5px solid var(--line)',
      borderRadius: 14, cursor: 'pointer', textAlign: 'start',
      display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      color: 'var(--ink)',
    }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
    </button>
  )
}

// ─── media_card ──────────────────────────────────────────────────────────────
// Phase 1+2 media. Self-gated on the media_music feature flag — when the flag
// is off, the section renders a placeholder telling the user to enable Music
// in Settings, so it doesn't silently take up grid space.
//
// Lists every enabled speaker with its current playback state and a
// play/pause + next button. Transport only — no search, no profile picker
// (that's all in Settings → Music). The tablet user reads what's playing and
// can adjust on the fly.

export function MediaCardSection({ config = {} }) {
  const enabled      = useFeature('media_music')
  const items        = useMediaStore(s => s.items)
  const ensureLoaded = useMediaStore(s => s.ensureLoaded)
  const refreshState = useMediaStore(s => s.refreshState)
  const ws           = useWsMessages()
  const t            = useT()
  useEffect(() => { if (enabled) ensureLoaded() }, [enabled, ensureLoaded])
  useEffect(() => {
    if (!enabled || !ws?.length) return
    const last = ws[ws.length - 1]
    if (last?.type === 'state_changed' && last.entity_id?.startsWith('media_player.')) {
      refreshState()
    }
  }, [ws, enabled, refreshState])

  if (!enabled) {
    return (
      <Card><CardBody>
        <SectionTitle>{t('media.hub.title')}</SectionTitle>
        <EmptyHint>{t('media.hub.featureOffHint')}</EmptyHint>
      </CardBody></Card>
    )
  }

  if (!items || items.length === 0) {
    return (
      <Card><CardBody>
        <SectionTitle>{t('media.hub.title')}</SectionTitle>
        <EmptyHint>{t('media.hub.noSpeakersHint')}</EmptyHint>
      </CardBody></Card>
    )
  }

  // Sort: currently-playing first, then by name.
  const sorted = [...items].sort((a, b) => {
    if (a.state === 'playing' && b.state !== 'playing') return -1
    if (b.state === 'playing' && a.state !== 'playing') return 1
    return (a.display_name || '').localeCompare(b.display_name || '')
  })
  void config

  return (
    <Card><CardBody>
      <SectionTitle>{t('media.hub.title')}</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sorted.map(it => <HubSpeakerRow key={it.entity_id} item={it} t={t} />)}
      </div>
    </CardBody></Card>
  )
}

const KNOWN_PLAYER_STATES = new Set(['playing', 'paused', 'idle', 'off', 'unavailable', 'unknown'])

function HubSpeakerRow({ item, t }) {
  const [busy, setBusy] = useState(false)
  const playing = item.state === 'playing'
  const onPause  = async () => { setBusy(true); try { await pauseMedia(item.entity_id) } finally { setBusy(false) } }
  const onResume = async () => { setBusy(true); try { await resumeMedia(item.entity_id) } finally { setBusy(false) } }
  const onNext   = async () => { setBusy(true); try { await nextMedia(item.entity_id) } finally { setBusy(false) } }

  // Only translate known states; unknown values (e.g. "buffering") are hidden
  // rather than leaking the raw HA value or a missing-i18n-key string.
  const stateKey = item.state && KNOWN_PLAYER_STATES.has(item.state) ? item.state : null
  const friendlyState = playing || !stateKey ? null : t(`media.state.${stateKey}`)
  const speakerName = item.display_name || t('media.unnamedSpeaker')

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 8px', borderRadius: 10, border: '0.5px solid var(--line)' }}>
      <div style={{
        width: 44, height: 44, borderRadius: 8, flexShrink: 0,
        background: item.art ? `center/cover no-repeat url('${item.art}')` : 'var(--line)',
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div dir="auto" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.title || speakerName}
        </div>
        <div dir="auto" style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {[item.artist, item.room || null, friendlyState].filter(Boolean).join(' · ')}
        </div>
      </div>
      <button type="button" disabled={busy} onClick={playing ? onPause : onResume} style={hubBtn} aria-label={playing ? t('media.hub.pause') : t('media.hub.play')}>
        {playing ? '⏸' : '▶'}
      </button>
      {playing && (
        <button type="button" disabled={busy} onClick={onNext} style={hubBtn} aria-label={t('media.hub.next')}>
          ⏭
        </button>
      )}
    </div>
  )
}

const hubBtn = {
  width: 40, height: 40, borderRadius: 20,
  background: 'var(--accent)', color: 'white',
  border: 'none', fontSize: 16, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  flexShrink: 0,
}

// ─── unknown / unsupported ───────────────────────────────────────────────────

export function UnknownSection({ type, id }) {
  return (
    <Card><CardBody>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-faint)' }}>
        Unsupported widget <code style={{ fontFamily: 'inherit' }}>{type || '?'}</code>. Update the Hub to view this.
      </p>
    </CardBody></Card>
  )
}
