import React, { useEffect, useMemo, useState } from 'react'
import { useT } from '../../lib/i18n'
import { useDeviceStore } from '../../stores/deviceStore'
import { createOccupancySensor } from '../../lib/api'
import { Input } from '../ui/Input'
import { entityDisplayName } from '../../lib/utils'

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
        <span style={{ fontSize: 10.5, color: 'var(--ink-faint)', fontFamily: '"IBM Plex Mono", monospace' }}>{idx}/{total}</span>
      </div>
      {children}
      {extra}
      <div style={{ display: 'flex', gap: 8, paddingTop: 2 }}>
        <button type="button" onClick={onBack} className="z-btn-secondary" style={{ flex: 1, padding: '10px', borderRadius: 10, fontSize: 13 }}>
          {t('automations.smartSensor.back')}
        </button>
        <button type="button" onClick={onPrimary} disabled={primaryDisabled} className="z-btn-primary"
          style={{ flex: 1, padding: '10px', borderRadius: 10, fontSize: 13, opacity: primaryDisabled ? 0.5 : 1 }}>
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
  const entityMap = useMemo(
    () => Object.fromEntries((allEntities || []).map(e => [e.entity_id, e])),
    [allEntities],
  )

  const roomOptions = useMemo(() => (rooms || []).map(r => ({
    ...r,
    candidates: (r.entities || [])
      .map(id => entityMap[id])
      .filter(e => e && e.domain === 'binary_sensor' && OCC_TYPE[e.device_class]),
  })), [rooms, entityMap])

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
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [stepIdx, setStepIdx] = useState(initialRoom ? 1 : 0)

  const room = roomOptions.find(r => String(r.id) === String(roomId)) || null
  const candidates = room?.candidates || []

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
      const result = await createOccupancySensor({
        room: room.name,
        sensor_entities: Array.from(selected),
        delay_off_seconds: Number(delayOff) || 30,
      })
      onCreated?.(result)
      onClose?.()
    } catch (e) {
      setError(e?.userMessage || e?.message || t('automations.smartSensor.failed')); setSaving(false)
    }
  }

  const errBox = error && (
    <p style={{ fontSize: 12, color: 'var(--accent)', padding: '8px 10px', borderRadius: 8, background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>{error}</p>
  )

  // ── Step: Room ──────────────────────────────────────────────────────────
  if (current === 'room') {
    return (
      <StepShell t={t} title={t('automations.smartSensor.roomLabel')} idx={1} total={total}
        onBack={onClose} onPrimary={goNext} primaryLabel={t('automations.smartSensor.next')}
        primaryDisabled={!room || candidates.length === 0}>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, margin: 0 }} dir="auto">
          {t('automations.smartSensor.intro')}
        </p>
        {roomOptions.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--ink-faint)' }} dir="auto">{t('automations.smartSensor.noneFound')}</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {roomOptions.map(r => {
              const sel = String(r.id) === String(roomId)
              const disabled = r.candidates.length === 0
              return (
                <button key={r.id} type="button" disabled={disabled}
                  onClick={() => setRoomId(String(r.id))}
                  title={disabled ? t('automations.smartSensor.noDevices') : undefined}
                  style={{ padding: '10px 12px', borderRadius: 10, textAlign: 'start', fontFamily: 'inherit', fontSize: 13,
                    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
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

  // ── Step: Devices ───────────────────────────────────────────────────────
  if (current === 'devices') {
    return (
      <StepShell t={t} title={t('automations.smartSensor.devicesLabel')} idx={stepIdx + 1} total={total}
        onBack={goBack} onPrimary={goNext} primaryLabel={t('automations.smartSensor.next')}
        primaryDisabled={selected.size === 0}
        extra={candidates.length > 0 && (
          <p style={{ fontSize: 11, color: 'var(--ink-faint)', margin: 0 }} dir="auto">
            {t('automations.smartSensor.selectedCount', { n: selected.size })}
          </p>
        )}>
        <p style={{ fontSize: 12, color: 'var(--ink-faint)', margin: 0 }} dir="auto">{t('automations.smartSensor.devicesHint')}</p>
        {candidates.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--warn)', padding: '10px 12px', background: 'color-mix(in srgb, var(--warn) 8%, transparent)', borderRadius: 10 }} dir="auto">
            {t('automations.smartSensor.noDevices')}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, border: '0.5px solid var(--line)', borderRadius: 10, padding: 6, background: 'var(--surface)' }}>
            {candidates.map(e => {
              const on = selected.has(e.entity_id)
              return (
                <button key={e.entity_id} type="button" onClick={() => toggle(e.entity_id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8,
                    background: on ? 'color-mix(in srgb, var(--ok) 9%, transparent)' : 'transparent',
                    border: 'none', cursor: 'pointer', textAlign: 'start', fontFamily: 'inherit' }}>
                  <span style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                    border: `1.5px solid ${on ? 'var(--ok)' : 'var(--line)'}`,
                    background: on ? 'var(--ok)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--bg)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6"/></svg>}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">
                      {entityDisplayName(e) || e.entity_id}
                    </span>
                    <span style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-faint)' }} dir="auto">
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

  // ── Step: Clear delay ───────────────────────────────────────────────────
  return (
    <StepShell t={t} title={t('automations.smartSensor.delayLabel')} idx={stepIdx + 1} total={total}
      onBack={goBack} onPrimary={handleCreate}
      primaryLabel={saving ? t('automations.smartSensor.creating') : t('automations.smartSensor.create')}
      primaryDisabled={saving || !room || selected.size === 0}
      extra={errBox}>
      <Input type="number" inputMode="numeric" min={0} placeholder={t('automations.smartSensor.delayPh')}
        value={delayOff} onChange={e => setDelayOff(e.target.value)} />
      <p style={{ fontSize: 11.5, color: 'var(--ink-faint)', margin: 0, lineHeight: 1.45 }} dir="auto">
        {t('automations.smartSensor.delayHint')}
      </p>
    </StepShell>
  )
}
