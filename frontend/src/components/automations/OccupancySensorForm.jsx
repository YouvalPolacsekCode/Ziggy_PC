import React, { useMemo, useState } from 'react'
import { useT } from '../../lib/i18n'
import { useDeviceStore } from '../../stores/deviceStore'
import { createOccupancySensor } from '../../lib/api'
import { Input } from '../ui/Input'

// ── OccupancySensorForm ────────────────────────────────────────────────────
//
// Standalone creator for a Ziggy smart presence sensor. Fuses a room's motion
// / presence / door-recently-open binary sensors into one "is anyone here"
// entity via POST /api/occupancy-sensors (same handler the LLM tool routes to).
//
// Reused in two places: launched from the Automation Builder's "When someone
// is in a room" trigger (when the room has no sensor yet) and from the
// Templates tab CTA. It's just the panel — callers supply modal chrome.
//
// Room → sensor resolution happens client-side from deviceStore so the backend
// stays a thin wrapper: we pass explicit entity ids, never guess server-side.

// Which binary_sensor device_classes each signal toggle maps to.
const SIGNAL_CLASSES = {
  motion:   ['motion'],
  presence: ['presence', 'occupancy'],
  door:     ['door', 'opening'],
}

function OccupancySensorForm({ onCreated, onClose, initialRoom = '' }) {
  const t = useT()
  const rooms    = useDeviceStore(s => s.rooms)
  const entities = useDeviceStore(s => s.entities)

  const entityMap = useMemo(
    () => Object.fromEntries(entities.map(e => [e.entity_id, e])),
    [entities],
  )

  // A room is offerable only if it actually has a fusable binary sensor —
  // otherwise "create" would always fail the backend's at-least-one guard.
  const roomOptions = useMemo(() => {
    const relevant = new Set([...SIGNAL_CLASSES.motion, ...SIGNAL_CLASSES.presence, ...SIGNAL_CLASSES.door])
    return (rooms || [])
      .filter(area => (area.entities || []).some(eid => {
        const e = entityMap[eid]
        return e && e.domain === 'binary_sensor' && relevant.has(e.device_class)
      }))
      .map(area => ({ id: area.id, name: area.name, entities: area.entities || [] }))
  }, [rooms, entityMap])

  const [roomId, setRoomId] = useState(() => {
    if (initialRoom) {
      const hit = (rooms || []).find(a => a.id === initialRoom || a.name === initialRoom)
      if (hit) return hit.id
    }
    return roomOptions[0]?.id || ''
  })
  const [signals, setSignals] = useState({ motion: true, presence: true, door: true })
  const [delayOff, setDelayOff] = useState(30)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const selectedRoom = roomOptions.find(r => r.id === roomId) || null

  // Entities that will actually be fused, given the room + checked signals.
  const resolved = useMemo(() => {
    if (!selectedRoom) return []
    const classes = new Set(
      Object.entries(signals).filter(([, on]) => on).flatMap(([sig]) => SIGNAL_CLASSES[sig]),
    )
    return selectedRoom.entities
      .map(eid => entityMap[eid])
      .filter(e => e && e.domain === 'binary_sensor' && classes.has(e.device_class))
      .map(e => e.entity_id)
  }, [selectedRoom, signals, entityMap])

  const toggleSignal = key => setSignals(prev => ({ ...prev, [key]: !prev[key] }))

  const handleCreate = async () => {
    if (!selectedRoom || resolved.length === 0) return
    setSaving(true)
    setError('')
    try {
      const result = await createOccupancySensor({
        room: selectedRoom.name,
        sensor_entities: resolved,
        delay_off_seconds: Number(delayOff) || 30,
      })
      if (typeof onCreated === 'function') onCreated(result)
      if (typeof onClose === 'function') onClose()
    } catch (e) {
      setError(e?.userMessage || e?.message || t('automations.smartSensor.failed'))
    } finally {
      setSaving(false)
    }
  }

  const chip = (key, label) => {
    const on = signals[key]
    return (
      <button
        key={key}
        type="button"
        onClick={() => toggleSignal(key)}
        style={{
          padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 500,
          background: on ? 'var(--ink)' : 'var(--surface)',
          color: on ? 'var(--bg)' : 'var(--ink-mute)',
          border: on ? 'none' : '0.5px solid var(--line)',
          cursor: 'pointer', fontFamily: 'inherit',
        }}
        dir="auto"
      >
        {on ? '✓ ' : ''}{label}
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', lineHeight: 1.5, margin: 0 }} dir="auto">
        {t('automations.smartSensor.intro')}
      </p>

      {/* Room */}
      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }} dir="auto">
          {t('automations.smartSensor.roomLabel')}
        </label>
        {roomOptions.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--ink-faint)', margin: 0 }} dir="auto">
            {t('automations.smartSensor.noneFound')}
          </p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {roomOptions.map(r => {
              const sel = r.id === roomId
              return (
                <button key={r.id} type="button" onClick={() => setRoomId(r.id)} style={{
                  padding: '4px 11px', borderRadius: 999, fontSize: 12, fontWeight: 500,
                  background: sel ? 'var(--ink)' : 'var(--surface)',
                  color: sel ? 'var(--bg)' : 'var(--ink-mute)',
                  border: sel ? 'none' : '0.5px solid var(--line)',
                  cursor: 'pointer', fontFamily: 'inherit',
                }} dir="auto">{r.name}</button>
              )
            })}
          </div>
        )}
      </div>

      {/* Signals */}
      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }} dir="auto">
          {t('automations.smartSensor.signalsLabel')}
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {chip('motion',   t('automations.smartSensor.motion'))}
          {chip('presence', t('automations.smartSensor.presence'))}
          {chip('door',     t('automations.smartSensor.door'))}
        </div>
        {selectedRoom && (
          <p style={{ fontSize: 11, color: resolved.length ? 'var(--ink-faint)' : 'var(--warn)', margin: '6px 0 0' }} dir="auto">
            {resolved.length
              ? t('automations.smartSensor.resolved', { n: resolved.length, room: selectedRoom.name })
              : t('automations.smartSensor.noneFound')}
          </p>
        )}
      </div>

      {/* Delay-off */}
      <Input
        label={t('automations.smartSensor.delayLabel')}
        type="number"
        min={0}
        placeholder={t('automations.smartSensor.delayPh')}
        value={delayOff}
        onChange={e => setDelayOff(e.target.value)}
      />

      {error && (
        <p style={{ color: 'var(--err, #d33)', fontSize: 12, margin: 0 }} dir="auto">{error}</p>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        {onClose && (
          <button onClick={onClose} className="z-btn-secondary" disabled={saving} style={{ fontSize: 13, padding: '8px 14px', borderRadius: 10 }}>
            {t('common.close')}
          </button>
        )}
        <button
          onClick={handleCreate}
          className="z-btn-primary"
          disabled={saving || !selectedRoom || resolved.length === 0}
          style={{ fontSize: 13, padding: '8px 14px', borderRadius: 10, opacity: (!selectedRoom || resolved.length === 0) ? 0.4 : 1 }}
        >
          {saving ? t('automations.smartSensor.creating') : t('automations.smartSensor.create')}
        </button>
      </div>
    </div>
  )
}

export default OccupancySensorForm
