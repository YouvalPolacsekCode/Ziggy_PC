/**
 * Remote — full-screen device remote page.
 *
 * The route accepts BOTH IR device IDs and HA entity_ids:
 *   /remote/ir.abc123              (IR device — bare ID also accepted for legacy bookmarks)
 *   /remote/media_player.living_room_tv   (HA entity)
 *
 * Routing is split here only because the data source differs. Once we have a
 * usable entity in the unified shape, rendering goes through the single
 * <DeviceRemote> component — no IR-vs-HA UI fork.
 */

import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { DeviceRemote } from '../components/device/DeviceRemote'
import { deviceFacts } from '../lib/devices'
import { getIrDevice, getEntityDetails } from '../lib/api'
import { useDeviceStore } from '../stores/deviceStore'
import { useUIStore } from '../stores/uiStore'

function parseTarget(id) {
  if (!id) return { kind: 'unknown' }
  if (id.startsWith('ir.')) return { kind: 'ir', irId: id.slice(3) }
  if (id.includes('.'))     return { kind: 'ha', entityId: id }
  return { kind: 'ir', irId: id }
}

// Mirror the deviceStore irToEntity so we can build an entity from a fresh
// IR fetch without round-tripping through the store.
const IR_TYPE_TO_DOMAIN = {
  tv: 'media_player', soundbar: 'media_player', projector: 'media_player',
  ac: 'climate', fan: 'fan', custom: 'switch',
}
function irToEntity(ir) {
  return {
    entity_id:        `ir.${ir.id}`,
    state:            ir.assumed_state || 'unknown',
    domain:           IR_TYPE_TO_DOMAIN[ir.type] || 'switch',
    display_name:     ir.name,
    friendly_name:    ir.name,
    _ir:              true,
    _irDevice:        ir,
    commands:         ir.commands || {},
    learned_commands: ir.learned_commands || [],
    assumed_state:    ir.assumed_state,
    ac_memory:        ir.ac_memory,
    capabilities:     ir.capabilities || [],
  }
}

export default function Remote() {
  const { irId: routeId } = useParams()
  const navigate = useNavigate()
  const target = parseTarget(routeId)

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '0 0 32px' }}>
      {target.kind === 'ir' && <IrPath irId={target.irId} navigate={navigate} />}
      {target.kind === 'ha' && <HaPath entityId={target.entityId} navigate={navigate} />}
      {target.kind === 'unknown' && <NotFound navigate={navigate} />}
    </div>
  )
}

function IrPath({ irId, navigate }) {
  const { entities } = useDeviceStore()
  const [irDevice, setIrDevice] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getIrDevice(irId)
      .then(d => { if (!cancelled) setIrDevice(d) })
      .catch(e => { if (!cancelled) setError(e.message || 'Failed to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [irId])

  // Prefer the live store entity if present (gets WS-driven assumed_state updates)
  const liveIr = entities.find(e => e._ir && e._irDevice?.id === irId)
  const entity = liveIr || (irDevice ? irToEntity(irDevice) : null)
  return <Body entity={entity} loading={loading} error={error} navigate={navigate} />
}

function HaPath({ entityId, navigate }) {
  const { entities } = useDeviceStore()
  const [details, setDetails] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getEntityDetails(entityId)
      .then(d => { if (!cancelled) setDetails(d) })
      .catch(e => { if (!cancelled) setError(e.message || 'Failed to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [entityId])

  const liveEntity = entities.find(e => e.entity_id === entityId)
  const merged = liveEntity || details
    ? { ...(details?.attributes || {}), ...(liveEntity || {}), entity_id: entityId }
    : null
  return <Body entity={merged} loading={loading} error={error} navigate={navigate} />
}

function Body({ entity, loading, error, navigate }) {
  if (loading) return <Header title="Loading…" onBack={() => navigate(-1)} />
  if (error || !entity) {
    return (
      <>
        <Header title="Remote" onBack={() => navigate(-1)} />
        <Empty text={error || 'Device not found'} />
      </>
    )
  }
  const facts = deviceFacts(entity)
  return (
    <div style={{ padding: '24px 20px' }}>
      <Header
        title={facts.name}
        subtitle={`${facts.meta.label}${facts.isIr ? ' · IR' : facts.linkedIr ? ' · IR + WiFi' : ''}`}
        onBack={() => navigate(-1)}
      />
      <div className="z-card" style={{ padding: 18, borderRadius: 18 }}>
        <DeviceRemote entity={entity} />
      </div>
    </div>
  )
}

function Header({ title, subtitle, onBack }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '24px 20px 16px' }}>
      <button onClick={onBack} className="z-icon-btn" style={{ width: 36, height: 36, borderRadius: 12 }}>
        <ArrowLeft size={16} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="z-eyebrow" style={{ marginBottom: 2 }}>Remote</p>
        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </h1>
        {subtitle && (
          <p className="z-mono" style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 2 }}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
  )
}

function Empty({ text }) {
  return (
    <div style={{ margin: '0 20px', padding: '32px 16px', borderRadius: 14,
      background: 'var(--surface)', border: '0.5px solid var(--line)',
      textAlign: 'center', color: 'var(--ink-mute)', fontSize: 13 }}>
      {text}
    </div>
  )
}

function NotFound({ navigate }) {
  return (
    <>
      <Header title="Remote" onBack={() => navigate(-1)} />
      <Empty text="Invalid remote target" />
    </>
  )
}
