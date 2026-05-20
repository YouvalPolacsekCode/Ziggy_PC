import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Zap, ChevronRight, RefreshCw, EyeOff, Eye, Pencil, Home, Lock, LockOpen } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Toggle } from '../components/ui/Toggle'
import { Badge } from '../components/ui/Badge'
import { TOGGLEABLE_DOMAINS, isEntityOn } from '../components/ui/DeviceControls'
import { DeviceRemote } from '../components/device/DeviceRemote'
import { deviceFacts, getKind, KIND, sendDeviceCommand } from '../lib/devices'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { useDeviceStore } from '../stores/deviceStore'
import { useUIStore } from '../stores/uiStore'
import { useSuggestionStore } from '../stores/suggestionStore'
import { domainIcon, formatEntityState } from '../lib/utils'
import { DOMAIN_REGISTRY } from '../lib/domainRegistry'
import { getEntityDetails, controlDevice, callHaService, assignEntityToArea, getAllRooms } from '../lib/api'
import { cameraSnapshotUrl, cameraStreamUrl, useCameraStore } from '../stores/cameraStore'
import { cn } from '../lib/utils'

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
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 16 }}>
      {[1, 2, 3, 4].map(b => (
        <div
          key={b}
          style={{
            height: `${b * 25}%`, width: 5, borderRadius: 2,
            background: b <= bars ? 'var(--ok)' : 'var(--line-2)',
          }}
        />
      ))}
      <span className="z-mono" style={{ marginLeft: 4, fontSize: 10, color: 'var(--ink-faint)', lineHeight: 1 }}>
        {lqi != null ? `LQI ${lqi}` : `${rssi} dBm`}
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
  if (!iso) return null
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.round(diffMs / 60000)
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffMin < 1440) return `${Math.round(diffMin / 60)}h ago`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// ── Rename modal ──────────────────────────────────────────────────────────────

function RenameModal({ open, currentName, onClose, onSave }) {
  const [name, setName] = useState(currentName)
  useEffect(() => { setName(currentName) }, [currentName, open])
  return (
    <Modal open={open} onClose={onClose} title="Rename device">
      <Input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Device name"
        onKeyDown={e => e.key === 'Enter' && name.trim() && onSave(name.trim())}
        autoFocus
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} className="z-btn-secondary" style={{ flex: 1 }}>Cancel</button>
        <button
          onClick={() => name.trim() && onSave(name.trim())}
          disabled={!name.trim() || name.trim() === currentName}
          className="z-btn-primary"
          style={{ flex: 1, opacity: (!name.trim() || name.trim() === currentName) ? 0.4 : 1 }}
        >
          Save
        </button>
      </div>
    </Modal>
  )
}

// ── Camera panel — snapshot + go-live button ──────────────────────────────────

function CameraPanel({ entityId, navigate }) {
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
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Camera</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLive(v => !v)}
            style={{
              padding: '3px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600,
              background: live ? 'var(--err)' : 'var(--ink)', color: 'var(--bg)',
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {live ? '■ Stop' : '▶ Live'}
          </button>
          <button
            onClick={() => navigate('/cameras')}
            style={{ fontSize: 11, color: 'var(--ink-faint)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Full view →
          </button>
        </div>
      </div>

      {/* Feed */}
      <div style={{ borderRadius: 10, overflow: 'hidden', background: 'var(--bg-2)', aspectRatio: '16/9', position: 'relative' }}>
        {live ? (
          <img
            ref={imgRef}
            src={cameraStreamUrl(entityId)}
            alt="Live feed"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <img
            key={tick}
            src={`${cameraSnapshotUrl(entityId)}?t=${tick}`}
            alt="Snapshot"
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
            LIVE
          </div>
        )}
      </div>

      {/* Recent motion */}
      {camMotion.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 10, color: 'var(--ink-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Recent motion</p>
          {camMotion.map((ev, i) => {
            const diff = Math.floor((Date.now() - new Date(ev.timestamp)) / 1000)
            const ago = diff < 60 ? `${diff}s ago` : diff < 3600 ? `${Math.floor(diff / 60)}m ago` : `${Math.floor(diff / 3600)}h ago`
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

export default function DeviceDetail() {
  const { entityId } = useParams()
  const navigate = useNavigate()
  const { entities, updateEntityState, hideEntity, unhideEntity, hiddenEntities } = useDeviceStore()
  const { addToast } = useUIStore()
  const { suggestions, fetch: fetchSuggestions } = useSuggestionStore()
  useEffect(() => { if (suggestions.length === 0) fetchSuggestions() }, [])

  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(true)
  const [rooms, setRooms] = useState([])
  const [showRename, setShowRename] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState('controls')
  const [editingRoom, setEditingRoom] = useState(false)

  // Live entity from store — gives real-time state without re-fetching details
  const liveEntity = entities.find(e => e.entity_id === entityId) ?? null

  // IR entities (ir.<id>) don't have HA-side details — synthesize from the
  // store entity so the page renders rather than 404-ing.
  const isIrTarget = entityId?.startsWith('ir.')

  const load = async () => {
    setLoading(true)
    try {
      const fetchDetails = isIrTarget
        ? Promise.resolve(null)
        : getEntityDetails(entityId).catch(() => null)
      const [d, r] = await Promise.all([
        fetchDetails,
        getAllRooms().catch(() => ({ rooms: [] })),
      ])
      if (d) {
        setDetails(d)
      } else if (liveEntity) {
        // Synthesize a details-shaped object from the live store entity so the
        // Info tab renders something useful for IR-only devices.
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
      setRooms(Array.isArray(r) ? r : r.rooms ?? [])
    } catch (e) {
      addToast(e.message || 'Failed to load device details', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [entityId])

  const handleRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const handleToggle = async () => {
    if (!liveEntity) return
    try {
      await sendDeviceCommand(liveEntity, 'toggle')
    } catch (e) { addToast(e.message || 'Control failed', 'error') }
  }

  const handleService = async (service, data) => {
    if (!liveEntity) return
    try {
      await callHaService(liveEntity.domain, service, { entity_id: entityId, ...data })
    } catch { addToast('Control failed', 'error') }
  }

  const handleAssignRoom = async (roomId) => {
    try {
      await assignEntityToArea(entityId, roomId)
      addToast(roomId ? 'Room assigned' : 'Removed from room', 'success')
      await load()
    } catch (e) { addToast(e.message || 'Failed', 'error') }
  }

  const isHidden = hiddenEntities.has(entityId)

  const handleToggleHide = () => {
    if (isHidden) {
      unhideEntity(entityId)
      addToast('Device visible again', 'success')
    } else {
      hideEntity(entityId)
      addToast('Device hidden', 'success')
    }
  }

  const handleRename = async (newName) => {
    // HA entity rename via registry
    try {
      const res = await fetch(`/api/ha/entity/${encodeURIComponent(entityId)}/rename`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      })
      if (!res.ok) throw new Error('Rename failed')
      addToast('Renamed', 'success')
      setShowRename(false)
      await load()
    } catch (e) {
      addToast(e.message || 'Rename failed', 'error')
    }
  }

  if (loading) {
    return (
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 20px' }}>
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div className="h-5 w-32 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse" />
        </div>
        {[1, 2, 3].map(i => (
          <div key={i} className="h-24 mb-3 rounded-2xl bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
        ))}
      </div>
    )
  }

  if (!details) {
    return (
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 20px 48px' }}>
        <div className="flex items-center gap-3 mb-5">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 dark:text-zinc-500 transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="z-eyebrow" style={{ marginBottom: 2 }}>Device</p>
            <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }} className="truncate">
              Not found
            </h1>
          </div>
        </div>
        <div style={{ padding: '24px 16px', borderRadius: 14, background: 'var(--surface)', border: '0.5px solid var(--line)', textAlign: 'center', color: 'var(--ink-mute)', fontSize: 13 }}>
          Could not load device details for <span className="z-mono">{entityId}</span>.
        </div>
      </div>
    )
  }

  const { ha_device, sibling_entities = [], automations_using = [], domain_meta, attributes = {} } = details
  // Merge last_changed: top-level (from raw HA state) takes precedence over diagnostics fallback
  const diagnostics = { ...(details.diagnostics || {}), last_changed: details.last_changed ?? details.diagnostics?.last_changed }
  const entity = liveEntity ?? { entity_id: entityId, domain: entityId.split('.')[0], state: details.state, ...attributes }
  const facts = deviceFacts(entity)
  const isOn = facts.isOn
  const isToggleable = facts.meta.toggle
  const stateLabel = facts.stateLabel
  const meta = facts.meta
  const displayName = facts.name || attributes.friendly_name || entityId
  const currentRoom = rooms.find(r => (r.entities || []).includes(entityId))

  // Filter siblings to show only useful ones (hide update/button/number noise)
  const _HIDDEN_SIBLING_DOMAINS = new Set(['button', 'number', 'select', 'update'])
  const usefulSiblings = sibling_entities.filter(s => !_HIDDEN_SIBLING_DOMAINS.has(s.domain))

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
          aria-label="Back"
        >
          <ArrowLeft size={16} />
        </button>
        <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
          <div style={{
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
              {[currentRoom?.name, facts.isIr ? 'IR' : facts.hasIr ? 'IR + WiFi' : null]
                .filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        <button
          onClick={handleRefresh}
          className={cn('z-icon-btn', refreshing && 'animate-spin')}
          style={{ width: 36, height: 36, borderRadius: 12, flexShrink: 0 }}
          aria-label="Refresh"
          title="Refresh"
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
            { id: 'controls', label: 'Controls' },
            { id: 'data',     label: 'Info' },
          ].map(t => {
            const active = activeTab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
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
                {t.label}
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
                  <span className="z-eyebrow">{meta.label}</span>
                  {facts.isIr && <span className="z-chip" style={{ padding: '2px 8px', fontSize: 10 }}>IR</span>}
                  {facts.hasIr && !facts.isIr && <span className="z-chip" style={{ padding: '2px 8px', fontSize: 10 }}>IR + WiFi</span>}
                  {!facts.isAvailable && <span className="z-chip" style={{ padding: '2px 8px', fontSize: 10, color: 'var(--warn)' }}>Unavailable</span>}
                </div>
                <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.015em', margin: '2px 0 0' }}>
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
                title="Rename"
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
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Diagnostics</p>

          {diagnostics.battery != null && (
            <div className="mb-3">
              <div className="flex justify-between text-[11px] text-zinc-400 mb-1.5">
                <span>Battery</span>
              </div>
              <BatteryBar level={diagnostics.battery} unit={diagnostics.battery_unit} />
            </div>
          )}

          {(diagnostics.lqi != null || diagnostics.rssi != null) && (
            <div className="mb-3">
              <span className="text-[11px] text-zinc-400 block mb-1">Signal</span>
              <SignalBars lqi={diagnostics.lqi} rssi={diagnostics.rssi} />
            </div>
          )}

          <div className="divide-y divide-zinc-50 dark:divide-zinc-800/50">
            <DiagRow label="Last changed">
              <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                <TimeAgo iso={diagnostics.last_changed} />
              </span>
            </DiagRow>
            <DiagRow label="Last seen">
              {diagnostics.last_seen && (
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  <TimeAgo iso={diagnostics.last_seen} />
                </span>
              )}
            </DiagRow>
            <DiagRow label="Firmware" value={diagnostics.firmware} />
          </div>
        </Card>
      )}

      {/* ── HA Device info ── */}
      {showData && ha_device && (ha_device.manufacturer || ha_device.model) && (
        <Card className="p-4 mb-3">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Hardware</p>
          <div className="divide-y divide-zinc-50 dark:divide-zinc-800/50">
            <DiagRow label="Manufacturer" value={ha_device.manufacturer} />
            <DiagRow label="Model" value={ha_device.model} />
            <DiagRow label="Firmware" value={ha_device.sw_version} />
            <DiagRow label="Hardware rev." value={ha_device.hw_version} />
          </div>
        </Card>
      )}

      {/* ── IR codeset info — shown for both pure IR and IR+HA hybrid ── */}
      {showData && facts.linkedIr && (
        <Card className="p-4 mb-3">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            IR Codeset
          </p>
          <div className="divide-y divide-zinc-50 dark:divide-zinc-800/50">
            <DiagRow label="Type" value={facts.linkedIr.type} />
            <DiagRow label="Brand" value={facts.linkedIr.brand || '—'} />
            <DiagRow label="Commands learned" value={`${(facts.linkedIr.learned_commands || []).length}`} />
            <DiagRow label="IR ID">
              <span className="z-mono" style={{ fontSize: 11, color: 'var(--ink)' }}>{facts.linkedIr.id}</span>
            </DiagRow>
            {facts.linkedIr.assumed_state && (
              <DiagRow label="Assumed state" value={facts.linkedIr.assumed_state} />
            )}
          </div>
        </Card>
      )}

      {/* ── Capability list — what this device can actually do ── */}
      {showData && facts.capabilities.size > 0 && (
        <Card className="p-4 mb-3">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Capabilities</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {[...facts.capabilities].map(c => (
              <span key={c} className="z-chip" style={{ padding: '4px 9px', fontSize: 10.5 }}>{c.replace(/_/g, ' ')}</span>
            ))}
          </div>
        </Card>
      )}

      {/* ── Sibling entities ── */}
      {showData && usefulSiblings.length > 0 && (
        <Card className="p-4 mb-3">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Also on this device
          </p>
          <div className="space-y-1.5">
            {usefulSiblings.map(sib => (
              <Link
                key={sib.entity_id}
                to={`/devices/${encodeURIComponent(sib.entity_id)}`}
                className="flex items-center justify-between p-2.5 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors group"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-base">{domainIcon(sib.domain, sib.device_class)}</span>
                  <div>
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{sib.friendly_name}</p>
                    <p className="text-[11px] text-zinc-400">{sib.state}{sib.unit ? ` ${sib.unit}` : ''}</p>
                  </div>
                </div>
                <ChevronRight size={14} className="text-zinc-300 dark:text-zinc-600 group-hover:text-zinc-500 transition-colors" />
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* ── Automations using this device ── */}
      {showData && automations_using.length > 0 && (
        <Card className="p-4 mb-3">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Used in automations
          </p>
          <div className="space-y-1.5">
            {automations_using.map(auto => (
              <Link
                key={auto.id}
                to="/automations"
                className="flex items-center justify-between p-2.5 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors group"
              >
                <div className="flex items-center gap-2.5">
                  <Zap size={14} className={cn('shrink-0', auto.enabled ? 'text-violet-500' : 'text-zinc-300')} />
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{auto.name}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={auto.enabled ? 'success' : 'default'} size="sm">
                    {auto.enabled ? 'On' : 'Off'}
                  </Badge>
                  <ChevronRight size={14} className="text-zinc-300 dark:text-zinc-600 group-hover:text-zinc-500 transition-colors" />
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
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Room</p>
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
            title={editingRoom ? 'Lock' : 'Unlock to edit'}
          >
            {editingRoom ? <><LockOpen size={11} /> Done</> : <><Lock size={11} /> Edit</>}
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
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
              {currentRoom?.name || 'No room'}
            </span>
          </div>
        ) : (
          // Unlocked: full radio list
          <div className="space-y-1">
            <button
              onClick={() => handleAssignRoom(null)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors',
                !currentRoom ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 font-medium' : 'text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800',
              )}
            >
              <Home size={13} /> No room
            </button>
            {rooms.map(r => (
              <button
                key={r.id}
                onClick={() => handleAssignRoom(r.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors',
                  currentRoom?.id === r.id
                    ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 font-medium'
                    : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800',
                )}
              >
                <span className={cn('w-2 h-2 rounded-full shrink-0', currentRoom?.id === r.id ? 'bg-violet-500' : 'bg-zinc-200 dark:bg-zinc-700')} />
                {r.name}
                {currentRoom?.id === r.id && <span className="ml-auto text-[10px] text-violet-400">✓</span>}
              </button>
            ))}
          </div>
        )}
      </Card>
      )}

      {/* ── Danger zone ── */}
      {showData && (
      <Card className="p-4">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Actions</p>
        <button
          onClick={handleToggleHide}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
        >
          {isHidden
            ? <><Eye size={13} /> Show device</>
            : <><EyeOff size={13} /> Hide from Ziggy</>
          }
        </button>
      </Card>
      )}

      <RenameModal
        open={showRename}
        currentName={displayName}
        onClose={() => setShowRename(false)}
        onSave={handleRename}
      />
    </div>
  )
}
