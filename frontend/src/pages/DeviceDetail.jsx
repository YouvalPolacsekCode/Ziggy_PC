import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Zap, ChevronRight, RefreshCw, EyeOff, Eye, Pencil, Home, Lock, LockOpen, Trash2 } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Toggle } from '../components/ui/Toggle'
import { Badge } from '../components/ui/Badge'
import { TOGGLEABLE_DOMAINS, isEntityOn } from '../components/ui/DeviceControls'
import { DeviceRemote } from '../components/device/DeviceRemote'
import SensorHistoryChart from '../components/device/SensorHistoryChart'
import { deviceFacts, getKind, KIND, sendDeviceCommand } from '../lib/devices'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { useDeviceStore } from '../stores/deviceStore'
import { useUIStore } from '../stores/uiStore'
import { useSuggestionStore } from '../stores/suggestionStore'
import { domainIcon, formatEntityState } from '../lib/utils'
import { DOMAIN_REGISTRY, domainLabel } from '../lib/domainRegistry'
import { getEntityDetails, controlDevice, callHaService, assignEntityToArea, getAllRooms, removeRegistryEntity, deleteHaEntity, deleteIrDevice, renameHaEntity, getIrBlaster, setTilePref, selfHealRefresh, whoCanDo } from '../lib/api'
import { cameraSnapshotUrl, cameraStreamUrl, useCameraStore } from '../stores/cameraStore'
import { cn } from '../lib/utils'
import { useT, useTranslatedName } from '../lib/i18n'

// Emoji palette for the per-tile custom icon picker (B: tile curation).
const TILE_ICON_CHOICES = ['💡','🪔','🔌','🎛️','❄️','💨','📺','🔊','🌡️','💧','🏃','🧍','🚪','🪟','🔒','📷','🔔','🌙','☀️','🛰️','🪴','🔋']

// ── Helpers ───────────────────────────────────────────────────────────────────

function BatteryBar({ level, unit = '%' }) {
  if (level == null) return null
  const barColor = level > 60 ? 'var(--ok)' : level > 20 ? 'var(--warn)' : 'var(--err)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="z-slider-track" style={{ flex: 1 }}>
        <div className="z-slider-fill" style={{ width: `${level}%`, background: barColor }} />
      </div>
      <span className="z-mono" style={{ fontSize: 11, color: 'var(--ink-mute)', width: 36, textAlign: 'right' }}>
        {level}{unit}
      </span>
    </div>
  )
}

function SignalBars({ lqi, rssi }) {
  if (lqi == null && rssi == null) return null
  const strength = lqi != null
    ? Math.round((lqi / 255) * 100)
    : rssi != null ? Math.max(0, Math.min(100, Math.round((rssi + 100) * 2))) : null
  if (strength == null) return null
  const bars = Math.ceil(strength / 25)
  // Friendly label instead of "LQI 187" / "-68 dBm". Raw value still
  // available on hover for support/debugging via the title attribute.
  const friendly = bars >= 4 ? 'Strong' : bars >= 3 ? 'Good' : bars >= 2 ? 'Fair' : 'Weak'
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
      <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--ink-faint)', lineHeight: 1 }}>
        {friendly}
      </span>
    </div>
  )
}

function DiagRow({ label, value, children }) {
  if (value == null && !children) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '0.5px solid var(--line)' }}
      className="last:border-0">
      <span style={{ fontSize: 11, color: 'var(--ink-faint)', flexShrink: 0 }}>{label}</span>
      {children ?? <span className="z-mono" style={{ fontSize: 11, color: 'var(--ink)', textAlign: 'right', wordBreak: 'break-all' }}>{value}</span>}
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
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 20px 48px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <button onClick={() => navigate(-1)} className="z-icon-btn"
          style={{ width: 36, height: 36, borderRadius: 12, flexShrink: 0 }} aria-label={t('deviceDetail.back')}>
          <ArrowLeft size={16} className="icon-flip-rtl" />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="z-eyebrow" style={{ color: 'var(--warn)' }}>{t('deviceDetail.ghost.eyebrow')}</p>
          <h1 dir="auto" style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }} className="truncate">
            {name}
          </h1>
        </div>
      </div>

      <div className="z-card" style={{ padding: 18, marginBottom: 14, borderRadius: 18 }}>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 10 }}>
          {t('deviceDetail.ghost.description')}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 10, rowGap: 6, fontSize: 12, marginTop: 12 }}>
          {room && (<>
            <span style={{ color: 'var(--ink-faint)' }}>{t('deviceDetail.ghost.room')}</span>
            <span style={{ color: 'var(--ink)' }}>{room.replace(/_/g, ' ')}</span>
          </>)}
          <span style={{ color: 'var(--ink-faint)' }}>{t('deviceDetail.ghost.status')}</span>
          <span style={{ color: 'var(--warn)' }}>{status}</span>
        </div>
      </div>

      <button
        onClick={handleRemove}
        disabled={removing}
        className="z-btn-primary"
        style={{
          width: '100%', height: 48, fontSize: 14, letterSpacing: '0.02em',
          background: 'var(--err)', color: 'var(--bg)', border: 'none',
          opacity: removing ? 0.6 : 1, cursor: removing ? 'default' : 'pointer',
        }}
      >
        {removing ? t('deviceDetail.ghost.removing') : t('deviceDetail.ghost.remove')}
      </button>
      <p style={{ fontSize: 11, color: 'var(--ink-faint)', textAlign: 'center', marginTop: 10, lineHeight: 1.5 }}>
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
      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 14 }}>
        {isIr
          ? t('deviceDetail.deleteIrDescription', { name: deviceName })
          : t('deviceDetail.deleteHaDescription', { name: deviceName })
        }
      </p>
      {hasParentDevice && (
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)', cursor: 'pointer', marginBottom: 14 }}>
          <input
            type="checkbox"
            checked={alsoDeleteDevice}
            onChange={(e) => setAlsoDeleteDevice(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>{t('deviceDetail.alsoRemoveDevice')}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>
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
          style={{
            flex: 1, height: 40, borderRadius: 10, border: 'none', cursor: deleting ? 'default' : 'pointer',
            background: 'var(--err)', color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
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
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-ink-mute uppercase tracking-wider">{t('deviceDetail.camera')}</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLive(v => !v)}
            style={{
              padding: '3px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600,
              background: live ? 'var(--err)' : 'var(--ink)', color: 'var(--bg)',
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {live ? t('deviceDetail.cameraStop') : t('deviceDetail.cameraLive')}
          </button>
          <button
            onClick={() => navigate('/cameras')}
            style={{ fontSize: 11, color: 'var(--ink-faint)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {t('deviceDetail.cameraFullView')}
          </button>
        </div>
      </div>

      {/* Feed */}
      <div style={{ borderRadius: 10, overflow: 'hidden', background: 'var(--bg-2)', aspectRatio: '16/9', position: 'relative' }}>
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
              opacity: loaded ? 1 : 0, transition: 'opacity 0.2s',
            }}
          />
        )}
        {live && (
          <div style={{
            position: 'absolute', top: 8, left: 8,
            padding: '2px 8px', borderRadius: 999,
            background: 'rgba(239,68,68,0.85)', color: '#fff',
            fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
          }}>
            {t('deviceDetail.cameraLiveBadge')}
          </div>
        )}
      </div>

      {/* Recent motion */}
      {camMotion.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 10, color: 'var(--ink-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{t('deviceDetail.recentMotion')}</p>
          {camMotion.map((ev, i) => {
            const diff = Math.floor((Date.now() - new Date(ev.timestamp)) / 1000)
            const ago = diff < 60 ? t('deviceDetail.secondsAgo', { n: diff })
              : diff < 3600 ? t('deviceDetail.minutesAgo', { n: Math.floor(diff / 60) })
              : t('deviceDetail.hoursAgo', { n: Math.floor(diff / 3600) })
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: i < camMotion.length - 1 ? '0.5px solid var(--line)' : 'none' }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--err)', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 11, color: 'var(--ink-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ev.name || ev.entity_id.split('.')[1]?.replace(/_/g, ' ')}
                </span>
                <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace', flexShrink: 0 }}>{ago}</span>
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
      <p className="text-xs font-semibold text-ink-mute uppercase tracking-wider mb-3">Who can use this</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {names.map(n => (
          <span key={n} style={{ fontSize: 12.5, fontWeight: 550, color: 'var(--ink)',
            background: 'var(--surface-2, var(--ground))', border: '1px solid var(--line)',
            borderRadius: 999, padding: '4px 11px' }}>{n}</span>
        ))}
      </div>
      <Link to="/settings/people" style={{ display: 'inline-block', marginTop: 11, fontSize: 12,
        fontWeight: 550, color: 'var(--accent)', textDecoration: 'none' }}>Manage access →</Link>
    </Card>
  )
}

export default function DeviceDetail() {
  const t = useT()
  const { entityId } = useParams()
  const navigate = useNavigate()
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
      await assignEntityToArea(entityId, roomId)
      addToast(roomId ? t('deviceDetail.roomAssigned') : t('deviceDetail.removedFromRoom'), 'success')
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
        <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 20px 48px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <button onClick={() => navigate(-1)} className="z-icon-btn"
              style={{ width: 36, height: 36, borderRadius: 12, flexShrink: 0 }} aria-label={t('deviceDetail.back')}>
              <ArrowLeft size={16} className="icon-flip-rtl" />
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="z-eyebrow" style={{ color: 'var(--warn)' }}>{t('deviceDetail.couldntLoad')}</p>
              <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', margin: 0 }} className="truncate">
                {entityId}
              </h1>
            </div>
          </div>
          <div className="z-card" style={{ padding: 18, borderRadius: 18 }}>
            <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
              {t('deviceDetail.couldntLoadHint')}
            </p>
            <button
              onClick={() => navigate('/devices')}
              className="z-btn-secondary"
              style={{ marginTop: 14, padding: '10px 14px', borderRadius: 10, fontFamily: 'inherit', fontSize: 13 }}
            >{t('deviceDetail.backToDevices')}</button>
          </div>
        </div>
      )
    }
    return (
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 20px' }}>
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-surface-2 text-ink-mute transition-colors">
            <ArrowLeft size={18} className="icon-flip-rtl" />
          </button>
          <div className="h-5 w-32 bg-surface-2 rounded animate-pulse" />
        </div>
        {[1, 2, 3].map(i => (
          <div key={i} className="h-24 mb-3 rounded-2xl bg-surface-2 animate-pulse" />
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
  const currentRoom = rooms.find(r => (r.entities || []).includes(entityId))

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

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 20px 48px' }}>

      {/* ── Header — centered title with room subtitle, design-matched ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <button
          onClick={() => navigate(-1)}
          className="z-icon-btn"
          style={{ width: 36, height: 36, borderRadius: 12, flexShrink: 0 }}
          aria-label={t('deviceDetail.back')}
        >
          <ArrowLeft size={16} className="icon-flip-rtl" />
        </button>
        <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
          {/* Parent-device crumb when viewing a non-primary sibling. Tapping
              jumps to the primary entity's page — the canonical control
              surface for the physical device. */}
          {isSiblingView && group?.primary_entity_id && (
            <button
              onClick={() => navigate(`/devices/${encodeURIComponent(group.primary_entity_id)}`)}
              className="z-mono"
              style={{
                fontSize: 10, color: 'var(--ink-faint)', letterSpacing: '0.05em',
                background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 1,
              }}
              title={t('devices.openParentDevice')}
            >
              <ArrowLeft size={9} className="icon-flip-rtl" />
              {groupName || t('devices.parentDevice')}
            </button>
          )}
          <div dir="auto" style={{
            fontSize: 15, fontWeight: 600, letterSpacing: '-0.015em', color: 'var(--ink)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {displayName}
          </div>
          {(currentRoom || facts.isIr || facts.hasIr) && (
            <div className="z-mono" style={{
              fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 2, letterSpacing: '0.04em',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {[currentRoom?.name, facts.isIr ? 'IR' : facts.hasIr ? t('deviceDetail.irPlusWifi') : null]
                .filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        <button
          onClick={handleRefresh}
          className={cn('z-icon-btn', refreshing && 'animate-spin')}
          style={{ width: 36, height: 36, borderRadius: 12, flexShrink: 0 }}
          aria-label={t('deviceDetail.refresh')}
          title={t('deviceDetail.refresh')}
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {/* ── Tab switcher (only when there's something to control). Same
            segmented-pill design as the Automations page — soft white active
            pill with a faint shadow, no stark inversion. ── */}
      {hasControls && (
        <div style={{
          display: 'flex', gap: 4, padding: 3, marginBottom: 16,
          background: 'var(--surface-2)', borderRadius: 13,
        }}>
          {[
            { id: 'controls', label: t('deviceDetail.tabControls') },
            { id: 'data',     label: t('deviceDetail.tabInfo') },
          ].map(tab => {
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 10,
                  background: active ? 'var(--surface)' : 'transparent',
                  color: active ? 'var(--ink)' : 'var(--ink-mute)',
                  border: 'none', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
                  boxShadow: active ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  transition: 'background 0.15s',
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
          <div className="z-card" style={{ padding: 16, marginBottom: 14, borderRadius: 18 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 14,
                background: isOn
                  ? `color-mix(in srgb, ${facts.tint} 14%, var(--surface-2))`
                  : 'var(--surface-2)',
                color: isOn ? facts.tint : 'var(--ink-mute)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22, flexShrink: 0,
              }}>
                {meta.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="z-eyebrow">{domainLabel(entity.domain)}</span>
                  {facts.isIr && <span className="z-chip" style={{ padding: '2px 8px', fontSize: 10 }}>IR</span>}
                  {facts.hasIr && !facts.isIr && <span className="z-chip" style={{ padding: '2px 8px', fontSize: 10 }}>{t('deviceDetail.irPlusWifi')}</span>}
                  {!facts.isAvailable && <span className="z-chip" style={{ padding: '2px 8px', fontSize: 10, color: 'var(--warn)' }}>{t('deviceDetail.unavailable')}</span>}
                </div>
                <h2 dir="auto" style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.015em', margin: '2px 0 0' }}>
                  {displayName}
                </h2>
                {currentRoom && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
                    <Home size={11} style={{ color: 'var(--ink-faint)' }} />
                    <span className="z-mono" style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>{currentRoom.name}</span>
                  </div>
                )}
              </div>
              <button
                onClick={() => setShowRename(true)}
                className="z-icon-btn"
                style={{ width: 32, height: 32, borderRadius: 10 }}
                title={t('deviceDetail.rename')}
              >
                <Pencil size={13} />
              </button>
            </div>
          </div>

          {/* Per-kind control surface — passes relevant automations +
              suggestion to the kind-specific remote (used by AC for the
              Schedule + AI cards). */}
          {entity.state !== 'unavailable' && (() => {
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
              <div className="z-card" style={{ padding: 18, marginBottom: 14, borderRadius: 18 }}>
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
          <p style={{ marginTop: 4, fontSize: 10, color: 'var(--ink-ghost)', fontFamily: 'IBM Plex Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entityId}{facts.irId ? ` · ir:${facts.irId}` : ''}
          </p>
        </>
      )}

      {/* ── Diagnostics ── */}
      {showData && hasDiagnostics && (
        <Card className="p-4 mb-3">
          <p className="text-xs font-semibold text-ink-mute uppercase tracking-wider mb-3">{t('deviceDetail.diagnostics')}</p>

          {diagnostics.battery != null && (
            <div className="mb-3">
              <div className="flex justify-between text-[11px] text-ink-mute mb-1.5">
                <span>{t('deviceDetail.battery')}</span>
              </div>
              <BatteryBar level={diagnostics.battery} unit={diagnostics.battery_unit} />
            </div>
          )}

          {(diagnostics.lqi != null || diagnostics.rssi != null) && (
            <div className="mb-3">
              <span className="text-[11px] text-ink-mute block mb-1">{t('deviceDetail.signal')}</span>
              <SignalBars lqi={diagnostics.lqi} rssi={diagnostics.rssi} />
            </div>
          )}

          <div className="divide-y divide-line">
            <DiagRow label={t('deviceDetail.lastChanged')}>
              <span className="text-xs font-medium text-ink-2">
                <TimeAgo iso={diagnostics.last_changed} />
              </span>
            </DiagRow>
            <DiagRow label={t('deviceDetail.lastSeen')}>
              {diagnostics.last_seen && (
                <span className="text-xs font-medium text-ink-2">
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
          <p className="text-xs font-semibold text-ink-mute uppercase tracking-wider mb-3">{t('deviceDetail.hardware')}</p>
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
          <p className="text-xs font-semibold text-ink-mute uppercase tracking-wider mb-3">
            {t('deviceDetail.irCodeset')}
          </p>
          <div className="divide-y divide-line">
            {/* Parent blaster row — only renders once the registry lookup
                resolves (lazy). Status chip mirrors the Blasters admin UI
                so the same green/yellow/red signals appear in both surfaces.
                Tapping the row could deep-link to admin in a later pass. */}
            {parentBlaster && (
              <DiagRow label="Blaster">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--ink)', fontWeight: 500 }}>
                    {parentBlaster.name}
                  </span>
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    padding: '1px 6px', borderRadius: 999,
                    color:
                      parentBlaster.status === 'online'      ? 'var(--ok)'   :
                      parentBlaster.status === 'stale'       ? 'var(--warn)' :
                                                               'var(--err)',
                    background:
                      parentBlaster.status === 'online'      ? 'color-mix(in srgb, var(--ok) 14%, transparent)'   :
                      parentBlaster.status === 'stale'       ? 'color-mix(in srgb, var(--warn) 14%, transparent)' :
                                                               'color-mix(in srgb, var(--err) 14%, transparent)',
                  }}>
                    {parentBlaster.status === 'online' ? 'online'
                      : parentBlaster.status === 'stale' ? 'stale'
                      : 'unreachable'}
                  </span>
                </span>
              </DiagRow>
            )}
            <DiagRow label={t('deviceDetail.type')} value={facts.linkedIr.type} />
            <DiagRow label={t('deviceDetail.brand')} value={facts.linkedIr.brand || '—'} />
            <DiagRow label={t('deviceDetail.commandsLearned')} value={`${(facts.linkedIr.learned_commands || []).length}`} />
            <DiagRow label={t('deviceDetail.irId')}>
              <span className="z-mono" style={{ fontSize: 11, color: 'var(--ink)' }}>{facts.linkedIr.id}</span>
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
          <p className="text-xs font-semibold text-ink-mute uppercase tracking-wider mb-3">{t('deviceDetail.capabilities')}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {[...facts.capabilities].map(c => (
              <span key={c} className="z-chip" style={{ padding: '4px 9px', fontSize: 10.5 }}>{c.replace(/_/g, ' ')}</span>
            ))}
          </div>
        </Card>
      )}

      {/* ── Sibling entities — every HA entity living on the same physical
            device. The primary entity is highlighted so the user always
            knows which one drives the main card / control surface. ── */}
      {showData && usefulSiblings.length > 0 && (
        <Card className="p-4 mb-3">
          <p className="text-xs font-semibold text-ink-mute uppercase tracking-wider mb-3">
            {groupName ? t('deviceDetail.siblingsOn', { name: groupName }) : t('deviceDetail.alsoOnDevice')}
          </p>
          <div className="space-y-1.5">
            {usefulSiblings.map(sib => (
              <Link
                key={sib.entity_id}
                to={`/devices/${encodeURIComponent(sib.entity_id)}`}
                className="flex items-center justify-between p-2.5 rounded-xl hover:bg-surface-2/50 transition-colors group"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-base">{domainIcon(sib.domain, sib.device_class)}</span>
                  <div>
                    <p dir="auto" className="text-sm font-medium text-ink">
                      {sib.friendly_name}
                      {sib.isPrimary && (
                        <span style={{
                          marginLeft: 6, padding: '1px 6px', borderRadius: 999,
                          fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
                          background: 'color-mix(in srgb, var(--info) 14%, var(--surface-2))',
                          color: 'var(--info)', textTransform: 'uppercase',
                        }}>{t('deviceDetail.primary')}</span>
                      )}
                    </p>
                    <p className="text-[11px] text-ink-mute">
                      {sib.state ?? '—'}{sib.unit ? ` ${sib.unit}` : ''}
                      {sib.device_class ? ` · ${sib.device_class}` : ''}
                    </p>
                  </div>
                </div>
                <ChevronRight size={14} className="icon-flip-rtl text-ink-faint group-hover:text-ink-mute transition-colors" />
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* ── Automations using this device ── */}
      {showData && automations_using.length > 0 && (
        <Card className="p-4 mb-3">
          <p className="text-xs font-semibold text-ink-mute uppercase tracking-wider mb-3">
            {t('deviceDetail.usedInAutomations')}
          </p>
          <div className="space-y-1.5">
            {automations_using.map(auto => (
              <Link
                key={auto.id}
                to="/actions"
                className="flex items-center justify-between p-2.5 rounded-xl hover:bg-surface-2/50 transition-colors group"
              >
                <div className="flex items-center gap-2.5">
                  <Zap size={14} className={cn('shrink-0', auto.enabled ? 'text-accent' : 'text-ink-faint')} />
                  <p dir="auto" className="text-sm font-medium text-ink">{auto.name}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={auto.enabled ? 'success' : 'default'} size="sm">
                    {auto.enabled ? t('deviceDetail.autoOn') : t('deviceDetail.autoOff')}
                  </Badge>
                  <ChevronRight size={14} className="icon-flip-rtl text-ink-faint group-hover:text-ink-mute transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* ── Room assignment — locked by default to prevent fat-finger
          reassignment. Tap the lock to enter edit mode. ── */}
      {showData && (
      <Card className="p-4 mb-3">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <p className="text-xs font-semibold text-ink-mute uppercase tracking-wider">{t('deviceDetail.room')}</p>
          <button
            onClick={() => setEditingRoom(v => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 9px', borderRadius: 8,
              background: editingRoom ? 'var(--ink)' : 'var(--surface-2)',
              color: editingRoom ? 'var(--bg)' : 'var(--ink-mute)',
              border: '0.5px solid ' + (editingRoom ? 'var(--ink)' : 'var(--line)'),
              fontSize: 10.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}
            title={editingRoom ? t('deviceDetail.editRoomLock') : t('deviceDetail.editRoomUnlock')}
          >
            {editingRoom ? <><LockOpen size={11} /> {t('deviceDetail.editRoomDone')}</> : <><Lock size={11} /> {t('deviceDetail.editRoomEdit')}</>}
          </button>
        </div>

        {!editingRoom ? (
          // Locked: read-only summary of the current assignment
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 12px', borderRadius: 11,
            background: 'var(--surface-2)', border: '0.5px solid var(--line)',
          }}>
            <Home size={13} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />
            <span dir="auto" style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
              {currentRoom?.name || t('deviceDetail.noRoom')}
            </span>
          </div>
        ) : (
          // Unlocked: full radio list
          <div className="space-y-1">
            <button
              onClick={() => handleAssignRoom(null)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors',
                !currentRoom ? 'bg-accent-soft text-accent font-medium' : 'text-ink-mute hover:bg-surface-2',
              )}
            >
              <Home size={13} /> {t('deviceDetail.noRoom')}
            </button>
            {rooms.map(r => (
              <button
                key={r.id}
                onClick={() => handleAssignRoom(r.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors',
                  currentRoom?.id === r.id
                    ? 'bg-accent-soft text-accent font-medium'
                    : 'text-ink-2 hover:bg-surface-2',
                )}
              >
                <span className={cn('w-2 h-2 rounded-full shrink-0', currentRoom?.id === r.id ? 'bg-accent' : 'bg-line')} />
                <span dir="auto">{r.name}</span>
                {currentRoom?.id === r.id && <span className="ml-auto text-[10px] text-accent">✓</span>}
              </button>
            ))}
          </div>
        )}
      </Card>
      )}

      {/* ── Manage tiles (B: user curation — icon + promote siblings) ── */}
      {showData && group && (
      <Card className="p-4 mb-3">
        <p className="text-xs font-semibold text-ink-mute uppercase tracking-wider mb-3">{t('deviceDetail.tilesTitle')}</p>
        <div style={{ marginBottom: 14 }}>
          <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 8 }}>{t('deviceDetail.tileIcon')}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {TILE_ICON_CHOICES.map(ic => {
              const active = (liveEntity?.icon || '') === ic
              return (
                <button key={ic}
                  onClick={async () => { await setTilePref(entityId, { icon: ic }).catch(() => {}); useDeviceStore.getState().fetchAll({ force: true }) }}
                  style={{ width: 34, height: 34, borderRadius: 9, fontSize: 18, lineHeight: '32px', cursor: 'pointer',
                    border: active ? '1.5px solid var(--accent)' : '0.5px solid var(--line)',
                    background: active ? 'color-mix(in srgb, var(--accent) 12%, var(--surface))' : 'var(--surface-2)' }}
                >{ic}</button>
              )
            })}
            <button
              onClick={async () => { await setTilePref(entityId, { clear_icon: true }).catch(() => {}); useDeviceStore.getState().fetchAll({ force: true }) }}
              style={{ height: 34, padding: '0 10px', borderRadius: 9, fontSize: 11, cursor: 'pointer',
                border: '0.5px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink-mute)' }}
            >{t('deviceDetail.tileIconDefault')}</button>
          </div>
        </div>
        {usefulSiblings.filter(s => !s.isPrimary).length > 0 && (
          <div>
            <p style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 8 }}>{t('deviceDetail.showAsTileHint')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {usefulSiblings.filter(s => !s.isPrimary).map(s => (
                <div key={s.entity_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, background: 'var(--surface-2)', border: '0.5px solid var(--line)' }}>
                  <span dir="auto" style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.friendly_name}</span>
                  <Toggle checked={!!s.is_tile}
                    onChange={async () => { await setTilePref(s.entity_id, { is_tile: !s.is_tile }).catch(() => {}); useDeviceStore.getState().fetchAll({ force: true }) }} />
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
      )}

      {/* ── Who can use this (permission platform; best-effort, admin-only) ── */}
      <WhoCanUse entityId={entityId} />

      {/* ── Danger zone ── */}
      {showData && (
      <Card className="p-4">
        <p className="text-xs font-semibold text-ink-mute uppercase tracking-wider mb-3">{t('deviceDetail.actions')}</p>
        <button
          onClick={handleToggleHide}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-ink-mute hover:bg-surface-2 transition-colors"
        >
          {isHidden
            ? <><Eye size={13} /> {t('deviceDetail.showDevice')}</>
            : <><EyeOff size={13} /> {t('deviceDetail.hideFromZiggy')}</>
          }
        </button>
        {/* Delete — for HA entities this removes from BOTH Ziggy AND HA.
            For pure-IR devices, removes the IR codeset from Ziggy (HA never
            knew about it). Distinct from Hide, which only affects what Ziggy
            shows. */}
        <button
          onClick={() => setShowDelete(true)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors"
          style={{ color: 'var(--err)' }}
        >
          <Trash2 size={13} /> {t('deviceDetail.deleteDevice')}
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
