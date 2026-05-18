import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Zap, ChevronRight, RefreshCw, EyeOff, Eye, Pencil, Home } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Toggle } from '../components/ui/Toggle'
import { Badge } from '../components/ui/Badge'
import { DeviceControls, TOGGLEABLE_DOMAINS, IRRemoteButton, isEntityOn } from '../components/ui/DeviceControls'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { useDeviceStore } from '../stores/deviceStore'
import { useUIStore } from '../stores/uiStore'
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
              background: live ? '#ef4444' : 'var(--ink)', color: '#fff',
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
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
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

  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(true)
  const [rooms, setRooms] = useState([])
  const [showRename, setShowRename] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // Live entity from store — gives real-time state without re-fetching details
  const liveEntity = entities.find(e => e.entity_id === entityId) ?? null

  const load = async () => {
    setLoading(true)
    try {
      const [d, r] = await Promise.all([
        getEntityDetails(entityId),
        getAllRooms().catch(() => ({ rooms: [] })),
      ])
      setDetails(d)
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

  const handleToggle = async (on) => {
    if (!liveEntity) return
    try {
      await controlDevice(entityId, on ? 'turn_on' : 'turn_off')
    } catch { addToast('Control failed', 'error') }
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

  if (!details) return null

  const { ha_device, sibling_entities, automations_using, domain_meta, attributes } = details
  // Merge last_changed: top-level (from raw HA state) takes precedence over diagnostics fallback
  const diagnostics = { ...details.diagnostics, last_changed: details.last_changed ?? details.diagnostics?.last_changed }
  const entity = liveEntity ?? { entity_id: entityId, domain: entityId.split('.')[0], state: details.state, ...attributes }
  const isOn = isEntityOn(entity)
  const isToggleable = TOGGLEABLE_DOMAINS.has(entity.domain)
  const { primary: stateLabel } = formatEntityState({ ...entity, ...attributes })
  const meta = DOMAIN_REGISTRY[entity.domain]
  const displayName = attributes.friendly_name || details.attributes?.friendly_name || entityId.split('.')[1]?.replace(/_/g, ' ') || entityId
  const currentRoom = rooms.find(r => (r.entities || []).includes(entityId))

  // Filter siblings to show only useful ones (hide update/button/number noise)
  const _HIDDEN_SIBLING_DOMAINS = new Set(['button', 'number', 'select', 'update'])
  const usefulSiblings = sibling_entities.filter(s => !_HIDDEN_SIBLING_DOMAINS.has(s.domain))

  const hasDiagnostics = diagnostics.battery != null || diagnostics.lqi != null || diagnostics.rssi != null ||
    diagnostics.last_changed || diagnostics.last_seen || diagnostics.firmware

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 20px 48px' }}>

      {/* ── Header ── */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 dark:text-zinc-500 transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="z-eyebrow" style={{ marginBottom: 2 }}>Device</p>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }} className="truncate">
            {displayName}
          </h1>
        </div>
        <button
          onClick={handleRefresh}
          className={cn('p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 transition-colors', refreshing && 'animate-spin')}
          title="Refresh"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {/* ── Identity card ── */}
      <Card className="p-4 mb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className={cn(
              'w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0',
              isOn ? 'bg-zinc-900 dark:bg-white' : 'bg-zinc-100 dark:bg-zinc-800',
            )}>
              {domainIcon(entity.domain, attributes.device_class)}
            </div>
            <div>
              <p className="font-semibold text-zinc-900 dark:text-zinc-100">{displayName}</p>
              <p className={cn(
                'text-sm mt-0.5',
                entity.state === 'unavailable' ? 'text-zinc-300 dark:text-zinc-600' :
                isOn ? 'text-emerald-500' : 'text-zinc-400',
              )}>
                {stateLabel}
              </p>
              {currentRoom && (
                <div className="flex items-center gap-1 mt-1">
                  <Home size={10} className="text-zinc-400" />
                  <span className="text-[11px] text-zinc-400">{currentRoom.name}</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isToggleable && (
              <Toggle checked={isOn} onCheckedChange={handleToggle} disabled={entity.state === 'unavailable'} />
            )}
            <button
              onClick={() => setShowRename(true)}
              className="p-1.5 rounded-lg text-zinc-300 dark:text-zinc-600 hover:text-violet-500 transition-colors"
              title="Rename"
            >
              <Pencil size={15} />
            </button>
          </div>
        </div>

        {/* Controls */}
        {entity.state !== 'unavailable' && (
          <DeviceControls
            entity={{ ...entity, ...attributes, entity_id: entityId }}
            onService={handleService}
          />
        )}

        {/* Entity ID */}
        <p className="mt-3 text-[10px] text-zinc-300 dark:text-zinc-700 font-mono truncate">{entityId}</p>
      </Card>

      {/* ── Camera view ── */}
      {entity.domain === 'camera' && <CameraPanel entityId={entityId} navigate={navigate} />}

      {/* ── Diagnostics ── */}
      {hasDiagnostics && (
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
      {ha_device && (ha_device.manufacturer || ha_device.model) && (
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

      {/* ── Sibling entities ── */}
      {usefulSiblings.length > 0 && (
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
      {automations_using.length > 0 && (
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

      {/* ── Room assignment ── */}
      <Card className="p-4 mb-3">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Room</p>
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
      </Card>

      {/* ── Danger zone ── */}
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

      <RenameModal
        open={showRename}
        currentName={displayName}
        onClose={() => setShowRename(false)}
        onSave={handleRename}
      />
    </div>
  )
}
