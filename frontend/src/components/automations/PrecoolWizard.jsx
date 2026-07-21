import React, { useEffect, useMemo, useState } from 'react'
import { Input } from '../ui/Input'
import { Toggle } from '../ui/Toggle'
import { useT } from '../../lib/i18n'
import { useDeviceStore } from '../../stores/deviceStore'
import {
  createAutomation, deleteAutomation, getPresencePersons,
  getPresenceZone, listPresenceZones, createPresenceZone, updatePresenceZone,
} from '../../lib/api'
import { entityDisplayName } from '../../lib/utils'

// ── PrecoolWizard ─────────────────────────────────────────────────────────────
// Dedicated view/edit for Pre-cool on Arrival. One modal for create + edit.
//
// The whole point is HEAD START: start the AC while you're still on your way, so
// the room is cool when you walk in. So the trigger is Ziggy's native
// `zone_entered` on a wide "Near Home" zone (a ring around home you cross a few
// minutes out) — NOT arriving at the doorstep. The wizard owns that zone: it
// creates/resizes a "Near Home" geofence centred on your Home zone at the chosen
// radius. Presence comes from Ziggy's OWN engine (Settings → Track my location),
// same as Leave Home — so it only works once you're actually being tracked.
//
// Actions run natively (climate.turn_on + set_temperature, or IR power-on) — no
// flaky send_intent.

const PRECOOL_ID = 'ziggy_precool_arrival'
const NEAR_HOME_NAME = 'Near Home'
const DEFAULT_TEMP = 24     // Israeli AC default
const DEFAULT_RADIUS_KM = 2

export default function PrecoolWizard({ initial, onSaved, onClose, confirmDelete }) {
  const t = useT()
  const storeEntities = useDeviceStore((s) => s.entities)

  const [persons, setPersons] = useState([])
  const [homeZone, setHomeZone] = useState(null)
  const [zones, setZones] = useState([])

  // AC candidates: smart climate entities + IR ACs (ir.* ids). Temp sensors for
  // the optional "only when it's warm" guard.
  const acEnts = useMemo(
    () => storeEntities.filter((e) => e.domain === 'climate' || String(e.entity_id).startsWith('ir.')),
    [storeEntities])
  const tempEnts = useMemo(
    () => storeEntities.filter((e) => e.domain === 'sensor' && e.device_class === 'temperature'),
    [storeEntities])

  useEffect(() => {
    let alive = true
    getPresencePersons().then((r) => { if (alive) setPersons(r?.persons || []) }).catch(() => {})
    getPresenceZone().then((z) => { if (alive) setHomeZone(z && z.configured !== false && z.lat != null ? z : null) }).catch(() => {})
    listPresenceZones().then((r) => { if (alive) setZones(r?.zones || []) }).catch(() => {})
    return () => { alive = false }
  }, [])

  const isUpdate = !!initial?._isInstalled
  const presenceOn = persons.length > 0
  const nearZone = useMemo(() => zones.find((z) => (z.name || '').toLowerCase() === NEAR_HOME_NAME.toLowerCase()), [zones])

  // Derive initial state from the existing automation (edit) or defaults.
  const derived = useMemo(() => {
    const acts = initial?.actions || []
    const setTemp = acts.find((a) => a.type === 'call_service' && a.service === 'climate.set_temperature')
    const conds = initial?.conditions || []
    const hot = conds.find((c) => c.operator === 'above' && c.entity_id)
    // AC: from a call_service on a climate entity, or an ir_command device.
    const acAct = acts.find((a) => (a.type === 'call_service' && String(a.entity_id).startsWith('climate')) || a.type === 'ir_command')
    const acId = acAct?.type === 'ir_command' ? `ir.${acAct.ir_device_id}` : (acAct?.entity_id || '')
    return {
      acId,
      temp: setTemp?.service_data?.temperature ?? DEFAULT_TEMP,
      onlyHot: isUpdate ? !!hot : true,
      hotEntity: hot?.entity_id || '',
      hotThreshold: hot ? Number(hot.value) : DEFAULT_TEMP,
      notify: isUpdate ? acts.some((a) => a.type === 'notify') : true,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [acId, setAcId] = useState(derived.acId)
  const [temp, setTemp] = useState(derived.temp)
  const [radiusKm, setRadiusKm] = useState(() => (nearZone ? Math.round((nearZone.radius_m / 1000) * 10) / 10 : DEFAULT_RADIUS_KM))
  const [onlyHot, setOnlyHot] = useState(derived.onlyHot)
  const [hotEntity, setHotEntity] = useState(derived.hotEntity)
  const [hotThreshold, setHotThreshold] = useState(derived.hotThreshold)
  const [notify, setNotify] = useState(derived.notify)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Default the AC + hot-sensor once candidates load (create flow).
  useEffect(() => {
    if (!acId && acEnts[0]) setAcId(acEnts[0].entity_id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acEnts])
  useEffect(() => {
    if (!hotEntity && tempEnts[0]) setHotEntity(tempEnts[0].entity_id)
    if (nearZone) setRadiusKm(Math.round((nearZone.radius_m / 1000) * 10) / 10)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tempEnts, nearZone])

  const acObj = acEnts.find((e) => e.entity_id === acId)
  const canSave = presenceOn && !!homeZone && !!acId && !saving

  const acActions = () => {
    if (!acObj) return []
    if (String(acObj.entity_id).startsWith('ir.')) {
      // IR AC: power on to cool (temp set over IR is device-specific — power-on
      // puts it in its last/cool state, which is the reliable move).
      return [{ type: 'ir_command', ir_device_id: acObj.entity_id.slice(3), ir_command: 'power_on' }]
    }
    return [
      { type: 'call_service', entity_id: acObj.entity_id, service: 'climate.turn_on', service_value: 'turn_on' },
      { type: 'call_service', entity_id: acObj.entity_id, service: 'climate.set_temperature', service_value: 'set_temperature', service_data: { temperature: Number(temp) || DEFAULT_TEMP } },
    ]
  }

  // Ensure the "Near Home" geofence exists at the chosen radius, centred on Home.
  const ensureNearZone = async () => {
    const radius_m = Math.max(300, Math.round((Number(radiusKm) || DEFAULT_RADIUS_KM) * 1000))
    if (nearZone) {
      if (Math.abs((nearZone.radius_m || 0) - radius_m) > 1) await updatePresenceZone(nearZone.id, { radius_m })
      return
    }
    await createPresenceZone({ name: NEAR_HOME_NAME, lat: homeZone.lat, lon: homeZone.lon, radius_m })
  }

  const buildPrecool = () => {
    const conditions = []
    if (onlyHot && hotEntity) conditions.push({ entity_id: hotEntity, operator: 'above', value: String(Number(hotThreshold) || DEFAULT_TEMP) })
    const actions = [...acActions()]
    if (notify) actions.push({ type: 'notify', title: 'Pre-cool on Arrival', message: t('automations.precool.notifyMsg') })
    return {
      id: initial?.id || PRECOOL_ID, name: 'Pre-cool on Arrival', description: t('automations.precool.desc'),
      trigger: { type: 'zone_entered', zone: NEAR_HOME_NAME, person: '*' },
      conditions, actions, rooms: [],
    }
  }

  const handleSave = async () => {
    setSaving(true); setError(null)
    try {
      await ensureNearZone()
      await createAutomation(buildPrecool())
      await onSaved?.({ updated: isUpdate })
    } catch (e) {
      setError(e?.userMessage || e?.message || t('automations.precool.failed')); setSaving(false)
    }
  }
  const handleRemove = async () => {
    if (confirmDelete && !(await confirmDelete(t('automations.precool.title')))) return
    setSaving(true); setError(null)
    try {
      await deleteAutomation(initial?.id || PRECOOL_ID)
      await onSaved?.({ removed: true })
    } catch (e) { setError(e?.userMessage || e?.message || t('automations.precool.failed')); setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 2px' }} dir="auto">
      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, margin: 0 }} dir="auto">{t('automations.precool.subtitle')}</p>

      {/* Presence gate */}
      {!presenceOn && (
        <p style={{ fontSize: 12, color: 'var(--warn)', padding: '10px 12px', background: 'color-mix(in srgb, var(--warn) 8%, transparent)', borderRadius: 10 }} dir="auto">{t('automations.precool.needPresence')}</p>
      )}
      {presenceOn && !homeZone && (
        <p style={{ fontSize: 12, color: 'var(--warn)', padding: '10px 12px', background: 'color-mix(in srgb, var(--warn) 8%, transparent)', borderRadius: 10 }} dir="auto">{t('automations.precool.needHomeZone')}</p>
      )}

      {/* Head-start distance */}
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.precool.headStartLabel')}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }} dir="auto">{t('automations.precool.withinKm')}</span>
          <div style={{ width: 74 }}><Input type="number" inputMode="decimal" min={0.3} max={20} step={0.5} value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} /></div>
          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }} dir="auto">{t('automations.precool.km')}</span>
        </div>
        <p style={{ fontSize: 10.5, color: 'var(--ink-faint)', margin: '6px 2px 0' }} dir="auto">{t('automations.precool.headStartHint')}</p>
      </div>

      {/* Which AC */}
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.precool.acLabel')}</p>
        {acEnts.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--warn)', padding: '10px 12px', background: 'color-mix(in srgb, var(--warn) 8%, transparent)', borderRadius: 10 }} dir="auto">{t('automations.precool.noAc')}</p>
        ) : acEnts.length === 1 ? (
          <p style={{ fontSize: 12.5, color: 'var(--ink)', padding: '9px 11px', border: '0.5px solid var(--line)', borderRadius: 10, background: 'var(--surface)' }} dir="auto">❄️ {entityDisplayName(acEnts[0]) || acEnts[0].entity_id}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, border: '0.5px solid var(--line)', borderRadius: 10, padding: 5, background: 'var(--surface)' }}>
            {acEnts.map((e) => {
              const sel = e.entity_id === acId
              return (
                <button key={e.entity_id} type="button" onClick={() => setAcId(e.entity_id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 7, background: sel ? 'color-mix(in srgb, var(--ok) 9%, transparent)' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit' }}>
                  <span style={{ width: 13, height: 13, borderRadius: 999, flexShrink: 0, border: `1.5px solid ${sel ? 'var(--ok)' : 'var(--line)'}`, background: sel ? 'var(--ok)' : 'transparent' }} />
                  <span style={{ fontSize: 12.5, color: 'var(--ink)' }} dir="auto">❄️ {entityDisplayName(e) || e.entity_id}</span>
                </button>
              )
            })}
          </div>
        )}
        {/* Target temp — smart AC only (IR power-on can't set a setpoint) */}
        {acObj && !String(acObj.entity_id).startsWith('ir.') && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--ink-mute)' }} dir="auto">{t('automations.precool.coolTo')}</span>
            <div style={{ width: 64 }}><Input type="number" inputMode="numeric" min={16} max={30} value={temp} onChange={(e) => setTemp(e.target.value)} /></div>
            <span style={{ fontSize: 12, color: 'var(--ink-mute)' }} dir="auto">°C</span>
          </div>
        )}
      </div>

      {/* Only when warm + Notify */}
      <div style={{ border: '0.5px solid var(--line)', borderRadius: 12, background: 'var(--surface)' }}>
        {tempEnts.length > 0 && (
          <Row label={`🌡️ ${t('automations.precool.onlyHot')}`} sub={onlyHot ? t('automations.precool.onlyHotSub', { n: hotThreshold }) : undefined} checked={onlyHot} onChange={setOnlyHot} />
        )}
        {onlyHot && tempEnts.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 13px 11px' }}>
            <span style={{ fontSize: 12, color: 'var(--ink-mute)' }} dir="auto">{t('automations.precool.warmerThan')}</span>
            <div style={{ width: 60 }}><Input type="number" inputMode="numeric" min={16} max={35} value={hotThreshold} onChange={(e) => setHotThreshold(e.target.value)} /></div>
            <span style={{ fontSize: 12, color: 'var(--ink-mute)' }} dir="auto">°C</span>
          </div>
        )}
        <Row label={`🔔 ${t('automations.precool.notify')}`} checked={notify} onChange={setNotify} border={tempEnts.length > 0} />
      </div>

      {error && <p style={{ fontSize: 12, color: 'var(--accent)', padding: '8px 10px', borderRadius: 8, background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
        <div>{isUpdate && (
          <button type="button" onClick={handleRemove} disabled={saving} className="z-btn-secondary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13, color: 'var(--accent)' }}>{t('automations.precool.delete')}</button>
        )}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose} className="z-btn-secondary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13 }}>{t('common.cancel')}</button>
          <button type="button" onClick={handleSave} disabled={!canSave} className="z-btn-primary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13, opacity: canSave ? 1 : 0.5 }}>{isUpdate ? t('automations.precool.update') : t('automations.precool.confirm')}</button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, sub, checked, onChange, border }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 13px', borderTop: border ? '0.5px solid var(--line)' : 'none' }}>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, color: 'var(--ink)' }} dir="auto">{label}</span>
        {sub && <span style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 1 }} dir="auto">{sub}</span>}
      </span>
      <Toggle checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
