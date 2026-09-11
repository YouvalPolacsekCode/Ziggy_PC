import { useEffect, useState, useRef, createContext, useContext } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Zap, Check, ChevronRight, ChevronDown, RefreshCw, EyeOff, Eye, Pencil, Home, Trash2 } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Toggle } from '../components/ui/Toggle'
import { Badge } from '../components/ui/Badge'
import { DeviceRemote } from '../components/device/DeviceRemote'
import SensorHistoryChart from '../components/device/SensorHistoryChart'
import { deviceFacts, getKind, KIND, sendDeviceCommand } from '../lib/devices'
import { DeviceIcon, ICON_CHOICES } from '../lib/deviceIcons'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { useDeviceStore } from '../stores/deviceStore'
import { useUIStore } from '../stores/uiStore'
import { useSuggestionStore } from '../stores/suggestionStore'
import { getEntityDetails, controlDevice, callHaService, assignEntityToArea, getAllRooms, removeRegistryEntity, deleteHaEntity, deleteIrDevice, renameHaEntity, getIrBlaster, setTilePref, setClassification, getClassifyOptions, selfHealRefresh, whoCanDo } from '../lib/api'
import { cameraSnapshotUrl, cameraStreamUrl, useCameraStore } from '../stores/cameraStore'
import { cn, normRoomSlug } from '../lib/utils'
import { patchIrDevice } from '../lib/api'
import { useT, useTranslatedName, getLang } from '../lib/i18n'
import { buildFixerQuestion } from '../lib/fixerPrompt'


// ── Helpers ───────────────────────────────────────────────────────────────────

// Set when this page is embedded (the wall overlay); null on the real route.
const ExitCtx = createContext(null)

/**
 * A <Link> that knows whether it is inside a route or inside an overlay.
 *
 * On the /devices/:id route it is an ordinary Link. Embedded in the wall it
 * hands the destination to the host instead: the wall has no URL for these
 * pages, and a real navigation would drop the user off the dashboard — on a
 * wall panel with no browser chrome, with no way back.
 */
function PageLink({ to, children, ...rest }) {
  const onExit = useContext(ExitCtx)
  if (!onExit) return <Link to={to} {...rest}>{children}</Link>
  return (
    <a
      href={to}
      onClick={(e) => { e.preventDefault(); onExit(to) }}
      {...rest}
    >{children}</a>
  )
}

/**
 * A section that starts folded when this page is embedded in the wall overlay,
 * and open when it's the normal route.
 *
 * The device page has two long setup sections — the sibling-entity list and the
 * tile controls — that together are ~1,700px, more than 60% of a page like
 * Outdoor Watering. On the phone that's fine; you scroll. On a wall panel the
 * whole page is fitted to one screen, and carrying that much configuration
 * forces the fit so small the parts people actually read stop being legible.
 *
 * So they fold there and nowhere else. The route keeps the exact page it has
 * always had — same order, same content, nothing hidden from the phone.
 */
function FoldSection({ title, children }) {
  const embedded = !!useContext(ExitCtx)
  const [open, setOpen] = useState(!embedded)

  // On the route, render exactly what was here before — a plain heading, no
  // chevron, nothing to collapse. Folding earns its place on a panel fitted to
  // one screen; on the phone it would just be a new control on a page that
  // didn't ask for one.
  if (!embedded) {
    return (
      <Card className="p-4 mb-3">
        <p className="z-headline" style={{ marginBottom: 12 }}>{title}</p>
        {children}
      </Card>
    )
  }

  return (
    <Card className="p-4 mb-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full"
        style={{ background: 'none', border: 'none', padding: 0, minHeight: 40, cursor: 'pointer', textAlign: 'start' }}
        aria-expanded={open}
      >
        <p className="z-headline">{title}</p>
        <ChevronDown
          size={18}
          strokeWidth={1.75}
          className="text-ink-mute"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur-state) var(--ease-standard)', flex: 'none' }}
        />
      </button>
      {open && <div style={{ marginTop: 12 }}>{children}</div>}
    </Card>
  )
}

// Card section title — Info-tab cards all open with one Headline (17/600)
// instead of a 12px uppercase eyebrow.
function SectionTitle({ children, style }) {
  return <p className="z-headline" style={{ marginBottom: 12, ...style }}>{children}</p>
}

function BatteryBar({ level, unit = '%' }) {
  if (level == null) return null
  const barColor = level > 60 ? 'var(--ok)' : level > 20 ? 'var(--warn)' : 'var(--err)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="z-slider-track" style={{ flex: 1 }}>
        <div className="z-slider-fill" style={{ width: `${level}%`, background: barColor }} />
      </div>
      <span className="z-mono" style={{ fontSize: 12, color: 'var(--ink-mute)', width: 44, textAlign: 'end' }}>
        {level}{unit}
      </span>
    </div>
  )
}

function SignalBars({ lqi, rssi }) {
  const t = useT()
  if (lqi == null && rssi == null) return null
  const strength = lqi != null
    ? Math.round((lqi / 255) * 100)
    : rssi != null ? Math.max(0, Math.min(100, Math.round((rssi + 100) * 2))) : null
  if (strength == null) return null
  const bars = Math.ceil(strength / 25)
  // Friendly label instead of "LQI 187" / "-68 dBm". Raw value still
  // available on hover for support/debugging via the title attribute.
  const friendly = bars >= 4 ? t('deviceDetail.signalStrong')
    : bars >= 3 ? t('deviceDetail.signalGood')
    : bars >= 2 ? t('deviceDetail.signalFair')
    : t('deviceDetail.signalWeak')
  const rawTitle = lqi != null ? `LQI ${lqi}` : `${rssi} dBm`
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 16 }} title={rawTitle}>
      {[1, 2, 3, 4].map(b => (
        <div
          key={b}
          style={{
            height: `${b * 25}%`, width: 5, borderRadius: 2,
            background: b <= bars ? 'var(--ok)' : 'var(--line-2)',
          }}
        />
      ))}
      <span style={{ marginInlineStart: 8, fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1 }}>
        {friendly}
      </span>
    </div>
  )
}

function DiagRow({ label, value, children }) {
  if (value == null && !children) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 40, padding: '8px 0', borderBottom: '0.5px solid var(--line)' }}
      className="last:border-0">
      <span style={{ fontSize: 13, color: 'var(--ink-mute)', flexShrink: 0 }}>{label}</span>
      {children ?? <span className="z-mono" style={{ fontSize: 13, color: 'var(--ink)', textAlign: 'end', wordBreak: 'break-all' }}>{value}</span>}
    </div>
  )
}

function TimeAgo({ iso }) {
  const t = useT()
  if (!iso) return null
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.round(diffMs / 60000)
  if (diffMin < 1) return t('deviceDetail.justNow')
  if (diffMin < 60) return t('deviceDetail.minutesAgo', { n: diffMin })
  if (diffMin < 1440) return t('deviceDetail.hoursAgo', { n: Math.round(diffMin / 60) })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// ── Ghost device page ────────────────────────────────────────────────────────
// Shown when the entity was deleted directly in Home Assistant but Ziggy's
// device registry still has a row pointing at it. Without this dedicated UI
// the page hung on a silent fetch failure (controls would render against a
// non-existent entity). The user just needs a clean way to drop the stale
// row — no controls, no diagnostics.

function GhostDevicePage({ details, entityId, navigate, addToast }) {
  const t = useT()
  const [removing, setRemoving] = useState(false)
  const rawName = details?.ghost_name || details?.attributes?.friendly_name || entityId
  const name = useTranslatedName(rawName)
  const room = details?.ghost_room
  const status = details?.ghost_status || 'lost'

  const handleRemove = async () => {
    setRemoving(true)
    try {
      await removeRegistryEntity(entityId)
      addToast(t('deviceDetail.ghost.removed'), 'success')
      // Best-effort store refresh so room/devices pages drop the stale row
      // without a manual reload.
      // Refresh the store, but let the in-flight dedupe absorb rapid
      // repeat clicks. Using `force: true` previously meant N taps fired
      // N parallel backend fan-outs, each opening fresh HA WebSocket
      // handshakes — enough to overload HA and knock the long-lived
      // ha_subscriber WS off the air for a few seconds.
      try { await useDeviceStore.getState().fetchAll() } catch {}
      navigate('/devices')
    } catch (e) {
      addToast(e.message || t('deviceDetail.ghost.failed'), 'error')
      setRemoving(false)
    }
  }

  return (
    <div style={{ maxWidth: 'var(--page-max-w-narrow)', margin: '0 auto', padding: '24px 20px 24px' }}>
      <div style={{ marginBottom: 12 }}>
        <button onClick={() => navigate(-1)} className="z-icon-btn" aria-label={t('deviceDetail.back')}>
          <ArrowLeft size={20} strokeWidth={1.75} className="icon-flip-rtl" />
        </button>
        <h1 dir="auto" className="z-display" style={{
          margin: '12px 0 0', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {name}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--warn-text)', margin: '4px 0 0' }}>{t('deviceDetail.ghost.eyebrow')}</p>
      </div>

      <div className="z-card" style={{ padding: 12, marginBottom: 12 }}>
        <p style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.4, margin: 0 }}>
          {t('deviceDetail.ghost.description')}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 12, rowGap: 8, fontSize: 13, marginTop: 16 }}>
          {room && (<>
            <span style={{ color: 'var(--ink-mute)' }}>{t('deviceDetail.ghost.room')}</span>
            <span style={{ color: 'var(--ink)' }}>{room.replace(/_/g, ' ')}</span>
          </>)}
          <span style={{ color: 'var(--ink-mute)' }}>{t('deviceDetail.ghost.status')}</span>
          <span style={{ color: 'var(--warn-text)' }}>{status}</span>
        </div>
      </div>

      <button
        onClick={handleRemove}
        disabled={removing}
        className="z-btn-primary"
        style={{
          width: '100%',
          background: 'var(--err)', color: 'var(--on-accent)',
          opacity: removing ? 0.6 : 1, cursor: removing ? 'default' : 'pointer',
        }}
      >
        {removing ? t('deviceDetail.ghost.removing') : t('deviceDetail.ghost.remove')}
      </button>
      <p style={{ fontSize: 13, color: 'var(--ink-mute)', textAlign: 'center', marginTop: 12, lineHeight: 1.4 }}>
        {t('deviceDetail.ghost.hint')}
      </p>
    </div>
  )
}


// ── Rename modal ──────────────────────────────────────────────────────────────

// ── Delete-device confirmation modal ────────────────────────────────────────
// Two-step intent: "delete entity" vs "delete the whole physical device".
// Most users want the latter — they unpaired the device in real life and
// want it gone from HA too. Default the checkbox to true when there is a
// known parent HA device, but always let them tap through to single-entity
// removal in case the device has multiple useful entities.

function DeleteDeviceModal({ open, deviceName, hasParentDevice, isIr, deleting, onClose, onConfirm }) {
  const t = useT()
  const [alsoDeleteDevice, setAlsoDeleteDevice] = useState(true)
  useEffect(() => { if (open) setAlsoDeleteDevice(true) }, [open])
  return (
    <Modal open={open} onClose={onClose} title={t('deviceDetail.deleteTitle')}>
      <p style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.4, marginBottom: 12 }}>
        {isIr
          ? t('deviceDetail.deleteIrDescription', { name: deviceName })
          : t('deviceDetail.deleteHaDescription', { name: deviceName })
        }
      </p>
      {hasParentDevice && (
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 12, minHeight: 48, borderRadius: 'var(--r-ctl)', background: 'var(--surface-2)', cursor: 'pointer', marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={alsoDeleteDevice}
            onChange={(e) => setAlsoDeleteDevice(e.target.checked)}
            style={{ marginTop: 2, width: 20, height: 20, accentColor: 'var(--ink)', flexShrink: 0 }}
          />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{t('deviceDetail.alsoRemoveDevice')}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4, lineHeight: 1.4 }}>
              {t('deviceDetail.alsoRemoveHint')}
            </div>
          </div>
        </label>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onClose} disabled={deleting} className="z-btn-secondary" style={{ flex: 1 }}>{t('common.cancel')}</button>
        <button
          onClick={() => onConfirm(alsoDeleteDevice)}
          disabled={deleting}
          className="z-btn-primary"
          style={{
            flex: 1, cursor: deleting ? 'default' : 'pointer',
            background: 'var(--err)', color: 'var(--on-accent)',
            opacity: deleting ? 0.6 : 1,
          }}
        >
          {deleting ? t('deviceDetail.deleting') : t('common.delete')}
        </button>
      </div>
    </Modal>
  )
}


function RenameModal({ open, currentName, onClose, onSave }) {
  const t = useT()
  const [name, setName] = useState(currentName)
  useEffect(() => { setName(currentName) }, [currentName, open])
  return (
    <Modal open={open} onClose={onClose} title={t('deviceDetail.renameTitle')}>
      <Input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder={t('deviceDetail.deviceNamePlaceholder')}
        onKeyDown={e => e.key === 'Enter' && name.trim() && onSave(name.trim())}
        autoFocus
        dir="auto"
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} className="z-btn-secondary" style={{ flex: 1 }}>{t('common.cancel')}</button>
        <button
          onClick={() => name.trim() && onSave(name.trim())}
          disabled={!name.trim() || name.trim() === currentName}
          className="z-btn-primary"
          style={{ flex: 1, opacity: (!name.trim() || name.trim() === currentName) ? 0.4 : 1 }}
        >
          {t('common.save')}
        </button>
      </div>
    </Modal>
  )
}

// ── Camera panel — snapshot + go-live button ──────────────────────────────────

function CameraPanel({ entityId, navigate }) {
  const t = useT()
  const [tick, setTick]     = useState(0)
  const [live, setLive]     = useState(false)
  const [loaded, setLoaded] = useState(false)
  const imgRef              = useRef(null)
  const { motionEvents }    = useCameraStore()

  useEffect(() => {
    if (live) return
    const id = setInterval(() => { setTick(t => t + 1); setLoaded(false) }, 10_000)
    return () => clearInterval(id)
  }, [live])

  useEffect(() => {
    if (!live && imgRef.current) imgRef.current.src = ''
  }, [live])

  const camMotion = motionEvents
    .filter(e => e.entity_id === entityId || e.entity_id.includes(entityId.split('.')[1]))
    .slice(0, 5)

  return (
    <Card className="p-4 mb-3">
      <div className="flex items-center justify-between gap-3 mb-3" style={{ flexWrap: 'wrap' }}>
        <p className="z-headline">{t('deviceDetail.camera')}</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLive(v => !v)}
            className="z-btn-secondary"
            style={{ minHeight: 40 }}
          >
            {live ? t('deviceDetail.cameraStop') : t('deviceDetail.cameraLive')}
          </button>
          <button
            onClick={() => navigate('/cameras')}
            style={{ fontSize: 13, minHeight: 40, padding: '0 8px', color: 'var(--ink-mute)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {t('deviceDetail.cameraFullView')}
          </button>
        </div>
      </div>

      {/* Feed */}
      <div style={{ borderRadius: 'var(--r-ctl)', overflow: 'hidden', background: 'var(--bg-2)', aspectRatio: '16/9', position: 'relative' }}>
        {live ? (
          <img
            ref={imgRef}
            src={cameraStreamUrl(entityId)}
            alt={t('deviceDetail.liveFeedAlt')}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <img
            key={tick}
            src={`${cameraSnapshotUrl(entityId)}?t=${tick}`}
            alt={t('deviceDetail.snapshotAlt')}
            onLoad={() => setLoaded(true)}
            style={{
              width: '100%', height: '100%', objectFit: 'cover', display: 'block',
              opacity: loaded ? 1 : 0, transition: 'opacity var(--dur-state) var(--ease-standard)',
            }}
          />
        )}
        {live && (
          <div style={{
            position: 'absolute', top: 8, insetInlineStart: 8,
            padding: '2px 8px', borderRadius: 999,
            background: 'rgba(0,0,0,0.6)', color: '#fff',
            fontSize: 11, fontWeight: 500, lineHeight: '13px',
          }}>
            {t('deviceDetail.cameraLiveBadge')}
          </div>
        )}
      </div>

      {/* Recent motion */}
      {camMotion.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p className="z-eyebrow" style={{ marginBottom: 4 }}>{t('deviceDetail.recentMotion')}</p>
          {camMotion.map((ev, i) => {
            const diff = Math.floor((Date.now() - new Date(ev.timestamp)) / 1000)
            const ago = diff < 60 ? t('deviceDetail.secondsAgo', { n: diff })
              : diff < 3600 ? t('deviceDetail.minutesAgo', { n: Math.floor(diff / 60) })
              : t('deviceDetail.hoursAgo', { n: Math.floor(diff / 3600) })
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 40, borderBottom: i < camMotion.length - 1 ? '0.5px solid var(--line)' : 'none' }}>
                <span className="z-dot z-dot-err" style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ev.name || ev.entity_id.split('.')[1]?.replace(/_/g, ' ')}
                </span>
                <span style={{ fontSize: 12, color: 'var(--ink-mute)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{ago}</span>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

// Primary control verb per HA domain — used to ask "who can operate this?".
const DOMAIN_PRIMARY_ACTION = {
  light: 'light.onoff', switch: 'light.onoff', lock: 'lock.unlock', camera: 'camera.live',
  climate: 'climate.setpoint', fan: 'climate.mode', media_player: 'media.playback',
  cover: 'cover.open', alarm_control_panel: 'alarm.disarm',
}

// Best-effort "Who can use this" card. Reads the permission platform's who_can
// query; renders NOTHING on error/empty (permissions not bootstrapped, or the
// viewer isn't an admin — the endpoint is admin-gated), so it never disturbs
// the device page for anyone who isn't managing access.
function WhoCanUse({ entityId }) {
  const t = useT()
  const [people, setPeople] = useState(null)
  useEffect(() => {
    if (!entityId) return
    let live = true
    const domain = entityId.split('.')[0]
    const action = DOMAIN_PRIMARY_ACTION[domain] || `${domain}.onoff`
    whoCanDo(`device:${entityId}`, action)
      .then(d => { if (live) setPeople(d?.principals || []) })
      .catch(() => { if (live) setPeople([]) })
    return () => { live = false }
  }, [entityId])
  if (!people || people.length === 0) return null
  const names = people.map(p => p.split(':')[1])
  return (
    <Card className="p-4 mb-3">
      <SectionTitle>{t('deviceDetail.whoCanUse')}</SectionTitle>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {names.map(n => (
          <span key={n} className="z-chip">{n}</span>
        ))}
      </div>
      <PageLink to="/settings/people" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 40, marginTop: 4, fontSize: 13,
        fontWeight: 500, color: 'var(--ink)', textDecoration: 'none' }}>{t('deviceDetail.manageAccess')}</PageLink>
    </Card>
  )
}

/**
 * The device page.
 *
 * Normally a route: it reads its entity from the URL and navigates away when
 * you leave. It is ALSO embedded by the wall dashboard as an overlay, which
 * has no URL of its own — so both inputs are overridable by prop.
 *
 * Nesting a second Router was the obvious way to embed it and is not allowed:
 * React Router v6 throws on a <Router> inside a <Router>. Two optional props
 * are cheaper than a fork of 1,500 lines, and keep one implementation of the
 * device page for both surfaces.
 *
 * @param {string}   [entityId]  overrides the :entityId route param
 * @param {Function} [onExit]    called instead of navigating away
 */
function DeviceDetailBody({ entityId: entityIdProp, onExit } = {}) {
  const t = useT()
  const { entityId: entityIdParam } = useParams()
  const entityId = entityIdProp ?? entityIdParam
  const _navigate = useNavigate()
  // Embedded: hand the intended destination to the host and let it decide.
  // The wall re-targets a sibling device into the same overlay and treats
  // anything else as "close" — navigating the real router would yank the user
  // off the wall entirely.
  const navigate = onExit ? ((to) => onExit(to)) : _navigate
  // Subscribe ONLY to the entity for this page, not the whole entities
  // array. Before, a media_player ticking media_position (or any unrelated
  // light flicker) re-rendered this page — and re-rendering this page for
  // a media_player with 100+ source apps cost serious time per pass.
  // With the targeted selector, we re-render only when *this* entity's
  // reference changes (which the optimized updateEntityState only does
  // when state or a tracked attr actually moved).
  const liveEntity     = useDeviceStore(s => s.entities.find(e => e.entity_id === entityId) ?? null)
  const storeRooms     = useDeviceStore(s => s.rooms)
  const hiddenEntities = useDeviceStore(s => s.hiddenEntities)
  const hideEntity     = useDeviceStore(s => s.hideEntity)
  const unhideEntity   = useDeviceStore(s => s.unhideEntity)
  // Narrow selectors for uiStore + suggestionStore — destructuring would
  // re-render on every toast spawn / suggestion fetch flip.
  const addToast        = useUIStore(s => s.addToast)
  const suggestions     = useSuggestionStore(s => s.suggestions)
  const fetchSuggestions = useSuggestionStore(s => s.fetch)
  useEffect(() => { if (suggestions.length === 0) fetchSuggestions() }, [])

  const [details, setDetails] = useState(null)
  const [detailsLoadFailed, setDetailsLoadFailed] = useState(false)
  const [allRooms, setAllRooms] = useState(null)   // lazy: only fetched when user opens edit-room
  const [showRename, setShowRename] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState('controls')
  const [editingRoom, setEditingRoom] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Parent IR blaster — fetched lazily when the entity is IR-linked so
  // the IR codeset card can show the blaster name + status alongside
  // codeset info. Always reflects the canonical registry name (renames
  // from the Blasters admin UI flow through immediately on next mount).
  const [parentBlaster, setParentBlaster] = useState(null)

  // (liveEntity is already pulled via the narrow selector above.)

  // Physical-device group this entity belongs to (if any). When the entity is
  // a non-primary sibling (e.g. sensor.switcher_boiler_power), the group's
  // name and primary entity drive the device-level identity surfaced at the
  // top of the page — "Switcher Boiler" instead of "Switcher Boiler Power".
  // Direct field subscription so this re-renders on group fetches.
  const groupByEntityId = useDeviceStore(s => s.groupByEntityId)
  const groupById       = useDeviceStore(s => s.groupById)
  const group           = groupById[groupByEntityId[entityId]] || null
  const isGroupPrimary  = group ? group.primary_entity_id === entityId : false
  const isSiblingView   = !!(group && !isGroupPrimary)

  // IR entities (ir.<id>) don't have HA-side details — synthesize from the
  // store entity so the page renders rather than 404-ing.
  const isIrTarget = entityId?.startsWith('ir.')

  // Background details fetch — does NOT block first paint. The Controls tab
  // renders from `liveEntity` immediately; details only feed the Info tab and
  // the secondary widgets (diagnostics, siblings, automations) which were
  // previously gating the entire page on a 3+ HA-round-trip backend call.
  const load = async ({ background = true } = {}) => {
    try {
      if (isIrTarget) {
        // IR-only: synthesize a details-shaped object so the Info tab can render.
        if (liveEntity) {
          const ir = liveEntity._irDevice
          setDetails({
            state: liveEntity.state,
            last_changed: liveEntity.last_changed,
            attributes: { friendly_name: liveEntity.friendly_name || liveEntity.display_name },
            domain_meta: {},
            diagnostics: {},
            sibling_entities: [],
            automations_using: [],
            ha_device: ir ? { manufacturer: ir.brand || null, model: ir.type } : null,
          })
        }
        return
      }
      const d = await getEntityDetails(entityId).catch(() => null)
      if (d) {
        setDetails(d)
        setDetailsLoadFailed(false)
      } else {
        // Backend returned 404/502 — record the failure so the render below
        // can show a "Couldn't load this device" page instead of an endless
        // skeleton when there's no liveEntity to fall back on either.
        setDetailsLoadFailed(true)
      }
    } catch (e) {
      setDetailsLoadFailed(true)
      if (!background) addToast(e.message || t('deviceDetail.failedToLoad'), 'error')
    }
  }

  // Fire details fetch in the background. No await, no setLoading gate —
  // the page renders immediately from the live store entity. When details
  // arrive, the Info tab and diagnostics panels fill in.
  useEffect(() => {
    setDetails(null)
    setDetailsLoadFailed(false)
    load({ background: true })
  }, [entityId])

  // Parent blaster lookup — fires whenever the entity is IR-linked and
  // the codeset declares a blaster_id. Lazy, doesn't block render; the
  // chip just appears once the row resolves. Cached server-side, so
  // re-mounts of the same device are cheap.
  useEffect(() => {
    const ir = liveEntity?._linkedIr || (liveEntity?._irDevice) || null
    const bid = ir?.blaster_id
    if (!bid) { setParentBlaster(null); return }
    let alive = true
    getIrBlaster(bid)
      .then((b) => { if (alive) setParentBlaster(b) })
      .catch(() => { if (alive) setParentBlaster(null) })
    return () => { alive = false }
  }, [liveEntity?._linkedIr, liveEntity?._irDevice])

  // Rooms list — read from the deviceStore (already loaded by Dashboard /
  // fetchAll). Only fall back to a network fetch when the user opens the
  // edit-room mode and the store happens to be empty. This drops one HA WS
  // round-trip from every device page mount.
  const rooms = allRooms ?? storeRooms ?? []
  useEffect(() => {
    if (editingRoom && allRooms == null && (!storeRooms || storeRooms.length === 0)) {
      getAllRooms()
        .then(r => setAllRooms(Array.isArray(r) ? r : r.rooms ?? []))
        .catch(() => setAllRooms([]))
    }
  }, [editingRoom, allRooms, storeRooms])

  const handleRefresh = async () => {
    setRefreshing(true)
    // Force a REAL device poll (not just a cache re-read) and, if the device
    // disagrees with what Ziggy last asked for, run one recovery pass. This is
    // the manual counterpart to automatic self-heal — the old refresh only
    // re-fetched the cached (possibly wrong) state.
    try {
      const res = await selfHealRefresh(entityId)
      if (res?.outcome === 'recovered') {
        addToast(t('deviceDetail.refreshRecovered'), 'success')
      } else if (res?.outcome === 'failed') {
        addToast(t('deviceDetail.refreshFailed'), 'error')
      }
    } catch { /* fall through to a plain reload */ }
    await load({ background: false })
    setRefreshing(false)
  }

  // Trigger #2 for the fixer: the refresh button above tries ONE mechanical
  // nudge. This hands the same device to the assistant, which can actually
  // investigate (is it silent? did a routine turn it off? is the whole home
  // wedged?) and explain it. Seeds the chat as if the user had typed it.
  const handleAskFixer = () => {
    navigate('/chat', {
      state: { prefill: buildFixerQuestion(displayName, getLang()) },
    })
  }

  const handleToggle = async () => {
    if (!liveEntity) return
    try {
      await sendDeviceCommand(liveEntity, 'toggle')
    } catch (e) { addToast(e.message || t('deviceDetail.controlFailed'), 'error') }
  }

  const handleService = async (service, data) => {
    if (!liveEntity) return
    try {
      await callHaService(liveEntity.domain, service, { entity_id: entityId, ...data })
    } catch { addToast(t('deviceDetail.controlFailed'), 'error') }
  }

  const handleAssignRoom = async (roomId) => {
    try {
      if (isIrTarget) {
        // IR pseudo-entities (ir.<id>) are NOT HA entities — routing them
        // through the area registry makes HA reject the unknown entity, which
        // surfaces to the user as "upstream unavailable" (a 502). Persist the
        // room slug on the IR record instead (same path the Devices page uses).
        const room = (rooms || []).find(r => (r.id ?? r.area_id ?? r.name) === roomId)
        const slug = roomId == null ? '' : (room ? normRoomSlug(room.name || '') : roomId)
        await patchIrDevice(entityId.slice(3), { room: slug })
      } else {
        await assignEntityToArea(entityId, roomId)
      }
      addToast(roomId ? t('deviceDetail.roomAssigned') : t('deviceDetail.removedFromRoom'), 'success')
      // The room display reads from the STORE (an HA entity's area, or an IR
      // device's own room slug on liveEntity._irDevice) — load() only refreshes
      // the local details object, so without a store refresh currentRoom stays
      // stale and the change appears not to take. force:true bypasses the
      // inflight-dedupe so we always pull the just-written room.
      try { await useDeviceStore.getState().fetchAll({ force: true }) } catch {}
      load({ background: true })   // refresh details in background, don't block UI
    } catch (e) { addToast(e.message || t('common.failed'), 'error') }
  }

  const isHidden = hiddenEntities.has(entityId)

  const handleToggleHide = () => {
    if (isHidden) {
      unhideEntity(entityId)
      addToast(t('deviceDetail.deviceVisibleAgain'), 'success')
    } else {
      hideEntity(entityId)
      addToast(t('deviceDetail.deviceHidden'), 'success')
    }
  }

  // Tile curation (icon / promote-to-tile). Persists the pref, then refreshes
  // so the change is visible. Errors surface a toast instead of being silently
  // swallowed (a failed save used to look like "nothing happened").
  const applyTilePref = async (targetId, opts) => {
    try {
      await setTilePref(targetId, opts)
      await useDeviceStore.getState().fetchAll({ force: true })
      // Reload THIS detail view too — the sibling toggles are controlled by
      // the detail's own entity data (group/sibling_entities), so without this
      // the <Toggle checked> snapped back to the stale value ("can't toggle").
      load({ background: true })
    } catch (e) {
      addToast(e?.userMessage || e?.message || t('deviceDetail.tilePrefFailed'), 'error')
    }
  }

  // Optimistic show-as-tile toggle: flip the switch instantly, persist, then
  // reconcile — reverting on failure. (The switch is a controlled Radix
  // component, so without a local optimistic value it can't move until the
  // store round-trips; combined with the earlier onChange→onCheckedChange fix,
  // this makes it feel instant AND actually work.)
  const [pendingTile, setPendingTile] = useState({})
  const toggleTile = async (eid, checked) => {
    setPendingTile(p => ({ ...p, [eid]: checked }))
    try {
      await setTilePref(eid, { is_tile: checked })
      await useDeviceStore.getState().fetchAll({ force: true })
      load({ background: true })
    } catch (e) {
      addToast(e?.userMessage || e?.message || t('deviceDetail.tilePrefFailed'), 'error')
    } finally {
      setPendingTile(p => { const n = { ...p }; delete n[eid]; return n })
    }
  }

  // Device classification override (which entity is MAIN, the card KIND).
  const applyClassification = async (opts) => {
    try {
      const sig = group?.signature
      if (!sig) { addToast(t('common.failed'), 'error'); return }
      await setClassification(sig, opts)
      await useDeviceStore.getState().fetchAll({ force: true })
      load({ background: true })
      addToast(t('common.saved') || 'Saved', 'success')
    } catch (e) {
      addToast(e?.userMessage || e?.message || t('common.failed'), 'error')
    }
  }

  const handleDelete = async (alsoRemoveDevice) => {
    setDeleting(true)
    try {
      // Pure-IR device: there's no HA entity to remove, so dispatch to the
      // ir_manager's delete endpoint instead. Hybrid (HA + linked IR) still
      // goes through deleteHaEntity — the linked IR codeset can be cleaned
      // separately from the IR Devices panel if the user wants it gone.
      if (facts.isIr && facts.irId) {
        await deleteIrDevice(facts.irId)
        addToast(t('deviceDetail.irRemoved'), 'success')
      } else {
        const res = await deleteHaEntity(entityId, !!alsoRemoveDevice)
        if (res?.ha_device_removed) {
          addToast(t('deviceDetail.deviceRemovedHa'), 'success')
        } else if (res?.ha_removed) {
          addToast(t('deviceDetail.entityRemovedHa'), 'success')
        } else {
          addToast(t('deviceDetail.deviceRemovedZiggy'), 'success')
        }
      }
      // Optimistic local drop — the WS `entity_removed` broadcast lands a
      // moment later for other tabs; this client is already navigating away
      // so we apply the change inline so the Devices list never re-renders
      // with the deleted row.
      try { useDeviceStore.getState().removeEntity(entityId) } catch {}
      // Force-refresh the store so the deleted entity / device drops out of
      // every list immediately, without waiting for the 60s background
      // reconciliation loop.
      // Refresh the store, but let the in-flight dedupe absorb rapid
      // repeat clicks. Using `force: true` previously meant N taps fired
      // N parallel backend fan-outs, each opening fresh HA WebSocket
      // handshakes — enough to overload HA and knock the long-lived
      // ha_subscriber WS off the air for a few seconds.
      try { await useDeviceStore.getState().fetchAll() } catch {}
      setShowDelete(false)
      navigate('/devices')
    } catch (e) {
      addToast(e.message || t('deviceDetail.failedToDelete'), 'error')
      setDeleting(false)
    }
  }

  const handleRename = async (newName) => {
    // Goes through the api.js helper so the request gets the Bearer token,
    // request-id tracing, and (when applicable) Fly relay routing. Backend
    // both persists a local display-name override AND pushes name_by_user
    // to HA's entity registry + device registry, so HA-side surfaces stay
    // in sync.
    try {
      await renameHaEntity(entityId, newName)
      addToast(t('deviceDetail.renamed'), 'success')
      setShowRename(false)

      // Optimistic local update: patch the store immediately so the user
      // sees the new name everywhere on the next render — instead of
      // waiting for the next fetchAll. Previously this gap was producing
      // a "rename appears one cycle late" feel: each rename only became
      // visible after the *next* action triggered a fetch.
      try { useDeviceStore.getState().renameEntity(entityId, newName) } catch {}

      // Force a full store refresh too so the canonical truth (group_name
      // from device_registry, etc.) lands. The optimistic update covers
      // the common case; this catches the multi-entity-group and Rooms
      // page surfaces that don't read display_name/friendly_name directly.
      try { await useDeviceStore.getState().fetchAll({ force: true }) } catch {}

      load({ background: true })
    } catch (e) {
      addToast(e.message || t('deviceDetail.renameFailed'), 'error')
    }
  }

  // Render gating:
  //   - skeleton while we're still fetching and have nothing to show
  //   - "couldn't load" page when the fetch failed AND no store entity
  //     (catches every HA-side change we don't have a more specific UI for)
  //   - otherwise render the normal page below
  if (!liveEntity && !details) {
    if (detailsLoadFailed) {
      return (
        <div style={{ maxWidth: 'var(--page-max-w-narrow)', margin: '0 auto', padding: '24px 20px 24px' }}>
          <div style={{ marginBottom: 12 }}>
            <button onClick={() => navigate(-1)} className="z-icon-btn" aria-label={t('deviceDetail.back')}>
              <ArrowLeft size={20} strokeWidth={1.75} className="icon-flip-rtl" />
            </button>
            <h1 className="z-display" style={{ margin: '12px 0 0', overflowWrap: 'anywhere' }}>
              {t('deviceDetail.couldntLoad')}
            </h1>
            <p className="z-code" style={{ fontSize: 13, color: 'var(--ink-mute)', margin: '4px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {entityId}
            </p>
          </div>
          <div className="z-card" style={{ padding: 12 }}>
            <p style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.4, margin: 0 }}>
              {t('deviceDetail.couldntLoadHint')}
            </p>
            <button
              onClick={() => navigate('/devices')}
              className="z-btn-secondary"
              style={{ marginTop: 16 }}
            >{t('deviceDetail.backToDevices')}</button>
          </div>
        </div>
      )
    }
    // Skeleton — static placeholders, no pulse loop; the page fills in within
    // a network round-trip so an ambient animation buys nothing.
    return (
      <div style={{ maxWidth: 'var(--page-max-w-narrow)', margin: '0 auto', padding: '24px 20px 24px' }}>
        <div style={{ marginBottom: 24 }}>
          <button onClick={() => navigate(-1)} className="z-icon-btn" aria-label={t('deviceDetail.back')}>
            <ArrowLeft size={20} strokeWidth={1.75} className="icon-flip-rtl" />
          </button>
          <div style={{ height: 34, width: 160, marginTop: 12, borderRadius: 'var(--r-chip)', background: 'var(--surface-2)' }} />
        </div>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ height: 96, marginBottom: 12, borderRadius: 'var(--r-card)', background: 'var(--surface-2)' }} />
        ))}
      </div>
    )
  }

  // Ghost path: backend flagged this entity as removed from HA but still
  // present in Ziggy's device registry. Render a dedicated cleanup page
  // instead of the normal remote — the controls are meaningless and the
  // user just needs a one-tap way to drop the stale row.
  if (details?.ghost) {
    return <GhostDevicePage details={details} entityId={entityId} navigate={navigate} addToast={addToast} />
  }

  // Use the live entity to drive immediate render; details fills in secondary
  // sections (diagnostics, ha_device, siblings, automations_using) when it
  // arrives. All `details`-derived fields safely default to empty.
  const ha_device         = details?.ha_device || null
  const sibling_entities  = details?.sibling_entities || []
  const automations_using = details?.automations_using || []
  const attributes        = details?.attributes || liveEntity || {}
  const diagnostics = {
    ...(details?.diagnostics || {}),
    last_changed: details?.last_changed ?? details?.diagnostics?.last_changed ?? liveEntity?.last_changed,
  }
  const entity = liveEntity ?? { entity_id: entityId, domain: entityId.split('.')[0], state: details?.state, ...attributes }
  const facts = deviceFacts(entity)
  const isOn = facts.isOn
  const isToggleable = facts.meta.toggle
  const stateLabel = facts.stateLabel
  const meta = facts.meta
  // When the entity is the primary of a multi-entity device, prefer the
  // group's HA device-registry name — it's the "Switcher Boiler" the user
  // recognises, not the per-entity friendly_name like "Switcher Boiler Power".
  // For sibling views we keep showing the entity's own name; the group name
  // is surfaced separately as the parent-device crumb.
  const groupName = group?.name || null
  const displayName = (isGroupPrimary && groupName)
    ? groupName
    : (facts.name || attributes.friendly_name || entityId)
  // IR pseudo-entities are never listed in an HA area's entities[], so the
  // registry match below never finds them → the header/Info tab read "No Room"
  // even when the device IS assigned. Resolve an IR device's room from its own
  // room slug (the same value the Rooms page groups it by).
  const currentRoom = (() => {
    if (facts.isIr) {
      const slug = facts.linkedIr?.room || entity?.room || ''
      if (!slug) return null
      return rooms.find(r => (r.id ?? r.area_id) === slug || normRoomSlug(r.name || '') === slug)
        || { id: slug, name: slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }
    }
    return rooms.find(r => (r.entities || []).includes(entityId))
  })()

  // Filter siblings to show only useful ones (hide update/button/number noise)
  const _HIDDEN_SIBLING_DOMAINS = new Set(['button', 'number', 'select', 'update'])
  // When this entity is part of a frontend-known group, prefer the group's
  // entity list (which carries the `role` marker: primary / metric /
  // diagnostic). Backend `sibling_entities` still arrives via the details
  // call and supplies the live state for each — we merge by entity_id.
  const _groupEntities = group?.entities || []
  const _siblingStateMap = Object.fromEntries(sibling_entities.map(s => [s.entity_id, s]))
  const allSiblings = _groupEntities.length > 0
    ? _groupEntities.map((ge) => {
        const live = _siblingStateMap[ge.entity_id] || {}
        return {
          entity_id:     ge.entity_id,
          domain:        ge.domain || (ge.entity_id || '').split('.')[0],
          friendly_name: live.friendly_name || ge.display_name || ge.entity_id,
          state:         live.state ?? ge.state,
          unit:          live.unit ?? ge.unit,
          device_class:  live.device_class ?? ge.device_class,
          role:          ge.role,
          isPrimary:     ge.role === 'primary',
          is_tile:       !!ge.is_tile,
          hidden:        !!ge.hidden,
          icon:          ge.icon || null,
        }
      })
    : sibling_entities.map(s => ({ ...s, isPrimary: false }))
  const usefulSiblings = allSiblings
    .filter(s => !_HIDDEN_SIBLING_DOMAINS.has(s.domain))
    .filter(s => s.entity_id !== entityId)  // never list the current entity as its own sibling

  const hasDiagnostics = diagnostics.battery != null || diagnostics.lqi != null || diagnostics.rssi != null ||
    diagnostics.last_changed || diagnostics.last_seen || diagnostics.firmware

  // Tabs: every device gets Control + Info now (sensors get the SensorRemote
  // as their Control view, which is read-only but still useful).
  const hasControls   = facts.meta.controllable || facts.kind !== KIND.UNKNOWN
  const showControls  = !hasControls || activeTab === 'controls'
  const showData      = !hasControls || activeTab === 'data'

  // One 15px line under the title: room · kind. Skips whichever half is
  // missing so it never reads "· Light".
  const subtitle = [currentRoom?.name, meta?.label].filter(Boolean).join(' · ')

  return (
    <div style={{ maxWidth: 'var(--page-max-w-narrow)', margin: '0 auto', padding: '24px 20px 24px' }}>

      {/* ── Header — back / refresh row, then ONE Large Title with the
            room · kind line under it. ── */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <button
            onClick={() => navigate(-1)}
            className="z-icon-btn"
            aria-label={t('deviceDetail.back')}
          >
            <ArrowLeft size={20} strokeWidth={1.75} className="icon-flip-rtl" />
          </button>
          <button
            onClick={handleRefresh}
            className="z-icon-btn"
            aria-label={t('deviceDetail.refresh')}
            title={t('deviceDetail.refresh')}
            disabled={refreshing}
          >
            <RefreshCw size={20} strokeWidth={1.75} className={refreshing ? 'z-spin' : undefined} />
          </button>
        </div>

        {/* Parent-device crumb when viewing a non-primary sibling. Tapping
            jumps to the primary entity's page — the canonical control
            surface for the physical device. */}
        {isSiblingView && group?.primary_entity_id && (
          <button
            onClick={() => navigate(`/devices/${encodeURIComponent(group.primary_entity_id)}`)}
            style={{
              fontSize: 13, color: 'var(--ink-mute)', fontFamily: 'inherit',
              background: 'transparent', border: 'none', padding: 0, minHeight: 40, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4,
            }}
            title={t('devices.openParentDevice')}
          >
            <ArrowLeft size={16} strokeWidth={1.75} className="icon-flip-rtl" />
            <span dir="auto">{groupName || t('devices.parentDevice')}</span>
          </button>
        )}
        <h1 dir="auto" className="z-display" style={{
          margin: isSiblingView && group?.primary_entity_id ? 0 : '12px 0 0',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          overflowWrap: 'anywhere',
        }}>
          {displayName}
        </h1>
        {subtitle && (
          <p dir="auto" style={{
            fontSize: 13, lineHeight: '20px', color: 'var(--ink-mute)', margin: '4px 0 0',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {subtitle}
          </p>
        )}
      </div>

      {/* ── Primary control — the one thing most people came to do. A
            toggleable device gets its switch right under the title, before the
            tabs; everything else starts at the tabs. Disabled (not hidden)
            when the device can't be reached, so the layout doesn't jump. ── */}
      {isToggleable && (
        <div className="z-card" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          minHeight: 44, padding: '10px 14px', marginBottom: 12,
        }}>
          <span dir="auto" style={{ fontSize: 15, fontWeight: 600, color: facts.isAvailable ? 'var(--ink)' : 'var(--ink-mute)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {facts.isAvailable ? stateLabel : t('deviceDetail.unavailable')}
          </span>
          <Toggle
            checked={!!isOn}
            onCheckedChange={handleToggle}
            disabled={!facts.isAvailable}
            aria-label={displayName}
          />
        </div>
      )}

      {/* ── Tab switcher (only when there's something to control). Segmented
            control: 44px buttons, active = surface + hairline, no inversion. ── */}
      {hasControls && (
        <div role="tablist" style={{
          display: 'flex', gap: 4, padding: 3, marginBottom: 12,
          background: 'var(--surface-2)', borderRadius: 'var(--r-card)',
        }}>
          {[
            { id: 'controls', label: t('deviceDetail.tabControls') },
            { id: 'data',     label: t('deviceDetail.tabInfo') },
          ].map(tab => {
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1, minHeight: 40, padding: '0 12px', borderRadius: 'var(--r-ctl)',
                  background: active ? 'var(--surface)' : 'transparent',
                  color: active ? 'var(--ink)' : 'var(--ink-mute)',
                  border: '0.5px solid ' + (active ? 'var(--line)' : 'transparent'),
                  cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  transition: 'background var(--dur-state) var(--ease-standard), color var(--dur-state) var(--ease-standard), border-color var(--dur-state) var(--ease-standard)',
                }}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      )}

      {/* ── Identity strip + Control surface ── */}
      {showControls && (
        <>
          <div className="z-card" style={{ padding: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 'var(--r-ctl)',
                background: isOn
                  ? `color-mix(in srgb, ${facts.tint} 14%, var(--surface-2))`
                  : 'var(--surface-2)',
                color: isOn ? facts.tint : 'var(--ink-mute)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <DeviceIcon kind={facts.kind} customIcon={entity.icon} size={20} fill />
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(facts.isIr || facts.hasIr || !facts.isAvailable) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {facts.isIr && <span className="z-chip">IR</span>}
                    {facts.hasIr && !facts.isIr && <span className="z-chip">{t('deviceDetail.irPlusWifi')}</span>}
                    {!facts.isAvailable && <span className="z-chip" style={{ color: 'var(--warn-text)' }}>{t('deviceDetail.unavailable')}</span>}
                  </div>
                )}
              </div>
              <button
                onClick={() => setShowRename(true)}
                className="z-icon-btn"
                title={t('deviceDetail.rename')}
                aria-label={t('deviceDetail.rename')}
              >
                <Pencil size={18} strokeWidth={1.75} />
              </button>
            </div>

            {/* Ask Ziggy about THIS device. Louder when the device is actually
                unreachable — that's the moment the user wants it. Hidden on the
                wall, where /chat isn't a destination the overlay can reach. */}
            {!onExit && (
              <button
                onClick={handleAskFixer}
                className="z-btn-secondary"
                style={{
                  marginTop: 8, width: '100%', minHeight: 34, fontSize: 13,
                  background: facts.isAvailable
                    ? undefined
                    : 'color-mix(in srgb, var(--warn) 12%, var(--surface))',
                  color: facts.isAvailable ? 'var(--ink-mute)' : 'var(--warn-text)',
                }}
              >
                <Zap size={18} strokeWidth={1.75} />
                {t('deviceDetail.askFixer')}
              </button>
            )}
          </div>

          {/* Per-kind control surface — passes relevant automations +
              suggestion to the kind-specific remote (used by AC for the
              Schedule + AI cards). Gate on facts.isAvailable (not the raw HA
              state): a merged IR+Wi-Fi device is still controllable via IR when
              its Wi-Fi side is 'unavailable' (TV off), so its remote must still
              render instead of the page going blank. */}
          {facts.isAvailable && (() => {
            // Pick automations that schedule this entity (time-triggered).
            // automations_using is the list of automations referencing this
            // entity; we filter to ones with a time trigger for the
            // Schedule card.
            const scheduledAutos = (automations_using || []).filter(a => {
              const t = a.trigger || a.triggers?.[0]
              if (!t) return false
              if (t.platform === 'time' || t.type === 'time') return true
              if (t.platform === 'sun') return true
              return false
            })
            // Pick a pending suggestion whose user_message mentions this
            // device or its room. Loose match — the suggestion engine doesn't
            // carry entity_id directly, so we match on name + room.
            const lowerName = (displayName || '').toLowerCase()
            const lowerRoom = (currentRoom?.name || '').toLowerCase()
            const relevantSuggestion = suggestions.find(s => {
              if (s.status !== 'pending') return false
              const msg = (s.user_message || '').toLowerCase()
              return (lowerName && msg.includes(lowerName)) ||
                     (lowerRoom && msg.includes(lowerRoom))
            })
            return (
              <div className="z-card" style={{ padding: 12, marginBottom: 12 }}>
                <DeviceRemote
                  entity={{ ...attributes, ...entity, entity_id: entityId }}
                  automations={scheduledAutos}
                  suggestion={relevantSuggestion}
                />
              </div>
            )
          })()}

          {/* "More Commands" panel removed — the curated remote (with
              vendor adapters + paired-remote fallback) now exposes all
              meaningful actions inline; the dynamic catalog was mostly
              noise (raw HA service names users couldn't interpret). */}

          {/* Camera live view — keep as separate panel below the remote */}
          {entity.domain === 'camera' && <CameraPanel entityId={entityId} navigate={navigate} />}

          {/* Entity ID footer */}
          <p className="z-code" style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entityId}{facts.irId ? ` · ir:${facts.irId}` : ''}
          </p>
        </>
      )}

      {/* ── Diagnostics ── */}
      {showData && hasDiagnostics && (
        <Card className="p-4 mb-3">
          <SectionTitle>{t('deviceDetail.diagnostics')}</SectionTitle>

          {diagnostics.battery != null && (
            <div className="mb-3">
              <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 8 }}>{t('deviceDetail.battery')}</div>
              <BatteryBar level={diagnostics.battery} unit={diagnostics.battery_unit} />
            </div>
          )}

          {(diagnostics.lqi != null || diagnostics.rssi != null) && (
            <div className="mb-3">
              <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 8 }}>{t('deviceDetail.signal')}</div>
              <SignalBars lqi={diagnostics.lqi} rssi={diagnostics.rssi} />
            </div>
          )}

          <div className="divide-y divide-line">
            <DiagRow label={t('deviceDetail.lastChanged')}>
              <span className="z-mono" style={{ fontSize: 13, color: 'var(--ink)' }}>
                <TimeAgo iso={diagnostics.last_changed} />
              </span>
            </DiagRow>
            <DiagRow label={t('deviceDetail.lastSeen')}>
              {diagnostics.last_seen && (
                <span className="z-mono" style={{ fontSize: 13, color: 'var(--ink)' }}>
                  <TimeAgo iso={diagnostics.last_seen} />
                </span>
              )}
            </DiagRow>
            <DiagRow label={t('deviceDetail.firmware')} value={diagnostics.firmware} />
          </div>
        </Card>
      )}

      {/* ── Sensor history chart ── numeric sensors only. */}
      {showData && (
        facts.kind === KIND.TEMPERATURE ||
        facts.kind === KIND.HUMIDITY ||
        facts.kind === KIND.POWER_METER ||
        (facts.kind === KIND.SENSOR && !Number.isNaN(parseFloat(liveEntity?.state)))
      ) && (
        <SensorHistoryChart
          entityId={entityId}
          unitFallback={liveEntity?.attributes?.unit_of_measurement}
        />
      )}

      {/* ── HA Device info ── */}
      {showData && ha_device && (ha_device.manufacturer || ha_device.model) && (
        <Card className="p-4 mb-3">
          <SectionTitle>{t('deviceDetail.hardware')}</SectionTitle>
          <div className="divide-y divide-line">
            <DiagRow label={t('deviceDetail.manufacturer')} value={ha_device.manufacturer} />
            <DiagRow label={t('deviceDetail.model')} value={ha_device.model} />
            <DiagRow label={t('deviceDetail.firmware')} value={ha_device.sw_version} />
            <DiagRow label={t('deviceDetail.hardwareRev')} value={ha_device.hw_version} />
          </div>
        </Card>
      )}

      {/* ── IR codeset info — shown for both pure IR and IR+HA hybrid ── */}
      {showData && facts.linkedIr && (
        <Card className="p-4 mb-3">
          <SectionTitle>{t('deviceDetail.irCodeset')}</SectionTitle>
          <div className="divide-y divide-line">
            {/* Parent blaster row — only renders once the registry lookup
                resolves (lazy). Status chip mirrors the Blasters admin UI
                so the same green/yellow/red signals appear in both surfaces.
                Tapping the row could deep-link to admin in a later pass. */}
            {parentBlaster && (
              <DiagRow label={t('deviceDetail.blaster')}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span dir="auto" style={{ fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {parentBlaster.name}
                  </span>
                  <span className="z-chip" style={{
                    flexShrink: 0,
                    color:
                      parentBlaster.status === 'online' ? 'var(--ok-text)'   :
                      parentBlaster.status === 'stale'  ? 'var(--warn-text)' :
                                                          'var(--err-text)',
                  }}>
                    {parentBlaster.status === 'online' ? t('deviceDetail.blasterOnline')
                      : parentBlaster.status === 'stale' ? t('deviceDetail.blasterStale')
                      : t('deviceDetail.blasterUnreachable')}
                  </span>
                </span>
              </DiagRow>
            )}
            <DiagRow label={t('deviceDetail.type')} value={facts.linkedIr.type} />
            <DiagRow label={t('deviceDetail.brand')} value={facts.linkedIr.brand || '—'} />
            <DiagRow label={t('deviceDetail.commandsLearned')} value={`${(facts.linkedIr.learned_commands || []).length}`} />
            <DiagRow label={t('deviceDetail.irId')}>
              <span className="z-code" style={{ fontSize: 13, color: 'var(--ink)' }}>{facts.linkedIr.id}</span>
            </DiagRow>
            {facts.linkedIr.assumed_state && (
              <DiagRow label={t('deviceDetail.assumedState')} value={facts.linkedIr.assumed_state} />
            )}
          </div>
        </Card>
      )}

      {/* ── Capability list — what this device can actually do ── */}
      {showData && facts.capabilities.size > 0 && (
        <Card className="p-4 mb-3">
          <SectionTitle>{t('deviceDetail.capabilities')}</SectionTitle>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {[...facts.capabilities].map(c => (
              <span key={c} className="z-chip">{c.replace(/_/g, ' ')}</span>
            ))}
          </div>
        </Card>
      )}

      {/* ── Sibling entities — every HA entity living on the same physical
            device. The primary entity is highlighted so the user always
            knows which one drives the main card / control surface. ── */}
      {showData && usefulSiblings.length > 0 && (
        <FoldSection title={groupName ? t('deviceDetail.siblingsOn', { name: groupName }) : t('deviceDetail.alsoOnDevice')}>
          <div className="space-y-1">
            {usefulSiblings.map(sib => (
              <PageLink
                key={sib.entity_id}
                to={`/devices/${encodeURIComponent(sib.entity_id)}`}
                className="flex items-center justify-between gap-3 hover:bg-surface-2 transition-colors group"
                style={{ minHeight: 48, padding: '8px 12px', borderRadius: 'var(--r-ctl)', textDecoration: 'none' }}
              >
                <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
                  <span style={{ color: 'var(--ink-mute)', display: 'flex', flexShrink: 0 }}>
                    <DeviceIcon
                      kind={getKind({ entity_id: sib.entity_id, domain: sib.domain, device_class: sib.device_class, friendly_name: sib.friendly_name })}
                      customIcon={sib.icon}
                      size={20}
                    />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <p dir="auto" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sib.friendly_name}</span>
                      {sib.isPrimary && (
                        <span className="z-chip">{t('deviceDetail.primary')}</span>
                      )}
                    </p>
                    <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 2 }}>
                      {sib.state ?? '—'}{sib.unit ? ` ${sib.unit}` : ''}
                      {sib.device_class ? ` · ${sib.device_class}` : ''}
                    </p>
                  </div>
                </div>
                <ChevronRight size={18} strokeWidth={1.75} className="icon-flip-rtl text-ink-faint group-hover:text-ink-mute transition-colors" style={{ flexShrink: 0 }} />
              </PageLink>
            ))}
          </div>
        </FoldSection>
      )}

      {/* ── Automations using this device ── */}
      {showData && automations_using.length > 0 && (
        <Card className="p-4 mb-3">
          <SectionTitle>{t('deviceDetail.usedInAutomations')}</SectionTitle>
          <div className="space-y-1">
            {automations_using.map(auto => (
              <PageLink
                key={auto.id}
                to="/actions"
                className="flex items-center justify-between gap-3 hover:bg-surface-2 transition-colors group"
                style={{ minHeight: 40, padding: '8px 12px', borderRadius: 'var(--r-ctl)', textDecoration: 'none' }}
              >
                <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
                  <Zap size={18} strokeWidth={1.75} className={cn('shrink-0', auto.enabled ? 'text-ink' : 'text-ink-faint')} />
                  <p dir="auto" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{auto.name}</p>
                </div>
                <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
                  <Badge variant={auto.enabled ? 'success' : 'default'} size="sm">
                    {auto.enabled ? t('deviceDetail.autoOn') : t('deviceDetail.autoOff')}
                  </Badge>
                  <ChevronRight size={18} strokeWidth={1.75} className="icon-flip-rtl text-ink-faint group-hover:text-ink-mute transition-colors" />
                </div>
              </PageLink>
            ))}
          </div>
        </Card>
      )}

      {/* ── Room assignment — locked by default to prevent fat-finger
          reassignment. Tap the lock to enter edit mode. ── */}
      {showData && (
      <Card className="p-4 mb-3">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 40, marginBottom: 12 }}>
          <p className="z-headline">{t('deviceDetail.room')}</p>
          {/* The lock is a switch: off = read-only summary, on = the radio
              list. Label stays "Edit" in both states; the list itself is
              the feedback. */}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 12, cursor: 'pointer', minHeight: 40 }}
            title={editingRoom ? t('deviceDetail.editRoomLock') : t('deviceDetail.editRoomUnlock')}>
            <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>{t('deviceDetail.editRoomEdit')}</span>
            <Toggle
              checked={editingRoom}
              onCheckedChange={(v) => setEditingRoom(!!v)}
              aria-label={editingRoom ? t('deviceDetail.editRoomLock') : t('deviceDetail.editRoomUnlock')}
            />
          </label>
        </div>

        {!editingRoom ? (
          // Locked: read-only summary of the current assignment
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            minHeight: 40, padding: '8px 12px', borderRadius: 'var(--r-ctl)',
            background: 'var(--surface-2)', border: '0.5px solid var(--line)',
          }}>
            <Home size={18} strokeWidth={1.75} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />
            <span dir="auto" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
              {currentRoom?.name || t('deviceDetail.noRoom')}
            </span>
          </div>
        ) : (
          // Unlocked: full radio list. Selected = surface-2 fill + ink text,
          // never the accent.
          <div className="space-y-1" role="radiogroup">
            {[{ id: null, name: t('deviceDetail.noRoom'), none: true }, ...rooms].map(r => {
              const selected = r.none ? !currentRoom : currentRoom?.id === r.id
              return (
                <button
                  key={r.id ?? '__none'}
                  role="radio"
                  aria-checked={selected}
                  onClick={() => handleAssignRoom(r.none ? null : r.id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                    minHeight: 40, padding: '8px 12px', borderRadius: 'var(--r-ctl)',
                    background: selected ? 'var(--surface-2)' : 'transparent',
                    border: '0.5px solid ' + (selected ? 'var(--line)' : 'transparent'),
                    color: selected ? 'var(--ink)' : 'var(--ink-2)',
                    fontSize: 15, fontWeight: selected ? 600 : 400, fontFamily: 'inherit',
                    cursor: 'pointer', textAlign: 'start',
                    transition: 'background var(--dur-state) var(--ease-standard)',
                  }}
                  className={selected ? undefined : 'hover:bg-surface-2'}
                >
                  {r.none
                    ? <Home size={18} strokeWidth={1.75} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />
                    : <span className="z-dot" style={{ background: selected ? 'var(--ink)' : 'var(--line-2)', flexShrink: 0 }} />}
                  <span dir="auto" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                  {selected && <Check size={18} strokeWidth={1.75} style={{ color: 'var(--ink)', flexShrink: 0 }} />}
                </button>
              )
            })}
          </div>
        )}
      </Card>
      )}

      {/* ── Manage tiles (B: user curation — icon + promote siblings) ── */}
      {showData && group && (
      <FoldSection title={t('deviceDetail.tilesTitle')}>
        <div style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginBottom: 8 }}>{t('deviceDetail.tileIcon')}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            {ICON_CHOICES.map(name => {
              const tok = `icon:${name}`
              const active = (liveEntity?.icon || '') === tok
              return (
                <button key={name}
                  onClick={() => applyTilePref(entityId, { icon: tok })}
                  aria-pressed={active}
                  style={{ width: 40, height: 40, borderRadius: 'var(--r-ctl)', cursor: 'pointer', padding: 0, overflow: 'hidden',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
                    border: active ? '2px solid var(--ink)' : '0.5px solid var(--line)',
                    background: 'var(--surface-2)', color: 'var(--ink)',
                    transition: 'border-color var(--dur-state) var(--ease-standard)' }}
                ><DeviceIcon customIcon={tok} size={22} fill /></button>
              )
            })}
            <button
              onClick={() => applyTilePref(entityId, { clear_icon: true })}
              className="z-btn-secondary"
            >{t('deviceDetail.tileIconDefault')}</button>
          </div>
        </div>
        {group?.signature && allSiblings.length > 1 && (
          <div style={{ marginTop: 4 }}>
            {/* Which entity drives the card (Main control) */}
            {(() => {
              const CTRL = ['switch','light','climate','cover','lock','fan','media_player','valve','vacuum','humidifier','water_heater']
              const mains = allSiblings.filter(s => CTRL.includes(s.domain) || s.entity_id === group.primary_entity_id)
              if (mains.length < 2) return null
              return (
                <div style={{ marginBottom: 12 }}>
                  <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginBottom: 8 }}>{t('deviceDetail.mainControlHint')}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} role="radiogroup">
                    {mains.map(s => {
                      const isMain = s.entity_id === group.primary_entity_id
                      return (
                        <button key={s.entity_id} onClick={() => { if (!isMain) applyClassification({ main_entity: s.entity_id }) }}
                          role="radio" aria-checked={isMain}
                          style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, padding: '8px 12px', borderRadius: 'var(--r-ctl)',
                            cursor: isMain ? 'default' : 'pointer', textAlign: 'start', boxSizing: 'border-box', fontFamily: 'inherit',
                            background: 'var(--surface-2)',
                            border: isMain ? '2px solid var(--ink)' : '0.5px solid var(--line)',
                            transition: 'border-color var(--dur-state) var(--ease-standard)' }}>
                          <span dir="auto" style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.friendly_name}</span>
                          {isMain
                            ? <span className="z-chip" style={{ flexShrink: 0 }}>{t('deviceDetail.mainBadge')}</span>
                            : <span style={{ fontSize: 13, color: 'var(--ink-mute)', flexShrink: 0 }}>{t('deviceDetail.setAsMain')}</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })()}
            {/* Device type (card kind) */}
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginBottom: 8 }}>{t('deviceDetail.deviceTypeHint')}</p>
              <select value={group.card_kind || 'generic'} onChange={e => applyClassification({ card_kind: e.target.value })}
                className="z-input" style={{ background: 'var(--surface-2)' }}>
                {['irrigation','valve','light','switch','outlet','climate','cover','lock','fan','media','sensor','vacuum','humidifier','generic'].map(k => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
              {group.classified_by && group.classified_by !== 'heuristic' && (
                <p className="z-footnote" style={{ marginTop: 4 }}>{t('deviceDetail.classifiedBy', { by: group.classified_by })}</p>
              )}
            </div>
          </div>
        )}
        {usefulSiblings.filter(s => !s.isPrimary).length > 0 && (
          <div>
            <p style={{ fontSize: 13, color: 'var(--ink-mute)', marginBottom: 8 }}>{t('deviceDetail.showAsTileHint')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {usefulSiblings.filter(s => !s.isPrimary).map(s => (
                <div key={s.entity_id} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, padding: '8px 12px', borderRadius: 'var(--r-ctl)', background: 'var(--surface-2)', border: '0.5px solid var(--line)' }}>
                  <span dir="auto" style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.friendly_name}</span>
                  <Toggle checked={pendingTile[s.entity_id] ?? !!s.is_tile}
                    onCheckedChange={(checked) => toggleTile(s.entity_id, checked)}
                    aria-label={s.friendly_name} />
                </div>
              ))}
            </div>
          </div>
        )}
      </FoldSection>
      )}

      {/* ── Who can use this (permission platform; best-effort, admin-only) ──
          Info tab only — it's device metadata, not a control, and rendering it
          ungated made it appear under BOTH the Control and Info tabs. */}
      {showData && <WhoCanUse entityId={entityId} />}

      {/* ── Danger zone ── */}
      {showData && (
      <Card className="p-4">
        <SectionTitle>{t('deviceDetail.actions')}</SectionTitle>
        <button
          onClick={handleToggleHide}
          className="w-full flex items-center gap-3 hover:bg-surface-2 transition-colors"
          style={{ minHeight: 40, padding: '8px 12px', borderRadius: 'var(--r-ctl)', fontSize: 15, color: 'var(--ink)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'start' }}
        >
          {isHidden
            ? <><Eye size={18} strokeWidth={1.75} /> {t('deviceDetail.showDevice')}</>
            : <><EyeOff size={18} strokeWidth={1.75} /> {t('deviceDetail.hideFromZiggy')}</>
          }
        </button>
        {/* Delete — for HA entities this removes from BOTH Ziggy AND HA.
            For pure-IR devices, removes the IR codeset from Ziggy (HA never
            knew about it). Distinct from Hide, which only affects what Ziggy
            shows. */}
        <button
          onClick={() => setShowDelete(true)}
          className="w-full flex items-center gap-3 hover:bg-surface-2 transition-colors"
          style={{ minHeight: 40, padding: '8px 12px', borderRadius: 'var(--r-ctl)', fontSize: 15, color: 'var(--err-text)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'start' }}
        >
          <Trash2 size={18} strokeWidth={1.75} /> {t('deviceDetail.deleteDevice')}
        </button>
      </Card>
      )}

      <RenameModal
        open={showRename}
        currentName={displayName}
        onClose={() => setShowRename(false)}
        onSave={handleRename}
      />

      <DeleteDeviceModal
        open={showDelete}
        deviceName={displayName}
        hasParentDevice={!!ha_device?.id && !facts.isIr}
        isIr={facts.isIr}
        deleting={deleting}
        onClose={() => !deleting && setShowDelete(false)}
        onConfirm={handleDelete}
      />
    </div>
  )
}

// Publishes the embed escape-hatch to the links buried deep in the tree, so
// they don't have to be threaded through every intermediate component.
export default function DeviceDetail(props = {}) {
  return (
    <ExitCtx.Provider value={props.onExit || null}>
      <DeviceDetailBody {...props} />
    </ExitCtx.Provider>
  )
}
