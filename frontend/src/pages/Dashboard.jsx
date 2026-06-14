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
import { findRoomMetric, deviceFacts, sendDeviceCommand, kindMeta } from '../lib/devices'
import { QuickControlsPicker } from '../components/QuickControlsPicker'
import { SystemHealthBanner } from '../components/ui/SystemHealthBanner'
import { Modal } from '../components/ui/Modal'
import { Pencil, Play, Sparkles, Check, ChevronRight } from 'lucide-react'
import { useT, t as tt, useLang, getLang, translateNamePhrase } from '../lib/i18n'

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

  return { id: room.id, name: room.name, activeCount, offlineCount, parts, tempSensor, humSensor, hasMotion }
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
    catch (e) { addToast(e?.message || 'Failed', 'error') }
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
  const subColor   = on ? 'color-mix(in srgb, var(--bg) 70%, transparent)' : 'var(--ink-faint)'
  const emoji      = kindMeta(facts.kind).icon

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
        padding: 14, borderRadius: 18, minHeight: 96,
        background: tileBg, color: tileFg,
        border: '0.5px solid var(--line)',
        display: 'flex', flexDirection: 'column', gap: 14,
        textAlign: 'start', fontFamily: 'inherit', cursor: 'pointer',
        transition: 'background 0.16s, color 0.16s',
        opacity: pending ? 0.7 : 1,
      }}
    >
      <span style={{
        width: 32, height: 32, borderRadius: 10,
        background: iconBg, color: iconColor,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, lineHeight: 1,
      }} aria-hidden="true">
        {emoji}
      </span>

      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, lineHeight: 1.2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {facts.name}
        </div>
        <div style={{
          fontSize: 11, marginTop: 2, color: subColor,
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
          position: 'absolute', top: 10, insetInlineEnd: 10,
          width: 24, height: 24, borderRadius: 8,
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

// ── Rooms carousel — production-grade centered snap ───────────────────────────
// One dominant card fills ~78% of the viewport. Neighbouring tiles peek ~24px
// each side. All tiles are the same DOM width → snap points never shift.
// Uniform scale() keeps photo proportions correct. Shadow lifts active tile.
const C_W   = 300   // tile DOM width (px) — set once, never changes
const C_H   = 206   // tile DOM height
const C_GAP = 14    // gap between tiles
const C_PAD = 20    // horizontal padding inside scroll container

function RoomsCarousel({ sortedRooms, ziggyRooms }) {
  const t = useT()
  const lang = useLang()
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

  // Vertical padding so the active-tile shadow doesn't clip
  const vPad = 14

  return (
    <div>
      <p className="z-eyebrow" style={{ marginBottom: 10 }}>{t('dashboard.rooms')}</p>
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
                  // `always` forces the browser to stop at the next snap
                  // point regardless of swipe velocity — one swipe = one
                  // tile, instead of letting a hard flick on the S24's
                  // aggressive touch-inertia fly past 2-3 tiles. Default
                  // value `normal` looked fine in mobile sims (mouse-based
                  // touch emulation has no real momentum) but felt out of
                  // control on a real Samsung WebView.
                  scrollSnapStop: 'always',
                  // Scale + opacity — no layout change, no jump
                  transform: isActive ? 'scale(1)' : 'scale(0.88)',
                  opacity:   isActive ? 1 : 0.6,
                  // Elevation on active card. Derive from ink so the shadow
                  // tints with the palette instead of staying flat-black on
                  // a dark page background.
                  boxShadow: isActive ? '0 10px 28px color-mix(in srgb, var(--ink) 32%, transparent)' : 'none',
                  // Material ease-in-out, 300ms — matches platform expectations
                  transition: 'transform 300ms cubic-bezier(0.4,0,0.2,1), opacity 300ms cubic-bezier(0.4,0,0.2,1), box-shadow 300ms cubic-bezier(0.4,0,0.2,1)',
                  transformOrigin: 'center center',
                }}
              >
                <img src={photo} alt={translateNamePhrase(room.name, lang)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
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
                      position: 'absolute', top: 12, insetInlineEnd: 12,
                      width: 8, height: 8, borderRadius: '50%',
                      // Active dot reads --ok (palette-aware green); inactive
                      // stays a white tint because it sits over a photo, not
                      // the page surface.
                      background: isActiveRoom ? 'var(--ok)' : 'rgba(255,255,255,0.3)',
                      boxShadow: isActiveRoom ? '0 0 0 3px color-mix(in srgb, var(--ok) 30%, transparent)' : 'none',
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
                  <div style={{ position: 'absolute', top: 11, insetInlineStart: 12, display: 'flex', gap: 5 }}>
                    {summary.tempSensor && (() => {
                      const raw = parseFloat(summary.tempSensor.state)
                      const unit = summary.tempSensor.unit_of_measurement
                                || summary.tempSensor.attributes?.unit_of_measurement
                                || '°C'
                      const tempC = unit.includes('F') ? (raw - 32) * 5 / 9 : raw
                      // Temperature tint chips. Cold/hot read from --info/--err
                      // so dark mode picks up the lighter palette values; the
                      // neutral chip stays a plain black wash because it sits
                      // on a photo, not on the page bg.
                      const bg = tempC < 18 ? 'color-mix(in srgb, var(--info) 55%, transparent)'
                               : tempC > 25 ? 'color-mix(in srgb, var(--err) 55%, transparent)'
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
                  <p dir="auto" style={{ fontSize: 13, fontWeight: 650, color: '#fff', margin: '0 0 3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.02em' }}>{translateNamePhrase(room.name, lang)}</p>
                  <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', margin: 0, fontFamily: '"IBM Plex Mono", monospace' }}>
                    {/* Same condition as the dot and greeting count: a room with
                        motion but zero on-devices is still "active" to the user. */}
                    {summary.activeCount > 0
                      ? t('dashboard.activeShort', { n: summary.activeCount })
                      : summary.hasMotion
                        ? t('dashboard.motion')
                        : t('dashboard.idle')}
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
  const lang = useLang()
  const navigate = useNavigate()
  if (!sortedRooms.length) return null
  const { cols, rows } = roomsGridShape(sortedRooms.length)
  // Cap visible tiles to the grid cell count so the layout never overflows.
  // In practice the cap only matters past 20 rooms; the shape function above
  // grows enough to display every room up to 16, and 5×N beyond.
  const visibleRooms = sortedRooms.slice(0, cols * rows)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <p className="z-eyebrow" style={{ marginBottom: 10, flexShrink: 0 }}>{t('dashboard.rooms')}</p>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        gap: 12,
        flex: 1, minHeight: 0,
      }}>
        {visibleRooms.map(summary => {
          const room = ziggyRooms.find(r => r.id === summary.id)
          if (!room) return null
          const photo = getRoomPhoto(room)
          const isActiveRoom = summary.activeCount > 0 || summary.hasMotion
          return (
            <div
              key={room.id}
              onClick={() => navigate(`/rooms/${room.id}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/rooms/${room.id}`) }}
              style={{
                position: 'relative',
                width: '100%', height: '100%',
                borderRadius: 16, overflow: 'hidden', cursor: 'pointer',
                background: 'var(--surface-2)',
                border: '0.5px solid var(--line)',
                // No translateY on hover — the outer container clips it
                // against the viewport top on the first row. Soft shadow
                // lift + subtle border-color shift is the same affordance
                // without the clipping issue.
                transition: 'box-shadow 0.16s, border-color 0.16s',
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
              <img src={photo} alt={translateNamePhrase(room.name, lang)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.06) 0%, transparent 35%, rgba(0,0,0,0.68) 100%)' }} />

              <span style={{
                position: 'absolute', top: 10, insetInlineEnd: 10,
                width: 7, height: 7, borderRadius: '50%',
                background: isActiveRoom ? 'var(--ok)' : 'rgba(255,255,255,0.3)',
                boxShadow: isActiveRoom ? '0 0 0 3px color-mix(in srgb, var(--ok) 30%, transparent)' : 'none',
              }} />

              {(summary.tempSensor || summary.humSensor) && (
                <div style={{ position: 'absolute', top: 9, insetInlineStart: 10, display: 'flex', gap: 4 }}>
                  {summary.tempSensor && (() => {
                    const raw = parseFloat(summary.tempSensor.state)
                    const unit = summary.tempSensor.unit_of_measurement
                              || summary.tempSensor.attributes?.unit_of_measurement
                              || '°C'
                    const tempC = unit.includes('F') ? (raw - 32) * 5 / 9 : raw
                    const bg = tempC < 18 ? 'color-mix(in srgb, var(--info) 55%, transparent)'
                             : tempC > 25 ? 'color-mix(in srgb, var(--err) 55%, transparent)'
                             : 'rgba(0, 0, 0, 0.32)'
                    return (
                      <span style={{ fontSize: 10, color: '#fff', fontFamily: '"IBM Plex Mono", monospace', background: bg, backdropFilter: 'blur(8px)', padding: '2px 6px', borderRadius: 999 }}>
                        {raw.toFixed(1)}°
                      </span>
                    )
                  })()}
                  {summary.humSensor && (
                    <span style={{ fontSize: 10, color: '#fff', fontFamily: '"IBM Plex Mono", monospace', background: 'rgba(0,0,0,0.32)', backdropFilter: 'blur(8px)', padding: '2px 6px', borderRadius: 999 }}>
                      {parseFloat(summary.humSensor.state).toFixed(0)}%
                    </span>
                  )}
                </div>
              )}

              <div style={{ position: 'absolute', bottom: 10, left: 12, right: 12 }}>
                <p dir="auto" style={{ fontSize: 13, fontWeight: 650, color: '#fff', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.02em' }}>{translateNamePhrase(room.name, lang)}</p>
                <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', margin: 0, fontFamily: '"IBM Plex Mono", monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {summary.activeCount > 0
                    ? t('dashboard.activeShort', { n: summary.activeCount })
                    : summary.hasMotion
                      ? t('dashboard.motion')
                      : t('dashboard.idle')}
                  {summary.parts.length > 0 && ` · ${summary.parts[0]}`}
                </p>
              </div>
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
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <p className="z-eyebrow">{t('dashboard.shortcuts')}</p>
        <button
          onClick={onEdit}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 11, color: 'var(--ink-faint)', fontFamily: 'inherit', padding: '2px 4px',
          }}
        >
          <Pencil size={11} /> {t('dashboard.shortcutsEdit')}
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

// Horizontal pill — used in the mobile Shortcuts carousel. Stateless surface,
// so "active" only means "currently firing". Icon picks up the kind's tint
// (var(--ok) for routine, var(--accent) for ask) and stays tinted on both
// inactive (surface bg) and active (inverted ink bg) so the personality of
// the routine survives the press.
function ShortcutPill({ type, record, onFire }) {
  const lang = useLang()
  const [pending, setPending] = useState(false)
  const icon  = record.icon || (type === 'routine' ? '⚡' : '✦')
  const rawLabel = type === 'routine' ? record.name : record.label
  const label = translateNamePhrase(rawLabel, lang)
  const tint  = type === 'routine' ? 'var(--ok)' : 'var(--accent)'

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
        padding: '10px 12px', borderRadius: 14,
        background: pending ? 'var(--ink)' : 'var(--surface)',
        color:      pending ? 'var(--bg)'  : 'var(--ink-2)',
        border: '0.5px solid var(--line)',
        display: 'inline-flex', alignItems: 'center', gap: 7,
        fontSize: 12, fontWeight: 500, fontFamily: 'inherit',
        cursor: 'pointer',
        transition: 'background 0.18s, color 0.18s',
      }}
    >
      <span style={{ fontSize: 14, lineHeight: 1, color: tint }} aria-hidden="true">{icon}</span>
      <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
          opacity: disabled ? 0.4 : 1, fontFamily: 'inherit', textAlign: 'start',
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
    <Modal open={open} onClose={onClose} title={t('dashboard.editShortcutsTitle')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <p style={{ fontSize: 11.5, color: 'var(--ink-mute)', margin: 0 }}>
          {t('dashboard.pinnedSlash', { n: pinnedShortcuts.length, max: SHORTCUTS_MAX })}
        </p>

        {/* Routines */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Play size={11} style={{ color: 'var(--ok)' }} />
            <p className="z-eyebrow" style={{ margin: 0 }}>{t('dashboard.routines')}</p>
            <span className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{routines.length}</span>
          </div>
          {routines.length === 0 ? (
            <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', padding: '8px 4px' }}>{t('dashboard.routinesEmpty')}</p>
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
            <p className="z-eyebrow" style={{ margin: 0 }}>{t('dashboard.quickAsks')}</p>
            <span className="z-mono" style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{asks.length}</span>
          </div>
          {asks.length === 0 ? (
            <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', padding: '8px 4px' }}>{t('dashboard.asksEmpty')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {asks.map(a => renderRow('ask', a))}
            </div>
          )}
        </div>

        <button onClick={onClose} className="z-btn-primary" style={{ width: '100%', padding: '10px', borderRadius: 10 }}>
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
  const roomsOrder              = useDeviceStore(s => s.roomsOrder)
  const quickControlIds         = useDeviceStore(s => s.quickControlIds)
  const pinnedShortcuts         = useDeviceStore(s => s.pinnedShortcuts)
  const fetchAll                = useDeviceStore(s => s.fetchAll)
  const togglePinnedShortcut    = useDeviceStore(s => s.togglePinnedShortcut)
  const [showQuickPicker,     setShowQuickPicker]     = useState(false)
  const [showShortcutsPicker, setShowShortcutsPicker] = useState(false)
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
    () => ziggyRooms.map(r => buildRoomSummary(r, entityMap)),
    [ziggyRooms, entityMap],
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

  const statusText = activeRooms.length > 0
    ? (activeRooms.length === 1 ? t('dashboard.roomsActiveOne', { n: activeRooms.length }) : t('dashboard.roomsActiveMany', { n: activeRooms.length }))
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
        <p className="z-eyebrow" style={{ marginBottom: 2 }}>{greetingByTime()}</p>
        <h1 className="z-display" style={{ fontSize: 26, lineHeight: 1.1, margin: '0 0 6px' }}>{statusText}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {activeRooms.length > 0
            ? <span className="z-dot z-dot-on" style={{ flexShrink: 0 }} />
            : <span className="z-dot" style={{ background: 'var(--line-2)', flexShrink: 0 }} />}
          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
            {activeRooms.length > 0
              ? (activeRooms.length === 1
                  ? t('dashboard.roomsActiveOne', { n: activeRooms.length })
                  : t('dashboard.roomsActiveMany', { n: activeRooms.length }))
              : t('dashboard.allQuiet')}
          </span>
          {homePersons.length > 0 && (
            <>
              <span style={{ color: 'var(--ink-ghost)', fontSize: 12 }}>·</span>
              <button
                onClick={() => navigate('/settings#presence')}
                style={{
                  background: 'none', border: 'none', padding: 0,
                  fontSize: 12, color: 'var(--ink-mute)',
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
              at once. `.z-dashboard-fill` makes this section absorb the
              leftover vertical space in the no-scroll dashboard, and the
              tiles inside RoomsGrid stretch to fill it. */}
          <div className="only-lg z-dashboard-fill">
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
          catch { addToast('Failed to run', 'error') }
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
          <Pencil size={12} /> {t('dashboard.pinShortcutsHint')}
        </button>
      )}

      {/* ── 4. Quick controls — user-pinned, up to 4. Falls back to auto-pick ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
          <p className="z-eyebrow">{t('dashboard.pinnedDevicesLabel')}</p>
          <button
            onClick={() => setShowQuickPicker(true)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 11, color: 'var(--ink-faint)', fontFamily: 'inherit',
              padding: '2px 4px',
            }}
          >
            <Pencil size={11} /> {t('common.edit')}
          </button>
        </div>
        {quickControlPicks.length === 0 ? (
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
        <div className="hide-lg z-card" style={{ padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
            <p className="z-eyebrow" style={{ margin: 0 }}>{t('dashboard.alertsLabel')}</p>
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
                    fontFamily: 'inherit', textAlign: 'start', width: '100%',
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

      {/* ── 5. Tasks peek ── Icon-square uses --accent per the redesign
              (peach tint reads as "today's thing to do"), even though the
              section is semantically about completion. The redesign keeps
              status colors (--ok / --err) for the actual outcome — overdue
              flips the sub line to --err. */}
      {taskTrackingEnabled && pendingTasks.length > 0 && (
        <button
          onClick={() => navigate('/tasks')}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '11px 14px', borderRadius: 13,
            background: 'var(--surface)', border: '0.5px solid var(--line)',
            cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit', width: '100%',
          }}
        >
          <div style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, background: 'color-mix(in srgb, var(--accent) 12%, var(--surface-2))', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ZIcon name="check" size={14} stroke={2.5} color="var(--accent)" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>{pendingTasks.length} task{pendingTasks.length !== 1 ? 's' : ''} today</div>
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
          <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('dashboard.justNow')}</p>
          {/* Card wrapper kept for visual parity with the Alerts card sitting
              directly above it. The clean redesign mock drew this surface
              without a wrapper, but in our actual page the adjacent Alerts
              card creates a box-vs-no-box asymmetry that reads as broken. */}
          <div className="z-card" style={{ padding: '4px 6px' }}>
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
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 2px', flexShrink: 0 }}>
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
              <p className="z-eyebrow" style={{ margin: 0 }}>{t('dashboard.alertsLabel')}</p>
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
                      fontFamily: 'inherit', textAlign: 'start', width: '100%',
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
                    padding: '6px', textAlign: 'start',
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
              <p className="z-eyebrow" style={{ margin: 0, color: 'var(--accent-3)' }}>{t('dashboard.suggestedLabel')}</p>
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
