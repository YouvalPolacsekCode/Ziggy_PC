import React, { useEffect, useMemo, useState } from 'react'
import { Input } from '../ui/Input'
import { useT } from '../../lib/i18n'
import { useDeviceStore } from '../../stores/deviceStore'
import { saveClimate, deleteClimate, getIrDevices } from '../../lib/api'

// ── ClimateBundleWizard ───────────────────────────────────────────────────────
// Smart Climate Control = Ziggy as a thermostat (services/smart_climate_engine).
// Pick a room → a temperature reading → a device to switch on/off around a band.
// Cooling shows first (cool-first Israeli default); "+ Add heating" reveals the
// low edge. No setpoint is ever sent to the device — Ziggy owns the cutoff, so
// the only numbers are the room's turn-on / turn-off temperatures.

const COOL_DEF = { on: 25, off: 24 }   // room ≥25 → cool on; ≤24 → off
const HEAT_DEF = { on: 19, off: 20 }   // room ≤19 → heat on; ≥20 → off
const IR_CLIMATE_TYPES = new Set(['ac', 'air_conditioner', 'split', 'heater'])

function deviceLabel(t, d) {
  const how = {
    climate: t('automations.smartClimate.viaSmart'),
    ir_ac:   t('automations.smartClimate.viaIr'),
    fan:     t('automations.smartClimate.viaFan'),
    switch:  t('automations.smartClimate.viaPlug'),
  }[d.kind] || ''
  return { name: d.name, how }
}

function DevicePicker({ t, devices, value, onChange, emptyKey }) {
  if (!devices.length) {
    return (
      <p style={{ fontSize: 12, color: 'var(--warn)', padding: '10px 12px', background: 'color-mix(in srgb, var(--warn) 8%, transparent)', borderRadius: 10 }} dir="auto">
        {t(emptyKey)}
      </p>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, border: '0.5px solid var(--line)', borderRadius: 10, padding: 6, background: 'var(--surface)' }}>
      {devices.map(d => {
        const sel = value?.kind === d.kind && value?.id === d.id
        const { name, how } = deviceLabel(t, d)
        return (
          <button key={`${d.kind}:${d.id}`} type="button" onClick={() => onChange(d)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8,
              background: sel ? 'color-mix(in srgb, var(--ok) 9%, transparent)' : 'transparent',
              border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit' }}>
            <span style={{ width: 15, height: 15, borderRadius: 999, flexShrink: 0,
              border: `1.5px solid ${sel ? 'var(--ok)' : 'var(--line)'}`,
              background: sel ? 'var(--ok)' : 'transparent' }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{name}</span>
              <span style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-faint)' }} dir="auto">{how}</span>
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
      <DevicePicker t={t} devices={devices} value={device}
        onChange={(d) => patch({ device: d })}
        emptyKey="automations.smartClimate.noDevice" />
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

export default function ClimateBundleWizard({ initial, onSaved, onClose }) {
  const t = useT()
  const rooms = useDeviceStore(s => s.rooms)

  const initRoom = initial?.room || ''
  const [roomId,  setRoomId]  = useState(initRoom)
  const [sensor,  setSensor]  = useState(initial?.sensor || '')
  const [cooling, setCooling] = useState(initial?.cooling || null)
  const [heating, setHeating] = useState(initial?.heating || null)
  const [showHeating, setShowHeating] = useState(!!initial?.heating)
  const [irDevices, setIrDevices] = useState([])
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)

  const isUpdate = !!initial?._isInstalled
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
    const ents = room?.entities || []
    return ents.filter(e => e?.domain === 'sensor'
      && (e.device_class === 'temperature' || /temp/i.test(e.entity_id || '')))
  }, [room])

  const deviceCandidates = useMemo(() => {
    const out = []
    for (const e of (room?.entities || [])) {
      const name = e.friendly_name || e.display_name || e.name || e.entity_id
      if (e.domain === 'climate')     out.push({ kind: 'climate', id: e.entity_id, name, room: room.name })
      else if (e.domain === 'fan')    out.push({ kind: 'fan',     id: e.entity_id, name, room: room.name })
      else if (e.domain === 'switch') out.push({ kind: 'switch',  id: e.entity_id, name, room: room.name })
    }
    for (const ir of irDevices) {
      const ty = (ir.type || ir.device_type || '').toLowerCase()
      if (IR_CLIMATE_TYPES.has(ty))
        out.push({ kind: 'ir_ac', id: ir.id, name: ir.name, room: ir.room || room?.name || '' })
    }
    // Prefer smart (true state) over IR — surface smart entities first.
    const rank = { climate: 0, fan: 1, switch: 2, ir_ac: 3 }
    return out.sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9))
  }, [room, irDevices])

  // Default the reading to the room's first temp sensor when the room changes.
  useEffect(() => {
    if (!room) return
    if (!tempSensors.find(s => s.entity_id === sensor)) {
      setSensor(tempSensors[0]?.entity_id || '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id])

  const hasDevice = (e) => !!e?.device
  const canSave = !!room && !!sensor && (hasDevice(cooling) || (showHeating && hasDevice(heating))) && !saving

  const handleConfirm = async () => {
    setSaving(true); setError(null)
    try {
      await saveClimate({
        room: String(room.id),
        roomName: room.name,
        sensor,
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
    setSaving(true); setError(null)
    try { await deleteClimate(String(room.id)); await onSaved?.({ removed: true }) }
    catch (e) { setError(e?.userMessage || e?.message || t('automations.smartClimate.failed')); setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 2px' }}>
      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }} dir="auto">
        {t('automations.smartClimate.subtitle')}
      </p>

      {/* Step 1 — Room */}
      <div>
        <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.smartClimate.room')}</p>
        {(rooms || []).length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--ink-faint)' }} dir="auto">{t('automations.smartClimate.noRooms')}</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {(rooms || []).map(r => {
              const sel = String(r.id) === String(roomId)
              return (
                <button key={r.id} type="button" onClick={() => { setRoomId(String(r.id)); if (!isUpdate) { setCooling(null); setHeating(null) } }}
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
      </div>

      {room && (
        <>
          {/* Step 2 — Temperature reading */}
          <div>
            <p className="z-eyebrow" style={{ marginBottom: 8 }}>{t('automations.smartClimate.reading')}</p>
            {tempSensors.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--warn)', padding: '10px 12px', background: 'color-mix(in srgb, var(--warn) 8%, transparent)', borderRadius: 10 }} dir="auto">
                {t('automations.smartClimate.noSensor')}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, border: '0.5px solid var(--line)', borderRadius: 10, padding: 6, background: 'var(--surface)' }}>
                {tempSensors.map(e => {
                  const sel = e.entity_id === sensor
                  const val = e.state != null && e.state !== '' ? ` · ${e.state}°` : ''
                  return (
                    <button key={e.entity_id} type="button" onClick={() => setSensor(e.entity_id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8,
                        background: sel ? 'color-mix(in srgb, var(--ok) 9%, transparent)' : 'transparent',
                        border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit' }}>
                      <span style={{ width: 15, height: 15, borderRadius: 999, flexShrink: 0,
                        border: `1.5px solid ${sel ? 'var(--ok)' : 'var(--line)'}`, background: sel ? 'var(--ok)' : 'transparent' }} />
                      <span style={{ fontSize: 13, color: 'var(--ink)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">
                        {e.friendly_name || e.display_name || e.name || e.entity_id}{val}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Step 3 — Cooling (default) */}
          <div style={{ border: '0.5px solid var(--line)', borderRadius: 12, padding: '12px 14px', background: 'var(--surface)' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: '0 0 2px' }} dir="auto">❄️ {t('automations.smartClimate.cooling')}</p>
            <p style={{ fontSize: 11, color: 'var(--ink-faint)', margin: '0 0 12px' }} dir="auto">{t('automations.smartClimate.coolingHint')}</p>
            <EdgeEditor t={t} dir="cool" devices={deviceCandidates} edge={cooling} setEdge={setCooling} />
          </div>

          {/* Step 4 — Heating (opt-in) */}
          {showHeating ? (
            <div style={{ border: '0.5px solid var(--line)', borderRadius: 12, padding: '12px 14px', background: 'var(--surface)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', margin: '0 0 2px' }} dir="auto">🔥 {t('automations.smartClimate.heating')}</p>
                <button type="button" onClick={() => { setShowHeating(false); setHeating(null) }}
                  className="z-btn-secondary" style={{ fontSize: 11, padding: '3px 8px', borderRadius: 8 }}>
                  {t('common.remove')}
                </button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--ink-faint)', margin: '0 0 12px' }} dir="auto">{t('automations.smartClimate.heatingHint')}</p>
              <EdgeEditor t={t} dir="heat" devices={deviceCandidates} edge={heating} setEdge={setHeating} />
            </div>
          ) : (
            <button type="button" onClick={() => setShowHeating(true)}
              style={{ alignSelf: 'flex-start', background: 'none', border: '1px dashed var(--line)', borderRadius: 10, padding: '9px 14px', fontSize: 12.5, color: 'var(--ink-mute)', cursor: 'pointer', fontFamily: 'inherit' }} dir="auto">
              + {t('automations.smartClimate.addHeating')}
            </button>
          )}
        </>
      )}

      {error && (
        <p style={{ fontSize: 12, color: 'var(--accent)', padding: '8px 10px', borderRadius: 8, background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>{error}</p>
      )}

      {/* Footer */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          {isUpdate && (
            <button type="button" onClick={handleRemove} disabled={saving} className="z-btn-secondary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13, color: 'var(--accent)' }}>
              {t('automations.smartClimate.delete')}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose} className="z-btn-secondary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13 }}>{t('common.cancel')}</button>
          <button type="button" onClick={handleConfirm} disabled={!canSave} className="z-btn-primary" style={{ padding: '9px 14px', borderRadius: 10, fontSize: 13, opacity: canSave ? 1 : 0.5 }}>
            {isUpdate ? t('automations.smartClimate.update') : t('automations.smartClimate.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
