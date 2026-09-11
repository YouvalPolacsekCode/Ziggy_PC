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
import { useT, t as i18nT } from '../lib/i18n'

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
    <div style={{ maxWidth: 'var(--page-max-w-narrow)', margin: '0 auto', padding: '24px 20px 24px' }}>
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
      .catch(e => { if (!cancelled) setError(e.message || i18nT('remote.failedLoad')) })
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
      .catch(e => { if (!cancelled) setError(e.message || i18nT('remote.failedLoad')) })
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
  if (loading) return <Header title={i18nT('common.loading')} onBack={() => navigate(-1)} />
  if (error || !entity) {
    return (
      <>
        <Header title={i18nT('remote.title')} onBack={() => navigate(-1)} />
        <Empty text={error || i18nT('remote.notFound')} />
      </>
    )
  }
  const facts = deviceFacts(entity)
  return (
    <div>
      <Header
        title={facts.name}
        subtitle={`${facts.meta.label}${facts.isIr ? i18nT('remote.metaIr') : facts.linkedIr ? i18nT('remote.metaIrWifi') : ''}`}
        onBack={() => navigate(-1)}
      />
      <div className="z-card" style={{ padding: 16 }}>
        <DeviceRemote entity={entity} />
      </div>
    </div>
  )
}

function Header({ title, subtitle, onBack }) {
  return (
    <div className="z-page-head" style={{ alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <button onClick={onBack} className="z-icon-btn" aria-label={i18nT('common.back')}>
          <ArrowLeft size={20} strokeWidth={1.75} className="icon-flip-rtl" />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="z-eyebrow">{i18nT('remote.title')}</p>
          <h1 className="z-display" style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </h1>
          {subtitle && (
            <p className="z-footnote">{subtitle}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function Empty({ text }) {
  return (
    <div className="z-card" style={{ padding: 32, textAlign: 'center' }}>
      <p className="z-body" style={{ color: 'var(--ink-mute)' }}>{text}</p>
    </div>
  )
}

function NotFound({ navigate }) {
  return (
    <>
      <Header title={i18nT('remote.title')} onBack={() => navigate(-1)} />
      <Empty text={i18nT('remote.invalidTarget')} />
    </>
  )
}
