import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDeviceStore } from '../stores/deviceStore'
import { useTaskStore } from '../stores/taskStore'
import { useAutomationStore } from '../stores/automationStore'
import { useSuggestionStore } from '../stores/suggestionStore'
import { useQuickAskStore } from '../stores/quickAskStore'
import { useUIStore } from '../stores/uiStore'
import { useAuthStore } from '../stores/authStore'
import { useWebSocket } from '../hooks/useWebSocket'
import { greetingByTime } from '../lib/utils'
import { getActivity, getActiveAnomalies, getHealth, reloadZigbee, getPresencePersons, getUpdateStatus, sendDirectIntent } from '../lib/api'
import { getRoomPhoto } from '../lib/roomPhotos'
import { DeviceCard } from '../components/device/DeviceCard'
import { QuickControlsPicker } from '../components/QuickControlsPicker'
import { Modal } from '../components/ui/Modal'
import { Pencil, Play, Sparkles, Check } from 'lucide-react'

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
const INTENT_LABELS = {
  toggle_device:        'Device',
  control_device:       'Device',
  control_tv:           'TV',
  ir_send_command:      'IR',
  create_automation:    'Automation created',
  create_task:          'Task created',
  unrecognized_command: 'Unrecognized command',
  get_temperature:      'Checked temperature',
  get_humidity:         'Checked humidity',
  get_sensor:           'Checked sensor',
  get_room_summary:     'Room summary',
  list_devices:         'Listed devices',
  list_active_devices:  'Listed active devices',
  get_device_state:     'Checked device state',
  is_someone_home:      'Checked presence',
  get_presence:         'Checked presence',
}
function prettifyIntent(intent) {
  const words = intent.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
function formatActivity(entry, entityMap) {
  const ts   = new Date(entry.ts)
  const diff = Math.floor((Date.now() - ts) / 60000)
  const timeStr = diff < 1 ? 'now' : diff < 60 ? `${diff}m` : diff < 1440 ? `${Math.floor(diff / 60)}h` : ts.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const { intent, action, room, entity_id } = entry
  const ent = entity_id ? entityMap?.[entity_id] : null
  const entName = ent?.display_name || ent?.friendly_name || (entity_id ? entity_id.split('.').slice(-1)[0].replace(/_/g, ' ') : null)

  let label
  if (intent === 'create_automation' || intent === 'create_task') {
    label = INTENT_LABELS[intent]
  } else if (intent === 'toggle_device' || intent === 'control_device') {
    const head = entName || INTENT_LABELS[intent]
    label = action ? `${head} · ${action}${room ? ` · ${room}` : ''}` : head
  } else if (intent === 'control_tv' || intent === 'ir_send_command') {
    const head = INTENT_LABELS[intent]
    label = `${head} ${action}${room ? ` · ${room}` : ''}`
  } else if (INTENT_LABELS[intent]) {
    label = room ? `${INTENT_LABELS[intent]} · ${room}` : INTENT_LABELS[intent]
  } else {
    label = prettifyIntent(intent) + (action && action !== intent ? ` · ${action}` : '')
  }
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

// (ControlTile removed — Quick Controls now uses the unified DeviceCard variant="tile".)

// ── Rooms carousel — production-grade centered snap ───────────────────────────
// One dominant card fills ~78% of the viewport. Neighbouring tiles peek ~24px
// each side. All tiles are the same DOM width → snap points never shift.
// Uniform scale() keeps photo proportions correct. Shadow lifts active tile.
const C_W   = 300   // tile DOM width (px) — set once, never changes
const C_H   = 206   // tile DOM height
const C_GAP = 14    // gap between tiles
const C_PAD = 20    // horizontal padding inside scroll container

function RoomsCarousel({ sortedRooms, ziggyRooms }) {
  const navigate  = useNavigate()
  const scrollRef = useRef(null)
  const tileRefs  = useRef([])
  const [activeIdx, setActiveIdx] = useState(0)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const handle = () => {
      const cx = el.getBoundingClientRect().left + el.clientWidth / 2
      let best = 0, minD = Infinity
      tileRefs.current.forEach((tile, i) => {
        if (!tile) return
        const r = tile.getBoundingClientRect()
        const d = Math.abs(r.left + r.width / 2 - cx)
        if (d < minD) { minD = d; best = i }
      })
      setActiveIdx(best)
    }
    el.addEventListener('scroll', handle, { passive: true })
    return () => el.removeEventListener('scroll', handle)
  }, [sortedRooms.length])

  if (!sortedRooms.length) return null

  // Vertical padding so the active-tile shadow doesn't clip
  const vPad = 14

  return (
    <div>
      <p className="z-eyebrow" style={{ marginBottom: 10 }}>Rooms</p>
      {/* outer clips left/right overflow.
          The `.z-carousel-bleed` class extends the carousel beyond the page
          padding on phones/tablets so tiles scroll to the screen edges
          (matches the iOS-app feel). On lg+ the bleed is disabled because
          the carousel lives inside the 2-col grid's main column and would
          otherwise visually overflow into the right rail. */}
      <div className="z-carousel-bleed" style={{ overflow: 'hidden' }}>
        <div
          ref={scrollRef}
          style={{
            display: 'flex', gap: C_GAP,
            overflowX: 'auto',
            // Side padding scales with the scroll-container width so the first
            // and last tiles can actually reach the viewport center when
            // `scroll-snap-align: center` kicks in. On mobile the calc falls
            // through to the 20px floor (the old behavior). On a wide desktop
            // main column it grows so the carousel scrolls fully both ways.
            paddingLeft:  `max(${C_PAD}px, calc((100% - ${C_W}px) / 2))`,
            paddingRight: `max(${C_PAD}px, calc((100% - ${C_W}px) / 2))`,
            paddingTop: vPad, paddingBottom: vPad,
            scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch',
          }}
          className="no-scrollbar"
        >
          {sortedRooms.map((summary, idx) => {
            const room = ziggyRooms.find(r => r.id === summary.id)
            if (!room) return null
            const photo = getRoomPhoto(room)
            const isActive = idx === activeIdx
            return (
              <div
                key={room.id}
                ref={el => { tileRefs.current[idx] = el }}
                onClick={() => navigate(`/rooms/${room.id}`)}
                style={{
                  position: 'relative', flexShrink: 0,
                  width: C_W, height: C_H,
                  borderRadius: 18, overflow: 'hidden', cursor: 'pointer',
                  scrollSnapAlign: 'center',
                  // Scale + opacity — no layout change, no jump
                  transform: isActive ? 'scale(1)' : 'scale(0.88)',
                  opacity:   isActive ? 1 : 0.6,
                  // Elevation on active card (standard depth cue)
                  boxShadow: isActive ? '0 10px 28px rgba(0,0,0,0.32)' : 'none',
                  // Material ease-in-out, 300ms — matches platform expectations
                  transition: 'transform 300ms cubic-bezier(0.4,0,0.2,1), opacity 300ms cubic-bezier(0.4,0,0.2,1), box-shadow 300ms cubic-bezier(0.4,0,0.2,1)',
                  transformOrigin: 'center center',
                }}
              >
                <img src={photo} alt={room.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.06) 0%, transparent 35%, rgba(0,0,0,0.68) 100%)' }} />

                {/* Active dot — same criteria as the greeting's "N rooms active"
                    count so they never disagree. Previously the dot only checked
                    activeCount > 0, while the greeting also counted hasMotion,
                    so a room with motion but no on-devices was counted in the
                    header but rendered as an "idle" tile with a grey dot. */}
                {(() => {
                  const isActiveRoom = summary.activeCount > 0 || summary.hasMotion
                  return (
                    <span style={{
                      position: 'absolute', top: 12, right: 12,
                      width: 8, height: 8, borderRadius: '50%',
                      background: isActiveRoom ? '#6CBF8C' : 'rgba(255,255,255,0.3)',
                      boxShadow: isActiveRoom ? '0 0 0 3px rgba(108,191,140,0.3)' : 'none',
                    }} />
                  )
                })()}

                {/* Sensor chips — active only. Temperature is tinted by the
                    same indoor-comfort thresholds used on the Rooms page
                    (<18°C cool blue, 18–25°C neutral, >25°C warm red) so
                    the two surfaces read as the same design system. Unit is
                    sniffed from HA's unit_of_measurement attribute so the
                    threshold stays sensible whether the sensor reports °C or °F. */}
                {isActive && (summary.tempSensor || summary.humSensor) && (
                  <div style={{ position: 'absolute', top: 11, left: 12, display: 'flex', gap: 5 }}>
                    {summary.tempSensor && (() => {
                      const raw = parseFloat(summary.tempSensor.state)
                      const unit = summary.tempSensor.unit_of_measurement
                                || summary.tempSensor.attributes?.unit_of_measurement
                                || '°C'
                      const tempC = unit.includes('F') ? (raw - 32) * 5 / 9 : raw
                      const bg = tempC < 18 ? 'rgba(60, 130, 220, 0.55)'
                               : tempC > 25 ? 'rgba(220, 80, 60, 0.55)'
                               : 'rgba(0, 0, 0, 0.32)'
                      return (
                        <span style={{ fontSize: 10.5, color: '#fff', fontFamily: '"IBM Plex Mono", monospace', background: bg, backdropFilter: 'blur(8px)', padding: '3px 7px', borderRadius: 999 }}>
                          {raw.toFixed(1)}°
                        </span>
                      )
                    })()}
                    {summary.humSensor && (
                      <span style={{ fontSize: 10.5, color: '#fff', fontFamily: '"IBM Plex Mono", monospace', background: 'rgba(0,0,0,0.32)', backdropFilter: 'blur(8px)', padding: '3px 7px', borderRadius: 999 }}>
                        {parseFloat(summary.humSensor.state).toFixed(0)}%
                      </span>
                    )}
                  </div>
                )}

                {/* Name + status */}
                <div style={{ position: 'absolute', bottom: 12, left: 14, right: 14 }}>
                  <p style={{ fontSize: 13, fontWeight: 650, color: '#fff', margin: '0 0 3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.02em' }}>{room.name}</p>
                  <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', margin: 0, fontFamily: '"IBM Plex Mono", monospace' }}>
                    {/* Same condition as the dot and greeting count: a room with
                        motion but zero on-devices is still "active" to the user. */}
                    {summary.activeCount > 0
                      ? `${summary.activeCount} active`
                      : summary.hasMotion
                        ? 'motion'
                        : 'idle'}
                    {isActive && summary.parts.length > 0 && ` · ${summary.parts[0]}`}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Shortcuts: merged Routines + Quick Asks tile grid ────────────────────────
// One semantic surface for "tap to fire a thing." Routine = multi-step sequence.
// Ask = a single saved intent + params. Visually distinct on the tile (mono
// kind label) and in the picker (two sections). Max 8 pinned, 2 rows × 4.
// Trailing row is left sparse when count is 5/6/7 — iOS home-screen pattern,
// no awkward centering attempts.
function ShortcutsSection({ pinnedShortcuts, routines, asks, onFireRoutine, onFireAsk, onEdit }) {
  if (pinnedShortcuts.length === 0) return null

  // Resolve each pin to its live record. Drop stale pins silently.
  const routineMap = Object.fromEntries(routines.map(r => [r.id, r]))
  const askMap     = Object.fromEntries(asks.map(a => [a.id, a]))
  const resolved = pinnedShortcuts
    .map(s => s.type === 'routine'
      ? { ...s, record: routineMap[s.id] }
      : { ...s, record: askMap[s.id] })
    .filter(s => s.record)

  if (resolved.length === 0) return null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <p className="z-eyebrow">Shortcuts</p>
        <button
          onClick={onEdit}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 11, color: 'var(--ink-faint)', fontFamily: 'inherit', padding: '2px 4px',
          }}
        >
          <Pencil size={11} /> Edit
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
        {resolved.map(s => (
          <ShortcutTile
            key={`${s.type}:${s.id}`}
            type={s.type}
            record={s.record}
            onFire={() => s.type === 'routine' ? onFireRoutine(s.record) : onFireAsk(s.record)}
          />
        ))}
      </div>
    </div>
  )
}

function ShortcutTile({ type, record, onFire }) {
  const [pending, setPending] = useState(false)
  const icon  = record.icon || (type === 'routine' ? '⚡' : '✦')
  const label = type === 'routine' ? record.name : record.label
  const kind  = type === 'routine' ? 'routine' : 'ask'
  const tint  = type === 'routine' ? 'var(--ok)' : 'var(--accent)'

  const handle = async () => {
    if (pending) return
    setPending(true)
    try { await onFire() } finally { setTimeout(() => setPending(false), 600) }
  }

  return (
    <button
      onClick={handle}
      aria-label={`${kind}: ${label}`}
      style={{
        // Trust aspectRatio for a true square. The previous `minHeight: 92`
        // overrode aspectRatio on narrow phones (Galaxy S24, iPhone SE) and
        // forced 74×92 tiles — the "squished tall" look.
        position: 'relative', aspectRatio: '1 / 1',
        padding: 10, borderRadius: 14,
        // Cozy tinted tile — matches Pinned-devices palette family. Shortcuts
        // are stateless ("always alive"), so they get a single mid-saturation
        // tint, halfway between Pinned OFF and Pinned ON.
        background: `color-mix(in srgb, ${tint} 14%, var(--tile-base))`,
        color: 'var(--ink)',
        border: '0.5px solid ' + `color-mix(in srgb, ${tint} 24%, var(--line))`,
        textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        opacity: pending ? 0.6 : 1,
        transition: 'opacity 0.15s, transform 0.1s',
      }}
    >
      <div style={{
        width: 26, height: 26, borderRadius: 7,
        background: `color-mix(in srgb, ${tint} 32%, var(--tile-base))`,
        color: `color-mix(in srgb, ${tint} 80%, var(--ink))`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 15,
      }}>{icon}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.01em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </div>
        {/* Type cue stays small + neutral — tile color already encodes the type. */}
        <div className="z-mono" style={{ fontSize: 9, color: 'var(--ink-faint)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {kind}
        </div>
      </div>
    </button>
  )
}

function ShortcutsPicker({ open, onClose, routines, asks, pinnedShortcuts, togglePinnedShortcut }) {
  const SHORTCUTS_MAX = 8
  const pinnedSet = new Set(pinnedShortcuts.map(s => `${s.type}:${s.id}`))
  const isFull    = pinnedShortcuts.length >= SHORTCUTS_MAX

  const renderRow = (type, record) => {
    const key      = `${type}:${record.id}`
    const isPinned = pinnedSet.has(key)
    const disabled = isFull && !isPinned
    const label    = type === 'routine' ? record.name : record.label
    const icon     = record.icon || (type === 'routine' ? '⚡' : '✦')
    return (
      <button
        key={key}
        onClick={() => togglePinnedShortcut(type, record.id)}
        disabled={disabled}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          padding: '10px 12px', borderRadius: 10, cursor: disabled ? 'not-allowed' : 'pointer',
          background: isPinned ? 'color-mix(in srgb, var(--ok) 8%, var(--surface))' : 'var(--surface)',
          border: '0.5px solid ' + (isPinned ? 'color-mix(in srgb, var(--ok) 30%, var(--line))' : 'var(--line)'),
          opacity: disabled ? 0.4 : 1, fontFamily: 'inherit', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 16, width: 22, textAlign: 'center' }}>{icon}</span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--ink)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        {isPinned && <Check size={15} style={{ color: 'var(--ok)', flexShrink: 0 }} />}
      </button>
    )
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit shortcuts">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <p style={{ fontSize: 11.5, color: 'var(--ink-mute)', margin: 0 }}>
          {pinnedShortcuts.length} / {SHORTCUTS_MAX} pinned · tap to add or remove
        </p>

        {/* Routines */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Play size={11} style={{ color: 'var(--ok)' }} />
            <p className="z-eyebrow" style={{ margin: 0 }}>Routines</p>
            <span className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{routines.length}</span>
          </div>
          {routines.length === 0 ? (
            <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', padding: '8px 4px' }}>No routines yet — create one from the Automations page.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {routines.map(r => renderRow('routine', r))}
            </div>
          )}
        </div>

        {/* Quick Asks */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Sparkles size={11} style={{ color: 'var(--accent)' }} />
            <p className="z-eyebrow" style={{ margin: 0 }}>Quick Asks</p>
            <span className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{asks.length}</span>
          </div>
          {asks.length === 0 ? (
            <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', padding: '8px 4px' }}>No quick asks yet — create one from Settings → Quick Asks.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {asks.map(a => renderRow('ask', a))}
            </div>
          )}
        </div>

        <button onClick={onClose} className="z-btn-primary" style={{ width: '100%', padding: '10px', borderRadius: 10 }}>
          Done
        </button>
      </div>
    </Modal>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate()
  const { entities, ziggyRooms, fetchAll, quickControlIds, pinnedShortcuts, togglePinnedShortcut } = useDeviceStore()
  const [showQuickPicker,     setShowQuickPicker]     = useState(false)
  const [showShortcutsPicker, setShowShortcutsPicker] = useState(false)
  const { tasks, fetch: fetchTasks }                  = useTaskStore()
  const { fetchAutomations, fetchRoutines, routines, runRoutine } = useAutomationStore()
  const { fetch: fetchSuggestions, pendingCount, pending: pendingSuggestions, accept: acceptSuggestionAction, reject: rejectSuggestionAction } = useSuggestionStore()
  const { items: quickAsks, fetch: fetchQuickAsks }   = useQuickAskStore()
  const { addToast }                                  = useUIStore()
  const role                                          = useAuthStore(s => s.role)
  const isSuperAdmin                                  = role === 'super_admin'

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

  const loadAnomalies = useCallback(() => {
    getActiveAnomalies()
      .then(r => setAnomalies(Object.values(r.anomalies ?? {}).flat()))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchAll(); fetchTasks(); fetchAutomations(); fetchRoutines(); fetchSuggestions(); fetchQuickAsks()
    getActivity(15).then(r => setActivity(r.activity ?? [])).catch(() => {})
    loadAnomalies()
    getHealth().then(setHealth).catch(() => {})
    getPresencePersons().then(r => setPresencePersons(r.persons ?? [])).catch(() => {})
    if (isSuperAdmin) {
      getUpdateStatus().then(setHaUpdateStatus).catch(() => {})
    }
  }, [isSuperAdmin])

  useEffect(() => {
    const id = setInterval(() => {
      getPresencePersons().then(r => setPresencePersons(r.persons ?? [])).catch(() => {})
    }, 30_000)
    return () => clearInterval(id)
  }, [])

  // Live anomaly refresh — engine broadcasts anomaly_active/cleared on every
  // fire/clear. Refresh the alert card and the Dashboard banners when one
  // arrives so the user doesn't have to navigate away and back.
  const { messages } = useWebSocket()
  const lastSeenWsTs = useRef(0)
  useEffect(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (!m || m.ts <= lastSeenWsTs.current) break
      if (m.type === 'anomaly_active' || m.type === 'anomaly_cleared') {
        loadAnomalies()
        break
      }
    }
    if (messages.length) lastSeenWsTs.current = messages[messages.length - 1].ts
  }, [messages, loadAnomalies])

  const pendingTasks = tasks.filter(t => !t.done && !t.completed)
  const overdueTasks = pendingTasks.filter(t => t.due_date && new Date(t.due_date) < new Date())
  const entityMap    = Object.fromEntries(entities.map(e => [e.entity_id, e]))
  const roomSummaries = ziggyRooms.map(r => buildRoomSummary(r, entityMap))
  const sortedRooms   = [...roomSummaries].sort((a, b) => ((b.activeCount > 0 || b.hasMotion ? 1 : 0) - (a.activeCount > 0 || a.hasMotion ? 1 : 0)))
  const activeRooms   = roomSummaries.filter(r => r.activeCount > 0 || r.hasMotion)

  const criticalAnomalies = anomalies.filter(a => a.severity === 'critical')
  const warningAnomalies  = anomalies.filter(a => a.severity === 'warning')
  const haOffline    = health !== null && health.ha_connected === false
  const coordWarning = health?.coordinator_warning && !haOffline

  const haUpdateRisk = isSuperAdmin && haUpdateStatus?.update_available ? haUpdateStatus.risk_level : null
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

  // Presence string: "Maya & kids home" style
  const homeNames = homePersons.map(p => p.name)
  const presenceStr = homeNames.length === 0
    ? 'Nobody home'
    : homeNames.length === 1
      ? `${homeNames[0]} home`
      : homeNames.length === 2
        ? `${homeNames[0]} & ${homeNames[1]} home`
        : `${homeNames.slice(0, -1).join(', ')} & ${homeNames[homeNames.length - 1]} home`

  // Top pending suggestion for the right-rail "Suggested" card.
  // Picking just the first one matches the design mockup — surface ONE concrete
  // thing the user can act on, link to /suggestions for the full list.
  const topSuggestion = pendingSuggestions()[0]

  return (
    // Wide max-width: accommodates the desktop 2-col grid (main + 320px rail
    // + 24px gap). Single-column on phone/tablet via `.z-dashboard-grid`.
    <div style={{ maxWidth: 'var(--page-max-w-wide)', margin: '0 auto', padding: '20px 20px 100px' }}>
      <div className="z-dashboard-grid">

      {/* ─── MAIN COLUMN ─── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

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
          {/* Alert chips inline — mobile/tablet only. On lg+ the full Alerts
              card in the right rail replaces these to avoid duplication. */}
          <span className="hide-lg" style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
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
          </span>
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

      {/* ── 3. Shortcuts — merged Routines + Quick Asks. Hidden when empty;
              user pins via the section's Edit button (opens ShortcutsPicker).
              Empty state surfaces as the Pinned-devices section below. ── */}
      <ShortcutsSection
        pinnedShortcuts={pinnedShortcuts}
        routines={routines}
        asks={quickAsks}
        onFireRoutine={async (r) => {
          try { await runRoutine(r.id); addToast(`Running "${r.name}"`, 'success') }
          catch { addToast('Failed to run', 'error') }
        }}
        onFireAsk={async (qa) => {
          try { await sendDirectIntent(qa.intent, qa.params || {}); addToast(qa.label, 'success') }
          catch (e) { addToast(e.message || 'Failed', 'error') }
        }}
        onEdit={() => setShowShortcutsPicker(true)}
      />

      {/* Discover-shortcuts CTA — shown only when nothing is pinned AND the
          user has at least one routine or quick-ask to choose from. */}
      {pinnedShortcuts.length === 0 && (routines.length > 0 || quickAsks.length > 0) && (
        <button
          onClick={() => setShowShortcutsPicker(true)}
          style={{
            width: '100%', padding: '14px 12px', borderRadius: 14,
            background: 'var(--surface-2)', border: '0.5px dashed var(--line-2)',
            color: 'var(--ink-mute)', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 12.5, fontWeight: 500,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          <Pencil size={12} /> Pin routines & quick asks as shortcuts
        </button>
      )}

      {/* ── 4. Quick controls — user-pinned, up to 4. Falls back to auto-pick ── */}
      {(() => {
        const live = entities.filter(e => !['unavailable','unknown'].includes(e.state))
        const entityMap = Object.fromEntries(entities.map(e => [e.entity_id, e]))

        // User pinned list takes priority (drop ids that no longer exist).
        let picks = quickControlIds.map(id => entityMap[id]).filter(Boolean)

        // Backfill with auto-pick only when the user hasn't customised yet.
        if (quickControlIds.length === 0) {
          const pickKind = (pred) => live.find(e => pred(e) && e.state === 'on') || live.find(pred)
          picks = [
            pickKind(e => e.domain === 'light'),
            pickKind(e => e.domain === 'climate' || (e._ir && e._irDevice?.type === 'ac')),
            pickKind(e => e.domain === 'media_player' || (e._ir && ['tv', 'soundbar', 'projector'].includes(e._irDevice?.type))),
            pickKind(e => e.domain === 'lock'),
          ].filter(Boolean)
        }

        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
              <p className="z-eyebrow">Pinned devices</p>
              <button
                onClick={() => setShowQuickPicker(true)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 11, color: 'var(--ink-faint)', fontFamily: 'inherit',
                  padding: '2px 4px',
                }}
              >
                <Pencil size={11} /> Edit
              </button>
            </div>
            {picks.length === 0 ? (
              <button
                onClick={() => setShowQuickPicker(true)}
                style={{
                  width: '100%', padding: '18px 12px', borderRadius: 14,
                  background: 'var(--surface-2)', border: '0.5px dashed var(--line-2)',
                  color: 'var(--ink-mute)', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 12.5, fontWeight: 500,
                }}
              >
                + Pin up to 4 devices
              </button>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
                {picks.map(entity => (
                  <DeviceCard key={entity.entity_id} entity={entity} variant="tile" dense />
                ))}
              </div>
            )}
          </div>
        )
      })()}

      <QuickControlsPicker open={showQuickPicker} onClose={() => setShowQuickPicker(false)} />

      <ShortcutsPicker
        open={showShortcutsPicker}
        onClose={() => setShowShortcutsPicker(false)}
        routines={routines}
        asks={quickAsks}
        pinnedShortcuts={pinnedShortcuts}
        togglePinnedShortcut={togglePinnedShortcut}
      />

      {/* ── Active alerts (mobile only) ──
          Sits below the user's pinned controls so it doesn't push the rooms
          carousel and shortcuts (the daily-use surfaces) down the page. The
          desktop rail's Alerts card covers the same data — `.hide-lg` keeps
          this copy mobile/tablet-only to avoid duplication. */}
      {anomalies.length > 0 && (
        <div className="hide-lg z-card" style={{ padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
            <p className="z-eyebrow" style={{ margin: 0 }}>Alerts</p>
            <button
              onClick={() => navigate('/alerts')}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 11, color: 'var(--ink-faint)',
                padding: '2px 4px',
              }}
            >
              See all {anomalies.length}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {anomalies.slice(0, 3).map((a, i) => {
              const dotColor = a.severity === 'critical' ? 'var(--err)' : a.severity === 'warning' ? 'var(--warn)' : 'var(--info)'
              return (
                <button
                  key={a.id || `${a.room_id}-${a.rule_id}-${i}`}
                  onClick={() => navigate('/alerts')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 4px', borderRadius: 8,
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    fontFamily: 'inherit', textAlign: 'left', width: '100%',
                  }}
                >
                  <span className="z-dot" style={{ background: dotColor, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 12.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{a.message}</span>
                  <ZIcon name="fwd" size={11} color="var(--ink-faint)" />
                </button>
              )
            })}
          </div>
        </div>
      )}

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

      {/* ── Mobile-only Just-now activity ──
          Original "Just now" lives at the bottom of the main column on
          phones/tablets. On desktop the same content moves to the rail's
          "Recent Activity" card, so we hide this copy via `.hide-lg`.
          (Mobile is intentionally untouched — the rail's Alerts/Suggested
          cards exist on desktop only and are not surfaced here.) */}
      <div className="hide-lg">
      {activity.length > 0 && (
        <div>
          <p className="z-eyebrow" style={{ marginBottom: 8 }}>Just now</p>
          <div className="z-card" style={{ padding: '4px 6px' }}>
            {/* Show exactly 5 rows fully (no peek), then scroll for rows 6–10.
                Row stride = 28 height + 4 gap = 32. 5 rows × 28 + 4 gaps × 4 = 156.
                The container holds up to 10 (activity.slice(0, 10)), so scrolling
                reveals 5 more. */}
            <div
              className="scrollbar-thin"
              style={{
                maxHeight: 156,
                overflowY: 'auto',
                display: 'flex', flexDirection: 'column', gap: 4,
              }}
            >
              {activity.slice(0, 10).map((entry, i) => {
                const { label, timeStr, ok } = formatActivity(entry, entityMap)
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 28, padding: '0 2px', flexShrink: 0 }}>
                    <span className="z-dot" style={{ background: ok ? 'var(--info)' : 'var(--err)', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: 'var(--ink-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                    <span className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)', flexShrink: 0 }}>{timeStr}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
      </div>

      {/* ─── END MAIN COLUMN ─── */}
      </div>

      {/* ─── RIGHT RAIL ─── Alerts · Suggested · Recent Activity.
          Desktop-only (≥1024px). The .only-lg utility hides this entire
          aside on phones/tablets, so Alerts and Suggested NEVER render on
          mobile — that view stays identical to the pre-redesign Dashboard
          (greeting + chips, carousel, shortcuts, pinned, tasks, Just-now). */}
      <aside className="z-dashboard-rail only-lg">

        {/* Alerts card — actual anomaly items from /alerts, NOT the synthetic
            count entries (HA-update info, "1 suggestion ready", overdue tasks).
            Those have their own homes elsewhere; the rail Alerts card should
            be a quick scan of "what's actually wrong right now", matching
            the mobile copy and the design mockup ("Front door unlocked 14m"
            style, not "1 critical alert"). */}
        {anomalies.length > 0 && (
          <div className="z-card" style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
              <p className="z-eyebrow" style={{ margin: 0 }}>Alerts</p>
              <span className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>· {anomalies.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {anomalies.slice(0, 5).map((a, i) => {
                const dotColor = a.severity === 'critical' ? 'var(--err)' : a.severity === 'warning' ? 'var(--warn)' : 'var(--info)'
                return (
                  <button
                    key={a.id || `${a.room_id}-${a.rule_id}-${i}`}
                    onClick={() => navigate('/alerts')}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 6px', borderRadius: 8,
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      fontFamily: 'inherit', textAlign: 'left', width: '100%',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <span className="z-dot" style={{ background: dotColor, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 12.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.message}</span>
                    <ZIcon name="fwd" size={11} color="var(--ink-faint)" />
                  </button>
                )
              })}
              {anomalies.length > 5 && (
                <button
                  onClick={() => navigate('/alerts')}
                  style={{
                    fontFamily: 'inherit', fontSize: 11, color: 'var(--ink-faint)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: '6px', textAlign: 'left',
                  }}
                >
                  See all {anomalies.length} →
                </button>
              )}
            </div>
          </div>
        )}

        {/* Suggested card — surfaces ONE pending suggestion with inline
            Save / Not now actions, matching the design mockup. Full list at
            /suggestions; the "{N} suggestions ready" alert chip already links
            there if the user wants to see them all. */}
        {topSuggestion && (
          <div
            className="z-card"
            style={{
              padding: '14px 16px',
              background: 'color-mix(in srgb, var(--accent) 6%, var(--surface))',
              borderColor: 'color-mix(in srgb, var(--accent) 22%, var(--line))',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <Sparkles size={11} style={{ color: 'var(--accent)' }} />
              <p className="z-eyebrow" style={{ margin: 0, color: 'var(--accent-3)' }}>Suggested</p>
            </div>
            <p style={{
              fontSize: 13, lineHeight: 1.45, color: 'var(--ink)',
              margin: '0 0 12px',
              display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 4,
              overflow: 'hidden',
            }}>
              {topSuggestion.user_message}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={async () => {
                  try { await acceptSuggestionAction(topSuggestion.id); addToast('Suggestion saved', 'success') }
                  catch (e) { addToast(e.message || 'Failed', 'error') }
                }}
                className="z-btn-primary"
                style={{ padding: '7px 14px', fontSize: 12 }}
              >
                Save
              </button>
              <button
                onClick={async () => {
                  try { await rejectSuggestionAction(topSuggestion.id) }
                  catch (e) { addToast(e.message || 'Failed', 'error') }
                }}
                className="z-btn-secondary"
                style={{ padding: '7px 14px', fontSize: 12 }}
              >
                Not now
              </button>
            </div>
          </div>
        )}

        {/* Recent Activity — was "Just now" at the bottom of the main column.
            On desktop it makes more sense in the rail (always visible while
            scrolling). On mobile it stacks below main, same as before just
            without the "Just now" eyebrow change. */}
        {activity.length > 0 && (
          <div className="z-card" style={{ padding: '14px 16px' }}>
            <p className="z-eyebrow" style={{ margin: '0 0 10px' }}>Recent Activity</p>
            {/* Row stride pinned to 28px so the scroll math is deterministic.
                10 rows × 28 + 9 gaps × 4 = 316. Cap below that for a scroll
                affordance; on desktop the sticky-rail max-height also applies. */}
            <div
              className="scrollbar-thin"
              style={{
                maxHeight: 280,
                overflowY: 'auto',
                display: 'flex', flexDirection: 'column', gap: 4,
              }}
            >
              {activity.slice(0, 10).map((entry, i) => {
                const { label, timeStr, ok } = formatActivity(entry, entityMap)
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 28, padding: '0 2px', flexShrink: 0 }}>
                    <span className="z-dot" style={{ background: ok ? 'var(--info)' : 'var(--err)', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: 'var(--ink-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                    <span className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)', flexShrink: 0 }}>{timeStr}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

      </aside>

      </div>  {/* close .z-dashboard-grid */}
    </div>
  )
}
