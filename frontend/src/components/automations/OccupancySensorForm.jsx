import React, { useEffect, useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { useDeviceStore } from '../../stores/deviceStore'
import { createOccupancySensor } from '../../lib/api'
import { Input } from '../ui/Input'
import { entityDisplayName } from '../../lib/utils'
import { noteBox } from '../../lib/automations/styles'

// ── OccupancySensorForm ────────────────────────────────────────────────────
//
// Stepped creator for a Ziggy smart presence sensor (matches the automation
// wizards' vibe): pick a room → pick the actual sensors to combine (by name,
// not abstract signal types) → set the clear delay. Fuses the chosen binary
// sensors into one "is anyone here" entity via POST /api/occupancy-sensors.
//
// Reused from the Automation Builder's "someone is in a room" trigger and the
// Library CTA — callers supply the modal chrome; this is just the panel.
//
// room.entities from /api/rooms are entity_id STRINGS, so resolve them through
// the store's entity list before reading domain/device_class.

// binary_sensor device_class → the friendly signal type we show.
const OCC_TYPE = {
  motion: 'motion',
  presence: 'presence', occupancy: 'presence',
  door: 'door', opening: 'door',
}

function StepShell({ t, title, idx, total, onBack, onPrimary, primaryLabel, primaryDisabled, extra, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 2px' }} dir="auto">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p className="z-eyebrow" style={{ margin: 0 }}>{title}</p>
        <span className="z-footnote z-mono" style={{ color: 'var(--ink-faint)' }}>{idx}/{total}</span>
      </div>
      {children}
      {extra}
      <div style={{ display: 'flex', gap: 8, paddingTop: 2 }}>
        <button type="button" onClick={onBack} className="z-btn-secondary" style={{ flex: 1 }}>
          {t('automations.smartSensor.back')}
        </button>
        <button type="button" onClick={onPrimary} disabled={primaryDisabled} className="z-btn-primary"
          style={{ flex: 1, opacity: primaryDisabled ? 0.5 : 1 }}>
          {primaryLabel}
        </button>
      </div>
    </div>
  )
}

export default function OccupancySensorForm({ onCreated, onClose, initialRoom = '' }) {
  const t = useT()
  const rooms = useDeviceStore(s => s.rooms)
  const allEntities = useDeviceStore(s => s.entities)
  const occupancySensors = useDeviceStore(s => s.occupancySensors)
  const entityMap = useMemo(
    () => Object.fromEntries((allEntities || []).map(e => [e.entity_id, e])),
    [allEntities],
  )
  // Ziggy's own fused presence sensors are NOT valid sources — you can't build a
  // fused sensor out of another fused sensor. Exclude them from the candidates.
  const fusedIds = useMemo(
    () => new Set((occupancySensors || []).map(s => s.entity_id).filter(Boolean)),
    [occupancySensors],
  )

  const roomOptions = useMemo(() => (rooms || []).map(r => ({
    ...r,
    candidates: (r.entities || [])
      .map(id => entityMap[id])
      .filter(e => e && e.domain === 'binary_sensor' && OCC_TYPE[e.device_class] && !fusedIds.has(e.entity_id)),
  })), [rooms, entityMap, fusedIds])

  const initId = useMemo(() => {
    if (initialRoom) {
      const hit = roomOptions.find(r => String(r.id) === String(initialRoom) || r.name === initialRoom)
      if (hit) return String(hit.id)
    }
    return String((roomOptions.find(r => r.candidates.length) || roomOptions[0])?.id || '')
  }, [initialRoom, roomOptions])

  const [roomId, setRoomId]   = useState(initId)
  const [selected, setSelected] = useState(() => new Set())
  const [delayOff, setDelayOff] = useState(30)
  const [walkoutGrace, setWalkoutGrace] = useState(120)
  const [mode, setMode]       = useState('replace')   // 'replace' main | 'new' additional
  const [newName, setNewName] = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [stepIdx, setStepIdx] = useState(initialRoom ? 1 : 0)

  const room = roomOptions.find(r => String(r.id) === String(roomId)) || null
  const candidates = room?.candidates || []

  // Sensors already created for this room — a second create would REPLACE the
  // main one unless the user explicitly adds a new named sensor (e.g. an
  // en-suite bathroom zone inside the bedroom).
  const existingForRoom = useMemo(() => {
    if (!room) return []
    const rid = String(room.id).toLowerCase(), rn = (room.name || '').toLowerCase()
    return (occupancySensors || []).filter(s => {
      const sr = String(s.room || '').toLowerCase()
      return sr === rid || sr === rn || sr.replace(/_/g, ' ') === rn
    })
  }, [occupancySensors, room])

  // Door among the selection → Ziggy backs the sensor with door-aware logic
  // (open = someone came in; closed with movement inside = stays occupied
  // until the door opens). Adds one timing knob: the walk-out grace.
  const hasDoor = useMemo(
    () => candidates.some(e => selected.has(e.entity_id) && OCC_TYPE[e.device_class] === 'door'),
    [candidates, selected],
  )

  // Default-select every fusable sensor when the room changes.
  useEffect(() => {
    setSelected(new Set(candidates.map(e => e.entity_id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  const steps = ['room', 'devices', 'delay']
  const current = steps[stepIdx]
  const total = steps.length
  const goBack = () => (stepIdx <= 0 ? onClose?.() : setStepIdx(i => i - 1))
  const goNext = () => setStepIdx(i => Math.min(i + 1, steps.length - 1))
  const toggle = (id) => setSelected(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const handleCreate = async () => {
    if (!room || selected.size === 0) return
    setSaving(true); setError('')
    try {
      const addingNew = existingForRoom.length > 0 && mode === 'new'
      const result = await createOccupancySensor({
        room: room.name,
        sensor_entities: Array.from(selected),
        delay_off_seconds: Number(delayOff) || 30,
        ...(hasDoor ? { walkout_grace_seconds: Number(walkoutGrace) || 120 } : {}),
        ...(addingNew ? { create_new: true, friendly_name: newName.trim() } : {}),
      })
      onCreated?.(result)
      onClose?.()
    } catch (e) {
      setError(e?.userMessage || e?.message || t('automations.smartSensor.failed')); setSaving(false)
    }
  }

  const errBox = error && (
    <p className="z-subhead" role="alert" style={{ color: 'var(--err-text)', padding: '12px 16px', borderRadius: 'var(--r-ctl)', margin: 0,
      background: 'color-mix(in srgb, var(--err) 8%, var(--surface))', border: '0.5px solid color-mix(in srgb, var(--err) 30%, var(--line))' }}>{error}</p>
  )

  // ── Step: Room ──────────────────────────────────────────────────────────
  if (current === 'room') {
    return (
      <StepShell t={t} title={t('automations.smartSensor.roomLabel')} idx={1} total={total}
        onBack={onClose} onPrimary={goNext} primaryLabel={t('automations.smartSensor.next')}
        primaryDisabled={!room || candidates.length === 0}>
        <p className="z-subhead" style={{ color: 'var(--ink-2)', margin: 0 }} dir="auto">
          {t('automations.smartSensor.intro')}
        </p>
        {roomOptions.length === 0 ? (
          <p className="z-subhead" style={{ margin: 0 }} dir="auto">{t('automations.smartSensor.noneFound')}</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {roomOptions.map(r => {
              const sel = String(r.id) === String(roomId)
              const disabled = r.candidates.length === 0
              return (
                <button key={r.id} type="button" disabled={disabled} aria-pressed={sel}
                  onClick={() => setRoomId(String(r.id))}
                  title={disabled ? t('automations.smartSensor.noDevices') : undefined}
                  className="z-btn-secondary"
                  style={{ justifyContent: 'flex-start', textAlign: 'start',
                    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
                    border: sel ? '1px solid var(--ok)' : undefined,
                    background: sel ? 'color-mix(in srgb, var(--ok) 9%, var(--surface))' : undefined }} dir="auto">
                  {r.name}
                </button>
              )
            })}
          </div>
        )}
      </StepShell>
    )
  }

  // ── Step: Devices ───────────────────────────────────────────────────────
  if (current === 'devices') {
    const needsName = existingForRoom.length > 0 && mode === 'new' && !newName.trim()
    return (
      <StepShell t={t} title={t('automations.smartSensor.devicesLabel')} idx={stepIdx + 1} total={total}
        onBack={goBack} onPrimary={goNext} primaryLabel={t('automations.smartSensor.next')}
        primaryDisabled={selected.size === 0 || needsName}
        extra={candidates.length > 0 && (
          <p className="z-footnote z-mono" style={{ margin: 0 }} dir="auto">
            {t('automations.smartSensor.selectedCount', { n: selected.size })}
          </p>
        )}>
        {existingForRoom.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8,
            border: '0.5px solid var(--line)', borderRadius: 'var(--r-ctl)', background: 'var(--surface)' }}>
            {[['replace', t('automations.smartSensor.modeUpdate', { name: existingForRoom[0].name || room?.name || '' })],
              ['new', t('automations.smartSensor.modeNew')]].map(([m, label]) => (
              <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
                style={{ display: 'flex', alignItems: 'center', gap: 12, background: mode === m ? 'color-mix(in srgb, var(--ok) 9%, transparent)' : 'none', border: 'none',
                  minHeight: 40, padding: '8px 12px', borderRadius: 'var(--r-chip)', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit', width: '100%' }}>
                <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                  border: `1.5px solid ${mode === m ? 'var(--ok)' : 'var(--line-2)'}`,
                  background: mode === m ? 'var(--ok)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {mode === m && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--surface)' }} />}
                </span>
                <span className="z-subhead" style={{ color: 'var(--ink)' }} dir="auto">{label}</span>
              </button>
            ))}
            {mode === 'new' && (
              <div style={{ padding: '4px 4px 4px' }}>
                <Input value={newName} onChange={e => setNewName(e.target.value)}
                  placeholder={t('automations.smartSensor.newNamePh')} dir="auto" />
              </div>
            )}
          </div>
        )}
        <p className="z-subhead" style={{ margin: 0 }} dir="auto">{t('automations.smartSensor.devicesHint')}</p>
        {candidates.length === 0 ? (
          <p className="z-subhead" style={{ color: 'var(--warn-text)', padding: '12px 16px', margin: 0, background: 'color-mix(in srgb, var(--warn) 8%, var(--surface))', border: '0.5px solid color-mix(in srgb, var(--warn) 30%, var(--line))', borderRadius: 'var(--r-ctl)' }} dir="auto">
            {t('automations.smartSensor.noDevices')}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, border: '0.5px solid var(--line)', borderRadius: 'var(--r-ctl)', padding: 8, background: 'var(--surface)' }}>
            {candidates.map(e => {
              const on = selected.has(e.entity_id)
              return (
                <button key={e.entity_id} type="button" onClick={() => toggle(e.entity_id)} aria-pressed={on}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 40, padding: '8px 12px', borderRadius: 'var(--r-chip)',
                    background: on ? 'color-mix(in srgb, var(--ok) 9%, transparent)' : 'transparent',
                    border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit', width: '100%',
                    transition: 'background var(--dur-press) var(--ease-standard)' }}>
                  <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: 'var(--r-chip)', flexShrink: 0,
                    border: `1.5px solid ${on ? 'var(--ok)' : 'var(--line-2)'}`,
                    background: on ? 'var(--ok)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {on && <Check size={14} strokeWidth={3} style={{ color: 'var(--on-accent)' }} />}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="z-subhead" style={{ display: 'block', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">
                      {entityDisplayName(e) || e.entity_id}
                    </span>
                    <span className="z-footnote" style={{ display: 'block' }} dir="auto">
                      {t(`automations.smartSensor.type.${OCC_TYPE[e.device_class]}`)}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </StepShell>
    )
  }

  // ── Step: Clear delay (+ walk-out grace for door-aware rooms) ───────────
  return (
    <StepShell t={t} title={t('automations.smartSensor.delayLabel')} idx={stepIdx + 1} total={total}
      onBack={goBack} onPrimary={handleCreate}
      primaryLabel={saving ? t('automations.smartSensor.creating') : t('automations.smartSensor.create')}
      primaryDisabled={saving || !room || selected.size === 0
        || (existingForRoom.length > 0 && mode === 'new' && !newName.trim())}
      extra={errBox}>
      <Input type="number" inputMode="numeric" min={0} placeholder={t('automations.smartSensor.delayPh')}
        value={delayOff} onChange={e => setDelayOff(e.target.value)} aria-label={t('automations.smartSensor.delayLabel')} />
      <p className="z-subhead" style={{ margin: 0 }} dir="auto">
        {t('automations.smartSensor.delayHint')}
      </p>
      {hasDoor && (
        <>
          <p className="z-subhead" style={{ ...noteBox, color: 'var(--ink-2)', margin: 0 }} dir="auto">
            {t('automations.smartSensor.doorNote')}
          </p>
          <p className="z-eyebrow" style={{ margin: 0 }}>{t('automations.smartSensor.graceLabel')}</p>
          <Input type="number" inputMode="numeric" min={0} placeholder={t('automations.smartSensor.gracePh')}
            value={walkoutGrace} onChange={e => setWalkoutGrace(e.target.value)} aria-label={t('automations.smartSensor.graceLabel')} />
          <p className="z-subhead" style={{ margin: 0 }} dir="auto">
            {t('automations.smartSensor.graceHint')}
          </p>
        </>
      )}
    </StepShell>
  )
}
