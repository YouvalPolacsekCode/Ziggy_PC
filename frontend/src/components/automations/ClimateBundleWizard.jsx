import React, { useEffect, useMemo, useState } from 'react'
import { Input } from '../ui/Input'
import { useT } from '../../lib/i18n'
import { useDeviceStore } from '../../stores/deviceStore'
import { saveClimate, deleteClimate, getIrDevices } from '../../lib/api'
import { entityDisplayName } from '../../lib/utils'

// ── ClimateBundleWizard ───────────────────────────────────────────────────────
// Smart Climate Control = Ziggy as a thermostat (services/smart_climate_engine).
// A stepped flow: pick a room → a temperature reading → a device to switch on/off
// around a band. Cooling shows first (cool-first Israeli default); an optional
// heating step is added on demand. No setpoint is ever sent to the device —
// Ziggy owns the cutoff, so the only numbers are the on/off temperatures.

const COOL_DEF = { on: 25, off: 24 }   // room ≥25 → cool on; ≤24 → off
const HEAT_DEF = { on: 19, off: 20 }   // room ≤19 → heat on; ≥20 → off
const IR_CLIMATE_TYPES = new Set(['ac', 'air_conditioner', 'split', 'heater'])

// Zigbee/Z2M devices expose config toggles as switch.* sub-entities (do-not-
// disturb, child-lock, permit-join, LED, AI tuning…). Those are NOT actuators —
// they must never appear as a device you can "switch on" for climate.
const SWITCH_CONFIG_DENY = /_(do_not_disturb|child_lock|permit_join|led|led_disabled|led_disabled_night|indicator|ai_[a-z_]+|sensitivity|interference|selfidentification|power_outage_memory|power_on_behavior|auto_update|update|calibration|identify)$|_ai_|permit_join/i
function isRealSwitch(e) {
  if (e.entity_category === 'config' || e.entity_category === 'diagnostic') return false
  return !SWITCH_CONFIG_DENY.test(e.entity_id || '')
}

function deviceHow(t, kind) {
  return {
    climate: t('automations.smartClimate.viaSmart'),
    ir_ac:   t('automations.smartClimate.viaIr'),
    fan:     t('automations.smartClimate.viaFan'),
    switch:  t('automations.smartClimate.viaPlug'),
  }[kind] || ''
}

function DevicePicker({ t, devices, value, onChange }) {
  if (!devices.length) {
    return (
      <p style={{ fontSize: 12, color: 'var(--warn)', padding: '10px 12px', background: 'color-mix(in srgb, var(--warn) 8%, transparent)', borderRadius: 10 }} dir="auto">
        {t('automations.smartClimate.noDevice')}
      </p>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, border: '0.5px solid var(--line)', borderRadius: 10, padding: 6, background: 'var(--surface)' }}>
      {devices.map(d => {
        const sel = value?.kind === d.kind && value?.id === d.id
        return (
          <button key={`${d.kind}:${d.id}`} type="button" onClick={() => onChange(d)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8,
              background: sel ? 'color-mix(in srgb, var(--ok) 9%, transparent)' : 'transparent',
              border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit' }}>
            <span style={{ width: 15, height: 15, borderRadius: 999, flexShrink: 0,
              border: `1.5px solid ${sel ? 'var(--ok)' : 'var(--line)'}`,
              background: sel ? 'var(--ok)' : 'transparent' }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{d.name}</span>
              <span style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-faint)' }} dir="auto">{deviceHow(t, d.kind)}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

// One edge: a device + its on/off temperatures. `dir` is 'cool' | 'heat'.
function EdgeEditor({ t, dir, devices, edge, setEdge }) {
  const onTemp  = edge?.on  ?? (dir === 'cool' ? COOL_DEF.on  : HEAT_DEF.on)
  const offTemp = edge?.off ?? (dir === 'cool' ? COOL_DEF.off : HEAT_DEF.off)
  const device  = edge?.device || null
  const patch = (p) => setEdge({ device, on: onTemp, off: offTemp, ...edge, ...p })

  const onLabel  = dir === 'cool' ? t('automations.smartClimate.coolOn')  : t('automations.smartClimate.heatOn')
  const offLabel = dir === 'cool' ? t('automations.smartClimate.coolOff') : t('automations.smartClimate.heatOff')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <DevicePicker t={t} devices={devices} value={device} onChange={(d) => patch({ device: d })} />
      <div style={{ display: 'flex', gap: 14 }}>
        <div style={{ flex: 1 }}>
          <p className="z-eyebrow" style={{ marginBottom: 6 }}>{onLabel} (°C)</p>
          <Input type="number" inputMode="numeric" min={10} max={35} value={onTemp}
            onChange={e => patch({ on: Number(e.target.value) })} />
        </div>
        <div style={{ flex: 1 }}>
          <p className="z-eyebrow" style={{ marginBottom: 6 }}>{offLabel} (°C)</p>
          <Input type="number" inputMode="numeric" min={10} max={35} value={offTemp}
            onChange={e => patch({ off: Number(e.target.value) })} />
        </div>
      </div>
    </div>
  )
}

// Step shell: eyebrow + step counter + body + Back/primary nav.
function StepShell({ t, title, idx, total, onBack, onPrimary, primaryLabel, primaryDisabled, extra, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 2px' }} dir="auto">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p className="z-eyebrow" style={{ margin: 0 }}>{title}</p>
        <span style={{ fontSize: 10.5, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>{idx}/{total}</span>
      </div>
      {children}
      {extra}
      <div style={{ display: 'flex', gap: 8, paddingTop: 2 }}>
        <button type="button" onClick={onBack} className="z-btn-secondary" style={{ flex: 1, padding: '10px', borderRadius: 10, fontSize: 13 }}>
          {t('automations.smartClimate.back')}
        </button>
        <button type="button" onClick={onPrimary} disabled={primaryDisabled} className="z-btn-primary"
          style={{ flex: 1, padding: '10px', borderRadius: 10, fontSize: 13, opacity: primaryDisabled ? 0.5 : 1 }}>
          {primaryLabel}
        </button>
      </div>
    </div>
  )
}

export default function ClimateBundleWizard({ initial, onSaved, onClose, confirmDelete }) {
  const t = useT()
  const rooms      = useDeviceStore(s => s.rooms)
  const allEntities = useDeviceStore(s => s.entities)

  // room.entities is a list of entity_id STRINGS — resolve to objects (with
  // domain/device_class) through the store's unified entity list. This is the
  // same pattern the occupancy-sensor form uses.
  const entityMap = useMemo(
    () => Object.fromEntries((allEntities || []).map(e => [e.entity_id, e])),
    [allEntities],
  )

  const isUpdate = !!initial?._isInstalled
  const [roomId,  setRoomId]  = useState(initial?.room || '')
  const [sensor,  setSensor]  = useState(initial?.sensor || '')
  // Average mode: watch the mean of the room's temp sensors instead of one.
  const [useAvg,  setUseAvg]  = useState(!!(initial?.sensors && initial.sensors.length))
  const [cooling, setCooling] = useState(initial?.cooling || null)
  const [heating, setHeating] = useState(initial?.heating || null)
  const [showHeating, setShowHeating] = useState(!!initial?.heating)
  const [irDevices, setIrDevices] = useState([])
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)
  // On edit the room is fixed (it's the instance key) — skip the room step.
  const [stepIdx, setStepIdx] = useState(isUpdate ? 1 : 0)

  const room = useMemo(
    () => (rooms || []).find(r => String(r.id) === String(roomId) || r.name === roomId) || null,
    [rooms, roomId],
  )

  // IR devices for the chosen room (AC / heater over the Broadlink).
  useEffect(() => {
    if (!room) { setIrDevices([]); return }
    let alive = true
    getIrDevices(room.name).then(d => { if (alive) setIrDevices(Array.isArray(d) ? d : []) })
                           .catch(() => { if (alive) setIrDevices([]) })
    return () => { alive = false }
  }, [room?.id, room?.name])

  const tempSensors = useMemo(() => {
    return (room?.entities || [])
      .map(id => entityMap[id])
      .filter(e => e && e.domain === 'sensor'
        && (e.device_class === 'temperature' || /temp/i.test(e.entity_id || '')))
  }, [room, entityMap])

  const deviceCandidates = useMemo(() => {
    const out = []
    for (const id of (room?.entities || [])) {
      const e = entityMap[id]
      if (!e) continue
      const name = entityDisplayName(e) || e.entity_id
      if (e.domain === 'climate')     out.push({ kind: 'climate', id: e.entity_id, name, room: room.name })
      else if (e.domain === 'fan')    out.push({ kind: 'fan',     id: e.entity_id, name, room: room.name })
      else if (e.domain === 'switch' && isRealSwitch(e)) out.push({ kind: 'switch', id: e.entity_id, name, room: room.name })
    }
    for (const ir of irDevices) {
      const ty = (ir.type || ir.device_type || '').toLowerCase()
      if (IR_CLIMATE_TYPES.has(ty))
        out.push({ kind: 'ir_ac', id: ir.id, name: ir.name, room: ir.room || room?.name || '' })
    }
    const rank = { climate: 0, fan: 1, switch: 2, ir_ac: 3 }
    return out.sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9))
  }, [room, irDevices, entityMap])

  // Default the reading to the room's first temp sensor when the room changes.
  useEffect(() => {
    if (!room) return
    if (!tempSensors.find(s => s.entity_id === sensor)) {
      setSensor(tempSensors[0]?.entity_id || '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id])

  // Live mean of the room's temp sensors, for the "Average" row label.
  const avgValue = useMemo(() => {
    const vals = tempSensors.map(e => parseFloat(e.state)).filter(v => !Number.isNaN(v))
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null
  }, [tempSensors])

  const hasDevice = (e) => !!e?.device
  const readingOk = useAvg ? tempSensors.length > 0 : !!sensor
  const canSave = !!room && readingOk && (hasDevice(cooling) || (showHeating && hasDevice(heating)))

  const steps = useMemo(
    () => ['room', 'reading', 'cooling', ...(showHeating ? ['heating'] : [])],
    [showHeating],
  )
  const current = steps[stepIdx] || 'room'
  const total = steps.length
  const goBack = () => (stepIdx <= 0 ? onClose?.() : setStepIdx(i => i - 1))
  const goNext = () => setStepIdx(i => Math.min(i + 1, steps.length - 1))

  const handleSave = async () => {
    setSaving(true); setError(null)
    try {
      await saveClimate({
        room: String(room.id),
        roomName: room.name,
        sensor:  useAvg ? '' : sensor,
        sensors: useAvg ? tempSensors.map(e => e.entity_id) : null,
        cooling: hasDevice(cooling) ? cooling : null,
        heating: (showHeating && hasDevice(heating)) ? heating : null,
        enabled: true,
      })
      await onSaved?.({ updated: isUpdate })
    } catch (e) {
      setError(e?.userMessage || e?.message || t('automations.smartClimate.failed')); setSaving(false)
    }
  }
  const handleRemove = async () => {
    if (confirmDelete && !(await confirmDelete(room?.name || t('automations.smartClimate.title')))) return
    setSaving(true); setError(null)
    try { await deleteClimate(String(room.id)); await onSaved?.({ removed: true }) }
    catch (e) { setError(e?.userMessage || e?.message || t('automations.smartClimate.failed')); setSaving(false) }
  }

  const errBox = error && (
    <p style={{ fontSize: 12, color: 'var(--accent)', padding: '8px 10px', borderRadius: 8, background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>{error}</p>
  )

  // ── Step: Room ─────────────────────────────────────────────────────────────
  if (current === 'room') {
    return (
      <StepShell t={t} title={t('automations.smartClimate.room')} idx={1} total={total}
        onBack={onClose} onPrimary={goNext} primaryLabel={t('automations.smartClimate.next')}
        primaryDisabled={!room}>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, margin: 0 }} dir="auto">
          {t('automations.smartClimate.subtitle')}
        </p>
        {(rooms || []).length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--ink-faint)' }} dir="auto">{t('automations.smartClimate.noRooms')}</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {(rooms || []).map(r => {
              const sel = String(r.id) === String(roomId)
              return (
                <button key={r.id} type="button"
                  onClick={() => { setRoomId(String(r.id)); setCooling(null); setHeating(null); setShowHeating(false) }}
                  style={{ padding: '10px 12px', borderRadius: 10, textAlign: 'start', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
                    border: `1px solid ${sel ? 'var(--ok)' : 'var(--line)'}`,
                    background: sel ? 'color-mix(in srgb, var(--ok) 9%, transparent)' : 'var(--surface)',
                    color: 'var(--ink)' }} dir="auto">
                  {r.name}
                </button>
              )
            })}
          </div>
        )}
      </StepShell>
    )
  }

  // ── Step: Temperature reading ──────────────────────────────────────────────
  if (current === 'reading') {
    return (
      <StepShell t={t} title={t('automations.smartClimate.reading')} idx={stepIdx + 1} total={total}
        onBack={goBack} onPrimary={goNext} primaryLabel={t('automations.smartClimate.next')}
        primaryDisabled={!readingOk}>
        {tempSensors.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--warn)', padding: '10px 12px', background: 'color-mix(in srgb, var(--warn) 8%, transparent)', borderRadius: 10 }} dir="auto">
            {t('automations.smartClimate.noSensor')}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, border: '0.5px solid var(--line)', borderRadius: 10, padding: 6, background: 'var(--surface)' }}>
            {/* Average of all the room's sensors — only meaningful with 2+. */}
            {tempSensors.length >= 2 && (
              <button type="button" onClick={() => setUseAvg(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8,
                  background: useAvg ? 'color-mix(in srgb, var(--ok) 9%, transparent)' : 'transparent',
                  border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit' }}>
                <span style={{ width: 15, height: 15, borderRadius: 999, flexShrink: 0,
                  border: `1.5px solid ${useAvg ? 'var(--ok)' : 'var(--line)'}`, background: useAvg ? 'var(--ok)' : 'transparent' }} />
                <span style={{ fontSize: 13, color: 'var(--ink)', flex: 1, fontWeight: 600 }} dir="auto">
                  {t('automations.smartClimate.avgOption', { n: tempSensors.length })}{avgValue != null ? ` · ${avgValue}°` : ''}
                </span>
              </button>
            )}
            {tempSensors.map(e => {
              const sel = !useAvg && e.entity_id === sensor
              const val = e.state != null && e.state !== '' ? ` · ${e.state}°` : ''
              return (
                <button key={e.entity_id} type="button" onClick={() => { setUseAvg(false); setSensor(e.entity_id) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8,
                    background: sel ? 'color-mix(in srgb, var(--ok) 9%, transparent)' : 'transparent',
                    border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit' }}>
                  <span style={{ width: 15, height: 15, borderRadius: 999, flexShrink: 0,
                    border: `1.5px solid ${sel ? 'var(--ok)' : 'var(--line)'}`, background: sel ? 'var(--ok)' : 'transparent' }} />
                  <span style={{ fontSize: 13, color: 'var(--ink)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">
                    {entityDisplayName(e) || e.entity_id}{val}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </StepShell>
    )
  }

  // ── Step: Cooling ──────────────────────────────────────────────────────────
  if (current === 'cooling') {
    return (
      <StepShell t={t} title={`❄️ ${t('automations.smartClimate.cooling')}`} idx={stepIdx + 1} total={total}
        onBack={goBack} onPrimary={handleSave} primaryLabel={isUpdate ? t('automations.smartClimate.update') : t('automations.smartClimate.confirm')}
        primaryDisabled={!canSave || saving}
        extra={
          <>
            {!showHeating && (
              <button type="button" onClick={() => { setShowHeating(true); setStepIdx(steps.length) }}
                style={{ alignSelf: 'flex-start', background: 'none', border: '1px dashed var(--line)', borderRadius: 10, padding: '9px 14px', fontSize: 12.5, color: 'var(--ink-mute)', cursor: 'pointer', fontFamily: 'inherit' }} dir="auto">
                + {t('automations.smartClimate.addHeating')}
              </button>
            )}
            {isUpdate && (
              <button type="button" onClick={handleRemove} disabled={saving} className="z-btn-secondary"
                style={{ alignSelf: 'flex-start', padding: '7px 12px', borderRadius: 9, fontSize: 12, color: 'var(--accent)' }}>
                {t('automations.smartClimate.delete')}
              </button>
            )}
            {errBox}
          </>
        }>
        <p style={{ fontSize: 12, color: 'var(--ink-faint)', margin: 0 }} dir="auto">{t('automations.smartClimate.coolingHint')}</p>
        <EdgeEditor t={t} dir="cool" devices={deviceCandidates} edge={cooling} setEdge={setCooling} />
      </StepShell>
    )
  }

  // ── Step: Heating (opt-in) ─────────────────────────────────────────────────
  return (
    <StepShell t={t} title={`🔥 ${t('automations.smartClimate.heating')}`} idx={stepIdx + 1} total={total}
      onBack={goBack} onPrimary={handleSave} primaryLabel={isUpdate ? t('automations.smartClimate.update') : t('automations.smartClimate.confirm')}
      primaryDisabled={!canSave || saving}
      extra={
        <>
          <button type="button" onClick={() => { setShowHeating(false); setHeating(null); setStepIdx(2) }}
            className="z-btn-secondary" style={{ alignSelf: 'flex-start', padding: '7px 12px', borderRadius: 9, fontSize: 12 }}>
            {t('common.remove')}
          </button>
          {errBox}
        </>
      }>
      <p style={{ fontSize: 12, color: 'var(--ink-faint)', margin: 0 }} dir="auto">{t('automations.smartClimate.heatingHint')}</p>
      <EdgeEditor t={t} dir="heat" devices={deviceCandidates} edge={heating} setEdge={setHeating} />
    </StepShell>
  )
}
