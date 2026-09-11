import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDeviceStore, applyRoomsOrder } from '../stores/deviceStore'
import { useTaskStore } from '../stores/taskStore'
import { useAutomationStore } from '../stores/automationStore'
import { useSuggestionStore } from '../stores/suggestionStore'
import { useQuickAskStore } from '../stores/quickAskStore'
import { useUIStore } from '../stores/uiStore'
import { useFeature } from '../stores/featuresStore'
import { useWsMessages } from '../hooks/useWebSocket'
import { greetingByTime, humanizeSlug, entityDisplayName } from '../lib/utils'
import { getActivity, getActiveAnomalies, getHealth, getPresencePersons, sendDirectIntent } from '../lib/api'
import { getRoomPhoto } from '../lib/roomPhotos'
import { findRoomMetric, roomOccupancy, deviceFacts, sendDeviceCommand } from '../lib/devices'
import { DeviceIcon } from '../lib/deviceIcons'
import { QuickControlsPicker } from '../components/QuickControlsPicker'
import { SystemHealthBanner } from '../components/ui/SystemHealthBanner'
import { Modal } from '../components/ui/Modal'
import { Pencil, Play, Sparkles, Check, ChevronRight, ChevronDown, Home, User, Zap } from 'lucide-react'
import { useT, t as tt, useLang, getLang, translateNamePhrase } from '../lib/i18n'

// ── Room summary builder ──────────────────────────────────────────────────────
const INACTIVE_STATES = new Set(['off', 'unavailable', 'unknown', 'closed', 'locked', 'disarmed'])

function buildRoomSummary(room, entityMap, occupancySensors) {
  const devices    = room.devices || []
  const ent        = d => entityMap[d.entity_id]
  const lights     = devices.filter(d => d.domain === 'light' && d.ha_state === 'on')
  const media      = devices.filter(d => d.domain === 'media_player' && d.ha_state && !INACTIVE_STATES.has(d.ha_state))
  const climate    = devices.filter(d => d.domain === 'climate' && d.ha_state && !INACTIVE_STATES.has(d.ha_state))
  const fans       = devices.filter(d => d.domain === 'fan' && d.ha_state === 'on')
  const switches   = devices.filter(d => ['switch', 'input_boolean'].includes(d.domain) && d.ha_state === 'on')
  const vacuums    = devices.filter(d => d.domain === 'vacuum' && d.ha_state === 'cleaning')
  // Motion detection: the binary_sensor may now be the PRIMARY of a grouped
  // device (its illuminance sibling no longer appears as a separate row), so
  // check both the direct entity and the entity behind any primary entry.
  const hasMotion  = devices.some(d => {
    const e = ent(d)
    return e?.domain === 'binary_sensor'
      && ['motion', 'occupancy', 'presence'].includes(e.device_class)
      && e.state === 'on'
  })
  // findRoomMetric also walks each device's _group.metrics so a multi-sensor
  // node (Roni Room Sensor: temp + humidity + battery) keeps surfacing
  // humidity as a Dashboard chip even though grouping absorbed humidity into
  // the temperature primary's siblings.
  const tempSensor = findRoomMetric(devices, 'temperature', entityMap)
  const humSensor  = findRoomMetric(devices, 'humidity',    entityMap)
  const offlineCount = devices.filter(d => d.ha_state === 'unavailable' || d.ha_state === 'unknown').length
  const activeCount  = lights.length + media.length + climate.length + fans.length + switches.length + vacuums.length

  const parts = []
  if (lights.length === 1) parts.push(tt('dashboard.lightOn', { name: lights[0].display_name || tt('dashboard.light') }))
  else if (lights.length > 1) parts.push(tt('dashboard.lightsOnN', { n: lights.length }))
  for (const m of media.slice(0, 1)) {
    const name = m.display_name || tt('dashboard.media')
    parts.push(m.ha_state === 'playing' ? tt('dashboard.mediaPlaying', { name }) : tt('dashboard.mediaOn', { name }))
  }
  for (const c of climate) { const tmp = c.ha_attributes?.temperature; parts.push(tmp ? `${c.ha_state} · ${tmp}°` : c.ha_state) }
  if (fans.length) parts.push(tt('dashboard.fanOn'))
  if (vacuums.length) parts.push(tt('dashboard.vacuum'))
  if (switches.length === 1) parts.push(tt('dashboard.switchOn', { name: switches[0].display_name || tt('dashboard.switchLabel') }))
  else if (switches.length > 1) parts.push(tt('dashboard.switchesOnN', { n: switches.length }))

  const occupied = roomOccupancy(room, entityMap, occupancySensors)
  return { id: room.id, name: room.name, activeCount, offlineCount, parts, tempSensor, humSensor, hasMotion, occupied }
}

// ── Activity formatter ────────────────────────────────────────────────────────
// Maps intent ids to i18n keys. Looked up dynamically through `tt()` so the
// activity log re-localizes when the user flips language without needing a
// re-render of this constant.
const INTENT_KEYS = {
  toggle_device:        'activity.device',
  control_device:       'activity.device',
  control_tv:           'activity.tv',
  ir_send_command:      'activity.ir',
  create_automation:    'activity.createAutomation',
  create_task:          'activity.createTask',
  unrecognized_command: 'activity.unrecognizedCommand',
  get_temperature:      'activity.checkedTemperature',
  get_humidity:         'activity.checkedHumidity',
  get_sensor:           'activity.checkedSensor',
  get_room_summary:     'activity.roomSummary',
  list_devices:         'activity.listedDevices',
  list_active_devices:  'activity.listedActiveDevices',
  get_device_state:     'activity.checkedDeviceState',
  is_someone_home:      'activity.checkedPresence',
  get_presence:         'activity.checkedPresence',
}
const intentLabel = (intent) => INTENT_KEYS[intent] ? tt(INTENT_KEYS[intent]) : null
function prettifyIntent(intent) {
  const words = intent.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
function formatActivity(entry, entityMap) {
  const ts   = new Date(entry.ts)
  const diff = Math.floor((Date.now() - ts) / 60000)
  const timeStr = diff < 1 ? tt('common.now') : diff < 60 ? `${diff}m` : diff < 1440 ? `${Math.floor(diff / 60)}h` : ts.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const { intent, action, room, entity_id } = entry
  const ent = entity_id ? entityMap?.[entity_id] : null
  const entName = ent ? entityDisplayName(ent) : (entity_id ? humanizeSlug(entity_id) : null)
  const head = intentLabel(intent)

  let label
  if (intent === 'create_automation' || intent === 'create_task') {
    label = head
  } else if (intent === 'toggle_device' || intent === 'control_device') {
    const h = entName || head
    label = action ? `${h} · ${action}${room ? ` · ${room}` : ''}` : h
  } else if (intent === 'control_tv' || intent === 'ir_send_command') {
    label = `${head} ${action}${room ? ` · ${room}` : ''}`
  } else if (head) {
    label = room ? `${head} · ${room}` : head
  } else {
    label = prettifyIntent(intent) + (action && action !== intent ? ` · ${action}` : '')
  }
  // A failure only earns the red dot while it is still actionable — a
  // non-ok result older than a day is history, not an alert, and reads
  // with the neutral dot like everything else.
  const failed = entry.result !== 'ok' && diff < 1440
  return { label, timeStr, ok: !failed }
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

// ── List rows shared by the phone cards and the desktop rail ─────────────────
// One alert: severity dot · message · forward chevron. 44px so it is a real
// target; the whole row opens /alerts.
function AlertRow({ anomaly, onOpen, hover = false }) {
  const dotColor = anomaly.severity === 'critical' ? 'var(--err)'
                 : anomaly.severity === 'warning'  ? 'var(--warn)'
                 : 'var(--info)'
  return (
    <button
      onClick={onOpen}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        minHeight: 40, padding: '8px 8px', borderRadius: 'var(--r-ctl)',
        background: 'transparent', border: 'none', cursor: 'pointer',
        fontFamily: 'inherit', textAlign: 'start', width: '100%',
        transition: 'background var(--dur-press) var(--ease-standard)',
      }}
      onMouseEnter={hover ? (e => { e.currentTarget.style.background = 'var(--surface-2)' }) : undefined}
      onMouseLeave={hover ? (e => { e.currentTarget.style.background = 'transparent' }) : undefined}
    >
      <span className="z-dot" style={{ background: dotColor, flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{anomaly.message}</span>
      <ZIcon name="fwd" size={16} color="var(--ink-faint)" />
    </button>
  )
}

// One activity entry: outcome dot · label · relative time. The dot is the
// info colour for anything that went fine (or is old enough not to matter)
// and err only for a recent failure — see formatActivity.
function ActivityRow({ label, timeStr, ok }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 40, padding: '0 4px', flexShrink: 0 }}>
      <span className="z-dot" style={{ background: ok ? 'var(--info)' : 'var(--err)', flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: 'var(--ink-2)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--ink-mute)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{timeStr}</span>
    </div>
  )
}

// ── Quick-control tile — the unified Pinned-devices vocabulary ───────────────
// Matches the redesign's ControlTile (ziggy-atoms.jsx): icon-square top-left,
// toggle pill top-right, label + sub on the bottom. Whole tile inverts to
// var(--ink)/var(--bg) when on; icon-box + pill take the kind's tint color.
// Used in every viewport — phone is 2-col, tablet+ is 4-col, both via the
// .z-quick-controls-grid responsive utility (see index.css).
function QuickControlTile({ entity }) {
  const navigate = useNavigate()
  const addToast = useUIStore(s => s.addToast)
  const [pending, setPending] = useState(false)

  if (!entity) return null
  const facts = deviceFacts(entity)
  const isToggleable = facts.meta.toggle && facts.isAvailable
  const on   = facts.isOn
  const tint = facts.tint

  const open = () => navigate(`/devices/${encodeURIComponent(facts.id)}`)
  const toggle = async () => {
    if (pending || !isToggleable) return
    setPending(true)
    try { await sendDeviceCommand(entity, 'toggle') }
    catch (e) { addToast(e?.message || tt('common.failed'), 'error') }
    finally { setPending(false) }
  }

  // On-state colors — the redesign inverts the tile entirely when on so the
  // pinned grid reads as a status display, not a control panel. Icon-box uses
  // accent regardless of kind tint so the visual hierarchy stays consistent
  // across the 4 tiles. Arrow-pill color picks up the kind tint for personality.
  const tileBg     = on ? 'var(--ink)'    : 'var(--surface)'
  const tileFg     = on ? 'var(--bg)'     : 'var(--ink)'
  const iconBg     = on ? 'color-mix(in srgb, var(--accent) 30%, transparent)' : 'var(--surface-2)'
  const iconColor  = on ? tint            : 'var(--ink-2)'
  // Arrow background: translucent over the dark on-state ink, surface-2 on
  // the off-state light surface. Matches TileCard's arrow vocabulary in
  // the room view so both surfaces feel like the same control.
  const arrowBg    = on ? 'color-mix(in srgb, var(--bg) 14%, transparent)' : 'var(--surface-2)'
  const arrowColor = on ? 'var(--bg)' : 'var(--ink-mute)'
  const subColor   = on ? 'color-mix(in srgb, var(--bg) 70%, transparent)' : 'var(--ink-mute)'

  const sub = (() => {
    if (!facts.isAvailable) return tt('common.offline')
    if (facts.brightness != null && on) return `${facts.stateLabel} · ${facts.brightness}%`
    return facts.stateLabel
  })()

  // Tile click toggles when the device can be toggled; otherwise it falls
  // through to navigation. Matches the TileCard pattern in the room view
  // (lights tap to toggle, arrow chevron opens the detail page). Earlier
  // the home pinned grid did the inverse — tile click navigated, a toggle
  // pill flipped state — which made the two surfaces feel like two
  // different products. `data-tile-stop` lets the arrow swallow its own
  // click without re-firing the tile handler.
  const handleClick = (e) => {
    if (e.target?.closest('[data-tile-stop]')) return
    if (isToggleable) toggle()
    else open()
  }

  return (
    <button
      onClick={handleClick}
      style={{
        position: 'relative',
        padding: 12, borderRadius: 'var(--r-card)', minHeight: 96,
        background: tileBg, color: tileFg,
        border: '0.5px solid var(--line)',
        display: 'flex', flexDirection: 'column', gap: 12,
        textAlign: 'start', fontFamily: 'inherit', cursor: 'pointer',
        transition: 'background var(--dur-state) var(--ease-standard), color var(--dur-state) var(--ease-standard)',
        opacity: pending ? 0.7 : 1,
      }}
    >
      <span style={{
        width: 32, height: 32, borderRadius: 'var(--r-ctl)', flexShrink: 0,
        background: iconBg, color: iconColor,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        lineHeight: 1,
      }} aria-hidden="true">
        <DeviceIcon kind={facts.kind} size={18} fill />
      </span>

      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, lineHeight: 1.2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {facts.name}
        </div>
        <div style={{
          fontSize: 13, marginTop: 4, color: subColor,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {sub}
        </div>
      </div>

      {/* Arrow to device detail — same affordance as TileCard's arrow in
          the room view. `data-tile-stop` keeps the parent's onClick from
          firing (we don't want a tap on the arrow to also toggle). */}
      <span
        data-tile-stop
        onClick={(e) => { e.stopPropagation(); open() }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); open() } }}
        role="button"
        tabIndex={0}
        aria-label={tt('dashboard.openDetails')}
        style={{
          position: 'absolute', top: 8, insetInlineEnd: 8,
          width: 32, height: 32, borderRadius: 'var(--r-ctl)',
          background: arrowBg, color: arrowColor,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        <ChevronRight size={14} className="icon-flip-rtl" />
      </span>
    </button>
  )
}

// ── Room tile face — shared by the phone carousel and the desktop grid ────────
// Two looks, one vocabulary. With a photo: the picture, a bottom scrim, white
// name + status. Without one (getRoomPhoto → null): a flat `.z-room-plain`
// surface with a line glyph top-left and the name in ink — no stock photo.
// Both carry the same 8px activity dot and the same 13px sensor chips.
function RoomTileFace({ room, summary, photo, showParts }) {
  const t = useT()
  const lang = useLang()
  const isActiveRoom = summary.activeCount > 0 || summary.hasMotion
  const statusLine = (
    <>
      {summary.activeCount > 0
        ? t('dashboard.activeShort', { n: summary.activeCount })
        : summary.hasMotion
          ? t('dashboard.motion')
          : t('dashboard.idle')}
      {showParts && summary.parts.length > 0 && ` · ${summary.parts[0]}`}
    </>
  )
  // Chip fills sit on a photo (dark wash) or on the plain surface (surface-2).
  // Temperature is tinted by the same indoor-comfort thresholds as the Rooms
  // page (<18°C cool, 18–25°C neutral, >25°C warm); the unit is sniffed from
  // HA's unit_of_measurement so °F sensors get the same thresholds.
  const chipNeutralBg = photo ? 'rgba(0,0,0,0.32)' : 'var(--surface)'
  const chipFg        = photo ? '#fff' : 'var(--ink)'
  const chipBase = {
    fontSize: 12, lineHeight: '16px', color: chipFg, fontVariantNumeric: 'tabular-nums',
    padding: '4px 8px', borderRadius: 999, backdropFilter: 'blur(8px)',
    border: photo ? 'none' : '0.5px solid var(--line)',
    display: 'inline-flex', alignItems: 'center', gap: 4,
  }
  const chips = (summary.tempSensor || summary.humSensor || summary.occupied) && (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', minWidth: 0 }}>
      {summary.occupied && (
        <span title={t('rooms.occupied')} aria-label={t('rooms.occupied')} style={{ ...chipBase, background: 'color-mix(in srgb, var(--ok) 55%, transparent)', color: photo ? '#fff' : 'var(--ink)' }}>
          <User size={14} strokeWidth={2} aria-hidden="true" />
        </span>
      )}
      {summary.tempSensor && (() => {
        const raw = parseFloat(summary.tempSensor.state)
        const unit = summary.tempSensor.unit_of_measurement
                  || summary.tempSensor.attributes?.unit_of_measurement
                  || '°C'
        const tempC = unit.includes('F') ? (raw - 32) * 5 / 9 : raw
        const bg = tempC < 18 ? 'color-mix(in srgb, var(--info) 55%, transparent)'
                 : tempC > 25 ? 'color-mix(in srgb, var(--err) 55%, transparent)'
                 : chipNeutralBg
        return <span style={{ ...chipBase, background: bg }}>{raw.toFixed(1)}°</span>
      })()}
      {summary.humSensor && (
        <span style={{ ...chipBase, background: chipNeutralBg }}>
          {parseFloat(summary.humSensor.state).toFixed(0)}%
        </span>
      )}
    </div>
  )
  // Activity dot — same criteria as the greeting's "N rooms active" count so
  // the two never disagree (a room with motion but no on-devices is active).
  const dot = (
    <span style={{
      flexShrink: 0,
      width: 8, height: 8, borderRadius: '50%',
      background: isActiveRoom ? 'var(--ok)' : (photo ? 'rgba(255,255,255,0.3)' : 'var(--line-2)'),
      boxShadow: isActiveRoom ? '0 0 0 3px color-mix(in srgb, var(--ok) 30%, transparent)' : 'none',
    }} />
  )
  // One top row carries the room mark, the sensor chips and the activity dot,
  // so nothing can land in the same corner as anything else. On a photo the
  // room mark is the photo itself, so that slot stays empty.
  const topRow = (mark) => (
    <div style={{
      position: 'absolute', top: 12, insetInline: 12,
      display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
    }}>
      {mark}
      {chips}
      <span style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center' }}>{dot}</span>
    </div>
  )
  const name = translateNamePhrase(room.name, lang)

  if (!photo) {
    return (
      <>
        {topRow(<Home size={28} strokeWidth={1.75} aria-hidden="true" style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />)}
        <div style={{ position: 'absolute', bottom: 16, insetInline: 16 }}>
          <p dir="auto" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{statusLine}</p>
        </div>
      </>
    )
  }
  return (
    <>
      <img src={photo} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.72) 100%)' }} />
      {topRow(null)}
      <div style={{ position: 'absolute', bottom: 16, insetInline: 16 }}>
        <p dir="auto" style={{ fontSize: 15, fontWeight: 600, color: '#fff', margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', margin: 0, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{statusLine}</p>
      </div>
    </>
  )
}

// ── Rooms carousel — production-grade centered snap ───────────────────────────
// One dominant card fills ~78% of the viewport. Neighbouring tiles peek each
// side at full scale and opacity — the snap position alone says which tile
// is current. All tiles are the same DOM width → snap points never shift.
const C_W   = 300   // tile DOM width (px) — set once, never changes
const C_H   = 208   // tile DOM height
const C_GAP = 16    // gap between tiles
const C_PAD = 20    // horizontal padding inside scroll container

function RoomsCarousel({ sortedRooms, ziggyRooms }) {
  const t = useT()
  const navigate  = useNavigate()
  const scrollRef = useRef(null)
  const tileRefs  = useRef([])
  const [activeIdx, setActiveIdx] = useState(0)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // rAF-throttle so the active-tile recompute fires at most once per frame
    // instead of on every scroll event (was firing 60+ times per second on
    // momentum-scroll, doing a full DOM-rect read per tile each call).
    let raf = 0
    const compute = () => {
      raf = 0
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
    const handle = () => {
      if (raf) return
      raf = requestAnimationFrame(compute)
    }
    el.addEventListener('scroll', handle, { passive: true })
    return () => {
      el.removeEventListener('scroll', handle)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [sortedRooms.length])

  if (!sortedRooms.length) return null

  // Vertical breathing room above/below the row
  const vPad = 16

  return (
    <div>
      <p className="z-eyebrow" style={{ marginBottom: 12 }}>{t('dashboard.rooms')}</p>
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
                className={photo ? undefined : 'z-room-plain'}
                style={{
                  position: 'relative', flexShrink: 0,
                  width: C_W, height: C_H,
                  borderRadius: 'var(--r-card)', overflow: 'hidden', cursor: 'pointer',
                  scrollSnapAlign: 'center',
                  // `always` forces the browser to stop at the next snap
                  // point regardless of swipe velocity — one swipe = one
                  // tile, instead of letting a hard flick on the S24's
                  // aggressive touch-inertia fly past 2-3 tiles. Default
                  // value `normal` looked fine in mobile sims (mouse-based
                  // touch emulation has no real momentum) but felt out of
                  // control on a real Samsung WebView.
                  scrollSnapStop: 'always',
                }}
              >
                {/* The centred tile additionally spells out its first
                    active part ("Ceiling on"); neighbours keep the short
                    status so the peeking edge stays a calm label. */}
                <RoomTileFace room={room} summary={summary} photo={photo} showParts={isActive} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Rooms grid — desktop-only variant of RoomsCarousel ───────────────────────
// Same per-tile vocabulary (photo + gradient + status dot + sensor chips +
// name + status line), arranged as a 2-col grid instead of a horizontal
// snap-scroll carousel. Used on web (>=1024px) where the carousel feels like
// a mobile pattern shoehorned into a desktop layout — the grid lets all
// rooms be seen and tapped at once.
// Resolve N rooms into a (cols, rows) layout that fills a roughly 16:11 main
// column area on desktop without leaving awkward gaps. Single column for one
// room (it gets the whole frame), wide-and-short for 2–3, square-ish for 4–9,
// gradually more columns past that so tiles stay readable.
function roomsGridShape(n) {
  if (n <= 1)  return { cols: 1, rows: 1 }
  if (n === 2) return { cols: 2, rows: 1 }
  if (n === 3) return { cols: 3, rows: 1 }
  if (n === 4) return { cols: 2, rows: 2 }
  if (n <= 6)  return { cols: 3, rows: 2 }
  if (n <= 8)  return { cols: 4, rows: 2 }
  if (n <= 9)  return { cols: 3, rows: 3 }
  if (n <= 12) return { cols: 4, rows: 3 }
  if (n <= 16) return { cols: 4, rows: 4 }
  const cols = 5
  return { cols, rows: Math.ceil(n / cols) }
}

function RoomsGrid({ sortedRooms, ziggyRooms }) {
  const t = useT()
  const navigate = useNavigate()
  if (!sortedRooms.length) return null
  const { cols, rows } = roomsGridShape(sortedRooms.length)
  // Cap visible tiles to the grid cell count so the layout never overflows.
  // In practice the cap only matters past 20 rooms; the shape function above
  // grows enough to display every room up to 16, and 5×N beyond.
  const visibleRooms = sortedRooms.slice(0, cols * rows)
  return (
    <div>
      <p className="z-eyebrow" style={{ marginBottom: 12 }}>{t('dashboard.rooms')}</p>
      {/* Fixed 200px rows — the page flows; the old viewport-clamp that
          stretched tiles to fill the window is gone. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridAutoRows: 200,
        gap: 12,
      }}>
        {visibleRooms.map(summary => {
          const room = ziggyRooms.find(r => r.id === summary.id)
          if (!room) return null
          const photo = getRoomPhoto(room)
          return (
            <div
              key={room.id}
              onClick={() => navigate(`/rooms/${room.id}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/rooms/${room.id}`) }}
              className={photo ? undefined : 'z-room-plain'}
              style={{
                position: 'relative',
                width: '100%', height: '100%',
                borderRadius: 'var(--r-card)', overflow: 'hidden', cursor: 'pointer',
                border: '0.5px solid var(--line)',
                // No translateY on hover — a soft shadow lift + border shift
                // is the same affordance without clipping on the first row.
                transition: 'box-shadow var(--dur-press) var(--ease-standard), border-color var(--dur-press) var(--ease-standard)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = 'var(--shadow-md)'
                e.currentTarget.style.borderColor = 'var(--line-2)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = 'none'
                e.currentTarget.style.borderColor = 'var(--line)'
              }}
            >
              <RoomTileFace room={room} summary={summary} photo={photo} showParts />
            </div>
          )
        })}
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
  const t = useT()
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <p className="z-eyebrow" style={{ margin: 0 }}>{t('dashboard.shortcuts')}</p>
        <button onClick={onEdit} style={sectionEditBtn}>
          <Pencil size={16} strokeWidth={1.75} /> {t('dashboard.shortcutsEdit')}
        </button>
      </div>
      {/* Horizontal pill carousel — matches the redesign's Quick Routines
          vocabulary. Pill inverts (ink/bg) while a shortcut is firing so the
          user sees the tap landed. Same surface on every viewport; on tablet
          and desktop the pills wrap to a second row instead of horizontal
          scroll so the user can see all of them at once. */}
      <div
        className="no-scrollbar"
        style={{
          display: 'flex', gap: 8,
          overflowX: 'auto',
          flexWrap: 'wrap',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {resolved.map(s => (
          <ShortcutPill
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

// Section-header edit link: a 44px-tall text button so the tap target is
// real, with the glyph and label in ink-mute (it is not the screen's action).
const sectionEditBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 40,
  background: 'none', border: 'none', cursor: 'pointer',
  fontSize: 13, color: 'var(--ink-mute)', fontFamily: 'inherit', padding: '0 4px',
}

// Shortcut glyph: the person's own emoji when they chose one (it is their
// icon, not ours), otherwise a line glyph by kind — a bolt for a routine,
// sparkles for a saved ask.
function ShortcutGlyph({ type, icon, size = 18 }) {
  // The person's own icon wins. The fallback is the original character pair
  // rather than a Lucide glyph, so a pinned shortcut looks the same as it
  // always did whether or not it carries an icon.
  const glyph = icon || (type === 'routine' ? '⚡' : '✦')
  return <span style={{ fontSize: size, lineHeight: 1 }} aria-hidden="true">{glyph}</span>
}

// Horizontal pill — used in the Shortcuts row. Stateless surface, so
// "active" only means "currently firing": the pill inverts (ink/bg) for the
// press so the person sees the tap landed.
function ShortcutPill({ type, record, onFire }) {
  const lang = useLang()
  const [pending, setPending] = useState(false)
  const rawLabel = type === 'routine' ? record.name : record.label
  const label = translateNamePhrase(rawLabel, lang)

  const handle = async () => {
    if (pending) return
    setPending(true)
    try { await onFire() } finally { setTimeout(() => setPending(false), 600) }
  }

  return (
    <button
      onClick={handle}
      aria-label={label}
      style={{
        flexShrink: 0,
        padding: '12px 16px', minHeight: 40, borderRadius: 'var(--r-card)',
        background: pending ? 'var(--ink)' : 'var(--surface)',
        color:      pending ? 'var(--bg)'  : 'var(--ink)',
        border: '0.5px solid var(--line)',
        display: 'inline-flex', alignItems: 'center', gap: 8,
        fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
        cursor: 'pointer',
        transition: 'background var(--dur-state) var(--ease-standard), color var(--dur-state) var(--ease-standard)',
      }}
    >
      <span style={{ display: 'inline-flex', color: pending ? 'var(--bg)' : 'var(--ink-mute)' }}>
        <ShortcutGlyph type={type} icon={record.icon} />
      </span>
      <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </button>
  )
}

function ShortcutsPicker({ open, onClose, routines, asks, pinnedShortcuts, togglePinnedShortcut }) {
  const t = useT()
  const SHORTCUTS_MAX = 8
  const pinnedSet = new Set(pinnedShortcuts.map(s => `${s.type}:${s.id}`))
  const isFull    = pinnedShortcuts.length >= SHORTCUTS_MAX

  const renderRow = (type, record) => {
    const key      = `${type}:${record.id}`
    const isPinned = pinnedSet.has(key)
    const disabled = isFull && !isPinned
    const label    = type === 'routine' ? record.name : record.label
    return (
      <button
        key={key}
        onClick={() => togglePinnedShortcut(type, record.id)}
        disabled={disabled}
        aria-pressed={isPinned}
        style={{
          display: 'flex', alignItems: 'center', gap: 12, width: '100%',
          padding: '12px 16px', minHeight: 48, borderRadius: 'var(--r-ctl)', cursor: disabled ? 'not-allowed' : 'pointer',
          background: isPinned ? 'color-mix(in srgb, var(--ok) 8%, var(--surface))' : 'var(--surface)',
          border: '0.5px solid ' + (isPinned ? 'color-mix(in srgb, var(--ok) 30%, var(--line))' : 'var(--line)'),
          opacity: disabled ? 0.4 : 1, fontFamily: 'inherit', textAlign: 'start',
        }}
      >
        <span style={{ display: 'inline-flex', justifyContent: 'center', width: 24, color: 'var(--ink-mute)', flexShrink: 0 }}>
          <ShortcutGlyph type={type} icon={record.icon} />
        </span>
        <span style={{ flex: 1, fontSize: 15, fontWeight: 500, color: 'var(--ink)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        {isPinned && <Check size={20} strokeWidth={2} style={{ color: 'var(--ok)', flexShrink: 0 }} aria-hidden="true" />}
      </button>
    )
  }

  const sectionHead = (Icon, label, count) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <Icon size={16} strokeWidth={1.75} style={{ color: 'var(--ink-mute)' }} aria-hidden="true" />
      <p className="z-eyebrow" style={{ margin: 0 }}>{label}</p>
      <span style={{ fontSize: 12, color: 'var(--ink-mute)', fontVariantNumeric: 'tabular-nums' }}>{count}</span>
    </div>
  )

  return (
    <Modal open={open} onClose={onClose} title={t('dashboard.editShortcutsTitle')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: 0 }}>
          {t('dashboard.pinnedSlash', { n: pinnedShortcuts.length, max: SHORTCUTS_MAX })}
        </p>

        {/* Routines */}
        <div>
          {sectionHead(Play, t('dashboard.routines'), routines.length)}
          {routines.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--ink-mute)', padding: '8px 4px', margin: 0 }}>{t('dashboard.routinesEmpty')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {routines.map(r => renderRow('routine', r))}
            </div>
          )}
        </div>

        {/* Quick Asks */}
        <div>
          {sectionHead(Sparkles, t('dashboard.quickAsks'), asks.length)}
          {asks.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--ink-mute)', padding: '8px 4px', margin: 0 }}>{t('dashboard.asksEmpty')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {asks.map(a => renderRow('ask', a))}
            </div>
          )}
        </div>

        <button onClick={onClose} className="z-btn-primary" style={{ width: '100%' }}>
          {t('dashboard.done')}
        </button>
      </div>
    </Modal>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const t = useT()
  const navigate = useNavigate()
  // Per-field selectors keep this component out of the "re-render when
  // anything in deviceStore changes" club. The destructure form previously
  // triggered a Dashboard render on every entity tick the store received,
  // even when none of the entities the Dashboard cares about changed.
  const entities                = useDeviceStore(s => s.entities)
  const ziggyRooms              = useDeviceStore(s => s.ziggyRooms)
  const occupancySensors        = useDeviceStore(s => s.occupancySensors)
  const roomsOrder              = useDeviceStore(s => s.roomsOrder)
  const quickControlIds         = useDeviceStore(s => s.quickControlIds)
  const pinnedShortcuts         = useDeviceStore(s => s.pinnedShortcuts)
  const fetchAll                = useDeviceStore(s => s.fetchAll)
  const togglePinnedShortcut    = useDeviceStore(s => s.togglePinnedShortcut)
  const [showQuickPicker,     setShowQuickPicker]     = useState(false)
  const [showShortcutsPicker, setShowShortcutsPicker] = useState(false)
  // Mobile-only Recent Activity card — collapsed by default so the home
  // screen lands on shortcuts + pinned devices, not a scrolling log of
  // background events. Desktop still shows the same data in the rail's
  // always-open card.
  const [recentOpen,          setRecentOpen]          = useState(false)
  const { tasks, fetch: fetchTasks }                  = useTaskStore()
  const { fetchAutomations, fetchRoutines, routines, runRoutine } = useAutomationStore()
  const { fetch: fetchSuggestions, pendingCount, pending: pendingSuggestions, accept: acceptSuggestionAction, reject: rejectSuggestionAction } = useSuggestionStore()
  const { items: quickAsks, fetch: fetchQuickAsks }   = useQuickAskStore()
  const { addToast }                                  = useUIStore()
  const taskTrackingEnabled                           = useFeature('task_tracking')

  const [activity,          setActivity]          = useState([])
  const [anomalies,         setAnomalies]         = useState([])
  const [health,            setHealth]            = useState(null)
  const [presencePersons,   setPresencePersons]   = useState([])

  const loadAnomalies = useCallback(() => {
    getActiveAnomalies()
      .then(r => setAnomalies(Object.values(r.anomalies ?? {}).flat()))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchAll({ maxAge: 120_000 })
    if (taskTrackingEnabled) fetchTasks()
    fetchAutomations({ maxAge: 60_000 })
    fetchRoutines({ maxAge: 60_000 })
    fetchSuggestions()
    fetchQuickAsks()
    getActivity(15).then(r => setActivity(r.activity ?? [])).catch(() => {})
    loadAnomalies()
    getHealth().then(setHealth).catch(() => {})
    getPresencePersons().then(r => setPresencePersons(r.persons ?? [])).catch(() => {})
  }, [])

  // Re-poll health on a slow interval. /api/health captures `ha_connected` from
  // services.ha_subscriber, which flips false→true after the WS auth handshake
  // completes. If the Dashboard happened to mount during the few-second window
  // between backend boot and that handshake, the "HA offline" banner gets
  // latched and never clears until full page reload. A 20 s poll auto-clears
  // it once HA comes back without being expensive.
  useEffect(() => {
    // Pause polling while the tab is hidden — PWA in background was still
    // hitting /api/health every 20s and waking the mobile radio for no
    // visible benefit. We refresh once on tab visible to catch up.
    let id
    const start = () => {
      if (id) return
      id = setInterval(() => {
        getHealth().then(setHealth).catch(() => {})
      }, 20_000)
    }
    const stop = () => { if (id) { clearInterval(id); id = null } }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        getHealth().then(setHealth).catch(() => {})
        start()
      } else {
        stop()
      }
    }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [])

  // Presence updates are pushed by the backend on every confirmed transition
  // (see services/presence_side_effects.py). The 30 s polling fallback used
  // to mean the Dashboard could show stale state for up to 30 s and race
  // with the WS update; the WS refresh is sub-second.

  // Live refresh from the WS bus:
  //   - anomaly_active / anomaly_cleared → reload anomalies
  //   - presence_transition → reload presence persons
  // Walk newest-to-oldest until we hit a message we've already processed.
  const messages = useWsMessages()
  const lastSeenWsTs = useRef(0)
  useEffect(() => {
    let refreshAnomalies = false
    let refreshPresence  = false
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (!m || m.ts <= lastSeenWsTs.current) break
      if (m.type === 'anomaly_active' || m.type === 'anomaly_cleared') refreshAnomalies = true
      if (m.type === 'presence_transition') refreshPresence = true
    }
    if (refreshAnomalies) loadAnomalies()
    if (refreshPresence) {
      getPresencePersons().then(r => setPresencePersons(r.persons ?? [])).catch(() => {})
    }
    if (messages.length) lastSeenWsTs.current = messages[messages.length - 1].ts
  }, [messages, loadAnomalies])

  // Memoize derived state so an unrelated entity tick (or any WS broadcast that
  // bumps the messages array) doesn't force rebuilding entityMap / room
  // summaries / the sorted-room list.
  const pendingTasks = useMemo(
    () => tasks.filter(t => !t.done && !t.completed),
    [tasks],
  )
  const overdueTasks = useMemo(
    () => pendingTasks.filter(t => t.due_date && new Date(t.due_date) < new Date()),
    [pendingTasks],
  )
  const entityMap = useMemo(
    () => Object.fromEntries(entities.map(e => [e.entity_id, e])),
    [entities],
  )
  const roomSummaries = useMemo(
    () => ziggyRooms.map(r => buildRoomSummary(r, entityMap, occupancySensors)),
    [ziggyRooms, entityMap, occupancySensors],
  )
  // Apply the user-defined room order first, THEN stably sort by activity.
  // Array.prototype.sort is stable per spec (ES2019+), so within each bucket
  // (active / idle) rooms keep the user-defined order. Result: active rooms
  // float to the front of the carousel as they always have, but the user
  // gets to decide the order of idle rooms (and of multiple active rooms
  // when more than one is active at the same time).
  //
  // Wrapped in try/catch so a malformed roomsOrder (stale IDs after a fetch,
  // server returning unexpected types, etc.) can never crash the Dashboard
  // — worst case the carousel falls back to roomSummaries in natural order.
  const sortedRooms = useMemo(
    () => {
      try {
        const ordered = applyRoomsOrder(roomSummaries, roomsOrder)
        const arr = Array.isArray(ordered) ? ordered.slice() : []
        return arr.sort((a, b) => ((b.activeCount > 0 || b.hasMotion ? 1 : 0) - (a.activeCount > 0 || a.hasMotion ? 1 : 0)))
      } catch (e) {
        console.error('[Dashboard] room sort failed', e)
        return Array.isArray(roomSummaries) ? roomSummaries.slice() : []
      }
    },
    [roomSummaries, roomsOrder],
  )
  const activeRooms = useMemo(
    () => roomSummaries.filter(r => r.activeCount > 0 || r.hasMotion),
    [roomSummaries],
  )

  const criticalAnomalies = useMemo(
    () => anomalies.filter(a => a.severity === 'critical'),
    [anomalies],
  )
  const warningAnomalies = useMemo(
    () => anomalies.filter(a => a.severity === 'warning'),
    [anomalies],
  )

  // Quick-controls pinned tiles. Previously this was an IIFE in render that
  // rebuilt entityMap (already memoized above) + re-filtered live entities on
  // every Dashboard render — including every state_changed WS bump. Pull it
  // into a useMemo so it only recomputes when the underlying data actually
  // changes.
  const quickControlPicks = useMemo(() => {
    if (quickControlIds.length > 0) {
      return quickControlIds.map(id => entityMap[id]).filter(Boolean)
    }
    const live = entities.filter(e => !['unavailable','unknown'].includes(e.state))
    const pickKind = (pred) =>
      live.find(e => pred(e) && e.state === 'on') || live.find(pred)
    return [
      pickKind(e => e.domain === 'light'),
      pickKind(e => e.domain === 'climate' || (e._ir && e._irDevice?.type === 'ac')),
      pickKind(e => e.domain === 'media_player' || (e._ir && ['tv', 'soundbar', 'projector'].includes(e._irDevice?.type))),
      pickKind(e => e.domain === 'lock'),
    ].filter(Boolean)
  }, [entities, entityMap, quickControlIds])
  const haOffline = health !== null && health.ha_connected === false

  const alerts = [
    ...(haOffline ? [{ id: 'ha-offline', sev: 'critical', text: t('dashboard.haOffline'), to: '/settings' }] : []),
    ...(criticalAnomalies.length > 0 ? [{ id: 'anom-crit', sev: 'critical', text: criticalAnomalies.length === 1 ? t('dashboard.criticalAlertsOne', { n: criticalAnomalies.length }) : t('dashboard.criticalAlertsMany', { n: criticalAnomalies.length }), to: '/alerts' }] : []),
    ...(warningAnomalies.length  > 0 ? [{ id: 'anom-warn', sev: 'warn',     text: warningAnomalies.length === 1 ? t('dashboard.anomaliesOne', { n: warningAnomalies.length }) : t('dashboard.anomaliesMany', { n: warningAnomalies.length }), to: '/alerts' }] : []),
    ...(pendingCount() > 0 ? [{ id: 'sug', sev: 'info', text: pendingCount() === 1 ? t('dashboard.suggestionsReadyOne', { n: pendingCount() }) : t('dashboard.suggestionsReadyMany', { n: pendingCount() }), to: '/automations' }] : []),
    ...(taskTrackingEnabled && overdueTasks.length > 0 ? [{ id: 'tasks', sev: 'warn', text: overdueTasks.length === 1 ? t('dashboard.overdueTasksOne', { n: overdueTasks.length }) : t('dashboard.overdueTasksMany', { n: overdueTasks.length }), to: '/tasks' }] : []),
  ]

  // The flat status row below (dot + "N rooms active" + presence) already
  // shows the count. The big H1 above just communicates calm-vs-awake at a
  // glance — duplicating the count here read as repetition on mobile.
  const statusText = activeRooms.length > 0
    ? t('dashboard.homeAwake')
    : t('dashboard.homeCalm')

  const homePersons = presencePersons.filter(p => (p.effective_state ?? p.state) === 'home')

  // Presence string: "Maya & kids home" style
  const homeNames = homePersons.map(p => p.name)
  const presenceStr = homeNames.length === 0
    ? t('dashboard.nobodyHome')
    : homeNames.length === 1
      ? t('dashboard.personHome', { name: homeNames[0] })
      : homeNames.length === 2
        ? t('dashboard.twoPeopleHome', { a: homeNames[0], b: homeNames[1] })
        : t('dashboard.manyPeopleHome', { list: homeNames.slice(0, -1).join(', '), last: homeNames[homeNames.length - 1] })

  // Top pending suggestion for the right-rail "Suggested" card.
  // Picking just the first one matches the design mockup — surface ONE concrete
  // thing the user can act on, link to /suggestions for the full list.
  const topSuggestion = pendingSuggestions()[0]

  return (
    // Wide max-width: accommodates the desktop 2-col grid (main + 320px rail
    // + 24px gap). Single-column on phone/tablet via `.z-dashboard-grid`.
    // The `.z-dashboard-outer` class clamps to the visible viewport on
    // lg+ so the desktop dashboard never needs to scroll — see index.css.
    <div className="z-dashboard-outer">
      <div className="z-dashboard-grid">

      {/* ─── MAIN COLUMN ─── */}
      <div className="z-dashboard-main-col" style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

      {/* ── 1. Greeting ── Matches the redesign greeting block exactly:
              eyebrow → display title → flat status row of [dot · "N rooms
              active" · "Maya & kids home"]. Presence is a borderless button
              styled as plain text so the tap target stays (taps go to
              /settings#presence) without breaking the design's clean
              look. Inline alert chips are gone — the standalone Alerts
              card below surfaces the same data and the desktop right rail
              still owns it on lg+. */}
      <div>
        <p className="z-eyebrow" style={{ margin: '0 0 4px' }}>{greetingByTime()}</p>
        <h1 className="z-display" style={{ margin: '0 0 8px' }}>{statusText}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {activeRooms.length > 0
            ? <span className="z-dot z-dot-on" style={{ flexShrink: 0 }} />
            : <span className="z-dot" style={{ background: 'var(--line-2)', flexShrink: 0 }} />}
          <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>
            {activeRooms.length > 0
              ? (activeRooms.length === 1
                  ? t('dashboard.roomsActiveOne', { n: activeRooms.length })
                  : t('dashboard.roomsActiveMany', { n: activeRooms.length }))
              : t('dashboard.allQuiet')}
          </span>
          {homePersons.length > 0 && (
            <>
              <span style={{ color: 'var(--ink-faint)', fontSize: 13 }} aria-hidden="true">·</span>
              <button
                onClick={() => navigate('/settings#presence')}
                style={{
                  background: 'none', border: 'none', padding: 0, minHeight: 40,
                  fontSize: 13, color: 'var(--ink-mute)',
                  fontFamily: 'inherit', cursor: 'pointer',
                }}
              >
                {presenceStr}
              </button>
            </>
          )}
        </div>
      </div>

      {/* System health banner (services/ha_health.py drives the layered
          failure model — HA-down / coordinator-down / devices-offline / manual
          replug — and its own retry + ack actions live inside the component).
          The two inline banners that used to live here are subsumed by it. */}
      {health?.system_health && (
        <SystemHealthBanner
          health={health}
          onRefresh={() => { getHealth().then(setHealth).catch(() => {}) }}
        />
      )}

      {/* ── 2. Rooms carousel ── */}
      {sortedRooms.length > 0 && (
        <>
          {/* Phone + tablet: horizontal snap-carousel (iOS-app feel). */}
          <div className="hide-lg">
            <RoomsCarousel sortedRooms={sortedRooms} ziggyRooms={ziggyRooms} />
          </div>
          {/* Web/desktop (>=1024px): grid of room tiles — all rooms visible
              at once, 200px rows, the page flows. */}
          <div className="only-lg">
            <RoomsGrid sortedRooms={sortedRooms} ziggyRooms={ziggyRooms} />
          </div>
        </>
      )}

      {/* ── 3. Shortcuts — merged Routines + Quick Asks. Hidden when empty;
              user pins via the section's Edit button (opens ShortcutsPicker).
              Empty state surfaces as the Pinned-devices section below. ── */}
      <ShortcutsSection
        pinnedShortcuts={pinnedShortcuts}
        routines={routines}
        asks={quickAsks}
        onFireRoutine={async (r) => {
          // No optimistic "Running…" toast — App.jsx's WS execution_result
          // handler surfaces the real outcome (step count or failure detail).
          // Two toasts were either redundant or contradictory (green Running
          // followed by red Failed). Run errors here only fire if the HTTP
          // POST itself fails (backend unreachable).
          try {
            await runRoutine(r.id)
            // Refresh the store so any state changes the routine triggered
            // are reflected on tiles immediately, even if HA's per-entity
            // state_changed events are slow or get dropped by a flaky link.
            // Without this, a routine that "turn off all lights" left every
            // pinned tile glowing "on" until the user manually navigated.
            try { await useDeviceStore.getState().fetchAll({ force: true }) } catch {}
          }
          catch { addToast(t('dashboard.failedToRun'), 'error') }
        }}
        onFireAsk={async (qa) => {
          try {
            await sendDirectIntent(qa.intent, qa.params || {})
            addToast(translateNamePhrase(qa.label, getLang()), 'success')
            // Same catch-up refresh — quick-ask intents like
            // `turn_off_all_lights` mutate many entities at once, and the
            // pinned tiles need the new state to show through. WS events
            // SHOULD cover this in the happy path; fetchAll is the
            // defensive belt-and-suspenders that closes the gap.
            try { await useDeviceStore.getState().fetchAll({ force: true }) } catch {}
          }
          catch (e) { addToast(e.message || t('common.failed'), 'error') }
        }}
        onEdit={() => setShowShortcutsPicker(true)}
      />

      {/* Discover-shortcuts CTA — shown only when nothing is pinned AND the
          user has at least one routine or quick-ask to choose from. */}
      {pinnedShortcuts.length === 0 && (routines.length > 0 || quickAsks.length > 0) && (
        <button
          onClick={() => setShowShortcutsPicker(true)}
          className="z-btn-secondary"
          style={{ width: '100%', borderStyle: 'dashed', fontSize: 13, fontWeight: 500, color: 'var(--ink-mute)' }}
        >
          <Pencil size={16} strokeWidth={1.75} aria-hidden="true" /> {t('dashboard.pinShortcutsHint')}
        </button>
      )}

      {/* ── 4. Quick controls — user-pinned, up to 4. Falls back to auto-pick ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <p className="z-eyebrow" style={{ margin: 0 }}>{t('dashboard.pinnedDevicesLabel')}</p>
          <button onClick={() => setShowQuickPicker(true)} style={sectionEditBtn}>
            <Pencil size={16} strokeWidth={1.75} /> {t('common.edit')}
          </button>
        </div>
        {quickControlPicks.length === 0 ? (
          <button
            onClick={() => setShowQuickPicker(true)}
            className="z-btn-secondary"
            style={{ width: '100%', borderStyle: 'dashed', fontSize: 13, fontWeight: 500, color: 'var(--ink-mute)' }}
          >
            {t('dashboard.pinUpTo4')}
          </button>
        ) : (
          /* Single QuickControlTile component across all viewports — same
             redesign vocabulary everywhere. The grid responsively expands
             from 2 columns on phone to 4 columns on tablet+ via the
             z-quick-controls-grid utility (defined in index.css). */
          <div className="z-quick-controls-grid">
            {quickControlPicks.map(entity => (
              <QuickControlTile key={entity.entity_id} entity={entity} />
            ))}
          </div>
        )}
      </div>

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
        <div className="hide-lg z-card" style={{ padding: '8px 16px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <p className="z-eyebrow" style={{ margin: 0 }}>{t('dashboard.alertsLabel')}</p>
            <button onClick={() => navigate('/alerts')} style={sectionEditBtn}>
              {t('dashboard.seeAllN', { n: anomalies.length })}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {anomalies.slice(0, 3).map((a, i) => (
              <AlertRow key={a.id || `${a.room_id}-${a.rule_id}-${i}`} anomaly={a} onOpen={() => navigate('/alerts')} />
            ))}
          </div>
        </div>
      )}

      {/* ── 5. Tasks peek ── The icon box is a neutral surface (the single
              accent on this screen belongs to the primary action, not to a
              decoration); the outcome still speaks in status colour —
              overdue flips the sub line to the err text token. */}
      {taskTrackingEnabled && pendingTasks.length > 0 && (
        <button
          onClick={() => navigate('/tasks')}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: 12, borderRadius: 'var(--r-card)',
            background: 'var(--surface)', border: '0.5px solid var(--line)',
            cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit', width: '100%',
          }}
        >
          <div style={{ width: 36, height: 36, borderRadius: 'var(--r-ctl)', flexShrink: 0, background: 'var(--surface-2)', color: 'var(--ink-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ZIcon name="check" size={20} stroke={2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
              {pendingTasks.length === 1
                ? t('dashboard.tasksTodayOne', { n: pendingTasks.length })
                : t('dashboard.tasksTodayMany', { n: pendingTasks.length })}
            </div>
            <div style={{ fontSize: 13, color: overdueTasks.length > 0 ? 'var(--err-text)' : 'var(--ink-mute)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {overdueTasks.length > 0
                ? t('dashboard.overdueN', { n: overdueTasks.length })
                : t('dashboard.pendingN', { n: pendingTasks.length })}
              {pendingTasks[0]?.title && ` · ${pendingTasks[0].title}`}
            </div>
          </div>
          <ZIcon name="fwd" size={16} color="var(--ink-faint)" />
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
          {/* Collapsed by default — see recentOpen state declaration for why.
              Header is the full-width tap target so the chevron and label
              act as one control, matching the iOS settings disclosure feel. */}
          <button
            type="button"
            onClick={() => setRecentOpen(o => !o)}
            aria-expanded={recentOpen}
            style={{
              background: 'none', border: 'none', padding: 0, marginBottom: 4, minHeight: 40,
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              cursor: 'pointer', color: 'var(--ink-mute)', fontFamily: 'inherit',
            }}
          >
            {recentOpen
              ? <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
              : <ChevronRight size={16} strokeWidth={1.75} className="icon-flip-rtl" aria-hidden="true" />}
            <p className="z-eyebrow" style={{ margin: 0 }}>{t('dashboard.justNow')}</p>
            <span style={{ fontSize: 12, color: 'var(--ink-mute)', marginInlineStart: 'auto', fontVariantNumeric: 'tabular-nums' }}>
              {activity.length}
            </span>
          </button>
          {recentOpen && (
            /* Card wrapper kept for visual parity with the Alerts card sitting
               directly above it. The clean redesign mock drew this surface
               without a wrapper, but in our actual page the adjacent Alerts
               card creates a box-vs-no-box asymmetry that reads as broken. */
            <div className="z-card" style={{ padding: '4px 8px' }}>
              <div
                className="scrollbar-thin"
                style={{
                  maxHeight: 220,
                  overflowY: 'auto',
                  display: 'flex', flexDirection: 'column',
                }}
              >
                {activity.slice(0, 10).map((entry, i) => (
                  <ActivityRow key={i} {...formatActivity(entry, entityMap)} />
                ))}
              </div>
            </div>
          )}
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
          <div className="z-card" style={{ padding: '8px 16px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <p className="z-eyebrow" style={{ margin: 0 }}>{t('dashboard.alertsLabel')}</p>
              {/* One "See all N" in the header carries the count and the
                  link to /alerts — the old trailing "See all →" row after
                  five items duplicated both. */}
              <button onClick={() => navigate('/alerts')} style={sectionEditBtn}>
                {t('dashboard.seeAllN', { n: anomalies.length })}
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {anomalies.slice(0, 5).map((a, i) => (
                <AlertRow key={a.id || `${a.room_id}-${a.rule_id}-${i}`} anomaly={a} onOpen={() => navigate('/alerts')} hover />
              ))}
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
              padding: '16px 16px',
              background: 'color-mix(in srgb, var(--accent) 6%, var(--surface))',
              borderColor: 'color-mix(in srgb, var(--accent) 22%, var(--line))',
            }}
          >
            {/* The one accent on the desktop home: this eyebrow. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: 'var(--accent-text)' }}>
              <Sparkles size={16} strokeWidth={1.75} aria-hidden="true" />
              <p className="z-eyebrow" style={{ margin: 0, color: 'var(--accent-text)' }}>{t('dashboard.suggestedLabel')}</p>
            </div>
            <p style={{
              fontSize: 15, lineHeight: 1.4, color: 'var(--ink)',
              margin: '0 0 16px',
              display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 4,
              overflow: 'hidden',
            }}>
              {topSuggestion.user_message}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={async () => {
                  try { await acceptSuggestionAction(topSuggestion.id); addToast(t('dashboard.suggestionSaved'), 'success') }
                  catch (e) { addToast(e.message || t('common.failed'), 'error') }
                }}
                className="z-btn-primary"
              >
                {t('dashboard.save')}
              </button>
              <button
                onClick={async () => {
                  try { await rejectSuggestionAction(topSuggestion.id) }
                  catch (e) { addToast(e.message || t('common.failed'), 'error') }
                }}
                className="z-btn-secondary"
              >
                {t('dashboard.notNow')}
              </button>
            </div>
          </div>
        )}

        {/* Recent Activity — was "Just now" at the bottom of the main column.
            On desktop it makes more sense in the rail (always visible while
            scrolling). On mobile it stacks below main, same as before just
            without the "Just now" eyebrow change. */}
        {activity.length > 0 && (
          <div className="z-card" style={{ padding: '16px 16px 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <p className="z-eyebrow" style={{ margin: 0 }}>{t('dashboard.recentActivity')}</p>
              <span style={{ fontSize: 12, color: 'var(--ink-mute)', fontVariantNumeric: 'tabular-nums' }}>{activity.length}</span>
            </div>
            {/* Rows are 44px; six fit before the list scrolls (6 × 44 = 264)
                so the cut-off row is a visible scroll affordance. */}
            <div
              className="scrollbar-thin"
              style={{
                maxHeight: 264,
                overflowY: 'auto',
                display: 'flex', flexDirection: 'column',
              }}
            >
              {activity.slice(0, 10).map((entry, i) => (
                <ActivityRow key={i} {...formatActivity(entry, entityMap)} />
              ))}
            </div>
          </div>
        )}

      </aside>

      </div>  {/* close .z-dashboard-grid */}
    </div>
  )
}
